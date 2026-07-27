-- Talk-time wallet v13 · run AFTER voice-v12.sql. Safe to re-run.
-- Replaces the "5 calls/day" model with a minutes wallet:
--   • Everyone gets 20 free minutes per day (refills daily).
--   • Subscribers get 60 free minutes per day (a perk, still finite).
--   • Out of minutes? Buy call-time packs (persistent balance, never expires).
--   • Hard cap: 10 minutes per call, for everyone.
--   • Random connect — no voice-intro gate, no accept/decline.
-- The wallet is SERVER-AUTHORITATIVE: the DB computes each call's real
-- duration from its own clock and debits both parties. A hacked client
-- cannot mint free minutes.

-- ═══ 1. THE WALLET ════════════════════════════════════════════════════════
create table if not exists talk_wallet (
  user_id           uuid primary key references profiles(id) on delete cascade,
  balance_seconds   int not null default 0,      -- purchased, never expires
  free_used_seconds int not null default 0,      -- spent from today's free grant
  free_date         date not null default current_date,
  updated_at        timestamptz not null default now()
);
alter table talk_wallet enable row level security;
drop policy if exists "read own wallet" on talk_wallet;
create policy "read own wallet" on talk_wallet
  for select using (user_id = auth.uid());
-- All writes go through security-definer functions/triggers below.

-- Per-call hard cap (seconds). 10 minutes, everyone.
create or replace function per_call_cap() returns int
language sql immutable as $$ select 600 $$;

-- Daily free grant. 20 min everyone; 60 min for subscribers.
create or replace function daily_free_seconds(uid uuid) returns int
language sql security definer stable as $$
  select case when has_active_sub(uid) then 3600 else 1200 end;
$$;

-- Seconds available to talk RIGHT NOW = remaining free today + purchased.
-- Read-only (does not write the daily rollover; that happens on debit).
create or replace function talk_available(uid uuid) returns int
language plpgsql security definer stable as $$
declare w talk_wallet; free_left int;
begin
  select * into w from talk_wallet where user_id = uid;
  if not found then return daily_free_seconds(uid); end if;   -- fresh user
  if w.free_date < current_date then
    free_left := daily_free_seconds(uid);                     -- new day, full grant
  else
    free_left := greatest(0, daily_free_seconds(uid) - w.free_used_seconds);
  end if;
  return free_left + w.balance_seconds;
end $$;

-- My own available seconds (client convenience).
create or replace function my_talk_available() returns int
language sql security definer stable as $$ select talk_available(auth.uid()) $$;

-- Debit n seconds: drain today's free first, then purchased balance.
create or replace function debit_wallet(uid uuid, secs int) returns void
language plpgsql security definer as $$
declare grant_s int; free_left int; from_free int; remainder int;
begin
  if secs is null or secs <= 0 then return; end if;
  insert into talk_wallet (user_id) values (uid) on conflict (user_id) do nothing;
  -- roll the daily free window forward if we've crossed midnight
  update talk_wallet set free_used_seconds = 0, free_date = current_date
    where user_id = uid and free_date < current_date;

  grant_s := daily_free_seconds(uid);
  select greatest(0, grant_s - free_used_seconds) into free_left
    from talk_wallet where user_id = uid;
  from_free := least(secs, free_left);
  remainder := secs - from_free;

  update talk_wallet
     set free_used_seconds = free_used_seconds + from_free,
         balance_seconds   = greatest(0, balance_seconds - remainder),
         updated_at = now()
   where user_id = uid;
end $$;

-- Credit purchased seconds. Called by the buy-time flow (dev: instant;
-- production: from the RevenueCat webhook after a real purchase).
create or replace function grant_talk_time(secs int) returns int
language plpgsql security definer as $$
begin
  if secs is null or secs <= 0 then raise exception 'BAD_AMOUNT'; end if;
  insert into talk_wallet (user_id) values (auth.uid()) on conflict (user_id) do nothing;
  update talk_wallet set balance_seconds = balance_seconds + secs, updated_at = now()
    where user_id = auth.uid();
  return talk_available(auth.uid());
end $$;

-- ═══ 2. CALLS CARRY A BUDGET ══════════════════════════════════════════════
alter table calls add column if not exists budget_seconds int;

-- Server-authoritative debit when a call ends. Duration is computed from the
-- DB clock (started_at → ended_at), clamped to the budget set at creation,
-- then charged to BOTH parties. Idempotent: a second ending is a no-op.
create or replace function debit_talk_on_end() returns trigger
language plpgsql security definer as $$
declare secs int;
begin
  if new.state = 'ended' and old.state is distinct from 'ended' then
    if new.started_at is null then
      secs := 0;                          -- never connected (declined/timeout pre-connect)
    else
      secs := greatest(0, floor(extract(epoch from
                (coalesce(new.ended_at, now()) - new.started_at)))::int);
      secs := least(secs, coalesce(new.budget_seconds, per_call_cap()));
    end if;
    new.duration_s := secs;               -- overwrite whatever the client sent
    perform debit_wallet(new.caller, secs);
    perform debit_wallet(new.callee, secs);
  end if;
  return new;
end $$;
drop trigger if exists trg_debit_talk on calls;
create trigger trg_debit_talk before update on calls
  for each row execute function debit_talk_on_end();

-- The old 5-calls/day cap is gone — the wallet is the limit now.
drop trigger if exists trg_call_limit on calls;

-- ═══ 3. NO VOICE-INTRO GATE ═══════════════════════════════════════════════
-- Redefine compatibility WITHOUT requiring a published voice intro, and add
-- the wallet check so we never match someone who is out of minutes.
create or replace function voice_compatible(me uuid, them uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from profiles a, profiles b
    where a.id = me and b.id = them
      and a.is_active and b.is_active
      and not a.paused and not b.paused
      and talk_available(them) > 0                     -- they still have minutes
      and date_part('year', age(b.birthdate))::int
            between a.pref_age_min and a.pref_age_max
      and date_part('year', age(a.birthdate))::int
            between b.pref_age_min and b.pref_age_max
      and ('everyone' = any(a.seeking)
           or (b.gender = 'woman' and 'women' = any(a.seeking))
           or (b.gender = 'man'   and 'men'   = any(a.seeking)))
      and ('everyone' = any(b.seeking)
           or (a.gender = 'woman' and 'women' = any(b.seeking))
           or (a.gender = 'man'   and 'men'   = any(b.seeking)))
      and not exists (select 1 from blocks bl
        where (bl.blocker = me and bl.blocked = them)
           or (bl.blocker = them and bl.blocked = me))
      and (coalesce((select who_can_call from call_preferences where user_id = them),
                    'anyone') <> 'verified_only' or a.is_verified)
  );
$$;

-- ═══ 4. MATCHMAKER SETS THE CALL BUDGET ═══════════════════════════════════
-- Budget = min(10 min, my remaining, their remaining). The call can't run
-- longer than either wallet allows, and never longer than the 10-min cap.
create or replace function try_match(p_entry uuid) returns uuid
language plpgsql security definer as $$
declare
  v_me      queue_entries%rowtype;
  v_partner queue_entries%rowtype;
  v_call    uuid;
  v_room    text;
  v_budget  int;
begin
  select * into v_me from queue_entries
    where id = p_entry and user_id = auth.uid() and state = 'waiting'
    for update skip locked;
  if not found then return null; end if;

  if talk_available(v_me.user_id) <= 0 then return null; end if;  -- out of time

  select q.* into v_partner
  from queue_entries q
  where q.state = 'waiting'
    and q.user_id <> v_me.user_id
    and q.joined_at > now() - interval '10 minutes'
    and voice_compatible(v_me.user_id, q.user_id)
    and is_available(q.user_id)
  order by match_score(v_me.user_id, q.user_id, v_me.interests) desc,
           q.joined_at asc
  limit 1
  for update skip locked;
  if not found then return null; end if;

  v_budget := least(per_call_cap(),
                    talk_available(v_me.user_id),
                    talk_available(v_partner.user_id));
  if v_budget <= 0 then return null; end if;

  v_room := 'call_' || replace(gen_random_uuid()::text, '-', '');
  insert into calls (caller, callee, room, source, max_minutes, budget_seconds)
  values (v_me.user_id, v_partner.user_id, v_room, 'queue',
          ceil(v_budget / 60.0)::int, v_budget)
  returning id into v_call;

  update queue_entries set state = 'matched', matched_at = now(), call_id = v_call
   where id in (v_me.id, v_partner.id);

  return v_call;
end $$;
