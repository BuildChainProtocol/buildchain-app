-- ============================================================
-- BuildChain Protocol — Initial Database Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ============================================================
-- PROFILES (extends Supabase auth.users)
-- ============================================================
create table if not exists public.profiles (
  id            uuid references auth.users on delete cascade primary key,
  role          text not null check (role in ('admin', 'lender', 'borrower')),
  full_name     text,
  company_name  text,
  email         text,
  phone         text,
  avatar_url    text,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
alter table public.profiles enable row level security;

-- Profiles policies
create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);
create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);
create policy "Admins can view all profiles"
  on public.profiles for select using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email, role, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'role', 'borrower'),
    coalesce(new.raw_user_meta_data->>'full_name', '')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ============================================================
-- LENDERS
-- ============================================================
create table if not exists public.lenders (
  id            uuid default gen_random_uuid() primary key,
  profile_id    uuid references public.profiles(id) on delete set null,
  company_name  text not null,
  contact_name  text,
  email         text,
  phone         text,
  loan_types    text[],
  max_ltv       decimal(5,2),
  active        boolean default true,
  created_at    timestamptz default now()
);
alter table public.lenders enable row level security;

create policy "Lenders visible to authenticated users"
  on public.lenders for select using (auth.role() = 'authenticated');
create policy "Admins can manage lenders"
  on public.lenders for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- BORROWERS
-- ============================================================
create table if not exists public.borrowers (
  id              uuid default gen_random_uuid() primary key,
  profile_id      uuid references public.profiles(id) on delete set null,
  company_name    text not null,
  contact_name    text,
  email           text,
  phone           text,
  license_number  text,
  license_state   text,
  rating          text check (rating in ('preferred', 'standard', 'new', 'probation')) default 'new',
  active          boolean default true,
  created_at      timestamptz default now()
);
alter table public.borrowers enable row level security;

create policy "Borrowers visible to authenticated users"
  on public.borrowers for select using (auth.role() = 'authenticated');
create policy "Admins can manage borrowers"
  on public.borrowers for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- PROJECTS
-- ============================================================
create table if not exists public.projects (
  id              uuid default gen_random_uuid() primary key,
  name            text not null,
  address         text,
  city            text,
  state           text default 'AZ',
  zip             text,
  property_type   text check (property_type in ('residential', 'multifamily', 'commercial', 'adu', 'other')),
  borrower_id     uuid references public.borrowers(id) on delete restrict,
  lender_id       uuid references public.lenders(id) on delete restrict,
  loan_amount     decimal(14,2) not null,
  amount_drawn    decimal(14,2) default 0,
  interest_rate   decimal(5,3),
  loan_number     text unique,
  maturity_date   date,
  stage           text check (stage in ('application','review','approved','active','complete','cancelled')) default 'application',
  ltv             decimal(5,2),
  appraised_value decimal(14,2),
  notes           text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
alter table public.projects enable row level security;

create policy "All authenticated can view projects"
  on public.projects for select using (auth.role() = 'authenticated');
create policy "Admins can manage projects"
  on public.projects for all using (
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );
create policy "Lenders can view their projects"
  on public.projects for select using (
    exists (
      select 1 from public.lenders l
      where l.id = lender_id and l.profile_id = auth.uid()
    )
  );
create policy "Borrowers can view their projects"
  on public.projects for select using (
    exists (
      select 1 from public.borrowers b
      where b.id = borrower_id and b.profile_id = auth.uid()
    )
  );

-- ============================================================
-- DRAW REQUESTS
-- ============================================================
create table if not exists public.draw_requests (
  id              uuid default gen_random_uuid() primary key,
  project_id      uuid references public.projects(id) on delete cascade,
  request_number  text,
  amount          decimal(14,2) not null,
  purpose         text,
  phase           text,
  description     text,
  status          text check (status in ('draft','submitted','pending','approved','funded','declined')) default 'draft',
  submitted_by    uuid references public.profiles(id),
  approved_by     uuid references public.profiles(id),
  declined_by     uuid references public.profiles(id),
  decline_reason  text,
  submitted_at    timestamptz,
  reviewed_at     timestamptz,
  funded_at       timestamptz,
  wire_reference  text,
  inspection_done boolean default false,
  lien_waiver     boolean default false,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
alter table public.draw_requests enable row level security;

create policy "All authenticated can view draws"
  on public.draw_requests for select using (auth.role() = 'authenticated');
create policy "Borrowers can create draws for their projects"
  on public.draw_requests for insert with check (
    exists (
      select 1 from public.projects p
      join public.borrowers b on b.id = p.borrower_id
      where p.id = project_id and b.profile_id = auth.uid()
    )
  );
create policy "Admins and lenders can update draws"
  on public.draw_requests for update using (
    exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','lender'))
  );
create policy "Borrowers can update draft draws"
  on public.draw_requests for update using (
    status = 'draft' and submitted_by = auth.uid()
  );

-- Auto-generate draw request number
create or replace function public.generate_draw_number()
returns trigger as $$
declare
  project_count integer;
  draw_count integer;
begin
  select count(*) into draw_count
  from public.draw_requests
  where project_id = new.project_id;

  new.request_number = 'DR-' || to_char(now(), 'YYYY') || '-' || lpad((draw_count + 1)::text, 3, '0');
  return new;
end;
$$ language plpgsql;

create trigger set_draw_number
  before insert on public.draw_requests
  for each row execute procedure public.generate_draw_number();

-- ============================================================
-- DOCUMENTS
-- ============================================================
create table if not exists public.documents (
  id              uuid default gen_random_uuid() primary key,
  project_id      uuid references public.projects(id) on delete cascade,
  draw_request_id uuid references public.draw_requests(id) on delete set null,
  name            text not null,
  doc_type        text check (doc_type in (
    'loan_agreement','title_commitment','plans_permits','insurance',
    'environmental','inspection_report','lien_waiver','draw_request_form',
    'contractor_agreement','appraisal','other'
  )),
  storage_path    text,
  file_name       text,
  file_size       bigint,
  mime_type       text,
  status          text check (status in ('required','uploaded','approved','rejected','overdue','not_required')) default 'required',
  required        boolean default true,
  notes           text,
  uploaded_by     uuid references public.profiles(id),
  reviewed_by     uuid references public.profiles(id),
  uploaded_at     timestamptz,
  due_date        date,
  created_at      timestamptz default now()
);
alter table public.documents enable row level security;

create policy "All authenticated can view documents"
  on public.documents for select using (auth.role() = 'authenticated');
create policy "Authenticated can upload documents"
  on public.documents for insert with check (auth.role() = 'authenticated');
create policy "Uploaders and admins can update documents"
  on public.documents for update using (
    uploaded_by = auth.uid() or
    exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
  );

-- ============================================================
-- ACTIVITY LOG
-- ============================================================
create table if not exists public.activity_log (
  id          uuid default gen_random_uuid() primary key,
  project_id  uuid references public.projects(id) on delete cascade,
  user_id     uuid references public.profiles(id),
  action      text not null,
  entity_type text,
  entity_id   uuid,
  details     jsonb default '{}',
  created_at  timestamptz default now()
);
alter table public.activity_log enable row level security;

create policy "All authenticated can view activity"
  on public.activity_log for select using (auth.role() = 'authenticated');
create policy "System can insert activity"
  on public.activity_log for insert with check (auth.role() = 'authenticated');

-- ============================================================
-- NOTIFICATIONS
-- ============================================================
create table if not exists public.notifications (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references public.profiles(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  read        boolean default false,
  created_at  timestamptz default now()
);
alter table public.notifications enable row level security;

create policy "Users can view own notifications"
  on public.notifications for select using (user_id = auth.uid());
create policy "Users can mark own notifications read"
  on public.notifications for update using (user_id = auth.uid());
create policy "System can create notifications"
  on public.notifications for insert with check (true);

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
insert into storage.buckets (id, name, public) values ('documents', 'documents', false) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true) on conflict do nothing;

create policy "Authenticated users can upload documents"
  on storage.objects for insert with check (bucket_id = 'documents' and auth.role() = 'authenticated');
create policy "Authenticated users can view documents"
  on storage.objects for select using (bucket_id = 'documents' and auth.role() = 'authenticated');
create policy "Users can upload avatars"
  on storage.objects for insert with check (bucket_id = 'avatars' and auth.uid()::text = (storage.foldername(name))[1]);

-- ============================================================
-- SEED DATA (optional — run separately)
-- ============================================================
-- See: supabase/seed.sql
