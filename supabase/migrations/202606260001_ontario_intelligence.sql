-- Echoo Ontario-first local intelligence layer.
-- Extends the existing Canada-first location platform without replacing it.

do $$
begin
  create type public.review_status as enum ('pending', 'approved', 'rejected', 'needs_update');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.enrichment_job_status as enum ('queued', 'running', 'completed', 'failed', 'skipped');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.place_profiles (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.canonical_places(id) on delete cascade,
  vibe_tags text[] not null default '{}',
  good_for text[] not null default '{}',
  meal_tags text[] not null default '{}',
  activity_tags text[] not null default '{}',
  noise_level text,
  price_band text,
  lunch_score numeric(4, 3),
  date_score numeric(4, 3),
  group_score numeric(4, 3),
  solo_score numeric(4, 3),
  family_score numeric(4, 3),
  rainy_day_score numeric(4, 3),
  summary text,
  caveats text,
  confidence_score numeric(4, 3) not null default 0.500,
  human_review_status public.review_status not null default 'pending',
  ai_generated_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_profiles_place_unique unique (place_id),
  constraint place_profiles_lunch_score_range check (lunch_score is null or lunch_score between 0 and 1),
  constraint place_profiles_date_score_range check (date_score is null or date_score between 0 and 1),
  constraint place_profiles_group_score_range check (group_score is null or group_score between 0 and 1),
  constraint place_profiles_solo_score_range check (solo_score is null or solo_score between 0 and 1),
  constraint place_profiles_family_score_range check (family_score is null or family_score between 0 and 1),
  constraint place_profiles_rainy_day_score_range check (rainy_day_score is null or rainy_day_score between 0 and 1),
  constraint place_profiles_confidence_range check (confidence_score between 0 and 1)
);

create table if not exists public.place_sources (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.canonical_places(id) on delete cascade,
  source_name text not null,
  source_url text,
  source_license text,
  source_record_id text,
  raw_payload jsonb not null default '{}',
  fetched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint place_sources_unique_record unique nulls not distinct (source_name, source_record_id)
);

create table if not exists public.place_hours (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.canonical_places(id) on delete cascade,
  day_of_week integer not null,
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  source text,
  confidence_score numeric(4, 3) not null default 0.500,
  valid_from date,
  valid_to date,
  updated_at timestamptz not null default now(),
  constraint place_hours_day_range check (day_of_week between 0 and 6),
  constraint place_hours_confidence_range check (confidence_score between 0 and 1),
  constraint place_hours_open_close_consistent check (
    is_closed = true or (opens_at is not null and closes_at is not null)
  )
);

create table if not exists public.ontario_events (
  id uuid primary key default gen_random_uuid(),
  place_id uuid references public.canonical_places(id) on delete set null,
  title text not null,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  category text,
  price_label text,
  ticket_url text,
  source_provider text,
  source_id text,
  status public.location_entity_status not null default 'needs_review',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ontario_events_source_unique unique nulls not distinct (source_provider, source_id)
);

create table if not exists public.ai_enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid not null,
  job_type text not null,
  status public.enrichment_job_status not null default 'queued',
  input_hash text,
  model text,
  output_json jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  constraint ai_enrichment_jobs_unique_input unique nulls not distinct (entity_type, entity_id, job_type, input_hash)
);

create table if not exists public.zero_result_queries (
  id uuid primary key default gen_random_uuid(),
  query text not null,
  city text,
  province text not null default 'ON',
  lat double precision,
  lng double precision,
  intent text,
  result_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint zero_result_queries_lat_range check (lat is null or lat between -90 and 90),
  constraint zero_result_queries_lng_range check (lng is null or lng between -180 and 180)
);

create index if not exists place_profiles_review_idx
  on public.place_profiles (human_review_status, confidence_score);

create index if not exists place_profiles_lunch_idx
  on public.place_profiles (lunch_score desc nulls last, confidence_score desc);

create index if not exists place_sources_place_idx
  on public.place_sources (place_id, source_name);

create index if not exists place_hours_place_day_idx
  on public.place_hours (place_id, day_of_week);

create index if not exists ontario_events_place_idx
  on public.ontario_events (place_id, starts_at);

create index if not exists ontario_events_status_time_idx
  on public.ontario_events (status, starts_at);

create index if not exists ai_enrichment_jobs_status_idx
  on public.ai_enrichment_jobs (status, created_at);

create index if not exists zero_result_queries_lookup_idx
  on public.zero_result_queries (province, city, intent, created_at desc);

drop trigger if exists place_profiles_touch_updated_at on public.place_profiles;
create trigger place_profiles_touch_updated_at
before update on public.place_profiles
for each row execute function public.touch_updated_at();

drop trigger if exists ontario_events_touch_updated_at on public.ontario_events;
create trigger ontario_events_touch_updated_at
before update on public.ontario_events
for each row execute function public.touch_updated_at();

alter table public.place_profiles enable row level security;
alter table public.place_sources enable row level security;
alter table public.place_hours enable row level security;
alter table public.ontario_events enable row level security;
alter table public.ai_enrichment_jobs enable row level security;
alter table public.zero_result_queries enable row level security;

drop policy if exists "approved place profiles are readable" on public.place_profiles;
create policy "approved place profiles are readable"
on public.place_profiles
for select
using (human_review_status in ('approved', 'needs_update'));

drop policy if exists "public place sources are readable" on public.place_sources;
create policy "public place sources are readable"
on public.place_sources
for select
using (
  exists (
    select 1
    from public.canonical_places cp
    where cp.id = place_sources.place_id
      and cp.is_supported_region = true
      and cp.location_status = 'published'
  )
);

drop policy if exists "public place hours are readable" on public.place_hours;
create policy "public place hours are readable"
on public.place_hours
for select
using (
  exists (
    select 1
    from public.canonical_places cp
    where cp.id = place_hours.place_id
      and cp.is_supported_region = true
      and cp.location_status = 'published'
  )
);

drop policy if exists "published ontario events are readable" on public.ontario_events;
create policy "published ontario events are readable"
on public.ontario_events
for select
using (status = 'published');

-- Job and query-log tables are service-role/admin only until role-based admin is implemented.

