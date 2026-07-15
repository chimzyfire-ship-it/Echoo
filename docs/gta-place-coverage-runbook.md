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
secret. It returns `complete: true` only when exactly 25 GTA municipalities are
reported and none has zero `published_entities`.

Every municipality must have published inventory before it is described as
fully covered. Investigate any row with zero `published_entities`, then run a
location-specific search (for example `city=Whitby` or `city=Stouffville`) and
confirm the returned city is the canonical municipality.
