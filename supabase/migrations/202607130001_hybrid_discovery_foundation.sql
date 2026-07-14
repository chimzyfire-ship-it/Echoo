-- Hybrid Discovery Stage 1.
-- Echoo owns feature tags, media, ratings, visits, saves, and Hot Pick signals.
-- External provider results remain a live fallback and are not copied here by
-- this migration.

create table if not exists public.discovery_feature_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  category text not null default 'general',
  synonyms text[] not null default '{}',
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_feature_catalog_slug_format
    check (slug ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$')
);

create table if not exists public.discovery_entity_features (
  id uuid primary key default gen_random_uuid(),
  location_entity_id uuid not null references public.location_entities(id) on delete cascade,
  feature_id uuid not null references public.discovery_feature_catalog(id) on delete cascade,
  source_type text not null,
  source_reference text,
  confidence_score numeric(4,3) not null default 0.500,
  review_status public.review_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_entity_features_source_type_check
    check (source_type in ('echoo_editorial', 'venue_claim', 'partner', 'open_data', 'user_submission')),
  constraint discovery_entity_features_confidence_range
    check (confidence_score between 0 and 1),
  constraint discovery_entity_features_unique unique (location_entity_id, feature_id)
);

create table if not exists public.discovery_entity_media (
  id uuid primary key default gen_random_uuid(),
  location_entity_id uuid not null references public.location_entities(id) on delete cascade,
  storage_path text not null,
  alt_text text,
  media_kind text not null default 'image',
  source_type text not null,
  source_reference text,
  rights_status text not null default 'pending',
  is_cover boolean not null default false,
  sort_order integer not null default 0,
  review_status public.review_status not null default 'pending',
  created_by uuid references auth.users(id) on delete set null,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_entity_media_kind_check check (media_kind in ('image', 'video')),
  constraint discovery_entity_media_source_type_check
    check (source_type in ('echoo', 'venue', 'partner', 'user')),
  constraint discovery_entity_media_rights_status_check
    check (rights_status in ('pending', 'owned', 'licensed', 'permission_granted'))
);

create unique index if not exists discovery_entity_media_one_approved_cover_idx
  on public.discovery_entity_media (location_entity_id)
  where is_cover and review_status = 'approved';

create table if not exists public.discovery_entity_visits (
  id uuid primary key default gen_random_uuid(),
  location_entity_id uuid not null references public.location_entities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  visit_source text not null default 'self_report',
  verification_status text not null default 'unverified',
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint discovery_entity_visits_source_check
    check (visit_source in ('self_report', 'gps', 'booking', 'ticket', 'admin')),
  constraint discovery_entity_visits_verification_check
    check (verification_status in ('unverified', 'verified', 'rejected'))
);

create table if not exists public.discovery_entity_ratings (
  id uuid primary key default gen_random_uuid(),
  location_entity_id uuid not null references public.location_entities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  rating smallint not null,
  is_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint discovery_entity_ratings_value_range check (rating between 1 and 5),
  constraint discovery_entity_ratings_one_per_user unique (location_entity_id, user_id)
);

create table if not exists public.discovery_entity_saves (
  location_entity_id uuid not null references public.location_entities(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (location_entity_id, user_id)
);

create table if not exists public.discovery_entity_stats (
  location_entity_id uuid primary key references public.location_entities(id) on delete cascade,
  rating_count integer not null default 0,
  verified_rating_count integer not null default 0,
  rating_average numeric(3,2),
  rating_bayesian numeric(3,2),
  visit_count integer not null default 0,
  verified_visit_count integer not null default 0,
  save_count integer not null default 0,
  hot_score numeric(8,4) not null default 0,
  updated_at timestamptz not null default now(),
  constraint discovery_entity_stats_rating_average_range
    check (rating_average is null or rating_average between 1 and 5),
  constraint discovery_entity_stats_rating_bayesian_range
    check (rating_bayesian is null or rating_bayesian between 1 and 5)
);

create table if not exists public.discovery_entity_trend_snapshots (
  id uuid primary key default gen_random_uuid(),
  location_entity_id uuid not null references public.location_entities(id) on delete cascade,
  snapshot_date date not null default current_date,
  recent_rating_count integer not null default 0,
  recent_verified_visit_count integer not null default 0,
  recent_save_count integer not null default 0,
  hot_score numeric(8,4) not null default 0,
  created_at timestamptz not null default now(),
  constraint discovery_entity_trend_snapshots_unique unique (location_entity_id, snapshot_date)
);

create index if not exists discovery_entity_features_feature_review_idx
  on public.discovery_entity_features (feature_id, review_status, confidence_score desc);
create index if not exists discovery_entity_features_entity_review_idx
  on public.discovery_entity_features (location_entity_id, review_status);
create index if not exists discovery_entity_media_entity_review_idx
  on public.discovery_entity_media (location_entity_id, review_status, is_cover desc, sort_order);
create index if not exists discovery_entity_visits_entity_time_idx
  on public.discovery_entity_visits (location_entity_id, occurred_at desc);
create index if not exists discovery_entity_visits_user_time_idx
  on public.discovery_entity_visits (user_id, occurred_at desc);
create index if not exists discovery_entity_ratings_entity_idx
  on public.discovery_entity_ratings (location_entity_id, is_verified, rating);
create index if not exists discovery_entity_stats_hot_idx
  on public.discovery_entity_stats (hot_score desc, rating_bayesian desc nulls last);
create index if not exists discovery_entity_trend_snapshots_date_hot_idx
  on public.discovery_entity_trend_snapshots (snapshot_date desc, hot_score desc);

create or replace function public.refresh_discovery_entity_stats(p_location_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rating_count integer;
  v_verified_rating_count integer;
  v_rating_average numeric(3,2);
  v_rating_bayesian numeric(3,2);
  v_visit_count integer;
  v_verified_visit_count integer;
  v_save_count integer;
begin
  select
    count(*)::integer,
    count(*) filter (where is_verified)::integer,
    round(avg(rating)::numeric, 2)
  into v_rating_count, v_verified_rating_count, v_rating_average
  from public.discovery_entity_ratings
  where location_entity_id = p_location_entity_id;

  -- A conservative prior of 3.8 and 8 ratings prevents a handful of votes
  -- from immediately dominating public ranking.
  v_rating_bayesian := case
    when v_rating_count = 0 then null
    else round(((3.8 * 8 + coalesce(v_rating_average, 0) * v_rating_count) / (8 + v_rating_count))::numeric, 2)
  end;

  select
    count(*)::integer,
    count(*) filter (where verification_status = 'verified')::integer
  into v_visit_count, v_verified_visit_count
  from public.discovery_entity_visits
  where location_entity_id = p_location_entity_id;

  select count(*)::integer
  into v_save_count
  from public.discovery_entity_saves
  where location_entity_id = p_location_entity_id;

  insert into public.discovery_entity_stats (
    location_entity_id,
    rating_count,
    verified_rating_count,
    rating_average,
    rating_bayesian,
    visit_count,
    verified_visit_count,
    save_count,
    updated_at
  ) values (
    p_location_entity_id,
    v_rating_count,
    v_verified_rating_count,
    v_rating_average,
    v_rating_bayesian,
    v_visit_count,
    v_verified_visit_count,
    v_save_count,
    now()
  ) on conflict (location_entity_id) do update set
    rating_count = excluded.rating_count,
    verified_rating_count = excluded.verified_rating_count,
    rating_average = excluded.rating_average,
    rating_bayesian = excluded.rating_bayesian,
    visit_count = excluded.visit_count,
    verified_visit_count = excluded.verified_visit_count,
    save_count = excluded.save_count,
    updated_at = excluded.updated_at;
end;
$$;

create or replace function public.prepare_discovery_entity_rating()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.is_verified := exists (
    select 1
    from public.discovery_entity_visits v
    where v.location_entity_id = new.location_entity_id
      and v.user_id = new.user_id
      and v.verification_status = 'verified'
  );
  return new;
end;
$$;

create or replace function public.touch_discovery_entity_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.refresh_discovery_entity_stats(old.location_entity_id);
    return old;
  end if;

  perform public.refresh_discovery_entity_stats(new.location_entity_id);
  return new;
end;
$$;

-- These helpers run from table triggers only; they are not public RPCs.
revoke all on function public.refresh_discovery_entity_stats(uuid) from public, anon, authenticated;
revoke all on function public.prepare_discovery_entity_rating() from public, anon, authenticated;
revoke all on function public.touch_discovery_entity_stats() from public, anon, authenticated;

drop trigger if exists discovery_feature_catalog_touch_updated_at on public.discovery_feature_catalog;
create trigger discovery_feature_catalog_touch_updated_at
before update on public.discovery_feature_catalog
for each row execute function public.touch_updated_at();
drop trigger if exists discovery_entity_features_touch_updated_at on public.discovery_entity_features;
create trigger discovery_entity_features_touch_updated_at
before update on public.discovery_entity_features
for each row execute function public.touch_updated_at();
drop trigger if exists discovery_entity_media_touch_updated_at on public.discovery_entity_media;
create trigger discovery_entity_media_touch_updated_at
before update on public.discovery_entity_media
for each row execute function public.touch_updated_at();
drop trigger if exists discovery_entity_ratings_touch_updated_at on public.discovery_entity_ratings;
create trigger discovery_entity_ratings_touch_updated_at
before update on public.discovery_entity_ratings
for each row execute function public.touch_updated_at();
drop trigger if exists discovery_entity_ratings_prepare on public.discovery_entity_ratings;
create trigger discovery_entity_ratings_prepare
before insert or update on public.discovery_entity_ratings
for each row execute function public.prepare_discovery_entity_rating();
drop trigger if exists discovery_entity_ratings_refresh_stats on public.discovery_entity_ratings;
create trigger discovery_entity_ratings_refresh_stats
after insert or update or delete on public.discovery_entity_ratings
for each row execute function public.touch_discovery_entity_stats();
drop trigger if exists discovery_entity_visits_refresh_stats on public.discovery_entity_visits;
create trigger discovery_entity_visits_refresh_stats
after insert or update or delete on public.discovery_entity_visits
for each row execute function public.touch_discovery_entity_stats();
drop trigger if exists discovery_entity_saves_refresh_stats on public.discovery_entity_saves;
create trigger discovery_entity_saves_refresh_stats
after insert or delete on public.discovery_entity_saves
for each row execute function public.touch_discovery_entity_stats();

alter table public.discovery_feature_catalog enable row level security;
alter table public.discovery_entity_features enable row level security;
alter table public.discovery_entity_media enable row level security;
alter table public.discovery_entity_visits enable row level security;
alter table public.discovery_entity_ratings enable row level security;
alter table public.discovery_entity_saves enable row level security;
alter table public.discovery_entity_stats enable row level security;
alter table public.discovery_entity_trend_snapshots enable row level security;

create policy "active discovery features are readable"
on public.discovery_feature_catalog for select
using (is_active);
create policy "approved entity features are readable"
on public.discovery_entity_features for select
using (review_status = 'approved');
create policy "approved entity media is readable"
on public.discovery_entity_media for select
using (review_status = 'approved' and rights_status in ('owned', 'licensed', 'permission_granted'));
create policy "users read their own discovery visits"
on public.discovery_entity_visits for select to authenticated
using (user_id = auth.uid());
create policy "users add their own discovery visits"
on public.discovery_entity_visits for insert to authenticated
with check (user_id = auth.uid() and visit_source = 'self_report' and verification_status = 'unverified');
create policy "users read their own discovery ratings"
on public.discovery_entity_ratings for select to authenticated
using (user_id = auth.uid());
create policy "users add their own discovery ratings"
on public.discovery_entity_ratings for insert to authenticated
with check (user_id = auth.uid());
create policy "users update their own discovery ratings"
on public.discovery_entity_ratings for update to authenticated
using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "users delete their own discovery ratings"
on public.discovery_entity_ratings for delete to authenticated
using (user_id = auth.uid());
create policy "users read their own discovery saves"
on public.discovery_entity_saves for select to authenticated
using (user_id = auth.uid());
create policy "users add their own discovery saves"
on public.discovery_entity_saves for insert to authenticated
with check (user_id = auth.uid());
create policy "users remove their own discovery saves"
on public.discovery_entity_saves for delete to authenticated
using (user_id = auth.uid());
create policy "published entity stats are readable"
on public.discovery_entity_stats for select
using (exists (
  select 1 from public.location_entities le
  where le.id = discovery_entity_stats.location_entity_id
    and le.status = 'published'
));
create policy "published entity trends are readable"
on public.discovery_entity_trend_snapshots for select
using (exists (
  select 1 from public.location_entities le
  where le.id = discovery_entity_trend_snapshots.location_entity_id
    and le.status = 'published'
));

insert into public.discovery_feature_catalog (slug, label, category, synonyms, description)
values
  ('rooftop_view', 'Rooftop view', 'view', array['rooftop', 'skyline', 'terrace', 'view'], 'An approved rooftop, terrace, or skyline-view experience.'),
  ('waterfront', 'Waterfront', 'view', array['waterfront', 'lake view', 'harbour', 'harbor'], 'A place by or overlooking a waterfront.'),
  ('outdoor_seating', 'Outdoor seating', 'amenity', array['patio', 'terrace', 'outdoor dining'], 'Outdoor seating is available.'),
  ('live_sports', 'Live sports', 'sports', array['sports', 'game', 'match'], 'A live sporting event or venue.'),
  ('sports_viewing', 'Places to watch sports', 'sports', array['sports bar', 'watch game', 'game night'], 'A venue suitable for watching sports.'),
  ('sports_facility', 'Sports facility', 'sports', array['gym', 'arena', 'court', 'field'], 'A place for taking part in sports.'),
  ('date_night', 'Date night', 'occasion', array['date', 'romantic', 'couples'], 'Well suited to a date or evening out.'),
  ('family_friendly', 'Family friendly', 'occasion', array['family', 'kids', 'children'], 'Suitable for families.'),
  ('quiet', 'Quiet', 'vibe', array['quiet', 'calm', 'peaceful', 'low key'], 'Usually appropriate for a quieter outing.'),
  ('cozy', 'Cozy', 'vibe', array['cozy', 'warm', 'intimate'], 'A warm or intimate atmosphere.'),
  ('late_night', 'Late night', 'time', array['late', 'after hours', 'nightlife'], 'Relevant for late-evening plans.'),
  ('rainy_day', 'Rainy day', 'occasion', array['rain', 'indoors', 'indoor activity'], 'A suitable option in poor weather.'),
  ('indoor', 'Indoor', 'environment', array['inside', 'indoors'], 'An indoor experience.'),
  ('outdoor', 'Outdoor', 'environment', array['outside', 'outdoors'], 'An outdoor experience.'),
  ('live_music', 'Live music', 'entertainment', array['music', 'band', 'dj', 'concert'], 'Regular or scheduled live music.'),
  ('accessible', 'Accessible', 'access', array['wheelchair accessible', 'accessibility'], 'Accessibility is confirmed by an approved source.'),
  ('pet_friendly', 'Pet friendly', 'access', array['dogs', 'dog friendly', 'pets'], 'Pet access is confirmed by an approved source.'),
  ('city_view', 'City view', 'view', array['city view', 'downtown view', 'skyline'], 'A notable view over the city.'),
  ('lake_view', 'Lake view', 'view', array['lake view', 'water view'], 'A notable view of a lake or water.'),
  ('sunset_view', 'Sunset view', 'view', array['sunset', 'golden hour'], 'A place known for a sunset view.'),
  ('patio', 'Patio', 'amenity', array['patio', 'terrace', 'outdoor patio'], 'A dedicated patio is available.'),
  ('private_room', 'Private room', 'amenity', array['private dining', 'private room', 'event room'], 'A private room or bookable private space is available.'),
  ('reservations', 'Reservations', 'amenity', array['reserve', 'book a table', 'booking'], 'Reservations are supported or recommended.'),
  ('walk_in_friendly', 'Walk-in friendly', 'amenity', array['walk in', 'no reservation'], 'Walk-ins are generally possible.'),
  ('parking', 'Parking', 'amenity', array['parking', 'free parking', 'parking lot'], 'Parking is available or confirmed nearby.'),
  ('transit_nearby', 'Transit nearby', 'amenity', array['subway', 'ttc', 'go train', 'transit'], 'Convenient public transit access is confirmed.'),
  ('wifi', 'Wi-Fi', 'amenity', array['wifi', 'work from cafe', 'work friendly'], 'Wi-Fi is available.'),
  ('outlets', 'Power outlets', 'amenity', array['outlets', 'plug in', 'laptop friendly'], 'Power outlets are available for guests.'),
  ('alcohol_served', 'Alcohol served', 'food_drink', array['drinks', 'cocktails', 'wine', 'beer'], 'Alcohol service is confirmed.'),
  ('cocktails', 'Cocktails', 'food_drink', array['cocktail bar', 'mixed drinks'], 'Cocktail service is a meaningful part of the experience.'),
  ('brunch', 'Brunch', 'food_drink', array['brunch', 'weekend brunch'], 'Brunch is available or a known strength.'),
  ('desserts', 'Desserts', 'food_drink', array['dessert', 'sweet', 'bakery'], 'Desserts are a meaningful part of the offering.'),
  ('coffee', 'Coffee', 'food_drink', array['coffee', 'espresso', 'cafe'], 'Coffee is available or a known strength.'),
  ('vegetarian_options', 'Vegetarian options', 'dietary', array['vegetarian', 'veggie'], 'Vegetarian options are confirmed.'),
  ('vegan_options', 'Vegan options', 'dietary', array['vegan', 'plant based'], 'Vegan options are confirmed.'),
  ('halal_options', 'Halal options', 'dietary', array['halal'], 'Halal options are confirmed; this is not an inference.'),
  ('kosher_options', 'Kosher options', 'dietary', array['kosher'], 'Kosher options are confirmed; this is not an inference.'),
  ('gluten_aware', 'Gluten-aware options', 'dietary', array['gluten free', 'gluten aware'], 'Gluten-aware options are confirmed; this is not an allergy guarantee.'),
  ('romantic', 'Romantic', 'vibe', array['romantic', 'intimate', 'couples'], 'A romantic atmosphere is confirmed by an approved source.'),
  ('lively', 'Lively', 'vibe', array['lively', 'energetic', 'buzzy'], 'An energetic, social atmosphere.'),
  ('social', 'Social', 'vibe', array['social', 'meet people', 'group hang'], 'Well suited to social interaction or groups.'),
  ('upscale', 'Upscale', 'vibe', array['upscale', 'fancy', 'dress up'], 'A more polished or elevated experience.'),
  ('casual', 'Casual', 'vibe', array['casual', 'laid back', 'easy'], 'A casual, low-pressure experience.'),
  ('trendy', 'Trendy', 'vibe', array['trendy', 'popular', 'instagrammable'], 'A current, style-led experience.'),
  ('creative', 'Creative', 'vibe', array['creative', 'artsy', 'artistic'], 'An arts-oriented or creative atmosphere.'),
  ('first_date', 'First date', 'occasion', array['first date', 'date idea'], 'Well suited to a first date.'),
  ('group_hang', 'Group hang', 'occasion', array['friends', 'group', 'birthday'], 'Well suited to groups or a group celebration.'),
  ('solo_friendly', 'Solo friendly', 'occasion', array['solo', 'alone', 'by myself'], 'Comfortable for a solo visit.'),
  ('work_friendly', 'Work friendly', 'occasion', array['work', 'study', 'laptop'], 'Suitable for work or study.'),
  ('celebration', 'Celebration', 'occasion', array['celebrate', 'anniversary', 'birthday'], 'Suitable for a celebration.'),
  ('after_work', 'After work', 'occasion', array['after work', 'happy hour'], 'A practical after-work option.'),
  ('weekend_activity', 'Weekend activity', 'occasion', array['weekend', 'saturday', 'sunday'], 'Well suited to a weekend plan.'),
  ('late_open', 'Open late', 'time', array['open late', 'late night', 'after midnight'], 'Late hours are confirmed separately and must remain fresh.'),
  ('morning', 'Morning', 'time', array['morning', 'breakfast', 'early'], 'Well suited to a morning visit.'),
  ('lunch', 'Lunch', 'time', array['lunch', 'midday'], 'A good or available lunch option.'),
  ('dinner', 'Dinner', 'time', array['dinner', 'evening meal'], 'A good or available dinner option.'),
  ('today', 'Today', 'time', array['today', 'tonight', 'now'], 'Relevant to a current-time search when availability supports it.'),
  ('free', 'Free', 'price', array['free', 'no cost'], 'No-cost entry or activity, subject to current availability.'),
  ('budget_friendly', 'Budget friendly', 'price', array['cheap', 'affordable', 'on a budget'], 'A comparatively budget-friendly option.'),
  ('splurge', 'Splurge', 'price', array['splurge', 'treat yourself', 'expensive'], 'A premium-price experience.'),
  ('museum', 'Museum', 'activity', array['museum', 'exhibit', 'exhibition'], 'A museum or exhibit experience.'),
  ('gallery', 'Gallery', 'activity', array['gallery', 'art gallery', 'art show'], 'A gallery or art-viewing experience.'),
  ('cinema', 'Cinema', 'activity', array['movie', 'film', 'cinema'], 'A cinema or film experience.'),
  ('comedy', 'Comedy', 'activity', array['comedy', 'standup', 'stand-up'], 'A comedy experience or event.'),
  ('theatre', 'Theatre', 'activity', array['theatre', 'theater', 'play', 'musical'], 'A theatre or performance experience.'),
  ('festival', 'Festival', 'activity', array['festival', 'fair', 'market'], 'A festival, fair, or market experience.'),
  ('nightlife', 'Nightlife', 'activity', array['nightlife', 'club', 'party'], 'A nightlife experience.'),
  ('karaoke', 'Karaoke', 'activity', array['karaoke', 'singing'], 'Karaoke is available.'),
  ('games', 'Games', 'activity', array['arcade', 'board games', 'gaming'], 'Games are a meaningful part of the experience.'),
  ('fitness', 'Fitness', 'activity', array['fitness', 'workout', 'gym'], 'A fitness-oriented activity.'),
  ('hiking', 'Hiking', 'activity', array['hike', 'hiking', 'trail walk'], 'A hiking or longer trail experience.'),
  ('cycling', 'Cycling', 'activity', array['bike', 'cycling'], 'A cycling-friendly activity or route.'),
  ('water_activity', 'Water activity', 'activity', array['kayak', 'canoe', 'paddle', 'beach'], 'A water-oriented activity.'),
  ('shopping', 'Shopping', 'activity', array['shopping', 'shops', 'mall'], 'A shopping destination or experience.'),
  ('market', 'Market', 'activity', array['market', 'farmers market', 'night market'], 'A market experience.'),
  ('arts_crafts', 'Arts and crafts', 'activity', array['craft', 'painting', 'pottery', 'workshop'], 'A creative hands-on activity.'),
  ('scenic_walk', 'Scenic walk', 'activity', array['scenic walk', 'stroll', 'walk'], 'A walk with a notable setting or route.'),
  ('kid_friendly', 'Kid friendly', 'access', array['kids', 'children', 'toddlers'], 'Suitable for children; age-specific rules require confirmation.'),
  ('all_ages', 'All ages', 'access', array['all ages', 'everyone'], 'Appropriate for broad age groups.'),
  ('lgbtq_welcoming', 'LGBTQ+ welcoming', 'access', array['lgbtq', 'queer friendly'], 'Only applied with a credible approved source.'),
  ('black_owned', 'Black-owned', 'identity', array['black owned', 'black-owned'], 'Only applied with venue or credible owner confirmation.'),
  ('women_owned', 'Women-owned', 'identity', array['women owned', 'woman owned'], 'Only applied with venue or credible owner confirmation.'),
  ('local_owned', 'Local independent', 'identity', array['local', 'independent', 'small business'], 'Only applied with credible ownership confirmation.')
on conflict (slug) do update set
  label = excluded.label,
  category = excluded.category,
  synonyms = excluded.synonyms,
  description = excluded.description,
  is_active = true,
  updated_at = now();
