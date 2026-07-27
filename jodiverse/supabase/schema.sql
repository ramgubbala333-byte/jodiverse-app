-- JodiVerse schema · Postgres / Supabase
-- Run in the Supabase SQL editor. RLS is the security backbone:
-- the client talks to the DB directly, so every table denies by default
-- and grants only the minimum. This is what prevents the API over-fetch
-- leaks endemic to dating apps.

create extension if not exists "uuid-ossp";

-- ── profiles ──────────────────────────────────────────────────────────────
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 40),
  birthdate date not null,
  gender text not null,
  seeking text[] not null default '{}',
  bio text check (char_length(bio) <= 500),
  city text,
  -- Location stored ONLY as a ~1km geohash cell. Never raw coordinates.
  geo_cell text,
  faith text,
  languages text[] default '{}',
  diet text,
  relationship_goal text,
  is_verified boolean not null default false,
  is_active boolean not null default false,   -- false until selfie-verified
  created_at timestamptz not null default now()
);

-- Public-facing subset. The deck reads THIS VIEW, never the table —
-- birthdate, geo_cell etc. can never over-fetch to strangers.
create view public_profiles with (security_invoker = off) as
  select id, display_name,
         date_part('year', age(birthdate))::int as age,
         gender, bio, city, faith, languages, diet,
         relationship_goal, is_verified
  from profiles where is_active = true;

alter table profiles enable row level security;
create policy "read own profile"   on profiles for select using (auth.uid() = id);
create policy "insert own profile" on profiles for insert with check (auth.uid() = id);
create policy "update own profile" on profiles for update using (auth.uid() = id);

-- is_active / is_verified may ONLY be set by the verification Edge Function
-- (service role). A client setting them directly would put unverified
-- accounts into the deck — the single most abused path in dating apps.
create or replace function guard_verification_flags() returns trigger
language plpgsql as $$
begin
  -- service_role bypasses RLS and runs as a superuser-ish role in Supabase;
  -- authenticated users are forced back to safe values.
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
create trigger trg_guard_flags before insert or update on profiles
  for each row execute function guard_verification_flags();

-- ── photos ────────────────────────────────────────────────────────────────
create table photos (
  id uuid primary key default uuid_generate_v4(),
  owner uuid not null references profiles(id) on delete cascade,
  storage_path text not null,      -- served via short-lived signed URLs only
  position int not null default 0,
  created_at timestamptz not null default now()
);
alter table photos enable row level security;
create policy "manage own photos" on photos for all
  using (auth.uid() = owner) with check (auth.uid() = owner);
-- Others' photos are fetched through an Edge Function that checks deck
-- eligibility and returns signed URLs. No direct select policy for strangers.

-- ── swipes ────────────────────────────────────────────────────────────────
create table swipes (
  swiper uuid not null references profiles(id) on delete cascade,
  swipee uuid not null references profiles(id) on delete cascade,
  direction text not null check (direction in ('like','pass','super')),
  note text check (char_length(note) <= 280),
  created_at timestamptz not null default now(),
  primary key (swiper, swipee)
);
alter table swipes enable row level security;
create policy "insert own swipes" on swipes for insert
  with check (auth.uid() = swiper and swiper <> swipee);
create policy "read own swipes" on swipes for select using (auth.uid() = swiper);
-- Deliberately NO policy letting you read who swiped on you.
-- "Who likes you" is a paid feature served by an Edge Function
-- with a service-role key after subscription check.

-- ── matches (created by trigger on mutual like) ───────────────────────────
create table matches (
  id uuid primary key default uuid_generate_v4(),
  a uuid not null references profiles(id) on delete cascade,
  b uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unmatched boolean not null default false,
  check (a < b),
  unique (a, b)
);
alter table matches enable row level security;
create policy "read own matches" on matches for select
  using (auth.uid() = a or auth.uid() = b);
create policy "unmatch" on matches for update
  using (auth.uid() = a or auth.uid() = b);

create or replace function make_match() returns trigger
language plpgsql security definer as $$
begin
  if new.direction in ('like','super') and exists (
    select 1 from swipes
    where swiper = new.swipee and swipee = new.swiper
      and direction in ('like','super'))
  then
    insert into matches (a, b)
    values (least(new.swiper, new.swipee), greatest(new.swiper, new.swipee))
    on conflict do nothing;
  end if;
  return new;
end $$;
create trigger trg_make_match after insert on swipes
  for each row execute function make_match();

-- ── blocks — invisible and mutual ─────────────────────────────────────────
create table blocks (
  blocker uuid not null references profiles(id) on delete cascade,
  blocked uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
alter table blocks enable row level security;
create policy "manage own blocks" on blocks for all
  using (auth.uid() = blocker) with check (auth.uid() = blocker);

-- ── messages ──────────────────────────────────────────────────────────────
create table messages (
  id uuid primary key default uuid_generate_v4(),
  match_id uuid not null references matches(id) on delete cascade,
  sender uuid not null references profiles(id),
  body text not null check (char_length(body) between 1 and 2000),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on messages (match_id, created_at);
alter table messages enable row level security;

create or replace function is_in_match(m uuid) returns boolean
language sql security definer stable as $$
  select exists (select 1 from matches
    where id = m and not unmatched and (a = auth.uid() or b = auth.uid())
      and not exists (select 1 from blocks
        where (blocker = a and blocked = b) or (blocker = b and blocked = a)));
$$;

create policy "read own conversations" on messages for select
  using (is_in_match(match_id));
create policy "send in own conversations" on messages for insert
  with check (auth.uid() = sender and is_in_match(match_id));
create policy "mark read" on messages for update
  using (is_in_match(match_id) and sender <> auth.uid());

-- ── reports ───────────────────────────────────────────────────────────────
create table reports (
  id uuid primary key default uuid_generate_v4(),
  reporter uuid not null references profiles(id),
  reported uuid not null references profiles(id),
  reason text not null,
  detail text,
  created_at timestamptz not null default now(),
  resolved boolean not null default false
);
alter table reports enable row level security;
create policy "file reports" on reports for insert
  with check (auth.uid() = reporter);
-- Read/resolve: admin dashboard only, via service role. No client policy.

-- ── subscriptions (written by payment webhook, service role only) ─────────
create table subscriptions (
  user_id uuid primary key references profiles(id) on delete cascade,
  tier text not null check (tier in ('gold','platinum','eternal')),
  expires_at timestamptz not null
);
alter table subscriptions enable row level security;
create policy "read own subscription" on subscriptions for select
  using (auth.uid() = user_id);

-- ── deck feed via RPC — the only way strangers' profiles are served ──────
create or replace function get_deck(limit_n int default 20)
returns setof public_profiles
language sql security definer stable as $$
  select p.* from public_profiles p
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

-- Realtime: enable for messages + matches in Dashboard → Database → Replication.
-- Storage: create PRIVATE bucket 'photos'; serve via createSignedUrl only.
