-- GTA-25 source coverage is a reconciliation problem, not a “has at least
-- one record” problem. A full municipal OSM extract reports the number of
-- normalized source records it contained; Echoo can then prove whether every
-- one of those records reached the canonical search index.

create table if not exists public.gta_place_source_coverage_snapshots (
  id uuid primary key default gen_random_uuid(),
  municipality text not null,
  category text not null,
  source_name text not null,
  source_snapshot_id text not null,
  source_record_count integer not null check (source_record_count >= 0),
  source_url text,
  observed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gta_place_source_coverage_snapshot_unique unique (
    municipality, category, source_name, source_snapshot_id
  ),
  constraint gta_place_source_coverage_municipality_check check (
    municipality in (
      'Toronto', 'Ajax', 'Brock', 'Clarington', 'Oshawa', 'Pickering',
      'Scugog', 'Uxbridge', 'Whitby', 'Aurora', 'East Gwillimbury',
      'Georgina', 'King', 'Markham', 'Newmarket', 'Richmond Hill', 'Vaughan',
      'Whitchurch-Stouffville', 'Brampton', 'Caledon', 'Mississauga',
      'Burlington', 'Halton Hills', 'Milton', 'Oakville'
    )
  )
);

create index if not exists gta_place_source_coverage_latest_idx
  on public.gta_place_source_coverage_snapshots (
    municipality, category, source_name, observed_at desc
  );

drop trigger if exists gta_place_source_coverage_touch_updated_at
  on public.gta_place_source_coverage_snapshots;
create trigger gta_place_source_coverage_touch_updated_at
before update on public.gta_place_source_coverage_snapshots
for each row execute function public.touch_updated_at();

alter table public.gta_place_source_coverage_snapshots enable row level security;

drop policy if exists "service role manages GTA source coverage snapshots"
  on public.gta_place_source_coverage_snapshots;
create policy "service role manages GTA source coverage snapshots"
on public.gta_place_source_coverage_snapshots
for all
to service_role
using (true)
with check (true);

-- A snapshot is complete only after every chunk has imported successfully.
-- Finalizing it makes the new snapshot authoritative and removes OSM places
-- that were not present in the current municipal extract, preventing closed
-- or deleted venues from lingering in search indefinitely.
create or replace function public.finalize_gta_osm_coverage_snapshot(
  p_municipality text,
  p_source_snapshot_id text,
  p_source_url text,
  p_source_record_counts jsonb
)
returns table (
  municipality text,
  source_snapshot_id text,
  source_record_count integer,
  archived_places bigint,
  archived_entities bigint
)
language plpgsql
set search_path = public
as $$
declare
  v_archived_places bigint := 0;
  v_archived_entities bigint := 0;
begin
  if not exists (
    select 1
    from public.supported_regions sr
    where sr.country_code = 'CA'
      and sr.admin_area_1 = 'ON'
      and sr.city = p_municipality
      and sr.status = 'active'
      and sr.metadata ->> 'coverage_area' = 'Greater Toronto Area'
  ) then
    raise exception 'Unsupported GTA municipality: %', p_municipality;
  end if;

  insert into public.gta_place_source_coverage_snapshots (
    municipality,
    category,
    source_name,
    source_snapshot_id,
    source_record_count,
    source_url,
    observed_at
  )
  select
    p_municipality,
    category.category,
    'openstreetmap',
    p_source_snapshot_id,
    greatest(0, coalesce((p_source_record_counts ->> category.category)::integer, 0)),
    nullif(trim(p_source_url), ''),
    now()
  from unnest(array[
    'restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court',
    'ice_cream', 'biergarten', 'nightclub', 'theatre', 'cinema',
    'arts_centre', 'event_venue', 'community_centre', 'library',
    'attraction', 'museum', 'gallery', 'park', 'fitness_centre',
    'nature_reserve', 'mall', 'club', 'historic'
  ]::text[]) as category(category)
  on conflict (municipality, category, source_name, source_snapshot_id)
  do update set
    source_record_count = excluded.source_record_count,
    source_url = excluded.source_url,
    observed_at = excluded.observed_at,
    updated_at = now();

  update public.canonical_places cp
  set
    location_status = 'archived',
    is_supported_region = false,
    metadata = cp.metadata || jsonb_build_object(
      'archived_reason', 'absent_from_current_osm_snapshot',
      'archived_at', now()
    )
  where cp.country_code = 'CA'
    and cp.admin_area_1 = 'ON'
    and lower(cp.municipality) = lower(p_municipality)
    and cp.source_provider = 'openstreetmap'
    and cp.location_status <> 'archived'
    and coalesce(cp.metadata ->> 'source_snapshot_id', '') <> p_source_snapshot_id;
  get diagnostics v_archived_places = row_count;

  update public.location_entities le
  set
    status = 'archived',
    metadata = le.metadata || jsonb_build_object(
      'archived_reason', 'absent_from_current_osm_snapshot',
      'archived_at', now()
    )
  where le.country_code = 'CA'
    and le.admin_area_1 = 'ON'
    and lower(le.city) = lower(p_municipality)
    and le.source_provider = 'openstreetmap'
    and le.status <> 'archived'
    and coalesce(le.metadata ->> 'source_snapshot_id', '') <> p_source_snapshot_id;
  get diagnostics v_archived_entities = row_count;

  return query
  select
    p_municipality,
    p_source_snapshot_id,
    coalesce(sum(snapshot.source_record_count), 0)::integer,
    v_archived_places,
    v_archived_entities
  from public.gta_place_source_coverage_snapshots snapshot
  where snapshot.municipality = p_municipality
    and snapshot.source_name = 'openstreetmap'
    and snapshot.source_snapshot_id = p_source_snapshot_id;
end;
$$;

revoke all on function public.finalize_gta_osm_coverage_snapshot(text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.finalize_gta_osm_coverage_snapshot(text, text, text, jsonb)
  to service_role;

create or replace function public.gta_place_source_coverage_audit()
returns table (
  municipality text,
  category text,
  source_name text,
  source_snapshot_id text,
  source_record_count integer,
  indexed_record_count bigint,
  observed_at timestamptz,
  is_fresh boolean,
  is_reconciled boolean,
  status text
)
language sql
stable
set search_path = public
as $$
  with municipalities as (
    select sr.city as municipality
    from public.supported_regions sr
    where sr.country_code = 'CA'
      and sr.admin_area_1 = 'ON'
      and sr.status = 'active'
      and sr.metadata ->> 'coverage_area' = 'Greater Toronto Area'
  ),
  categories as (
    select unnest(array[
      'restaurant', 'cafe', 'bar', 'pub', 'fast_food', 'food_court',
      'ice_cream', 'biergarten', 'nightclub', 'theatre', 'cinema',
      'arts_centre', 'event_venue', 'community_centre', 'library',
      'attraction', 'museum', 'gallery', 'park', 'fitness_centre',
      'nature_reserve', 'mall', 'club', 'historic'
    ]::text[]) as category
  ),
  latest_snapshot as (
    select distinct on (snapshot.municipality, snapshot.category)
      snapshot.municipality,
      snapshot.category,
      snapshot.source_name,
      snapshot.source_snapshot_id,
      snapshot.source_record_count,
      snapshot.observed_at
    from public.gta_place_source_coverage_snapshots snapshot
    where snapshot.source_name = 'openstreetmap'
    order by snapshot.municipality, snapshot.category, snapshot.observed_at desc
  ),
  expected as (
    select municipality.municipality, category.category
    from municipalities municipality
    cross join categories category
  )
  select
    expected.municipality,
    expected.category,
    snapshot.source_name,
    snapshot.source_snapshot_id,
    coalesce(snapshot.source_record_count, 0)::integer as source_record_count,
    coalesce(indexed.indexed_record_count, 0)::bigint as indexed_record_count,
    snapshot.observed_at,
    coalesce(snapshot.observed_at >= now() - interval '35 days', false) as is_fresh,
    case
      when snapshot.source_snapshot_id is null then false
      when snapshot.source_record_count = 0 then true
      else coalesce(indexed.indexed_record_count, 0) >= snapshot.source_record_count
    end as is_reconciled,
    case
      when snapshot.source_snapshot_id is null then 'missing_snapshot'
      when snapshot.observed_at < now() - interval '35 days' then 'stale_snapshot'
      when snapshot.source_record_count = 0 then 'confirmed_empty_in_source'
      when coalesce(indexed.indexed_record_count, 0) >= snapshot.source_record_count then 'reconciled'
      else 'import_gap'
    end as status
  from expected
  left join latest_snapshot snapshot
    on snapshot.municipality = expected.municipality
   and snapshot.category = expected.category
  left join lateral (
    select count(distinct cp.source_id) as indexed_record_count
    from public.canonical_places cp
    where cp.country_code = 'CA'
      and cp.admin_area_1 = 'ON'
      and lower(cp.municipality) = lower(expected.municipality)
      and lower(cp.category) = lower(expected.category)
      and cp.source_provider = snapshot.source_name
      and cp.metadata ->> 'source_snapshot_id' = snapshot.source_snapshot_id
      and cp.location_status = 'published'
  ) indexed on true
  order by expected.municipality, expected.category;
$$;

revoke all on function public.gta_place_source_coverage_audit()
  from public, anon, authenticated;
grant execute on function public.gta_place_source_coverage_audit()
  to service_role;
