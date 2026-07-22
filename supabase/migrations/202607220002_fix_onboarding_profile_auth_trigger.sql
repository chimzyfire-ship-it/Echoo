-- auth.users stores provider metadata in raw_app_meta_data (not app_metadata).
-- Referencing the wrong field makes every email signup fail before an OTP can be sent.
create or replace function public.handle_new_user_onboarding_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
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
      nullif(new.raw_user_meta_data ->> 'username', ''),
      nullif(new.raw_user_meta_data ->> 'display_name', ''),
      split_part(coalesce(new.email, ''), '@', 1),
      'User'
    ),
    coalesce(nullif(trim(coalesce(new.raw_user_meta_data ->> 'username', '')), ''), ''),
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
