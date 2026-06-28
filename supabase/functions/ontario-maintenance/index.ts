import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import {
  assertIngestionAuthorized,
  ONTARIO_CITY_BUCKETS,
  TICKETMASTER_CATEGORY_BUCKETS,
} from "../_shared/ontario-ingestion.ts";

type Payload = {
  action?:
    | "ticketmaster_refresh"
    | "stale_event_cleanup"
    | "place_enrichment"
    | "scheduled";
  cities?: string[];
  categories?: string[];
  size?: number;
  limit?: number;
  offset?: number;
  sourceProvider?: string;
  includeExisting?: boolean;
  olderThanHours?: number;
};

function baseFunctionUrl(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (supabaseUrl) {
    return `${supabaseUrl.replace(/\/$/, "")}/functions/v1`;
  }
  const url = new URL(req.url);
  if (url.hostname.includes(".functions.supabase.co")) {
    return url.origin;
  }
  const parts = url.pathname.split("/");
  const functionIndex = parts.findIndex((part) => part === "functions");
  if (functionIndex >= 0) {
    return `${url.origin}/${parts.slice(1, functionIndex + 2).join("/")}`;
  }
  return `${url.origin}/functions/v1`;
}

function ingestionSecret(req: Request) {
  return req.headers.get("x-ingestion-secret") ||
    req.headers.get("x-admin-token") ||
    "";
}

async function invokeTicketmasterRefresh(req: Request, payload: Payload) {
  const refreshPayload = {
    cities: (payload.cities?.length ? payload.cities : ONTARIO_CITY_BUCKETS)
      .slice(0, 40),
    categories: (payload.categories?.length
      ? payload.categories
      : TICKETMASTER_CATEGORY_BUCKETS).slice(0, 12),
    size: Math.max(1, Math.min(Number(payload.size || 20), 50)),
  };
  const response = await fetch(`${baseFunctionUrl(req)}/ticketmaster-ontario-ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ingestion-secret": ingestionSecret(req),
    },
    body: JSON.stringify(refreshPayload),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Ticketmaster refresh failed: ${response.status}`);
  }
  return json;
}

async function cleanupStaleEvents(payload: Payload) {
  const supabase = getSupabaseAdmin();
  const olderThanHours = Math.max(
    0,
    Math.min(Number(payload.olderThanHours ?? 6), 720),
  );
  const { data, error } = await supabase.rpc("cleanup_stale_ontario_events", {
    p_older_than_hours: olderThanHours,
  });
  if (error) throw error;
  return {
    olderThanHours,
    result: Array.isArray(data) ? data[0] : data,
  };
}

async function invokePlaceEnrichment(req: Request, payload: Payload) {
  const enrichPayload = {
    municipality: payload.cities?.[0],
    categories: payload.categories?.length ? payload.categories : undefined,
    sourceProvider: payload.sourceProvider,
    limit: Math.max(1, Math.min(Number(payload.limit || payload.size || 100), 500)),
    offset: Math.max(0, Number(payload.offset || 0)),
    includeExisting: Boolean(payload.includeExisting),
  };
  const response = await fetch(`${baseFunctionUrl(req)}/place-enrich`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ingestion-secret": ingestionSecret(req),
    },
    body: JSON.stringify(enrichPayload),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(json.error || `Place enrichment failed: ${response.status}`);
  }
  return json;
}

async function recordScheduleResult(
  jobName: string,
  status: string,
  summary: Record<string, unknown>,
) {
  const supabase = getSupabaseAdmin();
  await supabase
    .from("ontario_worker_schedules")
    .update({
      last_run_at: new Date().toISOString(),
      last_status: status,
      last_summary: summary,
    })
    .eq("job_name", jobName);
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

  try {
    const payload = (await req.json().catch(() => ({}))) as Payload;
    const action = payload.action || "scheduled";
    const results: Record<string, unknown> = {};

    if (action === "ticketmaster_refresh" || action === "scheduled") {
      const ticketmaster = await invokeTicketmasterRefresh(req, payload);
      results.ticketmaster = ticketmaster;
      await recordScheduleResult(
        "ticketmaster_priority_refresh",
        "completed",
        ticketmaster,
      );
    }

    if (action === "stale_event_cleanup" || action === "scheduled") {
      const staleCleanup = await cleanupStaleEvents(payload);
      results.staleCleanup = staleCleanup;
      await recordScheduleResult(
        "ontario_stale_event_cleanup",
        "completed",
        staleCleanup,
      );
    }

    if (action === "place_enrichment" || action === "scheduled") {
      const enrichment = await invokePlaceEnrichment(req, payload);
      results.placeEnrichment = enrichment;
      await recordScheduleResult(
        "ontario_place_enrichment",
        "completed",
        enrichment,
      );
    }

    return jsonResponse({ success: true, action, results });
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : "Unknown Ontario maintenance error";
    return jsonResponse({ error: message }, 500);
  }
});
