-- ==============================================================================
-- 202609190001_nearby_parking_facilities.sql
-- High-accuracy parking infrastructure for Echoo (Green P + municipal facilities)
-- ==============================================================================

create table if not exists public.parking_facilities (
  id uuid primary key default gen_random_uuid(),
  carpark_number text,
  name text not null,
  operator text not null default 'Green P',
  address text not null,
  city text not null default 'Toronto',
  latitude double precision not null,
  longitude double precision not null,
  capacity integer,
  facility_type text not null default 'surface' check (facility_type in ('surface', 'garage', 'underground', 'structure')),
  rate_summary text,
  rate_half_hour numeric(6, 2),
  day_max numeric(6, 2),
  night_max numeric(6, 2),
  payment_methods text[] not null default array['Green P App', 'Credit Card', 'Mobile Pay'],
  google_maps_url text,
  apple_maps_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists parking_facilities_coords_idx
  on public.parking_facilities (latitude, longitude);

create index if not exists parking_facilities_operator_idx
  on public.parking_facilities (operator, city);

-- Fast spatial distance calculation for nearby parking
create or replace function public.get_nearby_parking(
  p_lat double precision,
  p_lng double precision,
  p_radius_meters integer default 1500,
  p_limit integer default 3
)
returns table (
  id uuid,
  carpark_number text,
  name text,
  operator text,
  address text,
  city text,
  latitude double precision,
  longitude double precision,
  distance_meters integer,
  walking_minutes integer,
  capacity integer,
  facility_type text,
  rate_summary text,
  rate_half_hour numeric,
  day_max numeric,
  night_max numeric,
  payment_methods text[],
  google_maps_url text,
  apple_maps_url text
)
language plpgsql
stable
as $$
declare
  deg_lat double precision := p_radius_meters / 111320.0;
  deg_lng double precision := p_radius_meters / (111320.0 * cos(radians(p_lat)));
begin
  return query
  with candidates as (
    select
      pf.id,
      pf.carpark_number,
      pf.name,
      pf.operator,
      pf.address,
      pf.city,
      pf.latitude,
      pf.longitude,
      round(
        6371000 * 2 * asin(
          sqrt(
            sin(radians(pf.latitude - p_lat) / 2) ^ 2 +
            cos(radians(p_lat)) * cos(radians(pf.latitude)) *
            sin(radians(pf.longitude - p_lng) / 2) ^ 2
          )
        )
      )::integer as distance_meters,
      pf.capacity,
      pf.facility_type,
      pf.rate_summary,
      pf.rate_half_hour,
      pf.day_max,
      pf.night_max,
      pf.payment_methods,
      coalesce(pf.google_maps_url, 'https://www.google.com/maps/dir/?api=1&destination=' || pf.latitude || ',' || pf.longitude) as google_maps_url,
      coalesce(pf.apple_maps_url, 'https://maps.apple.com/?daddr=' || pf.latitude || ',' || pf.longitude) as apple_maps_url
    from public.parking_facilities pf
    where pf.latitude between (p_lat - deg_lat) and (p_lat + deg_lat)
      and pf.longitude between (p_lng - deg_lng) and (p_lng + deg_lng)
  )
  select
    c.id,
    c.carpark_number,
    c.name,
    c.operator,
    c.address,
    c.city,
    c.latitude,
    c.longitude,
    c.distance_meters,
    greatest(1, round(c.distance_meters / 80.0)::integer) as walking_minutes,
    c.capacity,
    c.facility_type,
    c.rate_summary,
    c.rate_half_hour,
    c.day_max,
    c.night_max,
    c.payment_methods,
    c.google_maps_url,
    c.apple_maps_url
  from candidates c
  where c.distance_meters <= p_radius_meters
  order by c.distance_meters asc
  limit p_limit;
end;
$$;

-- RLS policies
alter table public.parking_facilities enable row level security;

drop policy if exists "parking facilities are readable by all" on public.parking_facilities;
create policy "parking facilities are readable by all"
  on public.parking_facilities
  for select
  using (true);

-- Seed core Toronto Green P carparks
insert into public.parking_facilities (
  carpark_number, name, operator, address, city, latitude, longitude, capacity, facility_type, rate_summary, rate_half_hour, day_max, night_max, payment_methods
) values
  ('52', 'Green P Carpark 52', 'Green P', '40 Richmond St W', 'Toronto', 43.6514, -79.3813, 245, 'underground', '$3.50 / 30 mins', 3.50, 18.00, 9.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('36', 'Green P Carpark 36 (Nathan Phillips Sq)', 'Green P', '110 Queen St W', 'Toronto', 43.6525, -79.3835, 2024, 'underground', '$3.50 / 30 mins', 3.50, 20.00, 9.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('68', 'Green P Carpark 68', 'Green P', '111 Peter St', 'Toronto', 43.6477, -79.3916, 184, 'garage', '$4.00 / 30 mins', 4.00, 22.00, 12.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('260', 'Green P Carpark 260 (TIFF Lightbox)', 'Green P', '25 Mercer St', 'Toronto', 43.6468, -79.3888, 110, 'underground', '$4.00 / 30 mins', 4.00, 24.00, 12.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('235', 'Green P Carpark 235', 'Green P', '85 Mercer St', 'Toronto', 43.6465, -79.3905, 140, 'underground', '$4.00 / 30 mins', 4.00, 24.00, 12.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('204', 'Green P Carpark 204', 'Green P', '106 Spadina Ave', 'Toronto', 43.6482, -79.3965, 95, 'surface', '$3.50 / 30 mins', 3.50, 18.00, 9.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('122', 'Green P Carpark 122', 'Green P', '461 King St W', 'Toronto', 43.6449, -79.3989, 155, 'surface', '$4.00 / 30 mins', 4.00, 24.00, 12.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('26', 'Green P Carpark 26', 'Green P', '33 Soho St', 'Toronto', 43.6508, -79.3941, 160, 'surface', '$3.00 / 30 mins', 3.00, 16.00, 8.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('59', 'Green P Carpark 59 (OCAD / AGO)', 'Green P', '73 McCaul St', 'Toronto', 43.6534, -79.3912, 210, 'underground', '$3.25 / 30 mins', 3.25, 16.00, 8.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('217', 'Green P Carpark 217', 'Green P', '121 St. Patrick St', 'Toronto', 43.6528, -79.3891, 130, 'surface', '$3.25 / 30 mins', 3.25, 17.00, 8.50, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('70', 'Green P Carpark 70 (Opera House)', 'Green P', '360 University Ave', 'Toronto', 43.6517, -79.3871, 280, 'underground', '$3.50 / 30 mins', 3.50, 18.00, 9.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('64', 'Green P Carpark 64 (Union Station)', 'Green P', '31 A Station St', 'Toronto', 43.6448, -79.3839, 640, 'garage', '$4.25 / 30 mins', 4.25, 25.00, 12.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('236', 'Green P Carpark 236', 'Green P', '45 The Esplanade', 'Toronto', 43.6471, -79.3752, 512, 'garage', '$3.75 / 30 mins', 3.75, 20.00, 10.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('43', 'Green P Carpark 43 (St. Lawrence)', 'Green P', '2 Church St', 'Toronto', 43.6487, -79.3736, 2011, 'garage', '$3.25 / 30 mins', 3.25, 18.00, 9.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('13', 'Green P Carpark 13 (Yonge & Dundas)', 'Green P', '250 Victoria St', 'Toronto', 43.6560, -79.3792, 450, 'garage', '$3.50 / 30 mins', 3.50, 20.00, 10.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('215', 'Green P Carpark 215', 'Green P', '34 Elm St', 'Toronto', 43.6571, -79.3838, 175, 'surface', '$3.50 / 30 mins', 3.50, 18.00, 9.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('29', 'Green P Carpark 29 (Kensington)', 'Green P', '20 St. Andrew St', 'Toronto', 43.6542, -79.4005, 420, 'garage', '$2.75 / 30 mins', 2.75, 14.00, 7.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('221', 'Green P Carpark 221', 'Green P', '15 Dennison Ave', 'Toronto', 43.6526, -79.4035, 88, 'surface', '$2.50 / 30 mins', 2.50, 12.00, 6.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('130', 'Green P Carpark 130 (Ossington)', 'Green P', '106 Ossington Ave', 'Toronto', 43.6478, -79.4198, 72, 'surface', '$2.75 / 30 mins', 2.75, 14.00, 7.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('191', 'Green P Carpark 191 (Bellwoods)', 'Green P', '164 Bellwoods Ave', 'Toronto', 43.6504, -79.4128, 55, 'surface', '$2.50 / 30 mins', 2.50, 12.00, 6.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('144', 'Green P Carpark 144 (West Queen West)', 'Green P', '1100 Queen St W', 'Toronto', 43.6436, -79.4215, 64, 'surface', '$2.75 / 30 mins', 2.75, 14.00, 7.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('142', 'Green P Carpark 142 (Parkdale)', 'Green P', '1325 Queen St W', 'Toronto', 43.6397, -79.4352, 82, 'surface', '$2.25 / 30 mins', 2.25, 10.00, 5.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('256', 'Green P Carpark 256 (Distillery)', 'Green P', '37 Parliament St', 'Toronto', 43.6508, -79.3592, 350, 'surface', '$3.50 / 30 mins', 3.50, 18.00, 10.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('84', 'Green P Carpark 84 (Corktown)', 'Green P', '512 King St E', 'Toronto', 43.6540, -79.3582, 90, 'surface', '$2.75 / 30 mins', 2.75, 12.00, 6.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('1', 'Green P Carpark 1 (Yonge & Bloor)', 'Green P', '20 Charles St E', 'Toronto', 43.6687, -79.3854, 480, 'garage', '$3.75 / 30 mins', 3.75, 20.00, 10.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('2', 'Green P Carpark 2 (Yorkville)', 'Green P', '74 Yorkville Ave', 'Toronto', 43.6706, -79.3907, 290, 'garage', '$4.25 / 30 mins', 4.25, 24.00, 12.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('65', 'Green P Carpark 65 (ROM / Bloor)', 'Green P', '15 Bedford Rd', 'Toronto', 43.6698, -79.3968, 250, 'garage', '$4.00 / 30 mins', 4.00, 22.00, 10.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('15', 'Green P Carpark 15 (Wellesley)', 'Green P', '15 Wellesley St E', 'Toronto', 43.6653, -79.3837, 312, 'underground', '$3.00 / 30 mins', 3.00, 16.00, 8.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('208', 'Green P Carpark 208 (Annex)', 'Green P', '184 Harbord St', 'Toronto', 43.6608, -79.4082, 65, 'surface', '$2.50 / 30 mins', 2.50, 12.00, 6.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('180', 'Green P Carpark 180 (Harbourfront)', 'Green P', '100 Cooper St', 'Toronto', 43.6432, -79.3734, 320, 'surface', '$4.00 / 30 mins', 4.00, 25.00, 14.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('200', 'Green P Carpark 200 (Queens Quay)', 'Green P', '200 Queens Quay W', 'Toronto', 43.6391, -79.3831, 410, 'underground', '$4.00 / 30 mins', 4.00, 25.00, 14.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('230', 'Green P Carpark 230 (High Park)', 'Green P', '2196 Bloor St W', 'Toronto', 43.6511, -79.4751, 120, 'surface', '$2.25 / 30 mins', 2.25, 11.00, 5.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('28', 'Green P Carpark 28 (Humber Bay)', 'Green P', '15 Marine Parade Dr', 'Toronto', 43.6264, -79.4795, 180, 'surface', '$2.00 / 30 mins', 2.00, 10.00, 5.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('111', 'Green P Carpark 111 (Midtown)', 'Green P', '30 Alvin Ave', 'Toronto', 43.6888, -79.3934, 140, 'garage', '$3.00 / 30 mins', 3.00, 15.00, 7.00, array['Green P App', 'Credit Card', 'Mobile Pay']),
  ('227', 'Green P Carpark 227 (Wychwood)', 'Green P', '125 Burnside Dr', 'Toronto', 43.6795, -79.4230, 60, 'surface', '$2.00 / 30 mins', 2.00, 9.00, 5.00, array['Green P App', 'Credit Card', 'Mobile Pay'])
on conflict do nothing;
