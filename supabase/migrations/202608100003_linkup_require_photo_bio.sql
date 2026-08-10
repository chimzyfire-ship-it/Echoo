-- Link Up · photo + bio match requirement (documentation)
--
-- Enforcing "a user must have a profile photo and a bio to be matched" is
-- done in the application layer (supabase/functions/_shared/linkup.ts,
-- isUserEligible), not via a SQL constraint — because the gate is advisory
-- for general onboarding completeness but mandatory specifically for Link Up
-- matching. This migration exists so the requirement is documented in the
-- migration history and visible to anyone reading the schema evolution.

comment on column public.user_onboarding_profiles.profile_photo_url is
  'Public URL of the user profile photo. Required for Link Up matching.';
comment on column public.user_onboarding_profiles.bio is
  'Short self-written line shown in Link Up match pop-ups (UI caps 50 chars).
   Required for Link Up matching.';
