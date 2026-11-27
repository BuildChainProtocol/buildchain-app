-- 022: close access that was open to any signed-in user (or to anyone).
--
-- Found by reading the live database's rules on 2026-11-27:
--   1. The documents storage bucket let ANY signed-in user read and upload
--      every loan document.
--   2. increment_amount_drawn() and get_project_summary() are SECURITY DEFINER
--      and could be called by anyone, signed in or not, for any project.
--   3. Any signed-in user could insert a document row, a notification for any
--      other user, and an audit-log row for any project.
--   4. Signed-in (and signed-out) roles held TRUNCATE on several tables.

-- ── Who is a party to a project ──────────────────────────────────────────────
-- An admin, the project's lender, or the project's borrower. SECURITY DEFINER
-- so policies on other tables can ask without recursing through projects.
create or replace function public.is_project_party(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    or exists (select 1 from projects p join lenders l on l.id = p.lender_id
               where p.id = p_project_id and l.profile_id = auth.uid())
    or exists (select 1 from projects p join borrowers b on b.id = p.borrower_id
               where p.id = p_project_id and b.profile_id = auth.uid()))
$$;

-- The same, from a storage path's first folder ("<project id>/<file>").
create or replace function public.is_project_party_path(p_folder text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_folder is null or p_folder !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    return false;
  end if;
  return public.is_project_party(p_folder::uuid);
end;
$$;

-- Does the signed-in user share a project with this other user (or is an admin)?
create or replace function public.shares_project_with(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and (
    p_user = auth.uid()
    or exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    or exists (
      select 1
      from projects p
      left join lenders l on l.id = p.lender_id
      left join borrowers b on b.id = p.borrower_id
      where auth.uid() in (l.profile_id, b.profile_id)
        and p_user in (l.profile_id, b.profile_id)))
$$;

grant execute on function public.is_project_party(uuid) to anon, authenticated, service_role;
grant execute on function public.is_project_party_path(text) to anon, authenticated, service_role;
grant execute on function public.shares_project_with(uuid) to anon, authenticated, service_role;

-- ── 1. Loan documents in storage ─────────────────────────────────────────────
drop policy if exists "Authenticated users can view documents" on storage.objects;
drop policy if exists "Authenticated users can upload documents" on storage.objects;

create policy "Project parties can view documents" on storage.objects
  for select using (
    bucket_id = 'documents' and public.is_project_party_path((storage.foldername(name))[1]));

create policy "Project parties can upload documents" on storage.objects
  for insert with check (
    bucket_id = 'documents' and public.is_project_party_path((storage.foldername(name))[1]));

-- 25 MB a file, and only the kinds of file a loan file holds.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array[
      'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv', 'text/plain']
where id = 'documents';

-- ── 2. Functions anyone could call ───────────────────────────────────────────
create or replace function public.increment_amount_drawn(p_project_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Only the server, an admin, or the project's lender records a funded draw.
  if coalesce(auth.role(), '') <> 'service_role'
     and not exists (select 1 from profiles where id = auth.uid() and role = 'admin')
     and not exists (select 1 from projects p join lenders l on l.id = p.lender_id
                     where p.id = p_project_id and l.profile_id = auth.uid()) then
    raise exception 'Not allowed to change this project''s drawn amount';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'The drawn amount must be positive';
  end if;

  update public.projects
  set amount_drawn = amount_drawn + p_amount,
      updated_at = now()
  where id = p_project_id;
end;
$$;

revoke all on function public.increment_amount_drawn(uuid, numeric) from public, anon;
grant execute on function public.increment_amount_drawn(uuid, numeric) to authenticated, service_role;

-- A project summary only for the project's parties (and the server).
alter function public.get_project_summary(uuid) security invoker;
alter function public.get_project_summary(uuid) set search_path = public;
revoke all on function public.get_project_summary(uuid) from public, anon;
grant execute on function public.get_project_summary(uuid) to authenticated, service_role;

-- Trigger functions are run by their triggers, never called directly.
alter function public.generate_draw_number() set search_path = public;
alter function public.notify_on_draw_submit() set search_path = public;
alter function public.notify_on_draw_decision() set search_path = public;
revoke all on function public.generate_draw_number() from public, anon, authenticated;
revoke all on function public.notify_on_draw_submit() from public, anon, authenticated;
revoke all on function public.notify_on_draw_decision() from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.profiles_guard_role() from public, anon, authenticated;

-- ── 3. Rows any signed-in user could insert ──────────────────────────────────
drop policy if exists "Authenticated can upload documents" on public.documents;
create policy "Project parties can add documents" on public.documents
  for insert with check (public.is_project_party(project_id));

drop policy if exists "System can create notifications" on public.notifications;
create policy "Notify yourself or someone on a shared project" on public.notifications
  for insert with check (public.shares_project_with(user_id));

drop policy if exists "System can insert activity" on public.activity_log;
create policy "Log your own activity on your projects" on public.activity_log
  for insert with check (
    auth.uid() is not null
    and (user_id is null or user_id = auth.uid())
    and (project_id is null or public.is_project_party(project_id)));

-- ── 4. Privileges nobody using the site needs ────────────────────────────────
revoke truncate, references, trigger on all tables in schema public from anon, authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from anon, authenticated;
