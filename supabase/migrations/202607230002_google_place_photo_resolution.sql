-- Google permits persistent storage of place IDs. Photo metadata and media are
-- intentionally not stored; those are requested live for the open sheet.
alter table public.canonical_places
  add column if not exists google_place_id text,
  add column if not exists google_place_matched_at timestamptz;

create unique index if not exists canonical_places_google_place_id_idx
  on public.canonical_places (google_place_id)
  where google_place_id is not null;
