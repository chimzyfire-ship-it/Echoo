# Ontario Discovery Locations

## Scope

36 unique manual selections: all 25 GTA municipalities plus 11 curated Ontario
cities already present in the backend registry. This is not the complete list of
Ontario cities or the province's 444 municipalities. Hamilton means the City of
Hamilton, not Hamilton Township, and is not grouped under GTA.

| Group | Selections |
| --- | --- |
| Toronto | Toronto |
| Durham | Ajax, Brock, Clarington, Oshawa, Pickering, Scugog, Uxbridge, Whitby |
| York | Aurora, East Gwillimbury, Georgina, King, Markham, Newmarket, Richmond Hill, Vaughan, Whitchurch-Stouffville |
| Peel | Brampton, Caledon, Mississauga |
| Halton | Burlington, Halton Hills, Milton, Oakville |
| Other Ontario cities | Barrie, Guelph, Hamilton, Kingston, Kitchener, London, Niagara Falls, Ottawa, Thunder Bay, Waterloo, Windsor |

## Official Sources

Verified September 7, 2026:

- [Ontario Ministry of Finance population projections](https://www.ontario.ca/page/ontario-population-projections), Regional population growth: GTA is Toronto plus Durham, Halton, York and Peel.
- [Ministry of Municipal Affairs and Housing municipality directory](https://www.ontario.ca/page/list-ontario-municipalities).
- [Official CSV linked by that directory](https://files.ontario.ca/mmah-list-of-ontario-municipalities-en-utf8-2022-10-05.csv): confirms municipal names, geographic areas and the 24 lower-tier GTA municipalities plus Toronto. All 11 additional selections are listed as City of. The CSV's dated snapshot is not a claim that every Ontario municipality is selectable.

## Behavior And Coverage

- Search text is pre-normalized once; group membership uses Set lookup. City selection never supplies centroid coordinates as GPS.
- Culture Lens, query, city filters and actual GPS coordinates are preserved. Manual searches use canonical city names; GPS searches use the existing radius-limited Ontario query.
- `location-context` and `explore-search` share province verification. Exact loaded GTA polygons are tried first. Elsewhere, Google Geocoding must return country CA and province ON. A rectangle alone never authorizes a request. Missing keys/provider failures fail closed with manual selection guidance. This is provider administrative-address verification, not a newly installed official Ontario polygon dataset.
- Google Places results now require Canadian/Ontario address components, preventing nearby Detroit, Gatineau or US Niagara results from leaking in. Coordinates are transmitted to providers; the picker discloses this. No new persistent GPS cache was added.
- Discover V2 already queries `location_entities.status = 'published'`, `country_code = 'CA'`, `admin_area_1 = 'ON'`, exact city for manual mode and `ST_DWithin` for GPS. Its existing scope index remains usable. No publication or supported-region flags are mass-enabled.
- Ingestion mirrors canonical places into `location_entities`; a row in `canonical_places` alone does not guarantee a Discover card. Existing `location_status`, `is_supported_region`, city/municipality, country/province and mirrored status need to be correct before publication. GTA import and boundary scripts remain GTA-specific; older `location-normalize`, region search and other product endpoints have not been advertised as province-wide.
- This change adds no venue/event inventory. Repository seeds and GTA ingestion do not prove live coverage in the added cities. Live database counts were not queried. Empty owned lanes are expected where published inventory is absent; live results additionally require configured Google Places access. The picker and empty states make no promise of complete coverage.

## Deployment Prerequisites

### Picker Dead-End Fix

The current picker uses `Other Ontario cities` only as a non-interactive heading;
its 11 city rows are direct selections. Both the provider and discovery request
now reject group labels. Manual selection replaces GPS state, removing coordinates.
Home and Discover share the picker and city/coordinate-keyed queries; their discovery
queries are stale immediately so returning to a cached city refreshes its results.

The prior committed `explore-search` implementation normalizes only GTA25 cities.
It returns `supported: false, reason: unsupported_city` for Ottawa and the other
added cities. Discover previously converted any unsupported response into a
`Choose an area` loop; Home suggested a GTA area. Both now state that the service
does not support the selected location, independently of empty results and request
errors. Incompatible non-V2 responses are service errors, not empty inventories.
The live deployed version has not been verified, so the reported device behavior
cannot be conclusively attributed to a particular deployed bundle/function.

No alternate endpoint fallback was added: the legacy live endpoint does not offer
the same V2 lane, culture, pagination and Ontario result-verification contract.
An unsupported response must not be bypassed with invented coordinates or silently
broadened to another city. Provider failures swallowed by the backend cannot be
identified by the native client; empty copy says no matches were returned, not
that a city has no venues.

Nothing was deployed. Deploy `location-context` and `explore-search` together with
their updated `_shared/location.ts` before releasing the native picker.

No new migration is required for this expansion. The database must already have
`202608130001_discovery_search_v2.sql` and its preceding discovery/schema
migrations applied. The optional GTA polygon fast path uses
`202607270001_gta_location_context_and_nationalities.sql`, the boundary import RPC
from `202607310004_gta_boundary_ingestion.sql`, and actual loaded polygons.

Configure server-only `GOOGLE_GEOCODING_API_KEY` (or `GOOGLE_MAPS_API_KEY`) with
Geocoding API enabled, billing and appropriate restrictions. Google Places live
results retain their existing key and media-signing prerequisites. Do not put
these keys in Expo public variables. Validate real border cases and provider
failure behavior in staging before release. Provider verification adds a network
request for non-GTA GPS searches; manual searches require no geocoding.

## Verification

- `npm run typecheck` in `native-shell`.
- `node --test scripts/check-native-location.mjs`: registry, GTA25 grouping, normalization, native API payload, GPS race, province verification and endpoint tests with mocked providers/database.
- `git diff --check`.
- Existing `node scripts/check-ontario-location.mjs` fails at line 24: the unchanged legacy web registry does not resolve `Ontario`, contrary to that old test. This is separate from native Discovery.
- Deno is not installed locally, so no Deno typecheck or live Postgres/provider integration verification was performed. No builds, dependency changes, commits or backend deployments.
