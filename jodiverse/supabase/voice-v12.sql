-- JodiVerse Voice v12 · run AFTER super-premium-v11.sql. Safe to re-run.
-- The voice-first pivot: interests-based live audio discovery replaces the
-- swipe deck. Photos stay hidden until the reveal ladder unlocks them.
-- Reuses profiles / matches / messages / blocks / subscriptions unchanged.

-- ═══ 1. VOICE PROFILES ════════════════════════════════════════════════════
-- A 15-45s spoken intro. Required before entering the queue: it is the
-- quality gate that keeps low-intent accounts out of live calls.
create table if not exists voice_profiles (
  user_id      uuid primary key references profiles(id) on delete cascade,
  storage_path text not null,            -- photos bucket: voice/<uid>/intro.m4a
  duration_s   int  not null check (duration_s between 5 and 60),
  transcript   text,                     -- moderation + search only
  status       text not null default 'approved'
               check (status in ('pending','approved','rejected')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table voice_profiles enable row level security;
drop policy if exists "own voice profile" on voice_profiles;
create policy "own voice profile" on voice_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ═══ 2. CALL PREFERENCES ══════════════════════════════════════════════════
-- Availability windows matter far more for voice than for swiping: nobody
-- should get a ringing phone at 2am.
create table if not exists call_preferences (
  user_id        uuid primary key references profiles(id) on delete cascade,
  available_from time not null default '08:00',
  available_to   time not null default '23:59',
  dnd_until      timestamptz,
  who_can_call   text not null default 'anyone'
                 check (who_can_call in ('anyone','verified_only','matches_only')),
  updated_at     timestamptz not null default now()
);
alter table call_preferences enable row level security;
drop policy if exists "own call prefs" on call_preferences;
create policy "own call prefs" on call_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ═══ 3. QUEUE ═════════════════════════════════════════════════════════════
-- Session intent — what you want to talk about RIGHT NOW. Deliberately not a
-- profile column: mood changes between sessions.
create table if not exists queue_entries (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references profiles(id) on delete cascade,
  interests   text[] not null default '{}',
  max_minutes int not null default 10 check (max_minutes between 5 and 60),
  state       text not null default 'waiting'
              check (state in ('waiting','matched','cancelled','expired')),
  call_id     uuid,
  joined_at   timestamptz not null default now(),
  matched_at  timestamptz
);
-- At most one live entry per user (partial unique index = the cheap version
-- of an exclusion constraint, and it doesn't need btree_gist).
create unique index if not exists one_waiting_entry
  on queue_entries (user_id) where state = 'waiting';
create index if not exists queue_waiting_idx
  on queue_entries (state, joined_at) where state = 'waiting';
alter table queue_entries enable row level security;
drop policy if exists "own queue entries" on queue_entries;
create policy "own queue entries" on queue_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ═══ 4. CALLS ═════════════════════════════════════════════════════════════
-- A conversation. NEVER stores audio — only metadata.
create table if not exists calls (
  id          uuid primary key default gen_random_uuid(),
  caller      uuid not null references profiles(id) on delete cascade,
  callee      uuid not null references profiles(id) on delete cascade,
  room        text not null unique,      -- signaling channel name
  source      text not null default 'queue'
              check (source in ('queue','scheduled','rematch')),
  max_minutes int not null default 10,
  state       text not null default 'ringing'
              check (state in ('ringing','active','ended')),
  started_at  timestamptz,
  ended_at    timestamptz,
  duration_s  int,
  end_reason  text check (end_reason in
              ('completed','caller_left','callee_left','declined','timeout','reported','error')),
  created_at  timestamptz not null default now()
);
create index if not exists calls_caller_idx on calls (caller, created_at desc);
create index if not exists calls_callee_idx on calls (callee, created_at desc);
alter table calls enable row level security;
drop policy if exists "read own calls" on calls;
create policy "read own calls" on calls
  for select using (caller = auth.uid() or callee = auth.uid());
drop policy if exists "update own calls" on calls;
create policy "update own calls" on calls
  for update using (caller = auth.uid() or callee = auth.uid());

-- ═══ 5. FEEDBACK ══════════════════════════════════════════════════════════
-- comfort is SAFETY-ONLY: it feeds moderation, never matching, and is never
-- shown to the person being rated.
create table if not exists call_feedback (
  call_id    uuid not null references calls(id) on delete cascade,
  rater      uuid not null references profiles(id) on delete cascade,
  stars      int check (stars between 1 and 5),
  talk_again text check (talk_again in ('yes','maybe','no')),
  comfort    text check (comfort in ('great','good','okay','bad')),
  trait_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (call_id, rater)
);
alter table call_feedback enable row level security;
drop policy if exists "own feedback" on call_feedback;
create policy "own feedback" on call_feedback
  for all using (rater = auth.uid()) with check (rater = auth.uid());

-- ═══ 6. REVEAL LADDER ═════════════════════════════════════════════════════
-- hidden → blurred (mutual yes) → full (2nd call or mutual reveal tap)
create table if not exists reveal_state (
  match_id   uuid primary key references matches(id) on delete cascade,
  level      text not null default 'blurred'
             check (level in ('hidden','blurred','full')),
  a_opted_in boolean not null default false,
  b_opted_in boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table reveal_state enable row level security;
drop policy if exists "read own reveal" on reveal_state;
create policy "read own reveal" on reveal_state for select using (
  exists (select 1 from matches m where m.id = match_id
          and (m.a = auth.uid() or m.b = auth.uid())));

-- ═══ 7. HELPERS ═══════════════════════════════════════════════════════════

-- Free tier: 5 discovery calls per rolling 24h. Subscribers unlimited.
create or replace function calls_remaining_today() returns int
language sql security definer stable as $$
  select case when has_active_sub(auth.uid()) then -1
    else greatest(0, 5 - (select count(*)::int from calls
      where (caller = auth.uid() or callee = auth.uid())
        and source = 'queue'
        and created_at > now() - interval '24 hours'))
  end;
$$;

-- Is this user reachable right now? (availability window + DND)
create or replace function is_available(uid uuid) returns boolean
language sql security definer stable as $$
  select coalesce(
    (select (cp.dnd_until is null or cp.dnd_until < now())
        and localtime between cp.available_from and cp.available_to
     from call_preferences cp where cp.user_id = uid),
    true)  -- no prefs row = always available
$$;

-- Transparent P0 compatibility score. No ML until we have labelled calls.
-- Shared interests dominate; call history and reciprocity refine.
create or replace function match_score(me uuid, them uuid, want text[])
returns numeric language sql security definer stable as $$
  select
    -- shared interests with the OTHER person, weighted toward tonight's picks
      24.0 * (select count(*)::numeric from unnest(
                coalesce((select interests from profiles where id = them), '{}')) i
              where i = any(want)) / greatest(array_length(want, 1), 1)
    -- overlap between the two full interest sets
    + 12.0 * (select count(*)::numeric from unnest(
                coalesce((select interests from profiles where id = me), '{}')) i
              where i = any(coalesce((select interests from profiles where id = them), '{}')))
             / 10.0
    -- they finish their calls (completion rate over last 20)
    + 14.0 * coalesce((select avg(case when c.end_reason = 'completed' then 1.0 else 0.0 end)
                       from (select end_reason from calls
                             where (caller = them or callee = them) and state = 'ended'
                             order by created_at desc limit 20) c), 0.6)
    -- people want to talk to them again
    + 12.0 * coalesce((select avg(case when f.talk_again = 'yes' then 1.0
                                       when f.talk_again = 'maybe' then 0.5 else 0.0 end)
                       from call_feedback f
                       join calls c2 on c2.id = f.call_id
                       where (c2.caller = them or c2.callee = them) and f.rater <> them), 0.5)
    -- language overlap
    + 8.0 * least(1.0, (select count(*)::numeric from unnest(
              coalesce((select languages from profiles where id = me), '{}')) l
            where l = any(coalesce((select languages from profiles where id = them), '{}'))) / 2.0)
    -- verified profiles surface first
    + (case when (select is_verified from profiles where id = them) then 5 else 0 end)
    -- novelty: haven't spoken in the last 30 days
    + (case when not exists (select 1 from calls
        where ((caller = me and callee = them) or (caller = them and callee = me))
          and created_at > now() - interval '30 days') then 6 else 0 end)
$$;

-- Hard filters. Anything here is a disqualifier, never a weight.
create or replace function voice_compatible(me uuid, them uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from profiles a, profiles b
    where a.id = me and b.id = them
      and a.is_active and b.is_active
      and not a.paused and not b.paused
      -- must have a published voice intro
      and exists (select 1 from voice_profiles vp
                  where vp.user_id = them and vp.status = 'approved')
      -- age preferences both ways
      and date_part('year', age(b.birthdate))::int
            between a.pref_age_min and a.pref_age_max
      and date_part('year', age(a.birthdate))::int
            between b.pref_age_min and b.pref_age_max
      -- gender seeking both ways
      and ('everyone' = any(a.seeking)
           or (b.gender = 'woman' and 'women' = any(a.seeking))
           or (b.gender = 'man'   and 'men'   = any(a.seeking)))
      and ('everyone' = any(b.seeking)
           or (a.gender = 'woman' and 'women' = any(b.seeking))
           or (a.gender = 'man'   and 'men'   = any(b.seeking)))
      -- no blocks either direction
      and not exists (select 1 from blocks bl
        where (bl.blocker = me and bl.blocked = them)
           or (bl.blocker = them and bl.blocked = me))
      -- verified-only preference is honoured
      and (coalesce((select who_can_call from call_preferences where user_id = them),
                    'anyone') <> 'verified_only' or a.is_verified)
  );
$$;

-- ═══ 8. THE MATCHMAKER ════════════════════════════════════════════════════
-- FOR UPDATE SKIP LOCKED is what makes concurrent callers safe: two workers
-- never fight over the same waiting user, they simply skip a locked row.
-- Returns the call id when paired, null when nobody suitable is waiting.
create or replace function try_match(p_entry uuid) returns uuid
language plpgsql security definer as $$
declare
  v_me      queue_entries%rowtype;
  v_partner queue_entries%rowtype;
  v_call    uuid;
  v_room    text;
begin
  select * into v_me from queue_entries
    where id = p_entry and user_id = auth.uid() and state = 'waiting'
    for update skip locked;
  if not found then return null; end if;

  select q.* into v_partner
  from queue_entries q
  where q.state = 'waiting'
    and q.user_id <> v_me.user_id
    and q.joined_at > now() - interval '10 minutes'   -- stale entries ignored
    and voice_compatible(v_me.user_id, q.user_id)
    and is_available(q.user_id)
  order by match_score(v_me.user_id, q.user_id, v_me.interests) desc,
           q.joined_at asc
  limit 1
  for update skip locked;
  if not found then return null; end if;

  v_room := 'call_' || replace(gen_random_uuid()::text, '-', '');
  insert into calls (caller, callee, room, source, max_minutes)
  values (v_me.user_id, v_partner.user_id, v_room, 'queue',
          least(v_me.max_minutes, v_partner.max_minutes))
  returning id into v_call;

  update queue_entries set state = 'matched', matched_at = now(), call_id = v_call
   where id in (v_me.id, v_partner.id);

  return v_call;
end $$;

-- Live queue narration: how many waiting users match each predicate.
create or replace function queue_predicates(want text[])
returns table (label text, matches int)
language sql security definer stable as $$
  with pool as (
    select q.user_id, p.interests, p.languages
    from queue_entries q
    join profiles p on p.id = q.user_id
    where q.state = 'waiting'
      and q.user_id <> auth.uid()
      and q.joined_at > now() - interval '10 minutes'
      and voice_compatible(auth.uid(), q.user_id)
  )
  select w.label,
         (select count(*)::int from pool where w.label = any(pool.interests))
  from unnest(want) as w(label)
  union all
  select 'is free to talk right now', (select count(*)::int from pool)
$$;

-- ═══ 9. POST-CALL: mutual yes creates the match ═══════════════════════════
create or replace function submit_call_feedback(
  p_call uuid, p_stars int, p_talk_again text, p_comfort text, p_tags text[])
returns uuid   -- match id when both said yes, else null
language plpgsql security definer as $$
declare
  v_call   calls%rowtype;
  v_other  uuid;
  v_theirs text;
  v_match  uuid;
  v_a uuid; v_b uuid;
begin
  select * into v_call from calls where id = p_call;
  if not found then raise exception 'NO_SUCH_CALL'; end if;
  if auth.uid() not in (v_call.caller, v_call.callee) then
    raise exception 'NOT_A_PARTICIPANT';
  end if;
  v_other := case when v_call.caller = auth.uid() then v_call.callee else v_call.caller end;

  insert into call_feedback (call_id, rater, stars, talk_again, comfort, trait_tags)
  values (p_call, auth.uid(), p_stars, p_talk_again, p_comfort, coalesce(p_tags, '{}'))
  on conflict (call_id, rater) do update
    set stars = excluded.stars, talk_again = excluded.talk_again,
        comfort = excluded.comfort, trait_tags = excluded.trait_tags;

  -- Their verdict. 'maybe' counts as yes only if the other side said yes.
  select talk_again into v_theirs from call_feedback
   where call_id = p_call and rater = v_other;
  if v_theirs is null then return null; end if;
  if not (p_talk_again in ('yes','maybe') and v_theirs in ('yes','maybe')
          and (p_talk_again = 'yes' or v_theirs = 'yes')) then
    return null;
  end if;

  select least(auth.uid(), v_other), greatest(auth.uid(), v_other) into v_a, v_b;
  insert into matches (a, b) values (v_a, v_b)
    on conflict (a, b) do nothing
    returning id into v_match;
  if v_match is null then
    select id into v_match from matches where a = v_a and b = v_b;
  end if;

  insert into reveal_state (match_id, level) values (v_match, 'blurred')
    on conflict (match_id) do nothing;
  return v_match;
end $$;

-- ═══ 10. DAILY CALL CAP ═══════════════════════════════════════════════════
create or replace function enforce_call_limit() returns trigger
language plpgsql security definer as $$
begin
  if new.source = 'queue' and not has_active_sub(new.caller) then
    if (select count(*) from calls
        where caller = new.caller and source = 'queue'
          and created_at > now() - interval '24 hours') >= 5 then
      raise exception 'CALL_LIMIT_REACHED';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_call_limit on calls;
create trigger trg_call_limit before insert on calls
  for each row execute function enforce_call_limit();

-- ═══ 11. VOICE-AWARE PUBLIC VIEW ══════════════════════════════════════════
-- Adds has_voice so the client can gate the queue without reading the table.
create or replace view public_profiles with (security_invoker = off) as
  select p.id, p.display_name,
         date_part('year', age(p.birthdate))::int as age,
         p.gender, p.bio, p.city, p.faith, p.languages, p.diet,
         p.relationship_goal, p.is_verified, p.interests,
         (p.created_at > now() - interval '14 days') as new_here,
         p.drinking, p.smoking, p.height_cm, p.occupation,
         case
           when not p.show_last_active then null
           when p.last_seen > now() - interval '15 minutes' then 'Online'
           when p.last_seen > now() - interval '24 hours'   then 'Active today'
           when p.last_seen > now() - interval '7 days'     then 'Active this week'
           else null
         end as activity_status,
         p.video_path, p.audio_path, p.education, p.lifestyle,
         exists (select 1 from voice_profiles vp
                 where vp.user_id = p.id and vp.status = 'approved') as has_voice
  from profiles p where p.is_active = true;
