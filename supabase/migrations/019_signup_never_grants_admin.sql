-- 019: a public sign-up can never make itself an admin.
--
-- handle_new_user() copied the role straight from the sign-up data, which the
-- person signing up controls. Anyone could send role = 'admin' and get a
-- profile with full admin access. From now on sign-up data may only choose
-- 'borrower' or 'lender'; anything else becomes 'borrower'. Admins are made
-- by an existing admin through /api/invite, which sets the role itself with
-- the service key.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  v_role := coalesce(new.raw_user_meta_data->>'role', 'borrower');
  if v_role not in ('borrower', 'lender') then
    v_role := 'borrower';
  end if;

  insert into public.profiles (id, email, role, full_name, company_name)
  values (
    new.id,
    new.email,
    v_role,
    coalesce(new.raw_user_meta_data->>'full_name', ''),
    coalesce(new.raw_user_meta_data->>'company_name', '')
  )
  on conflict (id) do nothing;

  if v_role = 'lender' then
    update public.lenders
    set profile_id = new.id
    where email = new.email
      and profile_id is null;
  end if;

  if v_role = 'borrower' then
    update public.borrowers
    set profile_id = new.id
    where email = new.email
      and profile_id is null;
  end if;

  return new;
end;
$$;

-- ── A signed-in user cannot change their own role ───────────────────────────
-- The own_profile_update policy lets a user update their own profile row, and
-- nothing stopped that update from setting role = 'admin'. This trigger lets
-- only the server (service key, or the database's own functions) or an
-- existing admin set or change a role.

create or replace function public.profiles_guard_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The server: service key, or code running as the database owner
  -- (handle_new_user above, migrations, the SQL editor).
  if coalesce(auth.role(), '') = 'service_role'
     or session_user in ('postgres', 'supabase_admin', 'supabase_auth_admin') and auth.uid() is null then
    return new;
  end if;

  -- An existing admin may set roles.
  if exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role is null or new.role not in ('borrower', 'lender') then
      raise exception 'A new profile can only be a borrower or a lender';
    end if;
  elsif new.role is distinct from old.role then
    raise exception 'A profile''s role can only be changed by an admin';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_guard_role on public.profiles;
create trigger profiles_guard_role
  before insert or update on public.profiles
  for each row execute function public.profiles_guard_role();

-- ── Lender and borrower records are not public to every signed-in user ──────
-- Both tables were readable by anyone with an account, and anyone can create
-- an account. Now: admins, the record's own user, and the other party on a
-- shared project. The checks live in SECURITY DEFINER functions because the
-- projects policy already reads these tables (a plain policy would recurse).

create or replace function public.can_see_borrower(p_borrower_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    or exists (select 1 from borrowers where id = p_borrower_id and profile_id = auth.uid())
    or exists (
      select 1 from projects p join lenders l on l.id = p.lender_id
      where p.borrower_id = p_borrower_id and l.profile_id = auth.uid())
$$;

create or replace function public.can_see_lender(p_lender_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (select 1 from profiles where id = auth.uid() and role = 'admin')
    or exists (select 1 from lenders where id = p_lender_id and profile_id = auth.uid())
    or exists (
      select 1 from projects p join borrowers b on b.id = p.borrower_id
      where p.lender_id = p_lender_id and b.profile_id = auth.uid())
$$;

revoke all on function public.can_see_borrower(uuid) from public, anon;
revoke all on function public.can_see_lender(uuid) from public, anon;
grant execute on function public.can_see_borrower(uuid) to authenticated, service_role;
grant execute on function public.can_see_lender(uuid) to authenticated, service_role;

drop policy if exists "Borrowers visible to authenticated users" on public.borrowers;
create policy "Borrowers visible to their parties" on public.borrowers
  for select using (public.can_see_borrower(id));

drop policy if exists "Lenders visible to authenticated users" on public.lenders;
create policy "Lenders visible to their parties" on public.lenders
  for select using (public.can_see_lender(id));
