-- Profile photo + bio
--
-- Adds profile_photo_url and bio to user_onboarding_profiles, and creates a
-- public-read Supabase Storage bucket so pop-ups can render the photo URL
-- directly (no per-request signing). Writes are RLS-gated to each user's own
-- folder: profile-photos/<user_id>/...

alter table public.user_onboarding_profiles
  add column if not exists profile_photo_url text,
  add column if not exists bio text check (char_length(trim(bio)) <= 80);

comment on column public.user_onboarding_profiles.profile_photo_url is
  'Public URL of the user profile photo in the profile-photos storage bucket.';
comment on column public.user_onboarding_profiles.bio is
  'Short self-written line shown in Link Up match pop-ups. UI caps at 50 chars.';

-- ─────────────────────────────────────────────────────────────────────────
-- Storage bucket: public read, owner-only write per folder.
-- ─────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-photos',
  'profile-photos',
  true,
  5242880, -- 5 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Public read: anyone can view a profile photo (pop-ups render client-side).
drop policy if exists "users read profile photos" on storage.objects;
create policy "users read profile photos"
  on storage.objects for select to public
  using (bucket_id = 'profile-photos');

-- Write/update/delete: only the owner of the folder <user_id>/...
drop policy if exists "users upload own profile photo" on storage.objects;
create policy "users upload own profile photo"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users update own profile photo" on storage.objects;
create policy "users update own profile photo"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete own profile photo" on storage.objects;
create policy "users delete own profile photo"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
