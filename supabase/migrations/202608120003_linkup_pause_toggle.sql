-- Link Up · pause / opt-out toggle
--
-- Members need a quiet way to step back from Link Up without deleting their
-- account or breaking an in-flight conversation. This adds a per-member
-- status column on the onboarding profile that the Edge Function eligibility
-- gate reads: anything other than 'active' makes the member ineligible to
-- check in or be proposed as a match (their accepted conversations continue
-- to live out their grace window — we never hard-kill a chat from a toggle).
--
-- The column lives on user_onboarding_profiles because that table is already
-- owner-read/owner-updated under RLS, so the settings screen can flip it
-- directly — no new write path, no new Edge Function, no service-role
-- escalation. isUserEligible() in _shared/linkup.ts reads and enforces it.

alter table public.user_onboarding_profiles
  add column if not exists linkup_status text not null default 'active';

-- Backfill is a no-op: the default above already populates existing rows.

alter table public.user_onboarding_profiles
  drop constraint if exists user_onboarding_profiles_linkup_status_check;

alter table public.user_onboarding_profiles
  add constraint user_onboarding_profiles_linkup_status_check
  check (linkup_status in ('active', 'paused', 'opted_out'));

comment on column public.user_onboarding_profiles.linkup_status is
  'Link Up participation state. active = matchable; paused/opted_out = gated out of matching by the member. Enforced by isUserEligible() in _shared/linkup.ts.';
