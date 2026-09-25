-- Migration 014: Building Block integration fields
-- Adds columns required by §3 of the BB↔BC integration spec:
--   draw_requests   — idempotency, BB draw id, explicit amounts, currency, gc_wallet, payees
--   draw_line_items — bb_pay_app_id for sub-level dedup and webhook payment matching
--   lien_waivers    — bb_waiver_id for waiver NFT linking back to BB
-- Run once via: supabase db push  OR  paste into the Supabase SQL editor.
-- All columns are nullable so existing rows keep working without backfill.

-- ── draw_requests ─────────────────────────────────────────────────────────────
ALTER TABLE draw_requests
  -- Building Block's own draw id (bb_draw_id field in submit body)
  ADD COLUMN IF NOT EXISTS bb_draw_id           bigint,
  -- The idempotency key sent by BB; unique constraint prevents duplicate inserts
  ADD COLUMN IF NOT EXISTS idempotency_key      text,
  -- Explicit BB amounts — BC honors these instead of recomputing
  ADD COLUMN IF NOT EXISTS gross_amount         numeric(12,2),
  ADD COLUMN IF NOT EXISTS net_amount           numeric(12,2),
  -- retainage_rate and retainage_held already exist (added by migration 010)
  -- currency — always "USD" from BB today
  ADD COLUMN IF NOT EXISTS currency             text DEFAULT 'USD',
  -- GC's XRPL wallet (escrow destination override when not null)
  ADD COLUMN IF NOT EXISTS gc_wallet            text,
  -- Full payees array from BB — stored as JSONB for the escrow_released webhook
  ADD COLUMN IF NOT EXISTS payees               jsonb,
  -- Hold reason when lender puts draw on hold
  ADD COLUMN IF NOT EXISTS hold_reason          text,
  -- Free-text note from the decision relay (Building Block lender portal)
  ADD COLUMN IF NOT EXISTS reviewed_by_note     text,
  -- Verification receipt from the orchestrator (Patent §V)
  ADD COLUMN IF NOT EXISTS verification_receipt jsonb;

-- Unique idempotency key — prevents duplicate draws from BB retries
-- Uses a partial index so NULL keys (pre-BB draws) don't conflict.
CREATE UNIQUE INDEX IF NOT EXISTS draw_requests_idempotency_key_uidx
  ON draw_requests (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ── draw_line_items ───────────────────────────────────────────────────────────
ALTER TABLE draw_line_items
  -- BB's pay-app id — used to detect duplicate submissions and match
  -- the escrow_released webhook payments[] rows back to BB pay apps
  ADD COLUMN IF NOT EXISTS bb_pay_app_id   bigint,
  -- BB sub line number (sub_line_no from §3.1)
  ADD COLUMN IF NOT EXISTS sub_line_no     text,
  -- BB sub code (sub_code from §3.1)
  ADD COLUMN IF NOT EXISTS sub_code        text,
  -- CSI division (csi_division from §3.1)
  ADD COLUMN IF NOT EXISTS csi_division    text,
  -- Trade description
  ADD COLUMN IF NOT EXISTS trade           text,
  -- Cumulative G703 retainage column (per-line, as sent by BB)
  ADD COLUMN IF NOT EXISTS retainage_cumulative numeric(12,2);

-- ── lien_waivers ─────────────────────────────────────────────────────────────
ALTER TABLE lien_waivers
  -- BB's waiver id — used to link waiver_nft_minted webhook back to BB
  ADD COLUMN IF NOT EXISTS bb_waiver_id    bigint,
  -- BB's pay-app id this waiver covers
  ADD COLUMN IF NOT EXISTS bb_pay_app_id   bigint,
  -- Arizona statute reference
  ADD COLUMN IF NOT EXISTS statute_ref     text;

-- ── draw_requests: fix DrawStatus to include 'held' ─────────────────────────
-- Supabase uses a CHECK constraint or enum. If draw_status is an enum, alter it.
-- If it's a text column with CHECK, drop and recreate the constraint.
-- Safe no-op if 'held' is already present.
DO $$
BEGIN
  BEGIN
    ALTER TYPE draw_status ADD VALUE IF NOT EXISTS 'held';
  EXCEPTION WHEN others THEN
    NULL; -- not an enum type — handled by CHECK constraint below
  END;
END
$$;

-- If draw status is a text column with a CHECK, add 'held' to the allowed values:
DO $$
DECLARE
  constraint_name text;
BEGIN
  SELECT conname INTO constraint_name
  FROM pg_constraint
  WHERE conrelid = 'draw_requests'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE draw_requests DROP CONSTRAINT %I', constraint_name);
    ALTER TABLE draw_requests ADD CONSTRAINT draw_requests_status_check
      CHECK (status IN ('draft','submitted','pending','approved','funded','declined','held','failed','distributing','settled'));
  END IF;
END
$$;

-- ── Indexes for common lookups ─────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS draw_line_items_bb_pay_app_id_idx
  ON draw_line_items (bb_pay_app_id)
  WHERE bb_pay_app_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lien_waivers_bb_waiver_id_idx
  ON lien_waivers (bb_waiver_id)
  WHERE bb_waiver_id IS NOT NULL;
