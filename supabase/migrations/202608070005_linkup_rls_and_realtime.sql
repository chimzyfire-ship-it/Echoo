-- Link Up · row level security + realtime publication
--
-- Policy model (mirrors the discovery community pattern):
--   • All tables are owner-read (members read their own rows).
--   • Presence, matches, blocks, reports, action events have NO direct client
--     write policies — every write goes through a service-role Edge Function
--     that verifies the caller and enforces rate limits / safety rules.
--   • The ONE exception is linkup_messages: chat inserts happen client-side
--     for low latency, gated by (sender_id = auth.uid()) AND a security definer
--     membership check. Non-members cannot read or write.
--
-- Realtime: linkup_matches and linkup_messages are added to the realtime
-- publication so clients can subscribe to postgres_changes (match proposals,
-- new messages).

-- ════════════════════════════════════════════════════════════════════════
-- Helper: conversation membership (security definer so it can read rows the
-- calling user might not otherwise be able to select).
-- ════════════════════════════════════════════════════════════════════════
create or replace function public.user_is_linkup_conversation_member(
  conv_id uuid,
  member uuid default auth.uid()
)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.linkup_conversations c
    join public.linkup_match_members m on m.match_id = c.match_id
    where c.id = user_is_linkup_conversation_member.conv_id
      and m.user_id = user_is_linkup_conversation_member.member
  );
$$;

-- ════════════════════════════════════════════════════════════════════════
-- Enable RLS on every Link Up table.
-- ════════════════════════════════════════════════════════════════════════
alter table public.linkup_presence enable row level security;
alter table public.linkup_matches enable row level security;
alter table public.linkup_match_members enable row level security;
alter table public.linkup_conversations enable row level security;
alter table public.linkup_messages enable row level security;
alter table public.linkup_blocks enable row level security;
alter table public.linkup_reports enable row level security;
alter table public.linkup_action_events enable row level security;

-- ════════════════════════════════════════════════════════════════════════
-- linkup_presence — owner read only; writes via Edge Function.
-- ════════════════════════════════════════════════════════════════════════
drop policy if exists "users read own linkup presence" on public.linkup_presence;
create policy "users read own linkup presence"
  on public.linkup_presence for select
  using (user_id = (select auth.uid()));

-- ════════════════════════════════════════════════════════════════════════
-- linkup_matches — readable by match members only.
-- ════════════════════════════════════════════════════════════════════════
drop policy if exists "members read own linkup matches" on public.linkup_matches;
create policy "members read own linkup matches"
  on public.linkup_matches for select
  using (
    exists (
      select 1 from public.linkup_match_members m
      where m.match_id = linkup_matches.id and m.user_id = (select auth.uid())
    )
  );

-- ════════════════════════════════════════════════════════════════════════
-- linkup_match_members — a member can read the membership row of any match
-- they belong to (so they can see who the other person is once matched).
-- ════════════════════════════════════════════════════════════════════════
drop policy if exists "members read own linkup match members" on public.linkup_match_members;
create policy "members read own linkup match members"
  on public.linkup_match_members for select
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.linkup_match_members sibling
      where sibling.match_id = linkup_match_members.match_id
        and sibling.user_id = (select auth.uid())
    )
  );

-- ════════════════════════════════════════════════════════════════════════
-- linkup_conversations — members read; created by Edge Function.
-- ════════════════════════════════════════════════════════════════════════
drop policy if exists "members read own linkup conversations" on public.linkup_conversations;
create policy "members read own linkup conversations"
  on public.linkup_conversations for select
  using (public.user_is_linkup_conversation_member(id));

-- ════════════════════════════════════════════════════════════════════════
-- linkup_messages — members read; the SENDER may insert (low-latency chat).
-- No update/delete: messages are immutable for audit integrity.
-- ════════════════════════════════════════════════════════════════════════
drop policy if exists "members read linkup messages" on public.linkup_messages;
create policy "members read linkup messages"
  on public.linkup_messages for select
  using (public.user_is_linkup_conversation_member(conversation_id));

drop policy if exists "members send linkup messages" on public.linkup_messages;
create policy "members send linkup messages"
  on public.linkup_messages for insert
  with check (
    sender_id = (select auth.uid())
    and public.user_is_linkup_conversation_member(conversation_id)
  );

-- ════════════════════════════════════════════════════════════════════════
-- linkup_blocks — a user can see who they have blocked. Writes via EF.
-- ════════════════════════════════════════════════════════════════════════
drop policy if exists "users read own linkup blocks" on public.linkup_blocks;
create policy "users read own linkup blocks"
  on public.linkup_blocks for select
  using (user_a = (select auth.uid()) or user_b = (select auth.uid()));

-- ════════════════════════════════════════════════════════════════════════
-- linkup_reports — reporter can read their own. Writes via EF.
-- ════════════════════════════════════════════════════════════════════════
drop policy if exists "users read own linkup reports" on public.linkup_reports;
create policy "users read own linkup reports"
  on public.linkup_reports for select to authenticated
  using (reporter_user_id = (select auth.uid()));

-- ════════════════════════════════════════════════════════════════════════
-- linkup_action_events — owner read only (transparency over rate limiting).
-- ════════════════════════════════════════════════════════════════════════
drop policy if exists "users read own linkup action events" on public.linkup_action_events;
create policy "users read own linkup action events"
  on public.linkup_action_events for select
  using (user_id = (select auth.uid()));

-- ════════════════════════════════════════════════════════════════════════
-- Realtime: full replica identity so payloads carry all columns, and add the
-- tables to the realtime publication so clients can postgres_changes subscribe.
-- ════════════════════════════════════════════════════════════════════════
alter table public.linkup_matches replica identity full;
alter table public.linkup_match_members replica identity full;
alter table public.linkup_messages replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'linkup_matches'
  ) then
    alter publication supabase_realtime add table public.linkup_matches;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'linkup_match_members'
  ) then
    alter publication supabase_realtime add table public.linkup_match_members;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'linkup_messages'
  ) then
    alter publication supabase_realtime add table public.linkup_messages;
  end if;
end $$;
