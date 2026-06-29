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
  partnerRecordToPlace,
  type PlaceInput,
  startIngestionRun,
} from "../_shared/ontario-ingestion.ts";

type Payload = {
  sourceUrl?: string;
  records?: Record<string, unknown>[];
  sourceName?: string;
  maxRecords?: number;
};

function limit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 2000;
  return Math.max(1, Math.min(Math.round(parsed), 10000));
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
    const rawRecords = Array.isArray(payload.records)
      ? payload.records
      : payload.sourceUrl
        ? await fetchJsonRecords(payload.sourceUrl)
        : [];
    const maxRecords = limit(payload.maxRecords);
    const sourceName = payload.sourceName || "echoo_partner";

    runId = await startIngestionRun(supabase, {
      sourceName,
      sourceType: "echoo_partner",
      sourceUrl: payload.sourceUrl,
      metadata: {
        priority: "high",
        note:
          "Echoo manual and partner records receive stronger confidence and editorial ranking signals.",
      },
    });

    const places = rawRecords
      .slice(0, maxRecords)
      .map((record) =>
        partnerRecordToPlace({
          ...record,
          sourceName: record.sourceName || sourceName,
        })
      )
      .filter((place): place is PlaceInput => Boolean(place));
    const summary = await importPlaces(supabase, places);

    await finishIngestionRun(supabase, runId, {
      status: "completed",
      records_seen: rawRecords.length,
      records_imported: summary.imported,
      records_skipped: summary.skipped + rawRecords.length - places.length,
      error_sample: summary.errors,
    });

    return jsonResponse({
      success: true,
      runId,
      summary: { ...summary, filteredOut: rawRecords.length - places.length },
    });
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : "Unknown partner import error";
    await finishIngestionRun(supabase, runId, {
      status: "failed",
      error_sample: [message],
    });
    return jsonResponse({ error: message, runId }, 500);
  }
});
