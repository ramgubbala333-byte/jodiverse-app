-- Chat hardening · v30 · run after moderation-v28.sql. Safe to re-run.
--
-- The "mark read" policy exists so the RECIPIENT can stamp read_at:
--
--   create policy "mark read" on messages for update
--     using (is_in_match(match_id) and sender <> auth.uid());
--
-- It has no WITH CHECK, and RLS cannot be scoped to a column — so the policy
-- that was meant to allow "set read_at" actually allows the other person in the
-- match to UPDATE ANY COLUMN of your messages, including rewriting `body` and
-- swapping `image_path`. Someone could edit what you said and then screenshot
-- it. A trigger is the only way to restrict this to the one intended column.

create or replace function guard_message_update() returns trigger
language plpgsql as $$
begin
  -- The sender may still edit nothing; nobody may rewrite history. Only the
  -- read receipt is allowed to change, and only from null to a timestamp.
  if new.id         is distinct from old.id
     or new.match_id is distinct from old.match_id
     or new.sender   is distinct from old.sender
     or new.body     is distinct from old.body
     or new.image_path is distinct from old.image_path
     or new.created_at is distinct from old.created_at then
    raise exception 'MESSAGE_IMMUTABLE';
  end if;

  -- Read receipts only move forward. Re-marking an already-read message as
  -- unread would let someone hide that they had seen it.
  if old.read_at is not null and new.read_at is distinct from old.read_at then
    new.read_at := old.read_at;
  end if;

  return new;
end $$;

drop trigger if exists trg_guard_message_update on messages;
create trigger trg_guard_message_update
  before update on messages
  for each row execute function guard_message_update();

-- Read receipts arrive over realtime UPDATE. Postgres only ships the changed
-- row for updates when the table has a replica identity the decoder can use;
-- the primary key is enough here and is cheaper than REPLICA IDENTITY FULL.
alter table messages replica identity default;
