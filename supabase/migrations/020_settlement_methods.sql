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

alter table public.lenders
  add column if not exists wallet_link_payload text;   -- open Xaman sign-in request, if any

alter table public.draw_requests
  add column if not exists settlement_method text
    check (settlement_method is null or settlement_method in ('test_xrp', 'token_escrow', 'two_signature')),
  add column if not exists settlement_state text
    check (settlement_state is null or settlement_state in ('awaiting_lender_signature', 'locked', 'released')),
  add column if not exists settlement_amount numeric,   -- dollars the lender signed for
  add column if not exists settlement_payee text,       -- ledger account the release pays
  add column if not exists lender_sign_payload text,    -- Xaman request id
  add column if not exists lender_sign_tx jsonb,        -- the exact transaction the lender was asked to sign
  add column if not exists lender_signed_blob text,     -- two_signature: the lender's signature
  add column if not exists escrow_owner text,           -- token_escrow: the lender's account
  add column if not exists release_ticket integer;      -- two_signature: the ticket this release uses

-- One pending release per ticket on a loan account.
create unique index if not exists draw_requests_release_ticket_uniq
  on public.draw_requests (project_id, release_ticket)
  where release_ticket is not null and settlement_state is distinct from 'released';
