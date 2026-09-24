-- Recover new accounts that completed onboarding after PR #139 merged but
-- before the enrolment trigger was deployed. Never enrol established members,
-- and never reset an introduction that was already claimed.
insert into public.first_use_walkthroughs(user_id)
select p.user_id
from public.user_onboarding_profiles p
join auth.users u on u.id = p.user_id
where u.created_at >= timestamptz '2026-09-23 08:30:57+00'
  and p.completed_at is not null
on conflict (user_id) do nothing;
