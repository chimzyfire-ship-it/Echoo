-- One identity and venue namespace: auth.users + canonical_places.
-- Temporary session context is separate from opt-in durable personalization.
create table public.planning_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  memory_enabled boolean not null default false,
  push_enabled boolean not null default false,
  home_city text,
  timezone text not null default 'America/Toronto',
  culture_slugs text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (cardinality(culture_slugs) <= 8)
);
create table public.planning_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  revision integer not null default 0,
  state jsonb not null default '{}',
  response jsonb,
  request_id uuid,
  processing_until timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours',
  updated_at timestamptz not null default now()
);
create index planning_sessions_owner on public.planning_sessions(user_id, expires_at);
create table public.planning_saved_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  plan jsonb not null,
  created_at timestamptz not null default now(),
  saved_at timestamptz,
  unique(user_id, request_id),
  check (jsonb_typeof(plan->'stops') = 'array' and jsonb_array_length(plan->'stops') between 1 and 3)
);
create index planning_saved_plans_recent on public.planning_saved_plans(user_id, created_at desc);
create table public.planning_feedback (
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.planning_saved_plans(id) on delete cascade,
  place_id uuid not null references public.canonical_places(id) on delete cascade,
  action text not null check(action in ('shown','saved','liked','disliked','directions')),
  created_at timestamptz not null default now(),
  primary key(user_id, plan_id, place_id, action)
);
create index planning_feedback_recent on public.planning_feedback(user_id, created_at desc);
create table public.planning_metrics (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  kind text not null check (kind in ('plan_ready','plan_partial','no_match','clarification','service_error','feedback','push_open')),
  duration_ms integer,
  properties jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index planning_metrics_time on public.planning_metrics(created_at, kind);

alter table public.planning_preferences enable row level security;
alter table public.planning_sessions enable row level security;
alter table public.planning_saved_plans enable row level security;
alter table public.planning_feedback enable row level security;
alter table public.planning_metrics enable row level security;
revoke all on public.planning_preferences, public.planning_sessions, public.planning_saved_plans, public.planning_feedback, public.planning_metrics from anon, authenticated;
grant select on public.planning_preferences, public.planning_saved_plans, public.planning_feedback to authenticated;
grant all on public.planning_preferences, public.planning_sessions, public.planning_saved_plans, public.planning_feedback, public.planning_metrics to service_role;
grant usage, select on sequence public.planning_metrics_id_seq to service_role;
create policy planning_preferences_read on public.planning_preferences for select to authenticated using(user_id = (select auth.uid()));
create policy planning_plans_read on public.planning_saved_plans for select to authenticated using(user_id = (select auth.uid()));
create policy planning_feedback_read on public.planning_feedback for select to authenticated using(user_id = (select auth.uid()));

create function public.set_planning_preferences(p_memory boolean, p_push boolean default false, p_city text default null, p_timezone text default 'America/Toronto', p_cultures text[] default '{}')
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in to change preferences'; end if;
  if not exists(select 1 from pg_timezone_names where name = p_timezone) then raise exception 'Invalid timezone'; end if;
  if cardinality(p_cultures) > 8 or exists(select 1 from unnest(p_cultures) as chosen(slug) where not exists(select 1 from public.culture_catalog c where c.slug = chosen.slug and c.is_active)) then raise exception 'Invalid culture'; end if;
  insert into public.planning_preferences(user_id, memory_enabled, push_enabled, home_city, timezone, culture_slugs)
  values(uid, p_memory, p_push, left(p_city,100), p_timezone, coalesce(p_cultures,'{}'))
  on conflict(user_id) do update set memory_enabled = p_memory, push_enabled = p_push, home_city = left(p_city,100), timezone = p_timezone, culture_slugs = coalesce(p_cultures,'{}'), updated_at = now();
end;
$$;

create table public.planning_rate_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(), requests integer not null default 0
);
alter table public.planning_rate_limits enable row level security;
revoke all on public.planning_rate_limits from anon,authenticated;
grant all on public.planning_rate_limits to service_role;

-- Reserve a turn transactionally. Concurrent edits cannot overwrite a plan.
create function public.begin_planning_turn(p_session_id uuid, p_revision integer, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); s public.planning_sessions; requests_used integer;
begin
  if uid is null or p_request_id is null then raise exception 'Sign in to plan'; end if;
  if p_session_id is null then
    -- A request ID is also the first session ID, making initial retries safe.
    insert into public.planning_sessions(id,user_id) values(p_request_id,uid) on conflict(id) do nothing;
    p_session_id := p_request_id;
  end if;
  select * into s from public.planning_sessions where id = p_session_id and user_id = uid and expires_at > now() for update;
  if s.id is null then raise exception 'SESSION_EXPIRED'; end if;
  if s.request_id = p_request_id and s.processing_until is null and s.response is not null then return jsonb_build_object('cached',s.response); end if;
  if s.processing_until > now() then raise exception 'TURN_BUSY'; end if;
  if s.revision <> p_revision then raise exception 'REVISION_CONFLICT'; end if;
  insert into public.planning_rate_limits(user_id,requests) values(uid,1)
  on conflict(user_id) do update set requests=case when planning_rate_limits.window_start<now()-interval '1 hour' then 1 else planning_rate_limits.requests+1 end,
    window_start=case when planning_rate_limits.window_start<now()-interval '1 hour' then now() else planning_rate_limits.window_start end
  returning requests into requests_used;
  if requests_used>60 then raise exception 'Planning limit reached. Try again later.'; end if;
  if (select count(*) from public.planning_sessions where user_id = uid and updated_at > now() - interval '1 hour') > 30 then raise exception 'Too many planning sessions. Try later.'; end if;
  update public.planning_sessions set request_id=p_request_id, processing_until=now()+interval '90 seconds', updated_at=now() where id=s.id;
  return jsonb_build_object('sessionId',s.id,'revision',s.revision,'state',s.state);
end;
$$;

create function public.finish_planning_turn(p_user_id uuid, p_session_id uuid, p_request_id uuid, p_state jsonb, p_response jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.planning_sessions set state=p_state, response=p_response, revision=revision+1, processing_until=null, updated_at=now(), expires_at=now()+interval '24 hours'
  where id=p_session_id and user_id=p_user_id and request_id=p_request_id and processing_until is not null;
  return found;
end;
$$;

-- Only the planning service may persist generated facts. Consent is rechecked
-- under a lock, so a late response cannot write history after revocation.
create function public.store_planning_result(p_user_id uuid, p_request_id uuid, p_plan jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare enabled boolean; result_id uuid;
begin
  select memory_enabled into enabled from public.planning_preferences where user_id=p_user_id for update;
  if enabled is not true then return null; end if;
  if jsonb_typeof(p_plan->'stops') <> 'array' or jsonb_array_length(p_plan->'stops') not between 1 and 3 then raise exception 'Invalid plan'; end if;
  if exists(select 1 from jsonb_array_elements(p_plan->'stops') stop where not exists(select 1 from public.canonical_places c where c.id::text=stop->>'id' and c.location_status='published')) then raise exception 'Unknown venue'; end if;
  insert into public.planning_saved_plans(user_id,request_id,plan) values(p_user_id,p_request_id,p_plan)
  on conflict(user_id,request_id) do update set request_id=excluded.request_id returning id into result_id;
  return result_id;
end;
$$;

create function public.record_planning_feedback(p_plan_id uuid, p_place_id uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); enabled boolean; snapshot jsonb; inserted_count integer;
begin
  select memory_enabled into enabled from public.planning_preferences where user_id=uid for update;
  if uid is null or enabled is not true then raise exception 'Enable planning memory to save feedback'; end if;
  select plan into snapshot from public.planning_saved_plans where id=p_plan_id and user_id=uid;
  if snapshot is null or not exists(select 1 from jsonb_array_elements(snapshot->'stops') stop where stop->>'id'=p_place_id::text) then raise exception 'Place does not belong to this plan'; end if;
  if p_action not in ('shown','saved','liked','disliked','directions') then raise exception 'Invalid feedback'; end if;
  if p_action='disliked' and (select count(*) from public.planning_feedback where user_id=uid and action='disliked' and place_id<>p_place_id) >= 500 then raise exception 'Manage your hidden places before adding more'; end if;
  -- A later explicit opinion replaces an older opposite opinion across plans.
  if p_action in ('liked','disliked') then delete from public.planning_feedback where user_id=uid and place_id=p_place_id and action in ('liked','disliked') and (action<>p_action or plan_id<>p_plan_id); end if;
  insert into public.planning_feedback(user_id,plan_id,place_id,action) values(uid,p_plan_id,p_place_id,p_action) on conflict do nothing;
  get diagnostics inserted_count = row_count;
  if inserted_count = 0 then return; end if;
  if p_action='saved' then update public.planning_saved_plans set saved_at=now() where id=p_plan_id and user_id=uid; end if;
  insert into public.planning_metrics(user_id,kind,properties) values(uid,'feedback',jsonb_build_object('action',p_action));
end;
$$;

create function public.remove_planning_feedback(p_place_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.planning_feedback where user_id=auth.uid() and place_id=p_place_id and action='disliked';
$$;
create function public.delete_planning_history()
returns void language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first'; end if;
  perform 1 from public.planning_preferences where user_id=uid for update;
  update public.planning_preferences set memory_enabled=false,updated_at=now() where user_id=uid;
  delete from public.planning_saved_plans where user_id=uid;
  delete from public.planning_sessions where user_id=uid;
  delete from public.planning_metrics where user_id=uid;
  -- Include the earlier companion implementation's personal history.
  delete from public.companion_sessions where user_id=uid;
  delete from public.companion_memories where user_id=uid;
  delete from public.companion_safety_constraints where user_id=uid;
end;
$$;

revoke all on function public.set_planning_preferences(boolean,boolean,text,text,text[]), public.begin_planning_turn(uuid,integer,uuid), public.record_planning_feedback(uuid,uuid,text), public.remove_planning_feedback(uuid), public.delete_planning_history() from public, anon;
grant execute on function public.set_planning_preferences(boolean,boolean,text,text,text[]), public.begin_planning_turn(uuid,integer,uuid), public.record_planning_feedback(uuid,uuid,text), public.remove_planning_feedback(uuid), public.delete_planning_history() to authenticated;
revoke all on function public.finish_planning_turn(uuid,uuid,uuid,jsonb,jsonb), public.store_planning_result(uuid,uuid,jsonb) from public, anon, authenticated;
grant execute on function public.finish_planning_turn(uuid,uuid,uuid,jsonb,jsonb), public.store_planning_result(uuid,uuid,jsonb) to service_role;

-- Invoke from the server scheduler. Expired session data is physically removed.
create function public.cleanup_planning_data() returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from public.planning_sessions where expires_at < now();
  delete from public.planning_feedback where action in ('shown','directions') and created_at < now()-interval '30 days';
  delete from public.planning_saved_plans p where p.saved_at is null and p.created_at < now()-interval '180 days' and not exists(select 1 from public.planning_feedback f where f.plan_id=p.id and f.action in ('liked','disliked'));
  delete from public.planning_metrics where created_at < now()-interval '90 days';
end;
$$;
revoke all on function public.cleanup_planning_data() from public, anon, authenticated;
grant execute on function public.cleanup_planning_data() to service_role;
