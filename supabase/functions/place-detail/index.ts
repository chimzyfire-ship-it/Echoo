import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
  logLocationEvent,
} from "../_shared/location.ts";

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return { data, error: null, meta };
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET") {
    return jsonResponse({ data: null, error: "Method not allowed", meta: {} }, 405);
  }

  const supabase = getSupabaseAdmin();

  try {
    const url = new URL(req.url);
    const id = cleanText(url.searchParams.get("id"));
    if (!id) {
      return jsonResponse({ data: null, error: "id is required.", meta: {} }, 422);
    }

    const { data: place, error: placeError } = await supabase
      .from("canonical_places")
      .select("*")
      .eq("id", id)
      .eq("country_code", "CA")
      .eq("admin_area_1", "ON")
      .eq("is_supported_region", true)
      .eq("location_status", "published")
      .maybeSingle();
    if (placeError) throw placeError;
    if (!place) {
      return jsonResponse({ data: null, error: "Place not found.", meta: {} }, 404);
    }

    const [profile, hours, sources, photos, relatedEvents, alternatives] =
      await Promise.all([
        supabase
          .from("place_profiles")
          .select("*")
          .eq("place_id", place.id)
          .maybeSingle(),
        supabase
          .from("place_hours")
          .select("*")
          .eq("place_id", place.id)
          .order("day_of_week", { ascending: true }),
        supabase
          .from("place_sources")
          .select(
            "source_name, source_url, source_license, source_record_id, fetched_at",
          )
          .eq("place_id", place.id)
          .order("fetched_at", { ascending: false }),
        supabase
          .from("place_photos")
          .select(
            "id, image_url, alt_text, caption, attribution, source_name, source_url, sort_order",
          )
          .eq("place_id", place.id)
          .eq("approval_status", "approved")
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true })
          .limit(8),
        supabase
          .from("ontario_events")
          .select("*")
          .eq("place_id", place.id)
          .eq("status", "published")
          .gte("starts_at", new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString())
          .order("starts_at", { ascending: true })
          .limit(10),
        supabase.rpc("search_ontario_places", {
          p_query: null,
          p_city: place.municipality || place.city,
          p_lat: place.latitude,
          p_lng: place.longitude,
          p_radius_meters: 5000,
          p_category: place.category,
          p_limit: 6,
        }),
      ]);

    for (const result of [profile, hours, sources, photos, relatedEvents, alternatives]) {
      if (result.error) throw result.error;
    }

    const nearbyAlternatives = (alternatives.data || [])
      .filter((item: any) => item.id !== place.id)
      .slice(0, 5)
      .map((item: any) => ({
        id: item.id,
        title: item.name,
        category: item.category,
        subcategory: item.subcategory,
        city: item.municipality || item.city,
        address: item.address,
        latitude: item.latitude,
        longitude: item.longitude,
        distanceMeters: item.distance_meters,
        confidenceScore: item.confidence_score,
        rankScore: item.rank_score,
      }));

    await logLocationEvent(supabase, {
      functionName: "place-detail",
      eventType: Date.now() - startedAt > 750 ? "slow_detail" : "detail",
      durationMs: Date.now() - startedAt,
      countryCode: "CA",
      adminArea1: "ON",
      city: place.municipality || place.city,
      request: { id },
      responseSummary: {
        placeId: place.id,
        hasProfile: Boolean(profile.data),
        sourceCount: sources.data?.length || 0,
        photoCount: photos.data?.length || 0,
        relatedEventCount: relatedEvents.data?.length || 0,
      },
    });

    return jsonResponse(
      envelope(
        {
          place,
          profile: profile.data || null,
          hours: hours.data || [],
          sources: sources.data || [],
          photos: photos.data || [],
          relatedEvents: relatedEvents.data || [],
          alternatives: nearbyAlternatives,
          sourceStatus: {
            hasProfile: Boolean(profile.data),
            sourceCount: sources.data?.length || 0,
            confidenceScore: Math.max(
              Number(place.confidence_score || 0),
              Number(profile.data?.confidence_score || 0),
            ),
          },
          detailStatus: {
            isFeatureReady: Boolean(
              place.name &&
                (place.formatted_address || place.address) &&
                (sources.data?.length || 0) > 0 &&
                (photos.data?.length || 0) > 0,
            ),
            photoCount: photos.data?.length || 0,
          },
        },
        { durationMs: Date.now() - startedAt },
      ),
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown place detail error";
    return jsonResponse({ data: null, error: message, meta: {} }, 500);
  }
});
