-- Chat media + feedback v7 · run AFTER discovery-v6.sql. Safe to re-run.
-- Adds: photos/GIFs in chat, in-app feedback with a random Boost reward.

-- ── images in messages ───────────────────────────────────────────────────
-- Storage paths look like chat/<match_id>/<file>.jpg (bucket 'photos');
-- GIFs store their https URL directly. body keeps a text fallback ("📷").
alter table messages add column if not exists image_path text;

-- Chat media is visible ONLY to the two people in the match (is_in_match
-- also goes dark when either side blocks — same rule as the messages table).
drop policy if exists "chat media upload" on storage.objects;
create policy "chat media upload" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = 'chat'
    and public.is_in_match(((storage.foldername(name))[2])::uuid)
  );

drop policy if exists "chat media read" on storage.objects;
create policy "chat media read" on storage.objects for select to authenticated
  using (
    bucket_id = 'photos'
    and (storage.foldername(name))[1] = 'chat'
    and public.is_in_match(((storage.foldername(name))[2])::uuid)
  );

-- ── in-app feedback → sometimes a free Boost ─────────────────────────────
-- Store-rating rewards violate Play/App Store policy. Instead we reward
-- IN-APP feedback, with a ~1-in-3 random Boost, independent of sentiment,
-- capped at one lucky roll per 24h.
create table if not exists feedback (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text check (char_length(comment) <= 1000),
  created_at timestamptz not null default now()
);
alter table feedback enable row level security;
drop policy if exists "own feedback" on feedback;
create policy "own feedback" on feedback for insert to authenticated
  with check (auth.uid() = user_id);

create or replace function submit_feedback(r int, c text default null) returns boolean
language plpgsql security definer as $$
declare lucky boolean := false;
declare recent boolean;
begin
  select exists (select 1 from feedback
    where user_id = auth.uid() and created_at > now() - interval '24 hours')
  into recent;
  insert into feedback (user_id, rating, comment) values (auth.uid(), r, c);
  if not recent then
    lucky := random() < 0.34;
    if lucky then
      update profiles set boost_credits = boost_credits + 1 where id = auth.uid();
    end if;
  end if;
  return lucky;
end $$;
