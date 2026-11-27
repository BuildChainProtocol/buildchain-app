-- 020: dollar-token settlement, signed by the lender.
--
-- Each project picks how its draws settle:
--   test_xrp       the pilot behaviour: BuildChain's test wallet locks 1 test XRP
--   token_escrow   the lender locks the dollar token in a native escrow
--   two_signature  the lender deposits into a loan account that needs both the
--                  lender's and BuildChain's signature to pay out
-- Existing projects and draws stay on test_xrp, so nothing changes for them.

alter table public.projects
  add column if not exists settlement_method text not null default 'test_xrp'
    check (settlement_method in ('test_xrp', 'token_escrow', 'two_signature')),
  add column if not exists loan_account text;          -- two_signature: the loan's ledger account

alter table public.draw_requests
  add column if not exists settlement_method text
    check (settlement_method is null or settlement_method in ('test_xrp', 'token_escrow', 'two_signature')),
  add column if not exists settlement_state text
    check (settlement_state is null or settlement_state in ('awaiting_lender_signature', 'locked', 'released')),
  add column if not exists settlement_amount numeric,   -- dollars the lender signed for
  add column if not exists settlement_payee text,       -- ledger account the release pays
  add column if not exists escrow_owner text,           -- token_escrow: the lender's account
  add column if not exists release_ticket integer;      -- two_signature: the ticket this release uses

-- One pending release per ticket on a loan account.
create unique index if not exists draw_requests_release_ticket_uniq
  on public.draw_requests (project_id, release_ticket)
  where release_ticket is not null and settlement_state is distinct from 'released';

-- ── Signing material, readable by the server only ────────────────────────────
-- A wallet sign request can be signed by anyone who learns its id, and the
-- lender's signature is what BuildChain later countersigns. Neither may be
-- readable or writable by any signed-in user, so they live apart from the
-- rows people can see. Row-level security is on with no policies: only the
-- service key reaches these tables.

create table if not exists public.draw_signatures (
  draw_request_id uuid primary key references public.draw_requests(id) on delete cascade,
  payload         text,          -- Xaman request id
  txjson          jsonb,         -- the exact transaction the lender was asked to sign
  signed_blob     text,          -- two_signature: the lender's signature
  updated_at      timestamptz not null default now()
);
alter table public.draw_signatures enable row level security;
revoke all on public.draw_signatures from anon, authenticated;
grant all on public.draw_signatures to service_role;

create table if not exists public.lender_wallet_links (
  lender_id  uuid primary key references public.lenders(id) on delete cascade,
  payload    text not null,      -- open Xaman sign-in request
  created_at timestamptz not null default now()
);
alter table public.lender_wallet_links enable row level security;
revoke all on public.lender_wallet_links from anon, authenticated;
grant all on public.lender_wallet_links to service_role;
