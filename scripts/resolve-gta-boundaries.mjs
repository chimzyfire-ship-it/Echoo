#!/usr/bin/env node

/**
 * Writes one GeoJSON administrative boundary per GTA manifest municipality.
 * These polygons are used only to clip a bulk OSM extract locally; POIs are
 * never fetched from Overpass/Nominatim.
 */
import fs from "node:fs/promises";
import path from "node:path";

const [manifestPath, outputDirectory] = process.argv.slice(2);
if (!manifestPath || !outputDirectory) {
  console.error(
    "Usage: node scripts/resolve-gta-boundaries.mjs <manifest.json> <output-directory>",
  );
  process.exit(1);
}

const userAgent = process.env.OSM_BOUNDARY_USER_AGENT ||
  "Echoo-GTA-coverage-import/1.0 (contact: support@echoo.app)";
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
if (!Array.isArray(manifest.municipalities) || manifest.municipalities.length !== 25) {
  throw new Error("The GTA import manifest must contain exactly 25 municipalities.");
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const safeName = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function isMatchingBoundary(result, municipality) {
  const expected = [municipality.name, ...(municipality.aliases || [])]
    .map((name) => name.toLocaleLowerCase("en-CA"));
  const names = [result.name, result.display_name, ...Object.values(result.namedetails || {})]
    .filter(Boolean)
    .map((name) => String(name).toLocaleLowerCase("en-CA"));
  return result.osm_type === "relation" &&
    (result.class === "boundary" || result.category === "boundary") &&
    result.geojson &&
    ["Polygon", "MultiPolygon"].includes(result.geojson.type) &&
    expected.some((name) => names.some((candidate) => candidate === name || candidate.includes(`${name},`)));
}

await fs.mkdir(outputDirectory, { recursive: true });
for (const municipality of manifest.municipalities) {
  const query = new URLSearchParams({
    // Structured search avoids fuzzy matches such as BMO Field for Toronto.
    city: municipality.name,
    state: "Ontario",
    country: "Canada",
    format: "jsonv2",
    polygon_geojson: "1",
    namedetails: "1",
    limit: "10",
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${query}`, {
    headers: { "User-Agent": userAgent, Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Boundary lookup failed for ${municipality.name}: ${response.status}`);
  const results = await response.json();
  const boundary = results.find((result) => isMatchingBoundary(result, municipality));
  if (!boundary) throw new Error(`No exact administrative boundary found for ${municipality.name}.`);

  const feature = {
    type: "Feature",
    properties: {
      municipality: municipality.name,
      region: municipality.region,
      osm_relation_id: boundary.osm_id,
      osm_display_name: boundary.display_name,
      retrieved_at: new Date().toISOString(),
    },
    geometry: boundary.geojson,
  };
  await fs.writeFile(
    path.join(outputDirectory, `${safeName(municipality.name)}.geojson`),
    `${JSON.stringify(feature)}\n`,
  );
  console.log(JSON.stringify({ municipality: municipality.name, relationId: boundary.osm_id }));
  // Nominatim's public service requires no more than one request per second.
  await sleep(1100);
}
