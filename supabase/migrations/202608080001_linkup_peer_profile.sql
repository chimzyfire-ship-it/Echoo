-- Link Up · peer profile accessor
--
-- The onboarding profile table is owner-read only (correctly). But the match
-- pop-up needs to show the OTHER member's display name + a one-line cue. This
-- security definer function exposes only the minimal, share-safe fields, and
-- only when the caller shares an active/pending/accepted Link Up match with
-- the target — so onboarding data stays private outside of an actual match.

drop function if exists public.linkup_peer_profile(uuid);

create or replace function public.linkup_peer_profile(target_user uuid)
returns table (
  display_name text,
  username text,
  home_city text,
  interests text[],
  event_styles text[],
  energy text,
  motivations text[]
)
language sql
security definer
set search_path = public
as $$
  select
    p.display_name,
    p.username,
    p.home_city,
    p.interests,
    p.event_styles,
    p.energy,
    p.motivations
  from public.user_onboarding_profiles p
  where p.user_id = target_user
    and exists (
      -- Caller must share a non-terminal match with the target.
      select 1
      from public.linkup_match_members mine
      join public.linkup_match_members theirs
        on theirs.match_id = mine.match_id
      join public.linkup_matches m on m.id = mine.match_id
      where mine.user_id = auth.uid()
        and theirs.user_id = target_user
        and m.status in ('pending', 'accepted')
    );
$$;

comment on function public.linkup_peer_profile is
  'Returns share-safe profile fields for a Link Up match peer. Only callable
   when the caller shares an active/pending/accepted match with the target.';
