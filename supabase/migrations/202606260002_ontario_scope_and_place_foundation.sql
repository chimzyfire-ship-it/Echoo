-- Phase 0/1: Ontario-wide scope and solid place intelligence foundation.
-- This migration keeps the existing Canada-first platform intact and adds
-- Ontario launch tiers plus richer canonical place fields.

create or replace function public.normalize_place_name(value text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(
      regexp_replace(
        regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', ' ', 'g'),
        '\s+',
        ' ',
        'g'
      )
    ),
    ''
  );
$$;

alter table public.supported_regions
  add column if not exists launch_tier integer not null default 2,
  add column if not exists coverage_level text not null default 'province',
  add column if not exists source_name text,
  add column if not exists metadata jsonb not null default '{}';

do $$
begin
  alter table public.supported_regions
    add constraint supported_regions_launch_tier_range
    check (launch_tier between 0 and 3);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.supported_regions
    add constraint supported_regions_coverage_level_check
    check (coverage_level in ('country', 'province', 'municipality', 'fallback'));
exception
  when duplicate_object then null;
end $$;

alter table public.canonical_places
  add column if not exists name text,
  add column if not exists normalized_name text,
  add column if not exists category text,
  add column if not exists subcategory text,
  add column if not exists municipality text,
  add column if not exists address text,
  add column if not exists website text,
  add column if not exists phone text,
  add column if not exists source_provider text,
  add column if not exists source_id text,
  add column if not exists last_seen_at timestamptz,
  add column if not exists last_verified_at timestamptz,
  add column if not exists metadata jsonb not null default '{}';

update public.canonical_places
set
  name = coalesce(name, formatted_address),
  normalized_name = coalesce(normalized_name, public.normalize_place_name(coalesce(name, formatted_address))),
  municipality = coalesce(municipality, city),
  address = coalesce(address, formatted_address),
  source_provider = coalesce(source_provider, place_provider),
  source_id = coalesce(source_id, place_provider_id),
  last_seen_at = coalesce(last_seen_at, created_at)
where
  name is null
  or normalized_name is null
  or municipality is null
  or address is null
  or source_provider is null
  or source_id is null
  or last_seen_at is null;

create or replace function public.prepare_canonical_place()
returns trigger
language plpgsql
as $$
begin
  new.name = nullif(trim(coalesce(new.name, new.formatted_address)), '');
  new.normalized_name = public.normalize_place_name(new.name);
  new.municipality = nullif(trim(coalesce(new.municipality, new.city)), '');
  new.address = nullif(trim(coalesce(new.address, new.formatted_address)), '');
  new.source_provider = nullif(trim(coalesce(new.source_provider, new.place_provider)), '');
  new.source_id = nullif(trim(coalesce(new.source_id, new.place_provider_id)), '');
  new.last_seen_at = coalesce(new.last_seen_at, now());
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists canonical_places_prepare_intelligence on public.canonical_places;
create trigger canonical_places_prepare_intelligence
before insert or update on public.canonical_places
for each row execute function public.prepare_canonical_place();

create index if not exists canonical_places_normalized_name_trgm_idx
  on public.canonical_places using gin (normalized_name extensions.gin_trgm_ops);

create index if not exists canonical_places_category_region_idx
  on public.canonical_places (country_code, admin_area_1, municipality, category, location_status);

create index if not exists canonical_places_source_idx
  on public.canonical_places (source_provider, source_id);

create index if not exists supported_regions_ontario_tier_idx
  on public.supported_regions (country_code, admin_area_1, launch_tier, launch_priority);

with ontario_regions (
  country_code,
  admin_area_1,
  admin_area_1_name,
  city,
  status,
  features_enabled,
  currency,
  timezone,
  center_lat,
  center_lng,
  launch_priority,
  launch_tier,
  coverage_level,
  source_name,
  metadata
) as (
  values
    ('CA', null, null, null, 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 56.1304::double precision, -106.3468::double precision, 0, 0, 'country', 'phase0_seed', '{"scope":"Canada active country gate"}'::jsonb),
    ('CA', 'ON', 'Ontario', null, 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 50.0000::double precision, -85.0000::double precision, 1, 2, 'province', 'phase0_seed', '{"tier":"Ontario coverage","coverage":"province-wide active support"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Toronto', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.6532::double precision, -79.3832::double precision, 10, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Markham', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.8561::double precision, -79.3370::double precision, 11, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Scarborough', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.7764::double precision, -79.2318::double precision, 12, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'North York', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.7615::double precision, -79.4111::double precision, 13, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Vaughan', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.8563::double precision, -79.5085::double precision, 14, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Richmond Hill', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.8828::double precision, -79.4403::double precision, 15, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Mississauga', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.5890::double precision, -79.6441::double precision, 16, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Brampton', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.7315::double precision, -79.7624::double precision, 17, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Oakville', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.4675::double precision, -79.6877::double precision, 18, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Burlington', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.3255::double precision, -79.7990::double precision, 19, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Hamilton', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.2557::double precision, -79.8711::double precision, 20, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Ottawa', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 45.4215::double precision, -75.6972::double precision, 21, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Waterloo', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.4643::double precision, -80.5204::double precision, 22, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Kitchener', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.4516::double precision, -80.4925::double precision, 23, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'London', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 42.9849::double precision, -81.2453::double precision, 24, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Niagara Falls', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.0896::double precision, -79.0849::double precision, 25, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Kingston', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 44.2312::double precision, -76.4860::double precision, 26, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Guelph', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 43.5448::double precision, -80.2482::double precision, 27, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Barrie', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 44.3894::double precision, -79.6903::double precision, 28, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb),
    ('CA', 'ON', 'Ontario', 'Windsor', 'active'::public.supported_region_status, array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'], 'CAD', 'America/Toronto', 42.3149::double precision, -83.0364::double precision, 29, 1, 'municipality', 'phase0_seed', '{"tier":"launch_density"}'::jsonb)
)
insert into public.supported_regions (
  country_code,
  admin_area_1,
  admin_area_1_name,
  city,
  status,
  features_enabled,
  currency,
  timezone,
  center_lat,
  center_lng,
  launch_priority,
  launch_tier,
  coverage_level,
  source_name,
  metadata
)
select *
from ontario_regions
on conflict (country_code, admin_area_1, city) do update
set
  status = excluded.status,
  features_enabled = excluded.features_enabled,
  currency = excluded.currency,
  timezone = excluded.timezone,
  center_lat = excluded.center_lat,
  center_lng = excluded.center_lng,
  launch_priority = excluded.launch_priority,
  launch_tier = excluded.launch_tier,
  coverage_level = excluded.coverage_level,
  source_name = excluded.source_name,
  metadata = public.supported_regions.metadata || excluded.metadata;

create or replace function public.ontario_region_support(
  p_city text default null
)
returns table (
  supported boolean,
  launch_tier integer,
  coverage_level text,
  city text,
  province text,
  features_enabled text[]
)
language sql
stable
as $$
  with exact_city as (
    select sr.*
    from public.supported_regions sr
    where sr.country_code = 'CA'
      and sr.admin_area_1 = 'ON'
      and sr.status = 'active'
      and p_city is not null
      and lower(sr.city) = lower(trim(p_city))
    order by sr.launch_tier asc, sr.launch_priority asc
    limit 1
  ),
  province_fallback as (
    select sr.*
    from public.supported_regions sr
    where sr.country_code = 'CA'
      and sr.admin_area_1 = 'ON'
      and sr.city is null
      and sr.status = 'active'
    order by sr.launch_tier asc, sr.launch_priority asc
    limit 1
  )
  select
    true as supported,
    coalesce(ec.launch_tier, pf.launch_tier, 3) as launch_tier,
    coalesce(ec.coverage_level, pf.coverage_level, 'fallback') as coverage_level,
    coalesce(ec.city, nullif(trim(p_city), ''), 'Ontario') as city,
    'ON' as province,
    coalesce(ec.features_enabled, pf.features_enabled, array['places','lunch']) as features_enabled
  from province_fallback pf
  left join exact_city ec on true;
$$;

create or replace function public.search_ontario_places(
  p_query text default null,
  p_city text default null,
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_meters integer default 25000,
  p_category text default null,
  p_limit integer default 25
)
returns table (
  id uuid,
  name text,
  category text,
  subcategory text,
  city text,
  municipality text,
  address text,
  latitude double precision,
  longitude double precision,
  distance_meters double precision,
  lunch_score numeric,
  date_score numeric,
  group_score numeric,
  confidence_score numeric,
  rank_score numeric
)
language sql
stable
as $$
  with origin as (
    select case
      when p_lat is not null and p_lng is not null
        then st_setsrid(st_makepoint(p_lng, p_lat), 4326)::extensions.geography
      else null
    end as geo
  ),
  candidates as (
    select
      cp.id,
      cp.name,
      cp.category,
      cp.subcategory,
      cp.city,
      cp.municipality,
      cp.address,
      cp.latitude,
      cp.longitude,
      case when origin.geo is not null then st_distance(cp.location, origin.geo) else null end as distance_meters,
      pp.lunch_score,
      pp.date_score,
      pp.group_score,
      greatest(cp.confidence_score, coalesce(pp.confidence_score, 0)) as confidence_score,
      (
        case
          when p_query is not null and cp.normalized_name % public.normalize_place_name(p_query) then 0.30
          when p_query is not null and cp.normalized_name ilike '%' || public.normalize_place_name(p_query) || '%' then 0.20
          else 0
        end
        + case
            when p_city is null then 0.08
            when lower(coalesce(cp.municipality, cp.city, '')) = lower(trim(p_city)) then 0.18
            else 0.04
          end
        + case
            when origin.geo is null then 0.08
            else greatest(0, 1 - (st_distance(cp.location, origin.geo) / greatest(p_radius_meters, 1))) * 0.18
          end
        + coalesce(pp.lunch_score, 0.35) * 0.12
        + coalesce(pp.date_score, 0.35) * 0.07
        + coalesce(pp.group_score, 0.35) * 0.07
        + greatest(cp.confidence_score, coalesce(pp.confidence_score, 0)) * 0.10
      )::numeric(8, 4) as rank_score
    from public.canonical_places cp
    cross join origin
    left join public.place_profiles pp on pp.place_id = cp.id
    where cp.country_code = 'CA'
      and cp.admin_area_1 = 'ON'
      and cp.is_supported_region = true
      and cp.location_status = 'published'
      and (p_category is null or cp.category = p_category)
      and (p_city is null or lower(coalesce(cp.municipality, cp.city, '')) = lower(trim(p_city)))
      and (
        origin.geo is null
        or st_dwithin(cp.location, origin.geo, least(greatest(p_radius_meters, 1000), 100000))
      )
      and (
        p_query is null
        or cp.normalized_name % public.normalize_place_name(p_query)
        or cp.normalized_name ilike '%' || public.normalize_place_name(p_query) || '%'
        or cp.category ilike '%' || trim(p_query) || '%'
        or cp.subcategory ilike '%' || trim(p_query) || '%'
      )
  )
  select *
  from candidates
  order by rank_score desc, distance_meters asc nulls last, name asc
  limit least(greatest(p_limit, 1), 100);
$$;

