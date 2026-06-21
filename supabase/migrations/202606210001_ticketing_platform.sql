-- Echoo owner-managed ticketing and payment-ready checkout foundation.

create table if not exists public.ticketed_events (
  id uuid primary key default gen_random_uuid(),
  location_entity_id uuid references public.location_entities(id) on delete set null,
  title text not null,
  description text,
  category text not null default 'event',
  image_url text,
  venue_name text not null,
  address text,
  city text not null,
  province text not null,
  country_code text not null default 'CA',
  latitude double precision not null,
  longitude double precision not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticketed_events_country_upper check (country_code = upper(country_code)),
  constraint ticketed_events_lat_range check (latitude between -90 and 90),
  constraint ticketed_events_lng_range check (longitude between -180 and 180)
);

create table if not exists public.ticket_tiers (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ticketed_events(id) on delete cascade,
  name text not null,
  description text,
  price_cents integer not null default 0 check (price_cents >= 0),
  currency text not null default 'CAD',
  capacity integer not null check (capacity >= 0),
  remaining_quantity integer not null check (remaining_quantity >= 0),
  sale_status text not null default 'on_sale' check (sale_status in ('on_sale', 'paused', 'sold_out')),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ticket_tiers_remaining_capacity check (remaining_quantity <= capacity)
);

create table if not exists public.ticket_holds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ticketed_events(id) on delete cascade,
  tier_id uuid not null references public.ticket_tiers(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  session_id text,
  buyer_email text,
  expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'confirmed', 'expired', 'released')),
  created_at timestamptz not null default now()
);

create table if not exists public.ticket_orders (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.ticketed_events(id) on delete cascade,
  tier_id uuid not null references public.ticket_tiers(id) on delete restrict,
  hold_id uuid references public.ticket_holds(id) on delete set null,
  session_id text,
  buyer_name text,
  buyer_email text,
  quantity integer not null check (quantity > 0),
  subtotal_cents integer not null default 0 check (subtotal_cents >= 0),
  total_cents integer not null default 0 check (total_cents >= 0),
  currency text not null default 'CAD',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled', 'expired', 'refunded')),
  payment_status text not null default 'not_configured' check (payment_status in ('not_configured', 'requires_payment', 'pending', 'paid', 'failed', 'cancelled')),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ticket_orders(id) on delete cascade,
  provider text not null default 'manual',
  status text not null default 'not_configured' check (status in ('not_configured', 'requires_payment', 'pending', 'paid', 'failed', 'cancelled')),
  checkout_url text,
  provider_reference text,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  currency text not null default 'CAD',
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ticket_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.ticket_orders(id) on delete cascade,
  event_id uuid not null references public.ticketed_events(id) on delete cascade,
  tier_id uuid not null references public.ticket_tiers(id) on delete restrict,
  qr_token text not null unique,
  display_code text not null unique,
  checked_in_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists ticketed_events_status_starts_idx on public.ticketed_events (status, starts_at);
create index if not exists ticketed_events_location_entity_idx on public.ticketed_events (location_entity_id);
create index if not exists ticket_tiers_event_idx on public.ticket_tiers (event_id, sale_status, sort_order);
create index if not exists ticket_holds_expiry_idx on public.ticket_holds (status, expires_at);
create index if not exists ticket_orders_lookup_idx on public.ticket_orders (session_id, buyer_email, created_at desc);
create index if not exists ticket_items_order_idx on public.ticket_items (order_id);

drop trigger if exists ticketed_events_touch_updated_at on public.ticketed_events;
create trigger ticketed_events_touch_updated_at
before update on public.ticketed_events
for each row execute function public.touch_updated_at();

drop trigger if exists ticket_tiers_touch_updated_at on public.ticket_tiers;
create trigger ticket_tiers_touch_updated_at
before update on public.ticket_tiers
for each row execute function public.touch_updated_at();

drop trigger if exists ticket_orders_touch_updated_at on public.ticket_orders;
create trigger ticket_orders_touch_updated_at
before update on public.ticket_orders
for each row execute function public.touch_updated_at();

drop trigger if exists payment_attempts_touch_updated_at on public.payment_attempts;
create trigger payment_attempts_touch_updated_at
before update on public.payment_attempts
for each row execute function public.touch_updated_at();

alter table public.ticketed_events enable row level security;
alter table public.ticket_tiers enable row level security;
alter table public.ticket_holds enable row level security;
alter table public.ticket_orders enable row level security;
alter table public.payment_attempts enable row level security;
alter table public.ticket_items enable row level security;

drop policy if exists "published ticketed events are readable" on public.ticketed_events;
create policy "published ticketed events are readable"
on public.ticketed_events
for select
using (status = 'published' and country_code = 'CA');

drop policy if exists "public ticket tiers are readable" on public.ticket_tiers;
create policy "public ticket tiers are readable"
on public.ticket_tiers
for select
using (
  exists (
    select 1 from public.ticketed_events te
    where te.id = ticket_tiers.event_id
      and te.status = 'published'
      and te.country_code = 'CA'
  )
);

create or replace function public.release_expired_ticket_holds()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hold public.ticket_holds%rowtype;
  v_count integer := 0;
begin
  for v_hold in
    select *
    from public.ticket_holds
    where status = 'active'
      and expires_at <= now()
    for update skip locked
  loop
    update public.ticket_holds
    set status = 'expired'
    where id = v_hold.id;

    update public.ticket_tiers
    set remaining_quantity = least(capacity, remaining_quantity + v_hold.quantity),
        sale_status = case when sale_status = 'sold_out' then 'on_sale' else sale_status end
    where id = v_hold.tier_id;

    update public.ticket_orders
    set status = 'expired',
        payment_status = 'cancelled'
    where hold_id = v_hold.id
      and status = 'pending';

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.reserve_ticket_order(
  p_event_id uuid,
  p_tier_id uuid,
  p_quantity integer,
  p_buyer_email text default null,
  p_buyer_name text default null,
  p_session_id text default null,
  p_payment_provider text default 'manual'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.ticketed_events%rowtype;
  v_tier public.ticket_tiers%rowtype;
  v_hold public.ticket_holds%rowtype;
  v_order public.ticket_orders%rowtype;
  v_payment public.payment_attempts%rowtype;
  v_total integer;
  v_payment_status text;
begin
  perform public.release_expired_ticket_holds();

  if p_quantity is null or p_quantity < 1 or p_quantity > 10 then
    raise exception 'Quantity must be between 1 and 10.';
  end if;

  select * into v_event
  from public.ticketed_events
  where id = p_event_id and status = 'published' and country_code = 'CA';

  if not found then
    raise exception 'Event is not available.';
  end if;

  update public.ticket_tiers
  set remaining_quantity = remaining_quantity - p_quantity,
      sale_status = case when remaining_quantity - p_quantity = 0 then 'sold_out' else sale_status end
  where id = p_tier_id
    and event_id = p_event_id
    and sale_status = 'on_sale'
    and remaining_quantity >= p_quantity
  returning * into v_tier;

  if not found then
    raise exception 'Not enough tickets remain for this tier.';
  end if;

  v_total := v_tier.price_cents * p_quantity;
  v_payment_status := case when v_total = 0 then 'paid' else 'not_configured' end;

  insert into public.ticket_holds (event_id, tier_id, quantity, session_id, buyer_email, expires_at)
  values (p_event_id, p_tier_id, p_quantity, p_session_id, p_buyer_email, now() + interval '5 minutes')
  returning * into v_hold;

  insert into public.ticket_orders (
    event_id, tier_id, hold_id, session_id, buyer_name, buyer_email, quantity,
    subtotal_cents, total_cents, currency, payment_status
  )
  values (
    p_event_id, p_tier_id, v_hold.id, p_session_id, p_buyer_name, p_buyer_email, p_quantity,
    v_total, v_total, v_tier.currency, v_payment_status
  )
  returning * into v_order;

  insert into public.payment_attempts (
    order_id, provider, status, amount_cents, currency, metadata
  )
  values (
    v_order.id,
    coalesce(nullif(p_payment_provider, ''), 'manual'),
    v_payment_status,
    v_total,
    v_tier.currency,
    jsonb_build_object('gateway_ready', true, 'checkout_url', null)
  )
  returning * into v_payment;

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'hold', to_jsonb(v_hold),
    'tier', to_jsonb(v_tier),
    'event', to_jsonb(v_event),
    'paymentAttempt', to_jsonb(v_payment)
  );
end;
$$;

create or replace function public.confirm_ticket_order(
  p_order_id uuid,
  p_force boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.ticket_orders%rowtype;
  v_event public.ticketed_events%rowtype;
  v_tier public.ticket_tiers%rowtype;
  v_item public.ticket_items%rowtype;
  v_items jsonb := '[]'::jsonb;
  i integer;
begin
  select * into v_order
  from public.ticket_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Order not found.';
  end if;

  if v_order.status = 'confirmed' then
    return jsonb_build_object('order', to_jsonb(v_order), 'tickets', (
      select coalesce(jsonb_agg(to_jsonb(ti)), '[]'::jsonb)
      from public.ticket_items ti
      where ti.order_id = v_order.id
    ));
  end if;

  if v_order.status <> 'pending' then
    raise exception 'Order cannot be confirmed.';
  end if;

  if v_order.total_cents > 0 and p_force is not true then
    raise exception 'Paid orders require admin confirmation until a payment provider is connected.';
  end if;

  if exists (
    select 1
    from public.ticket_holds th
    where th.id = v_order.hold_id
      and th.status = 'active'
      and th.expires_at <= now()
  ) then
    update public.ticket_orders set status = 'expired', payment_status = 'cancelled' where id = v_order.id;
    update public.ticket_holds set status = 'expired' where id = v_order.hold_id;
    update public.ticket_tiers set remaining_quantity = remaining_quantity + v_order.quantity where id = v_order.tier_id;
    raise exception 'Ticket hold expired.';
  end if;

  select * into v_event from public.ticketed_events where id = v_order.event_id;
  select * into v_tier from public.ticket_tiers where id = v_order.tier_id;

  update public.ticket_orders
  set status = 'confirmed',
      payment_status = 'paid',
      confirmed_at = now()
  where id = v_order.id
  returning * into v_order;

  update public.ticket_holds set status = 'confirmed' where id = v_order.hold_id;
  update public.payment_attempts
  set status = 'paid',
      provider_reference = coalesce(provider_reference, 'manual-' || v_order.id::text)
  where order_id = v_order.id;

  for i in 1..v_order.quantity loop
    insert into public.ticket_items (order_id, event_id, tier_id, qr_token, display_code)
    values (
      v_order.id,
      v_order.event_id,
      v_order.tier_id,
      replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
      upper(substr(replace(v_event.city, ' ', ''), 1, 3)) || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
    )
    returning * into v_item;
    v_items := v_items || jsonb_build_array(to_jsonb(v_item));
  end loop;

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'event', to_jsonb(v_event),
    'tier', to_jsonb(v_tier),
    'tickets', v_items
  );
end;
$$;
