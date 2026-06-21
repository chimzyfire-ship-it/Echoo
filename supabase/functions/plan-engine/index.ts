import {
  CORS_HEADERS,
  clampLimit,
  getSupabaseAdmin,
  isInsideCanadaBounds,
  jsonResponse,
  logLocationEvent,
  nearestSupportedCity,
  normalizeCityName,
} from "../_shared/location.ts";

type PlanPayload = {
  lat?: number;
  lng?: number;
  city?: string;
  query?: string;
  energy?: string;
  budget?: string;
  groupSize?: number;
  limit?: number;
};

const dayparts = [
  { id: "morning", min: 7, max: 11, tags: ["coffee", "brunch", "parks", "wellness", "galleries"] },
  { id: "midday", min: 11, max: 14, tags: ["food", "museums", "shopping", "parks", "family"] },
  { id: "afternoon", min: 14, max: 17, tags: ["culture", "galleries", "coffee", "outdoors", "solo"] },
  { id: "after_work", min: 17, max: 20, tags: ["food", "date", "group", "sports", "movies"] },
  { id: "evening", min: 20, max: 23, tags: ["music", "movies", "date", "food", "cocktails"] },
  { id: "late", min: 23, max: 28, tags: ["music", "food", "nightlife", "arcade"] },
];

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function currentContext(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "long",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const dayName = parts.find((part) => part.type === "weekday")?.value || "Today";
  const hourRaw = Number(parts.find((part) => part.type === "hour")?.value || 12);
  const hour = hourRaw < 4 ? hourRaw + 24 : hourRaw;
  const daypart = dayparts.find((part) => hour >= part.min && hour < part.max) || dayparts[2];
  return { dayName, hour: hourRaw, daypart };
}

function intentTags(query = "", energy = "") {
  const text = `${query} ${energy}`.toLowerCase();
  const tags = new Set<string>();
  if (/coffee|cafe|work|read|calm|quiet|solo/.test(text)) tags.add("coffee").add("solo").add("quiet");
  if (/food|eat|lunch|dinner|brunch|restaurant|hungry/.test(text)) tags.add("food");
  if (/date|romantic|partner/.test(text)) tags.add("date");
  if (/friend|group|crew|people/.test(text)) tags.add("group");
  if (/movie|film|cinema/.test(text)) tags.add("movies");
  if (/music|concert|dj|dance/.test(text)) tags.add("music");
  if (/museum|gallery|art|culture/.test(text)) tags.add("culture").add("galleries");
  if (/park|walk|outside|outdoor|hike/.test(text)) tags.add("outdoors").add("parks");
  if (/cheap|free|budget/.test(text)) tags.add("cheap");
  if (/hype|active|loud|energy/.test(text)) tags.add("group").add("music");
  if (tags.size === 0) tags.add("food").add("culture").add("coffee");
  return [...tags];
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = getSupabaseAdmin();

  try {
    const body = await req.json().catch(() => ({})) as PlanPayload;
    const lat = optionalNumber(body.lat);
    const lng = optionalNumber(body.lng);
    const limit = clampLimit(body.limit || 3);
    const query = body.query || "";

    if (lat !== undefined && lng !== undefined && !isInsideCanadaBounds(lat, lng)) {
      const response = { supported: false, reason: "outside_canada", plans: [] };
      await logLocationEvent(supabase, {
        functionName: "plan-engine",
        eventType: "unsupported_region",
        status: "blocked",
        reason: "outside_canada",
        durationMs: Date.now() - startedAt,
        request: { lat, lng, query },
      });
      return jsonResponse(response);
    }

    const region = lat !== undefined && lng !== undefined
      ? nearestSupportedCity(lat, lng)
      : normalizeCityName(body.city || "Toronto") || normalizeCityName("Toronto")!;
    const context = currentContext(region.timezone);
    const tags = [...new Set([...context.daypart.tags, ...intentTags(query, body.energy)])];

    const { data, error } = lat !== undefined && lng !== undefined
      ? await supabase.rpc("search_nearby_entities", {
          p_lat: lat,
          p_lng: lng,
          p_radius_meters: 30000,
          p_entity_type: null,
          p_category: null,
          p_limit: 24,
        })
      : await supabase.rpc("search_region_entities", {
          p_country_code: "CA",
          p_admin_area_1: region.province,
          p_city: region.name,
          p_entity_type: null,
          p_category: null,
          p_limit: 24,
        });
    if (error) throw error;

    const candidates = (data || []).map((item: any) => {
      const haystack = `${item.title} ${item.description || ""} ${item.category || ""}`.toLowerCase();
      const tagHits = tags.filter((tag) => haystack.includes(tag) || (tag === "food" && /kitchen|dinner|lunch|restaurant/.test(haystack))).length;
      const distanceScore = item.distance_meters ? Math.max(0, 1 - item.distance_meters / 30000) : 0.55;
      const score = tagHits * 0.22 + distanceScore * 0.25 + Number(item.rank_score || item.popularity_score || 0) * 0.35 + 0.18;
      return { ...item, score };
    }).sort((a: any, b: any) => b.score - a.score).slice(0, Math.max(3, limit));

    const plans = candidates.slice(0, limit).map((item: any, index: number) => ({
      id: item.id,
      entityId: item.entity_id,
      entityType: item.entity_type,
      title: item.title,
      category: item.category || item.entity_type,
      imageUrl: item.image_url,
      city: item.city || region.name,
      latitude: item.latitude,
      longitude: item.longitude,
      distanceMeters: item.distance_meters || null,
      why: index === 0
        ? `Best fit for ${context.daypart.id.replace("_", " ")} near ${region.name}.`
        : `A strong backup that still matches the current pace.`,
      description: item.description,
      score: Number(item.score.toFixed(3)),
    }));

    const response = {
      supported: true,
      region,
      context: {
        dayName: context.dayName,
        localHour: context.hour,
        daypart: context.daypart.id,
        tags,
      },
      summary: `Built for ${context.daypart.id.replace("_", " ")} in ${region.name}.`,
      plans,
    };

    await logLocationEvent(supabase, {
      functionName: "plan-engine",
      eventType: Date.now() - startedAt > 1000 ? "slow_plan" : "plan",
      durationMs: Date.now() - startedAt,
      countryCode: "CA",
      adminArea1: region.province,
      city: region.name,
      request: { query, tags, precise: lat !== undefined && lng !== undefined },
      responseSummary: { count: plans.length, daypart: context.daypart.id },
    });

    return jsonResponse(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown plan engine error";
    await logLocationEvent(supabase, {
      functionName: "plan-engine",
      eventType: "plan_failed",
      status: "error",
      reason: message,
      durationMs: Date.now() - startedAt,
    });
    return jsonResponse({ error: message }, 500);
  }
});
