-- First owned-discovery depth pass for the highest-demand GTA launch city.
-- Only official City of Markham source categories are mapped. These are
-- direct, conservative facts (park/trail = outdoor; library/community centre
-- = indoor), never inferred vibes, identity, dietary, or quality claims.

with approved_mapping as (
  select * from (values
    ('markham_open_data_parks', 'park', 'outdoor'),
    ('markham_open_data_trails', 'trail', 'outdoor'),
    ('markham_open_data_city_facilities', 'library', 'indoor'),
    ('markham_open_data_city_facilities', 'community_centre', 'indoor')
  ) as mapping(source_provider, category, feature_slug)
), candidates as (
  select
    le.id as location_entity_id,
    fc.id as feature_id,
    coalesce(nullif(le.metadata ->> 'source_url', ''), 'https://data-markham.opendata.arcgis.com/') as source_reference
  from public.location_entities le
  join approved_mapping mapping
    on le.source_provider = mapping.source_provider
   and lower(coalesce(le.category, '')) = mapping.category
  join public.discovery_feature_catalog fc
    on fc.slug = mapping.feature_slug
   and fc.is_active
  where le.status = 'published'
    and le.city = 'Markham'
)
insert into public.discovery_entity_features (
  location_entity_id,
  feature_id,
  source_type,
  source_reference,
  confidence_score,
  review_status,
  reviewed_at
)
select
  location_entity_id,
  feature_id,
  'open_data',
  source_reference,
  0.950,
  'approved',
  now()
from candidates
on conflict (location_entity_id, feature_id) do nothing;

create or replace function public.discovery_feature_coverage(
  p_city text default null
)
returns table (
  city text,
  published_entities bigint,
  tagged_entities bigint,
  approved_feature_assignments bigint,
  approved_cover_images bigint
)
language sql
stable
set search_path = public
as $$
  select
    le.city,
    count(distinct le.id) as published_entities,
    count(distinct ef.location_entity_id) as tagged_entities,
    count(ef.id) as approved_feature_assignments,
    count(distinct dm.location_entity_id) as approved_cover_images
  from public.location_entities le
  left join public.discovery_entity_features ef
    on ef.location_entity_id = le.id
   and ef.review_status = 'approved'
  left join public.discovery_entity_media dm
    on dm.location_entity_id = le.id
   and dm.review_status = 'approved'
   and dm.rights_status in ('owned', 'licensed', 'permission_granted')
   and dm.media_kind = 'image'
  where le.status = 'published'
    and le.country_code = 'CA'
    and le.admin_area_1 = 'ON'
    and (p_city is null or lower(le.city) = lower(trim(p_city)))
  group by le.city;
$$;

revoke all on function public.discovery_feature_coverage(text) from public, anon, authenticated;
