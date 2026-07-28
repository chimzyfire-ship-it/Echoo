-- GTA-25 consumer location foundation.
-- Precise device coordinates are request-scoped. The durable profile contains a
-- manually chosen home municipality and optional, purpose-bound nationality data.

alter table public.user_onboarding_profiles
  add column if not exists nationalities text[] not null default '{}',
  add column if not exists nationality_disclosed_at timestamptz;

alter table public.user_onboarding_profiles
  drop constraint if exists user_onboarding_profiles_nationalities_limit;
alter table public.user_onboarding_profiles
  add constraint user_onboarding_profiles_nationalities_limit
  check (cardinality(nationalities) <= 8);

alter table public.user_location_preferences
  add column if not exists home_municipality text,
  add column if not exists home_local_area text,
  add column if not exists active_location_mode text not null default 'manual_city',
  add column if not exists location_permission_state text not null default 'unknown',
  add column if not exists location_consent_version text,
  add column if not exists last_location_accuracy_meters integer,
  add column if not exists last_location_captured_at timestamptz;

alter table public.user_location_preferences
  drop constraint if exists user_location_preferences_active_location_mode_check;
alter table public.user_location_preferences
  add constraint user_location_preferences_active_location_mode_check
  check (active_location_mode in ('gps_precise', 'gps_approximate', 'manual_city', 'gta_fallback'));

alter table public.user_location_preferences
  drop constraint if exists user_location_preferences_permission_state_check;
alter table public.user_location_preferences
  add constraint user_location_preferences_permission_state_check
  check (location_permission_state in ('unknown', 'granted', 'denied', 'prompt'));

-- Municipality polygons are the authoritative GPS resolver. They are loaded by
-- the GTA boundary ingestion job; no centroid is ever used to assign a place to
-- a municipality at a border.
create table if not exists public.gta_municipality_boundaries (
  id uuid primary key default gen_random_uuid(),
  municipality text not null unique,
  regional_municipality text not null,
  boundary extensions.geometry(MultiPolygon, 4326) not null,
  source_name text not null,
  source_url text,
  source_license text,
  source_record_id text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gta_municipality_boundaries_municipality_supported check (
    municipality in (
      'Toronto', 'Ajax', 'Brock', 'Clarington', 'Oshawa', 'Pickering',
      'Scugog', 'Uxbridge', 'Whitby', 'Aurora', 'East Gwillimbury',
      'Georgina', 'King', 'Markham', 'Newmarket', 'Richmond Hill', 'Vaughan',
      'Whitchurch-Stouffville', 'Brampton', 'Caledon', 'Mississauga',
      'Burlington', 'Halton Hills', 'Milton', 'Oakville'
    )
  )
);

create index if not exists gta_municipality_boundaries_boundary_gix
  on public.gta_municipality_boundaries using gist (boundary);

drop trigger if exists gta_municipality_boundaries_touch_updated_at
  on public.gta_municipality_boundaries;
create trigger gta_municipality_boundaries_touch_updated_at
before update on public.gta_municipality_boundaries
for each row execute function public.touch_updated_at();

alter table public.gta_municipality_boundaries enable row level security;

-- Boundary geometry is operational data. Consumer APIs expose only the resolved
-- municipality, never the raw location or the source geometry.
drop policy if exists "service role manages GTA municipality boundaries"
  on public.gta_municipality_boundaries;
create policy "service role manages GTA municipality boundaries"
on public.gta_municipality_boundaries
for all
to service_role
using (true)
with check (true);

create or replace function public.resolve_gta_municipality(
  p_lat double precision,
  p_lng double precision
)
returns table (
  municipality text,
  regional_municipality text,
  timezone text
)
language sql
stable
set search_path = public, extensions
as $$
  with origin as (
    select extensions.st_setsrid(
      extensions.st_makepoint(p_lng, p_lat),
      4326
    ) as point
  )
  select
    boundary.municipality,
    boundary.regional_municipality,
    'America/Toronto'::text as timezone
  from public.gta_municipality_boundaries boundary
  cross join origin
  where extensions.st_covers(boundary.boundary, origin.point)
  limit 1;
$$;

revoke all on function public.resolve_gta_municipality(double precision, double precision)
  from public, anon, authenticated;
grant execute on function public.resolve_gta_municipality(double precision, double precision)
  to service_role;

create or replace function public.search_gta_nearby_entities(
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
set search_path = public, extensions
as $$
  with origin as (
    select extensions.st_setsrid(
      extensions.st_makepoint(p_lng, p_lat), 4326
    )::extensions.geography as geo
  )
  select
    entity.id, entity.entity_type, entity.entity_id, entity.title,
    entity.category, entity.description, entity.image_url, entity.starts_at,
    entity.city, entity.admin_area_1, entity.country_code, entity.latitude,
    entity.longitude,
    extensions.st_distance(entity.location, origin.geo) as distance_meters,
    (
      greatest(0, 1 - (
        extensions.st_distance(entity.location, origin.geo) /
        greatest(p_radius_meters, 1)
      )) * 0.25
      + case
          when entity.starts_at is null then 0.08
          when entity.starts_at between now() and now() + interval '7 days' then 0.20
          when entity.starts_at > now() then 0.12
          else 0
        end
      + least(entity.popularity_score, 1) * 0.20
      + least(entity.availability_score, 1) * 0.15
      + least(entity.trust_score, 1) * 0.15
      + least(entity.editorial_boost, 1) * 0.05
    )::numeric(8, 4) as rank_score
  from public.location_entities entity
  cross join origin
  where entity.status = 'published'
    and entity.country_code = 'CA'
    and entity.admin_area_1 = 'ON'
    and exists (
      select 1
      from public.supported_regions region
      where region.country_code = 'CA'
        and region.admin_area_1 = 'ON'
        and region.status = 'active'
        and region.metadata ->> 'coverage_area' = 'Greater Toronto Area'
        and lower(region.city) = lower(entity.city)
    )
    and (p_entity_type is null or entity.entity_type = p_entity_type)
    and (p_category is null or entity.category = p_category)
    and extensions.st_dwithin(entity.location, origin.geo, p_radius_meters)
  order by distance_meters asc, rank_score desc, entity.starts_at asc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;

create or replace function public.search_gta_region_entities(
  p_city text default null,
  p_entity_type text default null,
  p_category text default null,
  p_limit integer default 50
)
returns setof public.location_entities
language sql
stable
set search_path = public
as $$
  select entity.*
  from public.location_entities entity
  where entity.status = 'published'
    and entity.country_code = 'CA'
    and entity.admin_area_1 = 'ON'
    and exists (
      select 1
      from public.supported_regions region
      where region.country_code = 'CA'
        and region.admin_area_1 = 'ON'
        and region.status = 'active'
        and region.metadata ->> 'coverage_area' = 'Greater Toronto Area'
        and lower(region.city) = lower(entity.city)
    )
    and (p_city is null or lower(entity.city) = lower(trim(p_city)))
    and (p_entity_type is null or entity.entity_type = p_entity_type)
    and (p_category is null or entity.category = p_category)
  order by entity.editorial_boost desc, entity.popularity_score desc,
    entity.starts_at asc nulls last
  limit least(greatest(p_limit, 1), 100);
$$;

revoke all on function public.search_gta_nearby_entities(
  double precision, double precision, integer, text, text, integer
) from public, anon, authenticated;
revoke all on function public.search_gta_region_entities(text, text, text, integer)
  from public, anon, authenticated;
grant execute on function public.search_gta_nearby_entities(
  double precision, double precision, integer, text, text, integer
) to service_role;
grant execute on function public.search_gta_region_entities(text, text, text, integer)
  to service_role;

drop policy if exists "users create own location preference"
  on public.user_location_preferences;
create policy "users create own location preference"
on public.user_location_preferences
for insert
with check (auth.uid() = user_id);

drop policy if exists "users update own location preference"
  on public.user_location_preferences;
create policy "users update own location preference"
on public.user_location_preferences
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
