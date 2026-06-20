import {
  CORS_HEADERS,
  clampLimit,
  clampRadiusMeters,
  getSupabaseAdmin,
  isInsideCanadaBounds,
  jsonResponse,
  nearestSupportedCity,
  normalizeCityName,
} from "../_shared/location.ts";

type SearchPayload = {
  lat?: number;
  lng?: number;
  city?: string;
  radiusMeters?: number;
  entityType?: string;
  category?: string;
  limit?: number;
};

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const payload: SearchPayload = {
      lat: optionalNumber(body.lat ?? url.searchParams.get("lat")),
      lng: optionalNumber(body.lng ?? url.searchParams.get("lng")),
      city: body.city ?? url.searchParams.get("city") ?? undefined,
      radiusMeters: optionalNumber(body.radiusMeters ?? url.searchParams.get("radiusMeters")),
      entityType: body.entityType ?? url.searchParams.get("entityType") ?? undefined,
      category: body.category ?? url.searchParams.get("category") ?? undefined,
      limit: optionalNumber(body.limit ?? url.searchParams.get("limit")),
    };

    const radiusMeters = clampRadiusMeters(payload.radiusMeters);
    const limit = clampLimit(payload.limit);
    const supabase = getSupabaseAdmin();

    if (Number.isFinite(payload.lat) && Number.isFinite(payload.lng)) {
      const lat = Number(payload.lat);
      const lng = Number(payload.lng);

      if (!isInsideCanadaBounds(lat, lng)) {
        return jsonResponse({
          supported: false,
          reason: "outside_canada",
          message: "Echoo is launching location discovery in Canada first.",
          results: [],
        }, 200);
      }

      const region = nearestSupportedCity(lat, lng);
      const { data, error } = await supabase.rpc("search_nearby_entities", {
        p_lat: lat,
        p_lng: lng,
        p_radius_meters: radiusMeters,
        p_entity_type: payload.entityType || null,
        p_category: payload.category || null,
        p_limit: limit,
      });

      if (error) throw error;

      return jsonResponse({
        supported: true,
        mode: "nearby",
        region,
        radiusMeters,
        results: data || [],
      });
    }

    const city = normalizeCityName(payload.city || "Toronto");
    if (!city) {
      return jsonResponse({
        supported: false,
        reason: "unsupported_city",
        message: "Echoo is active across Canada first. Choose a supported Canadian launch city.",
        results: [],
      }, 200);
    }

    const { data, error } = await supabase.rpc("search_region_entities", {
      p_country_code: "CA",
      p_admin_area_1: city.province,
      p_city: city.name,
      p_entity_type: payload.entityType || null,
      p_category: payload.category || null,
      p_limit: limit,
    });

    if (error) throw error;

    return jsonResponse({
      supported: true,
      mode: "city",
      region: city,
      results: data || [],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown location search error";
    return jsonResponse({ error: message }, 500);
  }
});
