import {
  CORS_HEADERS,
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

async function geocodeWithOpenStreetMap(query: string) {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ca");
  url.searchParams.set("addressdetails", "1");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Echoo MVP geocoder (contact: admin@echoo.app)",
    },
  });
  if (!response.ok) return null;

  const results = await response.json();
  const first = Array.isArray(results) ? results[0] : null;
  if (!first) return null;

  return {
    lat: Number(first.lat),
    lng: Number(first.lon),
    formattedAddress: first.display_name as string,
    provider: "openstreetmap",
    providerId: String(first.place_id),
  };
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const payload = (await req.json()) as NormalizePayload;
    const supabase = getSupabaseAdmin();
    let lat = Number(payload.lat);
    let lng = Number(payload.lng);
    let formattedAddress = payload.formattedAddress || payload.title;
    let placeProvider = payload.placeProvider || null;
    let placeProviderId = payload.placeProviderId || null;

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      const query = [
        payload.formattedAddress || payload.title,
        payload.city,
        "Canada",
      ]
        .filter(Boolean)
        .join(", ");
      if (query.trim().length > 8) {
        const cacheKey = await sha256Hex(`geocode:v1:${query.toLowerCase()}`);
        const cached = await readLocationCache(supabase, cacheKey);
        const geocoded = cached || (await geocodeWithOpenStreetMap(query));
        if (geocoded) {
          await writeLocationCache(
            supabase,
            cacheKey,
            geocoded,
            60 * 60 * 24 * 14,
          );
          lat = Number(geocoded.lat);
          lng = Number(geocoded.lng);
          formattedAddress = geocoded.formattedAddress || formattedAddress;
          placeProvider = placeProvider || geocoded.provider;
          placeProviderId = placeProviderId || geocoded.providerId;
        }
      }
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      await logLocationEvent(supabase, {
        functionName: "location-normalize",
        eventType: "geocode_failed",
        status: "needs_review",
        durationMs: Date.now() - startedAt,
        reason: "missing_coordinates",
        request: {
          title: payload.title,
          formattedAddress: payload.formattedAddress,
          city: payload.city,
        },
        responseSummary: { locationStatus: "needs_review" },
      });
      return jsonResponse(
        {
          supported: false,
          locationStatus: "needs_review",
          reason: "missing_coordinates",
          message:
            "Coordinates are required before a place can enter map search.",
        },
        422,
      );
    }

    if (!isInsideCanadaBounds(lat, lng)) {
      await logLocationEvent(supabase, {
        functionName: "location-normalize",
        eventType: "unsupported_region",
        status: "blocked",
        durationMs: Date.now() - startedAt,
        reason: "outside_canada",
        request: { title: payload.title, lat, lng, city: payload.city },
        responseSummary: { supported: false },
      });
      return jsonResponse(
        {
          supported: false,
          locationStatus: "needs_review",
          reason: "outside_canada",
          message:
            "Echoo is normalizing and publishing Canadian locations first.",
        },
        200,
      );
    }

    const nearest = nearestSupportedCity(lat, lng);
    const manualCity = normalizeCityName(payload.city);
    const region = manualCity || nearest;
    const confidenceScore = Math.max(
      0,
      Math.min(Number(payload.confidenceScore ?? 0.75), 1),
    );
    const isSupportedRegion = true;
    const locationStatus =
      confidenceScore >= 0.65 ? "published" : "needs_review";

    const upsertOptions =
      placeProvider && placeProviderId
        ? { onConflict: "place_provider,place_provider_id" }
        : {};
    const { data, error } = await supabase
      .from("canonical_places")
      .upsert(
        {
          country_code: "CA",
          admin_area_1: region.province,
          city: region.name,
          formatted_address: formattedAddress || `${region.name}, Canada`,
          latitude: lat,
          longitude: lng,
          timezone: region.timezone,
          place_provider: placeProvider,
          place_provider_id: placeProviderId,
          confidence_score: confidenceScore,
          is_supported_region: isSupportedRegion,
          location_status: locationStatus,
        },
        upsertOptions,
      )
      .select()
      .single();

    if (error) throw error;

    await logLocationEvent(supabase, {
      functionName: "location-normalize",
      eventType: Date.now() - startedAt > 1000 ? "slow_geocode" : "normalize",
      durationMs: Date.now() - startedAt,
      countryCode: "CA",
      adminArea1: region.province,
      city: region.name,
      request: {
        title: payload.title,
        city: payload.city,
        hadCoordinates:
          Number.isFinite(payload.lat) && Number.isFinite(payload.lng),
      },
      responseSummary: {
        locationStatus,
        placeId: data.id,
        provider: placeProvider,
      },
    });

    return jsonResponse({
      supported: true,
      locationStatus,
      region,
      nearestSupportedCity: nearest,
      place: data,
    });
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "Unknown location normalization error";
    return jsonResponse({ error: message }, 500);
  }
});
