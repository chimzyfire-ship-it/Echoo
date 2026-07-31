#!/usr/bin/env node

import fs from "node:fs";
import readline from "node:readline";

const [
  ,
  ,
  inputPath,
  endpoint = process.env.ONTARIO_OSM_IMPORT_URL,
] = process.argv;

const secret = process.env.ONTARIO_INGESTION_SECRET ||
  process.env.ADMIN_TOKEN ||
  "";
const chunkSize = Math.max(1, Number(process.env.OSM_CHUNK_SIZE || 100));
const maxRetries = Math.max(1, Number(process.env.OSM_IMPORT_RETRIES || 4));
const startOffset = Math.max(
  0,
  Number(process.env.OSM_IMPORT_START_OFFSET || 0),
);
const municipality = String(process.env.OSM_MUNICIPALITY || "").trim();
const sourceUrl = String(process.env.OSM_SOURCE_URL || "").trim();
const sourceSnapshotId = String(
  process.env.OSM_SNAPSHOT_ID || `osm-${new Date().toISOString()}`,
).trim();

if (!inputPath || !endpoint || !secret) {
  console.error(
    "Usage: ONTARIO_INGESTION_SECRET=... node scripts/import-ontario-osm-chunks.mjs <osm.ndjson> <ontario-osm-import-url>",
  );
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function postChunk(records, offset) {
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-ingestion-secret": secret,
        },
        body: JSON.stringify({
          sourceName: "openstreetmap",
          sourceUrl: sourceUrl || undefined,
          municipality: municipality || undefined,
          sourceSnapshotId,
          records,
          offset,
          maxRecords: records.length,
        }),
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          json.error || json.message ||
            `OSM chunk ${offset} failed: ${response.status}`,
        );
      }
      const skipped = Number(json?.summary?.skipped || 0);
      const unindexed = Number(json?.summary?.unindexedCoverageCount || 0);
      if (skipped > 0 || unindexed > 0) {
        throw new Error(
          `OSM chunk ${offset} did not fully index its physical-place source records: ` +
            JSON.stringify({
              skipped,
              unindexedCoverage: json?.summary?.unindexedCoverage || {},
              errors: json?.summary?.errors || [],
            }),
        );
      }
      console.log(JSON.stringify({ offset, ...json.summary }));
      return json;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(JSON.stringify({ offset, attempt, error: message }));
      if (attempt === maxRetries) throw error;
      await sleep(2500 * attempt);
    }
  }
}

function addCategorySourceIds(target, categoryIds) {
  for (const [category, values] of Object.entries(categoryIds || {})) {
    if (!Array.isArray(values)) continue;
    const ids = target.get(category) || new Set();
    for (const value of values) {
      if (typeof value === "string" && value) ids.add(value);
    }
    target.set(category, ids);
  }
}

function categoryCounts(categoryIds) {
  return Object.fromEntries(
    [...categoryIds.entries()].map(([category, ids]) => [category, ids.size]),
  );
}

async function finalizeCoverage(sourceRecordCounts) {
  if (!municipality || startOffset > 0) return null;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ingestion-secret": secret,
    },
    body: JSON.stringify({
      action: "finalize_coverage",
      municipality,
      sourceName: "openstreetmap",
      sourceUrl: sourceUrl || undefined,
      sourceSnapshotId,
      sourceRecordCounts,
    }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Coverage finalization failed: ${response.status}`);
  }
  return json.coverageSnapshot || null;
}

let offset = startOffset;
let records = [];
let seen = 0;
let imported = 0;
let skipped = 0;
const sourceIdsByCategory = new Map();
const stream = readline.createInterface({
  input: fs.createReadStream(inputPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of stream) {
  const trimmed = line.trim().replace(/^\u001e/, "");
  if (!trimmed) continue;
  if (seen < startOffset) {
    seen += 1;
    skipped += 1;
    continue;
  }
  records.push(JSON.parse(trimmed));
  seen += 1;
  if (records.length >= chunkSize) {
    const result = await postChunk(records, offset);
    addCategorySourceIds(sourceIdsByCategory, result?.summary?.sourceCategoryIds);
    imported += records.length;
    offset += records.length;
    records = [];
  }
}

if (records.length) {
  const result = await postChunk(records, offset);
  addCategorySourceIds(sourceIdsByCategory, result?.summary?.sourceCategoryIds);
  imported += records.length;
}

const sourceRecordCounts = categoryCounts(sourceIdsByCategory);
const coverageSnapshot = await finalizeCoverage(sourceRecordCounts);

console.log(JSON.stringify({
  completed: true,
  sourceRecordsSeen: seen,
  sourceRecordsSubmitted: imported,
  sourceRecordsSkippedBeforeSubmit: skipped,
  chunkSize,
  startOffset,
  municipality: municipality || null,
  sourceUrl: sourceUrl || null,
  sourceSnapshotId,
  sourceRecordCounts,
  coverageSnapshot,
}));
