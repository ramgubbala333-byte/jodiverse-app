-- Growth v22 · run AFTER monetization-pivot-v16.sql. Safe to re-run.
-- Referrals (invite a friend → both get coins) + promo/coupon codes.
-- Coins stay cosmetic-only — these just top up coin_wallet, never buy time/matching.

-- ═══ 1. REFERRALS ═════════════════════════════════════════════════════════
alter table profiles add column if not exists referral_code text unique;

-- Get (or lazily create) the caller's unique invite code.
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
        -- extremely rare collision; loop and try another
      end;
    end loop;
  end if;
  return v;
end $$;

create table if not exists referrals (
  referrer   uuid not null references profiles(id) on delete cascade,
  referred   uuid primary key references profiles(id) on delete cascade,  -- referred once, ever
  code       text,
  created_at timestamptz not null default now()
);
alter table referrals enable row level security;
drop policy if exists "read own referrals" on referrals;
create policy "read own referrals" on referrals for select
  using (referrer = auth.uid() or referred = auth.uid());

create or replace function referral_reward() returns int language sql immutable as $$ select 100 $$;

-- Caller is the NEW user redeeming a friend's code → both wallets get credited.
create or replace function redeem_referral(p_code text) returns jsonb
language plpgsql security definer as $$
declare me uuid := auth.uid(); v_ref uuid; v_reward int := referral_reward();
begin
  if exists (select 1 from referrals where referred = me) then raise exception 'ALREADY_REFERRED'; end if;
  select id into v_ref from profiles where upper(referral_code) = upper(trim(p_code));
  if v_ref is null then raise exception 'INVALID_CODE'; end if;
  if v_ref = me then raise exception 'CANNOT_REFER_SELF'; end if;

  insert into referrals (referrer, referred, code) values (v_ref, me, upper(trim(p_code)));
  insert into coin_wallet (user_id, balance) values (me, v_reward)
    on conflict (user_id) do update set balance = coin_wallet.balance + v_reward, updated_at = now();
  insert into coin_wallet (user_id, balance) values (v_ref, v_reward)
    on conflict (user_id) do update set balance = coin_wallet.balance + v_reward, updated_at = now();
  return jsonb_build_object('ok', true, 'reward', v_reward,
    'balance', (select balance from coin_wallet where user_id = me));
end $$;

create or replace function referral_stats() returns jsonb
language sql security definer stable as $$
  select jsonb_build_object(
    'code',         (select referral_code from profiles where id = auth.uid()),
    'invites',      (select count(*) from referrals where referrer = auth.uid()),
    'coins_earned', (select count(*) * referral_reward() from referrals where referrer = auth.uid()),
    'reward',       referral_reward()
  );
$$;

-- ═══ 2. PROMO / COUPON CODES ══════════════════════════════════════════════
create table if not exists promo_codes (
  code            text primary key,
  coins           int not null check (coins > 0),
  max_redemptions int,                              -- null = unlimited
  redemptions     int not null default 0,
  expires_at      timestamptz,
  active          boolean not null default true
);
alter table promo_codes enable row level security;   -- validated only via definer fn

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
declare me uuid := auth.uid(); c promo_codes%rowtype; v_code text := upper(trim(p_code));
begin
  select * into c from promo_codes where upper(code) = v_code;
  if not found or not c.active then raise exception 'INVALID_CODE'; end if;
  if c.expires_at is not null and c.expires_at < now() then raise exception 'CODE_EXPIRED'; end if;
  if c.max_redemptions is not null and c.redemptions >= c.max_redemptions then raise exception 'CODE_EXHAUSTED'; end if;
  if exists (select 1 from promo_redemptions where code = c.code and user_id = me) then raise exception 'ALREADY_USED'; end if;

  insert into promo_redemptions (code, user_id) values (c.code, me);
  update promo_codes set redemptions = redemptions + 1 where code = c.code;
  insert into coin_wallet (user_id, balance) values (me, c.coins)
    on conflict (user_id) do update set balance = coin_wallet.balance + c.coins, updated_at = now();
  return jsonb_build_object('ok', true, 'coins', c.coins,
    'balance', (select balance from coin_wallet where user_id = me));
end $$;

-- A welcome code to test with (idempotent).
insert into promo_codes (code, coins, active) values ('WELCOME100', 100, true)
  on conflict (code) do nothing;
