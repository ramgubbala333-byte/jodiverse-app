-- ═══════════════════════════════════════════════════════════════════════════
-- BOOTSTRAP — everything the CURRENT mobile app needs, in one script.
--
-- Why this exists: the numbered migrations (schema.sql, backend-v4.sql, ...,
-- advanced-features-v25.sql) were written incrementally over months and
-- several pivots (swipe → voice-first → back to a curated deck). Running
-- them in order would build a lot of infrastructure for the voice-call
-- feature (calls, queue_entries, voice_profiles, lounges, conversation_traits,
-- reveal_state, talk_wallet...) that was fully REMOVED from the app's code.
--
-- This script instead creates ONLY what the app's client code (src/*.tsx,
-- App.tsx) actually calls today — pulling the final/authoritative version of
-- each table, view, function and trigger from wherever it last changed across
-- the 25 files, and skipping every voice/call/lounge-only object entirely.
--
-- Safe to re-run top to bottom (idempotent throughout).
-- Run this ONCE, instead of the individual v1–v25 files.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. Extensions ────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ── 1. profiles ──────────────────────────────────────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  birthdate date not null,
  gender text not null,
  seeking text[] not null default '{}',
  bio text check (char_length(bio) <= 500),
  city text,
  geo_cell text,                       -- ~1km cell only, never raw coordinates
  faith text,
  languages text[] default '{}',
  diet text,
  relationship_goal text,
  is_verified boolean not null default false,
  is_active boolean not null default false,   -- false until selfie-verified
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
drop policy if exists "read own profile" on profiles;
create policy "read own profile" on profiles for select using (auth.uid() = id);
drop policy if exists "insert own profile" on profiles;
create policy "insert own profile" on profiles for insert with check (auth.uid() = id);
drop policy if exists "update own profile" on profiles;
create policy "update own profile" on profiles for update using (auth.uid() = id);

-- is_active / is_verified may ONLY flip via the verification Edge Function
-- (service role) — never directly by the client.
create or replace function guard_verification_flags() returns trigger
language plpgsql as $$
begin
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and current_user <> 'postgres' then
    if tg_op = 'INSERT' then
      new.is_active := false;
      new.is_verified := false;
    else
      new.is_active := old.is_active;
      new.is_verified := old.is_verified;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_flags on profiles;
create trigger trg_guard_flags before insert or update on profiles
  for each row execute function guard_verification_flags();

-- discovery preferences + boost + activity (discovery-v6.sql / ranker-v5.sql)
alter table profiles add column if not exists last_seen timestamptz;
alter table profiles add column if not exists pref_age_min int not null default 18;
alter table profiles add column if not exists pref_age_max int not null default 99;
-- 0 = any distance · 3 ≈ ~80km · 4 ≈ ~20km · 5 ≈ ~5km · 6 ≈ nearby
alter table profiles add column if not exists pref_distance int not null default 0;
alter table profiles add column if not exists paused boolean not null default false;
alter table profiles add column if not exists boost_until timestamptz;
alter table profiles add column if not exists boost_credits int not null default 1;

-- interests + basics (interests-v8.sql)
alter table profiles add column if not exists interests text[] not null default '{}';
alter table profiles add column if not exists drinking text;
alter table profiles add column if not exists smoking text;
alter table profiles add column if not exists height_cm int;
alter table profiles add column if not exists occupation text;
alter table profiles add column if not exists video_path text;
alter table profiles add column if not exists audio_path text;
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

-- Smart Profile Builder fields (profile-builder-v10.sql)
alter table profiles add column if not exists education text;
alter table profiles add column if not exists values_text text;
alter table profiles add column if not exists fun_facts text;
alter table profiles add column if not exists lifestyle text;
alter table profiles drop constraint if exists education_len;
alter table profiles add constraint education_len
  check (education is null or char_length(education) <= 120);
alter table profiles drop constraint if exists values_text_len;
alter table profiles add constraint values_text_len
  check (values_text is null or char_length(values_text) <= 500);
alter table profiles drop constraint if exists fun_facts_len;
alter table profiles add constraint fun_facts_len
  check (fun_facts is null or char_length(fun_facts) <= 500);

-- semantic embeddings (semantic-matching-v17.sql) — needs pgvector, added above
alter table profiles add column if not exists interest_embedding vector(384);

-- referrals (growth-v22.sql)
alter table profiles add column if not exists referral_code text unique;

-- compatibility questionnaire (compat-v24.sql)
alter table profiles add column if not exists compat jsonb not null default '{}';

-- structured prompts (advanced-features-v25.sql)
alter table profiles add column if not exists prompts jsonb not null default '[]';
alter table profiles drop constraint if exists prompts_max_3;
alter table profiles add constraint prompts_max_3
  check (jsonb_array_length(prompts) <= 3);

-- ── 2. public_profiles view — final shape (profile-builder-v10.sql) ────────
-- DROP first: CREATE OR REPLACE VIEW can't change/remove existing columns,
-- only append — and this project already has an older/different version.
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
         education, lifestyle
  from profiles where is_active = true;

-- ── 3. photos ────────────────────────────────────────────────────────────
create table if not exists photos (
  id uuid primary key default uuid_generate_v4(),
  owner uuid not null references profiles(id) on delete cascade,
  storage_path text not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);
alter table photos enable row level security;
drop policy if exists "manage own photos" on photos;
create policy "manage own photos" on photos for all
  using (auth.uid() = owner) with check (auth.uid() = owner);

-- ── 4. swipes ────────────────────────────────────────────────────────────
create table if not exists swipes (
  swiper uuid not null references profiles(id) on delete cascade,
  swipee uuid not null references profiles(id) on delete cascade,
  direction text not null check (direction in ('like','pass','super')),
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  primary key (swiper, swipee)
);
alter table swipes enable row level security;
drop policy if exists "insert own swipes" on swipes;
create policy "insert own swipes" on swipes for insert
  with check (auth.uid() = swiper and swiper <> swipee);
drop policy if exists "read own swipes" on swipes;
create policy "read own swipes" on swipes for select using (auth.uid() = swiper);
-- Deliberately NO policy exposing who swiped on you — that's the `likes-you`
-- edge function's job (service-role only).

-- ── 5. matches (created by trigger on mutual like) ──────────────────────
create table if not exists matches (
  id uuid primary key default uuid_generate_v4(),
  a uuid not null references profiles(id) on delete cascade,
  b uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unmatched boolean not null default false,
  check (a < b),
  unique (a, b)
);
alter table matches enable row level security;
drop policy if exists "read own matches" on matches;
create policy "read own matches" on matches for select
  using (auth.uid() = a or auth.uid() = b);
drop policy if exists "unmatch" on matches;
create policy "unmatch" on matches for update
  using (auth.uid() = a or auth.uid() = b);

-- ── 6. blocks — invisible and mutual ────────────────────────────────────
create table if not exists blocks (
  blocker uuid not null references profiles(id) on delete cascade,
  blocked uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
alter table blocks enable row level security;
drop policy if exists "manage own blocks" on blocks;
create policy "manage own blocks" on blocks for all
  using (auth.uid() = blocker) with check (auth.uid() = blocker);

-- ── 7. messages (+ image_path from chat-media-v7.sql) ───────────────────
create table if not exists messages (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid not null references matches(id) on delete cascade,
  sender uuid not null references profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now(),
  image_path text
);
create index if not exists messages_match_created_idx on messages (match_id, created_at);
alter table messages enable row level security;

create or replace function is_in_match(m uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from matches
    where id = m and not unmatched and (a = auth.uid() or b = auth.uid())
      and not exists (select 1 from blocks
        where (blocker = a and blocked = b) or (blocker = b and blocked = a)));
$$;

drop policy if exists "read own conversations" on messages;
create policy "read own conversations" on messages for select
  using (is_in_match(match_id));
drop policy if exists "send in own conversations" on messages;
create policy "send in own conversations" on messages for insert
  with check (auth.uid() = sender and is_in_match(match_id));
drop policy if exists "mark read" on messages;
create policy "mark read" on messages for update
  using (is_in_match(match_id) and sender <> auth.uid());

-- Messaging is deliberately UNLIMITED between matches — no message-limit
-- trigger exists (intentional; dropped in discovery-v6.sql and never
-- recreated here). Monetization lives on likes/boosts/coins, not messages.

-- ── 8. reports ───────────────────────────────────────────────────────────
create table if not exists reports (
  id uuid primary key default uuid_generate_v4(),
  reporter uuid not null references profiles(id),
  reported uuid not null references profiles(id),
  reason text not null,
  detail text,
  created_at timestamptz not null default now(),
  resolved boolean not null default false
);
alter table reports enable row level security;
drop policy if exists "file reports" on reports;
create policy "file reports" on reports for insert with check (auth.uid() = reporter);

-- ── 9. subscriptions (written by the payment webhook, service role only) ──
create table if not exists subscriptions (
  user_id uuid primary key references profiles(id) on delete cascade,
  tier text not null check (tier in ('gold','platinum','eternal')),
  expires_at timestamptz not null
);
alter table subscriptions enable row level security;
drop policy if exists "read own subscription" on subscriptions;
create policy "read own subscription" on subscriptions for select
  using (auth.uid() = user_id);

-- ── 10. push_tokens ──────────────────────────────────────────────────────
create table if not exists push_tokens (
  user_id uuid primary key references profiles(id) on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);
alter table push_tokens enable row level security;
drop policy if exists "own token" on push_tokens;
create policy "own token" on push_tokens for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 11. has_active_sub() — needed by several triggers/functions below ────
create or replace function has_active_sub(uid uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from subscriptions
    where user_id = uid and expires_at > now());
$$;

-- ── 12. matching triggers on swipes ──────────────────────────────────────
-- make_match: creates the match row on mutual like, and carries a super-like
-- comment into the chat as the opening message (discovery-v6.sql body).
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
drop trigger if exists trg_make_match on swipes;
create trigger trg_make_match after insert on swipes
  for each row execute function make_match();

-- like limit: 50 per rolling 12h for free users (like-limit-v9.sql)
create or replace function enforce_like_limit() returns trigger
language plpgsql security definer as $$
declare cnt int;
begin
  if new.direction in ('like','super') and not has_active_sub(new.swiper) then
    select count(*) into cnt from swipes
      where swiper = new.swiper and direction in ('like','super')
        and created_at > now() - interval '12 hours';
    if cnt >= 50 then
      raise exception 'LIKE_LIMIT_REACHED';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_like_limit on swipes;
create trigger trg_like_limit before insert on swipes
  for each row execute function enforce_like_limit();

-- super like: premium only (super-premium-v11.sql)
create or replace function enforce_super_premium() returns trigger
language plpgsql security definer as $$
begin
  if new.direction = 'super' and not has_active_sub(new.swiper) then
    raise exception 'SUPER_REQUIRES_PREMIUM';
  end if;
  return new;
end $$;
drop trigger if exists trg_super_premium on swipes;
create trigger trg_super_premium before insert on swipes
  for each row execute function enforce_super_premium();

-- unverified accounts: 1 message until the other replies (advanced-features-v25.sql)
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

-- ── 13. rewind + boost (discovery-v6.sql) ───────────────────────────────
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

create or replace function activate_boost() returns timestamptz
language plpgsql security definer as $$
declare bu timestamptz;
begin
  select boost_until into bu from profiles where id = auth.uid();
  if bu is not null and bu > now() then
    return bu;
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

-- ── 14. unmatch (backend-v4.sql) ─────────────────────────────────────────
create or replace function unmatch(m uuid) returns void
language sql security definer as $$
  update matches set unmatched = true
  where id = m and (a = auth.uid() or b = auth.uid());
$$;

-- ── 15. stale_matches (lounges-antighost-v15.sql, no voice deps) ────────
-- Matches >24h old with zero messages + a shared interest, for the "say hi"
-- nudge in Chats.
-- DROP first: this project may already have an older version with a
-- different OUT-parameter shape, which CREATE OR REPLACE can't change.
drop function if exists stale_matches();
create or replace function stale_matches()
returns table (match_id uuid, other_id uuid, other_name text,
               shared_interest text, matched_at timestamptz)
language sql security definer stable as $$
  select m.id, o.id, o.display_name,
         (select i from unnest(coalesce(me.interests, '{}')) i
          where i = any(coalesce(o.interests, '{}')) limit 1),
         m.created_at
  from matches m
  join profiles me on me.id = auth.uid()
  join profiles o on o.id = (case when m.a = auth.uid() then m.b else m.a end)
  where (m.a = auth.uid() or m.b = auth.uid())
    and not m.unmatched
    and m.created_at < now() - interval '24 hours'
    and not exists (select 1 from messages msg where msg.match_id = m.id)
  order by m.created_at desc
  limit 5;
$$;

-- ── 16. get_deck() — final version (advanced-features-v25.sql) ─────────
-- DROP first: this project has an older get_deck(int) from a prior
-- migration with a different OUT-parameter shape (confirmed — this is the
-- exact error we hit). CREATE OR REPLACE can't change that shape.
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

-- ── 17. feedback → occasional free Boost (chat-media-v7.sql) ───────────
create table if not exists feedback (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now()
);
alter table feedback enable row level security;
drop policy if exists "own feedback" on feedback;
create policy "own feedback" on feedback for insert to authenticated
  with check (auth.uid() = user_id);

create or replace function submit_feedback(r int, c text default null) returns boolean
language plpgsql security definer as $$
declare lucky boolean := false;
declare recent boolean;
begin
  select exists (select 1 from feedback
    where user_id = auth.uid() and created_at > now() - interval '24 hours')
  into recent;
  insert into feedback (user_id, rating, comment) values (auth.uid(), r, c);
  if not recent then
    lucky := random() < 0.34;
    if lucky then
      update profiles set boost_credits = boost_credits + 1 where id = auth.uid();
    end if;
  end if;
  return lucky;
end $$;

-- ── 18. coins — cosmetic-only (monetization-pivot-v16.sql tables + ─────
--        coin-ledger-v23.sql functions, the final/authoritative versions)
create table if not exists coin_wallet (
  user_id    uuid primary key references profiles(id) on delete cascade,
  balance    int not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
alter table coin_wallet enable row level security;
drop policy if exists "read own coins" on coin_wallet;
create policy "read own coins" on coin_wallet for select using (user_id = auth.uid());

create table if not exists gifts_sent (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references matches(id) on delete cascade,
  sender     uuid not null references profiles(id) on delete cascade,
  receiver   uuid not null references profiles(id) on delete cascade,
  gift_key   text not null,
  cost       int not null check (cost > 0),
  created_at timestamptz not null default now()
);
alter table gifts_sent enable row level security;
drop policy if exists "read own gifts" on gifts_sent;
create policy "read own gifts" on gifts_sent for select
  using (sender = auth.uid() or receiver = auth.uid());

create table if not exists coin_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  delta         int  not null,
  reason        text not null,
  balance_after int  not null,
  created_at    timestamptz not null default now()
);
create index if not exists coin_ledger_user_idx on coin_ledger (user_id, created_at desc);
alter table coin_ledger enable row level security;
drop policy if exists "read own ledger" on coin_ledger;
create policy "read own ledger" on coin_ledger for select using (user_id = auth.uid());

create or replace function _credit_coins(p_uid uuid, p_delta int, p_reason text) returns int
language plpgsql security definer as $$
declare v_bal int;
begin
  insert into coin_wallet (user_id, balance) values (p_uid, greatest(p_delta, 0))
    on conflict (user_id) do update set balance = coin_wallet.balance + p_delta, updated_at = now();
  select balance into v_bal from coin_wallet where user_id = p_uid;
  insert into coin_ledger (user_id, delta, reason, balance_after)
    values (p_uid, p_delta, p_reason, v_bal);
  return v_bal;
end $$;

create or replace function my_coin_balance() returns int
language sql security definer stable as $$
  select coalesce((select balance from coin_wallet where user_id = auth.uid()), 0);
$$;

drop function if exists my_coin_ledger(int);
create or replace function my_coin_ledger(p_lim int default 60)
returns table (delta int, reason text, balance_after int, created_at timestamptz)
language sql security definer stable as $$
  select delta, reason, balance_after, created_at from coin_ledger
  where user_id = auth.uid() order by created_at desc limit greatest(p_lim, 1);
$$;

create or replace function grant_coins(amount int) returns int
language plpgsql security definer as $$
begin
  if amount is null or amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  return _credit_coins(auth.uid(), amount, 'purchase');
end $$;

-- ── 19. referrals + promo codes (growth-v22.sql tables/helpers, ────────
--        redeem functions from coin-ledger-v23.sql — route through the ledger)
create or replace function my_referral_code() returns text
language plpgsql security definer as $$
declare v text;
begin
  select referral_code into v from profiles where id = auth.uid();
  if v is null then
    loop
      v := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
      begin
        update profiles set referral_code = v where id = auth.uid();
        exit;
      exception when unique_violation then
      end;
    end loop;
  end if;
  return v;
end $$;

create table if not exists referrals (
  referrer   uuid not null references profiles(id) on delete cascade,
  referred   uuid primary key references profiles(id) on delete cascade,
  code       text,
  created_at timestamptz not null default now()
);
alter table referrals enable row level security;
drop policy if exists "read own referrals" on referrals;
create policy "read own referrals" on referrals for select
  using (referrer = auth.uid() or referred = auth.uid());

create or replace function referral_reward() returns int language sql immutable as $$ select 100 $$;

create or replace function referral_stats() returns jsonb
language sql security definer stable as $$
  select jsonb_build_object(
    'code',         (select referral_code from profiles where id = auth.uid()),
    'invites',      (select count(*) from referrals where referrer = auth.uid()),
    'coins_earned', (select count(*) * referral_reward() from referrals where referrer = auth.uid()),
    'reward',       referral_reward()
  );
$$;

create table if not exists promo_codes (
  code            text primary key,
  coins           int not null check (coins > 0),
  max_redemptions int,
  redemptions     int not null default 0,
  expires_at      timestamptz,
  active          boolean not null default true
);
alter table promo_codes enable row level security;

create table if not exists promo_redemptions (
  code       text not null,
  user_id    uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (code, user_id)
);
alter table promo_redemptions enable row level security;
drop policy if exists "read own redemptions" on promo_redemptions;
create policy "read own redemptions" on promo_redemptions for select using (user_id = auth.uid());

create or replace function redeem_promo(p_code text) returns jsonb
language plpgsql security definer as $$
declare me uuid := auth.uid(); c promo_codes%rowtype; v_code text := upper(trim(p_code)); v_bal int;
begin
  select * into c from promo_codes where upper(code) = v_code;
  if not found or not c.active then raise exception 'INVALID_CODE'; end if;
  if c.expires_at is not null and c.expires_at < now() then raise exception 'CODE_EXPIRED'; end if;
  if c.max_redemptions is not null and c.redemptions >= c.max_redemptions then raise exception 'CODE_EXHAUSTED'; end if;
  if exists (select 1 from promo_redemptions where code = c.code and user_id = me) then raise exception 'ALREADY_USED'; end if;

  insert into promo_redemptions (code, user_id) values (c.code, me);
  update promo_codes set redemptions = redemptions + 1 where code = c.code;
  v_bal := _credit_coins(me, c.coins, 'promo:' || c.code);
  return jsonb_build_object('ok', true, 'coins', c.coins, 'balance', v_bal);
end $$;

create or replace function redeem_referral(p_code text) returns jsonb
language plpgsql security definer as $$
declare me uuid := auth.uid(); v_ref uuid; v_reward int := referral_reward(); v_bal int;
begin
  if exists (select 1 from referrals where referred = me) then raise exception 'ALREADY_REFERRED'; end if;
  select id into v_ref from profiles where upper(referral_code) = upper(trim(p_code));
  if v_ref is null then raise exception 'INVALID_CODE'; end if;
  if v_ref = me then raise exception 'CANNOT_REFER_SELF'; end if;

  insert into referrals (referrer, referred, code) values (v_ref, me, upper(trim(p_code)));
  v_bal := _credit_coins(me, v_reward, 'referral_joined');
  perform _credit_coins(v_ref, v_reward, 'referral_invited');
  return jsonb_build_object('ok', true, 'reward', v_reward, 'balance', v_bal);
end $$;

insert into promo_codes (code, coins, active) values ('WELCOME100', 100, true)
  on conflict (code) do nothing;

-- ── 20. send_gift — coins spend inside a match (coin-ledger-v23.sql) ───
create or replace function send_gift(p_match uuid, p_gift_key text, p_cost int, p_emoji text)
returns jsonb language plpgsql security definer as $$
declare me uuid := auth.uid(); m matches%rowtype; other uuid; v_balance int;
begin
  select * into m from matches where id = p_match and (a = me or b = me);
  if not found then raise exception 'NOT_YOUR_MATCH'; end if;
  other := case when m.a = me then m.b else m.a end;

  select balance into v_balance from coin_wallet where user_id = me;
  if coalesce(v_balance, 0) < p_cost then raise exception 'INSUFFICIENT_COINS'; end if;

  perform _credit_coins(me, -p_cost, 'gift:' || p_gift_key);
  insert into gifts_sent (match_id, sender, receiver, gift_key, cost)
    values (p_match, me, other, p_gift_key, p_cost);
  insert into messages (match_id, sender, body)
    values (p_match, me, coalesce(p_emoji, '🎁') || ' Sent a gift');

  return jsonb_build_object('balance', my_coin_balance());
end $$;

-- ── 21. offboarding — why people leave (offboarding-v21.sql) ───────────
create table if not exists offboarding (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id) on delete set null,
  action      text not null,
  met_someone boolean not null default false,
  where_met   text,
  created_at  timestamptz not null default now()
);
alter table offboarding enable row level security;
drop policy if exists "insert own offboard" on offboarding;
create policy "insert own offboard" on offboarding for insert
  with check (auth.uid() = user_id);

create or replace function log_offboard(p_action text, p_met boolean default false, p_where text default null)
returns void language sql security definer as $$
  insert into offboarding (user_id, action, met_someone, where_met)
  values (auth.uid(), p_action, coalesce(p_met, false), nullif(trim(coalesce(p_where,'')), ''));
$$;

-- ── 22. semantic similarity + why-you-matched (semantic-matching-v17.sql, ──
--        advanced-features-v25.sql) — needs pgvector + interest_embedding
create or replace function interest_similarity(a uuid, b uuid) returns numeric
language sql security definer stable as $$
  select greatest(0, coalesce((
    select 1 - (pa.interest_embedding <=> pb.interest_embedding)
    from profiles pa, profiles pb
    where pa.id = a and pb.id = b
      and pa.interest_embedding is not null
      and pb.interest_embedding is not null
  ), 0))::numeric;
$$;

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

  if mp.compat is not null and mp.compat != '{}' and tp.compat is not null and tp.compat != '{}' then
    reasons := reasons || jsonb_build_object(
      'icon', 'ads_click',
      'text', round(100.0 * compat_hits / 6.0) || '% compatibility on values & lifestyle');
  end if;

  if coalesce(array_length(shared, 1), 0) >= 2 then
    reasons := reasons || jsonb_build_object('icon', 'music_note',
      'text', 'You both love ' || shared[1] || ' & ' || shared[2]);
  elsif coalesce(array_length(shared, 1), 0) = 1 then
    reasons := reasons || jsonb_build_object('icon', 'music_note',
      'text', 'You both love ' || shared[1]);
  end if;

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

  if coalesce(array_length(shared_langs, 1), 0) > 0 then
    reasons := reasons || jsonb_build_object('icon', 'translate',
      'text', 'You both speak ' || shared_langs[1]);
  end if;

  if sim > 0.5 then
    reasons := reasons || jsonb_build_object('icon', 'auto_awesome',
      'text', 'Your profiles read a lot alike');
  end if;

  return reasons;
end $$;

-- ── 23. get_traits() — STUB. ProfileScreen calls this for trait chips; the
-- real version was derived from voice-call peer feedback, which no longer
-- exists. Returns empty so the UI just shows no chips (guarded client-side).
-- DROP first: the old intelligence-v14.sql version (if present in this
-- project) has a different OUT-parameter shape.
drop function if exists get_traits(uuid);
create or replace function get_traits(uid uuid)
returns table (traits jsonb, sample_size int, is_self boolean)
language sql stable as $$
  select '{}'::jsonb, 0, uid = auth.uid();
$$;

-- ── 24. storage: 'photos' bucket (private) + policies ───────────────────
insert into storage.buckets (id, name, public)
  values ('photos', 'photos', false)
  on conflict (id) do nothing;

drop policy if exists "upload own photos" on storage.objects;
create policy "upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "read own photos" on storage.objects;
create policy "read own photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "update own photos" on storage.objects;
create policy "update own photos" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);
-- ⚠️ needed because re-recording an intro video/audio uploads with upsert:true
-- to a fixed path (media.ts) — without UPDATE, the second upload fails.

drop policy if exists "delete own photos" on storage.objects;
create policy "delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

create or replace function public.profile_is_active(uid uuid) returns boolean
language sql security definer stable
set search_path = public as $$
  select exists (select 1 from profiles where id = uid and is_active);
$$;

drop policy if exists "read active users photos" on storage.objects;
create policy "read active users photos" on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and public.profile_is_active(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "read active users photo rows" on public.photos;
create policy "read active users photo rows" on public.photos for select to authenticated
  using (public.profile_is_active(owner));

drop policy if exists "chat media upload" on storage.objects;
create policy "chat media upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = 'chat'
    and public.is_in_match(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists "chat media read" on storage.objects;
create policy "chat media read" on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = 'chat'
    and public.is_in_match(((storage.foldername(name))[2])::uuid)
  );

-- ── 25. realtime — live chat needs `messages` in the publication ───────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- Done. NOT included (deliberately — dead code, no client references):
--   voice_profiles, call_preferences, queue_entries, calls, call_feedback,
--   reveal_state, conversation_traits, lounges, lounge_participants,
--   talk_wallet, try_match, voice_compatible, invite_to_call, is_available,
--   daily_call_cap, calls_used_today/remaining_today, my_call_status,
--   enforce_call_limit, debit_talk_on_end, per_call_cap, daily_free_seconds,
--   talk_available, my_talk_available, debit_wallet, grant_talk_time,
--   list_lounges/join_lounge/leave_lounge/raise_hand/become_speaker/
--   lounge_members, trait_key, derive_traits, set_trait_privacy,
--   date_readiness, advance_reveal, get_reveal, match_score, daily_picks,
--   likes_you_count, daily_likes_remaining, admins/is_admin/admin_* RPCs
--   (the separate admin web dashboard needs a follow-up script if you want
--   it working — ask and I'll write one).
-- ═══════════════════════════════════════════════════════════════════════════
