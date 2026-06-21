-- Owner event operations and check-in audit trail.

create table if not exists public.ticket_checkin_logs (
  id uuid primary key default gen_random_uuid(),
  ticket_item_id uuid references public.ticket_items(id) on delete set null,
  event_id uuid references public.ticketed_events(id) on delete cascade,
  display_code text,
  status text not null check (status in ('valid', 'already_used', 'invalid', 'wrong_event')),
  checked_in_at timestamptz,
  operator_label text,
  created_at timestamptz not null default now()
);

create index if not exists ticket_checkin_logs_event_idx
  on public.ticket_checkin_logs (event_id, created_at desc);

create index if not exists ticket_items_display_code_idx
  on public.ticket_items (display_code);

alter table public.ticket_checkin_logs enable row level security;
