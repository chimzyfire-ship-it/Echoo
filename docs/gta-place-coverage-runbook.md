# GTA place-coverage runbook

The GTA coverage definition is the City of Toronto plus every lower-tier
municipality in Durham, York, Peel, and Halton: 25 municipal search scopes in
total. Toronto's former boroughs (including Scarborough and North York) resolve
to Toronto rather than creating separate, sparse inventories.

## Why this is an ingestion pipeline, not a one-off seed

The authoritative list is in
`supabase/seed-data/gta-municipality-import-manifest.json`. It is consumed by
the same municipality names registered in `supported_regions`, location
normalization, the event refresh buckets, and the OSM place importer.

For each municipality, create a current OSM POI extract clipped to the official
municipal boundary. Do not use a centroid radius: it assigns border places to
the wrong city. Convert the clipped PBF with the existing converter, then send
it in resumable chunks with the canonical municipality override:

```bash
scripts/osm-pbf-to-ndjson.sh gta-boundaries/markham.osm.pbf out/markham.ndjson
OSM_MUNICIPALITY=Markham ONTARIO_INGESTION_SECRET=... \
  node scripts/import-ontario-osm-chunks.mjs out/markham.ndjson \
  https://<project>.supabase.co/functions/v1/ontario-osm-import
```

Repeat for every manifest municipality. The importer records each upstream
source, upserts canonical places, mirrors them into `location_entities`, and
makes them available to `explore-search`, `search-suggestions`,
`ontario-search`, and planning retrieval. Existing OSM IDs make reruns safe.

## Production batch import

Use the **GTA Municipality OSM Import** GitHub Actions workflow for a complete
seed. It downloads one current Ontario bulk PBF, obtains the administrative
polygon for every requested municipality, clips the PBF locally, and imports
each chunk with its canonical municipality override. It does not use Overpass
or Nominatim for POI data.

Use `ALL` for the initial run. If the job stops, rerun it with the same
municipality set and set `resume_municipality` to the first municipality that
was not completed. OSM identity upserts make completed municipalities safe to
run again. The workflow's final protected coverage check fails unless every one
of the 25 municipalities has published inventory, and uploads its report as
the `gta-municipality-coverage` artifact.

## Release acceptance check

After the migration and imports are deployed, use the database-only readiness
report:

```sql
select * from public.gta_municipality_coverage();
```

The same protected report is available to automation through
`ontario-osm-import` by posting `{ "action": "coverage" }` with the ingestion
secret. `complete: true` means the inventory is non-empty in all 25
municipalities; it is a launch-floor check, **not** a claim that every place is
present.

Each full municipality import now finalizes a source-coverage snapshot. The
report also returns `sourceCoverageReady: true` only when all 25 municipalities
and every mapped category in the municipal OSM extract have a fresh snapshot
whose source record count reconciles with the published canonical index. This
is the evidence-backed check for “we imported the entire current source
extract,” and will surface any partial chunk import instead of silently calling
it coverage. The converter includes point, line, and area geometry so a venue
mapped as a building is not silently excluded.

The same run also loads all 25 administrative boundary polygons into the GPS
resolver. `boundaryCoverageReady: true` confirms that precise device location
can be labelled by municipality rather than falling back to a GTA-wide label.

Comedy needs a separate standard: comedy is primarily an event/venue domain,
not a uniformly tagged POI category. Track comedy venues through the physical
place audit where OSM identifies a theatre/nightclub/event venue, and track
upcoming comedy through the event-provider refresh and freshness report. Do
not label either lane as exhaustive without a licensed event/venue census.

Every municipality must have published inventory before it is described as
launch-ready. Describe a physical-place category as source-reconciled only when
the source-coverage report is fresh and reconciled. Investigate any row with
zero `published_entities` or an `import_gap`, then run a location-specific
search (for example `city=Whitby` or `city=Stouffville`) and confirm the
returned city is the canonical municipality.
