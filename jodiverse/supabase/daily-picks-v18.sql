-- Daily picks v18 · run AFTER semantic-matching-v17.sql. Safe to re-run.
-- P2 "Today's picks": up to 3 people you'd most click with today, each with an
-- HONEST, metadata-only reason (shared interests / language / vibe). Never uses
-- appearance or audio content — same privacy rule as traits & date-readiness.
--
-- Candidates are filtered through the SAME eligibility as live matching
-- (voice_compatible): active, unpaused, age + gender prefs both ways, not
-- blocked, has calls left. We also exclude people you already matched with or
-- called in the last 3 days, then rank by match_score (which now includes the
-- v17 semantic term). Photos are never returned — voice-first, reveal-gated.

create or replace function daily_picks()
returns table (
  id uuid,
  name text,
  age int,
  city text,
  shared_interests text[],
  reason text,
  score numeric
)
language plpgsql security definer stable as $$
declare
  me uuid := auth.uid();
  my_ints text[];
begin
  select coalesce(interests, '{}') into my_ints from profiles where id = me;

  return query
  with cand as (
    select
      p.id,
      p.display_name as nm,
      date_part('year', age(p.birthdate))::int as ag,
      p.city as ct,
      (select array_agg(i) from unnest(coalesce(p.interests, '{}')) i
        where i = any(my_ints)) as shared,
      (select count(*) from unnest(coalesce(p.languages, '{}')) l
        where l = any(coalesce((select languages from profiles where id = me), '{}'))) as shared_langs,
      match_score(me, p.id, my_ints) as sc
    from profiles p
    where p.id <> me
      and voice_compatible(me, p.id)
      and not exists (
        select 1 from matches m
        where m.unmatched = false
          and ((m.a = me and m.b = p.id) or (m.a = p.id and m.b = me)))
      and not exists (
        select 1 from calls c
        where ((c.caller = me and c.callee = p.id) or (c.caller = p.id and c.callee = me))
          and c.created_at > now() - interval '3 days')
    order by sc desc
    limit 3
  )
  select
    c.id,
    c.nm,
    c.ag,
    c.ct,
    coalesce(c.shared, '{}')::text[],
    case
      when coalesce(array_length(c.shared, 1), 0) >= 2
        then 'You both love ' || c.shared[1] || ' and ' || c.shared[2]
      when coalesce(array_length(c.shared, 1), 0) = 1
        then 'You both love ' || c.shared[1]
      when c.shared_langs > 0
        then 'You speak the same language and share a similar vibe'
      else 'Your interests and conversation style line up'
    end as reason,
    round(c.sc, 1)
  from cand c
  order by c.sc desc;
end $$;
