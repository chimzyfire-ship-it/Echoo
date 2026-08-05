import {
  CORS_HEADERS,
  clampRadiusMeters,
  GTA_REGION,
  getSupabaseAdmin,
  isInsideGtaBounds,
  jsonResponse,
  normalizeCityName,
  readLocationCache,
  sha256Hex,
  writeLocationCache,
} from "../_shared/location.ts";
import {
  cleanDiscoveryText,
  clampDiscoveryLimit,
  decodeDiscoveryCursor,
  encodeDiscoveryCursor,
  matchedFeatureSlugs,
  optionalDiscoveryNumber,
  type DiscoveryFeature,
} from "../_shared/hybrid-discovery.ts";

type ExplorePayload = {
  query?: unknown;
  city?: unknown;
  lat?: unknown;
  lng?: unknown;
  radiusMeters?: unknown;
  category?: unknown;
  featureSlugs?: unknown;
  preferenceFeatureSlugs?: unknown;
  limit?: unknown;
  cursor?: unknown;
  livePageToken?: unknown;
  includeLiveFallback?: unknown;
};

type OwnedResult = Record<string, any>;
type LiveSearchResponse = {
  results: Array<Record<string, any>>;
  nextPageToken: string | null;
};

function stringArray(value: unknown, max = 8) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => cleanDiscoveryText(item, 48).toLowerCase())
        .filter(Boolean),
    ),
  ].slice(0, max);
}

async function resolveGpsCity(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  lat: number,
  lng: number,
) {
  // A municipality is a legal boundary, not the closest city centre. The
  // fallback deliberately remains GTA-wide until the official polygon resolver
  // can name a municipality with confidence.
  try {
    const { data, error } = await supabase.rpc("resolve_gta_municipality", {
      p_lat: lat,
      p_lng: lng,
    });
    if (error) throw error;
    const match = (Array.isArray(data) ? data[0] : null) as {
      municipality?: string;
    } | null;
    const municipality = normalizeCityName(match?.municipality);
    if (municipality?.coverageLevel === "municipality") {
      return { ...municipality, resolution: "boundary" as const };
    }
  } catch (error) {
    console.warn(
      "Explore municipality resolver unavailable:",
      cleanDiscoveryText((error as Error)?.message, 160),
    );
  }
  return { ...GTA_REGION, resolution: "gta_fallback" as const };
}

function asBoolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}

function ownedCard(item: OwnedResult) {
  const coverUrl = cleanDiscoveryText(item.cover_url, 500);
  return {
    id: item.id,
    canonicalId: item.entity_id || null,
    source: "echoo",
    type: item.entity_type === "event" ? "event" : "place",
    title: item.title,
    category: item.category || item.entity_type,
    description: item.description || "",
    city: item.city || "Greater Toronto Area",
    address: null,
    latitude: optionalDiscoveryNumber(item.latitude),
    longitude: optionalDiscoveryNumber(item.longitude),
    distanceMeters: optionalDiscoveryNumber(item.distance_meters),
    startsAt: item.starts_at || null,
    image: coverUrl
      ? {
          storagePath: coverUrl,
          alt: item.cover_alt_text || item.title,
          source: "echoo_approved",
        }
      : null,
    features: item.feature_slugs || [],
    community: {
      ratingAverage:
        item.rating_average === null
          ? null
          : optionalDiscoveryNumber(item.rating_average),
      ratingCount: Number(item.rating_count || 0),
      verifiedVisitCount: Number(item.verified_visit_count || 0),
      saveCount: Number(item.save_count || 0),
      hotScore: optionalDiscoveryNumber(item.hot_score) || 0,
      isHot: Number(item.hot_score || 0) > 0,
    },
    placement: item.is_registered
      ? {
        // Never present paid placement as an organic community endorsement.
        label: item.placement_tier === "top_pick" ? "Top Pick" : "Registered business",
        tier: item.placement_tier || "registered",
        sponsored: true,
      }
      : null,
    rankScore: optionalDiscoveryNumber(item.rank_score) || 0,
  };
}

function base64Url(value: string) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
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

async function signedPhotoUrl(req: Request, photoName: unknown) {
  const name = cleanDiscoveryText(photoName, 500);
  const secret = cleanDiscoveryText(Deno.env.get("PLACE_MEDIA_SIGNING_SECRET"), 500);
  if (!secret || !/^places\/[^/]+\/photos\/[^/]+$/.test(name)) return null;
  const token = base64Url(JSON.stringify({ photoName: name, expiresAt: Date.now() + 6 * 60_000 }));
  const signature = await sign(token, secret);
  const url = new URL(req.url);
  return `${url.origin}/functions/v1/place-photo?token=${encodeURIComponent(token)}&signature=${signature}`;
}

async function providerFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMs: number,
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizedName(value: unknown) {
  return cleanDiscoveryText(value, 200)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function namesMatch(a: unknown, b: unknown) {
  const left = normalizedName(a);
  const right = normalizedName(b);
  if (!left || !right) return false;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftWords = new Set(left.split(" ").filter((word) => word.length > 2));
  const rightWords = new Set(right.split(" ").filter((word) => word.length > 2));
  const shared = [...leftWords].filter((word) => rightWords.has(word));
  return shared.length >= Math.min(2, leftWords.size, rightWords.size);
}

function discoveryResultKey(item: Record<string, any>) {
  const title = normalizedName(item.title);
  return title ? `${cleanDiscoveryText(item.type, 30)}:${title}` : cleanDiscoveryText(item.id, 220);
}

function normalizedLiveQuery(query: string, category: string | null) {
  const normalized = cleanDiscoveryText(query || category || "things to do", 120)
    .replace(/\b(restaurants?|resturants?|restaraunts?)\b/gi, "restaurant");
  return normalized || "things to do";
}

// Echoo's owned search index is intentionally exact and fast. Convert common
// broad intents to the catalogue's canonical category word instead of asking
// it to match an entire sentence such as "food dinner date night".
function ownedInventoryQuery(query: string) {
  const text = normalizedLiveQuery(query, null).toLowerCase();
  // “Trending” is a browse mode, not a literal venue name. Leaving it as a
  // text predicate would hide the whole owned catalogue unless a place happened
  // to contain the word “popular” in its title or description.
  if (/\b(trending|popular)\b|\bthings to do\b/.test(text)) return "";
  if (/\b(restaurant|food|dining|eat|brunch|lunch|dinner|tasting|bakery)\b/.test(text)) return "restaurant";
  if (/\b(cafe|coffee|espresso)\b/.test(text)) return "cafe";
  if (/\b(bar|pub|nightlife|lounge)\b/.test(text)) return "bar";
  if (/\b(park|nature|trail|outdoor|walk)\b/.test(text)) return "park";
  if (/\b(museum|gallery|tourism|landmark|attraction)\b/.test(text)) return "museum";
  return text;
}

function metersBetween(
  originLat?: number,
  originLng?: number,
  destinationLat?: number,
  destinationLng?: number,
) {
  if (![originLat, originLng, destinationLat, destinationLng].every(Number.isFinite)) return undefined;
  const radians = Math.PI / 180;
  const latDelta = (Number(destinationLat) - Number(originLat)) * radians;
  const lngDelta = (Number(destinationLng) - Number(originLng)) * radians;
  const a = Math.sin(latDelta / 2) ** 2 + Math.cos(Number(originLat) * radians) * Math.cos(Number(destinationLat) * radians) * Math.sin(lngDelta / 2) ** 2;
  return Math.round(6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function photoForOwnedCard(input: {
  req: Request;
  supabase: ReturnType<typeof getSupabaseAdmin>;
  card: Record<string, any>;
  googlePlaceId?: string;
}) {
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey || !Deno.env.get("PLACE_MEDIA_SIGNING_SECRET")) return null;
  let googlePlaceId = cleanDiscoveryText(input.googlePlaceId, 180);
  let photoName = "";

  try {
    if (googlePlaceId) {
      const response = await providerFetch(
        `https://places.googleapis.com/v1/places/${encodeURIComponent(googlePlaceId)}`,
        {
          headers: {
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": "photos",
          },
        },
        1_500,
      );
      if (response.ok) {
        const place = await response.json();
        photoName = cleanDiscoveryText(place?.photos?.[0]?.name, 500);
      }
    } else {
      const response = await providerFetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.photos",
        },
        body: JSON.stringify({
          textQuery: `${cleanDiscoveryText(input.card.title, 160)} ${cleanDiscoveryText(input.card.city, 80)} Ontario`,
          pageSize: 1,
          languageCode: "en",
          regionCode: "CA",
          ...(Number.isFinite(input.card.latitude) && Number.isFinite(input.card.longitude)
            ? {
              locationBias: {
                circle: {
                  center: { latitude: input.card.latitude, longitude: input.card.longitude },
                  radius: 250,
                },
              },
            }
            : {}),
        }),
      }, 1_500);
      if (!response.ok) return null;
      const candidate = (await response.json())?.places?.[0];
      const distance = metersBetween(
        input.card.latitude,
        input.card.longitude,
        optionalDiscoveryNumber(candidate?.location?.latitude),
        optionalDiscoveryNumber(candidate?.location?.longitude),
      );
      if (!candidate?.id || !namesMatch(input.card.title, candidate.displayName?.text) || (distance !== undefined && distance > 250)) {
        return null;
      }
      googlePlaceId = cleanDiscoveryText(candidate.id, 180);
      photoName = cleanDiscoveryText(candidate.photos?.[0]?.name, 500);
      if (googlePlaceId && input.card.canonicalId) {
        // Google permits storing a Place ID. Photo metadata and images stay
        // live and are only delivered through Echoo's short-lived proxy.
        await input.supabase
          .from("canonical_places")
          .update({ google_place_id: googlePlaceId, google_place_matched_at: new Date().toISOString() })
          .eq("id", input.card.canonicalId);
      }
    }
    const imageUrl = await signedPhotoUrl(input.req, photoName);
    return imageUrl
      ? { url: imageUrl, alt: cleanDiscoveryText(input.card.title, 160), source: "google_places" }
      : null;
  } catch (error) {
    console.warn("Explore owned photo lookup skipped", cleanDiscoveryText((error as Error)?.message, 160));
    return null;
  }
}

async function hydrateOwnedCardPhotos(
  req: Request,
  supabase: ReturnType<typeof getSupabaseAdmin>,
  cards: Record<string, any>[],
) {
  const needsPhoto = cards.filter((card) => !card.image && card.canonicalId).slice(0, 10);
  if (!needsPhoto.length) return cards;
  const canonicalIds = needsPhoto.map((card) => card.canonicalId);
  const { data } = await supabase
    .from("canonical_places")
    .select("id,google_place_id")
    .in("id", canonicalIds);
  const googleIds = new Map((data || []).map((place: any) => [place.id, place.google_place_id]));
  await Promise.all(needsPhoto.map(async (card) => {
    const image = await photoForOwnedCard({
      req,
      supabase,
      card,
      googlePlaceId: googleIds.get(card.canonicalId),
    });
    if (image) card.image = image;
  }));
  return cards;
}

function liveType(query: string, category: string | null) {
  const normalized = `${query} ${category || ""}`.toLowerCase();
  if (/\b(restaurants?|resturants?|restaraunts?)\b/.test(normalized)) return "restaurant";
  if (/\b(cafes?|coffee)\b/.test(normalized)) return "cafe";
  if (/\b(bars?|pubs?)\b/.test(normalized)) return "bar";
  if (/\b(parks?|trails?)\b/.test(normalized)) return "park";
  if (/\b(libraries?)\b/.test(normalized)) return "library";
  if (/\b(museums?|galleries?)\b/.test(normalized)) return "museum";
  return null;
}

async function googleLiveSearch(input: {
  req: Request;
  query: string;
  category: string | null;
  city: string;
  lat?: number;
  lng?: number;
  limit: number;
  pageToken?: string;
}): Promise<LiveSearchResponse> {
  const key =
    Deno.env.get("GOOGLE_PLACES_API_KEY") ||
    Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key || !input.query) return { results: [], nextPageToken: null };
  const body: Record<string, unknown> = {
    textQuery: `${normalizedLiveQuery(input.query, input.category)} in ${input.city || "Greater Toronto Area"}, Ontario`,
    pageSize: Math.min(Math.max(input.limit, 1), 20),
    languageCode: "en",
    regionCode: "CA",
  };
  if (input.pageToken) body.pageToken = input.pageToken;
  const includedType = liveType(input.query, input.category);
  if (includedType) {
    body.includedType = includedType;
    body.strictTypeFiltering = true;
  }
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    body.locationBias = {
      circle: {
        center: { latitude: input.lat, longitude: input.lng },
        // Category searches should feel useful beyond a tiny immediate block;
        // distance ranking still keeps closest options at the top.
        radius: 35000,
      },
    };
    // The selected quick filter controls provider relevance; GPS is a bias
    // and is blended with relevance below rather than becoming a hard sort.
    body.rankPreference = "RELEVANCE";
  }
  let response: Response;
  try {
    response = await providerFetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri,places.photos,places.rating,places.userRatingCount",
        },
        body: JSON.stringify(body),
      },
      3_500,
    );
  } catch (error) {
    console.warn("Explore Google fallback timed out:", cleanDiscoveryText((error as Error)?.message, 160));
    return { results: [], nextPageToken: null };
  }
  if (!response.ok) {
    console.warn("Explore Google fallback failed:", await response.text());
    return { results: [], nextPageToken: null };
  }
  const data = await response.json();
  const results = await Promise.all((data.places || []).map(async (place: any) => {
    const latitude = optionalDiscoveryNumber(place.location?.latitude);
    const longitude = optionalDiscoveryNumber(place.location?.longitude);
    const photoName = cleanDiscoveryText(place.photos?.[0]?.name, 500);
    const photoAuthors = Array.isArray(place.photos?.[0]?.authorAttributions)
      ? place.photos[0].authorAttributions
        .map((author: any) => ({
          displayName: cleanDiscoveryText(author?.displayName, 160),
          uri: cleanDiscoveryText(author?.uri, 500),
        }))
        .filter((author: { displayName: string }) => Boolean(author.displayName))
      : [];
    // The browser only receives a short-lived photo proxy URL, never a
    // provider API key embedded in image markup.
    const imageUrl = await signedPhotoUrl(input.req, photoName);
    const ratingAverage = optionalDiscoveryNumber(place.rating);
    const ratingCount = Math.max(0, Number(place.userRatingCount || 0));
    // This is an observed popularity signal, not a claim about live capacity:
    // rating quality and enough independent reviews make a place a strong
    // candidate for Discover's “well loved” treatment.
    const ratingQuality = ratingAverage === undefined
      ? 0
      : Math.max(0, Math.min(1, (ratingAverage - 3.8) / 1.2));
    const reviewVolume = Math.max(0, Math.min(1, Math.log10(ratingCount + 1) / 4));
    const hotScore = Number((ratingQuality * 0.62 + reviewVolume * 0.38).toFixed(3));
    return {
    id: `google:${cleanDiscoveryText(place.id, 160)}`,
    source: "google_places",
    type: "place",
    title: cleanDiscoveryText(place.displayName?.text, 160) || "Place",
    category:
      cleanDiscoveryText(place.types?.[0], 80).replace(/_/g, " ") || "place",
    description: cleanDiscoveryText(place.formattedAddress, 300),
    address: cleanDiscoveryText(place.formattedAddress, 300),
    city: input.city,
    latitude,
    longitude,
    distanceMeters: metersBetween(input.lat, input.lng, latitude, longitude),
    image: imageUrl
      ? {
        url: imageUrl,
        alt: cleanDiscoveryText(place.displayName?.text, 160),
        source: "google_places",
        authors: photoAuthors,
      }
      : null,
    features: [],
    community: ratingAverage === undefined
      ? null
      : {
        ratingAverage,
        ratingCount,
        hotScore,
        isHot: ratingAverage >= 4.5 && ratingCount >= 100,
      },
    actionUrl: cleanDiscoveryText(place.googleMapsUri, 500) || null,
    attribution: { provider: "Google Maps", requiredLabel: "Google Maps" },
    isNewToEchoo: true,
    };
  }));
  results.sort((a: any, b: any) => (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER));
  return { results, nextPageToken: cleanDiscoveryText(data.nextPageToken, 2048) || null };
}

function discoveryTerms(value: unknown) {
  return cleanDiscoveryText(value, 160)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2)
    .filter((term) => !new Set(["popular", "places", "things", "nearby", "local", "today"]).has(term));
}

function profileAffinity(item: Record<string, any>, preferenceSlugs: string[]) {
  if (!preferenceSlugs.length) return 0;
  const features = Array.isArray(item.features)
    ? item.features.map((feature: unknown) => cleanDiscoveryText(feature, 80).toLowerCase())
    : [];
  const haystack = [item.title, item.category, item.description, ...features]
    .map((value) => cleanDiscoveryText(value, 300).toLowerCase().replace(/[_-]+/g, " "))
    .join(" ");
  const matches = preferenceSlugs.filter((slug) => {
    const phrase = slug.replace(/_/g, " ");
    return features.includes(slug) || haystack.includes(phrase);
  }).length;
  return Math.min(matches / Math.min(preferenceSlugs.length, 3), 1);
}

function mergedDiscoveryScore(input: {
  item: Record<string, any>;
  query: string;
  preferenceSlugs: string[];
  hasCoordinates: boolean;
}) {
  const { item, preferenceSlugs, hasCoordinates } = input;
  const haystack = [item.title, item.category, item.description, ...(item.features || [])]
    .map((value) => cleanDiscoveryText(value, 300).toLowerCase().replace(/[_-]+/g, " "))
    .join(" ");
  const queryTerms = [...new Set(discoveryTerms(input.query))];
  const queryMatches = queryTerms.filter((term) => haystack.includes(term)).length;
  // Google has already ranked its response against the selected text query.
  // Echoo inventory carries an explicit relevance score from the same query.
  const sourceRelevance = item.source === "echoo"
    ? Math.max(0, Math.min(Number(item.rankScore || 0) / 1.15, 1))
    : Math.min(0.9, 0.62 + queryMatches * 0.12);
  const distance = Number(item.distanceMeters);
  const distanceAffinity = hasCoordinates && Number.isFinite(distance)
    ? Math.max(0, 1 - distance / 75_000)
    : 0.5;
  const quality = Math.max(
    0,
    Math.min(
      1,
      (Number(item.community?.ratingAverage || 0) / 5) * 0.6 +
        Math.min(Math.log10(Number(item.community?.ratingCount || 0) + 1) / 4, 1) * 0.4,
    ),
  );
  // Intent remains dominant. GPS is substantial but not so strict that an
  // excellent next-municipality option disappears from a GTA experience.
  return (
    sourceRelevance * 0.52 +
    distanceAffinity * (hasCoordinates ? 0.27 : 0.08) +
    profileAffinity(item, preferenceSlugs) * 0.13 +
    quality * 0.08
  );
}

function rankMergedResults(
  results: Record<string, any>[],
  query: string,
  preferenceSlugs: string[],
  hasCoordinates: boolean,
) {
  return results
    .map((item) => ({
      ...item,
      discoveryScore: mergedDiscoveryScore({
        item,
        query,
        preferenceSlugs,
        hasCoordinates,
      }),
    }))
    .sort((
      a: Record<string, any> & { discoveryScore: number },
      b: Record<string, any> & { discoveryScore: number },
    ) => {
      const scoreDelta = Number(b.discoveryScore) - Number(a.discoveryScore);
      if (Math.abs(scoreDelta) > 0.0001) return scoreDelta;
      return (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) -
        (b.distanceMeters ?? Number.MAX_SAFE_INTEGER);
    });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "GET" && req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const body: ExplorePayload =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const get = (key: keyof ExplorePayload) =>
      body[key] ?? url.searchParams.get(String(key)) ?? undefined;
    const query = cleanDiscoveryText(get("query"), 120);
    // Keep typo tolerance consistent across Echoo inventory and live places.
    // Without this, "resturants" reached Google correctly but missed Echoo's
    // own search index entirely.
    const searchQuery = query ? normalizedLiveQuery(query, null) : "";
    const inventoryQuery = ownedInventoryQuery(searchQuery);
    const lat = optionalDiscoveryNumber(get("lat"));
    const lng = optionalDiscoveryNumber(get("lng"));
    if ((lat === undefined) !== (lng === undefined))
      return jsonResponse(
        { error: "lat and lng must be provided together" },
        422,
      );
    if (
      lat !== undefined &&
      lng !== undefined &&
      !isInsideGtaBounds(lat, lng)
    ) {
      return jsonResponse(
        {
          supported: false,
          reason: "outside_gta",
          results: [],
          nextCursor: null,
        },
        200,
      );
    }

    const suppliedCity = cleanDiscoveryText(get("city"), 80);
    const supabase = getSupabaseAdmin();
    const city =
      lat !== undefined && lng !== undefined
        ? await resolveGpsCity(supabase, lat, lng)
        : normalizeCityName(suppliedCity || "GTA");
    if (!city)
      return jsonResponse(
        {
          supported: false,
          reason: "unsupported_city",
          results: [],
          nextCursor: null,
        },
        200,
      );

    const limit = clampDiscoveryLimit(get("limit"), 20, 50);
    const radiusMeters = clampRadiusMeters(get("radiusMeters"));
    const category =
      cleanDiscoveryText(get("category"), 80).toLowerCase() || null;
    const cursor = decodeDiscoveryCursor(get("cursor"));
    if (get("cursor") && !cursor)
      return jsonResponse({ error: "Invalid cursor" }, 422);
    const livePageToken = cleanDiscoveryText(get("livePageToken"), 2048) || undefined;
    const { data: features, error: featuresError } = await supabase
      .from("discovery_feature_catalog")
      .select("slug,label,synonyms")
      .eq("is_active", true);
    if (featuresError) throw featuresError;
    const explicitRequiredFeatures = stringArray(
      body.featureSlugs ?? url.searchParams.getAll("featureSlugs"),
    );
    const explicitPreferenceFeatures = stringArray(
      body.preferenceFeatureSlugs ?? url.searchParams.getAll("preferenceFeatureSlugs"),
      10,
    );
    const knownSlugs = new Set(
      (features || []).map((feature: any) => feature.slug),
    );
    // An explicitly requested feature remains a hard filter. Inferred query
    // features (for example `music` -> `live_music`) are a soft boost: newly
    // imported OSM venues do not yet have every editorial feature attached,
    // so making that inference mandatory would hide real local inventory.
    // Query intent is enforced by the category taxonomy inside the search RPC.
    const queryFeatureSlugs = matchedFeatureSlugs(
      searchQuery,
      (features || []) as DiscoveryFeature[],
    );
    const featureSlugs = [
      ...new Set([
        ...explicitRequiredFeatures.filter((slug) => knownSlugs.has(slug)),
      ]),
    ].slice(0, 8);
    const preferenceFeatureSlugs = [
      ...new Set([
        ...queryFeatureSlugs,
        ...explicitPreferenceFeatures.filter((slug) => knownSlugs.has(slug)),
      ]),
    ].slice(0, 10);
    // A manual municipality choice is intentionally narrow. With real GPS,
    // however, location is a relevance signal rather than a hard city wall:
    // rank the nearby venue first, then let cursor pagination continue through
    // the wider GTA envelope. This avoids a user in one neighbourhood seeing
    // an artificially small catalogue while preserving a local-first order.
    const cityFilter =
      lat === undefined && city.coverageLevel === "municipality" ? city.name : null;
    const cacheKey = await sha256Hex(
      JSON.stringify({
        v: 4,
        query: searchQuery.toLowerCase(),
        inventoryQuery,
        city: cityFilter,
        lat: lat?.toFixed(4) || null,
        lng: lng?.toFixed(4) || null,
        radiusMeters,
        category,
        featureSlugs,
        preferenceFeatureSlugs,
        limit,
        cursor,
      }),
    );
    const cached = !livePageToken ? await readLocationCache(supabase, cacheKey) : null;
    let owned: OwnedResult[];
    if (cached) {
      owned = (cached as any).owned || [];
    } else if (!livePageToken || cursor) {
      const { data, error } = await supabase.rpc(
        "search_discovery_owned_entities",
        {
          p_query: inventoryQuery || null,
          p_feature_slugs: featureSlugs,
          p_preference_feature_slugs: preferenceFeatureSlugs,
          p_lat: lat ?? null,
          p_lng: lng ?? null,
          p_radius_meters: radiusMeters,
          p_city: cityFilter,
          p_category: category,
          // The SQL function has a 50-row safety ceiling. At that ceiling a
          // complete page is enough to offer the next cursor; a follow-up
          // request confirms whether another page exists.
          p_limit: Math.min(limit + 1, 50),
          p_cursor_score: cursor?.score ?? null,
          p_cursor_id: cursor?.id ?? null,
        },
      );
      if (error) throw error;
      owned = data || [];
      await writeLocationCache(supabase, cacheKey, { owned }, 90);
    } else {
      owned = [];
    }

    const hasNextPage =
      owned.length > limit || (limit === 50 && owned.length === 50);
    const page = owned.slice(0, limit);
    const ownedCards = page.map(ownedCard);
    const includeLiveFallback = asBoolean(get("includeLiveFallback"), true);
    // The two potentially slow provider lanes are independent. Run them in
    // parallel so owned cards with newly resolved covers never wait behind the
    // live catalogue request.
    const [live, hydratedOwnedCards] = await Promise.all([
      includeLiveFallback
        ? googleLiveSearch({
            req,
            // Do not concatenate onboarding or time prose into the provider
            // query. A quick filter must remain a clean, unambiguous intent.
            query: searchQuery || category || "things to do",
            category,
            city: city.name,
            lat,
            lng,
            limit,
            pageToken: livePageToken,
          })
        : Promise.resolve({ results: [], nextPageToken: null }),
      hydrateOwnedCardPhotos(req, supabase, ownedCards),
    ]);
    const last = page.at(-1);
    // Every photo that is shown is a real provider or approved venue photo.
    // Missing photography must never make a real local business disappear:
    // clients render an honest category fallback while enrichment continues.
    const merged = [...hydratedOwnedCards, ...live.results]
      .filter((item, index, all) =>
        all.findIndex((candidate) => discoveryResultKey(candidate) === discoveryResultKey(item)) === index,
      );
    const ranked = rankMergedResults(
      merged,
      searchQuery || category || "things to do",
      preferenceFeatureSlugs,
      lat !== undefined && lng !== undefined,
    );
    return jsonResponse({
      supported: true,
      query,
      region: city,
      filters: { category, featureSlugs, preferenceFeatureSlugs, radiusMeters },
      locationResolution:
        (city as { resolution?: string }).resolution ||
        (lat === undefined ? "manual_city" : "gta_fallback"),
      searchScope: cityFilter ? "municipality" : "gta_region",
      results: ranked,
      ownedResultCount: page.length,
      registeredResultCount: ownedCards.filter((item: any) => item.placement?.sponsored).length,
      liveFallbackCount: live.results.length,
      nextCursor:
        hasNextPage && last
          ? encodeDiscoveryCursor(last.rank_score, last.id)
          : null,
      liveNextPageToken: live.nextPageToken,
    });
  } catch (error) {
    // PostgrestError / fetch errors are often not `instanceof Error` in Deno,
    // which previously swallowed the real cause and returned a generic message.
    // Surface the underlying message + code so failures are diagnosable.
    const message =
      (error && (error as any).message) ||
      (typeof error === "string" ? error : "Explore search failed");
    const code = (error && (error as any).code) || "explore_search_failed";
    console.error("explore-search failed:", JSON.stringify(error));
    return jsonResponse({ error: message, code }, 500);
  }
});
