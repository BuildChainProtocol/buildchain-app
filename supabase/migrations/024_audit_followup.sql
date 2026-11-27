-- 024: gaps a second audit found after 019-023.

-- ── 1. Only the server records a funded draw ─────────────────────────────────
-- 022 still let a project's lender call increment_amount_drawn() directly and
-- inflate the loan's drawn total. Both callers in the site use the service key.
create or replace function public.increment_amount_drawn(p_project_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not (auth.uid() is null and session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Only the server records a funded draw';
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

revoke all on function public.increment_amount_drawn(uuid, numeric) from public, anon, authenticated;
grant execute on function public.increment_amount_drawn(uuid, numeric) to service_role;

-- ── 2. A new draw keeps ONLY what a borrower may set ─────────────────────────
-- 023 blanked a list of server-owned columns on a signed-in insert. A list of
-- what to blank misses any column added later, so this version keeps a list
-- of what is allowed and drops everything else.
create or replace function public.draw_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  editable constant text[] := array[
    'amount', 'gross_amount', 'net_amount', 'retainage_rate', 'retainage_held',
    'purpose', 'phase', 'description', 'status', 'submitted_at', 'updated_at'];
  -- On insert: the editable fields, plus what identifies the row.
  insertable constant text[] := editable || array['id', 'project_id', 'request_number', 'currency', 'created_at'];
  kept jsonb;
begin
  if coalesce(auth.role(), '') = 'service_role'
     or (auth.uid() is null and session_user in ('postgres', 'supabase_admin')) then
    return new;
  end if;

  if new.amount is null or new.amount <= 0 then
    raise exception 'A draw needs a positive amount';
  end if;
  if new.net_amount is not null and (new.net_amount <= 0 or new.net_amount > new.amount) then
    raise exception 'The net amount must be positive and no more than the draw amount';
  end if;

  if tg_op = 'INSERT' then
    if new.status is null or new.status not in ('draft', 'submitted') then
      new.status := 'submitted';
    end if;
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into kept
    from jsonb_each(to_jsonb(new)) where key = any(insertable);
    new := jsonb_populate_record(
      null::public.draw_requests,
      kept || jsonb_build_object('submitted_by', auth.uid(), 'inspection_done', false, 'lien_waiver', false));
    return new;
  end if;

  -- UPDATE: a borrower may edit a draft and submit it. Nothing else.
  if old.status <> 'draft' then
    raise exception 'Only the server changes a draw once it is submitted';
  end if;
  if new.status not in ('draft', 'submitted') then
    raise exception 'A draft can only be saved or submitted';
  end if;
  if (to_jsonb(new) - editable) is distinct from (to_jsonb(old) - editable) then
    raise exception 'That part of a draw is set by the server';
  end if;
  return new;
end;
$$;

revoke all on function public.draw_requests_guard() from public, anon, authenticated;

-- ── 3. A document's uploader cannot approve it or move it to another loan ────
-- The update policy let an uploader change any column of their own document.
create or replace function public.documents_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') = 'service_role'
     or (auth.uid() is null and session_user in ('postgres', 'supabase_admin'))
     or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin') then
    return new;
  end if;
  if new.project_id is distinct from old.project_id
     or new.draw_request_id is distinct from old.draw_request_id
     or new.uploaded_by is distinct from old.uploaded_by
     or new.reviewed_by is distinct from old.reviewed_by
     or new.required is distinct from old.required then
    raise exception 'That part of a document is set by an admin';
  end if;
  if new.status is distinct from old.status and new.status not in ('uploaded', 'required') then
    raise exception 'A document is approved or rejected by its reviewer, not its uploader';
  end if;
  return new;
end;
$$;

revoke all on function public.documents_guard() from public, anon, authenticated;

drop trigger if exists documents_guard on public.documents;
create trigger documents_guard
  before update on public.documents
  for each row execute function public.documents_guard();

-- ── 4. Audit-log rows with no project come only from an admin or the server ──
drop policy if exists "Log your own activity on your projects" on public.activity_log;
create policy "Log your own activity on your projects" on public.activity_log
  for insert with check (
    auth.uid() is not null
    and (user_id is null or user_id = auth.uid())
    and (
      (project_id is not null and public.is_project_party(project_id))
      or exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')));
