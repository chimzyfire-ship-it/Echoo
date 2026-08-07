-- Link Up · matches
--
-- A match is a proposed link-up between exactly two members who are (or were)
-- checked in at the same place. Both members must accept for a conversation to
-- open. Either member can decline or end at any time.
--
-- Matches are short-lived: a pending match has a ~10 minute fuse; an accepted
-- match ends when either member leaves or taps end.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'linkup_match_status') then
    create type public.linkup_match_status as enum
      ('pending', 'accepted', 'declined', 'expired', 'ended');
  end if;
end $$;

create table if not exists public.linkup_matches (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.canonical_places(id) on delete cascade,
  status public.linkup_match_status not null default 'pending',
  affinity integer check (affinity is null or affinity between 0 and 100),
  reason_tags text[] not null default '{}',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint linkup_matches_expires_after_create check (expires_at >= created_at)
);

create table if not exists public.linkup_match_members (
  match_id uuid not null references public.linkup_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  response text not null default 'pending'
    check (response in ('pending', 'accepted', 'declined')),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id)
);

-- Lookup: given a member, what are their matches (realtime payload routing).
create index if not exists linkup_match_members_user_idx
  on public.linkup_match_members (user_id, created_at desc);

-- Lookup: given a match, its members.
create index if not exists linkup_match_members_match_idx
  on public.linkup_match_members (match_id);

-- Lookup: matches by place + recency (prevents duplicate proposals).
create index if not exists linkup_matches_place_created_idx
  on public.linkup_matches (place_id, created_at desc);

-- A match must always have exactly two members. Enforced at the application
-- layer (the Edge Function inserts both rows in one transaction) and by this
-- debounced check constraint on the members table.
create or replace function public.linkup_match_member_count()
returns trigger language plpgsql as $$
begin
  if (
    select count(*) from public.linkup_match_members
    where match_id = coalesce(new.match_id, old.match_id)
  ) > 2 then
    raise exception 'A Link Up match can have at most two members';
  end if;
  return null;
end $$;

drop trigger if exists linkup_match_members_count_guard on public.linkup_match_members;
create trigger linkup_match_members_count_guard
  after insert or update or delete on public.linkup_match_members
  for each row execute function public.linkup_match_member_count();

comment on table public.linkup_matches is
  'Proposed Link Up meet-ups between two members at the same place.';
comment on column public.linkup_matches.affinity is
  '0–100 compatibility score for explainability/debugging only; not shown to users.';
comment on column public.linkup_matches.reason_tags is
  'Human-readable compatibility cues surfaced as eyebrow caps (e.g. shared_interest_music).';
comment on column public.linkup_matches.expires_at is
  'Fuse for a pending match (default 10 minutes). Accepted matches end on member action.';
