-- Notification consent is independent of planning memory and marketing consent.
create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  linkup boolean not null default false,
  plans boolean not null default false,
  invitations boolean not null default false,
  timezone text not null default 'America/Toronto',
  last_active_at timestamptz not null default now()
);
create table public.notification_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_key text not null,
  kind text not null check (kind in ('introduction','match','message','plan_ready')),
  title text not null,
  body text not null,
  path text not null check (path in ('/(tabs)/link-up','/planner')),
  match_id uuid references public.linkup_matches(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  status text not null default 'pending' check(status in ('pending','sending','accepted','handed_off','unknown','failed','cancelled')),
  sent_at timestamptz,
  device_token text,
  ticket_id text,
  unique(user_id,source_key)
);
create index notification_events_delivery on public.notification_events(status,created_at);
create index notification_events_owner on public.notification_events(user_id,created_at desc);
alter table public.notification_preferences enable row level security;
alter table public.notification_events enable row level security;
revoke all on public.notification_preferences,public.notification_events from anon,authenticated;
grant select on public.notification_preferences,public.notification_events to authenticated;
grant all on public.notification_preferences,public.notification_events to service_role;
create policy notification_preferences_owner on public.notification_preferences for select to authenticated using(user_id=(select auth.uid()));
create policy notification_events_owner on public.notification_events for select to authenticated using(user_id=(select auth.uid()));

create function public.set_notification_preferences(p_patch jsonb,p_timezone text default 'America/Toronto') returns void
language plpgsql security definer set search_path='' as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Sign in first'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object' or exists(select 1 from jsonb_each(p_patch) p where p.key not in ('linkup','plans','invitations') or jsonb_typeof(p.value)<>'boolean') then raise exception 'Invalid preferences'; end if;
  if not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid timezone'; end if;
  insert into public.notification_preferences(user_id) values(uid) on conflict do nothing;
  update public.notification_preferences set
    linkup=coalesce((p_patch->>'linkup')::boolean,linkup),
    plans=coalesce((p_patch->>'plans')::boolean,plans),
    invitations=coalesce((p_patch->>'invitations')::boolean,invitations),timezone=p_timezone
  where user_id=uid;
  -- Revocation cancels queued deliveries; enabling never replays old events.
  update public.notification_events set status='cancelled' where user_id=uid and status='pending'
    and ((p_patch ? 'linkup' and kind<>'plan_ready') or (p_patch ? 'plans' and kind='plan_ready'));
end $$;
create function public.notification_activity() returns void language plpgsql security definer set search_path='' as $$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  insert into public.notification_preferences(user_id) values(auth.uid()) on conflict(user_id) do update set last_active_at=now();
  -- A return to the app consumes earlier notifications, not a backlog of alerts.
  update public.notification_events set read_at=now(),status=case when status='pending' then 'cancelled' else status end where user_id=auth.uid() and read_at is null;
end $$;
create function public.read_notification(p_id uuid) returns void language sql security definer set search_path='' as $$
  update public.notification_events set read_at=coalesce(read_at,now()),status=case when status='pending' then 'cancelled' else status end where id=p_id and user_id=auth.uid();
$$;
revoke all on function public.set_notification_preferences(jsonb,text),public.notification_activity(),public.read_notification(uuid) from public,anon;
grant execute on function public.set_notification_preferences(jsonb,text),public.notification_activity(),public.read_notification(uuid) to authenticated;

create function public.enqueue_linkup_notice() returns trigger language plpgsql security definer set search_path='' as $$
declare mid uuid; recipient uuid; event_kind text; event_title text; event_body text; deadline timestamptz; source text;
begin
  if tg_table_name='linkup_match_members' then
    mid:=new.match_id; recipient:=new.user_id; event_kind:='introduction'; event_title:='Someone to meet?'; event_body:='A new Link Up introduction is waiting. Take a look while you’re both here.'; source:='intro:'||mid;
    select expires_at into deadline from public.linkup_matches where id=mid and status='pending';
  elsif tg_table_name='linkup_conversations' then
    mid:=new.match_id; event_kind:='match'; event_title:='It’s mutual'; event_body:='You both said yes. Your Link Up conversation is open.'; source:='match:'||mid; deadline:=least(new.expires_at,now()+interval '1 hour');
  else
    select match_id,expires_at into mid,deadline from public.linkup_conversations where id=new.conversation_id;
    deadline:=least(deadline,now()+interval '1 hour'); event_kind:='message'; event_title:='A new message'; event_body:='Someone in Link Up sent you a message. Open Echoo to read it.'; source:='message:'||new.id;
  end if;
  if deadline is null or deadline<=now() then return new; end if;
  insert into public.notification_events(user_id,source_key,kind,title,body,path,match_id,expires_at)
    select m.user_id,source,event_kind,event_title,event_body,'/(tabs)/link-up',mid,deadline from public.linkup_match_members m
    where m.match_id=mid and (recipient is null or m.user_id=recipient)
      and (tg_table_name<>'linkup_messages' or m.user_id<>(to_jsonb(new)->>'sender_id')::uuid)
    on conflict(user_id,source_key) do nothing;
  return new;
end $$;
create trigger notification_introduction after insert on public.linkup_match_members for each row execute function public.enqueue_linkup_notice();
create trigger notification_mutual_match after insert on public.linkup_conversations for each row execute function public.enqueue_linkup_notice();
create trigger notification_message after insert on public.linkup_messages for each row execute function public.enqueue_linkup_notice();

create function public.enqueue_ready_plan_notice() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.revision>old.revision and new.response->>'status' in ('plan_ready','plan_partial') then
    insert into public.notification_events(user_id,source_key,kind,title,body,path,expires_at)
    values(new.user_id,'plan:'||new.id||':'||new.revision,'plan_ready','Your plan is here','Take a look when you have a moment. There’s room to change your mind.','/planner',least(new.expires_at,now()+interval '30 minutes'))
    on conflict(user_id,source_key) do nothing;
  end if;
  return new;
end $$;
create trigger notification_plan_ready after update on public.planning_sessions for each row execute function public.enqueue_ready_plan_notice();

-- One worker can claim an event. A timed-out external send is never blindly retried.
create function public.claim_notification(p_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare event public.notification_events; prefs public.notification_preferences; device text; local_hour integer;
begin
  select * into event from public.notification_events where id=p_id for update;
  if event.id is null or event.status<>'pending' then return null; end if;
  select * into prefs from public.notification_preferences where user_id=event.user_id for update;
  if event.expires_at<=now() or event.read_at is not null or
    (case when event.kind='plan_ready' then prefs.plans else prefs.linkup end) is not true then
    update public.notification_events set status='cancelled' where id=p_id; return null;
  end if;
  if prefs.last_active_at>now()-interval '90 seconds' or event.created_at>now()-interval '10 seconds' then return null; end if;
  if event.kind='plan_ready' then
    local_hour:=extract(hour from now() at time zone prefs.timezone);
    if local_hour<9 or local_hour>=21 then
      update public.notification_events set status='cancelled' where id=p_id; return null;
    end if;
  else
    if not exists(select 1 from public.linkup_matches m where m.id=event.match_id and
      ((event.kind='introduction' and m.status='pending' and m.expires_at>now()) or
       (event.kind in ('match','message') and m.status='accepted' and exists(select 1 from public.linkup_conversations c where c.match_id=m.id and c.expires_at>now()))))
      or exists(select 1 from public.linkup_blocks b join public.linkup_match_members other on other.match_id=event.match_id
        where (b.user_a=event.user_id and b.user_b=other.user_id) or (b.user_b=event.user_id and b.user_a=other.user_id)) then
      update public.notification_events set status='cancelled' where id=p_id; return null;
    end if;
  end if;
  if exists(select 1 from public.notification_events e where e.user_id=event.user_id and e.id<>p_id and e.kind=event.kind
    and e.sent_at>now()-case when event.kind='plan_ready' then interval '5 minutes' else interval '1 minute' end
    and e.status in ('sending','accepted','handed_off','unknown')) then
    update public.notification_events set status='cancelled' where id=p_id; return null;
  end if;
  select token into device from public.planning_push_devices where user_id=event.user_id and updated_at>now()-interval '30 days' order by updated_at desc limit 1;
  if device is null then update public.notification_events set status='cancelled' where id=p_id; return null; end if;
  update public.notification_events set status='sending',sent_at=now(),device_token=device where id=p_id;
  return jsonb_build_object('id',event.id,'userId',event.user_id,'kind',event.kind,'title',event.title,'body',event.body,'path',event.path,'token',device,'expiresAt',event.expires_at);
end $$;
revoke all on function public.claim_notification(uuid),public.enqueue_linkup_notice(),public.enqueue_ready_plan_notice() from public,anon,authenticated;
grant execute on function public.claim_notification(uuid) to service_role;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.notification_events;
  end if;
end $$;
