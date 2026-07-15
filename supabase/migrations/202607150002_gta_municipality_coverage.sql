-- Full GTA municipality coverage. GTA is defined here as the City of Toronto
-- plus all lower-tier municipalities in Durham, York, Peel, and Halton.
-- Toronto's former boroughs are aliases in the application layer, not separate
-- city rows, so records remain discoverable from one canonical Toronto scope.

with gta_regions (
  city,
  center_lat,
  center_lng,
  regional_municipality,
  municipality_type,
  aliases
) as (
  values
    ('Toronto', 43.6532::double precision, -79.3832::double precision, 'Toronto', 'city', '["Scarborough","North York","Etobicoke","East York","York","Downtown Toronto"]'::jsonb),
    ('Ajax', 43.8509::double precision, -79.0204::double precision, 'Durham', 'town', '[]'::jsonb),
    ('Brock', 44.3045::double precision, -78.7276::double precision, 'Durham', 'township', '[]'::jsonb),
    ('Clarington', 43.9353::double precision, -78.6080::double precision, 'Durham', 'municipality', '[]'::jsonb),
    ('Oshawa', 43.8971::double precision, -78.8658::double precision, 'Durham', 'city', '[]'::jsonb),
    ('Pickering', 43.8384::double precision, -79.0868::double precision, 'Durham', 'city', '[]'::jsonb),
    ('Scugog', 44.1116::double precision, -78.9445::double precision, 'Durham', 'township', '[]'::jsonb),
    ('Uxbridge', 44.1086::double precision, -79.1224::double precision, 'Durham', 'township', '[]'::jsonb),
    ('Whitby', 43.8975::double precision, -78.9429::double precision, 'Durham', 'town', '[]'::jsonb),
    ('Aurora', 44.0065::double precision, -79.4504::double precision, 'York', 'town', '[]'::jsonb),
    ('East Gwillimbury', 44.1030::double precision, -79.4470::double precision, 'York', 'town', '[]'::jsonb),
    ('Georgina', 44.3030::double precision, -79.3660::double precision, 'York', 'town', '[]'::jsonb),
    ('King', 43.9970::double precision, -79.6300::double precision, 'York', 'township', '["King Township"]'::jsonb),
    ('Markham', 43.8561::double precision, -79.3370::double precision, 'York', 'city', '[]'::jsonb),
    ('Newmarket', 44.0592::double precision, -79.4613::double precision, 'York', 'town', '[]'::jsonb),
    ('Richmond Hill', 43.8828::double precision, -79.4403::double precision, 'York', 'city', '[]'::jsonb),
    ('Vaughan', 43.8563::double precision, -79.5085::double precision, 'York', 'city', '[]'::jsonb),
    ('Whitchurch-Stouffville', 43.9708::double precision, -79.2444::double precision, 'York', 'town', '["Stouffville","Whitchurch Stouffville"]'::jsonb),
    ('Brampton', 43.7315::double precision, -79.7624::double precision, 'Peel', 'city', '[]'::jsonb),
    ('Caledon', 43.8769::double precision, -79.8654::double precision, 'Peel', 'town', '[]'::jsonb),
    ('Mississauga', 43.5890::double precision, -79.6441::double precision, 'Peel', 'city', '[]'::jsonb),
    ('Burlington', 43.3255::double precision, -79.7990::double precision, 'Halton', 'city', '[]'::jsonb),
    ('Halton Hills', 43.6300::double precision, -79.9500::double precision, 'Halton', 'town', '[]'::jsonb),
    ('Milton', 43.5183::double precision, -79.8774::double precision, 'Halton', 'town', '[]'::jsonb),
    ('Oakville', 43.4675::double precision, -79.6877::double precision, 'Halton', 'town', '[]'::jsonb)
)
insert into public.supported_regions (
  country_code, admin_area_1, admin_area_1_name, city, status,
  features_enabled, currency, timezone, center_lat, center_lng,
  launch_priority, launch_tier, coverage_level, source_name, metadata
)
select
  'CA', 'ON', 'Ontario', city, 'active'::public.supported_region_status,
  array['places','events','tickets','talent','date_guides','hotels','movies','lunch','nightlife'],
  'CAD', 'America/Toronto', center_lat, center_lng,
  30, 1, 'municipality', 'gta_coverage_seed',
  jsonb_build_object(
    'coverage_area', 'Greater Toronto Area',
    'regional_municipality', regional_municipality,
    'municipality_type', municipality_type,
    'aliases', aliases,
    'ingestion_requirement', 'Use a municipal-boundary extract and municipality override.'
  )
from gta_regions
on conflict (country_code, admin_area_1, city) do update
set
  status = excluded.status,
  features_enabled = excluded.features_enabled,
  center_lat = excluded.center_lat,
  center_lng = excluded.center_lng,
  launch_tier = excluded.launch_tier,
  coverage_level = excluded.coverage_level,
  source_name = excluded.source_name,
  metadata = public.supported_regions.metadata || excluded.metadata,
  updated_at = now();

-- A deliberately transparent readiness report. A municipality is not called
-- complete merely because it is configured: it needs published inventory.
create or replace function public.gta_municipality_coverage()
returns table (
  city text,
  regional_municipality text,
  published_entities bigint,
  source_count bigint,
  last_source_seen_at timestamptz
)
language sql
stable
set search_path = public
as $$
  select
    sr.city,
    sr.metadata ->> 'regional_municipality' as regional_municipality,
    count(distinct le.id) filter (where le.status = 'published') as published_entities,
    count(distinct le.source_provider) filter (where le.status = 'published') as source_count,
    max(cp.last_seen_at) filter (where le.status = 'published') as last_source_seen_at
  from public.supported_regions sr
  left join public.location_entities le
    on le.country_code = sr.country_code
   and le.admin_area_1 = sr.admin_area_1
   and lower(le.city) = lower(sr.city)
  left join public.canonical_places cp on cp.id = le.place_id
  where sr.country_code = 'CA'
    and sr.admin_area_1 = 'ON'
    and sr.status = 'active'
    and sr.metadata ->> 'coverage_area' = 'Greater Toronto Area'
  group by sr.city, sr.metadata ->> 'regional_municipality'
  order by sr.metadata ->> 'regional_municipality', sr.city;
$$;

revoke all on function public.gta_municipality_coverage() from public, anon, authenticated;
