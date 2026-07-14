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
    rankScore: optionalDiscoveryNumber(item.rank_score) || 0,
  };
}

async function googleFallback(input: {
  query: string;
  city: string;
  lat?: number;
  lng?: number;
  limit: number;
}) {
  const key =
    Deno.env.get("GOOGLE_PLACES_API_KEY") ||
    Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key || !input.query) return [];
  const body: Record<string, unknown> = {
    textQuery: `${input.query} in ${input.city}`,
    maxResultCount: Math.min(input.limit, 10),
    languageCode: "en",
  };
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    body.locationBias = {
      circle: {
        center: { latitude: input.lat, longitude: input.lng },
        radius: 18000,
      },
    };
  }
  const response = await fetch(
    "https://places.googleapis.com/v1/places:searchText",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask":
          "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri",
      },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    console.warn("Explore Google fallback failed:", await response.text());
    return [];
  }
  const data = await response.json();
  return (data.places || []).map((place: any) => ({
    id: `google:${cleanDiscoveryText(place.id, 160)}`,
    source: "google_places",
    type: "place",
    title: cleanDiscoveryText(place.displayName?.text, 160) || "Place",
    category:
      cleanDiscoveryText(place.types?.[0], 80).replace(/_/g, " ") || "place",
    description: cleanDiscoveryText(place.formattedAddress, 300),
    address: cleanDiscoveryText(place.formattedAddress, 300),
    city: input.city,
    latitude: optionalDiscoveryNumber(place.location?.latitude),
    longitude: optionalDiscoveryNumber(place.location?.longitude),
    image: null,
    features: [],
    community: null,
    actionUrl: cleanDiscoveryText(place.googleMapsUri, 500) || null,
    attribution: { provider: "Google Maps", requiredLabel: "Google Maps" },
    isNewToEchoo: true,
  }));
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
        ...matchedFeatureSlugs(query, (features || []) as DiscoveryFeature[]),
      ]),
    ].slice(0, 8);
    const cityFilter = city.coverageLevel === "municipality" ? city.name : null;
    const cacheKey = await sha256Hex(
      JSON.stringify({
        v: 1,
        query: query.toLowerCase(),
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
    const cached = await readLocationCache(supabase, cacheKey);
    let owned: OwnedResult[];
    if (cached) {
      owned = (cached as any).owned || [];
    } else {
      const { data, error } = await supabase.rpc(
        "search_discovery_owned_entities",
        {
          p_query: query || null,
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
    }

    const hasNextPage = owned.length > limit;
    const page = owned.slice(0, limit);
    const includeLiveFallback = asBoolean(get("includeLiveFallback"), true);
    const fallback =
      !cursor && includeLiveFallback && page.length < Math.min(5, limit)
        ? await googleFallback({
            query: query || category || "things to do",
            city: city.name,
            lat,
            lng,
            limit: Math.min(5, limit - page.length),
          })
        : [];
    const last = page.at(-1);
    return jsonResponse({
      supported: true,
      query,
      region: city,
      filters: { category, featureSlugs, radiusMeters },
      results: [...page.map(ownedCard), ...fallback],
      ownedResultCount: page.length,
      liveFallbackCount: fallback.length,
      nextCursor:
        hasNextPage && last
          ? encodeDiscoveryCursor(last.rank_score, last.id)
          : null,
    });
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Explore search failed",
        code: "explore_search_failed",
      },
      500,
    );
  }
});
