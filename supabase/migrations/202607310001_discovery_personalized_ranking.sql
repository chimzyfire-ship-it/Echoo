-- Keep a tapped discovery filter authoritative while treating onboarding and
-- time-of-day signals as a soft ranking preference. Previously every supplied
-- feature slug was an OR filter, so a Music quick filter plus a Fitness
-- onboarding signal could surface a fitness place that was not music-related.

drop function if exists public.search_discovery_owned_entities(
  text, text[], double precision, double precision, integer, text, text,
  integer, numeric, uuid
);

create function public.search_discovery_owned_entities(
  p_query text default null,
  p_feature_slugs text[] default '{}',
  p_preference_feature_slugs text[] default '{}',
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
  hot_score numeric,
  is_registered boolean,
  placement_tier text
)
language sql
stable
as $$
  with origin as (
    select case when p_lat is not null and p_lng is not null
      then extensions.st_setsrid(
        extensions.st_makepoint(p_lng, p_lat), 4326
      )::extensions.geography
      else null
    end as geo
  ),
  required_features as (
    select fc.id
    from public.discovery_feature_catalog fc
    where fc.is_active
      and cardinality(coalesce(p_feature_slugs, '{}'::text[])) > 0
      and fc.slug = any(p_feature_slugs)
  ),
  preference_features as (
    select fc.id
    from public.discovery_feature_catalog fc
    where fc.is_active
      and cardinality(coalesce(p_preference_feature_slugs, '{}'::text[])) > 0
      and fc.slug = any(p_preference_feature_slugs)
  ),
  -- The import taxonomy is the durable fallback for broad discovery intents.
  -- A newly imported venue should be searchable for “music” or “comedy”
  -- before an editorial worker has attached a richer feature record.
  intent_categories as (
    select distinct category
    from unnest(
      case
        when lower(coalesce(p_query, '')) ~ '(restaurant|food|dining|eat|brunch|lunch|dinner|tasting|bakery)'
          then array['restaurant', 'cafe', 'fast_food', 'food_court', 'ice_cream']::text[]
        when lower(coalesce(p_query, '')) ~ '(cafe|coffee|espresso)'
          then array['cafe', 'restaurant', 'ice_cream']::text[]
        when lower(coalesce(p_query, '')) ~ '(bar|pub|nightlife|lounge|late night)'
          then array['bar', 'pub', 'biergarten', 'nightclub', 'event_venue']::text[]
        when lower(coalesce(p_query, '')) ~ '(music|concert|band|dj|live sound)'
          then array['event_venue', 'nightclub', 'theatre', 'arts_centre']::text[]
        when lower(coalesce(p_query, '')) ~ '(comedy|standup|stand-up)'
          then array['theatre', 'event_venue', 'nightclub', 'arts_centre']::text[]
        when lower(coalesce(p_query, '')) ~ '(theatre|theater|performing art|play|musical)'
          then array['theatre', 'arts_centre', 'event_venue']::text[]
        when lower(coalesce(p_query, '')) ~ '(museum|gallery|tourism|landmark|attraction)'
          then array['museum', 'gallery', 'attraction', 'historic']::text[]
        when lower(coalesce(p_query, '')) ~ '(park|nature|trail|outdoor|walk)'
          then array['park', 'nature_reserve', 'trail']::text[]
        else '{}'::text[]
      end
    ) as category
  ),
  candidates as (
    select
      le.*,
      case when origin.geo is not null
        then extensions.st_distance(le.location, origin.geo)
        else null
      end as distance_meters,
      coalesce(stats.rating_average, null)::numeric as rating_average,
      coalesce(stats.rating_count, 0) as rating_count,
      coalesce(stats.verified_visit_count, 0) as verified_visit_count,
      coalesce(stats.save_count, 0) as save_count,
      coalesce(stats.hot_score, 0)::numeric as hot_score,
      coalesce(features.feature_slugs, '{}'::text[]) as feature_slugs,
      media.storage_path as cover_url,
      media.alt_text as cover_alt_text,
      placement.tier as placement_tier,
      (placement.location_entity_id is not null) as is_registered,
      (
        case
          when nullif(trim(coalesce(p_query, '')), '') is null then 0.08
          when lower(le.title) like '%' || lower(trim(p_query)) || '%' then 0.40
          when lower(coalesce(le.category, '')) like '%' || lower(trim(p_query)) || '%' then 0.22
          when lower(coalesce(le.description, '')) like '%' || lower(trim(p_query)) || '%' then 0.16
          when lower(coalesce(le.category, '')) in (select category from intent_categories) then 0.14
          else 0
        end
        + case
          when cardinality(coalesce(p_feature_slugs, '{}'::text[])) = 0 then 0
          when exists (
            select 1
            from public.discovery_entity_features ef
            where ef.location_entity_id = le.id
              and ef.review_status = 'approved'
              and ef.feature_id in (select id from required_features)
          ) then 0.32
          else 0
        end
        -- Preference matches must only improve the order of valid category
        -- candidates; they never decide eligibility for this query.
        + case
          when cardinality(coalesce(p_preference_feature_slugs, '{}'::text[])) = 0 then 0
          when exists (
            select 1
            from public.discovery_entity_features ef
            where ef.location_entity_id = le.id
              and ef.review_status = 'approved'
              and ef.feature_id in (select id from preference_features)
          ) then 0.14
          else 0
        end
        + case when origin.geo is null then 0.08
          else greatest(
            0,
            1 - (
              extensions.st_distance(le.location, origin.geo) /
              greatest(p_radius_meters, 1)
            )
          ) * 0.16
        end
        + least(coalesce(stats.hot_score, 0), 100) / 100 * 0.10
        + least(coalesce(stats.rating_bayesian, 0), 5) / 5 * 0.08
        + least(le.editorial_boost, 1) * 0.08
        + least(le.trust_score, 1) * 0.06
        + case placement.tier
          when 'top_pick' then 0.18
          when 'featured' then 0.11
          when 'registered' then 0.05
          else 0
        end
      )::numeric(10, 6) as rank_score
    from public.location_entities le
    cross join origin
    left join public.discovery_entity_stats stats
      on stats.location_entity_id = le.id
    left join lateral (
      select array_agg(fc.slug order by fc.slug) as feature_slugs
      from public.discovery_entity_features ef
      join public.discovery_feature_catalog fc
        on fc.id = ef.feature_id and fc.is_active
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
    left join lateral (
      select vp.location_entity_id, vp.tier
      from public.venue_search_placements vp
      where vp.location_entity_id = le.id
        and vp.status = 'active'
        and vp.starts_at <= now()
        and (vp.ends_at is null or vp.ends_at > now())
        and (
          cardinality(vp.promoted_categories) = 0
          or lower(le.category) = any(
            select lower(unnest(vp.promoted_categories))
          )
        )
      limit 1
    ) placement on true
    where le.status = 'published'
      and le.country_code = 'CA'
      and le.admin_area_1 = 'ON'
      -- An event that began hours ago is not a trustworthy “nearby now”
      -- recommendation. Untimed places remain eligible.
      and (
        coalesce(le.entity_type, 'place') <> 'event'
        or le.starts_at is null
        or le.starts_at >= now() - interval '3 hours'
      )
      and (p_city is null or lower(le.city) = lower(trim(p_city)))
      and (p_category is null or lower(coalesce(le.category, '')) = lower(trim(p_category)))
      and (
        origin.geo is null
        or extensions.st_dwithin(
          le.location,
          origin.geo,
          least(greatest(p_radius_meters, 1000), 100000)
        )
      )
      and (
        cardinality(coalesce(p_feature_slugs, '{}'::text[])) = 0
        or exists (
          select 1
          from public.discovery_entity_features ef
          where ef.location_entity_id = le.id
            and ef.review_status = 'approved'
            and ef.feature_id in (select id from required_features)
        )
      )
      and (
        nullif(trim(coalesce(p_query, '')), '') is null
        or lower(le.title) like '%' || lower(trim(p_query)) || '%'
        or lower(coalesce(le.category, '')) like '%' || lower(trim(p_query)) || '%'
        or lower(coalesce(le.description, '')) like '%' || lower(trim(p_query)) || '%'
        or lower(coalesce(le.category, '')) in (select category from intent_categories)
        or cardinality(coalesce(p_feature_slugs, '{}'::text[])) > 0
      )
  )
  select
    id, entity_type, entity_id, title, category, description, starts_at, city,
    admin_area_1, latitude, longitude, distance_meters, rank_score,
    feature_slugs, cover_url, cover_alt_text, rating_average, rating_count,
    verified_visit_count, save_count, hot_score, is_registered, placement_tier
  from candidates
  where p_cursor_score is null
    or rank_score < p_cursor_score
    or (rank_score = p_cursor_score and id > p_cursor_id)
  order by rank_score desc, id asc
  limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.search_discovery_owned_entities(
  text, text[], text[], double precision, double precision, integer, text,
  text, integer, numeric, uuid
) from public, anon, authenticated;
grant execute on function public.search_discovery_owned_entities(
  text, text[], text[], double precision, double precision, integer, text,
  text, integer, numeric, uuid
) to service_role;
