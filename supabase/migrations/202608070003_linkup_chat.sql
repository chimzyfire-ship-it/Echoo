-- Link Up · ephemeral in-app chat
--
-- A conversation is opened only when both members accept a match. It is tied
-- 1:1 to that match and inherits its lifecycle: when the match ends the
-- conversation gets a grace window (default +24h) then is no longer writable.
--
-- Messages are short (1–1000 chars), text only, in-app only. No media, no
-- link previews, no external sharing — by design, to keep the safety surface
-- small for a stranger-meeting product.

create table if not exists public.linkup_conversations (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.linkup_matches(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint linkup_conversations_expires_after_create check (expires_at >= created_at)
);

create unique index if not exists linkup_conversations_match_unique_idx
  on public.linkup_conversations (match_id);

create table if not exists public.linkup_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.linkup_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(trim(body)) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- Chat history pagination (most recent first, then reverse client-side).
create index if not exists linkup_messages_conv_time_idx
  on public.linkup_messages (conversation_id, created_at desc);

-- Audit path: who sent what.
create index if not exists linkup_messages_sender_time_idx
  on public.linkup_messages (sender_id, created_at desc);

comment on table public.linkup_conversations is
  'Ephemeral Link Up chat. One per accepted match. Inherits match lifecycle.';
comment on table public.linkup_messages is
  'Text-only Link Up messages. 1–1000 chars. In-app only; no media or link previews.';
