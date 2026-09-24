-- Existing accounts retain permanent full access. No signup trigger grants access.
begin;
create table public.mobile_access_grants (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kind text not null check (kind in ('founder','tester','reviewer')),
  expires_at timestamptz,
  note text not null,
  created_at timestamptz not null default now()
);
insert into public.mobile_access_grants(user_id,kind,note)
select id,'founder','Permanent full access: existing account at mobile subscription rollout'
from auth.users;

create table public.mobile_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text check (plan in ('city_pass','city_all_access')),
  expires_at timestamptz,
  store text,
  verified_at timestamptz not null
);
create table public.mobile_usage (
  user_id uuid references auth.users(id) on delete cascade,
  bucket text not null,
  period text not null,
  used integer not null default 0 check (used >= 0),
  primary key(user_id,bucket,period)
);
alter table public.mobile_access_grants enable row level security;
alter table public.mobile_subscriptions enable row level security;
alter table public.mobile_usage enable row level security;
revoke all on public.mobile_access_grants,public.mobile_subscriptions,public.mobile_usage from anon,authenticated;
grant all on public.mobile_access_grants,public.mobile_subscriptions,public.mobile_usage to service_role;

create function public.mobile_access_for(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public,pg_temp as $$
declare g public.mobile_access_grants; s public.mobile_subscriptions; n integer; lim integer;
begin
  select * into g from public.mobile_access_grants where user_id=p_user and (expires_at is null or expires_at>now());
  if found then
    return jsonb_build_object('active',true,'source',g.kind,'plan','city_all_access','expiresAt',g.expires_at,'routeLimit',null,'routesUsed',0);
  end if;
  select * into s from public.mobile_subscriptions where user_id=p_user;
  lim := case when s.plan='city_all_access' then 50 else 10 end;
  select used into n from public.mobile_usage where user_id=p_user and bucket='routes' and period=to_char(now() at time zone 'UTC','YYYY-MM');
  return jsonb_build_object('active',coalesce(s.plan is not null and s.expires_at>now(),false),
    'source','subscription','plan',s.plan,'expiresAt',s.expires_at,'store',s.store,
    'routeLimit',lim,'routesUsed',coalesce(n,0),'verifiedAt',s.verified_at);
end $$;
revoke all on function public.mobile_access_for(uuid) from public,anon,authenticated;
grant execute on function public.mobile_access_for(uuid) to service_role;

create function public.my_mobile_access() returns jsonb
language sql stable security definer set search_path = public,pg_temp as $$
  select public.mobile_access_for(auth.uid());
$$;
revoke all on function public.my_mobile_access() from public,anon;
grant execute on function public.my_mobile_access() to authenticated;

-- Atomic quotas: callers cannot choose the account, cap, or time period.
-- Founders/testers retain all features with no paid-plan route allowance.
-- All accounts still have a per-minute abuse/cost ceiling.
create function public.reserve_mobile_usage(p_user uuid,p_bucket text) returns boolean
language plpgsql security definer set search_path = public,pg_temp as $$
declare a jsonb; lim integer; period_key text; n integer;
begin
  a := public.mobile_access_for(p_user);
  if not (a->>'active')::boolean then return false; end if;
  if p_bucket='requests' then
    lim:=60; period_key:=to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI');
  elsif p_bucket in ('routes','concierge') then
    if a->>'source'<>'subscription' then return true; end if;
    lim:=case when a->>'plan'='city_all_access' then 50 else 10 end;
    if p_bucket='concierge' then lim:=lim*10; end if;
    period_key:=to_char(now() at time zone 'UTC','YYYY-MM');
  else raise exception 'Invalid usage bucket'; end if;
  insert into public.mobile_usage as u(user_id,bucket,period,used)
  values(p_user,p_bucket,period_key,1)
  on conflict(user_id,bucket,period) do update set used=u.used+1 where u.used<lim
  returning used into n;
  return n is not null;
end $$;
create function public.release_mobile_usage(p_user uuid,p_bucket text,p_period text) returns void
language sql security definer set search_path = public,pg_temp as $$
  update public.mobile_usage set used=greatest(0,used-1)
  where user_id=p_user and bucket=p_bucket and period=p_period and p_bucket in ('routes','concierge');
$$;
revoke all on function public.reserve_mobile_usage(uuid,text),public.release_mobile_usage(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_mobile_usage(uuid,text),public.release_mobile_usage(uuid,text,text) to service_role;

-- Ignore older verification responses arriving after newer ones.
create function public.sync_mobile_subscription(p_user uuid,p_plan text,p_expires timestamptz,p_store text,p_verified timestamptz) returns void
language sql security definer set search_path = public,pg_temp as $$
  insert into public.mobile_subscriptions as s(user_id,plan,expires_at,store,verified_at)
  values(p_user,p_plan,p_expires,p_store,p_verified)
  on conflict(user_id) do update set plan=excluded.plan,expires_at=excluded.expires_at,
    store=excluded.store,verified_at=excluded.verified_at where s.verified_at<excluded.verified_at;
$$;
revoke all on function public.sync_mobile_subscription(uuid,text,timestamptz,text,timestamptz) from public,anon,authenticated;
grant execute on function public.sync_mobile_subscription(uuid,text,timestamptz,text,timestamptz) to service_role;

create function public.reserve_mobile_sync(p_user uuid) returns boolean
language plpgsql security definer set search_path = public,pg_temp as $$
declare n integer;
begin
  insert into public.mobile_usage as u(user_id,bucket,period,used)
  values(p_user,'sync',to_char(now() at time zone 'UTC','YYYY-MM-DD HH24:MI'),1)
  on conflict(user_id,bucket,period) do update set used=u.used+1 where u.used<6
  returning used into n;
  return n is not null;
end $$;
revoke all on function public.reserve_mobile_sync(uuid) from public,anon,authenticated;
grant execute on function public.reserve_mobile_sync(uuid) to service_role;
commit;
