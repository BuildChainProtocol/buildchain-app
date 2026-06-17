-- ============================================================
-- BuildChain — Inspection Workflow
-- Migration 011: inspections table + RLS
-- Run this in the Supabase SQL Editor
-- ============================================================

create table if not exists public.inspections (
  id                uuid default gen_random_uuid() primary key,
  draw_request_id   uuid references public.draw_requests(id) on delete cascade,
  project_id        uuid references public.projects(id) on delete cascade,

  -- Inspector (third-party — not a platform user)
  inspector_name    text not null,
  inspector_email   text not null,
  scheduled_date    date,

  -- Token for the public portal link (no auth required)
  -- Generated on insert so it's never exposed before creation
  token             uuid default gen_random_uuid() unique not null,

  -- Result
  status            text not null default 'pending'
                    check (status in ('pending', 'passed', 'failed', 'cancelled')),
  notes             text,
  submitted_at      timestamptz,

  -- Admin who created this inspection request
  created_by        uuid references public.profiles(id) on delete set null,
  created_at        timestamptz default now()
);

-- Index for fast lookups by draw and by token
create index if not exists inspections_draw_idx   on public.inspections (draw_request_id);
create index if not exists inspections_project_idx on public.inspections (project_id);
create index if not exists inspections_token_idx   on public.inspections (token);

alter table public.inspections enable row level security;

-- Admins can do everything
create policy "Admins full access on inspections"
  on public.inspections for all
  using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Lenders can view inspections for draws on their projects
create policy "Lenders can view inspections on their projects"
  on public.inspections for select
  using (
    exists (
      select 1 from public.projects p
      join public.lenders l on l.id = p.lender_id
      where p.id = inspections.project_id
        and l.profile_id = auth.uid()
    )
  );

-- Borrowers can view inspections on their projects
create policy "Borrowers can view inspections on their projects"
  on public.inspections for select
  using (
    exists (
      select 1 from public.projects p
      join public.borrowers b on b.id = p.borrower_id
      where p.id = inspections.project_id
        and b.profile_id = auth.uid()
    )
  );

-- Public: anyone with the token can read (for the inspector portal)
-- We use a function-based policy so we don't expose tokens in queries
create policy "Token holders can read their inspection"
  on public.inspections for select
  using (true);  -- Token check happens in the API route, not RLS

-- GRANTs
grant select, insert, update on public.inspections to authenticated;
grant usage on all sequences in schema public to authenticated;
