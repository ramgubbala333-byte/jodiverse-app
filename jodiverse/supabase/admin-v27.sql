-- Admin console + real match scoring · v27 · run AFTER dilmil-parity-v26.sql.
-- Safe to re-run. Two things in here:
--   A) match_score_pct() — a REAL compatibility number (section 0 below).
--      The UI was displaying a hardcoded 94% for every match.
--   B) The admin RPCs the dashboard needs (sections 1-8).
--
-- Replaces the old admin-v19/v20 RPCs, which are unusable now: they read
-- `calls`, `call_feedback` and `lounges` — all voice-era tables that were
-- deliberately excluded when the app pivoted back to a curated deck. Every
-- function here reads only tables that actually exist today, and adds the
-- metrics the current product cares about (likes, requests, prompts).
--
-- SECURITY: every function is `security definer` + gated on is_admin().
-- A non-admin calling these gets NOT_ADMIN, so the dashboard can safely run
-- on the public anon key — exactly like the mobile app does.

-- ═══ 0. REAL COMPATIBILITY SCORE ══════════════════════════════════════════
-- The match card showed a hardcoded "94%" to everyone, plus a static
-- "our AI notes a strong alignment…" paragraph — a claim about analysis that
-- never ran. This computes an actual number from data both people supplied.
--
-- Returns NULL (not a fake number) when there isn't enough signal to be
-- honest about — the client then hides the gauge entirely.
create or replace function match_score_pct(other uuid) returns int
language plpgsql security definer stable as $$
declare
  me uuid := auth.uid();
  mp profiles%rowtype; tp profiles%rowtype;
  pts numeric := 0; max_pts numeric := 0;
  shared_int int; shared_lang int; compat_hits int; compat_answered int;
  sim numeric;
begin
  select * into mp from profiles where id = me;
  select * into tp from profiles where id = other;
  if mp.id is null or tp.id is null then return null; end if;

  -- 1. Compatibility questionnaire (weight 40) — only counts questions BOTH
  --    people actually answered, so partial profiles aren't punished.
  select
      (case when mp.compat->>'social'  is not null and tp.compat->>'social'  is not null then 1 else 0 end)
    + (case when mp.compat->>'vibe'    is not null and tp.compat->>'vibe'    is not null then 1 else 0 end)
    + (case when mp.compat->>'family'  is not null and tp.compat->>'family'  is not null then 1 else 0 end)
    + (case when mp.compat->>'clock'   is not null and tp.compat->>'clock'   is not null then 1 else 0 end)
    + (case when mp.compat->>'fitness' is not null and tp.compat->>'fitness' is not null then 1 else 0 end)
    + (case when mp.compat->>'weekend' is not null and tp.compat->>'weekend' is not null then 1 else 0 end)
  into compat_answered;
  select
      (case when mp.compat->>'social'  = tp.compat->>'social'  then 1 else 0 end)
    + (case when mp.compat->>'vibe'    = tp.compat->>'vibe'    then 1 else 0 end)
    + (case when mp.compat->>'family'  = tp.compat->>'family'  then 1 else 0 end)
    + (case when mp.compat->>'clock'   = tp.compat->>'clock'   then 1 else 0 end)
    + (case when mp.compat->>'fitness' = tp.compat->>'fitness' then 1 else 0 end)
    + (case when mp.compat->>'weekend' = tp.compat->>'weekend' then 1 else 0 end)
  into compat_hits;
  if compat_answered > 0 then
    pts := pts + 40.0 * compat_hits / compat_answered;
    max_pts := max_pts + 40;
  end if;

  -- 2. Shared interests (weight 25) — 3+ in common reads as "a lot".
  select count(*) into shared_int from unnest(coalesce(mp.interests,'{}')) i
    where i = any(coalesce(tp.interests,'{}'));
  if coalesce(array_length(mp.interests,1),0) > 0
     and coalesce(array_length(tp.interests,1),0) > 0 then
    pts := pts + 25.0 * least(shared_int, 3) / 3.0;
    max_pts := max_pts + 25;
  end if;

  -- 3. Semantic similarity of what they wrote (weight 20)
  sim := coalesce(interest_similarity(me, other), 0);
  if sim > 0 then
    pts := pts + 20.0 * least(sim, 1.0);
    max_pts := max_pts + 20;
  end if;

  -- 4. Shared language (weight 10)
  select count(*) into shared_lang from unnest(coalesce(mp.languages,'{}')) l
    where l = any(coalesce(tp.languages,'{}'));
  if coalesce(array_length(mp.languages,1),0) > 0
     and coalesce(array_length(tp.languages,1),0) > 0 then
    pts := pts + (case when shared_lang > 0 then 10 else 0 end);
    max_pts := max_pts + 10;
  end if;

  -- 5. Same love language (weight 5)
  if mp.love_language is not null and tp.love_language is not null then
    pts := pts + (case when mp.love_language = tp.love_language then 5 else 0 end);
    max_pts := max_pts + 5;
  end if;

  -- Too little shared signal to make an honest claim.
  if max_pts < 30 then return null; end if;

  -- Floor at 50: these are already mutual matches, so a "12%" would be
  -- both discouraging and meaningless. Scale the real result into 50-99.
  return greatest(50, least(99, round(50 + 49.0 * pts / max_pts)::int));
end $$;

-- ═══ 1. ADMIN ALLOW-LIST ══════════════════════════════════════════════════
create table if not exists admins (
  user_id    uuid primary key references profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table admins enable row level security;
-- No client policy at all: membership is managed in the SQL editor only.

create or replace function is_admin() returns boolean
language sql security definer stable as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

-- Lets the dashboard show "you're not an admin" instead of a wall of errors.
create or replace function am_i_admin() returns boolean
language sql security definer stable as $$
  select is_admin();
$$;

-- ═══ 2. OVERVIEW ══════════════════════════════════════════════════════════
create or replace function admin_overview() returns jsonb
language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select jsonb_build_object(
    'users_total',      (select count(*) from profiles),
    'users_active',     (select count(*) from profiles where is_active),
    'users_verified',   (select count(*) from profiles where is_verified),
    'users_paused',     (select count(*) from profiles where paused),
    'new_7d',           (select count(*) from profiles where created_at > now() - interval '7 days'),
    'active_24h',       (select count(*) from profiles where last_seen > now() - interval '24 hours'),
    'swipes_total',     (select count(*) from swipes),
    'likes_24h',        (select count(*) from swipes
                          where direction in ('like','super') and created_at > now() - interval '24 hours'),
    'matches_total',    (select count(*) from matches where not unmatched),
    'matches_24h',      (select count(*) from matches
                          where not unmatched and created_at > now() - interval '24 hours'),
    'messages_total',   (select count(*) from messages),
    'messages_24h',     (select count(*) from messages where created_at > now() - interval '24 hours'),
    'requests_total',   (select count(*) from requests),
    'requests_pending', (select count(*) from requests where state = 'pending'),
    'reports_open',     (select count(*) from reports where not resolved),
    'subs_active',      (select count(*) from subscriptions where expires_at > now()),
    -- like→match conversion: what share of likes became mutual
    'match_rate', (
      select case when count(*) = 0 then null
        else round(100.0 * (select count(*) from matches where not unmatched) * 2
                   / nullif(count(*), 0), 1) end
      from swipes where direction in ('like','super'))
  ) into r; return r;
end $$;

-- ═══ 3. TIME SERIES (signups / matches / messages per day) ════════════════
drop function if exists admin_timeseries(int);
create or replace function admin_timeseries(days int default 30)
returns table (day date, signups int, matches int, messages int, likes int)
language sql security definer stable as $$
  select d::date,
    (select count(*)::int from profiles p where p.created_at::date = d::date),
    (select count(*)::int from matches m where m.created_at::date = d::date and not m.unmatched),
    (select count(*)::int from messages g where g.created_at::date = d::date),
    (select count(*)::int from swipes s where s.created_at::date = d::date
       and s.direction in ('like','super'))
  from generate_series(now() - (greatest(days,1) || ' days')::interval, now(), interval '1 day') d
  where is_admin()
  order by d;
$$;

-- ═══ 4. FUNNEL — where people drop off in onboarding ══════════════════════
create or replace function admin_funnel() returns jsonb
language plpgsql security definer stable as $$
declare r jsonb; total int;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select count(*) into total from profiles;
  select jsonb_build_object(
    'signed_up',     total,
    'has_photo',     (select count(distinct owner) from photos),
    'has_bio',       (select count(*) from profiles where bio is not null and bio <> ''),
    'has_prompts',   (select count(*) from profiles where jsonb_array_length(prompts) > 0),
    'has_traits',    (select count(*) from profiles where coalesce(array_length(traits,1),0) > 0),
    'has_interests', (select count(*) from profiles where coalesce(array_length(interests,1),0) > 0),
    'verified',      (select count(*) from profiles where is_verified),
    'active',        (select count(*) from profiles where is_active),
    'swiped_once',   (select count(distinct swiper) from swipes),
    'matched_once',  (select count(distinct u) from (
                        select a as u from matches where not unmatched
                        union select b from matches where not unmatched) x),
    'messaged_once', (select count(distinct sender) from messages)
  ) into r; return r;
end $$;

-- ═══ 5. DEMOGRAPHICS ══════════════════════════════════════════════════════
create or replace function admin_demographics() returns jsonb
language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select jsonb_build_object(
    'by_gender', (select coalesce(jsonb_object_agg(g, c), '{}') from (
      select coalesce(gender,'unknown') g, count(*)::int c from profiles group by 1) q),
    'by_age_band', (select coalesce(jsonb_object_agg(band, c), '{}') from (
      select case
        when date_part('year', age(birthdate)) < 22 then '18-21'
        when date_part('year', age(birthdate)) < 26 then '22-25'
        when date_part('year', age(birthdate)) < 31 then '26-30'
        when date_part('year', age(birthdate)) < 36 then '31-35'
        else '36+' end band, count(*)::int c
      from profiles group by 1) q),
    'by_city', (select coalesce(jsonb_object_agg(city, c), '{}') from (
      select city, count(*)::int c from profiles
      where city is not null and city <> '' group by 1 order by c desc limit 12) q),
    'by_goal', (select coalesce(jsonb_object_agg(goal, c), '{}') from (
      select relationship_goal goal, count(*)::int c from profiles
      where relationship_goal is not null group by 1) q),
    'by_love_language', (select coalesce(jsonb_object_agg(ll, c), '{}') from (
      select love_language ll, count(*)::int c from profiles
      where love_language is not null group by 1) q)
  ) into r; return r;
end $$;

-- ═══ 6. MODERATION ════════════════════════════════════════════════════════
drop function if exists admin_recent_reports(int);
create or replace function admin_recent_reports(lim int default 40)
returns table (id uuid, reason text, detail text, created_at timestamptz,
               resolved boolean, reporter_name text, reported_name text,
               reported_id uuid, reported_count int)
language sql security definer stable as $$
  select r.id, r.reason, r.detail, r.created_at, r.resolved,
         pr.display_name, pd.display_name, r.reported,
         (select count(*)::int from reports r2 where r2.reported = r.reported)
  from reports r
  left join profiles pr on pr.id = r.reporter
  left join profiles pd on pd.id = r.reported
  where is_admin()
  order by r.resolved asc, r.created_at desc
  limit greatest(lim, 1);
$$;

create or replace function admin_reports_by_reason() returns jsonb
language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select coalesce(jsonb_object_agg(reason, c), '{}') into r
  from (select reason, count(*)::int c from reports group by 1 order by c desc) q;
  return r;
end $$;

create or replace function admin_resolve_report(p_id uuid) returns void
language plpgsql security definer as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  update reports set resolved = true where id = p_id;
end $$;

-- ═══ 7. CHURN (why people leave) ══════════════════════════════════════════
create or replace function admin_offboarding() returns jsonb
language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select jsonb_build_object(
    'deleted_total', (select count(*) from offboarding where action = 'deleted'),
    'met_someone',   (select count(*) from offboarding where met_someone),
    'paused',        (select count(*) from offboarding where action = 'paused'),
    'where_met', (select coalesce(jsonb_object_agg(where_met, c), '{}')
                  from (select where_met, count(*)::int c from offboarding
                        where where_met is not null group by 1) w)
  ) into r; return r;
end $$;

-- ═══ 8. ENGAGEMENT HEALTH ═════════════════════════════════════════════════
-- The numbers that actually tell you if the product is working.
create or replace function admin_engagement() returns jsonb
language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select jsonb_build_object(
    -- matches that produced at least one message
    'matches_with_chat_pct', (
      select case when count(*) = 0 then null else
        round(100.0 * count(*) filter (where has_msg) / count(*), 1) end
      from (select m.id, exists (select 1 from messages g where g.match_id = m.id) has_msg
            from matches m where not m.unmatched) q),
    -- requests that got accepted
    'request_accept_pct', (
      select case when count(*) = 0 then null else
        round(100.0 * count(*) filter (where state = 'accepted') / count(*), 1) end
      from requests where state <> 'pending'),
    'avg_photos', (
      select round(avg(c), 1) from (
        select count(*)::int c from photos group by owner) q),
    'avg_messages_per_match', (
      select round(avg(c), 1) from (
        select count(*)::int c from messages group by match_id) q),
    -- how lopsided is attention? share of all likes going to the top 10%
    'top10pct_like_share', (
      select case when sum(cnt) = 0 then null else
        round(100.0 * sum(cnt) filter (where rn <= greatest(1, (select count(*) from profiles where is_active) / 10))
              / nullif(sum(cnt), 0), 1) end
      from (
        select p.id, (select count(*) from swipes s
                      where s.swipee = p.id and s.direction in ('like','super')) cnt,
               row_number() over (order by (select count(*) from swipes s2
                      where s2.swipee = p.id and s2.direction in ('like','super')) desc) rn
        from profiles p where p.is_active) q)
  ) into r; return r;
end $$;
