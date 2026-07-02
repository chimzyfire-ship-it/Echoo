-- Phase 3: Ontario operations queues, duplicate review, and stale cleanup.

create table if not exists public.ontario_worker_schedules (
  id uuid primary key default gen_random_uuid(),
  job_name text not null unique,
  function_name text not null,
  schedule_label text not null,
  request_payload jsonb not null default '{}',
  is_active boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  last_summary jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists ontario_worker_schedules_touch_updated_at
  on public.ontario_worker_schedules;
create trigger ontario_worker_schedules_touch_updated_at
before update on public.ontario_worker_schedules
for each row execute function public.touch_updated_at();

alter table public.ontario_worker_schedules enable row level security;

drop policy if exists "ontario worker schedules are service-role only"
  on public.ontario_worker_schedules;
create policy "ontario worker schedules are service-role only"
on public.ontario_worker_schedules
for all
using (false)
with check (false);

insert into public.ontario_worker_schedules (
  job_name,
  function_name,
  schedule_label,
  request_payload
)
values
  (
    'ticketmaster_priority_refresh',
    'ontario-maintenance',
    'daily 05:20 America/Toronto',
    '{"action":"ticketmaster_refresh","cities":["Toronto","Markham","Mississauga","Hamilton","Ottawa","Kitchener","London"],"categories":["music","sports","theatre","arts","family","comedy"],"size":20}'::jsonb
  ),
  (
    'ontario_stale_event_cleanup',
    'ontario-maintenance',
    'nightly 04:10 America/Toronto',
    '{"action":"stale_event_cleanup","olderThanHours":6}'::jsonb
  )
on conflict (job_name) do update
set
  function_name = excluded.function_name,
  schedule_label = excluded.schedule_label,
  request_payload = excluded.request_payload,
  is_active = true;

create or replace function public.cleanup_stale_ontario_events(
  p_older_than_hours integer default 6
)
returns table (
  archived_events integer,
  archived_location_entities integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff timestamptz := now() - make_interval(hours => greatest(p_older_than_hours, 0));
begin
  update public.ontario_events
  set status = 'archived'
  where status = 'published'
    and (
      (ends_at is not null and ends_at < cutoff)
      or (ends_at is null and starts_at is not null and starts_at < cutoff)
      or (last_seen_at < now() - interval '90 days')
    );
  get diagnostics archived_events = row_count;

  update public.location_entities
  set status = 'archived'
  where entity_type = 'event'
    and source_provider = 'ticketmaster'
    and status = 'published'
    and (
      (ends_at is not null and ends_at < cutoff)
      or (ends_at is null and starts_at is not null and starts_at < cutoff)
    );
  get diagnostics archived_location_entities = row_count;

  return next;
end;
$$;

create or replace function public.ontario_duplicate_place_candidates(
  p_limit integer default 50
)
returns table (
  candidate_key text,
  primary_place_id uuid,
  duplicate_place_id uuid,
  primary_name text,
  duplicate_name text,
  municipality text,
  category text,
  distance_meters double precision,
  primary_confidence numeric,
  duplicate_confidence numeric,
  primary_source text,
  duplicate_source text
)
language sql
stable
as $$
  with pairs as (
    select
      least(a.id::text, b.id::text) || ':' || greatest(a.id::text, b.id::text) as candidate_key,
      case
        when coalesce(a.confidence_score, 0) >= coalesce(b.confidence_score, 0) then a.id
        else b.id
      end as primary_place_id,
      case
        when coalesce(a.confidence_score, 0) >= coalesce(b.confidence_score, 0) then b.id
        else a.id
      end as duplicate_place_id,
      case
        when coalesce(a.confidence_score, 0) >= coalesce(b.confidence_score, 0) then a.name
        else b.name
      end as primary_name,
      case
        when coalesce(a.confidence_score, 0) >= coalesce(b.confidence_score, 0) then b.name
        else a.name
      end as duplicate_name,
      coalesce(a.municipality, a.city, b.municipality, b.city) as municipality,
      coalesce(a.category, b.category) as category,
      extensions.st_distance(a.location, b.location) as distance_meters,
      case
        when coalesce(a.confidence_score, 0) >= coalesce(b.confidence_score, 0) then a.confidence_score
        else b.confidence_score
      end as primary_confidence,
      case
        when coalesce(a.confidence_score, 0) >= coalesce(b.confidence_score, 0) then b.confidence_score
        else a.confidence_score
      end as duplicate_confidence,
      case
        when coalesce(a.confidence_score, 0) >= coalesce(b.confidence_score, 0) then a.source_provider
        else b.source_provider
      end as primary_source,
      case
        when coalesce(a.confidence_score, 0) >= coalesce(b.confidence_score, 0) then b.source_provider
        else a.source_provider
      end as duplicate_source
    from public.canonical_places a
    join public.canonical_places b
      on a.id < b.id
      and a.country_code = 'CA'
      and b.country_code = 'CA'
      and a.admin_area_1 = 'ON'
      and b.admin_area_1 = 'ON'
      and a.location_status <> 'archived'
      and b.location_status <> 'archived'
      and coalesce(a.category, '') = coalesce(b.category, '')
      and coalesce(a.municipality, a.city, '') = coalesce(b.municipality, b.city, '')
      and a.normalized_name = b.normalized_name
      and extensions.st_dwithin(a.location, b.location, 150)
  )
  select *
  from pairs
  order by distance_meters asc, primary_confidence desc nulls last
  limit least(greatest(p_limit, 1), 200);
$$;

create or replace function public.ontario_profile_review_queue(
  p_limit integer default 50
)
returns table (
  profile_id uuid,
  place_id uuid,
  name text,
  municipality text,
  category text,
  confidence_score numeric,
  human_review_status public.review_status,
  summary text,
  source_provider text,
  updated_at timestamptz
)
language sql
stable
as $$
  select
    pp.id as profile_id,
    cp.id as place_id,
    cp.name,
    coalesce(cp.municipality, cp.city) as municipality,
    cp.category,
    pp.confidence_score,
    pp.human_review_status,
    pp.summary,
    cp.source_provider,
    pp.updated_at
  from public.place_profiles pp
  join public.canonical_places cp on cp.id = pp.place_id
  where cp.country_code = 'CA'
    and cp.admin_area_1 = 'ON'
    and cp.location_status = 'published'
    and (
      pp.human_review_status in ('pending', 'needs_update')
      or pp.confidence_score < 0.72
    )
  order by
    case pp.human_review_status
      when 'pending' then 0
      when 'needs_update' then 1
      else 2
    end,
    pp.confidence_score asc,
    pp.updated_at asc
  limit least(greatest(p_limit, 1), 200);
$$;

create or replace function public.review_place_profile(
  p_profile_id uuid,
  p_status public.review_status,
  p_confidence_score numeric default null
)
returns public.place_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_profile public.place_profiles;
begin
  update public.place_profiles
  set
    human_review_status = p_status,
    confidence_score = coalesce(p_confidence_score, confidence_score),
    reviewed_at = now()
  where id = p_profile_id
  returning * into updated_profile;

  if updated_profile.id is null then
    raise exception 'place profile % not found', p_profile_id;
  end if;

  return updated_profile;
end;
$$;

create or replace function public.merge_canonical_places(
  p_primary_place_id uuid,
  p_duplicate_place_id uuid
)
returns public.canonical_places
language plpgsql
security definer
set search_path = public
as $$
declare
  primary_place public.canonical_places;
begin
  if p_primary_place_id = p_duplicate_place_id then
    raise exception 'primary and duplicate place ids must differ';
  end if;

  select *
  into primary_place
  from public.canonical_places
  where id = p_primary_place_id;

  if primary_place.id is null then
    raise exception 'primary canonical place % not found', p_primary_place_id;
  end if;

  delete from public.place_sources duplicate_source
  where duplicate_source.place_id = p_duplicate_place_id
    and exists (
      select 1
      from public.place_sources primary_source
      where primary_source.place_id = p_primary_place_id
        and primary_source.source_name = duplicate_source.source_name
        and primary_source.source_record_id is not distinct from duplicate_source.source_record_id
    );

  update public.place_sources
  set place_id = p_primary_place_id
  where place_id = p_duplicate_place_id;

  update public.place_profiles
  set place_id = p_primary_place_id
  where place_id = p_duplicate_place_id
    and not exists (
      select 1
      from public.place_profiles existing
      where existing.place_id = p_primary_place_id
    );

  update public.place_profiles
  set
    human_review_status = 'rejected',
    caveats = concat_ws(
      E'\n',
      nullif(caveats, ''),
      'Merged into canonical place ' || p_primary_place_id::text
    ),
    reviewed_at = now()
  where place_id = p_duplicate_place_id;

  update public.place_hours
  set place_id = p_primary_place_id
  where place_id = p_duplicate_place_id
    and not exists (
      select 1
      from public.place_hours existing
      where existing.place_id = p_primary_place_id
        and existing.day_of_week = place_hours.day_of_week
        and existing.opens_at is not distinct from place_hours.opens_at
        and existing.closes_at is not distinct from place_hours.closes_at
    );

  update public.ontario_events
  set place_id = p_primary_place_id
  where place_id = p_duplicate_place_id;

  update public.location_entities
  set
    place_id = p_primary_place_id,
    entity_id = case when entity_type = 'place' then p_primary_place_id else entity_id end,
    metadata = metadata || jsonb_build_object('merged_from_place_id', p_duplicate_place_id)
  where place_id = p_duplicate_place_id;

  update public.location_entities
  set status = 'archived'
  where entity_type = 'place'
    and entity_id = p_duplicate_place_id;

  update public.canonical_places
  set
    location_status = 'archived',
    is_supported_region = false,
    metadata = metadata || jsonb_build_object('merged_into_place_id', p_primary_place_id)
  where id = p_duplicate_place_id;

  return primary_place;
end;
$$;
