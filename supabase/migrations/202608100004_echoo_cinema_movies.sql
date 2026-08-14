-- ──────────────────────────────────────────────
-- Echoo Cinema — Movies & Trailers
-- Stores movie metadata + trailer YouTube IDs synced from TMDB.
-- Serves the films.html cinema page and the Discover "Now Showing" rail.
-- ──────────────────────────────────────────────

create table if not exists public.movies (
  id                  uuid primary key default gen_random_uuid(),
  tmdb_id             bigint not null,
  imdb_id             text,
  title               text not null,
  original_title      text,
  overview            text,
  poster_path         text,
  backdrop_path       text,
  trailer_youtube_id  text,
  trailer_source      text not null default 'tmdb',
  trailer_is_official boolean not null default false,
  release_date        date,
  vote_average        numeric(3,1) not null default 0,
  vote_count          integer not null default 0,
  genres              text[] not null default '{}',
  genre_ids           integer[] not null default '{}',
  runtime_minutes     integer,
  certification       text,  -- MPAA/Canadian rating when available
  status              text not null default 'released',
  curated_copy        text,
  curated_mood        text,
  is_date_night_pick  boolean not null default false,
  region              text not null default 'CA',
  popularity          numeric(10,3) not null default 0,
  fetched_at          timestamptz not null default now(),
  expires_at          timestamptz,

  constraint movies_tmdb_id_unique unique (tmdb_id)
);

-- Fast lookups by rail (status) and by TMDB id
create index if not exists movies_status_popularity_idx
  on public.movies (status, popularity desc);

create index if not exists movies_tmdb_id_idx
  on public.movies (tmdb_id);

create index if not exists movies_release_date_idx
  on public.movies (release_date desc);

create index if not exists movies_date_night_idx
  on public.movies (is_date_night_pick)
  where is_date_night_pick = true;

-- ── Row Level Security ──
-- The catalog is public-read (trailers are promotional, freely distributable).
-- Writes are service-role only (the tmdb-ingest edge function).

alter table public.movies enable row level security;

drop policy if exists "anyone can read movies"
  on public.movies;
create policy "anyone can read movies"
on public.movies
for select
using (true);

-- No insert/update/delete policies → only service role can mutate.

-- ──────────────────────────────────────────────
-- Updated_at trigger (for future cache diagnostics)
-- ──────────────────────────────────────────────
create or replace function public.touch_movies_fetched_at()
returns trigger
language plpgsql
as $$
begin
  new.fetched_at := now();
  return new;
end;
$$;

drop trigger if exists trg_movies_touch_fetched_at on public.movies;
create trigger trg_movies_touch_fetched_at
  before update on public.movies
  for each row
  execute function public.touch_movies_fetched_at();
