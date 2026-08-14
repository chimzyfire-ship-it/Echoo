-- ──────────────────────────────────────────────
-- Echoo Waitlist Signups
-- Stores pre-launch email subscriptions
-- ──────────────────────────────────────────────

create table if not exists public.waitlist_signups (
  id          bigint generated always as identity primary key,
  email       text not null,
  source      text not null default 'waitlist_page',
  signed_up_at timestamptz not null default now(),

  constraint waitlist_signups_email_unique unique (email),
  constraint waitlist_signups_email_format
    check (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- Index for quick lookups and export
create index if not exists waitlist_signups_signed_up_at_idx
  on public.waitlist_signups (signed_up_at desc);

create index if not exists waitlist_signups_email_idx
  on public.waitlist_signups (email);

-- ── Row Level Security ──
alter table public.waitlist_signups enable row level security;

-- Allow anonymous inserts (no auth required for pre-launch signups)
drop policy if exists "anyone can join waitlist"
  on public.waitlist_signups;
create policy "anyone can join waitlist"
on public.waitlist_signups
for insert
with check (true);

-- Only authenticated service-role can read signups (for admin/export)
drop policy if exists "service role reads waitlist"
  on public.waitlist_signups;
create policy "service role reads waitlist"
on public.waitlist_signups
for select
using (auth.role() = 'service_role');
