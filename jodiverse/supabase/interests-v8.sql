-- Interests + "New here" v8 · run AFTER chat-media-v7.sql. Safe to re-run.
-- Adds: selectable interests on profiles (shown as chips, used by the
-- ranker to surface compatible people), drinking/smoking habits + height
-- for the "My basics" section, a coarse "last online" status (never the
-- raw timestamp), and a "New here" badge for profiles created in the
-- last 14 days.

-- ── interests + basics on profiles ───────────────────────────────────────
alter table profiles add column if not exists interests text[] not null default '{}';
alter table profiles add column if not exists drinking text;
alter table profiles add column if not exists smoking text;
alter table profiles add column if not exists height_cm int;
alter table profiles add column if not exists occupation text;
-- Intro media: storage paths in the private 'photos' bucket under
-- <uid>/intro-video.mp4 and <uid>/intro-audio.m4a — served via signed URLs,
-- readable by others through the existing "read active users photos" policy.
alter table profiles add column if not exists video_path text;
alter table profiles add column if not exists audio_path text;
-- Privacy: users can hide their "last active" status entirely.
alter table profiles add column if not exists show_last_active boolean not null default true;
alter table profiles drop constraint if exists occupation_len;
alter table profiles add constraint occupation_len
  check (occupation is null or char_length(occupation) <= 60);
alter table profiles drop constraint if exists height_cm_sane;
alter table profiles add constraint height_cm_sane
  check (height_cm is null or height_cm between 100 and 250);
alter table profiles drop constraint if exists interests_max_10;
alter table profiles add constraint interests_max_10
  check (coalesce(array_length(interests, 1), 0) <= 10);

-- ── expose interests + new_here through the public view ──────────────────
-- create or replace only APPENDS columns, so existing selects keep working.
create or replace view public_profiles with (security_invoker = off) as
  select id, display_name,
         date_part('year', age(birthdate))::int as age,
         gender, bio, city, faith, languages, diet,
         relationship_goal, is_verified,
         interests,
         (created_at > now() - interval '14 days') as new_here,
         drinking, smoking, height_cm, occupation,
         -- Coarse activity buckets only — exposing exact last_seen would
         -- enable stalking-grade surveillance of when someone opens the app.
         case
           when not show_last_active then null
           when last_seen > now() - interval '15 minutes' then 'Online'
           when last_seen > now() - interval '24 hours'   then 'Active today'
           when last_seen > now() - interval '7 days'     then 'Active this week'
           else null
         end as activity_status,
         video_path, audio_path
  from profiles where is_active = true;

-- ── deck feed: carry the new fields + rank shared interests ──────────────
drop function if exists get_deck(int);
create or replace function get_deck(limit_n int default 20)
returns table (
  id uuid, display_name text, age int, gender text, bio text, city text,
  faith text, languages text[], diet text, relationship_goal text,
  is_verified boolean, distance_band text, recently_active boolean,
  interests text[], new_here boolean, occupation text
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
         p.interests,
         p.new_here,
         p.occupation
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
  order by (
      -- 0. BOOST: boosted profiles jump the queue for 30 minutes
      (case when t.boost_until > now() then 50 else 0 end)
      -- 1. desirability: smoothed right-swipe rate on the target, 0–5
    +
      coalesce((select 5.0 * (count(*) filter (where sw.direction in ('like','super')) + 1)
                      / (count(*) + 2)
                from swipes sw where sw.swipee = t.id), 2.5)
      -- 2. activity: recently-active profiles surface first
    + (case when t.last_seen > now() - interval '1 day'  then 3
            when t.last_seen > now() - interval '3 days' then 2
            when t.last_seen > now() - interval '7 days' then 1
            else 0 end)
      -- 3. selectivity: spam right-swipers sink, considered swipers rise
    + coalesce((select case
          when count(*) < 5 then 0
          when avg(case when sw2.direction in ('like','super') then 1.0 else 0.0 end) > 0.9 then -2
          when avg(case when sw2.direction in ('like','super') then 1.0 else 0.0 end) between 0.2 and 0.7 then 1
          else 0 end
        from swipes sw2 where sw2.swiper = t.id), 0)
      -- 4. location proximity (geohash prefix overlap)
    + (case
         when me.geo_cell is null or t.geo_cell is null then 0
         when left(me.geo_cell, 6) = left(t.geo_cell, 6) then 4
         when left(me.geo_cell, 5) = left(t.geo_cell, 5) then 3
         when left(me.geo_cell, 4) = left(t.geo_cell, 4) then 2
         when left(me.geo_cell, 3) = left(t.geo_cell, 3) then 1
         else 0 end)
      -- 5. engagement: replies to matches instead of collecting them
    + (case when exists (select 1 from messages msg where msg.sender = t.id) then 1 else 0 end)
      -- profile-quality & compatibility extras
    + (case when t.is_verified then 2 else 0 end)
    + least(2, (select count(*)::int from unnest(coalesce(me.languages, '{}')) l
                where l = any(coalesce(t.languages, '{}'))))
    + (case when me.faith is not null and me.faith = t.faith then 1 else 0 end)
    + (case when t.created_at > now() - interval '7 days' then 1 else 0 end)
      -- 6. shared interests: up to +3 for overlapping interest chips
    + least(3, (select count(*)::int from unnest(coalesce(me.interests, '{}')) i
                where i = any(coalesce(t.interests, '{}'))))
  ) desc, random()
  limit least(limit_n, 50);
$$;
