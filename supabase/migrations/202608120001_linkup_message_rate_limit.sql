-- Link Up · enforce per-sender message rate limit at the DB
--
-- Background: linkup_messages is the ONE Link Up table that clients write
-- directly (RLS policy "members send linkup messages", migration 202608070005)
-- for low-latency chat. That means the TS rate-limit helpers
-- (checkRateLimit / recordAction for "message" in _shared/linkup.ts) never run
-- on the send path — nothing records or checks a "message" action. So the
-- documented cap of 30 messages / 10 minutes (ACTION_LIMITS.message) was a
-- dead control and an unchecked spam vector on a stranger-meeting product.
--
-- Fix: enforce the cap with a BEFORE INSERT trigger that counts the sender's
-- recent rows directly. This keeps the low-latency client-insert path and puts
-- enforcement exactly where the write happens (mirroring the existing
-- linkup_match_member_count trigger pattern). The 30 / 10-minute figures are
-- duplicated here deliberately — Postgres can't read the TS constant — so keep
-- them in sync with ACTION_LIMITS.message in supabase/functions/_shared/linkup.ts.

create or replace function public.linkup_enforce_message_rate_limit()
returns trigger
language plpgsql
as $$
declare
  recent_count int;
begin
  -- Count this sender's messages inside the rolling 10-minute window. Backed by
  -- linkup_messages_sender_time_idx (sender_id, created_at desc). A BEFORE
  -- INSERT trigger runs before NEW is written, so this is the count of prior
  -- rows — blocking when the in-flight row would exceed the cap.
  select count(*) into recent_count
  from public.linkup_messages
  where sender_id = new.sender_id
    and created_at >= now() - interval '10 minutes';

  -- max is exclusive (mirrors checkRateLimit: count < max ⇒ allowed). With 30
  -- prior messages in the window, the 31st is rejected.
  if recent_count >= 30 then
    raise exception 'Link Up rate limit: 30 messages per 10 minutes'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists linkup_messages_rate_limit on public.linkup_messages;
create trigger linkup_messages_rate_limit
  before insert on public.linkup_messages
  for each row execute function public.linkup_enforce_message_rate_limit();

comment on function public.linkup_enforce_message_rate_limit() is
  'Enforces the 30 messages / 10 minutes per-sender cap on Link Up chat. Mirrors ACTION_LIMITS.message in _shared/linkup.ts — keep in sync.';
