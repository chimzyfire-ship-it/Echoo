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
  const buckets: string[] = [];
  const add = (categories: string[]) => {
    for (const category of categories) {
      if (!buckets.includes(category)) buckets.push(category);
    }
  };

  if (/bar|pub|drink|nightlife/.test(text)) {
    add(["bar", "pub", "restaurant", "cafe"]);
  }
  if (/morning|activity|activities|things to do|best/.test(text)) {
    add(["cafe", "park", "museum", "cultural_space", "library", "attraction"]);
  }
  if (
    /food|lunch|dinner|restaurant|restaurants|brunch|meal|bite|chinese|dim sum|dumpling|hot pot|korean|indian|pakistani|jamaican|caribbean|ethiopian|vietnamese|filipino/.test(
      text,
    )
  ) {
    add(["restaurant", "cafe", "bar", "pub", "mall"]);
  }
  if (/museum|gallery|culture|art|rainy/.test(text)) {
    add([
      "museum",
      "arts_centre",
      "cultural_space",
      "attraction",
      "library",
      "mall",
      "cafe",
      "restaurant",
    ]);
  }
  if (/park.*trail|trail.*park/.test(text)) {
    add(["trail", "park", "nature_reserve", "cafe"]);
  }
  if (/trail|walk|hike/.test(text)) {
    add(["trail", "park", "nature_reserve", "cafe"]);
  }
  if (/park|outdoor|picnic|chill|relax/.test(text)) {
    add(["park", "trail", "nature_reserve", "cafe"]);
  }
  if (/coffee|cafe|work|quiet|solo/.test(text)) {
    add(["cafe", "library", "park", "trail", "restaurant"]);
  }
  if (/library|libraries|community|recreation|facility|indoor/.test(text)) {
    add(["library", "community_centre", "public_facility", "fitness_centre"]);
  }
  if (
    /date|romantic|girlfriend|boyfriend|partner|wife|husband|sweet/.test(text)
  ) {
    add(["restaurant", "cafe", "museum", "arts_centre", "park", "mall"]);
  }
  if (/group|friend|friends/.test(text)) {
    add(["restaurant", "pub", "mall", "park", "museum", "cafe"]);
  }
  if (!buckets.length) {
    add([
      "restaurant",
      "cafe",
      "park",
      "museum",
      "arts_centre",
      "mall",
      "library",
    ]);
  }
  return buckets.slice(0, 10);
}

function searchQueryForPlaces(query = "", city = "", intent = "") {
  let cleaned = query.toLowerCase().replace(/[’']/g, "'");
  const removable = [
    city,
    intent,
    "chat",
    "build_plan",
    "local_plan",
    "food_plan",
    "cultural_food",
    "date_night",
    "markham",
    "toronto",
    "arkham",
    "ontario",
    "near me",
    "around me",
    "nearby",
    "around",
    "close by",
    "close",
    "plan",
    "route",
    "i",
    "i'm",
    "im",
    "am",
    "me",
    "my",
    "need",
    "want",
    "give",
    "make",
    "find",
    "search",
    "show",
    "looking for",
    "looking",
    "look",
    "best",
    "nice",
    "good",
    "for",
    "in",
    "and",
    "a",
    "an",
    "the",
    "two stop",
    "three stop",
    "2 stop",
    "3 stop",
    "two step",
    "three step",
    "2 step",
    "3 step",
    "step",
    "steps",
    "stop",
    "stops",
    "chill",
    "chilled",
    "relax",
    "reset",
    "breathe",
    "nerves",
    "peaceful",
    "soft",
    "evening",
    "early",
    "today",
    "afternoon",
    "morning",
    "activity",
    "activities",
    "relaxed",
    "fun",
    "simple",
    "different",
    "anchor",
    "same",
    "mood",
    "tonight",
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
    "gallery",
    "galleries",
    "art",
    "arts",
    "shop",
    "shops",
    "interesting",
    "unique",
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
    "random",
    "pick",
    "friend",
    "friends",
    "romantic",
    "girlfriend",
    "boyfriend",
    "partner",
    "wife",
    "husband",
    "baby",
    "babe",
    "special",
    "sophisticated",
    "atmosphere",
    "upscale",
    "refined",
    "chinese",
    "dim sum",
    "dumpling",
    "dumplings",
    "hot pot",
    "korean",
    "indian",
    "pakistani",
    "jamaican",
    "caribbean",
    "ethiopian",
    "vietnamese",
    "filipino",
    "chat",
  ];
  for (const word of removable) {
    const token = cleanText(word).toLowerCase();
    if (!token) continue;
    cleaned = cleaned.replace(new RegExp(`\\b${token}\\b`, "g"), " ");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.length >= 3) return cleaned;

  const source = `${query} ${intent}`.toLowerCase();
  if (/group|friend|friends/.test(source)) return null;
  if (
    /surprise|random|pick for me|today|early|morning|activity|activities|afternoon/.test(
      source,
    )
  )
    return null;
  if (
    /walk|walking|trail|park|outdoor|outside|chill|chilled|quiet|calm|relax|reset|breathe|nerves|peaceful|soft/.test(
      source,
    )
  ) {
    return null;
  }
  if (/coffee|cafe/.test(source)) return null;
  if (
    /lunch|dinner|food|restaurant|restaurants|brunch|meal|bite/.test(source)
  ) {
    return "restaurant";
  }
  if (/date|sweet|romantic/.test(source)) return "date";
  if (/library|libraries/.test(source)) return "library";
  if (/museum|gallery|culture|art/.test(source)) return "museum";
  return null;
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
  if (/library|libraries/.test(text)) {
    if (/library/.test(place.category || "")) return 0.9;
    if (/community|public_facility/.test(place.category || "")) return 0.62;
    return 0.32;
  }
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
  if (/library|libraries/.test(text)) {
    score = Math.max(
      score,
      has(/library|quiet|study|community|indoor/) ? 0.88 : 0.38,
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
    return "A calmer stop that keeps the plan easy instead of loud.";
  }
  if (tags.some((tag) => /polished|date|artful|cultural/.test(tag))) {
    return "Better as the date or culture stop than as a throwaway errand.";
  }
  if (tags.some((tag) => /group|social|lively|casual/.test(tag))) {
    return "Works when the outing needs a little more social energy.";
  }
  if (index === 0 && /restaurant|cafe|bar|pub/.test(category)) {
    return "Start here so the outing has a real place to land.";
  }
  if (/park/.test(category)) {
    return "Use this as the easy walk or outdoor reset in the route.";
  }
  if (/museum|library|arts_centre/.test(category)) {
    return "Add a culture or rainy-day stop that gives the plan a real activity.";
  }
  if (/mall/.test(category)) {
    return "Keep this as the weather-safe backup.";
  }
  if (index === total - 1) {
    return "Close with a nearby stop that keeps the route simple.";
  }
  return "Keep this as the simple nearby stop that gives the plan shape.";
}

function confidenceLabel(recordCount: number, stopCount: number) {
  if (recordCount >= 8 && stopCount >= 2) return "high";
  if (recordCount >= 3 && stopCount >= 2) return "medium";
  if (recordCount >= 1) return "low";
  return "none";
}

function friendlyPlanMessage(
  city: string,
  query: string,
  stops: Array<{ title: string }>,
) {
  const placeCity = city || "Ontario";
  const text = query.toLowerCase();
  const first = cleanText(stops[0]?.title);
  const second = cleanText(stops[1]?.title);
  const hasSecond = Boolean(second);
  if (!first) {
    return `${placeCity} is not giving a solid match for that yet. Try coffee, park, food, culture, or one quiet reset.`;
  }
  if (/\b(library|libraries)\b/.test(text)) {
    return hasSecond
      ? `Start with ${first}. Keep ${second} as the backup if the first library is not the right fit.`
      : `${first} is the clean library move. Use the map button when you are ready to go.`;
  }
  if (
    /\b(chinese|dim sum|dumpling|dumplings|hot pot|korean|indian|pakistani|jamaican|caribbean|ethiopian|vietnamese|filipino)\b/.test(
      text,
    )
  ) {
    return hasSecond
      ? `Start with ${first}. Keep ${second} as the backup, and check the card details before you commit to the cuisine.`
      : `${first} is the strongest nearby food lead. Check the card details before you commit to the cuisine.`;
  }
  if (
    /\b(relax|nerves|breathe|reset|quiet|calm|peaceful|chill|chilled|chilling)\b/.test(
      text,
    )
  ) {
    return hasSecond
      ? `Start at ${first}. If you feel like keeping the outing going, make it ${second}; otherwise let the first stop be enough.`
      : `${first} is the calm move. Go there first, then call it a good outing if that is all you feel like.`;
  }
  if (/\b(friend|friends|group)\b/.test(text)) {
    return hasSecond
      ? `${first} is the easy first stop with your friend. Keep ${second} as the second move if you both still feel like wandering.`
      : `${first} is the easy friend-plan move. Keep it simple and leave room to talk.`;
  }
  if (
    /\b(date|romantic|sweet|partner|baby|babe|girlfriend|boyfriend|wife|husband)\b/.test(
      text,
    )
  ) {
    return hasSecond
      ? `Start at ${first}; keep ${second} as the soft second stop if the night is going well.`
      : `${first} is enough for a low-pressure date. Let the room do the work.`;
  }
  if (/\b(surprise|random|pick|early|today|afternoon)\b/.test(text)) {
    return hasSecond
      ? `Start with ${first}. If the day still has room, make ${second} the easy second stop.`
      : `${first} is the move for today. Keep it light and do not over-plan it.`;
  }
  return hasSecond
    ? `Start with ${first}, then keep ${second} as the easy second stop. Simple enough to actually enjoy.`
    : `${first} is the move. Keep the plan light around it.`;
}

function fallbackSearchQueryForCategory(category: string, query = "") {
  const text = query.toLowerCase();
  if (category === "park") {
    if (/walk|walking|trail|hike/.test(text)) return "walk";
    return "relaxed";
  }
  if (category === "cultural_space") {
    if (/gallery|galleries/.test(text)) return "gallery";
    if (/culture|cultural/.test(text)) return "culture";
    return "art";
  }
  if (category === "food_premise") {
    return "lunch";
  }
  if (category === "library") {
    return "library";
  }
  if (category === "community_centre" || category === "public_facility") {
    return "community";
  }
  if (category === "trail" || category === "nature_reserve") {
    return /walk|walking|trail|hike/.test(text) ? "walk" : "relaxed";
  }
  return null;
}

function isSkippablePlaceSearchError(error: {
  code?: string;
  message?: string;
}) {
  return (
    error.code === "57014" ||
    /statement timeout|canceling statement/i.test(cleanText(error.message))
  );
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
    const categoryQuery =
      placeQuery || fallbackSearchQueryForCategory(category, input.query);
    const { data, error } = await input.supabase.rpc("search_ontario_places", {
      p_query: categoryQuery,
      p_city: input.city || null,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
      p_radius_meters: input.radiusMeters,
      p_category: category,
      p_limit: input.limit,
    });
    if (error) {
      if (isSkippablePlaceSearchError(error)) continue;
      throw error;
    }
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
      vibe: stopVibe(place, index, stops.length),
      timing:
        index === 0
          ? "Start here"
          : index === stops.length - 1
            ? "Finish nearby"
            : "Then walk or drive over",
    }));

    const debugStops = stops.map((place) => ({
      id: place.id,
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
      : `${city || "Ontario"} needs a broader lane`;
    const summary = "";
    const assistantMessage = stops.length
      ? friendlyPlanMessage(city || "Ontario", query, planStops)
      : `${city || "Ontario"} is not giving a solid match for that yet. Try a broader shape: coffee, park, food, culture, or one quiet reset.`;

    const responseData = {
      supported: Boolean(region.supported),
      region,
      plan: {
        title: routeTitle,
        summary: summary || assistantMessage,
        explanation: assistantMessage,
        steps: planStops,
      },
      compatibility: {
        mode: "ontario_plan",
        planShape: {
          stopCount: stops.length,
          intensity: stops.length >= 3 ? "route" : "simple",
          confidence:
            confidence === "high" ? 0.9 : confidence === "medium" ? 0.7 : 0.35,
          reason: "Grounded Ontario plan.",
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

    const debugToken = cleanText(req.headers.get("x-echoo-debug"));
    const adminToken = cleanText(Deno.env.get("LOCATION_ADMIN_TOKEN"));
    const debug =
      debugToken && adminToken && debugToken === adminToken
        ? {
            recordCount: places.length,
            stopCount: stops.length,
            confidence,
            sources: [
              "canonical_places",
              "place_profiles",
              "location_entities",
            ],
            ranking: "profile_vibe_editorial_confidence_v1",
            strongProfileCount: stops.filter(
              (place) => numberScore(place.profile_quality_score) >= 0.65,
            ).length,
            confidenceSafeCount: stops.filter(
              (place) => confidenceSafety(place) >= 0.86,
            ).length,
            stops: debugStops,
          }
        : undefined;

    return jsonResponse(
      envelope(responseData, {
        durationMs: Date.now() - startedAt,
        radiusMeters,
        ...(debug ? { debug } : {}),
      }),
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown Ontario plan error";
    return jsonResponse({ data: null, error: message, meta: {} }, 500);
  }
});
