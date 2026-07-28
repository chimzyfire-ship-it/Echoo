-- Username is an Echoo identity, while Supabase remains the authority for
-- credentials. Keep newly-created usernames predictable and unique without
-- invalidating historical profiles that predate this rule.
alter table public.user_onboarding_profiles
  drop constraint if exists user_onboarding_profiles_username_format;

alter table public.user_onboarding_profiles
  add constraint user_onboarding_profiles_username_format
  check (username = '' or username ~ '^[a-z0-9_]{3,24}$') not valid;

create or replace function public.handle_new_user_onboarding_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  normalized_username text := lower(
    regexp_replace(
      coalesce(new.raw_user_meta_data ->> 'username', ''),
      '[^a-zA-Z0-9_]+',
      '',
      'g'
    )
  );
begin
  if normalized_username !~ '^[a-z0-9_]{3,24}$' then
    normalized_username := '';
  end if;

  insert into public.user_onboarding_profiles (
    user_id,
    display_name,
    username,
    email,
    metadata
  )
  values (
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      nullif(normalized_username, ''),
      split_part(coalesce(new.email, ''), '@', 1),
      'User'
    ),
    normalized_username,
    coalesce(new.email, ''),
    jsonb_build_object(
      'source', 'auth_signup',
      'auth_provider', coalesce(new.raw_app_meta_data ->> 'provider', 'email')
    )
  )
  on conflict (user_id) do update
  set
    display_name = excluded.display_name,
    username = excluded.username,
    email = excluded.email,
    metadata = public.user_onboarding_profiles.metadata || excluded.metadata,
    updated_at = now();

  return new;
end;
$$;
