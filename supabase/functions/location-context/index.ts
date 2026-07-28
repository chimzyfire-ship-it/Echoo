import {
  CORS_HEADERS,
  GTA_REGION,
  isInsideGtaBounds,
  jsonResponse,
  normalizeCityName,
  getSupabaseAdmin,
} from "../_shared/location.ts";

type Payload = {
  lat?: unknown;
  lng?: unknown;
  city?: unknown;
  accuracyMeters?: unknown;
};

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function clean(value: unknown) {
  return String(value || "").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const body: Payload = req.method === "POST"
      ? await req.json().catch(() => ({}))
      : {};
    const lat = optionalNumber(body.lat ?? url.searchParams.get("lat"));
    const lng = optionalNumber(body.lng ?? url.searchParams.get("lng"));
    const suppliedCity = clean(body.city ?? url.searchParams.get("city"));

    if ((lat === undefined) !== (lng === undefined)) {
      return jsonResponse({ error: "lat and lng must be provided together" }, 422);
    }

    if (lat === undefined || lng === undefined) {
      const city = normalizeCityName(suppliedCity || "GTA");
      if (!city) {
        return jsonResponse({
          supported: false,
          reason: "unsupported_municipality",
          message: "Choose one of Echoo's 25 GTA municipalities.",
        });
      }
      return jsonResponse({
        supported: true,
        scope: "gta",
        mode: city.coverageLevel === "municipality" ? "manual_city" : "gta_fallback",
        municipality: city.coverageLevel === "municipality" ? city.name : null,
        regionalMunicipality: null,
        label: city.coverageLevel === "municipality"
          ? `Exploring ${city.name}`
          : "Exploring across the GTA",
        timezone: "America/Toronto",
      });
    }

    if (!isInsideGtaBounds(lat, lng)) {
      return jsonResponse({
        supported: false,
        reason: "outside_gta",
        message: "Echoo is currently live across the Greater Toronto Area.",
        fallback: GTA_REGION,
      });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.rpc("resolve_gta_municipality", {
      p_lat: lat,
      p_lng: lng,
    });
    if (error) throw error;
    const resolved = Array.isArray(data) ? data[0] : null;
    const { count: boundaryCount, error: boundaryCountError } = await supabase
      .from("gta_municipality_boundaries")
      .select("id", { count: "exact", head: true });
    if (boundaryCountError) throw boundaryCountError;
    if (!resolved?.municipality && Number(boundaryCount || 0) >= 25) {
      return jsonResponse({
        supported: false,
        reason: "outside_gta",
        message: "Echoo is currently live across the Greater Toronto Area.",
        fallback: GTA_REGION,
      });
    }
    const accuracyMeters = optionalNumber(
      body.accuracyMeters ?? url.searchParams.get("accuracyMeters"),
    );

    // Never assign a municipality from a centroid. Until all 25 official
    // boundaries are loaded, exact coordinates can still power distance ranking
    // but the UI stays GTA-wide rather than mislabelling the user.
    return jsonResponse({
      supported: true,
      scope: "gta",
      mode: "gps_precise",
      municipality: resolved?.municipality || null,
      regionalMunicipality: resolved?.regional_municipality || null,
      label: resolved?.municipality
        ? `Near you in ${resolved.municipality}`
        : "Near you in the GTA",
      timezone: resolved?.timezone || "America/Toronto",
      accuracyMeters: accuracyMeters === undefined
        ? null
        : Math.max(0, Math.round(accuracyMeters)),
      boundaryResolved: Boolean(resolved?.municipality),
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Location context failed" },
      500,
    );
  }
});
