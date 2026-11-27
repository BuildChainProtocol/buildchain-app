-- 023: only the server changes a draw's state, and sign-up cannot claim a record.
--
-- Row-level security decides WHICH rows a person may write, not which columns.
-- A lender could update any column of a draw on their project, and a borrower
-- could insert a draw with any column set, by calling the database directly
-- with their own sign-in. That let a borrower pre-set the lien-waiver release
-- condition, and a lender swap in a different signed transaction for BuildChain
-- to countersign. The site's routes now check the request and write with the
-- service key; this trigger refuses everything else.

create or replace function public.draw_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- What the borrower may set on a new draw or change on a draft.
  editable constant text[] := array[
    'amount', 'gross_amount', 'net_amount', 'retainage_rate', 'retainage_held',
    'purpose', 'phase', 'description', 'status', 'submitted_at', 'updated_at'];
begin
  -- The server: the service key, or the database's own functions and migrations.
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
    -- Everything the server owns starts empty, whatever was sent.
    new := jsonb_populate_record(
      new,
      jsonb_build_object(
        'submitted_by', auth.uid(),
        'approved_by', null, 'declined_by', null, 'decline_reason', null, 'hold_reason', null,
        'reviewed_at', null, 'reviewed_by_note', null, 'funded_at', null, 'wire_reference', null,
        'inspection_done', false, 'lien_waiver', false,
        'escrow_sequence', null, 'escrow_txn_hash', null, 'escrow_finish_hash', null,
        'escrow_finish_after', null, 'escrow_owner', null,
        'nft_token_id', null, 'nft_mint_hash', null,
        'lien_waiver_nft_id', null, 'lien_waiver_nft_hash', null, 'lien_waiver_nft_minted_at', null,
        'verification_receipt', null, 'bb_draw_id', null, 'idempotency_key', null,
        'gc_wallet', null, 'payees', null,
        'settlement_method', null, 'settlement_state', null, 'settlement_amount', null,
        'settlement_payee', null, 'release_ticket', null));
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

drop trigger if exists draw_requests_guard on public.draw_requests;
create trigger draw_requests_guard
  before insert or update on public.draw_requests
  for each row execute function public.draw_requests_guard();

-- ── Sign-up never claims a lender or borrower record ─────────────────────────
-- handle_new_user() linked a new account to the lender or borrower record with
-- the same email address. Anyone signing up with that address (which may not
-- even be confirmed) took the record over. Now only an account created by an
-- admin's invitation is linked; a public sign-up is linked by an admin.

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

  if new.invited_at is not null then
    if v_role = 'lender' then
      update public.lenders set profile_id = new.id
      where email = new.email and profile_id is null;
    end if;
    if v_role = 'borrower' then
      update public.borrowers set profile_id = new.id
      where email = new.email and profile_id is null;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
