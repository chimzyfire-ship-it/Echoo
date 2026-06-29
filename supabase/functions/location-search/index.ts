import {
  CORS_HEADERS,
  clampLimit,
  clampRadiusMeters,
  getSupabaseAdmin,
  isInsideCanadaBounds,
  jsonResponse,
  logLocationEvent,
  nearestSupportedCity,
  normalizeCityName,
  readLocationCache,
  sha256Hex,
  writeLocationCache,
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
  const startedAt = Date.now();
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const body =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const payload: SearchPayload = {
      lat: optionalNumber(body.lat ?? url.searchParams.get("lat")),
      lng: optionalNumber(body.lng ?? url.searchParams.get("lng")),
      city: body.city ?? url.searchParams.get("city") ?? undefined,
      radiusMeters: optionalNumber(
        body.radiusMeters ?? url.searchParams.get("radiusMeters"),
      ),
      entityType:
        body.entityType ?? url.searchParams.get("entityType") ?? undefined,
      category: body.category ?? url.searchParams.get("category") ?? undefined,
      limit: optionalNumber(body.limit ?? url.searchParams.get("limit")),
    };

    const radiusMeters = clampRadiusMeters(payload.radiusMeters);
    const limit = clampLimit(payload.limit);
    const supabase = getSupabaseAdmin();
    const cacheKey = await sha256Hex(
      JSON.stringify({
        v: 1,
        lat: payload.lat ? Number(payload.lat).toFixed(4) : null,
        lng: payload.lng ? Number(payload.lng).toFixed(4) : null,
        city: payload.city || null,
        radiusMeters,
        entityType: payload.entityType || null,
        category: payload.category || null,
        limit,
      }),
    );
    const cached = await readLocationCache(supabase, cacheKey);
    if (cached) {
      await logLocationEvent(supabase, {
        functionName: "location-search",
        eventType: "cache_hit",
        cacheHit: true,
        durationMs: Date.now() - startedAt,
        city: typeof payload.city === "string" ? payload.city : null,
        request: {
          city: payload.city,
          radiusMeters,
          entityType: payload.entityType,
          category: payload.category,
          limit,
        },
        responseSummary: { cached: true },
      });
      return jsonResponse(cached);
    }

    if (Number.isFinite(payload.lat) && Number.isFinite(payload.lng)) {
      const lat = Number(payload.lat);
      const lng = Number(payload.lng);

      if (!isInsideCanadaBounds(lat, lng)) {
        const response = {
          supported: false,
          reason: "outside_ontario",
          message: "Echoo is focused on Ontario and the GTA first.",
          results: [],
        };
        await logLocationEvent(supabase, {
          functionName: "location-search",
          eventType: "unsupported_region",
          status: "blocked",
          durationMs: Date.now() - startedAt,
          reason: "outside_ontario",
          request: { lat, lng, radiusMeters, limit },
          responseSummary: { supported: false },
        });
        return jsonResponse(response, 200);
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

      const response = {
        supported: true,
        mode: "nearby",
        region,
        radiusMeters,
        results: data || [],
      };
      await writeLocationCache(supabase, cacheKey, response, 90);
      await logLocationEvent(supabase, {
        functionName: "location-search",
        eventType: Date.now() - startedAt > 750 ? "slow_search" : "search",
        durationMs: Date.now() - startedAt,
        countryCode: "CA",
        adminArea1: region.province,
        city: region.name,
        request: {
          lat,
          lng,
          radiusMeters,
          entityType: payload.entityType,
          category: payload.category,
          limit,
        },
        responseSummary: { count: response.results.length },
      });
      return jsonResponse(response);
    }

    const city = normalizeCityName(payload.city || "Ontario");
    if (!city) {
      const response = {
        supported: false,
        reason: "unsupported_city",
        message:
          "Echoo is active across Ontario first. Choose Ontario or a supported Ontario city.",
        results: [],
      };
      await logLocationEvent(supabase, {
        functionName: "location-search",
        eventType: "unsupported_region",
        status: "blocked",
        durationMs: Date.now() - startedAt,
        reason: "unsupported_city",
        request: { city: payload.city, limit },
        responseSummary: { supported: false },
      });
      return jsonResponse(response, 200);
    }

    const { data, error } = await supabase.rpc("search_region_entities", {
      p_country_code: "CA",
      p_admin_area_1: city.province,
      p_city: city.coverageLevel === "province" ? null : city.name,
      p_entity_type: payload.entityType || null,
      p_category: payload.category || null,
      p_limit: limit,
    });

    if (error) throw error;

    const response = {
      supported: true,
      mode: "city",
      region: city,
      results: data || [],
    };
    await writeLocationCache(supabase, cacheKey, response, 180);
    await logLocationEvent(supabase, {
      functionName: "location-search",
      eventType: Date.now() - startedAt > 750 ? "slow_search" : "search",
      durationMs: Date.now() - startedAt,
      countryCode: "CA",
      adminArea1: city.province,
      city: city.name,
      request: {
        city: payload.city,
        entityType: payload.entityType,
        category: payload.category,
        limit,
      },
      responseSummary: { count: response.results.length },
    });
    return jsonResponse(response);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown location search error";
    return jsonResponse({ error: message }, 500);
  }
});
