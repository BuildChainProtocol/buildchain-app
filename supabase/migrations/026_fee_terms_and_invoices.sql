-- 026: the lender's agreement to the fee, their billing details, and invoices.
--
-- The Terms of Service promise that no fee applies to a lender until they
-- have agreed to it. This records that agreement (who, when, which version),
-- holds what an invoice needs (legal name, billing email and address), and
-- adds the invoice itself: a number, a period, a due date and a paid state.
-- Nothing here takes payment; an invoice is paid through Stripe or by bank
-- transfer and then marked paid.

alter table public.lenders
  add column if not exists legal_name            text,
  add column if not exists billing_email         text,
  add column if not exists billing_address       text,
  add column if not exists fee_terms_version     text,
  add column if not exists fee_terms_accepted_at timestamptz,
  add column if not exists fee_terms_accepted_by uuid;

create table if not exists public.fee_invoices (
  id                uuid primary key default gen_random_uuid(),
  number            text not null unique,              -- BC-2026-12-0001
  lender_id         uuid not null references public.lenders(id) on delete restrict,
  period_start      date not null,
  period_end        date not null,                     -- last day of the period
  released_total    numeric not null default 0,        -- dollars released in the period
  fee_total         numeric not null default 0,        -- fees on all of it
  waived_total      numeric not null default 0,        -- of which waived (shown, not charged)
  amount_due        numeric not null default 0,
  status            text not null default 'draft' check (status in ('draft', 'sent', 'paid', 'void')),
  issued_at         timestamptz,
  due_at            timestamptz,
  paid_at           timestamptz,
  payment_reference text,                              -- bank reference or note
  stripe_invoice_id text,                              -- set once Stripe sends it
  -- The billing details as they were when the invoice was issued.
  bill_to_name      text,
  bill_to_email     text,
  bill_to_address   text,
  created_by        uuid,
  created_at        timestamptz not null default now()
);
-- One live invoice per lender per month. A voided invoice stays on file (its
-- number is never reused) and does not block a corrected one.
create unique index if not exists fee_invoices_lender_period_uniq
  on public.fee_invoices (lender_id, period_start) where status <> 'void';

alter table public.fee_accruals
  add column if not exists invoice_id uuid references public.fee_invoices(id) on delete set null;
create index if not exists fee_accruals_invoice_idx on public.fee_accruals (invoice_id);

alter table public.fee_invoices enable row level security;

create policy "Admins manage fee invoices" on public.fee_invoices
  for all using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));

-- A lender sees their own invoices once they are issued, never a draft.
create policy "Lenders read their own issued invoices" on public.fee_invoices
  for select using (
    status <> 'draft'
    and exists (select 1 from public.lenders l where l.id = fee_invoices.lender_id and l.profile_id = auth.uid()));

revoke all on public.fee_invoices from anon, authenticated;
grant select on public.fee_invoices to authenticated;
grant all on public.fee_invoices to service_role;
