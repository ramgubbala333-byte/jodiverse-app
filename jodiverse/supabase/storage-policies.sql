-- Photo access policies · run once in the Supabase SQL Editor.
-- Bucket 'photos' stays PRIVATE — everything below only enables signed-URL
-- access for authenticated users; there are still no public URLs.
--
-- Layout convention: photos/<user-id>/<uuid>.jpg  (first folder = owner id)

-- Own photos: upload / read / delete.
create policy "upload own photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "read own photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "delete own photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- Deck photos: any signed-in user may view photos belonging to ACTIVE
-- (verified) profiles. Dev shortcut standing in for the planned Edge Function
-- that will also check deck eligibility / blocks before signing URLs.
--
-- NOTE: the check must go through a SECURITY DEFINER helper — a plain
-- subquery on profiles would itself be subject to profiles RLS ("read own
-- profile" only) and always return false for strangers.
create or replace function public.profile_is_active(uid uuid) returns boolean
language sql security definer stable
set search_path = public as $$
  select exists (select 1 from profiles where id = uid and is_active);
$$;

create policy "read active users photos" on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and public.profile_is_active(((storage.foldername(name))[1])::uuid)
  );

-- Matching row-level access on the photos metadata table, so the deck can
-- list strangers' photo paths (owner-only policy already exists for writes).
create policy "read active users photo rows" on public.photos for select to authenticated
  using (public.profile_is_active(owner));
