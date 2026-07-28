-- Admin analytics v20 · run AFTER admin-v19.sql. Safe to re-run.
-- Extra RPCs so the console can mirror every panel from the requested dashboard
-- design — but with REAL data / honest proxies only. Where the mockup shows an
-- ML system we don't have (fake-profile detection, billing-fraud ML), we surface
-- the closest real signal (reports, verification, subscriptions); the UI marks
-- the non-existent systems as "roadmap". All functions are admin-gated.

-- ── Moderation: reports grouped by reason ("top violation types") ─────────
create or replace function admin_reports_by_reason()
returns table (reason text, total int, open int)
language plpgsql security definer stable as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
    select r.reason, count(*)::int, count(*) filter (where not r.resolved)::int
    from reports r group by r.reason order by count(*) desc;
end $$;

-- Moderation: most-reported users ("high risk users") ─────────────────────
create or replace function admin_most_reported(lim int default 10)
returns table (user_id uuid, name text, verified boolean, reports int)
language plpgsql security definer stable as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
    select p.id, p.display_name, p.is_verified, count(*)::int
    from reports r join profiles p on p.id = r.reported
    group by p.id, p.display_name, p.is_verified
    order by count(*) desc limit greatest(lim, 1);
end $$;

-- ── Smart match quality (real feedback signals, not a fabricated score) ───
create or replace function admin_match_quality()
returns jsonb language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select jsonb_build_object(
    'matches_total',      (select count(*) from matches where not unmatched),
    'matches_7d',         (select count(*) from matches where not unmatched and created_at > now() - interval '7 days'),
    'calls_ended',        (select count(*) from calls where state = 'ended'),
    'match_rate_pct',     (select case when count(*) filter (where state = 'ended') > 0
                             then round(100.0 * (select count(*) from matches where not unmatched)
                                  / count(*) filter (where state = 'ended'), 1) else 0 end from calls),
    'avg_stars',          (select round(avg(stars), 2) from call_feedback where stars is not null),
    'talk_again_yes_pct', (select case when count(*) > 0
                             then round(100.0 * count(*) filter (where talk_again = 'yes') / count(*), 1)
                             else 0 end from call_feedback),
    'feedback_count',     (select count(*) from call_feedback),
    'completion_pct',     (select case when count(*) > 0
                             then round(100.0 * count(*) filter (where end_reason = 'completed') / count(*), 1)
                             else 0 end from calls where state = 'ended')
  ) into r; return r;
end $$;

-- ── Verification & risk (our real answer to "fake profile detection") ─────
create or replace function admin_verification()
returns jsonb language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select jsonb_build_object(
    'verified',       (select count(*) from profiles where is_verified),
    'unverified',     (select count(*) from profiles where not is_verified),
    'active',         (select count(*) from profiles where is_active),
    'inactive',       (select count(*) from profiles where not is_active),
    'total',          (select count(*) from profiles),
    'reported_users', (select count(distinct reported) from reports),
    'blocks',         (select count(*) from blocks)
  ) into r; return r;
end $$;

-- ── Audience: demographics (our real "localization"/"user behavior") ──────
create or replace function admin_demographics()
returns jsonb language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select jsonb_build_object(
    'gender', (select coalesce(jsonb_object_agg(gender, c), '{}')
               from (select gender, count(*)::int c from profiles group by gender) g),
    'age', jsonb_build_object(
      '18_24',  (select count(*) from profiles where date_part('year', age(birthdate)) between 18 and 24),
      '25_34',  (select count(*) from profiles where date_part('year', age(birthdate)) between 25 and 34),
      '35_44',  (select count(*) from profiles where date_part('year', age(birthdate)) between 35 and 44),
      '45_plus',(select count(*) from profiles where date_part('year', age(birthdate)) >= 45))
  ) into r; return r;
end $$;

create or replace function admin_by_language(lim int default 15)
returns table (language text, users int)
language plpgsql security definer stable as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
    select l, count(*)::int from profiles p, unnest(coalesce(p.languages, '{}')) l
    group by l order by count(*) desc limit greatest(lim, 1);
end $$;

create or replace function admin_by_city(lim int default 15)
returns table (city text, users int)
language plpgsql security definer stable as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
    select coalesce(nullif(trim(p.city), ''), 'Unknown'), count(*)::int
    from profiles p group by 1 order by 2 desc limit greatest(lim, 1);
end $$;

-- ── User behavior: calls by hour-of-day (24h engagement pattern) ──────────
create or replace function admin_calls_by_hour()
returns table (hour int, calls int)
language plpgsql security definer stable as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
    select h::int, coalesce((select count(*)::int from calls c
      where extract(hour from c.created_at)::int = h), 0)
    from generate_series(0, 23) h;
end $$;

-- ── Revenue (our real answer to "billing"; fraud ML is roadmap) ───────────
create or replace function admin_revenue()
returns jsonb language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select jsonb_build_object(
    'subs_active',       (select count(*) from subscriptions where expires_at > now()),
    'subs_by_tier',      (select coalesce(jsonb_object_agg(tier, c), '{}')
                          from (select tier, count(*)::int c from subscriptions
                                where expires_at > now() group by tier) t),
    'coins_total',       (select coalesce(sum(balance), 0) from coin_wallet),
    'gifts_sent',        (select count(*) from gifts_sent),
    'gifts_coins_spent', (select coalesce(sum(cost), 0) from gifts_sent)
  ) into r; return r;
end $$;
