import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import {
  assertIngestionAuthorized,
  fetchJsonRecords,
  finishIngestionRun,
  importPlaces,
  osmElementToPlace,
  type PlaceInput,
  startIngestionRun,
} from "../_shared/ontario-ingestion.ts";

type Payload = {
  sourceUrl?: string;
  records?: unknown[];
  sourceName?: string;
  offset?: number;
  maxRecords?: number;
};

function asRecordLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5000;
  return Math.max(1, Math.min(Math.round(parsed), 25000));
}

function asRecordOffset(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const unauthorized = assertIngestionAuthorized(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  let runId: string | null = null;

  try {
    const payload = (await req.json()) as Payload;
    const maxRecords = asRecordLimit(payload.maxRecords);
    const startAt = asRecordOffset(payload.offset);
    const rawRecords = Array.isArray(payload.records)
      ? payload.records
      : payload.sourceUrl
        ? await fetchJsonRecords(payload.sourceUrl)
        : [];

    runId = await startIngestionRun(supabase, {
      sourceName: payload.sourceName || "openstreetmap",
      sourceType: "osm",
      sourceUrl: payload.sourceUrl,
      metadata: {
        offset: startAt,
        maxRecords,
        mode: payload.sourceUrl ? "source_url" : "inline_records",
        note:
          "Worker expects an Ontario/Canada extract converted to JSON/NDJSON/GeoJSON, not Overpass bulk queries.",
      },
    });

    const places = rawRecords
      .slice(startAt, startAt + maxRecords)
      .map(osmElementToPlace)
      .filter((place): place is PlaceInput => Boolean(place));
    const summary = await importPlaces(supabase, places);
    const filteredOutInWindow =
      Math.min(maxRecords, Math.max(rawRecords.length - startAt, 0)) -
      places.length;

    await finishIngestionRun(supabase, runId, {
      status: "completed",
      records_seen: rawRecords.length,
      records_imported: summary.imported,
      records_skipped: summary.skipped + filteredOutInWindow,
      error_sample: summary.errors,
    });

    return jsonResponse({
      success: true,
      runId,
      osmPolicy: "bulk_extract_required",
      summary: {
        ...summary,
        offset: startAt,
        windowSize: maxRecords,
        totalSourceRecords: rawRecords.length,
        filteredOutInWindow,
      },
    });
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : "Unknown OSM import error";
    await finishIngestionRun(supabase, runId, {
      status: "failed",
      error_sample: [message],
    });
    return jsonResponse({ error: message, runId }, 500);
  }
});
