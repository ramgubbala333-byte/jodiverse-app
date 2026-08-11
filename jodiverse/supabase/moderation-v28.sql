-- Photo moderation + block list · v28 · run AFTER admin-v27.sql. Safe to re-run.
--
-- Two launch blockers:
--   1. Uploaded photos were never screened. Both app stores treat an
--      un-moderated UGC image feed in a dating app as a rejection reason,
--      and it's a genuine safety hole regardless of the stores.
--   2. The block list existed as a table but had no way to see or undo blocks.
--
-- Design: photos default to 'pending' and are HIDDEN until cleared. The
-- moderate-photo edge function auto-approves clean images via Google Cloud
-- Vision SafeSearch; anything flagged goes to a human queue in the admin
-- console. Fails CLOSED — if moderation never runs, the photo stays hidden.

-- ═══ 1. MODERATION STATE ON PHOTOS ════════════════════════════════════════
alter table photos add column if not exists moderation text not null default 'pending'
  check (moderation in ('pending','approved','rejected','flagged'));
alter table photos add column if not exists moderation_reason text;
alter table photos add column if not exists moderated_at timestamptz;
create index if not exists photos_moderation_idx on photos (moderation, created_at desc);

-- Existing photos predate moderation. Grandfather them in rather than
-- blanking every profile the moment this runs.
update photos set moderation = 'approved', moderated_at = now()
  where moderation = 'pending' and created_at < now() - interval '1 minute';

-- Only approved photos are visible to anyone but the owner. The owner always
-- sees their own (so they know a photo is pending or was rejected).
drop policy if exists "read active users photo rows" on public.photos;
create policy "read active users photo rows" on public.photos for select to authenticated
  using (
    owner = auth.uid()
    or (moderation = 'approved' and public.profile_is_active(owner))
  );

-- ═══ 2. ADMIN REVIEW QUEUE ════════════════════════════════════════════════
drop function if exists admin_photo_queue(int) cascade;
create or replace function admin_photo_queue(lim int default 40)
returns table (id uuid, owner uuid, owner_name text, storage_path text,
               moderation text, moderation_reason text, created_at timestamptz)
language sql security definer stable as $$
  select ph.id, ph.owner, p.display_name, ph.storage_path,
         ph.moderation, ph.moderation_reason, ph.created_at
  from photos ph
  left join profiles p on p.id = ph.owner
  where is_admin() and ph.moderation in ('flagged','pending')
  order by (ph.moderation = 'flagged') desc, ph.created_at asc
  limit greatest(lim, 1);
$$;

drop function if exists admin_moderate_photo(uuid, boolean, text) cascade;
create or replace function admin_moderate_photo(p_id uuid, p_approve boolean,
                                                p_reason text default null)
returns void language plpgsql security definer as $$
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  update photos
     set moderation = case when p_approve then 'approved' else 'rejected' end,
         moderation_reason = p_reason,
         moderated_at = now()
   where id = p_id;
end $$;

-- Counts for the dashboard header.
create or replace function admin_moderation_stats() returns jsonb
language plpgsql security definer stable as $$
declare r jsonb;
begin
  if not is_admin() then raise exception 'NOT_ADMIN'; end if;
  select jsonb_build_object(
    'pending',  (select count(*) from photos where moderation = 'pending'),
    'flagged',  (select count(*) from photos where moderation = 'flagged'),
    'rejected', (select count(*) from photos where moderation = 'rejected'),
    'approved', (select count(*) from photos where moderation = 'approved')
  ) into r; return r;
end $$;

-- ═══ 3. BLOCK LIST — see and undo your blocks ═════════════════════════════
-- `blocks` already exists with a "manage own blocks" policy, but nothing in
-- the app could list them, so a mistaken block was permanent and invisible.
drop function if exists my_blocks() cascade;
create or replace function my_blocks()
returns table (blocked uuid, name text, city text, created_at timestamptz)
language sql security definer stable as $$
  select b.blocked, p.display_name, p.city, b.created_at
  from blocks b
  join profiles p on p.id = b.blocked
  where b.blocker = auth.uid()
  order by b.created_at desc;
$$;

-- Unblock. Deliberately does NOT restore the match — if they unmatched or
-- were reported, that stays undone; they simply become visible again.
create or replace function unblock(p_user uuid) returns void
language plpgsql security definer as $$
begin
  delete from blocks where blocker = auth.uid() and blocked = p_user;
end $$;

-- ═══ 4. ADMIN CAN READ ANY PHOTO OBJECT ═══════════════════════════════════
-- The review queue signs URLs for photos it must judge, and those are exactly
-- the photos the normal policies hide: "read active users photos" only covers
-- ACTIVE owners, and a brand-new (still unverified, therefore inactive) user
-- is the most likely source of something needing review. Without this the
-- queue renders every tile as a broken image.
drop policy if exists "admin reads all photos" on storage.objects;
create policy "admin reads all photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.is_admin());

-- ═══ 5. DATA EXPORT — the "Download my data" right ════════════════════════
-- GDPR art. 20 / DPDP: a member can demand a machine-readable copy of what we
-- hold on them, and the privacy policy now promises one. Scoped to auth.uid()
-- so it can never be pointed at somebody else's account.
--
-- Photos are exported as storage paths, not bytes — the client signs them and
-- downloads separately. Inlining base64 images would blow past the statement
-- timeout for anyone with a full profile.
drop function if exists export_my_data() cascade;
create or replace function export_my_data() returns jsonb
language plpgsql security definer stable as $$
declare me uuid := auth.uid(); r jsonb;
begin
  if me is null then raise exception 'NOT_AUTHENTICATED'; end if;
  select jsonb_build_object(
    'exported_at', now(),
    'account', (select to_jsonb(p) - 'interest_embedding'
                from profiles p where p.id = me),
    'photos', coalesce((select jsonb_agg(jsonb_build_object(
                  'storage_path', storage_path, 'position', position,
                  'moderation', moderation, 'created_at', created_at))
                from photos where owner = me), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(jsonb_build_object(
                  'match_id', m.id, 'with', case when m.a = me then m.b else m.a end,
                  'created_at', m.created_at, 'unmatched', m.unmatched))
                from matches m where m.a = me or m.b = me), '[]'::jsonb),
    'messages_sent', coalesce((select jsonb_agg(jsonb_build_object(
                  'match_id', match_id, 'body', body,
                  'image_path', image_path, 'created_at', created_at)
                  order by created_at)
                from messages where sender = me), '[]'::jsonb),
    'likes_given', coalesce((select jsonb_agg(jsonb_build_object(
                  'swipee', swipee, 'direction', direction,
                  'note', note, 'created_at', created_at))
                from swipes where swiper = me), '[]'::jsonb),
    'blocks', coalesce((select jsonb_agg(jsonb_build_object(
                  'blocked', blocked, 'created_at', created_at))
                from blocks where blocker = me), '[]'::jsonb),
    'reports_filed', coalesce((select jsonb_agg(jsonb_build_object(
                  'reported', reported, 'reason', reason,
                  'detail', detail, 'created_at', created_at))
                from reports where reporter = me), '[]'::jsonb),
    'subscription', (select to_jsonb(s) from subscriptions s where s.user_id = me)
  ) into r;
  return r;
end $$;
