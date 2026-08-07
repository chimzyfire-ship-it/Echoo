-- Link Up · safety layer
--
-- Mirrors the discovery community safety pattern (see migration
-- 202607140002_hybrid_discovery_community.sql): a report table with a status
-- workflow, and an action-events ledger used for server-side rate limiting.
-- Adds a symmetric block table: one tap blocks for matching purposes for both
-- members, stored once via least()/greatest().
--
-- As with discovery reports, these tables have NO direct client write
-- policies. All writes go through service-role Edge Functions that verify the
-- caller and enforce per-action limits.

-- ──────────────────────────────────────────────────────────────────────────
-- Blocks: symmetric, deduped. Either member can block the other; the block
-- applies to matching for both and immediately ends any active match.
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.linkup_blocks (
  user_a uuid not null references auth.users(id) on delete cascade,
  user_b uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  constraint linkup_blocks_distinct check (user_a <> user_b)
);

create index if not exists linkup_blocks_user_idx
  on public.linkup_blocks (user_a, created_at desc);

-- ──────────────────────────────────────────────────────────────────────────
-- Reports: same shape/constraints as discovery_abuse_reports.
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.linkup_reports (
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
  constraint linkup_reports_target_check check (target_type in ('match', 'message', 'user')),
  constraint linkup_reports_reason_check
    check (reason in ('spam', 'harassment', 'hate', 'misinformation', 'rights', 'other')),
  constraint linkup_reports_status_check check (status in ('open', 'resolved', 'dismissed')),
  constraint linkup_reports_details_length
    check (details is null or char_length(trim(details)) <= 1000)
);

create index if not exists linkup_reports_open_idx
  on public.linkup_reports (status, created_at asc);

create index if not exists linkup_reports_reporter_idx
  on public.linkup_reports (reporter_user_id, created_at desc);

-- ──────────────────────────────────────────────────────────────────────────
-- Action events: the rate-limit ledger. Counted via a sliding window in the
-- Edge Functions (mirrors discovery_action_events + ACTION_LIMITS).
-- ──────────────────────────────────────────────────────────────────────────
create table if not exists public.linkup_action_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  target_id uuid,
  created_at timestamptz not null default now(),
  constraint linkup_action_events_action_check check (
    action in ('checkin', 'checkout', 'match_accept', 'match_decline', 'message', 'report', 'block', 'end')
  )
);

create index if not exists linkup_action_events_user_action_time_idx
  on public.linkup_action_events (user_id, action, created_at desc);

comment on table public.linkup_blocks is
  'Symmetric Link Up blocks. Stored once via least()/greatest(); blocks matching for both members.';
comment on table public.linkup_reports is
  'Link Up abuse reports. Same workflow as discovery_abuse_reports. Writes via Edge Function only.';
comment on table public.linkup_action_events is
  'Link Up action ledger used for server-side rate limiting (sliding window).';
