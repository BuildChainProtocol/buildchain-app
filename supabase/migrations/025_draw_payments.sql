-- 025: one ledger payment per payee.
--
-- A draw pays a general contractor and often several subcontractors. Until
-- now a dollar-token draw was a single payment to a single wallet. Each payee
-- now has its own row, its own lender signature, its own ledger transaction
-- and its own status, so nobody is ever reported paid who was not.

create table if not exists public.draw_payments (
  id              uuid primary key default gen_random_uuid(),
  draw_request_id uuid not null references public.draw_requests(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  seq             integer not null,                 -- order within the draw
  payee_name      text,
  sub_code        text,                             -- Building Block's code for a subcontractor
  bb_pay_app_id   bigint,                           -- Building Block's pay application
  wallet          text,                             -- the payee's ledger account; null = no wallet on file
  amount          numeric not null check (amount > 0),
  status          text not null default 'pending' check (status in (
                    'pending',             -- waiting for the lender to sign
                    'awaiting_signature',  -- a sign request is open on the lender's phone
                    'locked',              -- signed; escrowed, or the release is authorized
                    'released',            -- paid on the ledger
                    'held',                -- cannot be paid yet (no wallet, or it cannot receive the token)
                    'failed')),            -- the ledger refused the release
  held_reason     text,
  release_ticket  integer,                          -- two_signature: the ticket this payment uses
  escrow_owner    text,                             -- token_escrow: the lender's account
  escrow_sequence integer,
  lock_txn_hash   text,                             -- token_escrow: the EscrowCreate
  release_txn_hash text,
  released_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (draw_request_id, seq)
);
create index if not exists draw_payments_project_idx on public.draw_payments (project_id, status);

-- One pending payment per ticket on a loan account.
create unique index if not exists draw_payments_ticket_uniq
  on public.draw_payments (project_id, release_ticket)
  where release_ticket is not null and status in ('awaiting_signature', 'locked');

alter table public.draw_payments enable row level security;

-- The parties to the project can see who is paid what. Every write goes
-- through the site's routes with the service key.
create policy "Project parties read draw payments" on public.draw_payments
  for select using (public.is_project_party(project_id));

revoke all on public.draw_payments from anon, authenticated;
grant select on public.draw_payments to authenticated;
grant all on public.draw_payments to service_role;

-- ── Signing material, readable by the server only ────────────────────────────
create table if not exists public.payment_signatures (
  payment_id  uuid primary key references public.draw_payments(id) on delete cascade,
  payload     text,          -- Xaman request id
  qr_png      text,          -- where the request's QR code is served
  open_url    text,          -- the request's link
  txjson      jsonb,         -- the exact transaction the lender was asked to sign
  signed_blob text,          -- two_signature: the lender's signature
  updated_at  timestamptz not null default now()
);
alter table public.payment_signatures enable row level security;
revoke all on public.payment_signatures from anon, authenticated;
grant all on public.payment_signatures to service_role;

-- Xaman gives each wallet a token after its first signature; with it, later
-- requests go straight to the lender's phone with no QR code to scan.
alter table public.lender_wallet_links
  alter column payload drop not null,
  add column if not exists user_token text;

-- More release slots on a loan account is one more thing a lender signs.
alter table public.settlement_requests drop constraint if exists settlement_requests_kind_check;
alter table public.settlement_requests add constraint settlement_requests_kind_check
  check (kind in ('deposit', 'refund', 'escrow_cancel', 'withdraw_release', 'add_slots'));

-- A take-back or a withdrawal is about one payment.
alter table public.settlement_requests
  add column if not exists payment_id uuid references public.draw_payments(id) on delete set null;

-- Replaced by payment_signatures (it held one signature per draw).
drop table if exists public.draw_signatures;
