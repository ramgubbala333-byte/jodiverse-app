-- Offboarding v21 · run AFTER admin-analytics-v20.sql. Safe to re-run.
-- Captures WHY people leave (the "before you go" deflection flow) — churn
-- analytics you'll actually use. The row survives account deletion (user_id
-- set null on cascade) so the reason isn't lost with the account.

create table if not exists offboarding (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete set null,
  action      text not null,                 -- 'paused' | 'met_someone' | 'deleted'
  met_someone boolean not null default false,
  where_met   text,                          -- competitor attribution when they found someone
  created_at  timestamptz not null default now()
);
alter table offboarding enable row level security;
drop policy if exists "insert own offboard" on offboarding;
create policy "insert own offboard" on offboarding for insert
  with check (auth.uid() = user_id);
-- No select policy → only admins (via a definer function) can read churn data.

create or replace function log_offboard(p_action text, p_met boolean default false, p_where text default null)
returns void language sql security definer as $$
  insert into offboarding (user_id, action, met_someone, where_met)
  values (auth.uid(), p_action, coalesce(p_met, false), nullif(trim(coalesce(p_where,'')), ''));
$$;

-- Admin read (for the console's future "Churn" panel).
create or replace function admin_offboarding()
returns jsonb language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select jsonb_build_object(
    'deleted_total',  (select count(*) from offboarding where action = 'deleted'),
    'met_someone',    (select count(*) from offboarding where met_someone),
    'paused',         (select count(*) from offboarding where action = 'paused'),
    'where_met', (select coalesce(jsonb_object_agg(where_met, c), '{}')
                  from (select where_met, count(*)::int c from offboarding
                        where where_met is not null group by where_met) w)
  ) into r; return r;
end $$;
