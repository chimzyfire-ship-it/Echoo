import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
  logLocationEvent,
  sha256Hex,
} from "../_shared/location.ts";

const GOOGLE_PHOTO_LIMIT = 6;
const GOOGLE_LOOKUPS_PER_MINUTE = 12;
type LivePhotoResult = {
  photos: Array<Record<string, unknown>>;
  status: string;
  clientKey?: string;
};

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return { data, error: null, meta };
}

function normalizedName(value: unknown) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function namesMatch(placeName: unknown, candidateName: unknown, distance: number) {
  const expected = normalizedName(placeName);
  const received = normalizedName(candidateName);
  if (!expected || !received) return false;
  if (expected === received) return true;
  if (distance > 60) return false;
  const expectedWords = new Set(expected.split(" "));
  const candidateWords = new Set(received.split(" "));
  const smaller = expectedWords.size <= candidateWords.size ? expectedWords : candidateWords;
  const larger = smaller === expectedWords ? candidateWords : expectedWords;
  return [...smaller].every((word) => larger.has(word));
}

function metersBetween(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number,
) {
  const radians = (value: number) => value * Math.PI / 180;
  const earthRadius = 6_371_000;
  const latDelta = radians(latitudeB - latitudeA);
  const lonDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latDelta / 2) ** 2 +
    Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) *
      Math.sin(lonDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function base64Url(value: string) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signedPhotoUrl(photoName: string) {
  const secret = Deno.env.get("PLACE_MEDIA_SIGNING_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!secret || !supabaseUrl || !/^places\/[^/]+\/photos\/[^/]+$/.test(photoName)) {
    return null;
  }
  const token = base64Url(JSON.stringify({ photoName, expiresAt: Date.now() + 5 * 60_000 }));
  const signature = await sign(token, secret);
  return `${supabaseUrl}/functions/v1/place-photo?token=${encodeURIComponent(token)}&signature=${signature}`;
}

async function resolveGooglePlaceId(supabase: ReturnType<typeof getSupabaseAdmin>, place: any, apiKey: string) {
  if (cleanText(place.google_place_id)) return cleanText(place.google_place_id);
  if (cleanText(place.source_provider) === "google_places" && cleanText(place.source_id)) {
    return cleanText(place.source_id).replace(/^(places\/|google:)/, "");
  }

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location",
    },
    body: JSON.stringify({
      textQuery: `${place.name} ${place.formatted_address || place.address}`,
      languageCode: "en",
      regionCode: "CA",
      locationBias: {
        circle: {
          center: { latitude: Number(place.latitude), longitude: Number(place.longitude) },
          radius: 250,
        },
      },
      maxResultCount: 1,
    }),
  });
  if (!response.ok) return null;
  const candidate = (await response.json())?.places?.[0];
  const distance = metersBetween(
    Number(place.latitude),
    Number(place.longitude),
    Number(candidate?.location?.latitude),
    Number(candidate?.location?.longitude),
  );
  if (
    !candidate?.id ||
    !namesMatch(place.name, candidate.displayName?.text, distance) ||
    !Number.isFinite(distance) ||
    distance > 180
  ) return null;

  // Google permits caching place IDs. No photo metadata or media is stored.
  await supabase
    .from("canonical_places")
    .update({ google_place_id: candidate.id, google_place_matched_at: new Date().toISOString() })
    .eq("id", place.id);
  return candidate.id;
}

async function isGoogleLookupAllowed(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  req: Request,
  placeId: string,
) {
  const clientKey = await sha256Hex(
    `${req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "anonymous"}:${placeId}`,
  );
  const { count } = await (supabase as any)
    .from("location_request_logs")
    .select("id", { count: "exact", head: true })
    .eq("function_name", "place-detail")
    .eq("event_type", "google_photo_lookup")
    .eq("reason", clientKey)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  return { allowed: Number(count || 0) < GOOGLE_LOOKUPS_PER_MINUTE, clientKey };
}

async function loadLiveGooglePhotos(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  req: Request,
  place: any,
): Promise<LivePhotoResult> {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey || !Deno.env.get("PLACE_MEDIA_SIGNING_SECRET")) return { photos: [], status: "not_configured" };

  const rate = await isGoogleLookupAllowed(supabase, req, place.id);
  if (!rate.allowed) return { photos: [], status: "rate_limited", clientKey: rate.clientKey };

  const googlePlaceId = await resolveGooglePlaceId(supabase, place, apiKey);
  if (!googlePlaceId) return { photos: [], status: "no_match", clientKey: rate.clientKey };

  const response = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}`, {
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "photos",
    },
  });
  if (!response.ok) return { photos: [], status: "provider_error", clientKey: rate.clientKey };
  const payload = await response.json();
  const photos = await Promise.all(
    (payload.photos || []).slice(0, GOOGLE_PHOTO_LIMIT).map(async (photo: any) => {
      const imageUrl = await signedPhotoUrl(cleanText(photo.name));
      if (!imageUrl) return null;
      const photographer = (photo.authorAttributions || [])
        .map((author: any) => cleanText(author.displayName))
        .filter(Boolean)
        .join(", ");
      const photographerUrl = (photo.authorAttributions || [])
        .map((author: any) => cleanText(author.uri))
        .find((uri: string) => /^https?:\/\//i.test(uri));
      return {
        image_url: imageUrl,
        alt_text: cleanText(place.name),
        attribution: photographer ? `Google Maps · ${photographer}` : "Google Maps",
        attribution_url: photographerUrl || null,
        source_name: "Google Maps",
        source_url: null,
      };
    }),
  );
  return { photos: photos.filter(Boolean), status: "loaded", clientKey: rate.clientKey };
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

    const approvedPhotos = photos.data || [];
    const livePhotoResult = approvedPhotos.length
      ? { photos: [], status: "approved_photos" }
      : await loadLiveGooglePhotos(supabase, req, place);
    if (livePhotoResult.clientKey) {
      await logLocationEvent(supabase, {
        functionName: "place-detail",
        eventType: "google_photo_lookup",
        status: livePhotoResult.status === "loaded" ? "ok" : livePhotoResult.status,
        reason: livePhotoResult.clientKey,
        countryCode: "CA",
        adminArea1: "ON",
        city: place.municipality || place.city,
        responseSummary: { count: livePhotoResult.photos.length },
      });
    }
    const displayPhotos = approvedPhotos.length ? approvedPhotos : livePhotoResult.photos;

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
        photoCount: displayPhotos.length,
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
          photos: displayPhotos,
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
                displayPhotos.length > 0,
            ),
            photoCount: displayPhotos.length,
            photoOrigin: approvedPhotos.length ? "approved" : livePhotoResult.status,
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
