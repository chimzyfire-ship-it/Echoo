-- Link Up · background expiry sweep (pg_cron)
--
-- Background: a pending match has a ~10-minute fuse (expires_at = created_at +
-- MATCH_FUSE_MINUTES). Its status only flipped to 'expired' LAZILY, inside
-- linkup-match's respond handler, when a user happened to act on it after the
-- fuse. Matches nobody touched stayed status='pending' forever.
--
-- That broke re-matching: recentlyMatched() suppresses proposals while a pair
-- has any match with status IN ('pending','accepted'). So a stale-but-untouched
-- 'pending' match silently blocked a natural re-encounter for the whole 24h
-- suppression window — long after its 10-minute fuse burned out.
--
-- Fix: a tiny sweep function that transitions elapsed pending matches to
-- 'expired', and relabels TTL-elapsed presences to 'ended' (heap hygiene — the
-- match query already filters by expires_at, this just keeps the active set
-- honest). Scheduled on pg_cron every 2 minutes.
--
-- Intentionally NOT cascading: sweeping a presence to 'ended' does not end any
-- accepted match. Accepted matches end only on explicit member action (checkout
-- or tap-end), which preserves the generous "chat lives +24h grace" lifecycle.

create or replace function public.linkup_sweep()
returns jsonb
language plpgsql
as $$
declare
  matches_expired bigint := 0;
  presences_ended bigint := 0;
begin
  -- Pending matches past their fuse.
  update public.linkup_matches
    set status = 'expired'
    where status = 'pending'
      and expires_at < now();
  get diagnostics matches_expired = row_count;

  -- Presences past their TTL. Status-only relabel; no coordinate data exists
  -- on this table (privacy by design — place_id only).
  update public.linkup_presence
    set status = 'ended'
    where status = 'active'
      and expires_at < now();
  get diagnostics presences_ended = row_count;

  return jsonb_build_object(
    'matches_expired', matches_expired,
    'presences_ended', presences_ended,
    'swept_at', now()
  );
end;
$$;

comment on function public.linkup_sweep() is
  'Idempotent Link Up expiry sweep: elapsed pending matches -> expired, TTL-elapsed presences -> ended. Scheduled via pg_cron.';

-- ─────────────────────────────────────────────────────────────────────────
-- Schedule via pg_cron. pg_cron is bundled and preloaded (shared_preload_
-- libraries) on both the Supabase local CLI image and Supabase Cloud, so a
-- plain CREATE EXTENSION is all that's required. Its control file is
-- non-relocatable (relocatable = false), which is why the `WITH SCHEMA`
-- clause must be omitted — pg_cron always installs its objects into the
-- `cron` schema that it creates itself, and that's what makes cron.schedule
-- / cron.job / cron.unschedule resolve unqualified below. (Note:
-- api.extra_search_path in config.toml is PostgREST's search_path and is
-- unrelated to this.) Every 2 minutes is well inside the 10-minute fuse, so
-- no pending match ever lingers past its window by more than a fuse-fraction.
-- ─────────────────────────────────────────────────────────────────────────
create extension if not exists pg_cron;

-- Idempotent (re)register: unschedule any prior run with this jobname, then
-- schedule fresh. Safe to re-run on db reset / redeploy.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'linkup-sweep') then
    perform cron.unschedule('linkup-sweep');
  end if;
end
$$;

select cron.schedule(
  'linkup-sweep',
  '*/2 * * * *',
  $$select public.linkup_sweep();$$
);
