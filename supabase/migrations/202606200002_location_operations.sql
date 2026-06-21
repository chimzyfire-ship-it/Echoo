-- Operational hardening for Echoo location: logging, cache, and review workflow.

create table if not exists public.location_request_logs (
  id uuid primary key default gen_random_uuid(),
  function_name text not null,
  event_type text not null,
  status text not null default 'ok',
  cache_hit boolean not null default false,
  duration_ms integer,
  country_code text,
  admin_area_1 text,
  city text,
  reason text,
  request jsonb not null default '{}',
  response_summary jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.location_query_cache (
  cache_key text primary key,
  payload jsonb not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists location_request_logs_created_idx
  on public.location_request_logs (created_at desc);

create index if not exists location_request_logs_event_idx
  on public.location_request_logs (function_name, event_type, status, created_at desc);

create index if not exists location_query_cache_expiry_idx
  on public.location_query_cache (expires_at);

drop trigger if exists location_query_cache_touch_updated_at on public.location_query_cache;
create trigger location_query_cache_touch_updated_at
before update on public.location_query_cache
for each row execute function public.touch_updated_at();

alter table public.location_request_logs enable row level security;
alter table public.location_query_cache enable row level security;

drop policy if exists "location logs are service-role only" on public.location_request_logs;
create policy "location logs are service-role only"
on public.location_request_logs
for all
using (false)
with check (false);

drop policy if exists "location cache is service-role only" on public.location_query_cache;
create policy "location cache is service-role only"
on public.location_query_cache
for all
using (false)
with check (false);

create or replace function public.review_location_place(
  p_place_id uuid,
  p_status public.location_entity_status,
  p_confidence_score numeric default null
)
returns public.canonical_places
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  updated_place public.canonical_places;
begin
  update public.canonical_places
  set
    location_status = p_status,
    is_supported_region = (p_status = 'published'),
    confidence_score = coalesce(p_confidence_score, confidence_score)
  where id = p_place_id
  returning * into updated_place;

  if updated_place.id is null then
    raise exception 'canonical place % not found', p_place_id;
  end if;

  return updated_place;
end;
$$;

create or replace function public.prune_location_query_cache()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.location_query_cache
  where expires_at < now()
  returning 1 into deleted_count;

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;
