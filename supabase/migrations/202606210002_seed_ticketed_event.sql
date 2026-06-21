-- Seed one live ticketed event so the production ticketing flow is testable immediately.

insert into public.ticketed_events (
  id,
  title,
  description,
  category,
  image_url,
  venue_name,
  address,
  city,
  province,
  country_code,
  latitude,
  longitude,
  starts_at,
  ends_at,
  status
)
values (
  '11111111-2222-4333-8444-555555555555',
  'Echoo Toronto launch listening room',
  'A small-room live music night with limited early seats and an easy food route nearby.',
  'music',
  'assets/optimized/news-music-768.jpg',
  'Kensington Listening Room',
  'Kensington Market, Toronto',
  'Toronto',
  'ON',
  'CA',
  43.6552,
  -79.4022,
  now() + interval '3 days',
  now() + interval '3 days 3 hours',
  'published'
)
on conflict (id) do update
set
  title = excluded.title,
  description = excluded.description,
  category = excluded.category,
  image_url = excluded.image_url,
  venue_name = excluded.venue_name,
  address = excluded.address,
  city = excluded.city,
  province = excluded.province,
  country_code = excluded.country_code,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  status = excluded.status;

insert into public.location_entities (
  id,
  entity_type,
  entity_id,
  title,
  category,
  description,
  image_url,
  starts_at,
  ends_at,
  popularity_score,
  availability_score,
  editorial_boost,
  trust_score,
  status,
  country_code,
  admin_area_1,
  city,
  latitude,
  longitude,
  metadata
)
values (
  'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  'event',
  '11111111-2222-4333-8444-555555555555',
  'Echoo Toronto launch listening room',
  'music',
  'A small-room live music night with limited early seats and an easy food route nearby.',
  'assets/optimized/news-music-768.jpg',
  now() + interval '3 days',
  now() + interval '3 days 3 hours',
  0.88,
  0.92,
  0.35,
  0.94,
  'published',
  'CA',
  'ON',
  'Toronto',
  43.6552,
  -79.4022,
  '{"ticketed_event_id":"11111111-2222-4333-8444-555555555555","venue_name":"Kensington Listening Room","seed_ticketed":true}'::jsonb
)
on conflict (id) do update
set
  entity_id = excluded.entity_id,
  title = excluded.title,
  category = excluded.category,
  description = excluded.description,
  image_url = excluded.image_url,
  starts_at = excluded.starts_at,
  ends_at = excluded.ends_at,
  popularity_score = excluded.popularity_score,
  availability_score = excluded.availability_score,
  editorial_boost = excluded.editorial_boost,
  trust_score = excluded.trust_score,
  status = excluded.status,
  country_code = excluded.country_code,
  admin_area_1 = excluded.admin_area_1,
  city = excluded.city,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  metadata = excluded.metadata;

update public.ticketed_events
set location_entity_id = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
where id = '11111111-2222-4333-8444-555555555555';

insert into public.ticket_tiers (
  id,
  event_id,
  name,
  description,
  price_cents,
  currency,
  capacity,
  remaining_quantity,
  sale_status,
  sort_order
)
values
  (
    '22222222-3333-4444-8555-666666666666',
    '11111111-2222-4333-8444-555555555555',
    'Free RSVP',
    'A free launch RSVP tier for testing instant ticket issue.',
    0,
    'CAD',
    40,
    40,
    'on_sale',
    0
  ),
  (
    '33333333-4444-4555-8666-777777777777',
    '11111111-2222-4333-8444-555555555555',
    'General Admission',
    'Standard paid ticket, ready for manual confirmation until payments are connected.',
    2500,
    'CAD',
    120,
    120,
    'on_sale',
    1
  )
on conflict (id) do update
set
  name = excluded.name,
  description = excluded.description,
  price_cents = excluded.price_cents,
  currency = excluded.currency,
  capacity = excluded.capacity,
  remaining_quantity = least(public.ticket_tiers.remaining_quantity, excluded.capacity),
  sale_status = excluded.sale_status,
  sort_order = excluded.sort_order;
