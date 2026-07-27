-- Lounges + anti-ghosting v15 · run AFTER intelligence-v14.sql. Safe to re-run.
--   • Interest Lounges — live topic rooms (listen / raise hand / speak / invite).
--     Room presence + data are real; group AUDIO is simulated until an SFU ships.
--   • Anti-ghosting — surface matches that went quiet so people re-connect.

-- Allow calls that start from a lounge invite.
alter table calls drop constraint if exists calls_source_check;
alter table calls add constraint calls_source_check
  check (source in ('queue','scheduled','rematch','lounge'));

-- ═══ 1. LOUNGES ═══════════════════════════════════════════════════════════
create table if not exists lounges (
  id         uuid primary key default gen_random_uuid(),
  topic      text not null unique,
  title      text not null,
  room       text not null,
  is_live    boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists lounge_participants (
  lounge_id   uuid references lounges(id) on delete cascade,
  user_id     uuid references profiles(id) on delete cascade,
  role        text not null default 'listener'
              check (role in ('host','speaker','listener')),
  hand_raised boolean not null default false,
  joined_at   timestamptz not null default now(),
  primary key (lounge_id, user_id)
);
create index if not exists lounge_part_user_idx on lounge_participants (user_id);
alter table lounges enable row level security;
alter table lounge_participants enable row level security;
drop policy if exists "read lounges" on lounges;
create policy "read lounges" on lounges for select using (true);
drop policy if exists "read participants" on lounge_participants;
create policy "read participants" on lounge_participants for select using (true);
drop policy if exists "own participation" on lounge_participants;
create policy "own participation" on lounge_participants
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Fixed topic set; rows are created on first listing. Returns live counts.
create or replace function list_lounges()
returns table (id uuid, topic text, title text, listeners int, speakers int)
language plpgsql security definer as $$
declare t record;
begin
  for t in select * from (values
    ('travel','Travel & wanderlust'), ('music','Music lovers'),
    ('movies','Movies & shows'), ('fitness','Fitness & health'),
    ('food','Foodies'), ('books','Books & reading'),
    ('gaming','Gaming'), ('cricket','Cricket'),
    ('startups','Startups & hustle'), ('anime','Anime'),
    ('finance','Money & investing'), ('football','Football')
  ) as x(topic, title) loop
    insert into lounges (topic, title, room)
    values (t.topic, t.title, 'lounge_' || t.topic)
    on conflict (topic) do nothing;
  end loop;

  return query
    select l.id, l.topic, l.title,
      (select count(*)::int from lounge_participants lp
        where lp.lounge_id = l.id and lp.role = 'listener'),
      (select count(*)::int from lounge_participants lp
        where lp.lounge_id = l.id and lp.role in ('host','speaker'))
    from lounges l where l.is_live
    order by (select count(*) from lounge_participants lp where lp.lounge_id = l.id) desc,
             l.title;
end $$;

-- Join as a listener. First person in becomes the host.
create or replace function join_lounge(p_lounge uuid)
returns jsonb language plpgsql security definer as $$
declare v_room text; v_count int; v_role text;
begin
  select room into v_room from lounges where id = p_lounge and is_live;
  if v_room is null then raise exception 'NO_SUCH_LOUNGE'; end if;
  select count(*) into v_count from lounge_participants where lounge_id = p_lounge;
  v_role := case when v_count = 0 then 'host' else 'listener' end;

  insert into lounge_participants (lounge_id, user_id, role)
  values (p_lounge, auth.uid(), v_role)
  on conflict (lounge_id, user_id) do update set role = lounge_participants.role;

  return jsonb_build_object('room', v_room, 'role',
    (select role from lounge_participants where lounge_id = p_lounge and user_id = auth.uid()));
end $$;

create or replace function leave_lounge(p_lounge uuid) returns void
language sql security definer as $$
  delete from lounge_participants where lounge_id = p_lounge and user_id = auth.uid();
$$;

create or replace function raise_hand(p_lounge uuid, p_raised boolean) returns void
language sql security definer as $$
  update lounge_participants set hand_raised = p_raised
   where lounge_id = p_lounge and user_id = auth.uid();
$$;

-- Self-serve step onto the mic (cap 8 speakers until real moderation ships).
create or replace function become_speaker(p_lounge uuid) returns jsonb
language plpgsql security definer as $$
declare v_speakers int;
begin
  select count(*) into v_speakers from lounge_participants
   where lounge_id = p_lounge and role in ('host','speaker');
  if v_speakers >= 8 then return jsonb_build_object('ok', false, 'reason', 'stage_full'); end if;
  update lounge_participants set role = 'speaker', hand_raised = false
   where lounge_id = p_lounge and user_id = auth.uid() and role = 'listener';
  return jsonb_build_object('ok', true);
end $$;

-- Room roster for the lounge screen.
create or replace function lounge_members(p_lounge uuid)
returns table (user_id uuid, name text, role text, hand_raised boolean, is_verified boolean)
language sql security definer stable as $$
  select lp.user_id, p.display_name, lp.role, lp.hand_raised, p.is_verified
  from lounge_participants lp join profiles p on p.id = lp.user_id
  where lp.lounge_id = p_lounge
  order by case lp.role when 'host' then 0 when 'speaker' then 1 else 2 end,
           lp.hand_raised desc, lp.joined_at;
$$;

-- Invite someone from a lounge into a private 1:1 voice call.
create or replace function invite_to_call(other uuid) returns uuid
language plpgsql security definer as $$
declare v_call uuid; v_room text; v_budget int;
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
  v_budget := least(per_call_cap(), talk_available(auth.uid()), talk_available(other));
  if v_budget <= 0 then raise exception 'NO_TALK_TIME'; end if;

  v_room := 'call_' || replace(gen_random_uuid()::text, '-', '');
  insert into calls (caller, callee, room, source, max_minutes, budget_seconds)
  values (auth.uid(), other, v_room, 'lounge', ceil(v_budget / 60.0)::int, v_budget)
  returning id into v_call;
  return v_call;
end $$;

-- ═══ 2. ANTI-GHOSTING ═════════════════════════════════════════════════════
-- Matches that both people wanted (they exist because of mutual "talk again")
-- but that have gone silent for 24h+. Returns a shared interest to seed an
-- opener. The client surfaces these as a gentle nudge, never a penalty.
create or replace function stale_matches()
returns table (match_id uuid, other_id uuid, other_name text,
               shared_interest text, matched_at timestamptz)
language sql security definer stable as $$
  with mine as (
    select m.id, m.created_at,
           case when m.a = auth.uid() then m.b else m.a end as other
    from matches m
    where (m.a = auth.uid() or m.b = auth.uid())
      and coalesce(m.unmatched, false) = false
      and m.created_at < now() - interval '24 hours'
      and not exists (select 1 from messages msg where msg.match_id = m.id)
  )
  select mine.id, mine.other, p.display_name,
    (select i from unnest(coalesce(
        (select interests from profiles where id = auth.uid()), '{}')) i
      where i = any(coalesce(p.interests, '{}')) limit 1),
    mine.created_at
  from mine join profiles p on p.id = mine.other
  order by mine.created_at desc
  limit 5;
$$;
