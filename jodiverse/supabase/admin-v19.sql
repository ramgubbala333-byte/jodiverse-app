-- Admin dashboard v19 · run AFTER daily-picks-v18.sql. Safe to re-run.
-- Read-only analytics over REAL data, locked to an admin allowlist. Every
-- function is security-definer (bypasses RLS to aggregate) but refuses anyone
-- not in `admins`, so no regular user can ever read platform-wide stats.

-- ═══ 1. ADMIN ALLOWLIST ═══════════════════════════════════════════════════
create table if not exists admins (
  user_id  uuid primary key references profiles(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table admins enable row level security;   -- no policies → clients can't read it

create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- ⚠️ ADD YOURSELF AS ADMIN (run once, in the SQL editor, using YOUR login email):
--    insert into admins (user_id)
--    select id from auth.users where email = 'ram.gubbala333@gmail.com'
--    on conflict do nothing;

-- ═══ 2. OVERVIEW KPIs ═════════════════════════════════════════════════════
create or replace function admin_overview() returns jsonb
language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select jsonb_build_object(
    -- users
    'users_total',       (select count(*) from profiles),
    'users_new_today',   (select count(*) from profiles where created_at > now() - interval '24 hours'),
    'users_new_7d',      (select count(*) from profiles where created_at > now() - interval '7 days'),
    'users_verified',    (select count(*) from profiles where is_verified),
    'users_active_flag', (select count(*) from profiles where is_active),
    'users_embedded',    (select count(*) from profiles where interest_embedding is not null),
    -- activity (calls)
    'calls_total',       (select count(*) from calls where state = 'ended'),
    'calls_today',       (select count(*) from calls where created_at > now() - interval '24 hours'),
    'calls_7d',          (select count(*) from calls where created_at > now() - interval '7 days'),
    'calls_avg_min',     (select round(avg(duration_s) / 60.0, 1) from calls where state = 'ended' and duration_s > 0),
    'active_callers_7d', (select count(distinct u) from (
                            select caller u from calls where created_at > now() - interval '7 days'
                            union select callee from calls where created_at > now() - interval '7 days') x),
    -- connections
    'matches_total',     (select count(*) from matches where not unmatched),
    'matches_7d',        (select count(*) from matches where not unmatched and created_at > now() - interval '7 days'),
    'messages_total',    (select count(*) from messages),
    'messages_today',    (select count(*) from messages where created_at > now() - interval '24 hours'),
    -- trust & safety
    'reports_open',      (select count(*) from reports where not resolved),
    'reports_total',     (select count(*) from reports),
    -- money
    'subs_active',       (select count(*) from subscriptions where expires_at > now()),
    'coins_total',       (select coalesce(sum(balance), 0) from coin_wallet),
    'gifts_sent',        (select count(*) from gifts_sent),
    -- community
    'lounges_total',     (select count(*) from lounges),
    'generated_at',      now()
  ) into r;
  return r;
end $$;

-- ═══ 3. TIME SERIES (for charts) ══════════════════════════════════════════
create or replace function admin_timeseries(days int default 14)
returns table (day date, signups int, calls int, matches int)
language plpgsql security definer stable as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
  select d::date,
    (select count(*)::int from profiles p where p.created_at::date = d::date),
    (select count(*)::int from calls c    where c.created_at::date = d::date),
    (select count(*)::int from matches m   where m.created_at::date = d::date and not m.unmatched)
  from generate_series(current_date - (greatest(days,1) - 1), current_date, interval '1 day') d;
end $$;

-- ═══ 4. MODERATION QUEUE ══════════════════════════════════════════════════
create or replace function admin_recent_reports(lim int default 30)
returns table (id uuid, reporter_name text, reported_name text, reported_id uuid,
               reason text, detail text, created_at timestamptz, resolved boolean)
language plpgsql security definer stable as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
  select r.id, pr.display_name, pd.display_name, r.reported,
         r.reason, r.detail, r.created_at, r.resolved
  from reports r
  left join profiles pr on pr.id = r.reporter
  left join profiles pd on pd.id = r.reported
  order by r.resolved asc, r.created_at desc
  limit greatest(lim, 1);
end $$;

create or replace function admin_resolve_report(rid uuid) returns void
language plpgsql security definer as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  update reports set resolved = true where id = rid;
end $$;
