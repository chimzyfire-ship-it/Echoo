-- Extend linkup_peer_profile to also return profile_photo_url and bio so the
-- match pop-up can render the peer's photo + self-written line.
--
-- Changing the return signature requires a drop + recreate.

drop function if exists public.linkup_peer_profile(uuid);

create or replace function public.linkup_peer_profile(target_user uuid)
returns table (
  display_name text,
  username text,
  home_city text,
  interests text[],
  event_styles text[],
  energy text,
  motivations text[],
  profile_photo_url text,
  bio text
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
    p.motivations,
    p.profile_photo_url,
    p.bio
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
  'Returns share-safe profile fields for a Link Up match peer, including
   photo + bio. Only callable when the caller shares an active/pending/accepted
   match with the target.';
