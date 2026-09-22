create table public.planning_push_devices (
  token text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now(),
  check(length(token) between 20 and 200)
);
create index planning_push_devices_owner on public.planning_push_devices(user_id,updated_at desc);
create table public.planning_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign text not null,
  kind text not null check(kind in ('weekend','culture')),
  status text not null default 'reserved' check(status in ('reserved','accepted','unknown','failed','handed_off','cancelled')),
  ticket_id text,
  device_token text,
  opened_at timestamptz,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id,campaign)
);
create index planning_outbox_recent on public.planning_notification_outbox(user_id,created_at desc);
alter table public.planning_push_devices enable row level security;
alter table public.planning_notification_outbox enable row level security;
revoke all on public.planning_push_devices, public.planning_notification_outbox from anon,authenticated;
grant all on public.planning_push_devices, public.planning_notification_outbox to service_role;

create function public.register_planning_device(p_token text) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' then raise exception 'Invalid push token'; end if;
  insert into public.planning_push_devices(token,user_id) values(p_token,auth.uid()) on conflict(token) do update set user_id=auth.uid(),updated_at=now();
end;
$$;
create function public.unregister_planning_device(p_token text) returns void language sql security definer set search_path = '' as $$
  delete from public.planning_push_devices where token=p_token and user_id=auth.uid();
$$;
revoke all on function public.register_planning_device(text),public.unregister_planning_device(text) from public,anon;
grant execute on function public.register_planning_device(text),public.unregister_planning_device(text) to authenticated;

-- Server role only. The preferences row serializes ALL campaign types.
-- Reserved and unknown sends consume capacity too, preventing retry races.
create function public.reserve_planning_notification(p_user_id uuid,p_campaign text,p_kind text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare prefs public.planning_preferences; device text; notification_id uuid; local_hour integer;
begin
  select * into prefs from public.planning_preferences where user_id=p_user_id for update;
  if prefs.push_enabled is not true or p_kind not in ('weekend','culture') then return null; end if;
  local_hour := extract(hour from now() at time zone prefs.timezone);
  if local_hour < 16 or local_hour >= 20 then return null; end if;
  if p_kind='weekend' and (extract(dow from now() at time zone prefs.timezone)<>5 or local_hour<>16) then return null; end if;
  if (select count(*) from public.planning_notification_outbox where user_id=p_user_id and created_at>now()-interval '7 days' and status not in ('failed','cancelled'))>=3 then return null; end if;
  if exists(select 1 from public.planning_notification_outbox where user_id=p_user_id and kind=p_kind and created_at>now()-case when p_kind='culture' then interval '14 days' else interval '6 days' end and status not in ('failed','cancelled')) then return null; end if;
  select token into device from public.planning_push_devices where user_id=p_user_id order by updated_at desc limit 1;
  if device is null then return null; end if;
  insert into public.planning_notification_outbox(user_id,campaign,kind,payload,device_token) values(p_user_id,left(p_campaign,160),p_kind,p_payload,device)
  on conflict(user_id,campaign) do nothing returning id into notification_id;
  if notification_id is null then return null; end if;
  return jsonb_build_object('id',notification_id,'token',device);
end;
$$;
revoke all on function public.reserve_planning_notification(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_planning_notification(uuid,text,text,jsonb) to service_role;

-- Candidate content comes from published entities and approved culture tags.
create function public.planning_notification_candidates(p_user_id uuid,p_kind text)
returns table(id uuid,title text,city text,place_id uuid,created_at timestamptz) language sql security definer set search_path = '' as $$
  select le.id,le.title,le.city,le.place_id,le.created_at
  from public.location_entities le join public.planning_preferences prefs on prefs.user_id=p_user_id
  where prefs.push_enabled and le.status='published' and le.country_code='CA' and le.admin_area_1='ON' and le.city=prefs.home_city
  and ((p_kind='weekend' and le.entity_type='event' and le.starts_at>now() and le.starts_at<now()+interval '3 days')
    or (p_kind='culture' and le.entity_type='place' and le.place_id is not null and le.created_at>now()-interval '14 days' and exists(
      select 1 from public.culture_entity_tags tag join public.culture_catalog c on c.id=tag.culture_id
      where tag.location_entity_id=le.id and tag.review_status='approved' and c.slug=any(prefs.culture_slugs)
    )))
  order by le.starts_at asc nulls last,le.created_at desc limit 3;
$$;
revoke all on function public.planning_notification_candidates(uuid,text) from public,anon,authenticated;
grant execute on function public.planning_notification_candidates(uuid,text) to service_role;

-- A tap is explicit engagement; a provider receipt is only delivery handoff.
create function public.record_planning_notification_open(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.planning_notification_outbox set opened_at=now()
  where id=p_id and user_id=auth.uid() and opened_at is null;
  if found then
    insert into public.planning_metrics(user_id,kind) values(auth.uid(),'push_open');
  end if;
end;
$$;
revoke all on function public.record_planning_notification_open(uuid) from public,anon;
grant execute on function public.record_planning_notification_open(uuid) to authenticated;
