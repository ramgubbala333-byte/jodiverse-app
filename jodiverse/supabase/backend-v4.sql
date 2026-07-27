-- Backend v4: free-tier limits, matching ranker, unmatch, push tokens.
-- Safe to re-run. Run AFTER deck-v3.sql.

-- ── subscription helper ───────────────────────────────────────────────────
create or replace function has_active_sub(uid uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from subscriptions
    where user_id = uid and expires_at > now());
$$;

-- ── free-tier limit: 10 likes per rolling 24h (subscribers unlimited) ─────
create or replace function enforce_like_limit() returns trigger
language plpgsql security definer as $$
declare cnt int;
begin
  if new.direction in ('like','super') and not has_active_sub(new.swiper) then
    select count(*) into cnt from swipes
      where swiper = new.swiper and direction in ('like','super')
        and created_at > now() - interval '24 hours';
    if cnt >= 10 then
      raise exception 'LIKE_LIMIT_REACHED';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_like_limit on swipes;
create trigger trg_like_limit before insert on swipes
  for each row execute function enforce_like_limit();

-- UI helper: -1 = unlimited (subscriber)
create or replace function daily_likes_remaining() returns int
language sql security definer stable as $$
  select case when has_active_sub(auth.uid()) then -1
    else greatest(0, 10 - (select count(*)::int from swipes
      where swiper = auth.uid() and direction in ('like','super')
        and created_at > now() - interval '24 hours'))
  end;
$$;

-- ── free-tier limit: 3 messages per match per sender ──────────────────────
create or replace function enforce_message_limit() returns trigger
language plpgsql security definer as $$
declare cnt int;
begin
  if not has_active_sub(new.sender) then
    select count(*) into cnt from messages
      where match_id = new.match_id and sender = new.sender;
    if cnt >= 3 then
      raise exception 'MESSAGE_LIMIT_REACHED';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_message_limit on messages;
create trigger trg_message_limit before insert on messages
  for each row execute function enforce_message_limit();

-- ── unmatch (either side; silent, like blocking) ─────────────────────────
create or replace function unmatch(m uuid) returns void
language sql security definer as $$
  update matches set unmatched = true
  where id = m and (a = auth.uid() or b = auth.uid());
$$;

-- ── push tokens (Expo push; written by the app, read by edge functions) ──
create table if not exists push_tokens (
  user_id uuid primary key references profiles(id) on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);
alter table push_tokens enable row level security;
drop policy if exists "own token" on push_tokens;
create policy "own token" on push_tokens for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── get_deck v4: same filters + a real ranker ────────────────────────────
-- Score: verified +2 · shared languages up to +2 · same faith +1 ·
--        proximity 0–4 (geohash prefix) · new profile (<7d) +1.
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
      (case when t.is_verified then 2 else 0 end)
    + least(2, (select count(*)::int from unnest(coalesce(me.languages, '{}')) l
                where l = any(coalesce(t.languages, '{}'))))
    + (case when me.faith is not null and me.faith = t.faith then 1 else 0 end)
    + (case
         when me.geo_cell is null or t.geo_cell is null then 0
         when left(me.geo_cell, 6) = left(t.geo_cell, 6) then 4
         when left(me.geo_cell, 5) = left(t.geo_cell, 5) then 3
         when left(me.geo_cell, 4) = left(t.geo_cell, 4) then 2
         when left(me.geo_cell, 3) = left(t.geo_cell, 3) then 1
         else 0
       end)
    + (case when t.created_at > now() - interval '7 days' then 1 else 0 end)
  ) desc, random()
  limit least(limit_n, 50);
$$;
