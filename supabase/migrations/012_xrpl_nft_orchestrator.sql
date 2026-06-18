-- ============================================================
-- BuildChain — XRPL NFT Verification Columns
-- Migration 012: On-ledger evidence tracking for the Verification
-- Orchestrator (Provisional Patent BLDCHN-001-P)
--
-- The dual-condition escrow release system requires two on-ledger
-- NFT proofs before funds are automatically released:
--   1. Inspector Credential NFT  (XLS-20, taxon 3) on inspections
--   2. Lien Waiver NFT           (XLS-20, taxon 2) on draw_requests
--
-- The Verification Orchestrator checks BOTH conditions are present
-- on the ledger before triggering EscrowFinish automatically.
-- ============================================================

-- ── Inspector Credential NFT columns on inspections ──────────────────────────
-- Minted when an inspection passes (status → 'passed').
-- credential_nft_id   : XLS-20 NFTokenID (64-char hex)
-- credential_nft_hash : EscrowCreate-related TX hash for audit trail
-- credential_nft_minted_at : timestamp of on-ledger mint
ALTER TABLE public.inspections
  ADD COLUMN IF NOT EXISTS credential_nft_id        text,
  ADD COLUMN IF NOT EXISTS credential_nft_hash      text,
  ADD COLUMN IF NOT EXISTS credential_nft_minted_at timestamptz;

-- Index for orchestrator lookups by NFT ID
CREATE INDEX IF NOT EXISTS inspections_credential_nft_idx
  ON public.inspections (credential_nft_id)
  WHERE credential_nft_id IS NOT NULL;


-- ── Lien Waiver NFT columns on draw_requests ─────────────────────────────────
-- Minted when a lien waiver is confirmed for the draw (lien_waiver → true).
-- lien_waiver_nft_id   : XLS-20 NFTokenID (64-char hex)
-- lien_waiver_nft_hash : NFTokenMint TX hash
-- lien_waiver_nft_minted_at : timestamp of on-ledger mint
ALTER TABLE public.draw_requests
  ADD COLUMN IF NOT EXISTS lien_waiver_nft_id        text,
  ADD COLUMN IF NOT EXISTS lien_waiver_nft_hash      text,
  ADD COLUMN IF NOT EXISTS lien_waiver_nft_minted_at timestamptz;

-- Index for orchestrator lookups
CREATE INDEX IF NOT EXISTS draw_requests_lien_waiver_nft_idx
  ON public.draw_requests (lien_waiver_nft_id)
  WHERE lien_waiver_nft_id IS NOT NULL;


-- ── Verification Receipt column on draw_requests ──────────────────────────────
-- Populated by the orchestrator when both conditions are satisfied.
-- Records both NFT IDs + dual-condition event timestamp as the
-- immutable Verification Receipt referenced in the patent (Section V).
ALTER TABLE public.draw_requests
  ADD COLUMN IF NOT EXISTS verification_receipt jsonb;

-- Example receipt structure written by the orchestrator:
-- {
--   "verified_at": "2026-06-18T12:00:00Z",
--   "inspector_credential_nft": "<nftTokenId>",
--   "lien_waiver_nft": "<nftTokenId>",
--   "escrow_finish_hash": "<txHash>",
--   "trigger": "dual_condition_satisfied"
-- }
