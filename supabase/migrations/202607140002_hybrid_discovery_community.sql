-- Hybrid Discovery Stage 4: authenticated community actions and moderation.
-- This migration intentionally stores only Echoo-owned activity. Provider
-- results are never accepted as action targets.

create table if not exists public.discovery_entity_reviews (
  id uuid primary key default gen_random_uuid(),
  location_entity_id uuid not null references public.location_entities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  moderation_status public.review_status not null default 'pending',
  moderation_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_entity_reviews_body_length check (char_length(trim(body)) between 20 and 1200),
  constraint discovery_entity_reviews_one_per_user unique (location_entity_id, user_id)
);

create table if not exists public.discovery_abuse_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_user_id uuid not null references auth.users(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  reason text not null,
  details text,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  constraint discovery_abuse_reports_target_check check (target_type in ('review', 'media')),
  constraint discovery_abuse_reports_reason_check check (reason in ('spam', 'harassment', 'hate', 'misinformation', 'rights', 'other')),
  constraint discovery_abuse_reports_status_check check (status in ('open', 'resolved', 'dismissed')),
  constraint discovery_abuse_reports_details_length check (details is null or char_length(trim(details)) <= 1000)
);

create table if not exists public.discovery_action_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  location_entity_id uuid references public.location_entities(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint discovery_action_events_action_check check (action in ('save', 'unsave', 'visit', 'rate', 'review', 'report'))
);

create index if not exists discovery_entity_reviews_entity_status_idx
  on public.discovery_entity_reviews (location_entity_id, moderation_status, created_at desc);
create index if not exists discovery_abuse_reports_open_idx
  on public.discovery_abuse_reports (status, created_at asc);
create index if not exists discovery_action_events_user_action_time_idx
  on public.discovery_action_events (user_id, action, created_at desc);

drop trigger if exists discovery_entity_reviews_touch_updated_at on public.discovery_entity_reviews;
create trigger discovery_entity_reviews_touch_updated_at
before update on public.discovery_entity_reviews
for each row execute function public.touch_updated_at();

alter table public.discovery_entity_reviews enable row level security;
alter table public.discovery_abuse_reports enable row level security;
alter table public.discovery_action_events enable row level security;

create policy "approved discovery reviews are readable"
on public.discovery_entity_reviews for select
using (moderation_status = 'approved' or user_id = auth.uid());
create policy "users read their own discovery reports"
on public.discovery_abuse_reports for select to authenticated
using (reporter_user_id = auth.uid());
-- All writes pass through the Edge Function after it verifies the caller and
-- enforces action-specific limits; no direct client write policies are added.

create or replace function public.refresh_discovery_hot_picks()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  with activity as (
    select
      le.id as location_entity_id,
      count(distinct r.id) filter (where r.created_at >= now() - interval '30 days')::integer as recent_rating_count,
      count(distinct v.id) filter (where v.verification_status = 'verified' and v.occurred_at >= now() - interval '30 days')::integer as recent_verified_visit_count,
      count(distinct s.user_id) filter (where s.created_at >= now() - interval '30 days')::integer as recent_save_count
    from public.location_entities le
    left join public.discovery_entity_ratings r on r.location_entity_id = le.id
    left join public.discovery_entity_visits v on v.location_entity_id = le.id
    left join public.discovery_entity_saves s on s.location_entity_id = le.id
    where le.status = 'published'
    group by le.id
  ), scored as (
    select *, round((recent_verified_visit_count * 3 + recent_save_count * 1.2 + recent_rating_count * 0.8)::numeric, 4) as hot_score
    from activity
  ), snapshots as (
    insert into public.discovery_entity_trend_snapshots (location_entity_id, snapshot_date, recent_rating_count, recent_verified_visit_count, recent_save_count, hot_score)
    select location_entity_id, current_date, recent_rating_count, recent_verified_visit_count, recent_save_count, hot_score
    from scored
    on conflict (location_entity_id, snapshot_date) do update set
      recent_rating_count = excluded.recent_rating_count,
      recent_verified_visit_count = excluded.recent_verified_visit_count,
      recent_save_count = excluded.recent_save_count,
      hot_score = excluded.hot_score
    returning location_entity_id, hot_score
  )
  insert into public.discovery_entity_stats (location_entity_id, hot_score, updated_at)
  select location_entity_id, hot_score, now()
  from snapshots
  on conflict (location_entity_id) do update set
    hot_score = excluded.hot_score,
    updated_at = excluded.updated_at;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.refresh_discovery_hot_picks() from public, anon, authenticated;

insert into public.ontario_worker_schedules (
  job_name,
  function_name,
  schedule_label,
  request_payload
)
values (
  'discovery_hot_pick_rollup',
  'ontario-maintenance',
  'daily 04:35 America/Toronto',
  '{"action":"hot_pick_rollup"}'::jsonb
)
on conflict (job_name) do update set
  function_name = excluded.function_name,
  schedule_label = excluded.schedule_label,
  request_payload = excluded.request_payload,
  is_active = true;
