-- Advanced features v25 · run AFTER compat-v24.sql. Safe to re-run.
-- Backend for the 4 features chosen from the market-research pass:
--   1. Structured PROMPTS on the profile (Hinge-style, replaces a raw bio blob)
--   2. match_reasons() — "Why you two matched" explanation
--   3. Unverified accounts limited to 1 message until the other replies
--   4. (Rewind / Super Like / Boost already exist server-side since
--      discovery-v6.sql / super-premium-v11.sql — no new SQL needed, just UI)

-- ── 1. Prompts ──────────────────────────────────────────────────────────────
-- Up to 3 {question, answer} pairs, shown as cards instead of/alongside bio.
alter table profiles add column if not exists prompts jsonb not null default '[]';
alter table profiles drop constraint if exists prompts_max_3;
alter table profiles add constraint prompts_max_3
  check (jsonb_array_length(prompts) <= 3);

-- Surface prompts through get_deck (interests-v8.sql) — APPENDS a column,
-- same function body otherwise, so the ranking logic is untouched.
drop function if exists get_deck(int);
create or replace function get_deck(limit_n int default 20)
returns table (
  id uuid, display_name text, age int, gender text, bio text, city text,
  faith text, languages text[], diet text, relationship_goal text,
  is_verified boolean, distance_band text, recently_active boolean,
  interests text[], new_here boolean, occupation text, prompts jsonb
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
         p.occupation,
         t.prompts
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
      (case when t.boost_until > now() then 50 else 0 end)
    +
      coalesce((select 5.0 * (count(*) filter (where sw.direction in ('like','super')) + 1)
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
  ) desc, random()
  limit least(limit_n, 50);
$$;

-- ── 2. Why you matched ───────────────────────────────────────────────────────
-- Called for an EXISTING match (both already opted in by liking each other) —
-- no eligibility check needed, just an honest explanation of the overlap.
-- Never uses appearance; only structured data both people already see.
create or replace function match_reasons(other uuid)
returns jsonb language plpgsql security definer stable as $$
declare
  me uuid := auth.uid();
  mp profiles%rowtype; tp profiles%rowtype;
  shared text[];
  shared_langs text[];
  compat_hits int := 0;
  sim numeric;
  reasons jsonb := '[]';
begin
  select * into mp from profiles where id = me;
  select * into tp from profiles where id = other;
  if mp.id is null or tp.id is null then return '[]'::jsonb; end if;

  select array_agg(i) into shared from unnest(coalesce(mp.interests, '{}')) i
    where i = any(coalesce(tp.interests, '{}'));
  select array_agg(l) into shared_langs from unnest(coalesce(mp.languages, '{}')) l
    where l = any(coalesce(tp.languages, '{}'));

  select
      (case when mp.compat->>'social'  = tp.compat->>'social'  then 1 else 0 end)
    + (case when mp.compat->>'vibe'    = tp.compat->>'vibe'    then 1 else 0 end)
    + (case when mp.compat->>'family'  = tp.compat->>'family'  then 1 else 0 end)
    + (case when mp.compat->>'clock'   = tp.compat->>'clock'   then 1 else 0 end)
    + (case when mp.compat->>'fitness' = tp.compat->>'fitness' then 1 else 0 end)
    + (case when mp.compat->>'weekend' = tp.compat->>'weekend' then 1 else 0 end)
  into compat_hits;

  sim := coalesce(interest_similarity(me, other), 0);

  -- Compatibility percentage (compat questionnaire overlap, 0-100)
  if mp.compat is not null and mp.compat != '{}' and tp.compat is not null and tp.compat != '{}' then
    reasons := reasons || jsonb_build_object(
      'icon', 'ads_click',
      'text', round(100.0 * compat_hits / 6.0) || '% compatibility on values & lifestyle');
  end if;

  -- Shared interests (up to 2 named)
  if coalesce(array_length(shared, 1), 0) >= 2 then
    reasons := reasons || jsonb_build_object('icon', 'music_note',
      'text', 'You both love ' || shared[1] || ' & ' || shared[2]);
  elsif coalesce(array_length(shared, 1), 0) = 1 then
    reasons := reasons || jsonb_build_object('icon', 'music_note',
      'text', 'You both love ' || shared[1]);
  end if;

  -- Specific compat callouts worth naming
  if mp.compat->>'clock' is not null and mp.compat->>'clock' = tp.compat->>'clock' then
    reasons := reasons || jsonb_build_object('icon', 'dark_mode',
      'text', case mp.compat->>'clock'
        when 'night' then 'Both night owls' when 'early' then 'Both early birds'
        else 'Same daily rhythm' end);
  end if;
  if mp.compat->>'family' is not null and mp.compat->>'family' = tp.compat->>'family' then
    reasons := reasons || jsonb_build_object('icon', 'forum',
      'text', 'Similar answers on family & long-term goals');
  end if;

  -- Shared languages
  if coalesce(array_length(shared_langs, 1), 0) > 0 then
    reasons := reasons || jsonb_build_object('icon', 'translate',
      'text', 'You both speak ' || shared_langs[1]);
  end if;

  -- Semantic similarity (embeddings) — only surface when meaningfully high
  if sim > 0.5 then
    reasons := reasons || jsonb_build_object('icon', 'auto_awesome',
      'text', 'Your profiles read a lot alike');
  end if;

  return reasons;
end $$;

-- ── 3. Unverified accounts: 1 message until the other replies ──────────────
-- Anti-catfish measure from the market research (Luxy's pattern). Verified
-- users are never restricted. A modded client can't bypass this — it's a
-- trigger, not a client-side check.
create or replace function enforce_unverified_limit() returns trigger
language plpgsql security definer as $$
declare sender_verified boolean; sent_count int; other_replied boolean;
begin
  select is_verified into sender_verified from profiles where id = new.sender;
  if sender_verified then return new; end if;

  select count(*) into sent_count from messages
    where match_id = new.match_id and sender = new.sender;
  select exists(select 1 from messages
    where match_id = new.match_id and sender <> new.sender) into other_replied;

  if sent_count >= 1 and not other_replied then
    raise exception 'UNVERIFIED_LIMIT';
  end if;
  return new;
end $$;
drop trigger if exists trg_unverified_limit on messages;
create trigger trg_unverified_limit before insert on messages
  for each row execute function enforce_unverified_limit();
