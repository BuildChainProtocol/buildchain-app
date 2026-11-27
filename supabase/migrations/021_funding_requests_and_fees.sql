-- 021: lender funding requests, and a record of protocol fees.

-- ── Things a lender signs outside a draw approval ────────────────────────────
-- deposit           money into a two-signature loan account
-- refund            money back out of it (both signatures)
-- escrow_cancel     take back an escrow whose deadline has passed
-- withdraw_release  cancel a release the lender already signed
create table if not exists public.settlement_requests (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  draw_request_id uuid references public.draw_requests(id) on delete set null,
  kind            text not null check (kind in ('deposit', 'refund', 'escrow_cancel', 'withdraw_release')),
  amount          numeric,
  txjson          jsonb not null,          -- the exact transaction the lender was asked to sign
  payload         text not null,           -- Xaman request id
  state           text not null default 'waiting'
                    check (state in ('waiting', 'done', 'rejected', 'expired', 'failed')),
  txn_hash        text,
  error           text,
  requested_by    uuid,
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);
create index if not exists settlement_requests_project_idx on public.settlement_requests (project_id, created_at desc);

alter table public.settlement_requests enable row level security;

create policy "Admins manage settlement requests" on public.settlement_requests
  for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- A lender reads the requests on their own projects. Every write goes through
-- the site's routes with the service key: the stored transaction is what
-- BuildChain countersigns, so no signed-in user may change it.
create policy "Lenders read their projects' settlement requests" on public.settlement_requests
  for select using (exists (
    select 1 from public.projects p join public.lenders l on l.id = p.lender_id
    where p.id = settlement_requests.project_id and l.profile_id = auth.uid()));

revoke all on public.settlement_requests from anon, authenticated;
grant select on public.settlement_requests to authenticated;
grant all on public.settlement_requests to service_role;
-- ── Protocol fee record ──────────────────────────────────────────────────────
-- One row per released draw: what the fee is under the rate in force, and
-- whether it is waived. A record only: nothing here charges anyone.
create table if not exists public.fee_accruals (
  id              uuid primary key default gen_random_uuid(),
  draw_request_id uuid not null unique references public.draw_requests(id) on delete cascade,
  project_id      uuid not null references public.projects(id) on delete cascade,
  lender_id       uuid references public.lenders(id) on delete set null,
  released_at     timestamptz not null,
  release_amount  numeric not null,        -- dollars released
  rate_bps        integer not null,        -- 30 = 0.30%
  fee_amount      numeric not null,        -- release_amount * rate_bps / 10000, to the cent
  waived          boolean not null default false,
  waiver_reason   text,
  settlement_method text,
  network         text,                    -- 'testnet' or 'mainnet'
  created_at      timestamptz not null default now()
);
create index if not exists fee_accruals_lender_idx on public.fee_accruals (lender_id, released_at desc);

alter table public.fee_accruals enable row level security;

create policy "Admins manage fee accruals" on public.fee_accruals
  for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

create policy "Lenders read their own fee accruals" on public.fee_accruals
  for select using (exists (
    select 1 from public.lenders l where l.id = fee_accruals.lender_id and l.profile_id = auth.uid()));

revoke all on public.fee_accruals from anon, authenticated;
grant select on public.fee_accruals to authenticated;
grant all on public.fee_accruals to service_role;
