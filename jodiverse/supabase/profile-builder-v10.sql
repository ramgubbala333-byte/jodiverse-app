-- Smart Profile Builder v10 · run AFTER like-limit-v9.sql. Safe to re-run.
-- Adds the LoveAI-style builder fields: education, values, fun facts and a
-- lifestyle tag. values/fun facts feed the AI bio generator (generate-profile
-- edge function) and stay PRIVATE; education + lifestyle show on profiles.

alter table profiles add column if not exists education text;
alter table profiles add column if not exists values_text text;
alter table profiles add column if not exists fun_facts text;
alter table profiles add column if not exists lifestyle text;

alter table profiles drop constraint if exists education_len;
alter table profiles add constraint education_len
  check (education is null or char_length(education) <= 120);
alter table profiles drop constraint if exists values_text_len;
alter table profiles add constraint values_text_len
  check (values_text is null or char_length(values_text) <= 500);
alter table profiles drop constraint if exists fun_facts_len;
alter table profiles add constraint fun_facts_len
  check (fun_facts is null or char_length(fun_facts) <= 500);

-- Expose only the public-safe fields (create or replace APPENDS columns).
create or replace view public_profiles with (security_invoker = off) as
  select id, display_name,
         date_part('year', age(birthdate))::int as age,
         gender, bio, city, faith, languages, diet,
         relationship_goal, is_verified,
         interests,
         (created_at > now() - interval '14 days') as new_here,
         drinking, smoking, height_cm, occupation,
         case
           when not show_last_active then null
           when last_seen > now() - interval '15 minutes' then 'Online'
           when last_seen > now() - interval '24 hours'   then 'Active today'
           when last_seen > now() - interval '7 days'     then 'Active this week'
           else null
         end as activity_status,
         video_path, audio_path,
         education, lifestyle
  from profiles where is_active = true;
