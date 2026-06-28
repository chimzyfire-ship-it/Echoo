# Echoo Current Context

Last updated: 2026-06-27

## Purpose

This file exists so future Codex threads can stay coherent without relying on hidden memory. Read it first when continuing Echoo work.

## Current Strategic Direction

Echoo is moving from a generic AI chat/planner prototype into an Ontario-first local intelligence system.

The key product rule:

> AI should enrich and explain retrieved Echoo records. AI should not invent local facts.

Ontario-wide coverage is the target. GTA/Markham is the first quality bar.

## Canonical Planning Document

Use `docs/ontario-intelligence-implementation-plan.md` as the implementation source of truth for:

- Ontario database design
- free/open data strategy
- ingestion
- AI enrichment
- retrieval-first chat
- admin review
- rollout timeline

## Existing Architecture To Preserve

Do not restart from scratch. Build on:

- Supabase Postgres + PostGIS
- `supported_regions`
- `canonical_places`
- `location_entities`
- `location-search`
- `plan-engine`
- `discover-live`
- `admin-locations.html`

Important docs:

- `docs/echoo-engineering-documentation.md`
- `docs/echoo-project-roadmap.md`
- `docs/geolocation-mapping-scale-plan.md`
- `docs/ontario-intelligence-implementation-plan.md`

Important migration:

- `supabase/migrations/202606200001_location_platform.sql`

## Recent UI Work

`app.html` chat UI was redesigned recently:

- body scroll is locked while chat is open
- chat overlay owns scroll
- route plans render as a route board with square cards
- route board uses SVG connector lines

If working on chat coherence, prefer backend/data fixes over more visual polish.

## Current Product Problem

The chat can still feel incoherent because local questions may be handled like raw AI chat instead of retrieval-grounded local intelligence.

Target flow:

```text
user query
-> intent/place/city resolution
-> Ontario database retrieval
-> deterministic ranking
-> grounded AI response
-> structured cards/route board
```

## Next Recommended Work

1. Review/apply `supabase/migrations/202606260001_ontario_intelligence.sql`.
2. Review/apply `supabase/migrations/202606260002_ontario_scope_and_place_foundation.sql`.
3. Add a small Markham/Toronto seed set for validation.
4. Build `place-detail`.
5. Build `ontario-search`.
6. Build `ontario-plan`.
7. Modify planner/chat so local/place questions use retrieval first.
8. Extend `admin-locations.html` for AI profile review and confidence cleanup.

## Ontario Intelligence Phase Status

Phase 0/1 is verified on the linked Supabase project `Echoo`
(`dlezregdjpdqmooubwvl`) as of 2026-06-26.

Implemented in `202606260001_ontario_intelligence.sql`:

- `place_profiles`
- `place_sources`
- `place_hours`
- `ontario_events`
- `ai_enrichment_jobs`
- `zero_result_queries`
- baseline indexes and public read policies

Implemented in `202606260002_ontario_scope_and_place_foundation.sql`:

- Ontario province-wide active support row
- Tier 1 Ontario launch-density city rows
- `places`, `lunch`, and `nightlife` feature flags
- richer `canonical_places` columns for name, category, municipality, source, website, phone, and freshness
- canonical place normalization trigger
- Ontario support helper function
- first `search_ontario_places` database function

Verification completed on the linked remote database:

- `202606260001` and `202606260002` are present in remote migration history
- Supabase schema lint passes with `--fail-on warning`
- Supabase security/performance advisors report no issues
- required Phase 0 tables exist
- required Phase 1 canonical place columns exist
- `normalize_place_name`, `ontario_region_support`, and `search_ontario_places` exist
- Ontario province row plus 20 Tier 1 city rows exist
- public read policies exist for place profiles/sources/hours/events
- rollback-only smoke insert verified the canonical place trigger
- rollback-only smoke search verified `search_ontario_places`

Compatibility fixes made during verification:

- PostGIS calls in `search_ontario_places` are schema-qualified under `extensions`
- trigram `%` operator is schema-qualified under `extensions`
- `202606260004_verification_hardening.sql` removes unrelated RLS/function lint noise

Phase 1 API foundation is also deployed and smoke-tested:

- `supabase/functions/ontario-search`
- `supabase/functions/place-detail`

Both were deployed to the linked Supabase project with `supabase functions
deploy <name> --use-api`, which avoids Docker on the local Mac. Remote smoke
tests verified:

- CORS preflight for `ontario-search`
- valid empty `ontario-search` response before Ontario data import
- successful `ontario-search` retrieval of a temporary published Markham place
- controlled `place-detail` 404 for a missing place
- successful `place-detail` retrieval of a temporary place with profile, hours,
  and source data
- temporary smoke rows and zero-result test logs were cleaned up afterward

Phase 2 Ontario data ingestion is now built at the repository level.

Implemented in `202606260003_ontario_ingestion_workers.sql`:

- `ontario_ingestion_runs` audit table
- source/status enums for ingestion runs
- indexes for worker history and place/event mirrors

Implemented as service-role ingestion workers:

- `supabase/functions/ontario-osm-import`
- `supabase/functions/ontario-open-data-import`
- `supabase/functions/ticketmaster-ontario-ingest`
- `supabase/functions/echoo-partner-import`
- shared normalization in `supabase/functions/_shared/ontario-ingestion.ts`

Important: ingestion workers are not user-facing request handlers. Call them
from scheduled jobs, admin tooling, or one-off import runs with
`ONTARIO_INGESTION_SECRET`/`x-ingestion-secret` configured.

Phase 2 worker deployment status as of 2026-06-27:

- `ontario-osm-import` deployed and active
- `ontario-open-data-import` deployed and active
- `echoo-partner-import` deployed and active
- `ticketmaster-ontario-ingest` deployed and active
- deployed with `supabase functions deploy <name> --use-api`
- `ONTARIO_INGESTION_SECRET` is configured on the linked Supabase project
- `TICKETMASTER_API_KEY` is configured on the linked Supabase project

Remote smoke tests completed:

- OSM worker imported one synthetic Markham cafe into `canonical_places` and
  `location_entities`
- open-data worker imported one synthetic Markham park into `canonical_places`
  and `location_entities`
- partner worker imported one synthetic Markham restaurant into
  `canonical_places` and `location_entities`
- synthetic smoke records were deleted after verification
- worker run history remains in `ontario_ingestion_runs`
- Ticketmaster worker ran a Toronto/music smoke query successfully
- Ticketmaster worker was tightened to skip stale events and low-quality
  package/pass/parking/add-on records before import

Phase 2 validation dataset status as of 2026-06-27:

- `supabase/seed-data/ontario-validation-places.json` contains 20 validation
  places across Markham and Toronto
- imported through deployed `echoo-partner-import` with source
  `echoo_validation_seed`
- all 20 records exist in `canonical_places`
- all 20 records are mirrored into `location_entities`
- all 20 records have approved `place_profiles` with baseline vibe tags,
  good-for tags, and lunch/date/group/family/rainy-day scores
- remote `ontario-search` smoke test for `lunch Markham` returns Markham
  restaurants/cafes with profile scores
- remote `ontario-search` smoke test for `museum Toronto` returns AGO and ROM
- remote `place-detail` smoke test for JOEY Markville returns place, profile,
  source, and alternatives
- `ontario-search` was updated and redeployed to infer category buckets from
  broad intent/query text instead of treating phrases like `lunch Markham` as
  literal name searches

Province-scale OSM import status as of 2026-06-27:

- GitHub Actions workflow `Ontario OSM Convert And Import` is live on `main`.
- Repository secret `ONTARIO_INGESTION_SECRET` is configured for GitHub Actions
  and matches the linked Supabase project secret.
- Workflow run `28301745467` completed successfully against the real Geofabrik
  Ontario extract after the importer was made smaller-chunk and resumable.
- The workflow downloaded a 922 MB Ontario `.osm.pbf`, converted it to a
  37,610-line OSM POI artifact, and submitted the converted records to
  `ontario-osm-import`.
- First run imported offset `0` before the original 1,000-record chunks hit Edge
  Function resource limits. The resumed successful run used 100-record chunks
  with `OSM_IMPORT_START_OFFSET=1000` and processed through source record
  `37,610`.
- `scripts/import-ontario-osm-chunks.mjs` now supports GeoJSON text sequence
  record separators, true offset forwarding, `OSM_IMPORT_START_OFFSET`, and
  defaults to 100-record chunks.

Phase 3 enrichment status as of 2026-06-27:

- `supabase/functions/place-enrich` is implemented and deployed as a secured
  worker/admin endpoint with `verify_jwt = false` and
  `ONTARIO_INGESTION_SECRET`/`x-ingestion-secret` authorization.
- The first version is deterministic/profile-rule based rather than generative:
  it builds Echoo `place_profiles` from verified place category, source,
  municipality, address, website, and confidence signals.
- It writes `ai_enrichment_jobs` audit rows with input hashes, status, model
  label `echoo-deterministic-profile-v1`, output JSON, and completion/error
  state.
- It supports `placeId`, `municipality`, `category`, `limit`,
  `includeExisting`, and `dryRun` payload controls.
- Smoke tests on the deployed function verified:
  - Markham dry-run profile generation returned category-aware tags and scores.
  - A real Markham batch enriched 5 places and wrote approved profiles for Smash
    Kitchen and Bar, Inspire Restaurant, Folco's Ristorante, Platform Espresso
    Bar, and JOEY Markville.
  - A real `historic` category batch enriched 2 OSM places with lower
    confidence and `needs_update` review status, proving the profile review
    queue path has live records.

Phase 3A enrichment runner hardening as of 2026-06-28:

- `place-enrich` now has broader deterministic category templates for imported
  Ontario records, including `fast_food`, `pub`, `cinema`, `arts_centre`,
  `attraction`, `historic`, `mall`, `fitness_centre`, and `nature_reserve`.
- `place-enrich` now supports batch pagination and filters:
  `categories`, `sourceProvider`, `offset`, `limit`, `includeExisting`, and
  `dryRun`.
- Profile job auditing now writes `place_profile_v2` jobs with model label
  `echoo-deterministic-profile-v2` so the richer template pass is distinct from
  earlier v1 smoke runs.
- `ontario-maintenance` now supports `action = "place_enrichment"` and invokes
  `place-enrich` through the canonical Supabase Functions URL.
- Migration `202606280001_place_enrichment_schedule.sql` adds the
  `ontario_place_enrichment` schedule row for small batch enrichment while Phase
  3 backfill is active.
- Deployed smoke tests verified:
  - direct `place-enrich` dry run for `cinema`, `arts_centre`, `historic`, and
    `mall` categories returned richer tags/scores.
  - `ontario-maintenance` successfully invoked `place-enrich` for a tiny real
    batch and enriched CF Markville plus a historic OSM record.

`ontario-plan` status as of 2026-06-27:

- implemented in `supabase/functions/ontario-plan`
- deployed with `supabase functions deploy ontario-plan --use-api`
- active on the linked Supabase project
- deterministic/retrieval-first: uses `canonical_places` + `place_profiles`
  through `search_ontario_places`; does not call an LLM or invent local facts
- returns a modern `{ data, error, meta }` envelope plus a compatibility payload
  under `data.compatibility`
- remote smoke test for `two stop lunch plan in Markham` returned a real
  restaurant + cafe route from validation records
- remote smoke test for `date route in Toronto with culture` returned a real
  restaurant + AGO + cafe route from validation records
- sparse fallback for `Thunder Bay` returns an honest no-records response
- broad-query cleanup was patched so connector words like `in` and `with` do
  not over-constrain retrieval

Planner/chat retrieval-first status as of 2026-06-27:

- `supabase/functions/plan-engine` detects Ontario local planning/place queries
  and calls `ontario-plan` before Gemini
- `plan-engine` returns the existing frontend-compatible shape for Ontario
  plans, with `ai.provider = "echoo-retrieval"`
- general non-local chat still falls back to Gemini
- `app.html` chat routing now sends Ontario planning prompts to `plan-engine`
  instead of `discover-live`, while explicit live/event prompts can still use
  `discover-live`
- production was redeployed to `https://echoocity.com`

Ontario scale-up ingestion status as of 2026-06-27:

- Broader Ticketmaster batch ran across Toronto, Markham, Mississauga,
  Hamilton, Ottawa, Kitchener, and London for music/sports/theatre/arts/family/
  comedy buckets.
- Ticketmaster imported 134 records in the first broader batch; one Kitchener
  arts request hit a 429. The worker now treats partial imports with imported
  records as completed while keeping error samples.
- Current `ontario_events` Ticketmaster counts: arts 15, comedy 14, music 35,
  sports 29.
- Current `location_entities` Ticketmaster mirror counts: arts 11, comedy 7,
  music 33, sports 29.
- Current verified canonical Ontario place count is 20,709: 20 approved
  Markham/Toronto validation places, 1,832 official Toronto open-data
  parks/recreation records, 101 Toronto library branches, 895 Toronto Cultural
  Hotspot points of interest, and 17,861 Toronto DineSafe food-premise records.
  All canonical rows are scoped to `admin_area_1 = 'ON'`.
- Official Toronto Open Data parks/recreation facilities were imported from the
  City of Toronto CKAN GeoJSON resource
  `parks-and-recreation-facilities-4326.geojson`.
- The open-data worker now supports `offset` + `maxRecords` chunking; the
  initial all-at-once Toronto import hit Supabase Edge compute limits, then the
  full dataset was imported successfully in chunks.
- Toronto parks/recreation import produced 1,832 unique canonical places,
  1,832 `location_entities` mirrors, and 1,832 `place_sources` rows.
- Toronto parks/recreation city/municipality values were normalized to
  `Toronto` after import because the source dataset does not include a city
  field.
- Toronto library branches imported successfully through the
  `toronto_libraries` preset: 101 physical library places imported from 112
  source rows.
- Toronto Cultural Hotspot points of interest imported successfully through the
  `toronto_cultural_hotspots` preset: 895 cultural POIs imported.
- Toronto DineSafe food premises imported successfully through the
  `toronto_dinesafe_food_premises` preset:
  - source feed total: 104,619 inspection rows
  - canonical DineSafe places now present: 17,861
  - initial 5,000-row chunks hit an Edge compute limit, then the import resumed
    with 1,000-row chunks and one 500-row retry after a transient fetch failure
  - repeated inspection rows were intentionally deduped by establishment ID
- Quality checks passed for validation + Toronto open-data place layers:
  duplicate source IDs = 0, missing mirrors = 0, bad coordinates = 0.
- `ontario-search` smoke test for `park Toronto` returns Toronto park records
  from the imported official dataset.
- Deployed API smoke tests on 2026-06-27 verified:
  - `ontario-search` returns High Park, Trinity Bellwoods, and official
    Toronto open-data parks for `park Toronto`.
  - `place-detail` returns High Park with approved profile, source provenance,
    and nearby official open-data alternatives.
  - `ontario-plan` returns a retrieval-first Toronto culture/date route from
    canonical places and profiles.
  - `plan-engine` routes `two stop lunch plan in Markham` through
    `ai.provider = "echoo-retrieval"` instead of raw Gemini.

OSM note:

- The local machine does not currently have OSM conversion tools such as
  `osmium`, `osmosis`, or `ogr2ogr`.
- Do not use Overpass for province-wide OSM bulk import.
- A repeatable `.osm.pbf` conversion path now exists without requiring those
  tools on this Mac:
  - `.github/workflows/ontario-osm-convert.yml` runs on Ubuntu, installs
    `osmium-tool`, downloads the Geofabrik Ontario extract by default,
    converts it to NDJSON, uploads the artifact, and can import the NDJSON
    chunks directly into Supabase.
  - `scripts/osm-pbf-to-ndjson.sh` performs the same conversion on any machine
    that has `osmium`.
  - `scripts/import-ontario-osm-chunks.mjs` uploads the NDJSON artifact to
    `ontario-osm-import` in chunks using Node. It now defaults to 100-record
    chunks, supports resume offsets, and retries transient import failures.
- `ontario-osm-import` now supports `offset` + `maxRecords` and reads GeoJSON
  point geometry from converted OSM records.
- Province-scale OSM should continue to run through GitHub Actions, not on the
  2015 MacBook Pro. The first real Ontario import path has been verified
  end-to-end with workflow run `28301745467`.

Ontario operations additions:

- `ontario-open-data-import` now has presets for official Toronto library
  branches, Cultural Hotspot points of interest, and DineSafe food premises.
  The DineSafe preset is chunk-safe through CKAN datastore paging and dedupes
  repeated inspection rows by source establishment ID.
- `202606260005_ontario_operations_queues.sql` adds worker schedule records,
  stale Ticketmaster event cleanup, duplicate candidate search, low-confidence
  profile queue, profile review, and merge functions.
- `location-review` now serves `places`, `duplicates`, `profiles`, and
  `schedules` queues and can approve profiles or merge duplicate places.
- `admin-locations.html` has been expanded into an Ontario operations console
  with tabs for those queues.
- `ontario-maintenance` provides a secured worker endpoint for scheduled
  Ticketmaster priority refreshes and stale-event cleanup.
- The admin/ingestion/maintenance functions are deployed with JWT verification
  disabled and guarded by `LOCATION_ADMIN_TOKEN` or `ONTARIO_INGESTION_SECRET`.
  This is recorded in `supabase/config.toml` under the relevant
  `[functions.*]` sections.
- The secured imports were run after rotating `ONTARIO_INGESTION_SECRET` and
  `LOCATION_ADMIN_TOKEN`; secret values were not printed or written to docs.
- `app.html` now treats Ontario retrieval stops as place records. Clicking a
  route stop opens inline verified place details from `place-detail` instead of
  incorrectly routing to `event.html`.

## Worktree Warning

The worktree has many modified files that may include user or previous generated work. Do not revert unrelated changes. Before editing a file, inspect it and keep changes scoped.

## Deployment Note

The project is linked to Vercel as `echoo-landing`. A forced production redeploy was successfully run on 2026-06-26 with:

```sh
vercel deploy --prod --force --yes
```

Production alias:

- `https://echoocity.com`

## Local Machine / Verification Strategy

The current local machine is an older Intel MacBook Pro on macOS 12.7.6.
Docker is not installed and should not be treated as the required happy path.

Recommended workflow moving forward:

- Use the linked Supabase remote database for migrations, lint, advisors, and
  SQL smoke tests.
- Use deployed Supabase Edge Functions for worker/API runtime testing.
- Install/use local Deno only when local formatting or type-checking is useful.
- Make a git commit before each migration/deploy batch so remote verification
  stays controlled and reversible.

Avoid making Docker Desktop a core requirement for this project unless there is
a specific task that cannot be verified through the remote Supabase project.
