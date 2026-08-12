-- Push webhook · v29 · fires notify-message on every new chat message.
--
-- This is the SQL equivalent of Dashboard → Database → Webhooks, with one
-- deliberate difference: the dashboard writes your SERVICE ROLE KEY as a
-- literal string inside the trigger definition, where it shows up in
-- pg_get_triggerdef, pg_dump, and any schema diff. Here it lives in Vault and
-- is read at call time instead.
--
-- ─── BEFORE RUNNING ───────────────────────────────────────────────────────
-- Replace PASTE_SERVICE_ROLE_KEY_HERE below with the service_role key from
-- Settings → API. Run this in the SQL editor. Do NOT commit the filled-in
-- version — this file is in git.
-- ──────────────────────────────────────────────────────────────────────────

-- pg_net pins its own schema (`net`), so no `with schema` clause here — adding
-- one errors on some versions. Likely already enabled; this is then a no-op.
create extension if not exists pg_net;

-- Store (or rotate) the key. create_secret throws on a duplicate name, so
-- update in place when it already exists — this script must be re-runnable.
do $$
declare existing uuid;
begin
  select id into existing from vault.secrets where name = 'notify_message_key';
  if existing is null then
    perform vault.create_secret(
      'PASTE_SERVICE_ROLE_KEY_HERE',
      'notify_message_key',
      'Service role key used by the notify-message push webhook');
  else
    perform vault.update_secret(existing, 'PASTE_SERVICE_ROLE_KEY_HERE');
  end if;
end $$;

-- net.http_post QUEUES the request and returns immediately, so sending a
-- message never waits on Expo's push service. A failed push must not be able
-- to fail the INSERT — hence the exception swallow as well.
create or replace function trg_notify_message() returns trigger
language plpgsql security definer set search_path = public, extensions, vault as $$
declare k text;
begin
  select decrypted_secret into k
    from vault.decrypted_secrets where name = 'notify_message_key';
  if k is null then return new; end if;

  perform net.http_post(
    url := 'https://yqkvgbbordwurtgnyyxi.supabase.co/functions/v1/notify-message',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || k),
    -- notify-message reads payload.record — same shape the dashboard sends.
    body := jsonb_build_object('type', 'INSERT', 'table', 'messages',
                               'record', to_jsonb(new)),
    timeout_milliseconds := 5000
  );
  return new;
exception when others then
  return new; -- a broken push must never block a message from being sent
end $$;

drop trigger if exists notify_message on public.messages;
create trigger notify_message after insert on public.messages
  for each row execute function trg_notify_message();

-- ─── VERIFY ───────────────────────────────────────────────────────────────
-- Send a message between two test accounts, then:
--
--   select id, status_code, error_msg, content, created
--     from net._http_response order by created desc limit 5;
--
-- (No `url` column on this table — the queue row carrying the URL is dropped
--  once the response lands.)
--
-- 200 with {"ok":true,"pushed":false} = everything works, device just has no
-- token yet (expected until the dev build — push is dead in Expo Go).
-- 401 = the key in Vault is wrong. 404 = function not deployed.
-- No rows at all = the trigger never fired; check it exists:
--   select tgname, tgenabled from pg_trigger
--    where tgrelid = 'public.messages'::regclass and not tgisinternal;
