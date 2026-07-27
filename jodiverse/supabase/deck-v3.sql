-- Deck v3: mutual gender/seeking filter + coarse distance bands.
-- Distance derives from geohash-cell prefix overlap — deliberately coarse
-- bands, never numbers, so positions can't be trilaterated.
-- Also: likes_you_count() — reveals ONLY the number of pending likers,
-- never identities (those require the future Gold edge function).
-- Safe to re-run.

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
    -- Mutual seeking filter. gender: 'woman'|'man'|'non-binary';
    -- seeking: 'women'|'men'|'everyone'. Non-binary shown via 'everyone'.
    and ('everyone' = any(me.seeking)
         or (t.gender = 'woman' and 'women' = any(me.seeking))
         or (t.gender = 'man'   and 'men'   = any(me.seeking)))
    and ('everyone' = any(t.seeking)
         or (me.gender = 'woman' and 'women' = any(t.seeking))
         or (me.gender = 'man'   and 'men'   = any(t.seeking)))
  order by random()          -- swap for the matching ranker in production
  limit least(limit_n, 50);
$$;

-- Count of people who liked me and whom I haven't swiped on yet.
-- Number only — identities stay structurally unreadable without Gold.
create or replace function likes_you_count() returns int
language sql security definer stable as $$
  select count(*)::int from swipes s
  where s.swipee = auth.uid()
    and s.direction in ('like', 'super')
    and not exists (select 1 from swipes r
      where r.swiper = auth.uid() and r.swipee = s.swiper);
$$;
