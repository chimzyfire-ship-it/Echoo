create table if not exists public.echoo_invitations (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  created_by uuid not null references auth.users(id) on delete cascade,
  sender_name text not null default 'Someone',
  target_type text not null check (target_type in ('event', 'place')),
  target_id uuid not null,
  expires_at timestamptz not null default (now() + interval '30 days'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint echoo_invitations_sender_name_length
    check (char_length(sender_name) between 1 and 80),
  constraint echoo_invitations_expiry_after_creation
    check (expires_at > created_at)
);

create index if not exists echoo_invitations_creator_created_idx
  on public.echoo_invitations (created_by, created_at desc);

create index if not exists echoo_invitations_target_idx
  on public.echoo_invitations (target_type, target_id, created_at desc);

create index if not exists echoo_invitations_active_expiry_idx
  on public.echoo_invitations (expires_at)
  where revoked_at is null;

alter table public.echoo_invitations enable row level security;

create or replace function public.echoo_enforce_invitation_daily_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  recent_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.created_by::text, 0)
  );

  select count(*)::integer
  into recent_count
  from public.echoo_invitations
  where created_by = new.created_by
    and created_at >= now() - interval '24 hours';

  if recent_count >= 30 then
    raise exception 'echoo_invitation_daily_limit'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

drop trigger if exists echoo_invitations_daily_limit
  on public.echoo_invitations;
create trigger echoo_invitations_daily_limit
before insert on public.echoo_invitations
for each row execute function public.echoo_enforce_invitation_daily_limit();

revoke all on function public.echoo_enforce_invitation_daily_limit()
  from public, anon, authenticated;

-- Invite records are capabilities managed by Edge Functions. Clients receive
-- only the raw token once and cannot read token hashes or creator identifiers.
revoke all on table public.echoo_invitations from public, anon, authenticated;

comment on table public.echoo_invitations is
  'Opaque, expiring links for sharing published Echoo events and places.';
