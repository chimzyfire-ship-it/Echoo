-- Shared, atomic provider budgets. A normal conversation is never limited to
-- a tiny prompt allowance; operators can adjust the daily caps server-side.
create table public.planning_provider_usage (
  day date not null default (now() at time zone 'UTC')::date,
  provider text not null check (provider in ('gemini', 'places')),
  calls integer not null default 0,
  primary key (day, provider)
);
alter table public.planning_provider_usage enable row level security;
revoke all on public.planning_provider_usage from public, anon, authenticated;
grant all on public.planning_provider_usage to service_role;

create function public.reserve_planning_provider(p_provider text, p_daily_limit integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare reserved integer;
begin
  if p_provider not in ('gemini','places') or p_daily_limit < 1 then return false; end if;
  insert into public.planning_provider_usage(day,provider,calls)
  values ((now() at time zone 'UTC')::date,p_provider,1)
  on conflict(day,provider) do update set calls=planning_provider_usage.calls+1
    where planning_provider_usage.calls < least(p_daily_limit,1000000)
  returning calls into reserved;
  return reserved is not null;
end;
$$;
revoke all on function public.reserve_planning_provider(text,integer) from public,anon,authenticated;
grant execute on function public.reserve_planning_provider(text,integer) to service_role;
