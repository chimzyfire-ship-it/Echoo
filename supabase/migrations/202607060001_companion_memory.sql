create table if not exists public.companion_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  session_key text not null,
  city_anchor text not null default 'Ontario',
  city_confidence text not null default 'unknown',
  current_intent text not null default 'companion',
  current_strategy text not null default 'model_companion',
  current_mood text not null default 'open',
  current_constraints jsonb not null default '{}',
  last_visible_cards jsonb not null default '[]',
  memory_summary text not null default '',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companion_sessions_city_confidence_check
    check (
      city_confidence in (
        'query',
        'previous',
        'profile',
        'chosen',
        'province',
        'unknown'
      )
    )
);

create unique index if not exists companion_sessions_user_session_key_uidx
  on public.companion_sessions (user_id, session_key)
  where user_id is not null;

create unique index if not exists companion_sessions_anon_session_key_uidx
  on public.companion_sessions (session_key)
  where user_id is null;

create index if not exists companion_sessions_user_updated_idx
  on public.companion_sessions (user_id, updated_at desc);

drop trigger if exists companion_sessions_touch_updated_at
  on public.companion_sessions;
create trigger companion_sessions_touch_updated_at
before update on public.companion_sessions
for each row execute function public.touch_updated_at();

create table if not exists public.companion_turns (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.companion_sessions(id)
    on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  query text not null,
  normalized_state jsonb not null default '{}',
  tool_decision text not null default 'converse',
  safety_flags text[] not null default '{}',
  response_summary text not null default '',
  visible_card_ids text[] not null default '{}',
  visible_cards jsonb not null default '[]',
  private_trace jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists companion_turns_session_created_idx
  on public.companion_turns (session_id, created_at desc);

create index if not exists companion_turns_user_created_idx
  on public.companion_turns (user_id, created_at desc)
  where user_id is not null;

create index if not exists companion_turns_state_gin
  on public.companion_turns using gin (normalized_state);

create table if not exists public.companion_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  memory_type text not null,
  memory_key text not null,
  memory_value jsonb not null default '{}',
  confidence_score numeric not null default 1,
  source_turn_id uuid references public.companion_turns(id) on delete set null,
  last_used_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companion_memories_type_check
    check (
      memory_type in (
        'preference',
        'rejection',
        'cultural_identity',
        'relationship',
        'pattern',
        'safety',
        'summary'
      )
    ),
  constraint companion_memories_confidence_check
    check (confidence_score >= 0 and confidence_score <= 1)
);

create unique index if not exists companion_memories_user_key_uidx
  on public.companion_memories (user_id, memory_type, memory_key);

create index if not exists companion_memories_user_type_idx
  on public.companion_memories (user_id, memory_type, updated_at desc);

create index if not exists companion_memories_value_gin
  on public.companion_memories using gin (memory_value);

drop trigger if exists companion_memories_touch_updated_at
  on public.companion_memories;
create trigger companion_memories_touch_updated_at
before update on public.companion_memories
for each row execute function public.touch_updated_at();

create table if not exists public.companion_safety_constraints (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  constraint_type text not null,
  label text not null,
  severity text not null,
  verification_required boolean not null default true,
  active boolean not null default true,
  source text not null default 'user',
  source_turn_id uuid references public.companion_turns(id) on delete set null,
  last_verified_at timestamptz,
  expires_at timestamptz,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint companion_safety_constraints_type_check
    check (
      constraint_type in (
        'allergy',
        'dietary',
        'religious',
        'medical',
        'preference'
      )
    ),
  constraint companion_safety_constraints_severity_check
    check (
      severity in (
        'preference',
        'dietary',
        'religious',
        'allergy',
        'allergy_level_1'
      )
    )
);

create unique index if not exists companion_safety_constraints_user_label_uidx
  on public.companion_safety_constraints (
    user_id,
    constraint_type,
    lower(label)
  );

create index if not exists companion_safety_constraints_user_active_idx
  on public.companion_safety_constraints (user_id, active, severity);

drop trigger if exists companion_safety_constraints_touch_updated_at
  on public.companion_safety_constraints;
create trigger companion_safety_constraints_touch_updated_at
before update on public.companion_safety_constraints
for each row execute function public.touch_updated_at();

create table if not exists public.companion_visible_cards (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.companion_sessions(id)
    on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  turn_id uuid references public.companion_turns(id) on delete cascade,
  card_id text not null,
  card_type text not null,
  title text not null default '',
  city text not null default '',
  payload jsonb not null default '{}',
  shown_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);

create index if not exists companion_visible_cards_session_idx
  on public.companion_visible_cards (session_id, shown_at desc);

create index if not exists companion_visible_cards_user_idx
  on public.companion_visible_cards (user_id, shown_at desc)
  where user_id is not null;

create unique index if not exists companion_visible_cards_session_card_uidx
  on public.companion_visible_cards (session_id, card_id, card_type);

alter table public.companion_sessions enable row level security;
alter table public.companion_turns enable row level security;
alter table public.companion_memories enable row level security;
alter table public.companion_safety_constraints enable row level security;
alter table public.companion_visible_cards enable row level security;

drop policy if exists "users read own companion sessions"
  on public.companion_sessions;
create policy "users read own companion sessions"
on public.companion_sessions
for select
using (auth.uid() = user_id);

drop policy if exists "users create own companion sessions"
  on public.companion_sessions;
create policy "users create own companion sessions"
on public.companion_sessions
for insert
with check (auth.uid() = user_id);
drop policy if exists "users update own companion sessions"
  on public.companion_sessions;
create policy "users update own companion sessions"
on public.companion_sessions
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users read own companion turns"
  on public.companion_turns;
create policy "users read own companion turns"
on public.companion_turns
for select
using (auth.uid() = user_id);

drop policy if exists "users create own companion turns"
  on public.companion_turns;
create policy "users create own companion turns"
on public.companion_turns
for insert
with check (auth.uid() = user_id);

drop policy if exists "users read own companion memories"
  on public.companion_memories;
create policy "users read own companion memories"
on public.companion_memories
for select
using (auth.uid() = user_id);

drop policy if exists "users create own companion memories"
  on public.companion_memories;
create policy "users create own companion memories"
on public.companion_memories
for insert
with check (auth.uid() = user_id);

drop policy if exists "users update own companion memories"
  on public.companion_memories;
create policy "users update own companion memories"
on public.companion_memories
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users read own companion safety constraints"
  on public.companion_safety_constraints;
create policy "users read own companion safety constraints"
on public.companion_safety_constraints
for select
using (auth.uid() = user_id);

drop policy if exists "users create own companion safety constraints"
  on public.companion_safety_constraints;
create policy "users create own companion safety constraints"
on public.companion_safety_constraints
for insert
with check (auth.uid() = user_id);

drop policy if exists "users update own companion safety constraints"
  on public.companion_safety_constraints;
create policy "users update own companion safety constraints"
on public.companion_safety_constraints
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users read own companion visible cards"
  on public.companion_visible_cards;
create policy "users read own companion visible cards"
on public.companion_visible_cards
for select
using (auth.uid() = user_id);

drop policy if exists "users create own companion visible cards"
  on public.companion_visible_cards;
create policy "users create own companion visible cards"
on public.companion_visible_cards
for insert
with check (auth.uid() = user_id);
