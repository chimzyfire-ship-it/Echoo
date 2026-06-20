import {
  CORS_HEADERS,
  getSupabaseAdmin,
  isInsideCanadaBounds,
  jsonResponse,
  nearestSupportedCity,
  normalizeCityName,
} from "../_shared/location.ts";

type NormalizePayload = {
  title?: string;
  formattedAddress?: string;
  city?: string;
  lat?: number;
  lng?: number;
  placeProvider?: string;
  placeProviderId?: string;
  confidenceScore?: number;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = (await req.json()) as NormalizePayload;
    const lat = Number(payload.lat);
    const lng = Number(payload.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return jsonResponse({
        supported: false,
        locationStatus: "needs_review",
        reason: "missing_coordinates",
        message: "Coordinates are required before a place can enter map search.",
      }, 422);
    }

    if (!isInsideCanadaBounds(lat, lng)) {
      return jsonResponse({
        supported: false,
        locationStatus: "needs_review",
        reason: "outside_canada",
        message: "Echoo is normalizing and publishing Canadian locations first.",
      }, 200);
    }

    const nearest = nearestSupportedCity(lat, lng);
    const manualCity = normalizeCityName(payload.city);
    const region = manualCity || nearest;
    const confidenceScore = Math.max(0, Math.min(Number(payload.confidenceScore ?? 0.75), 1));
    const isSupportedRegion = true;
    const locationStatus = confidenceScore >= 0.65 ? "published" : "needs_review";

    const supabase = getSupabaseAdmin();
    const upsertOptions = payload.placeProvider && payload.placeProviderId
      ? { onConflict: "place_provider,place_provider_id" }
      : {};
    const { data, error } = await supabase
      .from("canonical_places")
      .upsert({
        country_code: "CA",
        admin_area_1: region.province,
        city: region.name,
        formatted_address: payload.formattedAddress || payload.title || `${region.name}, Canada`,
        latitude: lat,
        longitude: lng,
        timezone: region.timezone,
        place_provider: payload.placeProvider || null,
        place_provider_id: payload.placeProviderId || null,
        confidence_score: confidenceScore,
        is_supported_region: isSupportedRegion,
        location_status: locationStatus,
      }, upsertOptions)
      .select()
      .single();

    if (error) throw error;

    return jsonResponse({
      supported: true,
      locationStatus,
      region,
      nearestSupportedCity: nearest,
      place: data,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown location normalization error";
    return jsonResponse({ error: message }, 500);
  }
});
