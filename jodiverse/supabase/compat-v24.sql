-- Compatibility v24 · run AFTER semantic-matching-v17.sql. Safe to re-run.
-- The sign-up questionnaire (personality · values/intent · lifestyle) is stored
-- in profiles.compat and folded into match_score, so the voice queue pairs
-- genuinely compatible people. Voice-first is unchanged — this only improves
-- WHO you get connected to.

alter table profiles add column if not exists compat jsonb not null default '{}';

-- match_score = semantic-v17 body + two compatibility terms (lifestyle/vibe fit,
-- and a strong kids-intent signal). Same signature; degrades to 0 when either
-- person hasn't answered, so nothing regresses.
create or replace function match_score(me uuid, them uuid, want text[])
returns numeric language sql security definer stable as $$
  select
      24.0 * (select count(*)::numeric from unnest(
                coalesce((select interests from profiles where id = them), '{}')) i
              where i = any(want)) / greatest(array_length(want, 1), 1)
    + 12.0 * (select count(*)::numeric from unnest(
                coalesce((select interests from profiles where id = me), '{}')) i
              where i = any(coalesce((select interests from profiles where id = them), '{}')))
             / 10.0
    + 14.0 * coalesce((select avg(case when c.end_reason = 'completed' then 1.0 else 0.0 end)
                       from (select end_reason from calls
                             where (caller = them or callee = them) and state = 'ended'
                             order by created_at desc limit 20) c), 0.6)
    + 12.0 * coalesce((select avg(case when f.talk_again = 'yes' then 1.0
                                       when f.talk_again = 'maybe' then 0.5 else 0.0 end)
                       from call_feedback f join calls c2 on c2.id = f.call_id
                       where (c2.caller = them or c2.callee = them) and f.rater <> them), 0.5)
    + 8.0 * least(1.0, (select count(*)::numeric from unnest(
              coalesce((select languages from profiles where id = me), '{}')) l
            where l = any(coalesce((select languages from profiles where id = them), '{}'))) / 2.0)
    + (case when (select is_verified from profiles where id = them) then 5 else 0 end)
    + (case when not exists (select 1 from calls
        where ((caller = me and callee = them) or (caller = them and callee = me))
          and created_at > now() - interval '30 days') then 6 else 0 end)
    + 6.0 * least(1.0, (
        select count(*)::numeric from
          jsonb_each_text(coalesce((select traits from conversation_traits where user_id = me), '{}')) a(k, av)
        join jsonb_each_text(coalesce((select traits from conversation_traits where user_id = them), '{}')) b(k, bv)
          on a.k = b.k
        where av::numeric > 0.5 and bv::numeric > 0.5) / 3.0)
    + (case when exists (
        select 1 from calls
        where (caller = them or callee = them) and state = 'ended'
          and extract(hour from created_at) = extract(hour from now())) then 4 else 0 end)
    + 20.0 * interest_similarity(me, them)
    -- NEW · lifestyle/personality fit from the sign-up questionnaire (0..12)
    + 12.0 * coalesce((
        select (
            (case when mp.compat->>'social'  = tp.compat->>'social'  then 1 else 0 end)
          + (case when mp.compat->>'vibe'    = tp.compat->>'vibe'    then 1 else 0 end)
          + (case when mp.compat->>'family'  = tp.compat->>'family'  then 1 else 0 end)
          + (case when mp.compat->>'clock'   = tp.compat->>'clock'   then 1 else 0 end)
          + (case when mp.compat->>'fitness' = tp.compat->>'fitness' then 1 else 0 end)
          + (case when mp.compat->>'weekend' = tp.compat->>'weekend' then 1 else 0 end)
        )::numeric / 6.0
        from profiles mp, profiles tp where mp.id = me and tp.id = them), 0)
    -- NEW · kids intent — a strong signal: aligned = +6, clash = −6
    + coalesce((
        select case
          when mp.compat->>'kids' = tp.compat->>'kids' then 6
          when mp.compat->>'kids' = 'open' or tp.compat->>'kids' = 'open' then 3
          when mp.compat->>'kids' in ('yes','no') and tp.compat->>'kids' in ('yes','no')
               and mp.compat->>'kids' <> tp.compat->>'kids' then -6
          else 0 end
        from profiles mp, profiles tp where mp.id = me and tp.id = them), 0)
$$;
