-- Enrol only profiles completed after this migration. Existing members are
-- deliberately not backfilled. Keep this separate from editable preferences.
create table public.first_use_walkthroughs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  started_at timestamptz
);
alter table public.first_use_walkthroughs enable row level security;
revoke all on public.first_use_walkthroughs from anon, authenticated;

create function public.enrol_first_use_walkthrough()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.completed_at is not null then
    if tg_op = 'INSERT' then
      insert into public.first_use_walkthroughs(user_id) values(new.user_id)
        on conflict do nothing;
    elsif old.completed_at is null then
      insert into public.first_use_walkthroughs(user_id) values(new.user_id)
        on conflict do nothing;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.enrol_first_use_walkthrough() from public;
create trigger enrol_first_use_walkthrough
after insert or update of completed_at on public.user_onboarding_profiles
for each row execute function public.enrol_first_use_walkthrough();

-- Atomic account-level claim: only one device/tab can show the introduction.
-- Claim at entry, rather than exit, so dismissing or closing never replays it.
create function public.claim_first_use_walkthrough()
returns boolean language plpgsql security definer set search_path = '' as $$
declare claimed uuid;
begin
  update public.first_use_walkthroughs set started_at = now()
    where user_id = auth.uid() and started_at is null
    returning user_id into claimed;
  return claimed is not null;
end;
$$;
revoke all on function public.claim_first_use_walkthrough() from public, anon;
grant execute on function public.claim_first_use_walkthrough() to authenticated;
