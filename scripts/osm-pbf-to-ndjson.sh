#!/usr/bin/env bash
set -euo pipefail

INPUT_PBF="${1:-}"
OUTPUT_NDJSON="${2:-ontario-osm-pois.ndjson}"

if [[ -z "$INPUT_PBF" ]]; then
  echo "Usage: scripts/osm-pbf-to-ndjson.sh <ontario-or-canada.osm.pbf> [output.ndjson]" >&2
  exit 1
fi

if ! command -v osmium >/dev/null 2>&1; then
  echo "osmium is required for conversion. Use the GitHub Actions workflow or an Ubuntu machine with osmium-tool installed." >&2
  exit 2
fi

TMP_FILTERED="$(mktemp -t echoo-osm-filtered.XXXXXX.osm.pbf)"
trap 'rm -f "$TMP_FILTERED"' EXIT

osmium tags-filter \
  "$INPUT_PBF" \
  nwr/amenity=restaurant,cafe,bar,pub,fast_food,cinema,theatre,arts_centre,community_centre,library \
  nwr/tourism=attraction,museum,gallery \
  nwr/leisure=park,fitness_centre,nature_reserve \
  nwr/shop=mall \
  nwr/historic \
  -o "$TMP_FILTERED" \
  --overwrite

osmium export "$TMP_FILTERED" \
  --geometry-types=point \
  --add-unique-id=type_id \
  --output-format=geojsonseq \
  --overwrite \
  -o "$OUTPUT_NDJSON"

echo "Wrote $OUTPUT_NDJSON"

