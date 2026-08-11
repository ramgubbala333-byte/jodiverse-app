-- Dil Mil parity v26 · run AFTER bootstrap-mobile-app.sql. Safe to re-run.
-- Adds the profile depth + features that make this competitive with (and
-- better than) Dil Mil, per the feature audit of healthyframework.com's review:
--   1. Profile fields: love language, personality traits, workout habit
--   2. Requests — message someone BEFORE matching (their headline feature)
--   3. Profile insights — likes received, avg age of admirers, popularity
--      percentile, response rate ("Dil Details" equivalent, but honest)
--   4. Gifts REMOVED (send_gift/gifts_sent dropped — user cut the feature)

-- ═══ 1. PROFILE DEPTH ══════════════════════════════════════════════════════
alter table profiles add column if not exists love_language text;
alter table profiles add column if not exists workout text;
-- Up to 6 self-selected personality traits (Dil Mil requires 3; we cap at 6).
alter table profiles add column if not exists traits text[] not null default '{}';
alter table profiles drop constraint if exists traits_max_6;
alter table profiles add constraint traits_max_6
  check (coalesce(array_length(traits, 1), 0) <= 6);

-- Discovery filters (all FREE — Dil Mil paywalls its "advanced" ones behind
-- VIP; filtering who YOU see costs us nothing, so gating it would be pure
-- hostility). null = no filter.
alter table profiles add column if not exists filter_faith text;
alter table profiles add column if not exists filter_language text;
alter table profiles add column if not exists filter_goal text;

-- Surface them publicly (view must be dropped — can't remove/reorder columns).
drop view if exists public_profiles cascade;
create view public_profiles with (security_invoker = off) as
  select id, display_name,
         date_part('year', age(birthdate))::int as age,
         gender, bio, city, faith, languages, diet,
         relationship_goal, is_verified,
         interests,
         (created_at > now() - interval '14 days') as new_here,
         drinking, smoking, height_cm, occupation,
         case
           when not show_last_active then null
           when last_seen > now() - interval '15 minutes' then 'Online'
           when last_seen > now() - interval '24 hours'   then 'Active today'
           when last_seen > now() - interval '7 days'     then 'Active this week'
           else null
         end as activity_status,
         video_path, audio_path,
         education, lifestyle,
         love_language, workout, traits, prompts
  from profiles where is_active = true;

-- ═══ 2. REQUESTS — message before matching ════════════════════════════════
-- Dil Mil's differentiator: send a note to someone you haven't matched with.
-- Rate-limited server-side (free: 1/day, subscriber: 10/day) so it can't
-- become a spam vector — the #1 complaint about this feature elsewhere.
create table if not exists requests (
  id         uuid primary key default gen_random_uuid(),
  sender     uuid not null references profiles(id) on delete cascade,
  recipient  uuid not null references profiles(id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 300),
  state      text not null default 'pending' check (state in ('pending','accepted','declined')),
  created_at timestamptz not null default now(),
  unique (sender, recipient)
);
create index if not exists requests_recipient_idx on requests (recipient, created_at desc);
alter table requests enable row level security;
-- You can read requests you sent OR received; you can only update ones sent TO you.
drop policy if exists "read own requests" on requests;
create policy "read own requests" on requests for select
  using (sender = auth.uid() or recipient = auth.uid());
drop policy if exists "respond to own requests" on requests;
create policy "respond to own requests" on requests for update
  using (recipient = auth.uid());

create or replace function daily_request_cap(uid uuid) returns int
language sql security definer stable as $$
  select case when has_active_sub(uid) then 10 else 1 end;
$$;

create or replace function requests_remaining() returns int
language sql security definer stable as $$
  select greatest(0, daily_request_cap(auth.uid()) - (
    select count(*)::int from requests
    where sender = auth.uid() and created_at > now() - interval '24 hours'));
$$;

-- Send a request. Blocked people, self-sends, duplicates and over-cap all
-- rejected server-side.
create or replace function send_request(p_to uuid, p_body text) returns jsonb
language plpgsql security definer as $$
declare me uuid := auth.uid();
begin
  if p_to = me then raise exception 'CANNOT_REQUEST_SELF'; end if;
  if not exists (select 1 from profiles where id = p_to and is_active) then
    raise exception 'NO_SUCH_USER';
  end if;
  if exists (select 1 from blocks
      where (blocker = me and blocked = p_to) or (blocker = p_to and blocked = me)) then
    raise exception 'BLOCKED';
  end if;
  if exists (select 1 from requests where sender = me and recipient = p_to) then
    raise exception 'ALREADY_REQUESTED';
  end if;
  if requests_remaining() <= 0 then raise exception 'REQUEST_LIMIT_REACHED'; end if;

  insert into requests (sender, recipient, body) values (me, p_to, trim(p_body));
  return jsonb_build_object('ok', true, 'remaining', requests_remaining());
end $$;

-- Incoming requests (with sender details) for the Requests inbox.
drop function if exists my_requests();
create or replace function my_requests()
returns table (id uuid, sender uuid, name text, age int, city text,
               body text, created_at timestamptz)
language sql security definer stable as $$
  select r.id, r.sender, p.display_name, p.age, p.city, r.body, r.created_at
  from requests r
  join public_profiles p on p.id = r.sender
  where r.recipient = auth.uid() and r.state = 'pending'
  order by r.created_at desc
  limit 50;
$$;

-- Accepting a request = a mutual like, which the existing trg_make_match
-- turns into a real match (and carries the request text in as the opener).
create or replace function respond_request(p_id uuid, p_accept boolean) returns jsonb
language plpgsql security definer as $$
declare me uuid := auth.uid(); r requests%rowtype;
begin
  select * into r from requests where id = p_id and recipient = me and state = 'pending';
  if not found then raise exception 'NO_SUCH_REQUEST'; end if;

  update requests set state = case when p_accept then 'accepted' else 'declined' end
   where id = p_id;

  if p_accept then
    -- Their like (carrying the request note as the opening message) + mine.
    insert into swipes (swiper, swipee, direction, note)
      values (r.sender, me, 'like', r.body)
      on conflict (swiper, swipee) do nothing;
    insert into swipes (swiper, swipee, direction)
      values (me, r.sender, 'like')
      on conflict (swiper, swipee) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'accepted', p_accept);
end $$;

-- ═══ 3. PROFILE INSIGHTS (honest "Dil Details") ═══════════════════════════
-- Everything here is real, computed data — no invented "astrological sign
-- that likes you most" style filler. Returns nulls/zeros gracefully when
-- there isn't enough data yet rather than fabricating a number.
create or replace function my_insights() returns jsonb
language sql security definer stable as $$
  select jsonb_build_object(
    -- likes received (people who liked me and I haven't acted on yet)
    'likes_received', (
      select count(*)::int from swipes s
      where s.swipee = auth.uid() and s.direction in ('like','super')),
    'pending_likes', (
      select count(*)::int from swipes s
      where s.swipee = auth.uid() and s.direction in ('like','super')
        and not exists (select 1 from swipes r
          where r.swiper = auth.uid() and r.swipee = s.swiper)),
    'requests_received', (
      select count(*)::int from requests where recipient = auth.uid() and state = 'pending'),
    'matches_total', (
      select count(*)::int from matches
      where (a = auth.uid() or b = auth.uid()) and not unmatched),
    -- average age of people who like me (null until at least 3, so a single
    -- liker's age can never be reverse-identified)
    'avg_admirer_age', (
      select case when count(*) >= 3 then round(avg(p.age))::int else null end
      from swipes s join public_profiles p on p.id = s.swiper
      where s.swipee = auth.uid() and s.direction in ('like','super')),
    -- popularity percentile: what share of active profiles got fewer likes
    'popularity_pct', (
      select case when count(*) < 5 then null else
        round(100.0 * count(*) filter (where cnt < me_cnt) / nullif(count(*), 0))::int
      end
      from (
        select p.id, (select count(*) from swipes s
                      where s.swipee = p.id and s.direction in ('like','super')) as cnt,
               (select count(*) from swipes s2
                where s2.swipee = auth.uid() and s2.direction in ('like','super')) as me_cnt
        from profiles p where p.is_active and p.id <> auth.uid()
      ) q),
    -- my reply rate: of matches where they messaged first, how often I replied
    'response_rate', (
      select case when count(*) = 0 then null else
        round(100.0 * count(*) filter (where replied) / count(*))::int end
      from (
        select m.id,
               exists (select 1 from messages mine
                       where mine.match_id = m.id and mine.sender = auth.uid()) as replied
        from matches m
        where (m.a = auth.uid() or m.b = auth.uid()) and not m.unmatched
          and exists (select 1 from messages them
                      where them.match_id = m.id and them.sender <> auth.uid())
      ) r),
    'profile_views_note', 'Views are not tracked — we do not sell attention metrics.'
  );
$$;

-- Public-facing stats for someone ELSE's profile card (what Dil Mil shows as
-- "response rate" / "cares about"). Only aggregate, never identifying.
create or replace function profile_stats(other uuid) returns jsonb
language sql security definer stable as $$
  select jsonb_build_object(
    'response_rate', (
      select case when count(*) = 0 then null else
        round(100.0 * count(*) filter (where replied) / count(*))::int end
      from (
        select m.id,
               exists (select 1 from messages mine
                       where mine.match_id = m.id and mine.sender = other) as replied
        from matches m
        where (m.a = other or m.b = other) and not m.unmatched
          and exists (select 1 from messages them
                      where them.match_id = m.id and them.sender <> other)
      ) r),
    'activity_status', (select activity_status from public_profiles where id = other),
    'love_language',   (select love_language from profiles where id = other),
    'traits',          (select coalesce(traits, '{}') from profiles where id = other)
  );
$$;

-- ═══ 4. get_deck — carry the new profile fields ═══════════════════════════
drop function if exists get_deck(int);
create or replace function get_deck(limit_n int default 20)
returns table (
  id uuid, display_name text, age int, gender text, bio text, city text,
  faith text, languages text[], diet text, relationship_goal text,
  is_verified boolean, distance_band text, recently_active boolean,
  interests text[], new_here boolean, occupation text, prompts jsonb,
  love_language text, workout text, traits text[], education text,
  height_cm int, drinking text, activity_status text
)
language sql security definer stable as $$
  select p.id, p.display_name, p.age, p.gender, p.bio, p.city, p.faith,
         p.languages, p.diet, p.relationship_goal, p.is_verified,
         case
           when me.geo_cell is null or t.geo_cell is null then null
           when left(me.geo_cell, 6) = left(t.geo_cell, 6) then 'Nearby'
           when left(me.geo_cell, 5) = left(t.geo_cell, 5) then 'Within ~5 km'
           when left(me.geo_cell, 4) = left(t.geo_cell, 4) then 'Within ~20 km'
           when left(me.geo_cell, 3) = left(t.geo_cell, 3) then 'Within ~80 km'
           when left(me.geo_cell, 2) = left(t.geo_cell, 2) then 'Within ~600 km'
           else 'Far away'
         end as distance_band,
         (t.last_seen > now() - interval '1 day' and t.show_last_active) as recently_active,
         p.interests, p.new_here, p.occupation, t.prompts,
         t.love_language, t.workout, coalesce(t.traits, '{}'), p.education,
         p.height_cm, p.drinking, p.activity_status
  from public_profiles p
  join profiles me on me.id = auth.uid()
  join profiles t  on t.id  = p.id
  where p.id <> auth.uid()
    and not t.paused
    and p.age between me.pref_age_min and me.pref_age_max
    and (me.pref_distance = 0
         or (me.geo_cell is not null and t.geo_cell is not null
             and left(me.geo_cell, me.pref_distance) = left(t.geo_cell, me.pref_distance)))
    and not exists (select 1 from swipes s
      where s.swiper = auth.uid() and s.swipee = p.id)
    and not exists (select 1 from blocks b
      where (b.blocker = auth.uid() and b.blocked = p.id)
         or (b.blocker = p.id and b.blocked = auth.uid()))
    and ('everyone' = any(me.seeking)
         or (t.gender = 'woman' and 'women' = any(me.seeking))
         or (t.gender = 'man'   and 'men'   = any(me.seeking)))
    and ('everyone' = any(t.seeking)
         or (me.gender = 'woman' and 'women' = any(t.seeking))
         or (me.gender = 'man'   and 'men'   = any(t.seeking)))
    -- optional discovery filters (null = show everyone)
    and (me.filter_faith    is null or p.faith = me.filter_faith)
    and (me.filter_goal     is null or p.relationship_goal = me.filter_goal)
    and (me.filter_language is null or me.filter_language = any(coalesce(p.languages, '{}')))
  order by (
      (case when t.boost_until > now() then 50 else 0 end)
    + coalesce((select 5.0 * (count(*) filter (where sw.direction in ('like','super')) + 1)
                      / (count(*) + 2)
                from swipes sw where sw.swipee = t.id), 2.5)
    + (case when t.last_seen > now() - interval '1 day'  then 3
            when t.last_seen > now() - interval '3 days' then 2
            when t.last_seen > now() - interval '7 days' then 1
            else 0 end)
    + coalesce((select case
          when count(*) < 5 then 0
          when avg(case when sw2.direction in ('like','super') then 1.0 else 0.0 end) > 0.9 then -2
          when avg(case when sw2.direction in ('like','super') then 1.0 else 0.0 end) between 0.2 and 0.7 then 1
          else 0 end
        from swipes sw2 where sw2.swiper = t.id), 0)
    + (case
         when me.geo_cell is null or t.geo_cell is null then 0
         when left(me.geo_cell, 6) = left(t.geo_cell, 6) then 4
         when left(me.geo_cell, 5) = left(t.geo_cell, 5) then 3
         when left(me.geo_cell, 4) = left(t.geo_cell, 4) then 2
         when left(me.geo_cell, 3) = left(t.geo_cell, 3) then 1
         else 0 end)
    + (case when exists (select 1 from messages msg where msg.sender = t.id) then 1 else 0 end)
    + (case when t.is_verified then 2 else 0 end)
    + least(2, (select count(*)::int from unnest(coalesce(me.languages, '{}')) l
                where l = any(coalesce(t.languages, '{}'))))
    + (case when me.faith is not null and me.faith = t.faith then 1 else 0 end)
    + (case when t.created_at > now() - interval '7 days' then 1 else 0 end)
    + least(3, (select count(*)::int from unnest(coalesce(me.interests, '{}')) i
                where i = any(coalesce(t.interests, '{}'))))
    -- NEW: shared love language / traits nudge compatible people up
    + (case when me.love_language is not null
              and me.love_language = t.love_language then 2 else 0 end)
    + least(2, (select count(*)::int from unnest(coalesce(me.traits, '{}')) tr
                where tr = any(coalesce(t.traits, '{}'))))
  ) desc, random()
  limit least(limit_n, 50);
$$;

-- ═══ 5. GIFTS REMOVED ═════════════════════════════════════════════════════
-- The gift/coin-spend feature was cut from the product. Drop the function
-- and its table so no client can call it and no dead data accumulates.
-- (coin_wallet / coin_ledger stay — coins still exist for boosts//cosmetics.)
drop function if exists send_gift(uuid, text, int, text);
drop table if exists gifts_sent;
