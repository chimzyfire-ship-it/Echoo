import {
  CORS_HEADERS,
  GTA_REGION,
  resolveOntarioGps,
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

    const rawLat = body.lat ?? url.searchParams.get('lat');
    const rawLng = body.lng ?? url.searchParams.get('lng');
    if ((rawLat != null && rawLat !== '' && lat === undefined) ||
        (rawLng != null && rawLng !== '' && lng === undefined)) {
      return jsonResponse({ error: 'Coordinates must be finite numbers' }, 422);
    }

    if ((lat === undefined) !== (lng === undefined)) {
      return jsonResponse({ error: "lat and lng must be provided together" }, 422);
    }

    if (lat === undefined || lng === undefined) {
      const city = normalizeCityName(suppliedCity || "GTA");
      if (!city) {
        return jsonResponse({
          supported: false,
          reason: "unsupported_municipality",
          message: "Choose a listed Ontario city or GTA municipality.",
        });
      }
      return jsonResponse({
        supported: true,
        scope: "ontario",
        mode: city.coverageLevel === "municipality" ? "manual_city" : "gta_fallback",
        municipality: city.coverageLevel === "municipality" ? city.name : null,
        regionalMunicipality: null,
        label: city.coverageLevel === "municipality"
          ? `Exploring ${city.name}`
          : "Exploring across the GTA",
        timezone: "America/Toronto",
      });
    }

    const resolved = await resolveOntarioGps(getSupabaseAdmin(), lat, lng);
    if (!resolved) {
      return jsonResponse({
        supported: false,
        reason: "outside_ontario",
        message: "Choose a location in Ontario.",
        fallback: GTA_REGION,
      });
    }

    const accuracyMeters = optionalNumber(
      body.accuracyMeters ?? url.searchParams.get("accuracyMeters"),
    );

    return jsonResponse({
      supported: true,
      scope: "ontario",
      mode: "gps_precise",
      municipality: resolved?.municipality || null,
      regionalMunicipality: resolved.regionalMunicipality,
      label: resolved?.municipality
        ? `Near you in ${resolved.municipality}`
        : "Near you in Ontario",
      accuracyMeters: accuracyMeters === undefined
        ? null
        : Math.max(0, Math.round(accuracyMeters)),
    });
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Location context failed" },
      500,
    );
  }
});
