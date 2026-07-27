-- Like limit v9 · run AFTER interests-v8.sql. Safe to re-run.
-- Loosens the free-tier like limit from 10 per 24h to Tinder-style
-- 50 per rolling 12h (~100/day). Left swipes stay unlimited; active
-- subscribers stay unlimited. Replaces the v4 versions of these functions.

create or replace function enforce_like_limit() returns trigger
language plpgsql security definer as $$
declare cnt int;
begin
  if new.direction in ('like','super') and not has_active_sub(new.swiper) then
    select count(*) into cnt from swipes
      where swiper = new.swiper and direction in ('like','super')
        and created_at > now() - interval '12 hours';
    if cnt >= 50 then
      raise exception 'LIKE_LIMIT_REACHED';
    end if;
  end if;
  return new;
end $$;

-- UI helper: -1 = unlimited (subscriber)
create or replace function daily_likes_remaining() returns int
language sql security definer stable as $$
  select case when has_active_sub(auth.uid()) then -1
    else greatest(0, 50 - (select count(*)::int from swipes
      where swiper = auth.uid() and direction in ('like','super')
        and created_at > now() - interval '12 hours'))
  end;
$$;
