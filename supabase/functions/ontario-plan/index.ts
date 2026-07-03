import {
  CORS_HEADERS,
  clampLimit,
  clampRadiusMeters,
  getSupabaseAdmin,
  jsonResponse,
  logLocationEvent,
} from "../_shared/location.ts";

type PlanPayload = {
  query?: string;
  city?: string;
  lat?: number;
  lng?: number;
  intent?: string;
  radiusMeters?: number;
  limit?: number;
  mode?: string;
};

type PlaceRow = {
  id: string;
  name: string;
  category: string | null;
  subcategory: string | null;
  city: string | null;
  municipality: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  distance_meters: number | null;
  lunch_score: number | null;
  date_score: number | null;
  group_score: number | null;
  solo_score?: number | null;
  family_score?: number | null;
  rainy_day_score?: number | null;
  confidence_score: number | null;
  profile_confidence_score?: number | null;
  profile_status?: string | null;
  vibe_tags?: string[] | null;
  good_for?: string[] | null;
  meal_tags?: string[] | null;
  activity_tags?: string[] | null;
  noise_level?: string | null;
  price_band?: string | null;
  source_provider?: string | null;
  popularity_score?: number | null;
  editorial_boost?: number | null;
  trust_score?: number | null;
  profile_quality_score?: number | null;
  source_quality_score?: number | null;
  rank_score: number | null;
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

function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return { data, error: null, meta };
}

function categoryBuckets(input: string) {
  const text = input.toLowerCase();
  if (/bar|pub|drink|nightlife/.test(text)) {
    return ["bar", "pub", "restaurant", "cafe"];
  }
  if (/museum|gallery|culture|art|rainy/.test(text)) {
    return [
      "museum",
      "arts_centre",
      "cultural_space",
      "attraction",
      "library",
      "mall",
      "cafe",
      "restaurant",
    ];
  }
  if (/park.*trail|trail.*park/.test(text)) {
    return ["trail", "park", "nature_reserve"];
  }
  if (/trail|walk|hike/.test(text)) {
    return ["trail", "park", "nature_reserve"];
  }
  if (/park|outdoor|picnic|chill/.test(text)) {
    return ["park", "trail", "nature_reserve", "cafe"];
  }
  if (/coffee|cafe|work|quiet|solo/.test(text)) {
    return ["cafe", "library", "park", "trail", "restaurant"];
  }
  if (/library|community|recreation|facility|indoor/.test(text)) {
    return ["library", "community_centre", "public_facility", "fitness_centre"];
  }
  if (/date/.test(text)) {
    return ["restaurant", "cafe", "museum", "arts_centre", "park", "mall"];
  }
  if (/group|friends/.test(text)) {
    return ["restaurant", "pub", "mall", "park", "museum", "cafe"];
  }
  return [
    "restaurant",
    "cafe",
    "park",
    "museum",
    "arts_centre",
    "mall",
    "library",
  ];
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
    "plan",
    "route",
    "two stop",
    "three stop",
    "lunch",
    "dinner",
    "restaurant",
    "restaurants",
    "food",
    "date",
    "night",
    "nightlife",
    "culture",
    "library",
    "libraries",
    "community",
    "recreation",
    "facility",
    "facilities",
    "centre",
    "centres",
    "center",
    "centers",
    "indoor",
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
    "in",
    "with",
    "and",
    "for",
    "a",
    "an",
    "the",
    "build",
    "build plan",
    "build_plan",
    "surprise",
    "chat",
  ];
  for (const word of removable) {
    const token = cleanText(word).toLowerCase();
    if (!token) continue;
    cleaned = cleaned.replace(new RegExp(`\\b${token}\\b`, "g"), " ");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  return cleaned.length >= 3 ? cleaned : null;
}

function stopCountForQuery(query: string, limit: number) {
  const text = query.toLowerCase();
  if (
    /one stop|single|quick/.test(text) ||
    /\b(is|are|was|were)\b.+\b(nice|good|worth|vibe|chill|chilling)\b/.test(
      text,
    ) ||
    /\b(nice|good|worth|vibe|chill|chilling)\b.+\b(at|for|near)\b/.test(text)
  )
    return 1;
  if (/three|afternoon|evening|date|route/.test(text)) {
    return Math.min(3, limit);
  }
  return Math.min(2, limit);
}

function intentScore(place: PlaceRow, intent: string) {
  const text = intent.toLowerCase();
  if (/lunch|food|restaurant|dinner/.test(text)) {
    return Number(place.lunch_score ?? 0.45);
  }
  if (/date/.test(text)) return Number(place.date_score ?? 0.45);
  if (/group|friends/.test(text)) return Number(place.group_score ?? 0.45);
  if (/solo|work|quiet/.test(text)) return Number(place.solo_score ?? 0.45);
  if (/family|kids/.test(text)) return Number(place.family_score ?? 0.45);
  if (/rain|indoor/.test(text)) return Number(place.rainy_day_score ?? 0.45);
  if (/park|trail|walk|hike|outdoor|picnic/.test(text)) {
    if (/trail|park|nature_reserve/.test(place.category || "")) return 0.9;
    if (/cafe/.test(place.category || "")) return 0.46;
    return 0.24;
  }
  return Number(place.rank_score ?? 0.45);
}

function numberScore(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedTags(place: PlaceRow) {
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

function vibeScore(place: PlaceRow, intent: string) {
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
  if (/park|trail|walk|hike|outdoor|picnic/.test(text)) {
    score = Math.max(
      score,
      has(/outdoors|walkable|fresh_air|hiking|park|trail|nature/) ? 0.9 : 0.32,
    );
  }

  return Math.max(0, Math.min(1, score));
}

function confidenceSafety(place: PlaceRow) {
  const confidence = numberScore(place.confidence_score, 0.45);
  const profileQuality = numberScore(place.profile_quality_score, 0);
  if (confidence >= 0.72 && profileQuality >= 0.65) return 1;
  if (confidence >= 0.58) return 0.86;
  if (confidence >= 0.45) return 0.68;
  return 0.45;
}

function treatmentScore(place: PlaceRow, intent: string) {
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

function sortPlaces(places: PlaceRow[], intent: string) {
  return [...places].sort((a, b) => {
    const scoreA = treatmentScore(a, intent);
    const scoreB = treatmentScore(b, intent);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return Number(a.distance_meters ?? 0) - Number(b.distance_meters ?? 0);
  });
}

function chooseStops(places: PlaceRow[], query: string, limit: number) {
  const desired = stopCountForQuery(query, limit);
  const sorted = sortPlaces(places, query);
  const picked: PlaceRow[] = [];
  const seenCategories = new Set<string>();

  for (const place of sorted) {
    if (picked.length >= desired) break;
    const category = place.category || "place";
    if (desired > 1 && seenCategories.has(category)) {
      continue;
    }
    picked.push(place);
    seenCategories.add(category);
  }

  for (const place of sorted) {
    if (picked.length >= desired) break;
    if (picked.some((item) => item.id === place.id)) continue;
    picked.push(place);
  }

  return picked;
}

function stopVibe(place: PlaceRow, index: number, total: number) {
  const category = place.category || "place";
  const tags = normalizedTags(place);
  if (tags.some((tag) => /quiet|cozy|relaxed|low-key/.test(tag))) {
    return "Chosen for a calmer Echoo profile match with confidence-safe local signals.";
  }
  if (tags.some((tag) => /polished|date|artful|cultural/.test(tag))) {
    return "Chosen because its Echoo profile fits a stronger date or culture stop.";
  }
  if (tags.some((tag) => /group|social|lively|casual/.test(tag))) {
    return "Chosen because its profile works well for a social stop.";
  }
  if (index === 0 && /restaurant|cafe|bar|pub/.test(category)) {
    return "Start with the strongest food or coffee match from Echoo's Ontario records.";
  }
  if (/park/.test(category)) {
    return "Use this as the easy walk or outdoor reset in the route.";
  }
  if (/museum|library|arts_centre/.test(category)) {
    return "Add a culture or rainy-day stop that gives the plan a real activity.";
  }
  if (/mall/.test(category)) {
    return "Keep this as the weather-safe backup anchor.";
  }
  if (index === total - 1) {
    return "Close with a nearby stop that keeps the route simple.";
  }
  return "Matched from verified Ontario place records.";
}

function confidenceLabel(recordCount: number, stopCount: number) {
  if (recordCount >= 8 && stopCount >= 2) return "high";
  if (recordCount >= 3 && stopCount >= 2) return "medium";
  if (recordCount >= 1) return "low";
  return "none";
}

async function loadPlaces(input: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  query: string;
  city: string;
  lat?: number;
  lng?: number;
  radiusMeters: number;
  limit: number;
}) {
  const buckets = categoryBuckets(input.query);
  const placeQuery = searchQueryForPlaces(input.query, input.city);
  const rows: PlaceRow[] = [];

  for (const category of buckets) {
    const { data, error } = await input.supabase.rpc("search_ontario_places", {
      p_query: placeQuery,
      p_city: input.city || null,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
      p_radius_meters: input.radiusMeters,
      p_category: category,
      p_limit: input.limit,
    });
    if (error) throw error;
    rows.push(...(data || []));
  }

  return Array.from(new Map(rows.map((row) => [row.id, row])).values());
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse(
      { data: null, error: "Method not allowed", meta: {} },
      405,
    );
  }

  const supabase = getSupabaseAdmin();

  try {
    const body = (await req.json().catch(() => ({}))) as PlanPayload;
    const query = cleanText(body.query);
    if (!query) {
      return jsonResponse(
        { data: null, error: "query is required.", meta: {} },
        422,
      );
    }

    const city = cleanText(body.city || "Markham");
    const radiusMeters = clampRadiusMeters(body.radiusMeters);
    const limit = Math.max(2, Math.min(clampLimit(body.limit), 12));
    const support = await supabase.rpc("ontario_region_support", {
      p_city: city || null,
    });
    if (support.error) throw support.error;
    const region = support.data?.[0] || {
      supported: true,
      launch_tier: 2,
      coverage_level: "province",
      city: city || "Ontario",
      province: "ON",
      features_enabled: ["places", "lunch"],
    };

    const places = await loadPlaces({
      supabase,
      query: `${body.intent || ""} ${query}`,
      city,
      lat: optionalNumber(body.lat),
      lng: optionalNumber(body.lng),
      radiusMeters,
      limit,
    });
    const stops = chooseStops(places, `${body.intent || ""} ${query}`, limit);
    const confidence = confidenceLabel(places.length, stops.length);

    if (!stops.length) {
      await supabase.from("zero_result_queries").insert({
        query,
        city: city || null,
        province: "ON",
        lat: optionalNumber(body.lat) ?? null,
        lng: optionalNumber(body.lng) ?? null,
        intent: body.intent || body.mode || null,
        result_count: 0,
      });
    }

    const planStops = stops.map((place, index) => ({
      id: place.id,
      placeId: place.id,
      name: place.name,
      title: place.name,
      category: place.category,
      subcategory: place.subcategory,
      address: place.address,
      city: place.municipality || place.city,
      latitude: place.latitude,
      longitude: place.longitude,
      distanceMeters: place.distance_meters,
      tags: [place.category, place.subcategory].filter(Boolean).join(" / "),
      profileTags: normalizedTags(place).slice(0, 6),
      vibe: stopVibe(place, index, stops.length),
      timing:
        index === 0
          ? "Start here"
          : index === stops.length - 1
            ? "Finish nearby"
            : "Then walk or drive over",
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
          treatmentScore(place, `${body.intent || ""} ${query}`).toFixed(4),
        ),
      },
      sourceStatus: {
        sourceProvider: place.source_provider,
        profileStatus: place.profile_status,
        confidenceSafe: confidenceSafety(place) >= 0.86,
      },
    }));

    const routeTitle = stops.length
      ? `${city || "Ontario"} ${stops.length}-stop plan`
      : `No verified ${city || "Ontario"} plan yet`;
    const summary = stops.length
      ? `I found ${stops.length} verified Echoo stop${stops.length === 1 ? "" : "s"} from the Ontario database.`
      : "Echoo does not have enough verified local records for that plan yet.";
    const assistantMessage = stops.length
      ? `${summary} I used retrieved place records only, so details like hours or specials are omitted unless Echoo has them.`
      : `${summary} Try a broader city, a simpler intent, or add validation/import data first.`;

    const responseData = {
      supported: Boolean(region.supported),
      region,
      plan: {
        title: routeTitle,
        summary,
        explanation: assistantMessage,
        steps: planStops,
      },
      sourceStatus: {
        recordCount: places.length,
        stopCount: stops.length,
        confidence,
        sources: ["canonical_places", "place_profiles", "location_entities"],
        ranking: "profile_vibe_editorial_confidence_v1",
        strongProfileCount: stops.filter(
          (place) => numberScore(place.profile_quality_score) >= 0.65,
        ).length,
        confidenceSafeCount: stops.filter(
          (place) => confidenceSafety(place) >= 0.86,
        ).length,
      },
      compatibility: {
        mode: "ontario_plan",
        planShape: {
          stopCount: stops.length,
          intensity: stops.length >= 3 ? "route" : "simple",
          confidence:
            confidence === "high" ? 0.9 : confidence === "medium" ? 0.7 : 0.35,
          reason: "Retrieved from Echoo Ontario records.",
        },
        ai: {
          provider: "echoo-retrieval",
          model: "deterministic",
          assistantMessage,
          routeTitle,
          suggestedPills: [
            "Find quieter",
            "Add coffee",
            "Make it a date",
            "Show alternatives",
          ],
        },
        summary,
        plans: planStops,
      },
    };

    await logLocationEvent(supabase, {
      functionName: "ontario-plan",
      eventType: Date.now() - startedAt > 750 ? "slow_plan" : "plan",
      durationMs: Date.now() - startedAt,
      countryCode: "CA",
      adminArea1: "ON",
      city,
      request: {
        query,
        city,
        intent: body.intent,
        radiusMeters,
        limit,
      },
      responseSummary: {
        recordCount: places.length,
        stopCount: stops.length,
        confidence,
      },
    });

    return jsonResponse(
      envelope(responseData, {
        durationMs: Date.now() - startedAt,
        radiusMeters,
      }),
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown Ontario plan error";
    return jsonResponse({ data: null, error: message, meta: {} }, 500);
  }
});
