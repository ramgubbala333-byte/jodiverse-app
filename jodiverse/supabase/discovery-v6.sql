-- Discovery v6 — supersedes ranker-v5.sql (includes everything from it).
-- Adds: user discovery preferences (age range, max distance, pause),
-- "recently active" flag in the deck, the v5 Tinder-style ranker,
-- UNLIMITED chat between matches (3-msg rule dropped), and Super Comments
-- (a note attached to a super like, delivered as the first chat message
-- when the match forms).
-- Safe to re-run.

-- ── matches chat freely: drop the per-match message cap ──────────────────
drop trigger if exists trg_message_limit on messages;
drop function if exists enforce_message_limit();

-- ── super comments: carry swipe notes into the chat on match ─────────────
create or replace function make_match() returns trigger
language plpgsql security definer as $$
declare mid uuid;
begin
  if new.direction in ('like','super') and exists (
    select 1 from swipes
    where swiper = new.swipee and swipee = new.swiper
      and direction in ('like','super'))
  then
    insert into matches (a, b)
    values (least(new.swiper, new.swipee), greatest(new.swiper, new.swipee))
    on conflict do nothing
    returning id into mid;
    if mid is not null then
      insert into messages (match_id, sender, body)
      select mid, s.swiper, '★ ' || s.note
      from swipes s
      where s.note is not null
        and ((s.swiper = new.swiper and s.swipee = new.swipee)
          or (s.swiper = new.swipee and s.swipee = new.swiper));
    end if;
  end if;
  return new;
end $$;
-- (trigger trg_make_match already points at make_match; replace is enough)

alter table profiles add column if not exists last_seen timestamptz;
alter table profiles add column if not exists pref_age_min int not null default 18;
alter table profiles add column if not exists pref_age_max int not null default 99;
-- 0 = any distance · 3 ≈ within ~80km · 4 ≈ ~20km · 5 ≈ ~5km · 6 ≈ nearby
alter table profiles add column if not exists pref_distance int not null default 0;
alter table profiles add column if not exists paused boolean not null default false;
-- Boost: 30-min visibility spike. Everyone starts with 1 credit;
-- Gold/Platinum renewals add one via the RevenueCat webhook.
alter table profiles add column if not exists boost_until timestamptz;
alter table profiles add column if not exists boost_credits int not null default 1;

-- ── activate a boost (consumes a credit) ─────────────────────────────────
create or replace function activate_boost() returns timestamptz
language plpgsql security definer as $$
declare bu timestamptz;
begin
  select boost_until into bu from profiles where id = auth.uid();
  if bu is not null and bu > now() then
    return bu;  -- already boosting; return current expiry
  end if;
  update profiles
    set boost_credits = boost_credits - 1,
        boost_until = now() + interval '30 minutes'
    where id = auth.uid() and boost_credits > 0
    returning boost_until into bu;
  if bu is null then
    raise exception 'NO_BOOST_CREDITS';
  end if;
  return bu;
end $$;

-- ── rewind last swipe (Plus+ feature) ────────────────────────────────────
create or replace function rewind_last_swipe() returns boolean
language plpgsql security definer as $$
begin
  if not has_active_sub(auth.uid()) then
    raise exception 'REWIND_REQUIRES_PLUS';
  end if;
  delete from swipes where swiper = auth.uid() and created_at = (
    select max(created_at) from swipes where swiper = auth.uid());
  return found;
end $$;

drop function if exists get_deck(int);
create or replace function get_deck(limit_n int default 20)
returns table (
  id uuid, display_name text, age int, gender text, bio text, city text,
  faith text, languages text[], diet text, relationship_goal text,
  is_verified boolean, distance_band text, recently_active boolean
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
         (t.last_seen > now() - interval '1 day') as recently_active
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
  ) desc, random()
  limit least(limit_n, 50);
$$;
