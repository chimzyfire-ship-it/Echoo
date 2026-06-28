-- Phase 2: Ontario data ingestion support.
-- Workers run out-of-band with the service role and never inside user-facing requests.

do $$
begin
  create type public.ontario_ingestion_status as enum ('running', 'completed', 'failed');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.ontario_ingestion_source_type as enum (
    'osm',
    'open_data',
    'ticketmaster',
    'echoo_partner',
    'echoo_manual'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.ontario_ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_type public.ontario_ingestion_source_type not null,
  status public.ontario_ingestion_status not null default 'running',
  source_url text,
  records_seen integer not null default 0,
  records_imported integer not null default 0,
  records_skipped integer not null default 0,
  error_sample text[] not null default '{}',
  metadata jsonb not null default '{}',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ontario_ingestion_runs_source_idx
  on public.ontario_ingestion_runs (source_type, source_name, started_at desc);

create index if not exists ontario_ingestion_runs_status_idx
  on public.ontario_ingestion_runs (status, started_at desc);

alter table public.ontario_ingestion_runs enable row level security;

drop policy if exists "ontario ingestion runs are service-role only"
  on public.ontario_ingestion_runs;
create policy "ontario ingestion runs are service-role only"
on public.ontario_ingestion_runs
for all
using (false)
with check (false);

create index if not exists location_entities_place_mirror_idx
  on public.location_entities (entity_type, place_id, status)
  where entity_type = 'place';

create index if not exists location_entities_source_time_idx
  on public.location_entities (source_provider, starts_at desc nulls last)
  where entity_type = 'event';
