import {
  CORS_HEADERS,
  getSupabaseAdmin,
  haversineMeters,
  jsonResponse,
  logLocationEvent,
  readLocationCache,
  sha256Hex,
  writeLocationCache,
} from "../_shared/location.ts";

const CACHE_TTL_SECONDS = 180;
const LOOKUPS_PER_MINUTE = 12;
const MAX_RESULTS = 3;
const MINIMUM_REVIEW_COUNT = 20;
const NON_HOTEL_NAME_PATTERN = /\b(?:apartment|apartments|condo|condos|furnished|rental|rentals|airbnb|hostel)\b/i;
const NON_HOTEL_TYPES = new Set(["hostel", "guest_house", "bed_and_breakfast", "apartment_building"]);

type LiveStay = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  rating: number | null;
  ratingCount: number | null;
  mapUrl: string;
  websiteUrl: string | null;
  imageUrl: string | null;
  photoCredit: string | null;
  photoCreditUrl: string | null;
};

function cleanText(value: unknown, maxLength = 300) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function validCoordinate(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function safeTimeZone(value: unknown) {
  const candidate = cleanText(value, 80) || "America/Toronto";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format();
    return candidate;
  } catch {
    return "America/Toronto";
  }
}

function localStayMoment(timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date()).map((part) => [part.type, part.value]),
  );
  const hour = Number(parts.hour);
  return {
    timeZone,
    isLateNight: Number.isFinite(hour) && (hour >= 22 || hour < 2),
  };
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
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function signedPhotoUrl(photoName: string) {
  const secret = Deno.env.get("PLACE_MEDIA_SIGNING_SECRET") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  if (!secret || !supabaseUrl || !/^places\/[^/]+\/photos\/[^/]+$/.test(photoName)) {
    return null;
  }
  const token = base64Url(JSON.stringify({ photoName, expiresAt: Date.now() + 5 * 60_000 }));
  const signature = await sign(token, secret);
  return `${supabaseUrl}/functions/v1/place-photo?token=${encodeURIComponent(token)}&signature=${signature}`;
}

function photoAttribution(photo: any) {
  const authors = Array.isArray(photo?.authorAttributions) ? photo.authorAttributions : [];
  const names = authors
    .map((author: any) => cleanText(author?.displayName, 120))
    .filter(Boolean)
    .slice(0, 2);
  const url = authors
    .map((author: any) => cleanText(author?.uri, 500))
    .find((candidate: string) => /^https:\/\//i.test(candidate));
  return {
    credit: names.length ? `Google Maps · ${names.join(", ")}` : "Google Maps",
    url: url || null,
  };
}

function isQualifiedHotel(stay: Omit<LiveStay, "distanceMeters">) {
  // Places can classify a short-term unit as lodging/hotel. A real hotel name,
  // a live photo, and a meaningful review trail make the compact Echoo card
  // much more dependable than returning a nearby condo or one-off rental.
  if (NON_HOTEL_NAME_PATTERN.test(stay.name)) return false;
  if (!stay.imageUrl) return false;
  return Number.isFinite(stay.rating) && Number(stay.ratingCount || 0) >= MINIMUM_REVIEW_COUNT;
}

async function requestIsAllowed(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  req: Request,
) {
  const clientIdentity = req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for") || "anonymous";
  const clientKey = await sha256Hex(`live-stays:${clientIdentity}`);
  const { count } = await (supabase as any)
    .from("location_request_logs")
    .select("id", { count: "exact", head: true })
    .eq("function_name", "live-stays")
    .eq("event_type", "provider_lookup")
    .eq("reason", clientKey)
    .gte("created_at", new Date(Date.now() - 60_000).toISOString());
  return { allowed: Number(count || 0) < LOOKUPS_PER_MINUTE, clientKey };
}

function normalizedResult(place: any): Omit<LiveStay, "distanceMeters"> | null {
  const id = cleanText(place?.id, 180);
  const name = cleanText(place?.displayName?.text, 180);
  const latitude = validCoordinate(place?.location?.latitude, -90, 90);
  const longitude = validCoordinate(place?.location?.longitude, -180, 180);
  if (!id || !name || latitude === null || longitude === null) return null;

  const photo = Array.isArray(place?.photos) ? place.photos[0] : null;
  const attribution = photoAttribution(photo);
  const placeTypes = [place?.primaryType, ...(Array.isArray(place?.types) ? place.types : [])]
    .map((type) => cleanText(type, 80).toLowerCase())
    .filter(Boolean);
  if (placeTypes.some((type) => NON_HOTEL_TYPES.has(type))) return null;
  const imageName = cleanText(photo?.name, 500);
  const rating = Number(place?.rating);
  const ratingCount = Number(place?.userRatingCount);
  return {
    id,
    name,
    address: cleanText(place?.formattedAddress, 280),
    latitude,
    longitude,
    rating: Number.isFinite(rating) ? rating : null,
    ratingCount: Number.isFinite(ratingCount) ? ratingCount : null,
    mapUrl: /^https:\/\//i.test(cleanText(place?.googleMapsUri, 800))
      ? cleanText(place.googleMapsUri, 800)
      : `https://www.google.com/maps/search/?api=1&query_place_id=${encodeURIComponent(id)}`,
    websiteUrl: /^https:\/\//i.test(cleanText(place?.websiteUri, 800))
      ? cleanText(place.websiteUri, 800)
      : null,
    imageUrl: imageName || null,
    photoCredit: attribution.credit,
    photoCreditUrl: attribution.url,
  };
}

async function liveGoogleStays(input: {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  limit: number;
}) {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) throw new Error("Live stay search is not configured.");

  const response = await fetch("https://places.googleapis.com/v1/places:searchNearby", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.photos,places.rating,places.userRatingCount,places.googleMapsUri,places.websiteUri,places.primaryType,places.types",
    },
    body: JSON.stringify({
      // `hotel` excludes condos and other short-term units that can be returned
      // for the wider `lodging` type. Echoo's stay surface is hotel-only.
      includedTypes: ["hotel"],
      maxResultCount: Math.min(Math.max(input.limit * 5, 12), 20),
      rankPreference: "DISTANCE",
      languageCode: "en",
      regionCode: "CA",
      locationRestriction: {
        circle: {
          center: { latitude: input.latitude, longitude: input.longitude },
          radius: input.radiusMeters,
        },
      },
    }),
  });
  if (!response.ok) {
    console.warn("Live stay provider failed:", response.status, await response.text());
    throw new Error("Live stay search is unavailable right now.");
  }

  const payload = await response.json();
  const rawStays = (Array.isArray(payload?.places) ? payload.places : [])
    .map((place: any) => normalizedResult(place))
    .filter(Boolean) as Array<Omit<LiveStay, "distanceMeters">>;
  const uniqueNames = new Set<string>();
  const uniqueStays = rawStays.filter((stay) => {
    const normalizedName = stay.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!normalizedName || uniqueNames.has(normalizedName)) return false;
    uniqueNames.add(normalizedName);
    return isQualifiedHotel(stay);
  });
  const stays = await Promise.all(uniqueStays.map(async (stay) => ({
    ...stay,
    distanceMeters: Math.round(haversineMeters(input.latitude, input.longitude, stay.latitude, stay.longitude)),
    imageUrl: stay.imageUrl ? await signedPhotoUrl(stay.imageUrl) : null,
  })));
  return stays
    // A live photo is mandatory for this visual surface. Returning no result is
    // more honest than filling a hotel card with a generic placeholder.
    .filter((stay) => Boolean(stay.imageUrl))
    .sort((a, b) => a.distanceMeters - b.distanceMeters)
    .slice(0, input.limit);
}

function withReasons(stays: LiveStay[], destinationName: string) {
  return stays.map((stay, index) => ({
    ...stay,
    reason: index === 0
      ? `Closest listed stay to ${destinationName}.`
      : `${Math.max(0.1, stay.distanceMeters / 1000).toFixed(1)} km from ${destinationName}.`,
  }));
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  let request: any = {};
  try {
    request = await req.json();
  } catch {
    return jsonResponse({ error: "A valid JSON request is required." }, 422);
  }

  const latitude = validCoordinate(request?.latitude, -90, 90);
  const longitude = validCoordinate(request?.longitude, -180, 180);
  if (latitude === null || longitude === null) {
    return jsonResponse({ error: "A valid destination is required." }, 422);
  }

  const destinationName = cleanText(request?.destinationName, 140) || "this destination";
  const timeZone = safeTimeZone(request?.timeZone);
  const radiusMeters = Math.min(Math.max(Number(request?.radiusMeters) || 2500, 250), 5000);
  const limit = Math.min(Math.max(Number(request?.limit) || MAX_RESULTS, 1), MAX_RESULTS);
  const cacheKey = `live-stays:v4:${latitude.toFixed(3)}:${longitude.toFixed(3)}:${Math.round(radiusMeters / 100)}:${limit}`;
  const supabase = getSupabaseAdmin();

  try {
    const cached = await readLocationCache(supabase, cacheKey) as LiveStay[] | null;
    if (cached) {
      await logLocationEvent(supabase, {
        functionName: "live-stays",
        eventType: "provider_lookup",
        status: "cache_hit",
        cacheHit: true,
        durationMs: Date.now() - startedAt,
        request: { destination: destinationName, radiusMeters },
        responseSummary: { stayCount: cached.length },
      });
      return jsonResponse({
        destinationName,
        lateNight: localStayMoment(timeZone),
        source: "Google Maps",
        stays: withReasons(cached, destinationName),
      });
    }

    const rate = await requestIsAllowed(supabase, req);
    if (!rate.allowed) {
      await logLocationEvent(supabase, {
        functionName: "live-stays",
        eventType: "provider_lookup",
        status: "rate_limited",
        durationMs: Date.now() - startedAt,
        reason: rate.clientKey,
        request: { destination: destinationName, radiusMeters },
      });
      return jsonResponse({ error: "Too many stay searches. Please try again in a minute." }, 429);
    }

    const stays = await liveGoogleStays({ latitude, longitude, radiusMeters, limit });
    await writeLocationCache(supabase, cacheKey, stays, CACHE_TTL_SECONDS);
    await logLocationEvent(supabase, {
      functionName: "live-stays",
      eventType: "provider_lookup",
      status: "ok",
      durationMs: Date.now() - startedAt,
      reason: rate.clientKey,
      request: { destination: destinationName, radiusMeters },
      responseSummary: { stayCount: stays.length },
    });
    return jsonResponse({
      destinationName,
      lateNight: localStayMoment(timeZone),
      source: "Google Maps",
      stays: withReasons(stays, destinationName),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Live stay search is unavailable right now.";
    await logLocationEvent(supabase, {
      functionName: "live-stays",
      eventType: "provider_lookup",
      status: "error",
      durationMs: Date.now() - startedAt,
      request: { destination: destinationName, radiusMeters },
      responseSummary: { message },
    });
    return jsonResponse({ error: message }, 503);
  }
});
