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
                    'releasing',           -- being paid right now (one run at a time may hold this)
                    'released',            -- paid on the ledger
                    'held',                -- cannot be paid yet (no wallet, or it cannot receive the token)
                    'withdrawn',           -- the lender withdrew the approval or took the escrow back
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

-- One unpaid payment per ticket on a loan account, in every state where the
-- ticket is still spoken for.
create unique index if not exists draw_payments_ticket_uniq
  on public.draw_payments (project_id, release_ticket)
  where release_ticket is not null and status in ('awaiting_signature', 'locked', 'releasing', 'failed');

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

-- ── Funded, and counted, in one step ─────────────────────────────────────────
-- Marking a draw funded and adding what it paid to the loan's drawn amount
-- were two separate writes; a run cut off between them left the loan's total
-- short for good. This does both or neither, and only one caller can win.
create or replace function public.mark_draw_funded(p_draw_id uuid, p_amount numeric, p_changes jsonb default '{}'::jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Only the server records a funded draw';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The funded amount must be positive';
  end if;
  update draw_requests set
    status               = 'funded',
    funded_at            = coalesce((p_changes->>'funded_at')::timestamptz, now()),
    reviewed_at          = coalesce((p_changes->>'reviewed_at')::timestamptz, reviewed_at),
    verification_receipt = coalesce(p_changes->'verification_receipt', verification_receipt),
    escrow_finish_hash   = coalesce(p_changes->>'escrow_finish_hash', escrow_finish_hash),
    settlement_state     = coalesce(p_changes->>'settlement_state', settlement_state),
    settlement_amount    = coalesce((p_changes->>'settlement_amount')::numeric, settlement_amount)
  where id = p_draw_id and status = 'approved'
  returning project_id into v_project;
  if v_project is null then
    return false;                       -- not approved any more: someone else funded it, or it changed
  end if;
  update projects set amount_drawn = coalesce(amount_drawn, 0) + p_amount, updated_at = now()
  where id = v_project;
  return true;
end;
$$;
revoke all on function public.mark_draw_funded(uuid, numeric, jsonb) from public, anon, authenticated;
grant execute on function public.mark_draw_funded(uuid, numeric, jsonb) to service_role;

-- Set once the release has been announced (fee line, emails, Building Block's
-- notices). A funded draw without it is finished by the daily check. Draws
-- funded before this existed were announced at the time.
alter table public.draw_requests add column if not exists release_announced_at timestamptz;
update public.draw_requests set release_announced_at = coalesce(funded_at, now())
  where status = 'funded' and release_announced_at is null;

-- ── A count of requests made by people who are not signed in ─────────────────
-- The wallet set-up page is open to anyone and each use asks the wallet
-- service for a sign request. This lets the server cap how many, across all
-- of its instances. It holds no personal data: the source is a one-way hash.
create table if not exists public.public_request_log (
  id         bigint generated always as identity primary key,
  kind       text not null,
  source     text,
  created_at timestamptz not null default now()
);
create index if not exists public_request_log_idx on public.public_request_log (kind, created_at);
alter table public.public_request_log enable row level security;
revoke all on public.public_request_log from anon, authenticated;
grant all on public.public_request_log to service_role;
