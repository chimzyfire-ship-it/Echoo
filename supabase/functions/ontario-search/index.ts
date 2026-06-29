import {
  CORS_HEADERS,
  clampLimit,
  clampRadiusMeters,
  getSupabaseAdmin,
  jsonResponse,
  logLocationEvent,
} from "../_shared/location.ts";

type SearchPayload = {
  query?: string;
  city?: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  category?: string;
  intent?: string;
  limit?: number;
};

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function categoryBucketsFromIntent(intent = "", category = "") {
  if (category) return [category];
  const normalized = intent.toLowerCase();
  if (/(lunch|dinner|restaurant|food|date)/.test(normalized)) {
    return ["restaurant", "cafe", "bar", "pub", "fast_food"];
  }
  if (/cafe|coffee/.test(normalized)) return ["cafe"];
  if (/bar|pub|nightlife|drink/.test(normalized)) return ["bar", "pub"];
  if (/park|trail|outdoor|walk|hike|chill/.test(normalized)) {
    return ["park", "trail", "nature_reserve", "cafe"];
  }
  if (/museum|culture|art/.test(normalized)) {
    return [
      "museum",
      "arts_centre",
      "cultural_space",
      "attraction",
      "historic",
    ];
  }
  if (/library|community|recreation|facility|indoor/.test(normalized)) {
    return ["library", "community_centre", "public_facility", "fitness_centre"];
  }
  return [null];
}

function searchQueryForPlaces(query = "", city = "", intent = "") {
  let cleaned = query.toLowerCase();
  const removable = [
    city,
    intent,
    "markham",
    "toronto",
    "ontario",
    "near me",
    "nearby",
    "lunch",
    "dinner",
    "restaurant",
    "restaurants",
    "food",
    "date",
    "night",
    "nightlife",
    "culture",
    "museum",
    "museums",
    "park",
    "parks",
    "trail",
    "trails",
    "walk",
    "walking",
    "hike",
    "hiking",
    "outdoor",
    "outdoors",
    "cafe",
    "cafes",
    "coffee",
    "chill",
    "chilling",
    "quiet",
    "cozy",
    "relaxed",
    "nice",
    "good",
    "worth",
    "vibe",
    "is",
    "it",
    "at",
    "to",
    "go",
    "going",
    "hang",
    "hanging",
    "things to do",
  ];
  for (const word of removable) {
    const token = cleanText(word).toLowerCase();
    if (!token) continue;
    cleaned = cleaned.replace(new RegExp(`\\b${token}\\b`, "g"), " ");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.length >= 3 ? cleaned : null;
}

function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return { data, error: null, meta };
}

function numberScore(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedTags(place: any) {
  return [
    ...(place.vibe_tags || []),
    ...(place.good_for || []),
    ...(place.meal_tags || []),
    ...(place.activity_tags || []),
    place.category || "",
    place.subcategory || "",
    place.noise_level || "",
  ]
    .map((tag) => cleanText(tag).toLowerCase())
    .filter(Boolean);
}

function intentScore(place: any, intent: string) {
  const text = intent.toLowerCase();
  if (/lunch|food|restaurant|dinner/.test(text)) {
    return numberScore(place.lunch_score, 0.45);
  }
  if (/date/.test(text)) return numberScore(place.date_score, 0.45);
  if (/group|friends/.test(text)) return numberScore(place.group_score, 0.45);
  if (/solo|work|quiet/.test(text)) return numberScore(place.solo_score, 0.45);
  if (/family|kids/.test(text)) return numberScore(place.family_score, 0.45);
  if (/rain|indoor/.test(text)) return numberScore(place.rainy_day_score, 0.45);
  return numberScore(place.rank_score, 0.45);
}

function vibeScore(place: any, intent: string) {
  const text = intent.toLowerCase();
  const tags = normalizedTags(place);
  let score = 0.45;
  const has = (pattern: RegExp) => tags.some((tag) => pattern.test(tag));

  if (/chill|relax|quiet|cozy/.test(text)) {
    score = Math.max(
      score,
      has(/quiet|cozy|relaxed|low-key|walkable|park|cafe/) ? 0.86 : 0.42,
    );
    if (has(/lively|nightlife|active/)) score -= 0.12;
  }
  if (/date/.test(text)) {
    score = Math.max(
      score,
      has(/date|polished|cultural|cozy|artful|evening/) ? 0.84 : 0.46,
    );
  }
  if (/group|friends/.test(text)) {
    score = Math.max(
      score,
      has(/group|social|lively|community|casual/) ? 0.84 : 0.46,
    );
  }
  if (/lunch|food|dinner/.test(text)) {
    score = Math.max(
      score,
      has(/food|lunch|sit-down|casual|quick/) ? 0.82 : 0.44,
    );
  }
  if (/rain|indoor/.test(text)) {
    score = Math.max(
      score,
      has(/indoor|rainy|museum|library|mall|movie/) ? 0.84 : 0.42,
    );
  }

  return Math.max(0, Math.min(1, score));
}

function confidenceSafety(place: any) {
  const confidence = numberScore(place.confidence_score, 0.45);
  const profileQuality = numberScore(place.profile_quality_score, 0);
  if (confidence >= 0.72 && profileQuality >= 0.65) return 1;
  if (confidence >= 0.58) return 0.86;
  if (confidence >= 0.45) return 0.68;
  return 0.45;
}

function treatmentScore(place: any, intent: string) {
  const base =
    numberScore(place.rank_score) * 0.3 +
    intentScore(place, intent) * 0.22 +
    vibeScore(place, intent) * 0.16 +
    numberScore(place.profile_quality_score, 0.45) * 0.14 +
    numberScore(place.source_quality_score, 0.45) * 0.08 +
    numberScore(place.editorial_boost) * 0.06 +
    numberScore(place.trust_score, 0.75) * 0.04;
  return base * confidenceSafety(place);
}

function rankingReason(place: any, intent: string) {
  const reasons = [];
  if (numberScore(place.profile_quality_score) >= 0.65)
    reasons.push("strong Echoo profile");
  if (vibeScore(place, intent) >= 0.8) reasons.push("vibe match");
  if (numberScore(place.editorial_boost) > 0)
    reasons.push("editorial/partner signal");
  if (confidenceSafety(place) < 0.86) reasons.push("lower confidence");
  return reasons.length ? reasons.join(", ") : "retrieved Ontario record";
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse(
      { data: null, error: "Method not allowed", meta: {} },
      405,
    );
  }

  try {
    const url = new URL(req.url);
    const body =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const payload: SearchPayload = {
      query: cleanText(body.query ?? url.searchParams.get("query")),
      city: cleanText(body.city ?? url.searchParams.get("city")),
      lat: optionalNumber(body.lat ?? url.searchParams.get("lat")),
      lng: optionalNumber(body.lng ?? url.searchParams.get("lng")),
      radiusMeters: optionalNumber(
        body.radiusMeters ?? url.searchParams.get("radiusMeters"),
      ),
      category: cleanText(body.category ?? url.searchParams.get("category")),
      intent: cleanText(body.intent ?? url.searchParams.get("intent")),
      limit: optionalNumber(body.limit ?? url.searchParams.get("limit")),
    };

    const supabase = getSupabaseAdmin();
    const radiusMeters = clampRadiusMeters(payload.radiusMeters);
    const limit = clampLimit(payload.limit);
    const categoryBuckets = categoryBucketsFromIntent(
      `${payload.intent || ""} ${payload.query || ""}`,
      payload.category,
    );
    const placeQuery = searchQueryForPlaces(
      payload.query,
      payload.city,
      payload.intent,
    );
    const support = await supabase.rpc("ontario_region_support", {
      p_city: payload.city || null,
    });
    if (support.error) throw support.error;
    const region = support.data?.[0] || {
      supported: true,
      launch_tier: 2,
      coverage_level: "province",
      city: payload.city || "Ontario",
      province: "ON",
      features_enabled: ["places", "lunch"],
    };

    const placeRows: any[] = [];
    for (const category of categoryBuckets) {
      const places = await supabase.rpc("search_ontario_places", {
        p_query: placeQuery,
        p_city: payload.city || null,
        p_lat: payload.lat ?? null,
        p_lng: payload.lng ?? null,
        p_radius_meters: radiusMeters,
        p_category: category,
        p_limit: limit,
      });
      if (places.error) throw places.error;
      placeRows.push(...(places.data || []));
    }

    const dedupedPlaces = Array.from(
      new Map(placeRows.map((place) => [place.id, place])).values(),
    )
      .sort((a: any, b: any) => {
        const rankingIntent = `${payload.intent || ""} ${payload.query || ""}`;
        const rankDelta =
          treatmentScore(b, rankingIntent) - treatmentScore(a, rankingIntent);
        if (rankDelta !== 0) return rankDelta;
        return Number(a.distance_meters || 0) - Number(b.distance_meters || 0);
      })
      .slice(0, limit);

    const results = dedupedPlaces.map((place: any) => ({
      id: place.id,
      type: "place",
      title: place.name,
      category: place.category,
      subcategory: place.subcategory,
      city: place.municipality || place.city,
      address: place.address,
      latitude: place.latitude,
      longitude: place.longitude,
      distanceMeters: place.distance_meters,
      profileTags: normalizedTags(place).slice(0, 6),
      rankingReason: rankingReason(
        place,
        `${payload.intent || ""} ${payload.query || ""}`,
      ),
      scores: {
        lunch: place.lunch_score,
        date: place.date_score,
        group: place.group_score,
        solo: place.solo_score,
        family: place.family_score,
        rainyDay: place.rainy_day_score,
        confidence: place.confidence_score,
        profileQuality: place.profile_quality_score,
        sourceQuality: place.source_quality_score,
        editorialBoost: place.editorial_boost,
        rank: place.rank_score,
        treatment: Number(
          treatmentScore(
            place,
            `${payload.intent || ""} ${payload.query || ""}`,
          ).toFixed(4),
        ),
      },
      sourceStatus: {
        sourceProvider: place.source_provider,
        profileStatus: place.profile_status,
        confidenceSafe: confidenceSafety(place) >= 0.86,
      },
    }));

    if (!results.length && payload.query) {
      await supabase.from("zero_result_queries").insert({
        query: payload.query,
        city: payload.city || null,
        province: "ON",
        lat: payload.lat ?? null,
        lng: payload.lng ?? null,
        intent: payload.intent || null,
        result_count: 0,
      });
    }

    await logLocationEvent(supabase, {
      functionName: "ontario-search",
      eventType: Date.now() - startedAt > 750 ? "slow_search" : "search",
      durationMs: Date.now() - startedAt,
      countryCode: "CA",
      adminArea1: "ON",
      city: payload.city || null,
      request: {
        query: payload.query,
        city: payload.city,
        radiusMeters,
        categories: categoryBuckets,
        placeQuery,
        intent: payload.intent,
        limit,
      },
      responseSummary: { count: results.length },
    });

    return jsonResponse(
      envelope(
        {
          supported: true,
          region,
          results,
        },
        {
          durationMs: Date.now() - startedAt,
          radiusMeters,
          resultCount: results.length,
          ranking: "profile_vibe_editorial_confidence_v1",
        },
      ),
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown Ontario search error";
    return jsonResponse({ data: null, error: message, meta: {} }, 500);
  }
});
