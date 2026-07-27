-- Super Like premium gate v11 · run AFTER profile-builder-v10.sql. Safe to re-run.
-- Super Likes are now premium-only (any active tier). The app gates the
-- button client-side; this trigger makes the rule real — a modded client
-- inserting direction='super' gets rejected. Rewind was already gated
-- server-side (REWIND_REQUIRES_PLUS in backend-v4).

create or replace function enforce_super_premium() returns trigger
language plpgsql security definer as $$
begin
  if new.direction = 'super' and not has_active_sub(new.swiper) then
    raise exception 'SUPER_REQUIRES_PREMIUM';
  end if;
  return new;
end $$;
drop trigger if exists trg_super_premium on swipes;
create trigger trg_super_premium before insert on swipes
  for each row execute function enforce_super_premium();
