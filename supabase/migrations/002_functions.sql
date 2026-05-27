-- ============================================================
-- BuildChain Protocol — Database Functions
-- Run after 001_initial_schema.sql
-- ============================================================

-- Increment amount_drawn when a draw is funded
create or replace function public.increment_amount_drawn(p_project_id uuid, p_amount decimal)
returns void as $$
begin
  update public.projects
  set amount_drawn = amount_drawn + p_amount,
      updated_at = now()
  where id = p_project_id;
end;
$$ language plpgsql security definer;

-- Get project summary with draw stats
create or replace function public.get_project_summary(p_project_id uuid)
returns table (
  project_id uuid,
  total_draws bigint,
  funded_draws bigint,
  pending_draws bigint,
  total_funded decimal,
  docs_complete bigint,
  docs_total bigint
) as $$
begin
  return query
  select
    p.id,
    count(dr.id),
    count(dr.id) filter (where dr.status = 'funded'),
    count(dr.id) filter (where dr.status in ('pending', 'submitted')),
    coalesce(sum(dr.amount) filter (where dr.status = 'funded'), 0),
    count(d.id) filter (where d.status in ('approved', 'uploaded')),
    count(d.id) filter (where d.required = true)
  from public.projects p
  left join public.draw_requests dr on dr.project_id = p.id
  left join public.documents d on d.project_id = p.id
  where p.id = p_project_id
  group by p.id;
end;
$$ language plpgsql security definer;

-- Auto-notify lender when draw is submitted
create or replace function public.notify_on_draw_submit()
returns trigger as $$
declare
  v_lender_profile_id uuid;
  v_project_name text;
begin
  if new.status = 'submitted' and (old.status = 'draft' or old is null) then
    select l.profile_id, p.name
    into v_lender_profile_id, v_project_name
    from public.projects p
    join public.lenders l on l.id = p.lender_id
    where p.id = new.project_id;

    if v_lender_profile_id is not null then
      insert into public.notifications (user_id, type, title, body, link)
      values (
        v_lender_profile_id,
        'draw_submitted',
        'New Draw Request — ' || coalesce(new.request_number, 'pending'),
        v_project_name || ' · $' || to_char(new.amount, 'FM999,999,999'),
        '/lender/approvals'
      );
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_draw_submitted
  after insert or update on public.draw_requests
  for each row execute procedure public.notify_on_draw_submit();

-- Notify borrower when draw is funded or declined
create or replace function public.notify_on_draw_decision()
returns trigger as $$
declare
  v_borrower_profile_id uuid;
  v_project_name text;
begin
  if new.status in ('funded', 'declined') and old.status != new.status then
    select b.profile_id, p.name
    into v_borrower_profile_id, v_project_name
    from public.projects p
    join public.borrowers b on b.id = p.borrower_id
    where p.id = new.project_id;

    if v_borrower_profile_id is not null then
      insert into public.notifications (user_id, type, title, body, link)
      values (
        v_borrower_profile_id,
        'draw_' || new.status,
        'Draw ' || initcap(new.status) || ' — ' || coalesce(new.request_number, ''),
        v_project_name || ' · $' || to_char(new.amount, 'FM999,999,999') ||
          case when new.status = 'declined' then ' · ' || coalesce(new.decline_reason, '') else '' end,
        '/borrower'
      );
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

create trigger on_draw_decision
  after update on public.draw_requests
  for each row execute procedure public.notify_on_draw_decision();
