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
    coalesce(new.email, ''),
    jsonb_build_object(
      'source', 'auth_signup',
      'auth_provider', coalesce(new.app_metadata ->> 'provider', 'email')
    )
  )
  on conflict (user_id) do update
  set
    display_name = excluded.display_name,
    email = excluded.email,
    metadata = public.user_onboarding_profiles.metadata || excluded.metadata,
    updated_at = now();

  return new;
end;
$$;

alter table public.user_onboarding_profiles
  add column if not exists username text not null default '';

create unique index if not exists user_onboarding_profiles_username_key
  on public.user_onboarding_profiles (lower(username))
  where username <> '';

drop trigger if exists on_auth_user_created_onboarding_profile on auth.users;
create trigger on_auth_user_created_onboarding_profile
after insert on auth.users
for each row execute function public.handle_new_user_onboarding_profile();

create or replace function public.lookup_email_by_username(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select email
  from public.user_onboarding_profiles
  where lower(username) = lower(trim(p_username))
    and username <> ''
  limit 1;
$$;
