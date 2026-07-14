-- Hybrid Discovery Stage 2.
-- Search only reads Echoo-owned inventory. Live providers are deliberately
-- kept out of these functions so their records cannot become catalog data.

create index if not exists location_entities_discovery_search_idx
  on public.location_entities (country_code, admin_area_1, city, status, category);

create index if not exists discovery_entity_features_approved_entity_idx
  on public.discovery_entity_features (location_entity_id, feature_id)
  where review_status = 'approved';

create or replace function public.search_discovery_owned_entities(
  p_query text default null,
  p_feature_slugs text[] default '{}',
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_meters integer default 25000,
  p_city text default null,
  p_category text default null,
  p_limit integer default 20,
  p_cursor_score numeric default null,
  p_cursor_id uuid default null
)
returns table (
  id uuid,
  entity_type text,
  entity_id uuid,
  title text,
  category text,
  description text,
  starts_at timestamptz,
  city text,
  admin_area_1 text,
  latitude double precision,
  longitude double precision,
  distance_meters double precision,
  rank_score numeric,
  feature_slugs text[],
  cover_url text,
  cover_alt_text text,
  rating_average numeric,
  rating_count integer,
  verified_visit_count integer,
  save_count integer,
  hot_score numeric
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
  candidates as (
    select
      le.*,
      case when origin.geo is not null then extensions.st_distance(le.location, origin.geo) else null end as distance_meters,
      coalesce(stats.rating_average, null)::numeric as rating_average,
      coalesce(stats.rating_count, 0) as rating_count,
      coalesce(stats.verified_visit_count, 0) as verified_visit_count,
      coalesce(stats.save_count, 0) as save_count,
      coalesce(stats.hot_score, 0)::numeric as hot_score,
      coalesce(features.feature_slugs, '{}'::text[]) as feature_slugs,
      media.storage_path as cover_url,
      media.alt_text as cover_alt_text,
      (
        case
          when nullif(trim(coalesce(p_query, '')), '') is null then 0.08
          when lower(le.title) like '%' || lower(trim(p_query)) || '%' then 0.40
          when lower(coalesce(le.category, '')) like '%' || lower(trim(p_query)) || '%' then 0.22
          when lower(coalesce(le.description, '')) like '%' || lower(trim(p_query)) || '%' then 0.16
          else 0
        end
        + case
            when cardinality(coalesce(p_feature_slugs, '{}'::text[])) = 0 then 0
            when coalesce(features.feature_slugs, '{}'::text[]) && p_feature_slugs then 0.32
            else 0
          end
        + case
            when origin.geo is null then 0.08
            else greatest(0, 1 - (extensions.st_distance(le.location, origin.geo) / greatest(p_radius_meters, 1))) * 0.16
          end
        + least(coalesce(stats.hot_score, 0), 100) / 100 * 0.10
        + least(coalesce(stats.rating_bayesian, 0), 5) / 5 * 0.08
        + least(le.editorial_boost, 1) * 0.08
        + least(le.trust_score, 1) * 0.06
      )::numeric(10, 6) as rank_score
    from public.location_entities le
    cross join origin
    left join public.discovery_entity_stats stats on stats.location_entity_id = le.id
    left join lateral (
      select array_agg(fc.slug order by fc.slug) as feature_slugs
      from public.discovery_entity_features ef
      join public.discovery_feature_catalog fc on fc.id = ef.feature_id and fc.is_active
      where ef.location_entity_id = le.id
        and ef.review_status = 'approved'
    ) features on true
    left join lateral (
      select dm.storage_path, dm.alt_text
      from public.discovery_entity_media dm
      where dm.location_entity_id = le.id
        and dm.review_status = 'approved'
        and dm.media_kind = 'image'
      order by dm.is_cover desc, dm.sort_order asc, dm.created_at asc
      limit 1
    ) media on true
    where le.status = 'published'
      and le.country_code = 'CA'
      and le.admin_area_1 = 'ON'
      and (p_city is null or lower(le.city) = lower(trim(p_city)))
      and (p_category is null or lower(coalesce(le.category, '')) = lower(trim(p_category)))
      and (origin.geo is null or extensions.st_dwithin(le.location, origin.geo, least(greatest(p_radius_meters, 1000), 100000)))
      and (
        cardinality(coalesce(p_feature_slugs, '{}'::text[])) = 0
        or coalesce(features.feature_slugs, '{}'::text[]) && p_feature_slugs
      )
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or lower(le.title) like '%' || lower(trim(p_query)) || '%'
        or lower(coalesce(le.category, '')) like '%' || lower(trim(p_query)) || '%'
        or lower(coalesce(le.description, '')) like '%' || lower(trim(p_query)) || '%'
        or cardinality(coalesce(p_feature_slugs, '{}'::text[])) > 0
      )
  )
  select
    id, entity_type, entity_id, title, category, description,
    starts_at, city, admin_area_1, latitude, longitude, distance_meters,
    rank_score, feature_slugs, cover_url, cover_alt_text, rating_average,
    rating_count, verified_visit_count, save_count, hot_score
  from candidates
  where p_cursor_score is null
    or rank_score < p_cursor_score
    or (rank_score = p_cursor_score and id > p_cursor_id)
  order by rank_score desc, id asc
  limit least(greatest(p_limit, 1), 50);
$$;

create or replace function public.discovery_search_suggestions(
  p_prefix text,
  p_city text default null,
  p_limit integer default 8
)
returns table (
  suggestion_type text,
  value text,
  label text,
  category text,
  entity_id uuid
)
language sql
stable
as $$
  with input as (
    select lower(trim(coalesce(p_prefix, ''))) as prefix
  ),
  places as (
    select
      'place'::text as suggestion_type,
      le.title as value,
      le.title as label,
      le.category,
      le.id as entity_id,
      0 as sort_group
    from public.location_entities le
    cross join input
    where le.status = 'published'
      and le.country_code = 'CA'
      and le.admin_area_1 = 'ON'
      and (p_city is null or lower(le.city) = lower(trim(p_city)))
      and input.prefix <> ''
      and lower(le.title) like input.prefix || '%'
    order by le.editorial_boost desc, le.popularity_score desc, le.title asc
    limit least(greatest(p_limit, 1), 20)
  ),
  features as (
    select
      'feature'::text,
      fc.slug,
      fc.label,
      fc.category,
      null::uuid,
      1
    from public.discovery_feature_catalog fc
    cross join input
    where fc.is_active
      and input.prefix <> ''
      and (lower(fc.label) like input.prefix || '%' or exists (
        select 1 from unnest(fc.synonyms) synonym where lower(synonym) like input.prefix || '%'
      ))
    order by fc.label asc
    limit least(greatest(p_limit, 1), 20)
  ),
  categories as (
    select distinct on (lower(le.category))
      'category'::text,
      le.category,
      initcap(replace(le.category, '_', ' ')),
      le.category,
      null::uuid,
      2
    from public.location_entities le
    cross join input
    where le.status = 'published'
      and le.country_code = 'CA'
      and le.admin_area_1 = 'ON'
      and le.category is not null
      and input.prefix <> ''
      and lower(le.category) like '%' || input.prefix || '%'
    order by lower(le.category), le.category
  )
  select suggestion_type, value, label, category, entity_id
  from (
    select * from places
    union all select * from features
    union all select * from categories
  ) suggestions
  order by sort_group, label
  limit least(greatest(p_limit, 1), 20);
$$;

revoke all on function public.search_discovery_owned_entities(text, text[], double precision, double precision, integer, text, text, integer, numeric, uuid) from public, anon, authenticated;
revoke all on function public.discovery_search_suggestions(text, text, integer) from public, anon, authenticated;
