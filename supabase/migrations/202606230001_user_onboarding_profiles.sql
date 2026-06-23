create table if not exists public.user_onboarding_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  email text not null default '',
  interests text[] not null default '{}',
  event_styles text[] not null default '{}',
  audiences text[] not null default '{}',
  motivations text[] not null default '{}',
  budget text not null default '$',
  energy text not null default 'chill',
  home_city text not null default 'Toronto',
  gender text not null default 'Prefer not to say',
  date_of_birth date,
  tone text not null default 'direct',
  personality_signals jsonb not null default '{}',
  profile_version integer not null default 1,
  completed_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_onboarding_profiles_budget_check
    check (budget in ('$', '$$', '$$$')),
  constraint user_onboarding_profiles_energy_check
    check (energy in ('chill', 'hype', 'curious')),
  constraint user_onboarding_profiles_tone_check
    check (tone in ('direct', 'detailed')),
  constraint user_onboarding_profiles_profile_version_check
    check (profile_version > 0)
);

create index if not exists user_onboarding_profiles_home_city_idx
  on public.user_onboarding_profiles (home_city);

create index if not exists user_onboarding_profiles_completed_at_idx
  on public.user_onboarding_profiles (completed_at)
  where completed_at is not null;

create index if not exists user_onboarding_profiles_interests_gin
  on public.user_onboarding_profiles using gin (interests);

create index if not exists user_onboarding_profiles_event_styles_gin
  on public.user_onboarding_profiles using gin (event_styles);

create index if not exists user_onboarding_profiles_motivations_gin
  on public.user_onboarding_profiles using gin (motivations);

drop trigger if exists user_onboarding_profiles_touch_updated_at
  on public.user_onboarding_profiles;
create trigger user_onboarding_profiles_touch_updated_at
before update on public.user_onboarding_profiles
for each row execute function public.touch_updated_at();

alter table public.user_onboarding_profiles enable row level security;

drop policy if exists "users read own onboarding profile"
  on public.user_onboarding_profiles;
create policy "users read own onboarding profile"
on public.user_onboarding_profiles
for select
using (auth.uid() = user_id);

drop policy if exists "users create own onboarding profile"
  on public.user_onboarding_profiles;
create policy "users create own onboarding profile"
on public.user_onboarding_profiles
for insert
with check (auth.uid() = user_id);

drop policy if exists "users update own onboarding profile"
  on public.user_onboarding_profiles;
create policy "users update own onboarding profile"
on public.user_onboarding_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
