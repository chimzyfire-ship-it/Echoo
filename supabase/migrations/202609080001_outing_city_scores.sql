-- Source only: requires explicit approval before application.
-- GPS is a proximity signal, not fraud-proof proof of physical presence.
begin;

create table public.outing_city_scores (
  user_id uuid not null references auth.users(id) on delete cascade,
  city_key text not null,
  city_name text not null,
  points integer not null default 0 check (points >= 0),
  visit_count integer not null default 0 check (visit_count >= 0),
  badge_count integer not null default 0 check (badge_count >= 0),
  primary key (user_id, city_key)
);

create table public.outing_verified_visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  place_id uuid not null references public.canonical_places(id),
  city_key text not null,
  local_day date not null,
  arrived_at timestamptz not null default now(),
  unique (user_id, place_id, local_day),
  foreign key (user_id, city_key) references public.outing_city_scores(user_id, city_key)
);

create table public.outing_city_badges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  city_key text not null,
  city_name text not null,
  milestone integer not null check (milestone > 0),
  earned_at timestamptz not null default now(),
  unique (user_id, city_key, milestone),
  foreign key (user_id, city_key) references public.outing_city_scores(user_id, city_key)
);

alter table public.outing_city_scores enable row level security;
alter table public.outing_verified_visits enable row level security;
alter table public.outing_city_badges enable row level security;
create policy "read own city scores" on public.outing_city_scores for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own outing visits" on public.outing_verified_visits for select to authenticated using ((select auth.uid()) = user_id);
create policy "read own city badges" on public.outing_city_badges for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.outing_city_scores, public.outing_verified_visits, public.outing_city_badges from anon, authenticated;
grant select on public.outing_city_scores, public.outing_verified_visits, public.outing_city_badges to authenticated;

create function public.verify_outing_arrival(
  p_place_id uuid, p_latitude double precision, p_longitude double precision,
  p_accuracy double precision, p_observed_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_place public.canonical_places%rowtype;
  v_city text;
  v_key text;
  v_day date;
  v_visit public.outing_verified_visits%rowtype;
  v_added boolean;
begin
  if v_user is null then raise exception 'Sign in to verify a visit.' using errcode = '28000'; end if;
  if p_latitude is null or not (p_latitude between -90 and 90)
    or p_longitude is null or not (p_longitude between -180 and 180)
    or p_accuracy is null or not (p_accuracy between 0 and 75)
    or p_observed_at is null or p_observed_at < now() - interval '2 minutes'
    or p_observed_at > now() + interval '15 seconds' then
    raise exception 'A fresh, precise foreground location is required.' using errcode = '22023';
  end if;
  select * into v_place from public.canonical_places
    where id = p_place_id and location_status = 'published' and is_supported_region
      and country_code = 'CA' and admin_area_1 = 'ON';
  if not found then raise exception 'This place is not in the verified outing inventory yet.' using errcode = '22023'; end if;
  v_city := coalesce(nullif(trim(v_place.municipality), ''), nullif(trim(v_place.city), ''));
  if v_city is null or not exists (select 1 from pg_catalog.pg_timezone_names where name = v_place.timezone) then
    raise exception 'This place needs verified city and timezone data.' using errcode = '22023';
  end if;
   if v_place.location is null or not coalesce(extensions.st_dwithin(
    v_place.location,
    extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude), 4326)::extensions.geography,
    150
   ), false) then raise exception 'Move within 150 metres of the place and try again. A verified venue location is required.' using errcode = '22023'; end if;
  v_key := 'CA:ON:' || lower(v_city);
  v_day := (now() at time zone v_place.timezone)::date;
  insert into public.outing_city_scores(user_id, city_key, city_name) values (v_user, v_key, v_city)
    on conflict do nothing;
  -- One lock order for arrival and claim, including simultaneous devices.
  perform 1 from public.outing_city_scores where user_id = v_user and city_key = v_key for update;
  insert into public.outing_verified_visits(user_id, place_id, city_key, local_day)
    values (v_user, p_place_id, v_key, v_day) on conflict do nothing returning * into v_visit;
  v_added := found;
  if v_added then
    update public.outing_city_scores set points = points + 10, visit_count = visit_count + 1
      where user_id = v_user and city_key = v_key;
  else
    select * into v_visit from public.outing_verified_visits
      where user_id = v_user and place_id = p_place_id and local_day = v_day;
  end if;
  return jsonb_build_object('visitId', v_visit.id, 'arrivedAt', v_visit.arrived_at,
    'awardedPoints', case when v_added then 10 else 0 end, 'city', v_city);
end;
$$;

create function public.claim_outing_city_badge(p_city_key text, p_milestone integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_score public.outing_city_scores%rowtype;
  v_badge public.outing_city_badges%rowtype;
begin
  if v_user is null then raise exception 'Sign in to claim a city badge.' using errcode = '28000'; end if;
  select * into v_score from public.outing_city_scores
    where user_id = v_user and city_key = p_city_key for update;
  if not found then raise exception 'No verified visits for this city.' using errcode = '22023'; end if;
  select * into v_badge from public.outing_city_badges
    where user_id = v_user and city_key = p_city_key and milestone = p_milestone;
  if found then return to_jsonb(v_badge); end if;
  if p_milestone is null or p_milestone <> v_score.badge_count + 1 or v_score.points < 100 then
    raise exception 'This milestone is not ready to claim. Refresh your city score.' using errcode = '22023';
  end if;
  insert into public.outing_city_badges(user_id, city_key, city_name, milestone)
    values (v_user, p_city_key, v_score.city_name, p_milestone) returning * into v_badge;
  update public.outing_city_scores set points = points - 100, badge_count = badge_count + 1
    where user_id = v_user and city_key = p_city_key;
  return to_jsonb(v_badge);
end;
$$;

revoke all on function public.verify_outing_arrival(uuid, double precision, double precision, double precision, timestamptz) from public, anon;
revoke all on function public.claim_outing_city_badge(text, integer) from public, anon;
grant execute on function public.verify_outing_arrival(uuid, double precision, double precision, double precision, timestamptz) to authenticated;
grant execute on function public.claim_outing_city_badge(text, integer) to authenticated;
commit;
