-- Ranker v5 — Tinder-style scoring on top of the v4 filters. Safe to re-run.
-- Signals (weights tuned so no single one dominates):
--   1. DESIRABILITY  0–5 · smoothed right-swipe rate on the target
--      (likes+1)/(swipes+2) — Laplace smoothing so new profiles start mid-pack
--   2. ACTIVITY      0–3 · last_seen recency (today 3 · 3d 2 · 7d 1)
--   3. SELECTIVITY  -2/+1 · target's own like-rate: >90% = spam swiper (-2),
--      20–70% = considered swiper (+1); under 5 swipes = neutral
--   4. LOCATION      0–4 · geohash prefix proximity (unchanged from v4)
--   5. ENGAGEMENT    0–1 · has actually messaged their matches
--   plus: verified +2 · shared languages ≤2 · same faith +1 · new (<7d) +1

alter table profiles add column if not exists last_seen timestamptz;

drop function if exists get_deck(int);
create or replace function get_deck(limit_n int default 20)
returns table (
  id uuid, display_name text, age int, gender text, bio text, city text,
  faith text, languages text[], diet text, relationship_goal text,
  is_verified boolean, distance_band text
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
         end as distance_band
  from public_profiles p
  join profiles me on me.id = auth.uid()
  join profiles t  on t.id  = p.id
  where p.id <> auth.uid()
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
      -- 1. desirability: smoothed right-swipe rate on the target, 0–5
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
      -- profile-quality & compatibility extras (from v4)
    + (case when t.is_verified then 2 else 0 end)
    + least(2, (select count(*)::int from unnest(coalesce(me.languages, '{}')) l
                where l = any(coalesce(t.languages, '{}'))))
    + (case when me.faith is not null and me.faith = t.faith then 1 else 0 end)
    + (case when t.created_at > now() - interval '7 days' then 1 else 0 end)
  ) desc, random()
  limit least(limit_n, 50);
$$;
