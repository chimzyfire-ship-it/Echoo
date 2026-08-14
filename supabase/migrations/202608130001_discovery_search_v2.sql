-- Give Discover V2 a stable, service-only search contract. Rich feature and
-- media records are hydrated only after the ranked page is selected, avoiding
-- one lateral aggregate per row across the full GTA catalogue.

create index if not exists location_entities_discovery_v2_scope_idx
  on public.location_entities (
    country_code,
    admin_area_1,
    lower(city),
    lower(category),
    id
  )
  where status = 'published';

create function public.search_discovery_owned_entities_v2(
  p_query text default null,
  p_intent text default 'discover',
  p_culture_slug text default null,
  p_feature_slugs text[] default '{}',
  p_preference_feature_slugs text[] default '{}',
  p_lat double precision default null,
  p_lng double precision default null,
  p_radius_meters integer default 25000,
  p_city text default null,
  p_category text default null,
  p_lane text default 'all',
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
  cover_source text,
  rating_average numeric,
  rating_count integer,
  verified_visit_count integer,
  save_count integer,
  hot_score numeric,
  is_registered boolean,
  placement_tier text
)
language sql
stable
set search_path = public, extensions
as $$
  with params as materialized (
    select
      case
        when lower(trim(coalesce(p_intent, ''))) = any(
          array[
            'discover', 'food', 'comedy', 'music', 'nightlife', 'events',
            'tourism', 'search'
          ]::text[]
        ) then lower(trim(p_intent))
        else 'search'
      end as intent_id,
      case when lower(trim(coalesce(p_lane, ''))) = 'nearby'
        then 'nearby'
        else 'all'
      end as lane_id,
      nullif(lower(trim(coalesce(p_culture_slug, ''))), '') as culture_slug,
      lower(trim(coalesce(p_query, ''))) as query_text,
      coalesce(p_feature_slugs, '{}'::text[]) as required_slugs,
      coalesce(p_preference_feature_slugs, '{}'::text[]) as preference_slugs,
      least(greatest(coalesce(p_radius_meters, 25000), 1000), 100000)
        ::double precision as radius_meters,
      least(greatest(coalesce(p_limit, 20), 1), 50) as page_limit
  ),
  origin as materialized (
    select
      params.*,
      case when p_lat is not null and p_lng is not null
        then extensions.st_setsrid(
          extensions.st_makepoint(p_lng, p_lat),
          4326
        )::extensions.geography
        else null
      end as geo
    from params
  ),
  required_features as materialized (
    select fc.id
    from public.discovery_feature_catalog fc
    cross join origin
    where fc.is_active
      and fc.slug = any(origin.required_slugs)
  ),
  preference_features as materialized (
    select fc.id
    from public.discovery_feature_catalog fc
    cross join origin
    where fc.is_active
      and fc.slug = any(origin.preference_slugs)
  ),
  intent_categories as materialized (
    select distinct intent.category
    from origin
    cross join lateral unnest(
      case
        when origin.intent_id = 'food'
          then array[
            'restaurant', 'cafe', 'bakery', 'fast_food', 'food_court',
            'ice_cream'
          ]::text[]
        when origin.intent_id = 'comedy'
          then array[
            'comedy', 'theatre', 'event_venue', 'nightclub', 'arts_centre',
            'club'
          ]::text[]
        when origin.intent_id = 'music'
          then array[
            'music', 'event_venue', 'nightclub', 'theatre', 'arts_centre',
            'club', 'bar', 'pub'
          ]::text[]
        when origin.intent_id = 'nightlife'
          then array[
            'bar', 'pub', 'biergarten', 'nightclub', 'event_venue', 'club'
          ]::text[]
        when origin.intent_id = 'events'
          then array[
            'event', 'music', 'sports', 'theatre', 'arts', 'family',
            'comedy', 'event_venue', 'community_centre', 'arts_centre'
          ]::text[]
        when origin.intent_id = 'tourism'
          then array[
            'museum', 'gallery', 'attraction', 'historic', 'library', 'park',
            'nature_reserve'
          ]::text[]
        when origin.intent_id = 'search' and origin.query_text ~
          '(^|[^[:alnum:]])(restaurants?|food|dining|eat|brunch|lunch|dinner|tasting|bakery|bakeries)([^[:alnum:]]|$)'
          then array[
            'restaurant', 'cafe', 'bakery', 'fast_food', 'food_court',
            'ice_cream'
          ]::text[]
        when origin.intent_id = 'search' and origin.query_text ~
          '(^|[^[:alnum:]])(comedy|stand[- ]?up)([^[:alnum:]]|$)'
          then array[
            'comedy', 'theatre', 'event_venue', 'nightclub', 'arts_centre'
          ]::text[]
        when origin.intent_id = 'search' and origin.query_text ~
          '(^|[^[:alnum:]])(music|concerts?|bands?|djs?|live sound)([^[:alnum:]]|$)'
          then array[
            'music', 'event_venue', 'nightclub', 'theatre', 'arts_centre'
          ]::text[]
        when origin.intent_id = 'search' and origin.query_text ~
          '(^|[^[:alnum:]])(bars?|pubs?|nightlife|lounges?|late night)([^[:alnum:]]|$)'
          then array[
            'bar', 'pub', 'biergarten', 'nightclub', 'event_venue', 'club'
          ]::text[]
        when origin.intent_id = 'search' and origin.query_text ~
          '(^|[^[:alnum:]])(events?|festivals?|performances?|shows?)([^[:alnum:]]|$)'
          then array[
            'event', 'music', 'sports', 'theatre', 'arts', 'family',
            'comedy', 'event_venue', 'community_centre', 'arts_centre'
          ]::text[]
        when origin.intent_id = 'search' and origin.query_text ~
          '(^|[^[:alnum:]])(museums?|galleries?|tourism|landmarks?|attractions?)([^[:alnum:]]|$)'
          then array[
            'museum', 'gallery', 'attraction', 'historic', 'library'
          ]::text[]
        else '{}'::text[]
      end
    ) as intent(category)
  ),
  eligible as materialized (
    select
      le.id,
      le.entity_type,
      le.entity_id,
      le.title,
      le.category,
      le.description,
      le.image_url as source_image_url,
      le.source_provider,
      le.starts_at,
      le.city,
      le.admin_area_1,
      le.latitude,
      le.longitude,
      le.editorial_boost,
      le.trust_score,
      origin.intent_id,
      origin.lane_id,
      origin.query_text,
      origin.radius_meters,
      cardinality(origin.required_slugs) as required_count,
      cardinality(origin.preference_slugs) as preference_count,
      origin.geo is not null as has_origin,
      case when origin.geo is not null
        then extensions.st_distance(le.location, origin.geo)
        else null
      end as distance_meters
    from public.location_entities le
    cross join origin
    where le.status = 'published'
      and le.country_code = 'CA'
      and le.admin_area_1 = 'ON'
      and (
        coalesce(le.entity_type, 'place') <> 'event'
        or le.starts_at is null
        or le.starts_at >= now() - interval '3 hours'
      )
      and (p_city is null or lower(le.city) = lower(trim(p_city)))
      and (
        p_category is null
        or lower(coalesce(le.category, '')) = lower(trim(p_category))
      )
      and (
        origin.geo is null
        or extensions.st_dwithin(le.location, origin.geo, origin.radius_meters)
      )
      and (
        cardinality(origin.required_slugs) = 0
        or exists (
          select 1
          from public.discovery_entity_features ef
          join required_features rf on rf.id = ef.feature_id
          where ef.location_entity_id = le.id
            and ef.review_status = 'approved'
        )
      )
      and (
        origin.culture_slug is null
        -- A newly selectable lens may precede reviewed catalogue tags. Keep
        -- the owned lane useful until coverage exists; once it does, only
        -- evidence-backed matches qualify.
        or not exists (
          select 1
          from public.culture_entity_tags available_tag
          join public.culture_catalog available_culture
            on available_culture.id = available_tag.culture_id
            and available_culture.is_active
          where available_tag.review_status = 'approved'
            and available_culture.slug = origin.culture_slug
        )
        or exists (
          select 1
          from public.culture_entity_tags culture_tag
          join public.culture_catalog culture
            on culture.id = culture_tag.culture_id
            and culture.is_active
          where culture_tag.location_entity_id = le.id
            and culture_tag.review_status = 'approved'
            and culture.slug = origin.culture_slug
        )
      )
      and (
        origin.intent_id = 'discover'
        or (
          origin.intent_id = 'events'
          and (
            le.entity_type = 'event'
            or lower(coalesce(le.category, '')) in (
              select category from intent_categories
            )
          )
        )
        or (
          origin.intent_id = any(
            array['food', 'comedy', 'music', 'nightlife', 'tourism']::text[]
          )
          and (
            lower(coalesce(le.category, '')) in (
              select category from intent_categories
            )
            or (
              origin.intent_id = 'comedy'
              and lower(le.title || ' ' || coalesce(le.description, '')) ~
                '(^|[^[:alnum:]])(comedy|stand[- ]?up)([^[:alnum:]]|$)'
            )
            or (
              origin.intent_id = 'music'
              and lower(le.title || ' ' || coalesce(le.description, '')) ~
                '(^|[^[:alnum:]])(music|concerts?|bands?|djs?)([^[:alnum:]]|$)'
            )
          )
        )
        or (
          origin.intent_id = 'search'
          and (
            origin.query_text = ''
            or le.title ilike '%' || origin.query_text || '%'
            or coalesce(le.category, '') ilike
              '%' || origin.query_text || '%'
            or coalesce(le.description, '') ilike
              '%' || origin.query_text || '%'
            or lower(coalesce(le.category, '')) in (
              select category from intent_categories
            )
          )
        )
      )
  ),
  signals as (
    select
      eligible.*,
      stats.rating_average::numeric as rating_average,
      coalesce(stats.rating_count, 0) as rating_count,
      coalesce(stats.verified_visit_count, 0) as verified_visit_count,
      coalesce(stats.save_count, 0) as save_count,
      coalesce(stats.hot_score, 0)::numeric as hot_score,
      coalesce(stats.rating_bayesian, 0)::numeric as rating_bayesian,
      placement.tier as placement_tier,
      case
        when eligible.intent_id = 'discover' then 0.08
        when eligible.intent_id <> 'search' then 0.22
        when eligible.title ilike '%' || eligible.query_text || '%' then 0.40
        when coalesce(eligible.category, '') ilike
          '%' || eligible.query_text || '%' then 0.22
        when coalesce(eligible.description, '') ilike
          '%' || eligible.query_text || '%' then 0.16
        when lower(coalesce(eligible.category, '')) in (
          select category from intent_categories
        ) then 0.14
        else 0
      end as intent_score,
      case
        when eligible.preference_count = 0 then 0
        when exists (
          select 1
          from public.discovery_entity_features ef
          join preference_features pf on pf.id = ef.feature_id
          where ef.location_entity_id = eligible.id
            and ef.review_status = 'approved'
        ) then 0.14
        else 0
      end as preference_score
    from eligible
    left join public.discovery_entity_stats stats
      on stats.location_entity_id = eligible.id
    left join lateral (
      select vp.tier
      from public.venue_search_placements vp
      where vp.location_entity_id = eligible.id
        and vp.status = 'active'
        and vp.starts_at <= now()
        and (vp.ends_at is null or vp.ends_at > now())
        and (
          cardinality(vp.promoted_categories) = 0
          or exists (
            select 1
            from unnest(vp.promoted_categories) promoted(category)
            where lower(promoted.category) =
              lower(coalesce(eligible.category, ''))
          )
        )
      limit 1
    ) placement on true
  ),
  scored as (
    select
      signals.*,
      (
        signals.intent_score
        + case when signals.required_count > 0 then 0.32 else 0 end
        + signals.preference_score
        + case when not signals.has_origin then 0.08
          else greatest(
            0,
            1 - signals.distance_meters / signals.radius_meters
          ) * 0.16
        end
        + least(greatest(signals.hot_score, 0), 100) / 100 * 0.10
        + least(greatest(signals.rating_bayesian, 0), 5) / 5 * 0.08
        + least(greatest(signals.editorial_boost, 0), 1) * 0.08
        + least(greatest(signals.trust_score, 0), 1) * 0.06
        + case signals.placement_tier
          when 'top_pick' then 0.18
          when 'featured' then 0.11
          when 'registered' then 0.05
          else 0
        end
      )::numeric(10, 6) as rank_score
    from signals
  ),
  page as materialized (
    select scored.*
    from scored
    cross join origin
    where origin.lane_id = 'nearby'
      or p_cursor_score is null
      or scored.rank_score < p_cursor_score
      or (
        scored.rank_score = p_cursor_score
        and scored.id > p_cursor_id
      )
    order by
      case
        when origin.lane_id = 'nearby' and scored.has_origin
          then scored.distance_meters
        else null
      end asc nulls last,
      scored.rank_score desc,
      scored.id asc
    limit (select page_limit from origin)
  )
  select
    page.id,
    page.entity_type,
    page.entity_id,
    page.title,
    page.category,
    page.description,
    page.starts_at,
    page.city,
    page.admin_area_1,
    page.latitude,
    page.longitude,
    page.distance_meters,
    page.rank_score,
    coalesce(features.feature_slugs, '{}'::text[]) as feature_slugs,
    coalesce(media.storage_path, page.source_image_url) as cover_url,
    coalesce(media.alt_text, page.title) as cover_alt_text,
    case
      when media.storage_path is not null then 'echoo_approved'
      when page.source_image_url is not null
        then coalesce(page.source_provider, 'source_provider')
      else null
    end as cover_source,
    page.rating_average,
    page.rating_count,
    page.verified_visit_count,
    page.save_count,
    page.hot_score,
    page.placement_tier is not null as is_registered,
    page.placement_tier
  from page
  left join lateral (
    select array_agg(fc.slug order by fc.slug) as feature_slugs
    from public.discovery_entity_features ef
    join public.discovery_feature_catalog fc
      on fc.id = ef.feature_id
      and fc.is_active
    where ef.location_entity_id = page.id
      and ef.review_status = 'approved'
  ) features on true
  left join lateral (
    select dm.storage_path, dm.alt_text
    from public.discovery_entity_media dm
    where dm.location_entity_id = page.id
      and dm.review_status = 'approved'
      and dm.rights_status in ('owned', 'licensed', 'permission_granted')
      and dm.media_kind = 'image'
    order by dm.is_cover desc, dm.sort_order, dm.created_at
    limit 1
  ) media on true
  order by
    case
      when page.lane_id = 'nearby' and page.has_origin
        then page.distance_meters
      else null
    end asc nulls last,
    page.rank_score desc,
    page.id asc;
$$;

revoke all on function public.search_discovery_owned_entities_v2(
  text, text, text, text[], text[], double precision, double precision, integer,
  text, text, text, integer, numeric, uuid
) from public, anon, authenticated;

grant execute on function public.search_discovery_owned_entities_v2(
  text, text, text, text[], text[], double precision, double precision, integer,
  text, text, text, integer, numeric, uuid
) to service_role;
