import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import {
  assertIngestionAuthorized,
  fetchJsonRecords,
  finishIngestionRun,
  GTA_PLACE_COVERAGE_CATEGORIES,
  importPlaces,
  osmElementToPlace,
  osmSourceCoverageRecord,
  type PlaceInput,
  startIngestionRun,
} from "../_shared/ontario-ingestion.ts";

type Payload = {
  /** Returns the protected GTA inventory readiness report without importing. */
  action?: "import" | "coverage" | "finalize_coverage" | "upsert_boundary";
  sourceUrl?: string;
  records?: unknown[];
  sourceName?: string;
  /** Required when the input is clipped to one GTA municipal boundary. */
  municipality?: string;
  /** Identifies one complete, municipality-clipped OSM extract. */
  sourceSnapshotId?: string;
  /** Category census collected from that complete source extract. */
  sourceRecordCounts?: Record<string, unknown>;
  /** One authoritative municipal geometry for the GPS resolver. */
  boundary?: {
    municipality?: unknown;
    regionalMunicipality?: unknown;
    geometry?: unknown;
    sourceName?: unknown;
    sourceUrl?: unknown;
    sourceLicense?: unknown;
    sourceRecordId?: unknown;
  };
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

function clean(value: unknown, max = 160) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function sourceCategoryRecords(records: unknown[]) {
  const idsByCategory = new Map<string, Set<string>>();
  for (const record of records) {
    const sourceRecord = osmSourceCoverageRecord(record);
    if (
      !sourceRecord ||
      !GTA_PLACE_COVERAGE_CATEGORIES.includes(
        sourceRecord.category as (typeof GTA_PLACE_COVERAGE_CATEGORIES)[number],
      )
    ) continue;
    const ids = idsByCategory.get(sourceRecord.category) || new Set<string>();
    ids.add(sourceRecord.sourceId);
    idsByCategory.set(sourceRecord.category, ids);
  }
  return Object.fromEntries(
    [...idsByCategory.entries()].map(([category, ids]) => [category, [...ids]]),
  );
}

function indexedCoverageRecords(places: PlaceInput[]) {
  const idsByCategory = new Map<string, Set<string>>();
  for (const place of places) {
    if (
      !GTA_PLACE_COVERAGE_CATEGORIES.includes(
        place.category as (typeof GTA_PLACE_COVERAGE_CATEGORIES)[number],
      )
    ) continue;
    const ids = idsByCategory.get(place.category) || new Set<string>();
    ids.add(place.sourceId);
    idsByCategory.set(place.category, ids);
  }
  return idsByCategory;
}

function unindexedCoverageCounts(
  sourceRecords: Record<string, string[]>,
  indexedRecords: Map<string, Set<string>>,
) {
  return Object.fromEntries(
    Object.entries(sourceRecords).flatMap(([category, ids]) => {
      const indexed = indexedRecords.get(category) || new Set<string>();
      const missing = ids.filter((id) => !indexed.has(id)).length;
      return missing ? [[category, missing]] : [];
    }),
  );
}

async function finalizeCoverageSnapshot(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  payload: Payload,
) {
  const municipality = clean(payload.municipality, 80);
  const sourceSnapshotId = clean(payload.sourceSnapshotId, 160);
  const sourceName = clean(payload.sourceName || "openstreetmap", 80);
  if (!municipality || !sourceSnapshotId) {
    throw new Error("municipality and sourceSnapshotId are required to finalize coverage.");
  }
  if (sourceName !== "openstreetmap") {
    throw new Error("Only a complete OpenStreetMap extract can finalize GTA place coverage.");
  }
  const submitted = payload.sourceRecordCounts || {};
  const sourceRecordCounts = Object.fromEntries(
    GTA_PLACE_COVERAGE_CATEGORIES.map((category) => {
      const count = Number(submitted[category] || 0);
      return [
        category,
        Number.isFinite(count)
          ? Math.max(0, Math.min(Math.round(count), 1_000_000))
          : 0,
      ];
    }),
  );
  const { data, error } = await supabase.rpc(
    "finalize_gta_osm_coverage_snapshot",
    {
      p_municipality: municipality,
      p_source_snapshot_id: sourceSnapshotId,
      p_source_url: clean(payload.sourceUrl, 500) || null,
      p_source_record_counts: sourceRecordCounts,
    },
  );
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

async function upsertMunicipalityBoundary(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  boundary: Payload["boundary"],
) {
  const feature = boundary || {};
  const geometry = feature.geometry as { type?: unknown; coordinates?: unknown } | undefined;
  if (!geometry || !["Polygon", "MultiPolygon"].includes(String(geometry.type))) {
    throw new Error("Boundary geometry must be a Polygon or MultiPolygon.");
  }
  const municipality = clean(feature.municipality, 80);
  const regionalMunicipality = clean(feature.regionalMunicipality, 80);
  if (!municipality || !regionalMunicipality) {
    throw new Error("Boundary municipality and regionalMunicipality are required.");
  }
  const { data, error } = await supabase.rpc("upsert_gta_municipality_boundary", {
    p_municipality: municipality,
    p_regional_municipality: regionalMunicipality,
    p_boundary_geojson: geometry,
    p_source_name: clean(feature.sourceName || "OpenStreetMap", 160),
    p_source_url: clean(feature.sourceUrl, 500) || null,
    p_source_license: clean(feature.sourceLicense || "ODbL-1.0", 160),
    p_source_record_id: clean(feature.sourceRecordId, 160) || null,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
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
    if (payload.action === "coverage") {
      const { data, error } = await supabase.rpc("gta_municipality_coverage");
      if (error) throw error;
      const coverage = Array.isArray(data) ? data : [];
      const missing = coverage.filter((row) => Number(row.published_entities) === 0);
      const { count: boundaryCount, error: boundaryError } = await supabase
        .from("gta_municipality_boundaries")
        .select("id", { count: "exact", head: true });
      if (boundaryError) throw boundaryError;
      const { data: auditData, error: auditError } = await supabase.rpc(
        "gta_place_source_coverage_audit",
      );
      if (auditError) throw auditError;
      const sourceCoverage = Array.isArray(auditData) ? auditData : [];
      const sourceGaps = sourceCoverage.filter(
        (row) => !row.is_fresh || !row.is_reconciled,
      );
      return jsonResponse({
        success: true,
        coverage,
        sourceCoverage,
        sourceCoverageReady:
          sourceCoverage.length === 25 * GTA_PLACE_COVERAGE_CATEGORIES.length &&
          sourceGaps.length === 0,
        sourceCoverageGaps: sourceGaps,
        boundaryCount: Number(boundaryCount || 0),
        boundaryCoverageReady: Number(boundaryCount || 0) === 25,
        complete: coverage.length === 25 && missing.length === 0,
        missingMunicipalities: missing.map((row) => row.city),
      });
    }

    if (payload.action === "finalize_coverage") {
      return jsonResponse({
        success: true,
        coverageSnapshot: await finalizeCoverageSnapshot(supabase, payload),
      });
    }

    if (payload.action === "upsert_boundary") {
      return jsonResponse({
        success: true,
        boundary: await upsertMunicipalityBoundary(supabase, payload.boundary),
      });
    }

    const maxRecords = asRecordLimit(payload.maxRecords);
    const startAt = asRecordOffset(payload.offset);
    const rawRecords: unknown[] = Array.isArray(payload.records)
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
        municipality: payload.municipality,
        sourceSnapshotId: clean(payload.sourceSnapshotId, 160) || null,
        mode: payload.sourceUrl ? "source_url" : "inline_records",
        note:
          "Worker expects an Ontario/Canada extract converted to JSON/NDJSON/GeoJSON, not Overpass bulk queries.",
      },
    });

    const windowRecords = rawRecords.slice(startAt, startAt + maxRecords);
    const places: PlaceInput[] = [];
    for (const record of windowRecords) {
      const place = osmElementToPlace(record, payload.municipality);
      if (place) {
        places.push({
          ...place,
          sourceSnapshotId: clean(payload.sourceSnapshotId, 160) || undefined,
        });
      }
    }
    const coverageRecords = sourceCategoryRecords(windowRecords);
    const unindexedCoverage = unindexedCoverageCounts(
      coverageRecords,
      indexedCoverageRecords(places),
    );
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
        // IDs, not only counts, let the chunk worker de-duplicate a source
        // record that may appear in more than one geometry representation.
        sourceCategoryIds: coverageRecords,
        sourceCategoryCounts: Object.fromEntries(
          Object.entries(coverageRecords).map(([category, ids]) => [
            category,
            ids.length,
          ]),
        ),
        // A full snapshot may only be finalized when every tracked source
        // record can become a named, geolocated canonical place. Otherwise
        // the coverage job fails visibly instead of certifying a partial map.
        unindexedCoverage: unindexedCoverage,
        unindexedCoverageCount: Object.values(unindexedCoverage).reduce(
          (total, count) => total + Number(count),
          0,
        ),
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
