-- Monetization pivot v16 · run AFTER lounges-antighost-v15.sql. Safe to re-run.
-- Implements the "fair pricing" strategy: subscriptions for reach/insight,
-- cosmetic-only coins for self-expression, NEVER pay-per-minute.
--
--   • Talking is free: replaces the minutes-wallet (v13) with a simple daily
--     CALL COUNT — 3 free calls/day, 30/day for subscribers (fair-use
--     "unlimited"). No buying call time. The universal 10-minute-per-call
--     cap (per_call_cap(), unchanged) stays for everyone — it's a product
--     mechanic ("meet more people"), never a monetization lever.
--   • Coins are added ONLY for gifts/cosmetics — they can never buy a
--     second of anyone's time. This is enforced structurally: nothing in
--     this file lets a coin spend touch calls, queue_entries, or messages
--     limits (messaging has been unlimited since discovery-v6).

-- ═══ 1. DAILY CALL COUNT (replaces the minutes wallet as the gate) ═══════
-- per_call_cap() already exists (v13) = 600s / 10 min, universal. Untouched.

create or replace function daily_call_cap(uid uuid) returns int
language sql security definer stable as $$
  select case when has_active_sub(uid) then 30 else 3 end;
$$;

create or replace function calls_used_today(uid uuid) returns int
language sql security definer stable as $$
  select count(*)::int from calls
   where (caller = uid or callee = uid)
     and source in ('queue', 'lounge')
     and created_at > now() - interval '24 hours';
$$;

create or replace function calls_remaining_today(uid uuid) returns int
language sql security definer stable as $$
  select greatest(0, daily_call_cap(uid) - calls_used_today(uid));
$$;

-- What the client shows on the Talk tab.
create or replace function my_call_status() returns jsonb
language sql security definer stable as $$
  select jsonb_build_object(
    'used', calls_used_today(auth.uid()),
    'cap', daily_call_cap(auth.uid()),
    'remaining', calls_remaining_today(auth.uid()),
    'subscribed', has_active_sub(auth.uid()));
$$;

-- ═══ 2. GATING NOW USES CALL COUNT, NOT MINUTES ═══════════════════════════
create or replace function voice_compatible(me uuid, them uuid) returns boolean
language sql security definer stable as $$
  select exists (
    select 1 from profiles a, profiles b
    where a.id = me and b.id = them
      and a.is_active and b.is_active
      and not a.paused and not b.paused
      and calls_remaining_today(them) > 0
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

-- try_match: budget is always the universal per-call cap now (no wallet math).
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

  if calls_remaining_today(v_me.user_id) <= 0 then return null; end if;

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

  v_room := 'call_' || replace(gen_random_uuid()::text, '-', '');
  insert into calls (caller, callee, room, source, max_minutes, budget_seconds)
  values (v_me.user_id, v_partner.user_id, v_room, 'queue', 10, per_call_cap())
  returning id into v_call;

  update queue_entries set state = 'matched', matched_at = now(), call_id = v_call
   where id in (v_me.id, v_partner.id);

  return v_call;
end $$;

-- Lounge → private call invite: same call-count gate, same fixed budget.
create or replace function invite_to_call(other uuid) returns uuid
language plpgsql security definer as $$
declare v_call uuid; v_room text;
begin
  if other = auth.uid() then raise exception 'CANNOT_CALL_SELF'; end if;
  if not exists (select 1 from profiles where id = other and is_active) then
    raise exception 'NO_SUCH_USER';
  end if;
  if exists (select 1 from blocks
      where (blocker = auth.uid() and blocked = other)
         or (blocker = other and blocked = auth.uid())) then
    raise exception 'BLOCKED';
  end if;
  if calls_remaining_today(auth.uid()) <= 0 or calls_remaining_today(other) <= 0 then
    raise exception 'CALL_LIMIT_REACHED';
  end if;

  v_room := 'call_' || replace(gen_random_uuid()::text, '-', '');
  insert into calls (caller, callee, room, source, max_minutes, budget_seconds)
  values (auth.uid(), other, v_room, 'lounge', 10, per_call_cap())
  returning id into v_call;
  return v_call;
end $$;

-- Server-side enforcement (defense in depth — the client already checks
-- calls_remaining_today before joining, but every insert path is covered).
create or replace function enforce_call_limit() returns trigger
language plpgsql security definer as $$
begin
  if new.source in ('queue', 'lounge') then
    if calls_used_today(new.caller) >= daily_call_cap(new.caller) then
      raise exception 'CALL_LIMIT_REACHED';
    end if;
    if calls_used_today(new.callee) >= daily_call_cap(new.callee) then
      raise exception 'CALL_LIMIT_REACHED';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_call_limit on calls;
create trigger trg_call_limit before insert on calls
  for each row execute function enforce_call_limit();

-- Duration is still server-authoritative (client can't inflate call history /
-- date-readiness signals) — just no wallet debit anymore, since minutes
-- aren't metered.
create or replace function debit_talk_on_end() returns trigger
language plpgsql security definer as $$
declare secs int;
begin
  if new.state = 'ended' and old.state is distinct from 'ended' then
    if new.started_at is null then
      secs := 0;
    else
      secs := greatest(0, floor(extract(epoch from
                (coalesce(new.ended_at, now()) - new.started_at)))::int);
      secs := least(secs, coalesce(new.budget_seconds, per_call_cap()));
    end if;
    new.duration_s := secs;
  end if;
  return new;
end $$;
-- trg_debit_talk trigger already exists (v13) and points at this function
-- name — create-or-replace above is all that's needed to update its body.

-- ═══ 3. COSMETIC COINS ════════════════════════════════════════════════════
-- Coins buy gifts, boosts, themes, decorations — NEVER call time, messaging,
-- safety, verification, or matching. That boundary is structural: nothing
-- below touches queue_entries, calls, call_preferences, or the message path
-- except to INSERT a visible gift message (like a photo comment already does).
create table if not exists coin_wallet (
  user_id    uuid primary key references profiles(id) on delete cascade,
  balance    int not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);
alter table coin_wallet enable row level security;
drop policy if exists "read own coins" on coin_wallet;
create policy "read own coins" on coin_wallet for select using (user_id = auth.uid());

create or replace function my_coin_balance() returns int
language sql security definer stable as $$
  select coalesce((select balance from coin_wallet where user_id = auth.uid()), 0);
$$;

-- Dev-instant credit for testing the flow before real IAP wires in — same
-- pattern as the old grant_talk_time, now for a cosmetic currency.
create or replace function grant_coins(amount int) returns int
language plpgsql security definer as $$
begin
  if amount is null or amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  insert into coin_wallet (user_id, balance) values (auth.uid(), amount)
    on conflict (user_id) do update
      set balance = coin_wallet.balance + amount, updated_at = now();
  return my_coin_balance();
end $$;

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

-- Send a gift inside a match: spends coins, logs it, and drops a visible
-- message in the chat (same visibility pattern as a photo comment).
create or replace function send_gift(p_match uuid, p_gift_key text, p_cost int, p_emoji text)
returns jsonb language plpgsql security definer as $$
declare
  me uuid := auth.uid(); m matches%rowtype; other uuid; v_balance int;
begin
  select * into m from matches where id = p_match and (a = me or b = me);
  if not found then raise exception 'NOT_YOUR_MATCH'; end if;
  other := case when m.a = me then m.b else m.a end;

  select balance into v_balance from coin_wallet where user_id = me;
  if coalesce(v_balance, 0) < p_cost then raise exception 'INSUFFICIENT_COINS'; end if;

  update coin_wallet set balance = balance - p_cost, updated_at = now() where user_id = me;
  insert into gifts_sent (match_id, sender, receiver, gift_key, cost)
    values (p_match, me, other, p_gift_key, p_cost);
  insert into messages (match_id, sender, body)
    values (p_match, me, coalesce(p_emoji, '🎁') || ' Sent a gift');

  return jsonb_build_object('balance', my_coin_balance());
end $$;
