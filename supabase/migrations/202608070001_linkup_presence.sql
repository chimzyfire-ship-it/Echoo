-- Link Up · presence layer
--
-- Explicit, opt-in "I'm here" check-ins. A presence is created only when a
-- member taps the check-in affordance on a place detail; it is never derived
-- from background location. Each presence has a short TTL and is the input to
-- the match query (same place + overlapping active window).
--
-- Privacy: no device coordinates are stored here — only a reference to the
-- canonical place the member chose to declare. This mirrors the convention in
-- route_activity_events ("Exact device coordinates are never stored here").

create table if not exists public.linkup_presence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id uuid not null references public.canonical_places(id) on delete cascade,
  arrived_at timestamptz not null default now(),
  expires_at timestamptz not null,
  status text not null default 'active'
    check (status in ('active', 'ended', 'expired')),
  session_token text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One active presence per user per place. Implemented as a partial unique
-- index so ended/expired rows don't collide with a fresh check-in.
create unique index if not exists linkup_presence_active_unique_idx
  on public.linkup_presence (user_id, place_id)
  where status = 'active';

-- Hot path for the match query: same place, active, still within TTL.
create index if not exists linkup_presence_match_idx
  on public.linkup_presence (place_id, status, expires_at);

-- A member's recent presences (profile / debugging).
create index if not exists linkup_presence_user_idx
  on public.linkup_presence (user_id, created_at desc);

create trigger linkup_presence_touch_updated_at
  before update on public.linkup_presence
  for each row execute function public.touch_updated_at();

comment on table public.linkup_presence is
  'Link Up opt-in place check-ins. Privacy-preserving: stores place_id only, never coordinates.';
comment on column public.linkup_presence.status is
  'active = visible to matching; ended = member left; expired = TTL elapsed.';
comment on column public.linkup_presence.session_token is
  'Optional grouping key for a single outing (set by the client).';
