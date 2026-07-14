# Echoo Ontario Intelligence Implementation Plan

Last updated: 2026-06-29

## 1. Decision

Echoo should build an Ontario-first local intelligence system, not a generic AI chat surface and not a Canada-wide scrape project on day one.

The product target is:

> Echoo owns a normalized Ontario place, event, and activity database; keeps it updated through ingestion and review; enriches records with AI; and makes the planner/chat answer only from retrieved local facts.

Ontario-wide coverage is the strategic goal. GTA and Markham should be the first quality bar because they are dense, demo-friendly, and relevant to the current lunch use case.

## 2. Why This Is Necessary

The chat currently feels incoherent because local questions can fall through to raw model behavior. A question like "is JOEY Markville nice?" should not be answered from general model memory. It should resolve the place, fetch Echoo's local facts and profile, check nearby/live context, and then generate a grounded answer.

The existing architecture already points in the right direction:

- `supported_regions` defines Canada/Ontario launch configuration.
- `canonical_places` stores normalized provider/manual places.
- `location_entities` stores searchable events, guides, movies, and local plans.
- PostGIS functions already support nearby and region search.
- The engineering documentation defines AI planning as retrieval, deterministic scoring, then LLM enrichment.

This plan extends those foundations instead of replacing them.

## 3. Existing Files To Read First

Anyone continuing this work in a new chat thread should read these files before editing:

- `docs/CURRENT_CONTEXT.md`
- `docs/echoo-engineering-documentation.md`
- `docs/echoo-project-roadmap.md`
- `docs/geolocation-mapping-scale-plan.md`
- `docs/ontario-intelligence-implementation-plan.md`
- `supabase/migrations/202606200001_location_platform.sql`
- `supabase/functions/location-search/index.ts`
- `supabase/functions/plan-engine/index.ts`
- `supabase/functions/discover-live/index.ts`

## 4. Data Source Strategy

### 4.1 Free/Open Foundation

Use free/open sources for the Ontario base layer:

- OpenStreetMap bulk extracts for restaurants, cafes, bars, parks, venues, cinemas, attractions, malls, community spaces, and other POIs.
- Ontario GeoHub and Ontario Data Catalogue for official provincial datasets.
- Statistics Canada boundary/geography files for municipality and region structure.
- Municipal open data portals for facilities, parks, recreation, cultural spaces, and other local assets.
- Ticketmaster Discovery API for live events where quota allows.

These are suitable for creating Echoo-owned normalized records, with attribution/licence handling.

### 4.2 Paid/Restricted Sources

Use paid or restricted APIs only as optional enrichment or validation:

- Google Places: useful for on-demand lookup/autocomplete and limited details, but not for copying into a permanent database.
- Yelp: useful for evaluation or paid/commercial enrichment, not a free production base.
- Foursquare: useful commercial POI enrichment, not required for the initial base.

Echoo should not depend on a paid places provider to know Ontario. Paid sources can improve quality later.

## 5. Ontario Coverage Model

Support all Ontario, but launch quality in tiers.

### Tier 1: Dense Quality Bar

- Toronto
- Markham
- Scarborough
- North York
- Vaughan
- Richmond Hill
- Mississauga
- Brampton
- Oakville
- Burlington
- Hamilton
- Ottawa
- Waterloo
- Kitchener
- London
- Niagara Falls
- Kingston
- Guelph
- Barrie
- Windsor

### Tier 2: Province-Wide Coverage

All other Ontario municipalities, towns, and activity areas.

### Tier 3: Sparse Coverage Fallback

Low-density regions where Echoo may have fewer records. The product must answer honestly, show confidence, and suggest nearby supported alternatives.

## 6. Database Implementation

Keep `canonical_places` as the master place table and `location_entities` as the searchable user-facing entity table. Add these tables.

Verification status as of 2026-06-27:

- Phase 0/1 migrations `202606260001` and `202606260002` are applied on the
  linked Supabase project `Echoo` (`dlezregdjpdqmooubwvl`).
- Linked database lint passes with `--fail-on warning`.
- Linked database security/performance advisors report no issues.
- A rollback-only smoke test verified canonical place normalization and
  `search_ontario_places`.
- `202606260004_verification_hardening.sql` fixes unrelated advisory noise in
  older auth RLS policies and the ticket confirmation function.
- Phase 1 foundation APIs `ontario-search` and `place-detail` are deployed with
  server-side Supabase bundling (`--use-api`) and remote smoke-tested.
- Public-schema lint currently reports `No schema errors found`.
- Supabase security/performance advisors currently report `No issues found`.
- All Ontario Edge Functions are active remotely:
  `ontario-search`, `place-detail`, `ontario-osm-import`,
  `ontario-open-data-import`, `echoo-partner-import`,
  `ticketmaster-ontario-ingest`, `ontario-plan`, and `plan-engine`.

### 6.1 `place_profiles`

Echoo's opinion and utility layer for a place.

Recommended columns:

- `id uuid primary key`
- `place_id uuid references canonical_places(id)`
- `vibe_tags text[]`
- `good_for text[]`
- `meal_tags text[]`
- `activity_tags text[]`
- `noise_level text`
- `price_band text`
- `lunch_score numeric`
- `date_score numeric`
- `group_score numeric`
- `solo_score numeric`
- `family_score numeric`
- `rainy_day_score numeric`
- `summary text`
- `caveats text`
- `confidence_score numeric`
- `human_review_status text`
- `ai_generated_at timestamptz`
- `reviewed_at timestamptz`
- `created_at timestamptz`
- `updated_at timestamptz`

### 6.2 `place_sources`

Provenance and licensing for each imported/enriched record.

Recommended columns:

- `id uuid primary key`
- `place_id uuid references canonical_places(id)`
- `source_name text`
- `source_url text`
- `source_license text`
- `source_record_id text`
- `raw_payload jsonb`
- `fetched_at timestamptz`
- `created_at timestamptz`

### 6.3 `place_hours`

Mutable place hours from providers or manual review.

Recommended columns:

- `id uuid primary key`
- `place_id uuid references canonical_places(id)`
- `day_of_week int`
- `opens_at time`
- `closes_at time`
- `is_closed boolean`
- `source text`
- `confidence_score numeric`
- `valid_from date`
- `valid_to date`
- `updated_at timestamptz`

### 6.4 `ontario_events`

Normalized external and Echoo-owned event layer.

Recommended columns:

- `id uuid primary key`
- `place_id uuid references canonical_places(id)`
- `title text`
- `description text`
- `starts_at timestamptz`
- `ends_at timestamptz`
- `category text`
- `price_label text`
- `ticket_url text`
- `source_provider text`
- `source_id text`
- `status text`
- `last_seen_at timestamptz`
- `created_at timestamptz`
- `updated_at timestamptz`

### 6.5 `ai_enrichment_jobs`

Tracks AI-generated enrichment and makes the process resumable.

Recommended columns:

- `id uuid primary key`
- `entity_type text`
- `entity_id uuid`
- `job_type text`
- `status text`
- `input_hash text`
- `model text`
- `output_json jsonb`
- `error text`
- `created_at timestamptz`
- `started_at timestamptz`
- `completed_at timestamptz`

### 6.6 `zero_result_queries`

Captures demand where Echoo lacks enough data.

Recommended columns:

- `id uuid primary key`
- `query text`
- `city text`
- `province text default 'ON'`
- `lat double precision`
- `lng double precision`
- `intent text`
- `result_count int`
- `created_at timestamptz`

## 7. Ingestion Pipeline

### 7.1 OSM Bulk Import

Do not use Overpass as the bulk source for the whole province. Use an Ontario or Canada OSM extract, then filter locally.

Initial tags:

- `amenity=restaurant`
- `amenity=cafe`
- `amenity=bar`
- `amenity=pub`
- `amenity=fast_food`
- `amenity=cinema`
- `amenity=theatre`
- `amenity=arts_centre`
- `amenity=community_centre`
- `tourism=attraction`
- `tourism=museum`
- `leisure=park`
- `leisure=fitness_centre`
- `shop=mall`
- `historic=*`

Normalize each accepted object into `canonical_places`, then create/searchable mirror records where appropriate in `location_entities`.

### 7.2 Official Open Data Import

Import Ontario and municipal public datasets for:

- municipalities and boundaries
- parks
- libraries
- recreation/community centres
- public facilities
- trails
- cultural spaces
- public attractions

Normalize into `canonical_places` and track each source in `place_sources`.

### 7.3 Live Event Import

Use Ticketmaster and Echoo-owned organizer data.

Schedule:

- Hourly for live events in priority cities.
- Daily for broader Ontario event refresh.
- Cleanup stale events nightly.

Events should be stored in `ontario_events` and mirrored into `location_entities` for search/planning.

### 7.4 Phase 2 Repository Implementation

Phase 2 ingestion workers are implemented as non-user-facing Supabase Edge
Functions. They should be called by scheduled jobs, admin tooling, or one-off
imports only.

Implemented workers:

- `ontario-osm-import`: accepts Ontario/Canada OSM extract records already
  converted to JSON, NDJSON, or GeoJSON. It filters locally for the approved
  POI tags and does not use Overpass as the province-wide bulk source.
- `ontario-open-data-import`: imports official Ontario/municipal open data
  records for parks, libraries, recreation/community centres, trails, cultural
  spaces, public facilities, and similar datasets. Payloads can provide field
  mappings per source.
- `ticketmaster-ontario-ingest`: runs Ontario city buckets against category
  buckets for music, sports, theatre, arts, family, and comedy, then stores
  normalized rows in `ontario_events` and mirrors cards into
  `location_entities`.
- `echoo-partner-import`: imports Echoo manual/partner records with higher
  confidence and editorial ranking signals.

Shared behavior lives in `supabase/functions/_shared/ontario-ingestion.ts`.
Worker runs are tracked in `ontario_ingestion_runs`, created by
`supabase/migrations/202606260003_ontario_ingestion_workers.sql`.

Deployment status as of 2026-06-27:

- all four ingestion workers are deployed and active on the linked Supabase
  project
- workers were deployed with `--use-api`, avoiding local Docker
- `ONTARIO_INGESTION_SECRET` is configured
- `TICKETMASTER_API_KEY` is configured
- OSM, open-data, and partner workers passed one-record remote smoke tests and
  mirrored records into `location_entities`
- Ticketmaster passed a remote API smoke test; stale/package-style records are
  filtered before import

Validation seed status as of 2026-06-27:

- `supabase/seed-data/ontario-validation-places.json` contains 20 validation
  records for Markham and Toronto
- records were imported through `echoo-partner-import` as
  `echoo_validation_seed`
- all records are present in `canonical_places`, mirrored into
  `location_entities`, and have approved baseline `place_profiles`
- `ontario-search` was redeployed with intent/category bucket handling for
  broad queries such as `lunch Markham` and `museum Toronto`
- remote smoke tests confirmed `ontario-search` and `place-detail` can retrieve
  the validation records with profile data

## 8. Dedupe And Normalization

Duplicates must be handled before AI enrichment.

Candidate match signals:

- normalized name similarity
- geographic distance within 50 meters
- same or similar address/postal code
- same phone or website
- same provider id

Suggested score:

```text
duplicate_score =
  name_similarity * 0.35 +
  distance_similarity * 0.30 +
  address_similarity * 0.20 +
  phone_or_website_match * 0.15
```

Actions:

- Auto-merge above `0.92`.
- Queue review between `0.75` and `0.92`.
- Keep separate below `0.75`.

## 9. AI Enrichment

AI enriches structured records. It does not invent facts.

Input should be structured:

```json
{
  "name": "JOEY Markville",
  "category": "restaurant",
  "city": "Markham",
  "province": "ON",
  "nearby_context": ["CF Markville", "Unionville", "Highway 7"],
  "source_tags": ["restaurant", "bar", "lunch"]
}
```

Output must be strict JSON:

```json
{
  "summary": "Polished Echoo description.",
  "vibe_tags": ["upbeat", "polished", "group-friendly"],
  "good_for": ["lunch", "after-work drinks", "casual date"],
  "not_ideal_for": ["quiet work session"],
  "lunch_score": 0.82,
  "date_score": 0.74,
  "group_score": 0.88,
  "confidence_score": 0.68,
  "needs_human_review": true
}
```

Rules:

- No fabricated hours.
- No fabricated specials.
- No fabricated ratings.
- No fabricated events.
- Low-confidence records go to admin review.
- AI outputs are stored with `input_hash`, `model`, and raw output in `ai_enrichment_jobs`.

## 10. Retrieval-First Chat Contract

The planner/chat must stop answering Ontario/place questions from raw model memory.

Target flow:

```text
user query
-> intent detection
-> city/place resolution
-> Ontario database retrieval
-> deterministic scoring
-> grounded AI response
-> cards/route board
```

Example for "is it nice chilling at JOEY Markville?":

1. Detect intent: place opinion, chill/lunch, Markham.
2. Resolve place: search `canonical_places`.
3. Fetch context: `place_profiles`, hours, nearby events, alternatives.
4. Generate answer with a prompt that says:

```text
Only answer using the provided Echoo records.
If records are missing, say what is missing.
Do not invent specials, hours, ratings, or events.
```

5. Return:

- concise answer
- confidence/source status
- place card
- suggested actions such as "Build lunch plan", "Find quieter", "Add dessert", "Nearby events"

## 11. APIs To Build

### 11.1 `ontario-search`

Purpose: Search places/events/activities across Ontario.

Status: implemented and deployed as
`supabase/functions/ontario-search/index.ts`.

Request:

```json
{
  "query": "nice lunch in Markham",
  "city": "Markham",
  "lat": 43.8561,
  "lng": -79.337,
  "intent": "lunch",
  "limit": 20
}
```

Response:

```json
{
  "supported": true,
  "region": {
    "province": "ON",
    "city": "Markham"
  },
  "results": []
}
```

### 11.2 `place-detail`

Purpose: Return canonical place, Echoo profile, hours, related events, source confidence, and nearby alternatives.

Status: implemented and deployed as
`supabase/functions/place-detail/index.ts`.

### 11.3 `ontario-plan`

Purpose: Build route/plan from retrieved Ontario records.

Status: implemented and deployed as
`supabase/functions/ontario-plan/index.ts`.

The first version is deterministic and retrieval-first. It uses
`search_ontario_places`, `canonical_places`, and `place_profiles`; it does not
call an LLM or invent local facts. It returns both the newer
`{ data, error, meta }` response envelope and a compatibility payload under
`data.compatibility` for the existing planner UI shape.

Remote smoke tests verified:

- a two-stop Markham lunch route using validation records
- a three-stop Toronto date/culture route using validation records
- an honest sparse fallback for Thunder Bay

Planner integration status as of 2026-06-27:

- `plan-engine` now routes Ontario local planning/place queries to
  `ontario-plan` before Gemini
- Ontario responses use `ai.provider = "echoo-retrieval"` and the existing
  frontend-compatible `plans` shape
- general non-local chat still falls back to Gemini
- `app.html` now routes Ontario planning prompts to `plan-engine`; explicit
  live/event prompts can still use `discover-live`

Scale-up ingestion status as of 2026-06-27:

- Broader Ticketmaster ingestion has run for priority Ontario city/category
  buckets. The first larger batch imported 134 event records; one bucket hit a
  provider 429. Partial-success behavior was tightened so imported records are
  not marked as a hard failed run.
- Official City of Toronto Open Data parks/recreation facilities were imported
  from CKAN GeoJSON in chunks after an all-at-once run hit Edge Function compute
  limits.
- Toronto parks/recreation import currently has 1,832 unique canonical places,
  1,832 searchable mirrors in `location_entities`, and 1,832 `place_sources`
  provenance rows.
- Current canonical Ontario place inventory is 1,852 records: 20 approved
  Markham/Toronto validation places plus the 1,832 official Toronto open-data
  parks/recreation records before the next official-dataset batch.
- After the library/cultural/DineSafe batch, current canonical Ontario place
  inventory is 20,709 records: the 1,852 earlier records plus 101 Toronto
  library branches, 895 Toronto Cultural Hotspot points of interest, and
  17,861 Toronto DineSafe food-premise records. The verified canonical place
  layer is fully scoped to `admin_area_1 = 'ON'`.
- Deployed API smoke tests verify `park Toronto` search, High Park
  `place-detail`, direct `ontario-plan`, and `plan-engine` retrieval-first
  routing for Markham lunch planning.
- Quality checks for the validation + Toronto open-data place layers show no
  duplicate source IDs, no missing mirrors, and no bad Ontario coordinates.
- Province-scale OSM import is now verified through GitHub Actions, not local
  Mac conversion and not Overpass. Workflow run `28301745467` completed
  successfully against the real Geofabrik Ontario extract after the importer
  was switched to resumable 100-record chunks.

Request:

```json
{
  "query": "two stop lunch plan in Markham",
  "city": "Markham",
  "budget": "$$",
  "vibe": "chill"
}
```

Response:

- route title
- stops
- travel labels
- route explanation
- confidence
- missing-data notes when needed

### 11.4 `place-enrich`

Admin/worker-only endpoint for AI profile generation.

Implementation status as of 2026-06-28:

- `supabase/functions/place-enrich` is deployed as a secured worker endpoint.
- It generates initial Echoo place profiles from verified canonical place data
  using deterministic category/source rules before any free-form model layer is
  introduced.
- It upserts `place_profiles`, writes `ai_enrichment_jobs`, supports dry runs
  and scoped batches, and routes lower-confidence category profiles to
  `needs_update` for admin review.
- Deployed smoke tests enriched 5 Markham food/cafe places as approved profiles
  and 2 OSM historic places as `needs_update`.
- Phase 3A hardening added broader category templates for imported Ontario
  records (`fast_food`, `pub`, `cinema`, `arts_centre`, `attraction`,
  `historic`, `mall`, `fitness_centre`, and `nature_reserve`), batch
  pagination, multi-category filters, `sourceProvider` filters, and v2 job
  auditing (`place_profile_v2`, `echoo-deterministic-profile-v2`).
- `ontario-maintenance` can now invoke `place-enrich` through
  `action = "place_enrichment"` or the broader `scheduled` action, and the
  `ontario_place_enrichment` schedule row exists for small recurring batches
  while the Phase 3 backfill is active.
- Deployed smoke tests verified both direct `place-enrich` dry runs and an
  `ontario-maintenance` real batch that enriched CF Markville plus a historic
  OSM record.

## 12. Ranking

Ranking should combine location, intent, quality, and freshness.

Suggested initial formula:

```text
score =
  distance_score * 0.20 +
  category_match * 0.20 +
  intent_match * 0.20 +
  profile_quality * 0.15 +
  popularity_or_event_signal * 0.10 +
  freshness_verified * 0.10 +
  editorial_boost * 0.05
```

Lunch-specific ranking should prefer:

- restaurants and cafes
- likely-open or hours-confirmed places
- high `lunch_score`
- good nearby second stops
- not nightlife-only venues unless requested

Chill-specific ranking should prefer:

- lower noise
- better group/date suitability
- relaxed cafes, restaurants, parks, lounges
- avoid clubs/party-heavy results unless requested

Phase 3B implementation status as of 2026-06-29:

- Migration `202606290001_ontario_ranking_profile_treatment.sql` upgrades
  `search_ontario_places` to expose the ranking inputs needed by search, plan,
  and chat: vibe tags, good-for tags, solo/family/rainy-day scores, profile
  review status, source provider, profile quality, source quality, popularity,
  trust, and editorial boost.
- `ontario-search` and `ontario-plan` now apply a shared treatment score:

```text
treatment =
  base_rank * 0.30 +
  intent_match * 0.22 +
  vibe_match * 0.16 +
  profile_quality * 0.14 +
  source_quality * 0.08 +
  editorial_boost * 0.06 +
  trust_score * 0.04

final_score = treatment * confidence_safety_multiplier
```

- Results now include ranking/source-safety metadata so the UI can explain why
  a place appeared without inventing ratings, hours, specials, or events.
- `plan-engine` routes more Ontario local/place-opinion prompts to
  retrieval-first planning before Gemini, including Markville/Unionville
  aliases and chill/nice/worth/vibe/quiet/cozy phrasing.
- Place-opinion prompts are treated as focused one-place retrieval answers;
  route/planning prompts still produce multi-stop route boards.
- Live verification passed after deployment:
  - `ontario-search` for `chill lunch Markham` returned approved Echoo-profile
    results with `profile_vibe_editorial_confidence_v1` metadata.
  - `ontario-plan` for `two stop lunch plan in Markham` returned JOEY Markville
    and Platform Espresso Bar.
  - `plan-engine` for `is JOEY Markville nice for chilling?` returned
    `ai.provider = "echoo-retrieval"` with one JOEY Markville stop.

Immediate post-Phase 3B implementation direction:

- Phase 3B ranking/profile treatment is considered solidly built; the next
  implementation step is Ontario/GTA data depth, beginning with Markham and
  reusable municipal open-data ingestion.
- Toronto was the first municipal dataset scaffold. It should remain supported,
  but new ingestion and ranking work should treat Ontario as the province scope
  and GTA/Markham as the current quality bar.
- `ontario-open-data-import` now supports a GTA preset registry, preset-level
  `municipality`, configurable CKAN base URLs, and ArcGIS FeatureServer paging.
- First GTA expansion presets:
  - `markham_parks`
  - `markham_trails`
- The importer uses public ArcGIS utility FeatureServer URLs for Markham,
  requests GeoJSON with paging, and normalizes polygon/line geometries into
  coordinates suitable for `canonical_places`.
- Deterministic enrichment now covers `trail`, `cultural_space`,
  `public_facility`, and `food_premise`.
- Retrieval category buckets now include trail/outdoor/walk/hike and
  civic/community/recreation/facility intents.
- Migration `202606290002_gta_open_data_enrichment_schedule.sql` updates the
  recurring enrichment schedule for the expanded Ontario/GTA categories.
- Remote verification completed on 2026-06-29:
  - migration `202606290002_gta_open_data_enrichment_schedule.sql` applied to
    the linked Supabase project
  - `ontario-open-data-import`, `place-enrich`, `ontario-search`, and
    `ontario-plan` redeployed with `--use-api`
  - live Markham ArcGIS GeoJSON source checks returned Snowdon Park and Markham
    Civic Centre Trail
  - secured worker auth was confirmed because `ontario-open-data-import`
    returned 401 without `ONTARIO_INGESTION_SECRET`; the secret value is
    configured remotely but not locally readable
  - two tiny remote smoke records from real Markham source data were added with
    `metadata.phase3c_remote_smoke = true`
  - each smoke record has canonical/source/mirror/profile rows
  - deployed `ontario-search` returns Snowdon Park for `park Markham Snowdon`
    and Markham Civic Centre Trail for `trail walk Markham Civic Centre`
  - deployed `ontario-plan` returns Markham Civic Centre Trail in explicit
    park/trail route prompts
  - `ontario-plan` outdoor category buckets were tightened so explicit
    park/trail/walk/hike prompts do not drift to restaurant/cafe fallbacks

Phase 3D Markham civic-facility expansion completed on 2026-07-01:

- Added `markham_city_facilities` to `ontario-open-data-import`.
- Source: City of Markham `City Owned Facilities` ArcGIS Feature Service
  (`OpenData/OD_CITY_FACILITES/FeatureServer`).
- The preset maps `LABEL`, `TYPE`, `ADDRESS`, and `DEPTRESP` into Echoo
  place records and uses polygon geometry centroids.
- Shared open-data category normalization maps Markham civic `TYPE` values into
  retrieval categories such as `community_centre`, `library`, and
  `public_facility`.
- `ontario-open-data-import`, `ontario-search`, and `ontario-plan` were
  redeployed with `--use-api`.
- Search/plan query cleanup now treats civic words such as library, community,
  recreation, facility, centre/center, and indoor as intent/category terms.
- `ontario-plan` civic/facility buckets were tightened so explicit
  community/library/facility routes do not drift to cafe fallback records.
- Remote verification used two tiny real-source smoke records marked
  `metadata.phase3d_remote_smoke = true`:
  - Milliken Mills Community Centre and Library (`community_centre`)
  - Thornhill Village Library (`library`)
- Deployed `ontario-search` verified both records.
- Deployed `ontario-plan` verified direct library retrieval and a Markham
  community/library route.

## 13. Admin Review

Improve or extend `admin-locations.html` into an Ontario operations console.

Required queues:

- new imported places pending review
- duplicate candidates
- low-confidence AI profiles
- missing category
- missing coordinates
- zero-result/high-demand queries
- user-reported incorrect info

Required actions:

- approve
- edit
- merge duplicate
- archive
- mark verified
- pin as Echoo pick
- add vibe tags
- add lunch/date/group scores

## 14. Update Cadence

Hourly:

- Ticketmaster event refresh in priority cities.
- Echoo owned event/ticket updates.

Daily:

- stale event cleanup
- zero-result query review batch
- missing enrichment job batch

Weekly:

- OSM/open-data refresh or diff import
- duplicate detection
- city/category coverage report

Monthly:

- regenerate low-confidence AI summaries
- data source/licence audit
- Ontario coverage review

## 15. UI Changes

The chat should render structured local intelligence:

- identified place card
- confidence/source badge
- "why this answer" from Echoo facts
- route board for plans
- graceful missing-data state

For plans:

- square stop cards
- SVG connector
- route explanation
- optional map
- "why this order" copy

For missing data:

- say what is missing
- show closest known alternatives
- allow "Add this place to Echoo"

## 16. Build Timeline

### Week 1: Schema And Ontario Regions

- Add new migrations for `place_profiles`, `place_sources`, `place_hours`, `ontario_events`, `ai_enrichment_jobs`, and `zero_result_queries`.
- Expand Ontario `supported_regions` records.
- Add indexes and RLS policies.

Deliverable: database ready for Ontario ingestion.

### Week 2: OSM And Open Data Import

- Build import scripts.
- Import Ontario POIs.
- Normalize into `canonical_places`.
- Run dedupe pass.

Deliverable: province-wide baseline POI records.

### Week 3: AI Enrichment Worker

- Add enrichment job runner.
- Generate Echoo profiles.
- Store scores/tags/summaries.
- Queue low-confidence records.

Status: worker slice complete/verified on 2026-06-27, then Phase 3A runner
hardening completed on 2026-06-28 with pagination, broader templates,
`place_profile_v2` audit rows, and a maintenance/schedule path for recurring
small-batch enrichment.

Deliverable: first enriched Ontario knowledge layer.

### Week 4: Retrieval APIs

- Build `ontario-search`.
- Build `place-detail`.
- Build `ontario-plan`.
- Update planner/chat to use these before AI.

Deliverable: local questions are grounded in Ontario data.

### Week 5: Admin Review

- Improve review UI.
- Add duplicate merge and profile review.
- Add city/category filters.

Deliverable: operators can keep data clean.

### Week 6: Markham/GTA Polish

- Manually review high-demand Markham/GTA places.
- Improve lunch/chill/date scoring.
- Add route quality checks.
- Monitor zero-result queries.

Deliverable: lunch demo is coherent and useful.

## 17. Acceptance Criteria

The Ontario intelligence layer is acceptable when:

- A user can ask about a known Markham/Toronto place and receive a grounded answer.
- The answer shows no invented hours, ratings, specials, or events.
- A two-stop Ontario lunch plan returns real stops from the database.
- Each stop links to a canonical place or event.
- Low-confidence place profiles appear in admin review.
- Zero-result searches are logged for future improvement.
- The planner can gracefully explain when Echoo lacks enough verified data.
- General companion chat never shows a false "AI offline" route fallback just
  because the response has zero stops.
- Model/provider/system/prompt questions are answered by deterministic Echoo
  policy and never forwarded to the model.
- Companion responses follow `docs/Echoo-AI-Companion-Specification redo .pdf`:
  no "I recommend", no "based on your preferences", no raw provider language,
  no more than three options, and no invented local facts.

## 18. Immediate Next Build Actions

Completed:

1. Add the Ontario intelligence migrations.
2. Build non-user-facing ingestion workers under `supabase/functions`.
3. Build and import a small Markham/Toronto validation set.
4. Implement and deploy `ontario-search`, `place-detail`, and `ontario-plan`.
5. Modify planner/chat behavior so Ontario local planning uses retrieval before
   model generation.
6. Run initial scale-up ingestion for Ticketmaster and official Toronto
   open-data parks/recreation records.

Remaining:

1. Add a repeatable OSM `.osm.pbf` conversion pipeline and run province-scale
   OSM imports in chunks.
   - Status: complete/verified on 2026-06-27.
   - Implemented repository path:
     `.github/workflows/ontario-osm-convert.yml` installs `osmium-tool` on
     Ubuntu, downloads the Geofabrik Ontario extract by default, converts it
     into an NDJSON artifact, and can import the artifact into Supabase chunks.
   - Local upload path:
     `scripts/import-ontario-osm-chunks.mjs` uploads converted NDJSON to
     `ontario-osm-import` in chunks using Node. It defaults to 100-record
     chunks, supports `OSM_IMPORT_START_OFFSET`, forwards true chunk offsets,
     accepts GeoJSON text sequence separators, and retries transient failures.
   - `scripts/osm-pbf-to-ndjson.sh` can run on any non-Mac/local machine where
     `osmium` exists.
   - The province-scale path is GitHub Actions, not local conversion on the
     2015 MacBook Pro. Repository secret `ONTARIO_INGESTION_SECRET` is set.
     Workflow run `28301745467` downloaded the 922 MB Ontario extract,
     converted 37,610 OSM POI source records, and completed the resumed import
     from offset `1000` through the end after the first run imported offset
     `0`. Do not use Overpass for this.
2. Import additional official municipal/provincial datasets: libraries,
   community centres, recreation centres, trails, public facilities, cultural
   spaces, and inspected/licensed food premises where available.
   - Implemented presets: `toronto_libraries`,
     `toronto_cultural_hotspots`, and `toronto_dinesafe_food_premises`.
   - DineSafe uses CKAN datastore paging, not a full-file JSON fetch, so large
     food-premises imports can run in real chunks.
   - Verified import run completed for Toronto libraries, Cultural Hotspot, and
     DineSafe. DineSafe used 1,000-row chunks after a 5,000-row Edge compute
     limit and completed the 104,619-row source feed.
   - GTA expansion started after Phase 3B with reusable ArcGIS FeatureServer
     support and Markham presets for parks and trails.
   - Phase 3C Markham park/trail retrieval is remotely verified with two tiny
     smoke records from real City of Markham open-data sources.
   - Phase 3D Markham city-facility retrieval is remotely verified with two
     tiny smoke records from the real City Owned Facilities source.
   - Remaining expansion: add more municipal presets for community centres,
     recreation centres, trails, public facilities, libraries, and additional
     GTA/Ontario cities.
3. Add more Echoo partner/manual/editorial records and give that source
   priority in ranking.
4. Build duplicate review/merge and profile-confidence queues in
   `admin-locations.html`.
   - Implemented queues: place review, duplicate candidates,
     low-confidence/profile review, and worker schedules.
   - Admin queue smoke after imports returned schedules, duplicate candidates,
     and no pending low-confidence profiles.
5. Schedule recurring Ticketmaster refreshes and stale-event cleanup.
   - Implemented schedule registry plus `ontario-maintenance` actions for
     Ticketmaster priority refresh and stale-event cleanup.
   - Admin/worker functions are deployed with Supabase JWT verification
     disabled and rely on the configured admin/ingestion secret headers.
   - Stale cleanup smoke ran successfully and archived zero stale records.
6. Harden Phase 3 profile enrichment into a resumable runner.
   - Status: complete/verified on 2026-06-28 for Phase 3A.
7. Implement Phase 3B ranking/profile treatment.
   - Status: complete/verified on 2026-06-29.
   - `place-enrich` supports `categories`, `sourceProvider`, `offset`, `limit`,
     `includeExisting`, and `dryRun`, with a 500-record batch cap.
   - Category templates now cover core imported food, culture, shopping,
     historic, indoor, and nature records.
   - `ontario-maintenance` supports `action = "place_enrichment"` and the
     `ontario_place_enrichment` schedule row is installed.
   - Smoke tests verified direct dry-run scoring and a real maintenance-driven
     enrichment batch.
