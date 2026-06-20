-- Echoo Canada-first, global-ready geolocation foundation.
-- Run with: supabase db push

create extension if not exists postgis with schema extensions;
create extension if not exists pg_trgm with schema extensions;

do $$
begin
  create type public.supported_region_status as enum ('active', 'preview', 'blocked');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.location_entity_status as enum ('draft', 'published', 'archived', 'needs_review');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.supported_regions (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  admin_area_1 text,
  admin_area_1_name text,
  city text,
  status public.supported_region_status not null default 'blocked',
  features_enabled text[] not null default '{}',
  currency text not null default 'CAD',
  timezone text not null default 'America/Toronto',
  center_lat double precision,
  center_lng double precision,
  launch_priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supported_regions_country_upper check (country_code = upper(country_code)),
  constraint supported_regions_unique_scope unique nulls not distinct (country_code, admin_area_1, city)
);

create table if not exists public.canonical_places (
  id uuid primary key default gen_random_uuid(),
  country_code text not null,
  admin_area_1 text,
  admin_area_2 text,
  city text,
  neighborhood text,
  postal_code text,
  formatted_address text,
  latitude double precision not null,
  longitude double precision not null,
  location extensions.geography(point, 4326) generated always as (
    st_setsrid(st_makepoint(longitude, latitude), 4326)::extensions.geography
  ) stored,
  geohash text generated always as (
    st_geohash(st_setsrid(st_makepoint(longitude, latitude), 4326), 9)
  ) stored,
  timezone text,
  place_provider text,
  place_provider_id text,
  confidence_score numeric(4, 3) not null default 0.500,
  is_supported_region boolean not null default false,
  location_status public.location_entity_status not null default 'needs_review',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint canonical_places_country_upper check (country_code = upper(country_code)),
  constraint canonical_places_lat_range check (latitude between -90 and 90),
  constraint canonical_places_lng_range check (longitude between -180 and 180),
  constraint canonical_places_provider_pair check (
    (place_provider is null and place_provider_id is null)
    or (place_provider is not null and place_provider_id is not null)
  ),
  constraint canonical_places_provider_unique unique (place_provider, place_provider_id)
);

create table if not exists public.location_entities (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id uuid,
  place_id uuid references public.canonical_places(id) on delete set null,
  title text not null,
  category text,
  description text,
  image_url text,
  starts_at timestamptz,
  ends_at timestamptz,
  popularity_score numeric(8, 3) not null default 0,
  availability_score numeric(8, 3) not null default 0,
  editorial_boost numeric(8, 3) not null default 0,
  trust_score numeric(8, 3) not null default 0.75,
  status public.location_entity_status not null default 'draft',
  country_code text not null,
  admin_area_1 text,
  city text,
  latitude double precision not null,
  longitude double precision not null,
  location extensions.geography(point, 4326) generated always as (
    st_setsrid(st_makepoint(longitude, latitude), 4326)::extensions.geography
  ) stored,
  geohash text generated always as (
    st_geohash(st_setsrid(st_makepoint(longitude, latitude), 4326), 9)
  ) stored,
  source_provider text,
  source_provider_id text,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_entities_country_upper check (country_code = upper(country_code)),
  constraint location_entities_lat_range check (latitude between -90 and 90),
  constraint location_entities_lng_range check (longitude between -180 and 180),
  constraint location_entities_source_pair check (
    (source_provider is null and source_provider_id is null)
    or (source_provider is not null and source_provider_id is not null)
  ),
  constraint location_entities_source_unique unique (source_provider, source_provider_id)
);

create table if not exists public.user_location_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  home_country_code text,
  home_city text,
  last_selected_region jsonb not null default '{}',
  last_location_precision text not null default 'manual_city',
  location_consent_at timestamptz,
  last_latitude_rounded numeric(8, 4),
  last_longitude_rounded numeric(8, 4),
  updated_at timestamptz not null default now()
);

create index if not exists supported_regions_lookup_idx
  on public.supported_regions (country_code, admin_area_1, city, status);

create index if not exists canonical_places_location_gix
  on public.canonical_places using gist (location);

create index if not exists canonical_places_region_idx
  on public.canonical_places (country_code, admin_area_1, city, is_supported_region);

create index if not exists canonical_places_name_trgm_idx
  on public.canonical_places using gin (formatted_address extensions.gin_trgm_ops);

create index if not exists location_entities_location_gix
  on public.location_entities using gist (location);

create index if not exists location_entities_region_idx
  on public.location_entities (country_code, admin_area_1, city, status);

create index if not exists location_entities_type_status_idx
  on public.location_entities (entity_type, category, status, starts_at);

create index if not exists location_entities_title_trgm_idx
  on public.location_entities using gin (title extensions.gin_trgm_ops);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists supported_regions_touch_updated_at on public.supported_regions;
create trigger supported_regions_touch_updated_at
before update on public.supported_regions
for each row execute function public.touch_updated_at();

drop trigger if exists canonical_places_touch_updated_at on public.canonical_places;
create trigger canonical_places_touch_updated_at
before update on public.canonical_places
for each row execute function public.touch_updated_at();

drop trigger if exists location_entities_touch_updated_at on public.location_entities;
create trigger location_entities_touch_updated_at
before update on public.location_entities
for each row execute function public.touch_updated_at();

drop trigger if exists user_location_preferences_touch_updated_at on public.user_location_preferences;
create trigger user_location_preferences_touch_updated_at
before update on public.user_location_preferences
for each row execute function public.touch_updated_at();

create or replace function public.is_supported_region(
  p_country_code text,
  p_admin_area_1 text default null,
  p_city text default null,
  p_feature text default null
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.supported_regions sr
    where sr.country_code = upper(p_country_code)
      and sr.status = 'active'
      and (sr.admin_area_1 is null or p_admin_area_1 is null or lower(sr.admin_area_1) = lower(p_admin_area_1))
      and (sr.city is null or p_city is null or lower(sr.city) = lower(p_city))
      and (p_feature is null or p_feature = any(sr.features_enabled))
  );
$$;

create or replace function public.nearest_supported_region(
  p_lat double precision,
  p_lng double precision
)
returns table (
  id uuid,
  country_code text,
  admin_area_1 text,
  city text,
  timezone text,
  distance_meters double precision,
  features_enabled text[]
)
language sql
stable
as $$
  select
    sr.id,
    sr.country_code,
    sr.admin_area_1,
    sr.city,
    sr.timezone,
    st_distance(
      st_setsrid(st_makepoint(sr.center_lng, sr.center_lat), 4326)::extensions.geography,
      st_setsrid(st_makepoint(p_lng, p_lat), 4326)::extensions.geography
    ) as distance_meters,
    sr.features_enabled
  from public.supported_regions sr
  where sr.status = 'active'
    and sr.center_lat is not null
    and sr.center_lng is not null
  order by distance_meters asc
  limit 1;
$$;

create or replace function public.search_nearby_entities(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters integer default 25000,
  p_entity_type text default null,
  p_category text default null,
  p_limit integer default 50
)
returns table (
  id uuid,
  entity_type text,
  entity_id uuid,
  title text,
  category text,
  description text,
  image_url text,
  starts_at timestamptz,
  city text,
  admin_area_1 text,
  country_code text,
  latitude double precision,
  longitude double precision,
  distance_meters double precision,
  rank_score numeric
)
language sql
stable
as $$
  with origin as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::extensions.geography as geo
  )
  select
    le.id,
    le.entity_type,
    le.entity_id,
    le.title,
    le.category,
    le.description,
    le.image_url,
    le.starts_at,
    le.city,
    le.admin_area_1,
    le.country_code,
    le.latitude,
    le.longitude,
    st_distance(le.location, origin.geo) as distance_meters,
    (
      greatest(0, 1 - (st_distance(le.location, origin.geo) / greatest(p_radius_meters, 1))) * 0.25
      + case
          when le.starts_at is null then 0.08
          when le.starts_at between now() and now() + interval '7 days' then 0.20
          when le.starts_at > now() then 0.12
          else 0
        end
      + least(le.popularity_score, 1) * 0.20
      + least(le.availability_score, 1) * 0.15
      + least(le.trust_score, 1) * 0.15
      + least(le.editorial_boost, 1) * 0.05
    )::numeric(8, 4) as rank_score
  from public.location_entities le
  cross join origin
  where le.status = 'published'
    and le.country_code = 'CA'
    and (p_entity_type is null or le.entity_type = p_entity_type)
    and (p_category is null or le.category = p_category)
    and st_dwithin(le.location, origin.geo, p_radius_meters)
  order by rank_score desc, distance_meters asc, le.starts_at asc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.search_region_entities(
  p_country_code text default 'CA',
  p_admin_area_1 text default null,
  p_city text default null,
  p_entity_type text default null,
  p_category text default null,
  p_limit integer default 50
)
returns setof public.location_entities
language sql
stable
as $$
  select *
  from public.location_entities le
  where le.status = 'published'
    and le.country_code = upper(p_country_code)
    and (p_admin_area_1 is null or lower(le.admin_area_1) = lower(p_admin_area_1))
    and (p_city is null or lower(le.city) = lower(p_city))
    and (p_entity_type is null or le.entity_type = p_entity_type)
    and (p_category is null or le.category = p_category)
  order by le.editorial_boost desc, le.popularity_score desc, le.starts_at asc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;

alter table public.supported_regions enable row level security;
alter table public.canonical_places enable row level security;
alter table public.location_entities enable row level security;
alter table public.user_location_preferences enable row level security;

drop policy if exists "supported regions are readable" on public.supported_regions;
create policy "supported regions are readable"
on public.supported_regions
for select
using (true);

drop policy if exists "published places are readable" on public.canonical_places;
create policy "published places are readable"
on public.canonical_places
for select
using (is_supported_region = true and location_status = 'published');

drop policy if exists "published location entities are readable" on public.location_entities;
create policy "published location entities are readable"
on public.location_entities
for select
using (status = 'published' and country_code = 'CA');

drop policy if exists "users read own location preference" on public.user_location_preferences;
create policy "users read own location preference"
on public.user_location_preferences
for select
using (auth.uid() = user_id);

drop policy if exists "users write own location preference" on public.user_location_preferences;
create policy "users write own location preference"
on public.user_location_preferences
for insert
with check (auth.uid() = user_id);

drop policy if exists "users update own location preference" on public.user_location_preferences;
create policy "users update own location preference"
on public.user_location_preferences
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into public.supported_regions
  (country_code, admin_area_1, admin_area_1_name, city, status, features_enabled, currency, timezone, center_lat, center_lng, launch_priority)
values
  ('CA', null, null, null, 'active', array['events','tickets','talent','date_guides','hotels','movies'], 'CAD', 'America/Toronto', 56.1304, -106.3468, 0),
  ('CA', 'ON', 'Ontario', 'Toronto', 'active', array['events','tickets','talent','date_guides','hotels','movies'], 'CAD', 'America/Toronto', 43.6532, -79.3832, 1),
  ('CA', 'BC', 'British Columbia', 'Vancouver', 'active', array['events','tickets','talent','date_guides','hotels','movies'], 'CAD', 'America/Vancouver', 49.2827, -123.1207, 2),
  ('CA', 'QC', 'Quebec', 'Montreal', 'active', array['events','tickets','talent','date_guides','hotels','movies'], 'CAD', 'America/Toronto', 45.5017, -73.5673, 3),
  ('CA', 'AB', 'Alberta', 'Calgary', 'active', array['events','tickets','talent','date_guides','hotels','movies'], 'CAD', 'America/Edmonton', 51.0447, -114.0719, 4),
  ('CA', 'AB', 'Alberta', 'Edmonton', 'active', array['events','tickets','talent','date_guides','hotels','movies'], 'CAD', 'America/Edmonton', 53.5461, -113.4938, 5),
  ('CA', 'ON', 'Ontario', 'Ottawa', 'active', array['events','tickets','talent','date_guides','hotels','movies'], 'CAD', 'America/Toronto', 45.4215, -75.6972, 6),
  ('CA', 'MB', 'Manitoba', 'Winnipeg', 'active', array['events','tickets','talent','date_guides','hotels','movies'], 'CAD', 'America/Winnipeg', 49.8951, -97.1384, 7),
  ('CA', 'QC', 'Quebec', 'Quebec City', 'active', array['events','tickets','talent','date_guides','hotels','movies'], 'CAD', 'America/Toronto', 46.8139, -71.2080, 8),
  ('CA', 'NS', 'Nova Scotia', 'Halifax', 'active', array['events','tickets','talent','date_guides','hotels','movies'], 'CAD', 'America/Halifax', 44.6488, -63.5752, 9),
  ('CA', 'BC', 'British Columbia', 'Victoria', 'active', array['events','tickets','talent','date_guides','hotels','movies'], 'CAD', 'America/Vancouver', 48.4284, -123.3656, 10)
on conflict (country_code, admin_area_1, city) do update
set
  status = excluded.status,
  features_enabled = excluded.features_enabled,
  currency = excluded.currency,
  timezone = excluded.timezone,
  center_lat = excluded.center_lat,
  center_lng = excluded.center_lng,
  launch_priority = excluded.launch_priority;

insert into public.location_entities
  (entity_type, title, category, description, image_url, starts_at, popularity_score, availability_score, editorial_boost, trust_score, status, country_code, admin_area_1, city, latitude, longitude, metadata)
values
  ('event', 'Basement listening room', 'music', 'A small-room set with reserved standing space and an easy late food route nearby.', 'assets/optimized/news-music-768.jpg', now() + interval '1 day', 0.82, 0.65, 0.10, 0.85, 'published', 'CA', 'ON', 'Toronto', 43.6552, -79.4022, '{"launch_seed": true}'),
  ('guide', 'Rooftop dinner plus quiet walk', 'dates', 'A date plan that feels built, not assembled: table, timing, and a softer second stop.', 'assets/optimized/news-date-768.jpg', now() + interval '2 days', 0.76, 0.70, 0.15, 0.82, 'published', 'CA', 'ON', 'Toronto', 43.6426, -79.3871, '{"launch_seed": true}'),
  ('movie', 'Late film with post-show dessert', 'movies', 'A cinema anchor paired with a place that stays open late enough to keep talking.', 'assets/optimized/news-movie-768.jpg', now() + interval '3 days', 0.70, 0.80, 0.08, 0.80, 'published', 'CA', 'ON', 'Toronto', 43.6465, -79.3903, '{"launch_seed": true}'),
  ('event', 'Granville live stage', 'music', 'A high-energy live stage close to late food and transit.', 'assets/optimized/news-music-768.jpg', now() + interval '1 day', 0.78, 0.62, 0.08, 0.82, 'published', 'CA', 'BC', 'Vancouver', 49.2798, -123.1235, '{"launch_seed": true}'),
  ('guide', 'Mile End vinyl lounge route', 'dates', 'Warm drinks, records, and a short second stop for a low-pressure night.', 'assets/optimized/news-date-768.jpg', now() + interval '2 days', 0.74, 0.66, 0.12, 0.82, 'published', 'CA', 'QC', 'Montreal', 45.5240, -73.5950, '{"launch_seed": true}')
on conflict do nothing;
