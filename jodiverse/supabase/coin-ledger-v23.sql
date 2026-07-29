-- Coin ledger v23 · run AFTER growth-v22.sql. Safe to re-run.
-- Directly counters FRND's #1 complaint ("my coins/earnings vanished with no
-- record"). Every coin movement now goes through _credit_coins(), which updates
-- the wallet AND writes an immutable ledger row the user can see in Transactions.

create table if not exists coin_ledger (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles(id) on delete cascade,
  delta         int  not null,          -- + credit, − debit
  reason        text not null,          -- 'purchase' | 'promo:CODE' | 'referral_*' | 'gift:key'
  balance_after int  not null,
  created_at    timestamptz not null default now()
);
create index if not exists coin_ledger_user_idx on coin_ledger (user_id, created_at desc);
alter table coin_ledger enable row level security;
drop policy if exists "read own ledger" on coin_ledger;
create policy "read own ledger" on coin_ledger for select using (user_id = auth.uid());

-- Central money mover: applies a delta to the wallet and records it. The
-- wallet's balance >= 0 check rejects overspends. Returns the new balance.
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

create or replace function my_coin_ledger(p_lim int default 60)
returns table (delta int, reason text, balance_after int, created_at timestamptz)
language sql security definer stable as $$
  select delta, reason, balance_after, created_at from coin_ledger
  where user_id = auth.uid() order by created_at desc limit greatest(p_lim, 1);
$$;

-- ── Route all existing coin flows through the ledger ──────────────────────
create or replace function grant_coins(amount int) returns int
language plpgsql security definer as $$
begin
  if amount is null or amount <= 0 then raise exception 'BAD_AMOUNT'; end if;
  return _credit_coins(auth.uid(), amount, 'purchase');
end $$;

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
