-- Verification hardening: remove advisory/lint noise unrelated to Ontario.

drop policy if exists "users read own location preference"
  on public.user_location_preferences;
create policy "users read own location preference"
on public.user_location_preferences
for select
using ((select auth.uid()) = user_id);

drop policy if exists "users write own location preference"
  on public.user_location_preferences;
create policy "users write own location preference"
on public.user_location_preferences
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "users update own location preference"
  on public.user_location_preferences;
create policy "users update own location preference"
on public.user_location_preferences
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "users read own onboarding profile"
  on public.user_onboarding_profiles;
create policy "users read own onboarding profile"
on public.user_onboarding_profiles
for select
using ((select auth.uid()) = user_id);

drop policy if exists "users create own onboarding profile"
  on public.user_onboarding_profiles;
create policy "users create own onboarding profile"
on public.user_onboarding_profiles
for insert
with check ((select auth.uid()) = user_id);

drop policy if exists "users update own onboarding profile"
  on public.user_onboarding_profiles;
create policy "users update own onboarding profile"
on public.user_onboarding_profiles
for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

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
    update public.ticket_orders
    set status = 'expired',
        payment_status = 'cancelled'
    where id = v_order.id;

    update public.ticket_holds
    set status = 'expired'
    where id = v_order.hold_id;

    update public.ticket_tiers
    set remaining_quantity = remaining_quantity + v_order.quantity
    where id = v_order.tier_id;

    raise exception 'Ticket hold expired.';
  end if;

  select * into v_event
  from public.ticketed_events
  where id = v_order.event_id;

  select * into v_tier
  from public.ticket_tiers
  where id = v_order.tier_id;

  update public.ticket_orders
  set status = 'confirmed',
      payment_status = 'paid',
      confirmed_at = now()
  where id = v_order.id
  returning * into v_order;

  update public.ticket_holds
  set status = 'confirmed'
  where id = v_order.hold_id;

  update public.payment_attempts
  set status = 'paid',
      provider_reference = coalesce(provider_reference, 'manual-' || v_order.id::text)
  where order_id = v_order.id;

  for ticket_index in 1..v_order.quantity loop
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
