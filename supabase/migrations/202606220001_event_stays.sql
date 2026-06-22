-- Event-adjacent accommodation recommendations for the event detail flow.

create table if not exists public.event_stays (
  id uuid primary key default gen_random_uuid(),
  hotel_name text not null,
  description text,
  image_url text,
  city text not null,
  province text not null,
  country_code text not null default 'CA',
  address text,
  latitude double precision not null,
  longitude double precision not null,
  nightly_rate_cents integer not null default 0 check (nightly_rate_cents >= 0),
  currency text not null default 'CAD',
  rating numeric(3, 2) not null default 4.20,
  amenities text[] not null default '{}',
  booking_url text,
  status text not null default 'published' check (status in ('draft', 'published', 'archived')),
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_stays_country_upper check (country_code = upper(country_code)),
  constraint event_stays_lat_range check (latitude between -90 and 90),
  constraint event_stays_lng_range check (longitude between -180 and 180)
);

create index if not exists event_stays_city_status_idx
  on public.event_stays (country_code, province, city, status);

create index if not exists event_stays_rating_idx
  on public.event_stays (rating desc, nightly_rate_cents asc);

drop trigger if exists event_stays_touch_updated_at on public.event_stays;
create trigger event_stays_touch_updated_at
before update on public.event_stays
for each row execute function public.touch_updated_at();

alter table public.event_stays enable row level security;

drop policy if exists "published event stays are readable" on public.event_stays;
create policy "published event stays are readable"
on public.event_stays
for select
using (status = 'published' and country_code = 'CA');

insert into public.event_stays (
  id,
  hotel_name,
  description,
  image_url,
  city,
  province,
  country_code,
  address,
  latitude,
  longitude,
  nightly_rate_cents,
  currency,
  rating,
  amenities,
  booking_url,
  metadata
)
values
  (
    '51000000-0000-4000-9000-000000000001',
    'Market House Hotel',
    'Quiet rooms close to Kensington and Queen West, useful when an event ends late.',
    'assets/optimized/news-date-768.jpg',
    'Toronto',
    'ON',
    'CA',
    'Kensington Market, Toronto',
    43.6559,
    -79.4015,
    21900,
    'CAD',
    4.60,
    array['walkable', 'late check-in', 'quiet rooms'],
    'https://www.google.com/travel/hotels/Toronto',
    '{"seed": true}'::jsonb
  ),
  (
    '51000000-0000-4000-9000-000000000002',
    'Queen West Social Stay',
    'A social, lower-friction option near food, bars, transit, and late routes.',
    'assets/optimized/news-music-768.jpg',
    'Toronto',
    'ON',
    'CA',
    'Queen Street West, Toronto',
    43.6503,
    -79.3972,
    17900,
    'CAD',
    4.35,
    array['transit nearby', 'food nearby', 'budget friendlier'],
    'https://www.google.com/travel/hotels/Toronto',
    '{"seed": true}'::jsonb
  ),
  (
    '51000000-0000-4000-9000-000000000003',
    'Bloor Boutique Rooms',
    'A calmer stay north of the event core with easy transit back after a busy night.',
    'assets/optimized/news-movie-768.jpg',
    'Toronto',
    'ON',
    'CA',
    'Bloor Street West, Toronto',
    43.6628,
    -79.4047,
    24500,
    'CAD',
    4.72,
    array['quiet', 'transit nearby', 'premium'],
    'https://www.google.com/travel/hotels/Toronto',
    '{"seed": true}'::jsonb
  ),
  (
    '51000000-0000-4000-9000-000000000004',
    'Granville Event Stay',
    'A central Vancouver stay close to live rooms, transit, and late food corridors.',
    'assets/optimized/news-music-768.jpg',
    'Vancouver',
    'BC',
    'CA',
    'Granville Street, Vancouver',
    49.2795,
    -123.1231,
    22900,
    'CAD',
    4.48,
    array['central', 'late check-in', 'transit nearby'],
    'https://www.google.com/travel/hotels/Vancouver',
    '{"seed": true}'::jsonb
  ),
  (
    '51000000-0000-4000-9000-000000000005',
    'Mile End Guesthouse',
    'A relaxed Montreal stay near food, music, and walkable post-event options.',
    'assets/optimized/news-date-768.jpg',
    'Montreal',
    'QC',
    'CA',
    'Mile End, Montreal',
    45.5244,
    -73.5960,
    16500,
    'CAD',
    4.40,
    array['walkable', 'food nearby', 'budget friendlier'],
    'https://www.google.com/travel/hotels/Montreal',
    '{"seed": true}'::jsonb
  )
on conflict (id) do update
set
  hotel_name = excluded.hotel_name,
  description = excluded.description,
  image_url = excluded.image_url,
  city = excluded.city,
  province = excluded.province,
  country_code = excluded.country_code,
  address = excluded.address,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  nightly_rate_cents = excluded.nightly_rate_cents,
  currency = excluded.currency,
  rating = excluded.rating,
  amenities = excluded.amenities,
  booking_url = excluded.booking_url,
  status = 'published',
  metadata = excluded.metadata;
