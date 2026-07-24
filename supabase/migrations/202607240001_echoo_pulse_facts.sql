-- Echoo Pulse only serves evidence-backed facts. Category inference is never
-- sufficient evidence about a specific venue.
create table if not exists public.place_pulse_facts (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.canonical_places(id) on delete cascade,
  fact_type text not null check (fact_type in ('best_for', 'notice', 'access', 'experience')),
  value text not null check (char_length(trim(value)) between 3 and 180),
  source_name text not null check (char_length(trim(source_name)) between 2 and 120),
  source_url text,
  source_record_id text,
  confidence_score numeric(4, 3) not null check (confidence_score between 0 and 1),
  observed_at timestamptz not null,
  expires_at timestamptz not null,
  approval_status public.review_status not null default 'pending',
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_pulse_facts_time_window check (expires_at > observed_at),
  constraint place_pulse_facts_approval check (
    (approval_status = 'approved' and approved_at is not null)
    or approval_status <> 'approved'
  )
);

create unique index if not exists place_pulse_facts_source_record_unique
  on public.place_pulse_facts (place_id, source_name, source_record_id)
  where source_record_id is not null;
create index if not exists place_pulse_facts_serving_idx
  on public.place_pulse_facts (place_id, approval_status, expires_at, confidence_score desc);

drop trigger if exists place_pulse_facts_touch_updated_at on public.place_pulse_facts;
create trigger place_pulse_facts_touch_updated_at
before update on public.place_pulse_facts
for each row execute function public.touch_updated_at();

alter table public.place_pulse_facts enable row level security;
drop policy if exists "approved pulse facts are readable" on public.place_pulse_facts;
create policy "approved pulse facts are readable"
on public.place_pulse_facts for select
using (
  approval_status = 'approved' and expires_at > now()
  and exists (
    select 1 from public.canonical_places cp
    where cp.id = place_pulse_facts.place_id
      and cp.is_supported_region = true and cp.location_status = 'published'
  )
);
