-- Culture Lens: a consent-led, extensible cultural discovery layer.
--
-- Nationality and heritage fields are deliberately not used as an automatic
-- targeting rule. A user creates a lens explicitly; onboarding data may only
-- be used by the client to suggest a starting point for that choice.

create table if not exists public.culture_catalog (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  short_label text,
  description text,
  kind text not null default 'culture',
  parent_id uuid references public.culture_catalog(id) on delete set null,
  aliases text[] not null default '{}',
  search_terms text[] not null default '{}',
  sort_order integer not null default 100,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint culture_catalog_slug_format check (slug ~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'),
  constraint culture_catalog_kind_check check (kind in ('culture', 'region', 'language', 'community')),
  constraint culture_catalog_label_length check (char_length(label) between 2 and 80),
  constraint culture_catalog_search_terms_limit check (cardinality(search_terms) <= 12)
);

-- A culture tag is a reviewed, evidence-backed assertion about a place or
-- event. It is intentionally separate from free-form provider categories.
create table if not exists public.culture_entity_tags (
  id uuid primary key default gen_random_uuid(),
  location_entity_id uuid not null references public.location_entities(id) on delete cascade,
  culture_id uuid not null references public.culture_catalog(id) on delete cascade,
  source_type text not null,
  source_reference text,
  confidence_score numeric(4,3) not null default 0.500,
  review_status public.review_status not null default 'pending',
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint culture_entity_tags_source_check check (source_type in ('echoo_editorial', 'venue_claim', 'partner', 'open_data', 'user_submission')),
  constraint culture_entity_tags_confidence_check check (confidence_score between 0 and 1),
  constraint culture_entity_tags_unique unique (location_entity_id, culture_id)
);

-- A lens is private preference data. `relationship` describes why somebody
-- wants the lens, not an inferred identity, and is never exposed publicly.
create table if not exists public.user_culture_lenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  culture_id uuid not null references public.culture_catalog(id) on delete cascade,
  relationship text not null default 'interested',
  focus_topics text[] not null default '{}',
  is_enabled boolean not null default true,
  consented_at timestamptz not null default now(),
  selection_source text not null default 'user_selected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_culture_lenses_relationship_check check (relationship in ('heritage', 'language', 'community', 'interested')),
  constraint user_culture_lenses_topics_check check (focus_topics <@ array['food', 'music', 'events', 'businesses', 'film', 'community']::text[]),
  constraint user_culture_lenses_source_check check (selection_source in ('user_selected', 'onboarding_suggestion', 'profile_suggestion')),
  constraint user_culture_lenses_unique unique (user_id, culture_id)
);

-- A small, user-owned feedback stream is enough to improve ranking without
-- retaining a shadow identity profile. External item IDs are stored only when
-- a user intentionally saves or dismisses a live provider result.
create table if not exists public.user_culture_lens_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  culture_id uuid not null references public.culture_catalog(id) on delete cascade,
  location_entity_id uuid references public.location_entities(id) on delete cascade,
  external_entity_id text,
  signal text not null,
  created_at timestamptz not null default now(),
  constraint user_culture_lens_feedback_signal_check check (signal in ('saved', 'not_interested')),
  constraint user_culture_lens_feedback_target_check check (
    location_entity_id is not null or nullif(trim(external_entity_id), '') is not null
  )
);

create index if not exists culture_catalog_active_order_idx
  on public.culture_catalog (is_active, sort_order, label);
create index if not exists culture_entity_tags_culture_review_idx
  on public.culture_entity_tags (culture_id, review_status, confidence_score desc);
create index if not exists culture_entity_tags_entity_review_idx
  on public.culture_entity_tags (location_entity_id, review_status);
create index if not exists user_culture_lenses_user_enabled_idx
  on public.user_culture_lenses (user_id, is_enabled, updated_at desc);
create index if not exists user_culture_lens_feedback_user_culture_idx
  on public.user_culture_lens_feedback (user_id, culture_id, created_at desc);

drop trigger if exists culture_catalog_touch_updated_at on public.culture_catalog;
create trigger culture_catalog_touch_updated_at
before update on public.culture_catalog
for each row execute function public.touch_updated_at();

drop trigger if exists culture_entity_tags_touch_updated_at on public.culture_entity_tags;
create trigger culture_entity_tags_touch_updated_at
before update on public.culture_entity_tags
for each row execute function public.touch_updated_at();

drop trigger if exists user_culture_lenses_touch_updated_at on public.user_culture_lenses;
create trigger user_culture_lenses_touch_updated_at
before update on public.user_culture_lenses
for each row execute function public.touch_updated_at();

alter table public.culture_catalog enable row level security;
alter table public.culture_entity_tags enable row level security;
alter table public.user_culture_lenses enable row level security;
alter table public.user_culture_lens_feedback enable row level security;

drop policy if exists "active culture catalogue is readable" on public.culture_catalog;
create policy "active culture catalogue is readable"
on public.culture_catalog for select
using (is_active);

drop policy if exists "approved culture tags are readable" on public.culture_entity_tags;
create policy "approved culture tags are readable"
on public.culture_entity_tags for select
using (review_status = 'approved');

drop policy if exists "users read own culture lenses" on public.user_culture_lenses;
create policy "users read own culture lenses"
on public.user_culture_lenses for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "users create own culture lenses" on public.user_culture_lenses;
create policy "users create own culture lenses"
on public.user_culture_lenses for insert to authenticated
with check (auth.uid() = user_id and selection_source in ('user_selected', 'onboarding_suggestion', 'profile_suggestion'));

drop policy if exists "users update own culture lenses" on public.user_culture_lenses;
create policy "users update own culture lenses"
on public.user_culture_lenses for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "users remove own culture lenses" on public.user_culture_lenses;
create policy "users remove own culture lenses"
on public.user_culture_lenses for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists "users read own culture lens feedback" on public.user_culture_lens_feedback;
create policy "users read own culture lens feedback"
on public.user_culture_lens_feedback for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "users add own culture lens feedback" on public.user_culture_lens_feedback;
create policy "users add own culture lens feedback"
on public.user_culture_lens_feedback for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists "users remove own culture lens feedback" on public.user_culture_lens_feedback;
create policy "users remove own culture lens feedback"
on public.user_culture_lens_feedback for delete to authenticated
using (auth.uid() = user_id);

-- Owned inventory is always preferred. The API falls back to providers only
-- when this reviewed catalogue does not yet cover a user’s selected lens.
create or replace function public.culture_lens_owned_discovery(
  p_culture_slugs text[],
  p_city text default null,
  p_limit integer default 24
)
returns table (
  id uuid,
  title text,
  category text,
  description text,
  image_url text,
  starts_at timestamptz,
  city text,
  latitude double precision,
  longitude double precision,
  culture_slug text,
  culture_label text,
  confidence_score numeric,
  rank_score numeric
)
language sql
stable
set search_path = public
as $$
  select
    entity.id,
    entity.title,
    coalesce(entity.category, entity.entity_type),
    coalesce(entity.description, ''),
    entity.image_url,
    entity.starts_at,
    entity.city,
    entity.latitude,
    entity.longitude,
    culture.slug,
    culture.label,
    tag.confidence_score,
    (
      tag.confidence_score * 0.46
      + least(entity.popularity_score, 1) * 0.18
      + least(entity.availability_score, 1) * 0.14
      + least(entity.trust_score, 1) * 0.14
      + least(entity.editorial_boost, 1) * 0.08
    )::numeric(8,4) as rank_score
  from public.location_entities entity
  join public.culture_entity_tags tag
    on tag.location_entity_id = entity.id
   and tag.review_status = 'approved'
  join public.culture_catalog culture
    on culture.id = tag.culture_id
   and culture.is_active
  where entity.status = 'published'
    and entity.country_code = 'CA'
    and entity.admin_area_1 = 'ON'
    and (entity.starts_at is null or entity.starts_at >= now() - interval '3 hours')
    and culture.slug = any(p_culture_slugs)
    and (p_city is null or lower(entity.city) = lower(trim(p_city)))
  order by rank_score desc, entity.starts_at asc nulls last, entity.updated_at desc
  limit least(greatest(p_limit, 1), 80);
$$;

revoke all on function public.culture_lens_owned_discovery(text[], text, integer)
  from public, anon, authenticated;
grant execute on function public.culture_lens_owned_discovery(text[], text, integer)
  to service_role;

-- Initial catalogue entries are intentionally broad, editable discovery
-- starting points. New entries can be added in data, not code, as Echoo
-- launches in new cities and works with additional communities.
insert into public.culture_catalog (slug, label, kind, aliases, search_terms, sort_order) values
  ('arab', 'Arab', 'region', array['Arabic'], array['Arab', 'Arabic'], 10),
  ('armenian', 'Armenian', 'culture', array['Armenia'], array['Armenian'], 20),
  ('bengali', 'Bengali', 'language', array['Bangla', 'Bengali speaking'], array['Bengali', 'Bangla'], 30),
  ('brazilian', 'Brazilian', 'culture', array['Brazil'], array['Brazilian', 'Brazil'], 40),
  ('caribbean', 'Caribbean', 'region', array['West Indian'], array['Caribbean', 'West Indian'], 50),
  ('chinese', 'Chinese', 'culture', array['China', 'Chinese Canadian'], array['Chinese', 'Cantonese', 'Mandarin'], 60),
  ('ethiopian', 'Ethiopian', 'culture', array['Ethiopia', 'Amharic'], array['Ethiopian', 'Amharic'], 70),
  ('filipino', 'Filipino', 'culture', array['Philippine', 'Tagalog'], array['Filipino', 'Philippine', 'Tagalog'], 80),
  ('french', 'French-speaking', 'language', array['Francophone', 'French Canadian'], array['French', 'Francophone'], 90),
  ('greek', 'Greek', 'culture', array['Greece'], array['Greek'], 100),
  ('gujarati', 'Gujarati', 'language', array['Gujarat'], array['Gujarati'], 110),
  ('haitian', 'Haitian', 'culture', array['Haiti', 'Haitian Creole'], array['Haitian', 'Haitian Creole'], 120),
  ('igbo', 'Igbo', 'language', array['Igbo Nigerian'], array['Igbo'], 130),
  ('iranian', 'Iranian', 'culture', array['Persian', 'Iran'], array['Iranian', 'Persian'], 140),
  ('italian', 'Italian', 'culture', array['Italy'], array['Italian'], 150),
  ('jamaican', 'Jamaican', 'culture', array['Jamaica'], array['Jamaican'], 160),
  ('japanese', 'Japanese', 'culture', array['Japan'], array['Japanese'], 170),
  ('jewish', 'Jewish', 'community', array['Jewish culture'], array['Jewish'], 180),
  ('korean', 'Korean', 'culture', array['Korea'], array['Korean'], 190),
  ('latin_american', 'Latin American', 'region', array['Latino', 'Latina', 'Latinx'], array['Latin American', 'Latino', 'Latina'], 200),
  ('lebanese', 'Lebanese', 'culture', array['Lebanon'], array['Lebanese'], 210),
  ('mexican', 'Mexican', 'culture', array['Mexico'], array['Mexican'], 220),
  ('nigerian', 'Nigerian', 'culture', array['Nigeria'], array['Nigerian'], 230),
  ('pakistani', 'Pakistani', 'culture', array['Pakistan'], array['Pakistani'], 240),
  ('persian', 'Persian', 'culture', array['Farsi'], array['Persian', 'Farsi'], 250),
  ('polish', 'Polish', 'culture', array['Poland'], array['Polish'], 260),
  ('punjabi', 'Punjabi', 'language', array['Punjab'], array['Punjabi'], 270),
  ('somali', 'Somali', 'culture', array['Somalia'], array['Somali'], 280),
  ('south_asian', 'South Asian', 'region', array['Desi'], array['South Asian', 'Desi'], 290),
  ('spanish_speaking', 'Spanish-speaking', 'language', array['Spanish'], array['Spanish'], 300),
  ('tamil', 'Tamil', 'language', array['Tamil speaking'], array['Tamil'], 310),
  ('turkish', 'Turkish', 'culture', array['Turkey', 'Türkiye'], array['Turkish'], 320),
  ('ukrainian', 'Ukrainian', 'culture', array['Ukraine'], array['Ukrainian'], 330),
  ('vietnamese', 'Vietnamese', 'culture', array['Vietnam'], array['Vietnamese'], 340),
  ('west_african', 'West African', 'region', array['West Africa'], array['West African'], 350),
  ('yoruba', 'Yoruba', 'language', array['Yoruba Nigerian'], array['Yoruba'], 360)
on conflict (slug) do update set
  label = excluded.label,
  kind = excluded.kind,
  aliases = excluded.aliases,
  search_terms = excluded.search_terms,
  sort_order = excluded.sort_order,
  is_active = true;
