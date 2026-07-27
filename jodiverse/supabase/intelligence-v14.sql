-- Intelligence layer v14 · run AFTER voice-wallet-v13.sql. Safe to re-run.
-- The "beyond basic" features that need no audio and no paid infra:
--   • Conversational traits — derived ONLY from call metadata + peer feedback.
--     Never from audio. Positive-only vocabulary. User-hideable.
--   • Date readiness — a qualitative band from real interaction signals.
--   • Photo reveal ladder — advance blurred → full on mutual opt-in / 2nd call.
--   • AI matchmaker upgrade — folds trait fit + time-of-day into the score.

-- ═══ 1. CONVERSATIONAL TRAITS ═════════════════════════════════════════════
create table if not exists conversation_traits (
  user_id     uuid primary key references profiles(id) on delete cascade,
  traits      jsonb not null default '{}',   -- {"good_listener":0.8,...} 0..1
  sample_size int  not null default 0,        -- how many calls informed this
  hidden      text[] not null default '{}',   -- traits the user hides
  opted_out   boolean not null default false, -- opt out of derivation entirely
  updated_at  timestamptz not null default now()
);
alter table conversation_traits enable row level security;
drop policy if exists "read any traits" on conversation_traits;
create policy "read any traits" on conversation_traits for select using (true);
drop policy if exists "write own traits" on conversation_traits;
create policy "write own traits" on conversation_traits
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Map the post-call tag labels to canonical trait keys.
create or replace function trait_key(tag text) returns text
language sql immutable as $$
  select case lower(tag)
    when 'good listener'   then 'good_listener'
    when 'funny'           then 'funny'
    when 'curious'         then 'curious'
    when 'great questions' then 'curious'
    when 'storyteller'     then 'storyteller'
    when 'calm'            then 'calm'
    when 'warm'            then 'warm'
    when 'easy to talk to' then 'easy_going'
    else null end;
$$;

-- Recompute a user's traits from what OTHERS said about them + call metadata.
-- Deterministic aggregation — there is no model here, and no audio is read.
create or replace function derive_traits(uid uuid) returns void
language plpgsql security definer as $$
declare
  v_out       jsonb := '{}';
  v_total     int;
  r           record;
  v_avg_dur   numeric;
  v_completed numeric;
begin
  if exists (select 1 from conversation_traits
             where user_id = uid and opted_out) then
    return;
  end if;

  -- peer feedback: tags given to this user by their call partners
  select count(*) into v_total
  from call_feedback f join calls c on c.id = f.call_id
  where f.rater <> uid and (c.caller = uid or c.callee = uid);

  for r in
    select trait_key(tag) as k, count(*)::numeric as n
    from call_feedback f
    join calls c on c.id = f.call_id
    cross join lateral unnest(f.trait_tags) as tag
    where f.rater <> uid and (c.caller = uid or c.callee = uid)
      and trait_key(tag) is not null
    group by trait_key(tag)
  loop
    -- smoothed proportion so one call doesn't peg a trait to 1.0
    v_out := v_out || jsonb_build_object(r.k,
             round((r.n / greatest(v_total, 3))::numeric, 2));
  end loop;

  -- metadata-derived style (never audio): talk length + follow-through
  select avg(duration_s), avg(case when end_reason = 'completed' then 1.0 else 0.0 end)
    into v_avg_dur, v_completed
  from calls where (caller = uid or callee = uid) and state = 'ended' and duration_s > 0;

  if v_avg_dur is not null then
    if v_avg_dur >= 300 then v_out := v_out || jsonb_build_object('talkative', 0.7);
    elsif v_avg_dur <= 120 then v_out := v_out || jsonb_build_object('concise', 0.7);
    end if;
  end if;
  if coalesce(v_completed, 0) >= 0.7 then
    v_out := v_out || jsonb_build_object('engaged', round(v_completed, 2));
  end if;

  insert into conversation_traits (user_id, traits, sample_size, updated_at)
  values (uid, v_out, v_total, now())
  on conflict (user_id) do update
    set traits = excluded.traits, sample_size = excluded.sample_size, updated_at = now()
  where not conversation_traits.opted_out;
end $$;

-- Fetch traits, recomputing if stale (>1h). Respects hidden + opt-out.
create or replace function get_traits(uid uuid)
returns table (traits jsonb, sample_size int, is_self boolean)
language plpgsql security definer as $$
declare v conversation_traits;
begin
  select * into v from conversation_traits where user_id = uid;
  if not found or v.updated_at < now() - interval '1 hour' then
    perform derive_traits(uid);
    select * into v from conversation_traits where user_id = uid;
  end if;
  if v.opted_out then
    return query select '{}'::jsonb, 0, uid = auth.uid();
    return;
  end if;
  -- strip hidden traits for everyone except the owner
  if uid = auth.uid() then
    return query select v.traits, v.sample_size, true;
  else
    return query select (select coalesce(jsonb_object_agg(k, val), '{}')
                         from jsonb_each(v.traits) e(k, val)
                         where not (k = any(v.hidden))), v.sample_size, false;
  end if;
end $$;

create or replace function set_trait_privacy(p_hidden text[], p_opted_out boolean)
returns void language plpgsql security definer as $$
begin
  insert into conversation_traits (user_id, hidden, opted_out)
  values (auth.uid(), coalesce(p_hidden, '{}'), coalesce(p_opted_out, false))
  on conflict (user_id) do update
    set hidden = coalesce(p_hidden, '{}'), opted_out = coalesce(p_opted_out, false),
        updated_at = now();
end $$;

-- ═══ 2. DATE READINESS ════════════════════════════════════════════════════
-- Qualitative band from real interaction — never appearance, never demographics.
-- A band, not a percentage, because a number invites gaming.
create or replace function date_readiness(other uuid)
returns jsonb language plpgsql security definer as $$
declare
  me uuid := auth.uid();
  v_calls int; v_mutual boolean; v_avg numeric; v_shared int; v_band text;
  v_a uuid; v_b uuid;
begin
  select least(me, other), greatest(me, other) into v_a, v_b;

  select count(*) into v_calls from calls
   where ((caller = me and callee = other) or (caller = other and callee = me))
     and state = 'ended' and duration_s > 0;

  select bool_and(talk_again in ('yes','maybe')) into v_mutual
  from call_feedback f join calls c on c.id = f.call_id
  where ((c.caller = me and c.callee = other) or (c.caller = other and c.callee = me));

  select avg(stars) into v_avg
  from call_feedback f join calls c on c.id = f.call_id
  where ((c.caller = me and c.callee = other) or (c.caller = other and c.callee = me))
    and f.stars is not null;

  select count(*) into v_shared from unnest(
      coalesce((select interests from profiles where id = me), '{}')) i
    where i = any(coalesce((select interests from profiles where id = other), '{}'));

  v_band := case
    when v_calls >= 2 and coalesce(v_mutual, false) and coalesce(v_avg, 0) >= 4 then 'ready'
    when v_calls >= 1 and coalesce(v_mutual, false) then 'warming_up'
    else 'early' end;

  return jsonb_build_object(
    'band', v_band, 'calls_together', v_calls,
    'mutual_interest', coalesce(v_mutual, false),
    'avg_rating', round(coalesce(v_avg, 0), 1), 'shared_interests', v_shared);
end $$;

-- ═══ 3. PHOTO REVEAL LADDER ═══════════════════════════════════════════════
-- Opt in to reveal your photos to a match. Advances to 'full' when both have
-- opted in, or after a 2nd completed call together.
create or replace function advance_reveal(p_match uuid)
returns jsonb language plpgsql security definer as $$
declare
  me uuid := auth.uid();
  m matches%rowtype; am_a boolean; v reveal_state%rowtype; v_calls int;
begin
  select * into m from matches where id = p_match and (a = me or b = me);
  if not found then raise exception 'NOT_YOUR_MATCH'; end if;
  am_a := (m.a = me);

  insert into reveal_state (match_id, level) values (p_match, 'blurred')
    on conflict (match_id) do nothing;
  select * into v from reveal_state where match_id = p_match;

  update reveal_state
     set a_opted_in = case when am_a then true else a_opted_in end,
         b_opted_in = case when am_a then b_opted_in else true end,
         updated_at = now()
   where match_id = p_match
   returning * into v;

  select count(*) into v_calls from calls
   where ((caller = m.a and callee = m.b) or (caller = m.b and callee = m.a))
     and end_reason = 'completed';

  if (v.a_opted_in and v.b_opted_in) or v_calls >= 2 then
    update reveal_state set level = 'full', updated_at = now()
     where match_id = p_match returning * into v;
  end if;

  return jsonb_build_object('level', v.level,
    'you_opted_in', case when am_a then v.a_opted_in else v.b_opted_in end,
    'both_in', v.a_opted_in and v.b_opted_in);
end $$;

create or replace function get_reveal(p_match uuid) returns jsonb
language plpgsql security definer as $$
declare me uuid := auth.uid(); m matches%rowtype; v reveal_state%rowtype; am_a boolean;
begin
  select * into m from matches where id = p_match and (a = me or b = me);
  if not found then return jsonb_build_object('level','blurred','you_opted_in',false); end if;
  select * into v from reveal_state where match_id = p_match;
  if not found then return jsonb_build_object('level','blurred','you_opted_in',false); end if;
  am_a := (m.a = me);
  return jsonb_build_object('level', v.level,
    'you_opted_in', case when am_a then v.a_opted_in else v.b_opted_in end);
end $$;

-- ═══ 4. AI MATCHMAKER UPGRADE ═════════════════════════════════════════════
-- Fold trait compatibility + time-of-day affinity into the existing score.
-- Still transparent, still no audio, coalesces to 0 when data is absent.
create or replace function match_score(me uuid, them uuid, want text[])
returns numeric language sql security definer stable as $$
  select
    -- shared interests weighted toward tonight's picks
      24.0 * (select count(*)::numeric from unnest(
                coalesce((select interests from profiles where id = them), '{}')) i
              where i = any(want)) / greatest(array_length(want, 1), 1)
    + 12.0 * (select count(*)::numeric from unnest(
                coalesce((select interests from profiles where id = me), '{}')) i
              where i = any(coalesce((select interests from profiles where id = them), '{}')))
             / 10.0
    -- completion rate
    + 14.0 * coalesce((select avg(case when c.end_reason = 'completed' then 1.0 else 0.0 end)
                       from (select end_reason from calls
                             where (caller = them or callee = them) and state = 'ended'
                             order by created_at desc limit 20) c), 0.6)
    -- reciprocal "talk again"
    + 12.0 * coalesce((select avg(case when f.talk_again = 'yes' then 1.0
                                       when f.talk_again = 'maybe' then 0.5 else 0.0 end)
                       from call_feedback f join calls c2 on c2.id = f.call_id
                       where (c2.caller = them or c2.callee = them) and f.rater <> them), 0.5)
    -- language overlap
    + 8.0 * least(1.0, (select count(*)::numeric from unnest(
              coalesce((select languages from profiles where id = me), '{}')) l
            where l = any(coalesce((select languages from profiles where id = them), '{}'))) / 2.0)
    + (case when (select is_verified from profiles where id = them) then 5 else 0 end)
    + (case when not exists (select 1 from calls
        where ((caller = me and callee = them) or (caller = them and callee = me))
          and created_at > now() - interval '30 days') then 6 else 0 end)
    -- NEW · trait compatibility: shared strong traits (>0.5) between us
    + 6.0 * least(1.0, (
        select count(*)::numeric from
          jsonb_each_text(coalesce((select traits from conversation_traits where user_id = me), '{}')) a(k, av)
        join jsonb_each_text(coalesce((select traits from conversation_traits where user_id = them), '{}')) b(k, bv)
          on a.k = b.k
        where av::numeric > 0.5 and bv::numeric > 0.5) / 3.0)
    -- NEW · time-of-day affinity: they're usually active this hour
    + (case when exists (
        select 1 from calls
        where (caller = them or callee = them) and state = 'ended'
          and extract(hour from created_at) = extract(hour from now())) then 4 else 0 end)
$$;
