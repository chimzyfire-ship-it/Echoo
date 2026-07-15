-- Registered-business discovery is intentionally distinct from organic search.
-- A paid listing can earn a clearly labelled boost only for relevant categories;
-- it cannot hide or replace the full organic result set.

do $$
begin
  create type public.venue_listing_request_status as enum (
    'submitted', 'verified', 'approved', 'rejected', 'withdrawn'
  );
exception when duplicate_object then null;
end $$;

do $$
begin
  create type public.venue_search_placement_status as enum (
    'active', 'paused', 'expired', 'suspended'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.venue_listing_requests (
  id uuid primary key default gen_random_uuid(),
  location_entity_id uuid not null references public.location_entities(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  business_email text not null,
  business_phone text,
  business_website text,
  requested_categories text[] not null default '{}',
  note text,
  status public.venue_listing_request_status not null default 'submitted',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venue_listing_requests_email_format check (business_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint venue_listing_requests_categories_limit check (cardinality(requested_categories) <= 8)
);

create index if not exists venue_listing_requests_entity_status_idx
  on public.venue_listing_requests (location_entity_id, status, created_at desc);
create index if not exists venue_listing_requests_requester_idx
  on public.venue_listing_requests (requested_by, created_at desc);

create table if not exists public.venue_search_placements (
  id uuid primary key default gen_random_uuid(),
  location_entity_id uuid not null unique references public.location_entities(id) on delete cascade,
  listing_request_id uuid references public.venue_listing_requests(id) on delete set null,
  status public.venue_search_placement_status not null default 'paused',
  tier text not null default 'registered' check (tier in ('registered', 'featured', 'top_pick')),
  promoted_categories text[] not null default '{}',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  billing_reference text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venue_search_placements_categories_limit check (cardinality(promoted_categories) <= 8),
  constraint venue_search_placements_ends_after_start check (ends_at is null or ends_at > starts_at)
);

create index if not exists venue_search_placements_active_idx
  on public.venue_search_placements (status, starts_at, ends_at, tier);
create index if not exists venue_search_placements_categories_idx
  on public.venue_search_placements using gin (promoted_categories);

drop trigger if exists venue_listing_requests_touch_updated_at on public.venue_listing_requests;
create trigger venue_listing_requests_touch_updated_at
before update on public.venue_listing_requests
for each row execute function public.touch_updated_at();

drop trigger if exists venue_search_placements_touch_updated_at on public.venue_search_placements;
create trigger venue_search_placements_touch_updated_at
before update on public.venue_search_placements
for each row execute function public.touch_updated_at();

alter table public.venue_listing_requests enable row level security;
alter table public.venue_search_placements enable row level security;

-- Contact and billing data are never exposed to the browser. Edge Functions
-- use the service role after authenticating the business owner/admin.
drop policy if exists "venue listing requests are private" on public.venue_listing_requests;
create policy "venue listing requests are private"
on public.venue_listing_requests for all using (false) with check (false);

drop policy if exists "venue search placements are private" on public.venue_search_placements;
create policy "venue search placements are private"
on public.venue_search_placements for all using (false) with check (false);

drop function if exists public.search_discovery_owned_entities(text, text[], double precision, double precision, integer, text, text, integer, numeric, uuid);

create function public.search_discovery_owned_entities(
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
  hot_score numeric,
  is_registered boolean,
  placement_tier text
)
language sql
stable
as $$
  with origin as (
    select case when p_lat is not null and p_lng is not null
      then extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography
      else null end as geo
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
      placement.tier as placement_tier,
      (placement.location_entity_id is not null) as is_registered,
      (
        case
          when nullif(trim(coalesce(p_query, '')), '') is null then 0.08
          when lower(le.title) like '%' || lower(trim(p_query)) || '%' then 0.40
          when lower(coalesce(le.category, '')) like '%' || lower(trim(p_query)) || '%' then 0.22
          when lower(coalesce(le.description, '')) like '%' || lower(trim(p_query)) || '%' then 0.16
          else 0
        end
        + case when cardinality(coalesce(p_feature_slugs, '{}'::text[])) = 0 then 0
          when coalesce(features.feature_slugs, '{}'::text[]) && p_feature_slugs then 0.32 else 0 end
        + case when origin.geo is null then 0.08
          else greatest(0, 1 - (extensions.st_distance(le.location, origin.geo) / greatest(p_radius_meters, 1))) * 0.16 end
        + least(coalesce(stats.hot_score, 0), 100) / 100 * 0.10
        + least(coalesce(stats.rating_bayesian, 0), 5) / 5 * 0.08
        + least(le.editorial_boost, 1) * 0.08
        + least(le.trust_score, 1) * 0.06
        + case placement.tier when 'top_pick' then 0.18 when 'featured' then 0.11 when 'registered' then 0.05 else 0 end
      )::numeric(10, 6) as rank_score
    from public.location_entities le
    cross join origin
    left join public.discovery_entity_stats stats on stats.location_entity_id = le.id
    left join lateral (
      select array_agg(fc.slug order by fc.slug) as feature_slugs
      from public.discovery_entity_features ef
      join public.discovery_feature_catalog fc on fc.id = ef.feature_id and fc.is_active
      where ef.location_entity_id = le.id and ef.review_status = 'approved'
    ) features on true
    left join lateral (
      select dm.storage_path, dm.alt_text from public.discovery_entity_media dm
      where dm.location_entity_id = le.id and dm.review_status = 'approved' and dm.media_kind = 'image'
      order by dm.is_cover desc, dm.sort_order asc, dm.created_at asc limit 1
    ) media on true
    left join lateral (
      select vp.location_entity_id, vp.tier
      from public.venue_search_placements vp
      where vp.location_entity_id = le.id
        and vp.status = 'active'
        and vp.starts_at <= now()
        and (vp.ends_at is null or vp.ends_at > now())
        and (cardinality(vp.promoted_categories) = 0 or lower(le.category) = any(select lower(unnest(vp.promoted_categories))))
      limit 1
    ) placement on true
    where le.status = 'published' and le.country_code = 'CA' and le.admin_area_1 = 'ON'
      and (p_city is null or lower(le.city) = lower(trim(p_city)))
      and (p_category is null or lower(coalesce(le.category, '')) = lower(trim(p_category)))
      and (origin.geo is null or extensions.st_dwithin(le.location, origin.geo, least(greatest(p_radius_meters, 1000), 100000)))
      and (cardinality(coalesce(p_feature_slugs, '{}'::text[])) = 0 or coalesce(features.feature_slugs, '{}'::text[]) && p_feature_slugs)
      and (nullif(trim(coalesce(p_query, '')), '') is null
        or lower(le.title) like '%' || lower(trim(p_query)) || '%'
        or lower(coalesce(le.category, '')) like '%' || lower(trim(p_query)) || '%'
        or lower(coalesce(le.description, '')) like '%' || lower(trim(p_query)) || '%'
        or cardinality(coalesce(p_feature_slugs, '{}'::text[])) > 0)
  )
  select id, entity_type, entity_id, title, category, description, starts_at, city,
    admin_area_1, latitude, longitude, distance_meters, rank_score, feature_slugs,
    cover_url, cover_alt_text, rating_average, rating_count, verified_visit_count,
    save_count, hot_score, is_registered, placement_tier
  from candidates
  where p_cursor_score is null or rank_score < p_cursor_score or (rank_score = p_cursor_score and id > p_cursor_id)
  order by rank_score desc, id asc
  limit least(greatest(p_limit, 1), 50);
$$;

revoke all on function public.search_discovery_owned_entities(text, text[], double precision, double precision, integer, text, text, integer, numeric, uuid) from public, anon, authenticated;
