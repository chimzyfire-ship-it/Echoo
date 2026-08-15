-- Link Up · ghost mode
--
-- Invariant 10: participation is a member state with three values —
-- active / paused / ghost. Ghost members keep their presence and their
-- conversations, but are excluded from NEW matching in both directions:
--   - their own check-ins do not scan for candidates
--   - they are skipped as candidates for others' check-ins
-- The exclusion is enforced in linkup-presence via isUserEligible (anything
-- other than 'active' is ineligible) — ghost only changes that check-ins
-- keep an existing presence alive instead of being rejected outright.

alter table public.user_onboarding_profiles
  drop constraint if exists user_onboarding_profiles_linkup_status_check;

alter table public.user_onboarding_profiles
  add constraint user_onboarding_profiles_linkup_status_check
  check (linkup_status in ('active', 'paused', 'opted_out', 'ghost'));
