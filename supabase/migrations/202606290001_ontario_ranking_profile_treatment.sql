-- Phase 3B: stronger profile-aware Ontario ranking.
-- Adds source/profile/editorial signals to the retrieval function so search,
-- planning, and chat can prefer stronger Echoo records without inventing facts.

drop function if exists public.search_ontario_places(
  text,
  text,
  double precision,
  double precision,
  integer,
  text,
  integer
);

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
  solo_score numeric,
  family_score numeric,
  rainy_day_score numeric,
  confidence_score numeric,
  profile_confidence_score numeric,
  profile_status public.review_status,
  vibe_tags text[],
  good_for text[],
  meal_tags text[],
  activity_tags text[],
  noise_level text,
  price_band text,
  source_provider text,
  last_verified_at timestamptz,
  last_seen_at timestamptz,
  popularity_score numeric,
  editorial_boost numeric,
  trust_score numeric,
  profile_quality_score numeric,
  source_quality_score numeric,
  rank_score numeric
)
language sql
stable
as $$
  with origin as (
    select case
      when p_lat is not null and p_lng is not null
        then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
      else null
    end as geo
  ),
  entity_signals as (
    select
      le.place_id,
      max(le.popularity_score) as popularity_score,
      max(le.editorial_boost) as editorial_boost,
      max(le.trust_score) as trust_score
    from public.location_entities le
    where le.place_id is not null
      and le.entity_type = 'place'
      and le.status = 'published'
    group by le.place_id
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
      case when origin.geo is not null then extensions.st_distance(cp.location, origin.geo) else null end as distance_meters,
      pp.lunch_score,
      pp.date_score,
      pp.group_score,
      pp.solo_score,
      pp.family_score,
      pp.rainy_day_score,
      greatest(cp.confidence_score, coalesce(pp.confidence_score, 0)) as confidence_score,
      pp.confidence_score as profile_confidence_score,
      pp.human_review_status as profile_status,
      coalesce(pp.vibe_tags, '{}') as vibe_tags,
      coalesce(pp.good_for, '{}') as good_for,
      coalesce(pp.meal_tags, '{}') as meal_tags,
      coalesce(pp.activity_tags, '{}') as activity_tags,
      pp.noise_level,
      pp.price_band,
      cp.source_provider,
      cp.last_verified_at,
      cp.last_seen_at,
      coalesce(es.popularity_score, 0) as popularity_score,
      coalesce(es.editorial_boost, 0) as editorial_boost,
      coalesce(es.trust_score, 0.75) as trust_score,
      least(
        1,
        greatest(0, coalesce(pp.confidence_score, 0))
          + case when pp.human_review_status = 'approved' then 0.12 else 0 end
          + case when coalesce(array_length(pp.vibe_tags, 1), 0) > 0 then 0.05 else 0 end
          + case when nullif(trim(coalesce(pp.summary, '')), '') is not null then 0.05 else 0 end
      ) as profile_quality_score,
      least(
        1,
        greatest(cp.confidence_score, coalesce(pp.confidence_score, 0))
          + case when cp.source_provider ilike 'echoo%' then 0.16 else 0 end
          + case when cp.source_provider in ('echoo_partner', 'echoo_validation_seed') then 0.12 else 0 end
          + case when cp.last_verified_at is not null then 0.08 else 0 end
          + case when cp.website is not null or cp.phone is not null then 0.04 else 0 end
      ) as source_quality_score,
      (
        case
          when p_query is not null and cp.normalized_name operator(extensions.%) public.normalize_place_name(p_query) then 0.20
          when p_query is not null and cp.normalized_name ilike '%' || public.normalize_place_name(p_query) || '%' then 0.14
          else 0
        end
        + case
            when p_city is null then 0.08
            when lower(coalesce(cp.municipality, cp.city, '')) = lower(trim(p_city)) then 0.16
            else 0.04
          end
        + case
            when origin.geo is null then 0.08
            else greatest(0, 1 - (extensions.st_distance(cp.location, origin.geo) / greatest(p_radius_meters, 1))) * 0.18
          end
        + coalesce(pp.lunch_score, 0.35) * 0.10
        + coalesce(pp.date_score, 0.35) * 0.06
        + coalesce(pp.group_score, 0.35) * 0.06
        + (
          least(
            1,
            greatest(0, coalesce(pp.confidence_score, 0))
              + case when pp.human_review_status = 'approved' then 0.12 else 0 end
              + case when coalesce(array_length(pp.vibe_tags, 1), 0) > 0 then 0.05 else 0 end
              + case when nullif(trim(coalesce(pp.summary, '')), '') is not null then 0.05 else 0 end
          ) * 0.14
        )
        + (
          least(
            1,
            greatest(cp.confidence_score, coalesce(pp.confidence_score, 0))
              + case when cp.source_provider ilike 'echoo%' then 0.16 else 0 end
              + case when cp.source_provider in ('echoo_partner', 'echoo_validation_seed') then 0.12 else 0 end
              + case when cp.last_verified_at is not null then 0.08 else 0 end
              + case when cp.website is not null or cp.phone is not null then 0.04 else 0 end
          ) * 0.10
        )
        + least(coalesce(es.popularity_score, 0), 1) * 0.06
        + least(coalesce(es.trust_score, 0.75), 1) * 0.05
        + least(coalesce(es.editorial_boost, 0), 1) * 0.07
      )::numeric(8, 4) as rank_score
    from public.canonical_places cp
    cross join origin
    left join public.place_profiles pp on pp.place_id = cp.id
    left join entity_signals es on es.place_id = cp.id
    where cp.country_code = 'CA'
      and cp.admin_area_1 = 'ON'
      and cp.is_supported_region = true
      and cp.location_status = 'published'
      and (p_category is null or cp.category = p_category)
      and (p_city is null or lower(coalesce(cp.municipality, cp.city, '')) = lower(trim(p_city)))
      and (
        origin.geo is null
        or extensions.st_dwithin(cp.location, origin.geo, least(greatest(p_radius_meters, 1000), 100000))
      )
      and (
        p_query is null
        or cp.normalized_name operator(extensions.%) public.normalize_place_name(p_query)
        or cp.normalized_name ilike '%' || public.normalize_place_name(p_query) || '%'
        or cp.category ilike '%' || trim(p_query) || '%'
        or cp.subcategory ilike '%' || trim(p_query) || '%'
        or exists (
          select 1
          from unnest(coalesce(pp.vibe_tags, '{}') || coalesce(pp.good_for, '{}') || coalesce(pp.meal_tags, '{}') || coalesce(pp.activity_tags, '{}')) as tag(value)
          where tag.value ilike '%' || trim(p_query) || '%'
        )
      )
  )
  select *
  from candidates
  order by rank_score desc, distance_meters asc nulls last, name asc
  limit least(greatest(p_limit, 1), 100);
$$;
