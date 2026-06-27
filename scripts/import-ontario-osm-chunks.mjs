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
const chunkSize = Math.max(1, Number(process.env.OSM_CHUNK_SIZE || 1000));
const maxRetries = Math.max(1, Number(process.env.OSM_IMPORT_RETRIES || 4));

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
          records,
          offset: 0,
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
      console.log(JSON.stringify({ offset, ...json.summary }));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(JSON.stringify({ offset, attempt, error: message }));
      if (attempt === maxRetries) throw error;
      await sleep(2500 * attempt);
    }
  }
}

let offset = 0;
let records = [];
let seen = 0;
let imported = 0;
let skipped = 0;
const stream = readline.createInterface({
  input: fs.createReadStream(inputPath, { encoding: "utf8" }),
  crlfDelay: Infinity,
});

for await (const line of stream) {
  const trimmed = line.trim().replace(/^\u001e/, "");
  if (!trimmed) continue;
  records.push(JSON.parse(trimmed));
  seen += 1;
  if (records.length >= chunkSize) {
    await postChunk(records, offset);
    imported += records.length;
    offset += records.length;
    records = [];
  }
}

if (records.length) {
  await postChunk(records, offset);
  imported += records.length;
}

console.log(JSON.stringify({
  completed: true,
  sourceRecordsSeen: seen,
  sourceRecordsSubmitted: imported,
  sourceRecordsSkippedBeforeSubmit: skipped,
  chunkSize,
}));
