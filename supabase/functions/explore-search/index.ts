import {
  CORS_HEADERS,
  clampRadiusMeters,
  getSupabaseAdmin,
  isInsideOntarioBounds,
  jsonResponse,
  nearestSupportedCity,
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
  limit?: unknown;
  cursor?: unknown;
  livePageToken?: unknown;
  includeLiveFallback?: unknown;
};

type OwnedResult = Record<string, any>;

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

function asBoolean(value: unknown, fallback: boolean) {
  if (value === undefined || value === null || value === "") return fallback;
  return value === true || value === "true" || value === 1 || value === "1";
}

function ownedCard(item: OwnedResult) {
  const coverUrl = cleanDiscoveryText(item.cover_url, 500);
  return {
    id: item.id,
    source: "echoo",
    type: item.entity_type === "event" ? "event" : "place",
    title: item.title,
    category: item.category || item.entity_type,
    description: item.description || "",
    city: item.city || "Ontario",
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

function normalizedLiveQuery(query: string, category: string | null) {
  const normalized = cleanDiscoveryText(query || category || "things to do", 120)
    .replace(/\bresturants?\b/gi, "restaurants")
    .replace(/\brestaraunts?\b/gi, "restaurants");
  return normalized || "things to do";
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
  query: string;
  category: string | null;
  city: string;
  lat?: number;
  lng?: number;
  limit: number;
  pageToken?: string;
}) {
  const key =
    Deno.env.get("GOOGLE_PLACES_API_KEY") ||
    Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key || !input.query) return { results: [], nextPageToken: null };
  const body: Record<string, unknown> = {
    textQuery: `${normalizedLiveQuery(input.query, input.category)} in ${input.city}, Ontario`,
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
    body.rankPreference = "DISTANCE";
  }
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri,places.photos",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    console.warn("Explore Google fallback failed:", await response.text());
    return [];
  }
  const data = await response.json();
  const results = (data.places || []).map((place: any) => {
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
    // The Places API returns a resource name, not a directly displayable image.
    // The media endpoint redirects the browser to the actual photo asset.
    const imageUrl = photoName
      ? `https://places.googleapis.com/v1/${photoName}/media?key=${encodeURIComponent(key)}&maxWidthPx=400`
      : null;
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
    community: null,
    actionUrl: cleanDiscoveryText(place.googleMapsUri, 500) || null,
    attribution: { provider: "Google Maps", requiredLabel: "Google Maps" },
    isNewToEchoo: true,
    };
  });
  results.sort((a: any, b: any) => (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER));
  return { results, nextPageToken: cleanDiscoveryText(data.nextPageToken, 2048) || null };
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
      !isInsideOntarioBounds(lat, lng)
    ) {
      return jsonResponse(
        {
          supported: false,
          reason: "outside_ontario",
          results: [],
          nextCursor: null,
        },
        200,
      );
    }

    const suppliedCity = cleanDiscoveryText(get("city"), 80);
    const city =
      lat !== undefined && lng !== undefined
        ? nearestSupportedCity(lat, lng)
        : normalizeCityName(suppliedCity || "Ontario");
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
    const supabase = getSupabaseAdmin();
    const { data: features, error: featuresError } = await supabase
      .from("discovery_feature_catalog")
      .select("slug,label,synonyms")
      .eq("is_active", true);
    if (featuresError) throw featuresError;
    const explicitFeatures = stringArray(
      body.featureSlugs ?? url.searchParams.getAll("featureSlugs"),
    );
    const knownSlugs = new Set(
      (features || []).map((feature: any) => feature.slug),
    );
    const featureSlugs = [
      ...new Set([
        ...explicitFeatures.filter((slug) => knownSlugs.has(slug)),
        ...matchedFeatureSlugs(searchQuery, (features || []) as DiscoveryFeature[]),
      ]),
    ].slice(0, 8);
    const cityFilter = city.coverageLevel === "municipality" ? city.name : null;
    const cacheKey = await sha256Hex(
      JSON.stringify({
        v: 1,
        query: searchQuery.toLowerCase(),
        city: cityFilter,
        lat: lat?.toFixed(4) || null,
        lng: lng?.toFixed(4) || null,
        radiusMeters,
        category,
        featureSlugs,
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
          p_query: searchQuery || null,
          p_feature_slugs: featureSlugs,
          p_lat: lat ?? null,
          p_lng: lng ?? null,
          p_radius_meters: radiusMeters,
          p_city: cityFilter,
          p_category: category,
          p_limit: limit + 1,
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

    const hasNextPage = owned.length > limit;
    const page = owned.slice(0, limit);
    const includeLiveFallback = asBoolean(get("includeLiveFallback"), true);
    const live = includeLiveFallback
      ? await googleLiveSearch({
          query: searchQuery || category || "things to do",
          category,
          city: city.name,
          lat,
          lng,
          limit,
          pageToken: livePageToken,
        })
      : { results: [], nextPageToken: null };
    const last = page.at(-1);
    const ownedCards = page.map(ownedCard);
    const merged = [...ownedCards, ...live.results].filter((item, index, all) =>
      all.findIndex((candidate) => candidate.id === item.id) === index,
    );
    if (lat !== undefined && lng !== undefined) {
      merged.sort((a: any, b: any) => (a.distanceMeters ?? Number.MAX_SAFE_INTEGER) - (b.distanceMeters ?? Number.MAX_SAFE_INTEGER));
    }
    return jsonResponse({
      supported: true,
      query,
      region: city,
      filters: { category, featureSlugs, radiusMeters },
      results: merged,
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
