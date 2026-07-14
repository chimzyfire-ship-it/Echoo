import {
  CORS_HEADERS,
  clampLimit,
  getSupabaseAdmin,
  jsonResponse,
  logLocationEvent,
  normalizeCityName,
  readLocationCache,
  sha256Hex,
  writeLocationCache,
} from "../_shared/location.ts";
import {
  companionVoiceRules,
  isModelMetaQuery,
  MODEL_META_RESPONSE,
} from "../_shared/companion-core.ts";

type DiscoverPayload = {
  query?: string;
  lat?: number;
  lng?: number;
  city?: unknown;
  limit?: number;
  profile?: {
    interests?: string[];
    budget?: string;
    energy?: string;
  };
};

type Candidate = {
  id: string;
  source: "echoo" | "ticketmaster" | "google_places";
  type: "event" | "place" | "activity";
  title: string;
  category: string;
  description: string;
  imageUrl?: string;
  venueName?: string;
  address?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  startsAt?: string;
  priceLabel?: string;
  actionUrl?: string;
  distanceMeters?: number;
  popularityScore?: number;
  sourceAttribution?: string;
  reason?: string;
  actionLabel?: string;
};

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function cleanText(value: unknown, fallback = "") {
  return String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();
}

function cityLabel(value: unknown, fallback = "Toronto") {
  if (typeof value === "string") {
    return cleanText(value, fallback);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return cleanText(
      record.city || record.name || record.label || record.title,
      fallback,
    );
  }
  return fallback;
}

function isDebugRequest(req: Request) {
  const debugToken = cleanText(req.headers.get("x-echoo-debug"));
  const adminToken = cleanText(Deno.env.get("LOCATION_ADMIN_TOKEN"));
  return Boolean(debugToken && adminToken && debugToken === adminToken);
}

function modelMetaResponse(query: string, city: string) {
  return {
    supported: true,
    mode: "live_discovery",
    query,
    city,
    recommendations: [],
    ai: {
      provider: "echoo-policy",
      model: "deterministic",
      assistantMessage: MODEL_META_RESPONSE,
      suggestedPills: ["Food nearby", "Events tonight", "Surprise me"],
    },
  };
}

const DISCOVERY_CITY_NAMES = [
  "Toronto",
  "Markham",
  "Vancouver",
  "Montreal",
  "Calgary",
  "Edmonton",
  "Ottawa",
  "Mississauga",
  "Brampton",
  "Scarborough",
  "North York",
  "Richmond Hill",
  "Hamilton",
  "Waterloo",
  "Kitchener",
  "London",
  "Winnipeg",
  "Halifax",
  "Victoria",
  "Quebec City",
];

function cityFromQuery(query = "") {
  return (
    DISCOVERY_CITY_NAMES.find((cityName) => {
      const pattern = new RegExp(
        `\\b${cityName.replace(/\s+/g, "\\s+")}\\b`,
        "i",
      );
      return pattern.test(query);
    }) || ""
  );
}

function nearbyMetroCity(city = "") {
  if (
    /^(markham|mississauga|brampton|scarborough|north york|richmond hill)$/i.test(
      city.trim(),
    )
  ) {
    return "Toronto";
  }
  return "";
}

function safeArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, 10);
}

function uniqueById(items: Candidate[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function inferSearchIntent(query = "") {
  const text = query.toLowerCase();
  const wantsFood =
    /food|eat|restaurant|dinner|lunch|brunch|cafe|coffee|bar|drink|date/i.test(
      text,
    );
  const wantsEvents =
    /event|concert|show|meetup|nightlife|party|network|ticket|music|tonight|weekend|bored/i.test(
      text,
    );
  const wantsSocial =
    /new|newcomer|meet people|friends|social|network|student|community/i.test(
      text,
    );
  const wantsFree = /free|cheap|no cost|budget/i.test(text);
  const placeQuery =
    wantsFood && wantsEvents
      ? `${query} restaurants bars late food`
      : wantsFood
        ? query
        : wantsSocial
          ? `${query} social restaurants cafes bars`
          : `${query} restaurants attractions things to do`;
  return {
    wantsFood,
    wantsEvents: wantsEvents || !wantsFood,
    wantsPlaces: true,
    wantsSocial,
    wantsFree,
    placeQuery,
  };
}

function ticketmasterKeyword(query = "") {
  const text = query.toLowerCase();
  if (/concert|music|dj|band|festival|show|nightlife|party/.test(text)) {
    return "music";
  }
  if (/sport|game|basketball|hockey|soccer|baseball|football/.test(text)) {
    return "sports";
  }
  if (/comedy|standup|stand-up/.test(text)) return "comedy";
  if (/theatre|theater|play|musical|opera|ballet/.test(text)) return "theatre";
  if (/family|kids/.test(text)) return "family";
  return "";
}

function scoreCandidate(item: Candidate, query: string) {
  const text =
    `${item.title} ${item.category} ${item.description}`.toLowerCase();
  const words = query
    .toLowerCase()
    .split(/\W+/)
    .filter((word) => word.length > 3);
  const queryHits = words.filter((word) => text.includes(word)).length;
  const timeScore = item.startsAt
    ? Math.max(
        0,
        1 -
          Math.abs(new Date(item.startsAt).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24 * 14),
      )
    : 0.35;
  const distanceScore = item.distanceMeters
    ? Math.max(0, 1 - item.distanceMeters / 30000)
    : 0.45;
  const popularityScore = Math.min(item.popularityScore || 0.4, 1);
  const titlePenalty = /combo ticket|weekend pass|parking|add-on|package/i.test(
    item.title,
  )
    ? 0.22
    : 0;
  return (
    queryHits * 0.2 +
    timeScore * 0.25 +
    distanceScore * 0.28 +
    popularityScore * 0.27 -
    titlePenalty
  );
}

function balancedShortlist(input: {
  candidates: Candidate[];
  query: string;
  intent: ReturnType<typeof inferSearchIntent>;
  limit: number;
}) {
  const scored = input.candidates
    .filter(isUsefulNow)
    .map((item) => ({ item, score: scoreCandidate(item, input.query) }))
    .sort((a, b) => b.score - a.score);
  const picked: Candidate[] = [];
  const seen = new Set<string>();
  const pick = (predicate: (item: Candidate) => boolean, max: number) => {
    for (const { item } of scored) {
      if (picked.length >= input.limit || max <= 0) break;
      const key = `${item.source}:${item.id}`;
      if (seen.has(key) || !predicate(item)) continue;
      picked.push(item);
      seen.add(key);
      max--;
    }
  };

  if (input.intent.wantsEvents) {
    pick(
      (item) => item.source === "ticketmaster",
      input.intent.wantsFood || input.intent.wantsSocial ? 4 : 3,
    );
  }
  if (input.intent.wantsFood || input.intent.wantsPlaces) {
    pick(
      (item) => item.source === "google_places",
      input.intent.wantsEvents ? 3 : 6,
    );
  }
  pick((item) => item.source === "echoo", 2);
  pick(() => true, input.limit - picked.length);
  return picked.slice(0, input.limit);
}

function isUsefulNow(item: Candidate) {
  if (item.type !== "event" || !item.startsAt) return true;
  const startsAt = new Date(item.startsAt).getTime();
  if (!Number.isFinite(startsAt)) return true;
  return startsAt >= Date.now() - 1000 * 60 * 60 * 3;
}

function freshStartsAt(value: unknown) {
  const startsAt = cleanText(value);
  if (!startsAt) return undefined;
  const time = new Date(startsAt).getTime();
  if (!Number.isFinite(time)) return undefined;
  return time >= Date.now() - 1000 * 60 * 60 * 3 ? startsAt : undefined;
}

function ticketmasterDateWindow(query = "") {
  const text = query.toLowerCase();
  const now = new Date();
  const end = new Date(now);
  if (/tonight|today|bored/.test(text)) {
    end.setHours(end.getHours() + 18);
  } else if (/weekend/.test(text)) {
    const day = end.getDay();
    const daysUntilMonday = (8 - day) % 7 || 7;
    end.setDate(end.getDate() + daysUntilMonday);
    end.setHours(8, 0, 0, 0);
  } else if (/this week|week/.test(text)) {
    end.setDate(end.getDate() + 7);
  } else {
    end.setDate(end.getDate() + 14);
  }
  const toApiDate = (date: Date) =>
    date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return { startDateTime: toApiDate(now), endDateTime: toApiDate(end) };
}

async function loadEchooCandidates(input: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  lat?: number;
  lng?: number;
  city: string;
  query: string;
  limit: number;
}): Promise<Candidate[]> {
  const cityRecord = normalizeCityName(input.city || "Ontario");
  const hasCoordinates =
    Number.isFinite(input.lat) && Number.isFinite(input.lng);
  const { data, error } = hasCoordinates
    ? await input.supabase.rpc("search_nearby_entities", {
        p_lat: Number(input.lat),
        p_lng: Number(input.lng),
        p_radius_meters: 30000,
        p_entity_type: null,
        p_category: null,
        p_limit: input.limit,
      })
    : await input.supabase.rpc("search_region_entities", {
        p_country_code: "CA",
        p_admin_area_1: cityRecord?.province || null,
        p_city:
          cityRecord?.coverageLevel === "province"
            ? null
            : cityRecord?.name || input.city || null,
        p_entity_type: null,
        p_category: null,
        p_limit: input.limit,
      });

  if (error) throw error;

  return (data || []).map((item: any) => {
    const type = item.entity_type === "event" ? "event" : "activity";
    return {
      id: String(item.entity_id || item.id || item.title),
      source: "echoo",
      type,
      title: cleanText(item.title, "Echoo pick"),
      category: cleanText(item.category || item.entity_type, "activity"),
      description: cleanText(item.description),
      imageUrl: item.image_url,
      city: item.city || input.city,
      latitude: optionalNumber(item.latitude),
      longitude: optionalNumber(item.longitude),
      startsAt:
        type === "event" ? item.starts_at : freshStartsAt(item.starts_at),
      distanceMeters: optionalNumber(item.distance_meters),
      popularityScore: optionalNumber(item.rank_score || item.popularity_score),
      actionLabel: type === "event" ? "Join" : "Open",
    };
  });
}

async function loadTicketmasterCandidates(input: {
  query: string;
  lat?: number;
  lng?: number;
  city: string;
  limit: number;
}): Promise<Candidate[]> {
  const key = Deno.env.get("TICKETMASTER_API_KEY");
  if (!key) return [];

  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.searchParams.set("apikey", key);
  url.searchParams.set("size", String(Math.min(input.limit, 20)));
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("countryCode", "CA");
  const dateWindow = ticketmasterDateWindow(input.query);
  url.searchParams.set("startDateTime", dateWindow.startDateTime);
  url.searchParams.set("endDateTime", dateWindow.endDateTime);
  const keyword = ticketmasterKeyword(input.query);
  if (keyword) url.searchParams.set("keyword", keyword);
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    url.searchParams.set("latlong", `${input.lat},${input.lng}`);
    url.searchParams.set("radius", "35");
    url.searchParams.set("unit", "km");
  } else if (input.city) {
    url.searchParams.set("city", input.city);
  }

  const response = await fetch(url);
  if (!response.ok) {
    console.warn("Ticketmaster discovery failed:", await response.text());
    return [];
  }

  let payload = await response.json();
  let events = payload?._embedded?.events || [];
  const fallbackCity = nearbyMetroCity(input.city);
  if (
    !events.length &&
    fallbackCity &&
    !(Number.isFinite(input.lat) && Number.isFinite(input.lng))
  ) {
    const fallbackUrl = new URL(url);
    fallbackUrl.searchParams.set("city", fallbackCity);
    const fallbackResponse = await fetch(fallbackUrl);
    if (fallbackResponse.ok) {
      payload = await fallbackResponse.json();
      events = payload?._embedded?.events || [];
    }
  }
  const mapped: Candidate[] = events.map((event: any) => {
    const venue = event?._embedded?.venues?.[0] || {};
    const price = event?.priceRanges?.[0];
    const image =
      event?.images?.find((item: any) => item.ratio === "16_9") ||
      event?.images?.[0];
    return {
      id: cleanText(event.id || event.url || event.name),
      source: "ticketmaster",
      type: "event",
      title: cleanText(event.name, "Ticketmaster event"),
      category: cleanText(
        event?.classifications?.[0]?.segment?.name ||
          event?.classifications?.[0]?.genre?.name ||
          "event",
      ),
      description: cleanText(event.info || event.pleaseNote),
      imageUrl: image?.url,
      venueName: cleanText(venue.name),
      address: cleanText(
        [venue?.address?.line1, venue?.city?.name, venue?.state?.stateCode]
          .filter(Boolean)
          .join(", "),
      ),
      city: cleanText(venue?.city?.name || input.city),
      latitude: optionalNumber(venue?.location?.latitude),
      longitude: optionalNumber(venue?.location?.longitude),
      startsAt: freshStartsAt(
        event?.dates?.start?.dateTime || event?.dates?.start?.localDate,
      ),
      priceLabel: price
        ? `${price.currency || "CAD"} ${Math.round(price.min)}-${Math.round(
            price.max,
          )}`
        : "See tickets",
      actionUrl: event.url,
      popularityScore: 0.7,
      actionLabel: "See tickets",
    } satisfies Candidate;
  });
  const allowPasses = /pass|festival|weekend/i.test(input.query);
  const nonCombo = mapped.filter(
    (event) =>
      allowPasses ||
      !/combo ticket|weekend pass|parking|add-on|package/i.test(event.title),
  );
  return nonCombo.length >= Math.min(5, input.limit) ? nonCombo : mapped;
}

async function loadGooglePlaceCandidates(input: {
  req: Request;
  query: string;
  lat?: number;
  lng?: number;
  city: string;
  limit: number;
}): Promise<Candidate[]> {
  const key =
    Deno.env.get("GOOGLE_PLACES_API_KEY") ||
    Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key) return [];

  const body: Record<string, unknown> = {
    textQuery: input.query || `things to do in ${input.city}`,
    maxResultCount: Math.min(input.limit, 12),
    languageCode: "en",
  };
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    body.locationBias = {
      circle: {
        center: { latitude: input.lat, longitude: input.lng },
        radius: 18000,
      },
    };
  } else if (input.city) {
    body.textQuery = `${body.textQuery} in ${input.city}`;
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
    console.warn("Google Places discovery failed:", await response.text());
    return [];
  }

  const payload = await response.json();
  return (payload?.places || []).map((place: any) => ({
    id: cleanText(place.id || place.googleMapsUri || place.displayName?.text),
    source: "google_places",
    type: "place",
    title: cleanText(place.displayName?.text, "Place"),
    category: cleanText(place.types?.[0] || "place").replace(/_/g, " "),
    description: cleanText(place.formattedAddress),
    address: cleanText(place.formattedAddress),
    city: input.city,
    latitude: optionalNumber(place.location?.latitude),
    longitude: optionalNumber(place.location?.longitude),
    actionUrl: place.googleMapsUri,
    // Google results are a live coverage fallback. Echoo ratings and Hot Picks
    // are computed only from Echoo-owned community activity.
    popularityScore: 0.45,
    sourceAttribution: "Google Maps",
    actionLabel: "Directions",
  }));
}

function deterministicExplain(item: Candidate, query: string) {
  const lower = query.toLowerCase();
  if (item.type === "event") {
    const when = item.startsAt
      ? new Date(item.startsAt).toLocaleString("en-CA", {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : "soon";
    const venue = item.venueName ? ` at ${item.venueName}` : "";
    const price = item.priceLabel ? ` ${item.priceLabel}.` : "";
    return lower.includes("meet") || lower.includes("new")
      ? `${item.title}${venue} gives you a built-in reason to talk to people. ${when}.${price}`.trim()
      : `${item.title}${venue} lines up for ${when}, with a clear next step.${price}`.trim();
  }
  if (/food|dinner|date|drink|restaurant/i.test(lower)) {
    return `${item.title} works as the food, drink, or conversation stop before or after the main move.`;
  }
  return `${item.title} is a real place you can start from now.`;
}

function assistantMessageFor(input: {
  count: number;
  intent: ReturnType<typeof inferSearchIntent>;
  ticketmasterCount: number;
  placesCount: number;
  city: string;
}) {
  if (!input.count) {
    return `${input.city} did not return clean live records for that exact ask yet. Broaden the mood, switch neighbourhoods, or ask Echoo for a quieter fallback plan.`;
  }
  if (input.intent.wantsFood && input.ticketmasterCount && input.placesCount) {
    return `${input.city} has a night-out mix here: live events first, then nearby food or drinks.`;
  }
  if (input.intent.wantsSocial) {
    return `${input.city} has social options with built-in reasons to show up and talk to people.`;
  }
  if (input.intent.wantsFree) {
    return `${input.city} has low-friction options to check now, including free or easy-entry picks where available.`;
  }
  if (input.ticketmasterCount && input.placesCount) {
    return `${input.city} has live events plus nearby places that can become a real plan.`;
  }
  if (input.ticketmasterCount) {
    return `${input.city} has live events you can act on now.`;
  }
  if (input.placesCount) {
    return `${input.city} has nearby places that can turn into a real outing.`;
  }
  return `${input.city} has a few Echoo picks you can act on now.`;
}

function isWeakReason(reason = "") {
  return (
    reason.length < 45 ||
    /real nearby event|fits the moment|concrete thing|concrete live option|practical nearby stop/i.test(
      reason,
    )
  );
}

function parseGeminiJson(text: string) {
  const source = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
  const jsonText = source.includes("{")
    ? source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1)
    : source;
  try {
    return JSON.parse(jsonText);
  } catch (_err) {
    return null;
  }
}

async function explainWithGemini(input: {
  query: string;
  candidates: Candidate[];
  profile: DiscoverPayload["profile"];
}) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key || input.candidates.length === 0) return input.candidates;

  const prompt = [
    companionVoiceRules(),
    "Return JSON with intro and recommendations. Each recommendation must include id, reason, and actionLabel.",
    JSON.stringify({
      userQuery: input.query,
      userSignals: {
        interests: safeArray(input.profile?.interests),
        budget: cleanText(input.profile?.budget),
        energy: cleanText(input.profile?.energy),
      },
      candidates: input.candidates.slice(0, 8).map((item) => ({
        id: item.id,
        source: item.source,
        type: item.type,
        title: item.title,
        category: item.category,
        description: item.description,
        city: item.city,
        startsAt: item.startsAt,
        priceLabel: item.priceLabel,
      })),
    }),
  ].join("\n\n");

  const configured = Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
  const configuredFallbacks = (Deno.env.get("GEMINI_MODEL_FALLBACKS") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const models = [
    ...new Set([
      configured,
      ...configuredFallbacks,
      DEFAULT_GEMINI_MODEL,
      "gemini-2.5-flash",
      "gemini-2.0-flash",
      "gemini-flash-latest",
    ]),
  ];
  for (const model of models) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetch(
        `${GEMINI_ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.55,
              maxOutputTokens: 900,
              responseMimeType: "application/json",
            },
          }),
        },
      );
      if (!response.ok) continue;
      const payload = await response.json();
      const text =
        payload?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text || "")
          .join("\n") || "";
      const parsed = parseGeminiJson(text);
      const notes = new Map<string, { reason?: string; actionLabel?: string }>(
        (parsed?.recommendations || []).map((item: any) => [
          cleanText(item.id),
          item,
        ]),
      );
      return input.candidates.map((item) => {
        const note = notes.get(item.id);
        const aiReason = cleanText(note?.reason);
        return {
          ...item,
          reason: isWeakReason(aiReason)
            ? deterministicExplain(item, input.query)
            : aiReason,
          actionLabel:
            cleanText(note?.actionLabel) || item.actionLabel || "Open",
        };
      });
    } catch (_err) {
      continue;
    } finally {
      clearTimeout(timeout);
    }
  }

  return input.candidates;
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabase = getSupabaseAdmin();
  try {
    const body = (await req.json().catch(() => ({}))) as DiscoverPayload;
    const query = cleanText(body.query, "things to do nearby");
    const city = cityFromQuery(query) || cityLabel(body.city, "Toronto");
    const debugRequested = isDebugRequest(req);
    if (isModelMetaQuery(query)) {
      return jsonResponse(modelMetaResponse(query, city));
    }
    const lat = optionalNumber(body.lat);
    const lng = optionalNumber(body.lng);
    const limit = Math.min(clampLimit(body.limit || 8), 12);
    const intent = inferSearchIntent(query);
    const cacheKey = await sha256Hex(
      JSON.stringify({
        v: 10,
        query: query.toLowerCase(),
        city: city.toLowerCase(),
        lat: lat ? lat.toFixed(3) : null,
        lng: lng ? lng.toFixed(3) : null,
        limit,
      }),
    );
    const cached = debugRequested
      ? null
      : await readLocationCache(supabase, cacheKey);
    if (cached) return jsonResponse({ ...cached, cacheHit: true });

    const [echoo, ticketmaster, places] = await Promise.all([
      loadEchooCandidates({ supabase, lat, lng, city, query, limit: 16 }),
      intent.wantsEvents
        ? loadTicketmasterCandidates({ query, lat, lng, city, limit: 12 })
        : Promise.resolve([]),
      intent.wantsPlaces
        ? loadGooglePlaceCandidates({
            req,
            query: intent.placeQuery,
            lat,
            lng,
            city,
            limit: 12,
          })
        : Promise.resolve([]),
    ]);

    const ranked = balancedShortlist({
      candidates: uniqueById([...echoo, ...ticketmaster, ...places]),
      query,
      intent,
      limit,
    });
    const recommendations = await explainWithGemini({
      query,
      candidates: ranked,
      profile: body.profile,
    });

    const response = {
      supported: true,
      mode: "live_discovery",
      query,
      city,
      recommendations,
      ai: {
        provider: "echoo-live",
        assistantMessage: assistantMessageFor({
          count: recommendations.length,
          intent,
          ticketmasterCount: ticketmaster.length,
          placesCount: places.length,
          city,
        }),
        suggestedPills: ["Food nearby", "Events tonight", "Free things to do"],
      },
      ...(debugRequested
        ? {
            debug: {
              sources: {
                echoo: echoo.length,
                ticketmaster: ticketmaster.length,
                googlePlaces: places.length,
                ticketmasterConfigured: Boolean(
                  Deno.env.get("TICKETMASTER_API_KEY"),
                ),
                googlePlacesConfigured: Boolean(
                  Deno.env.get("GOOGLE_PLACES_API_KEY") ||
                  Deno.env.get("GOOGLE_MAPS_API_KEY"),
                ),
              },
              intent,
              rankedCount: ranked.length,
            },
          }
        : {}),
    };

    if (!debugRequested) {
      await writeLocationCache(supabase, cacheKey, response, 600);
    }
    await logLocationEvent(supabase, {
      functionName: "discover-live",
      eventType:
        Date.now() - startedAt > 1500
          ? "slow_live_discovery"
          : "live_discovery",
      durationMs: Date.now() - startedAt,
      city,
      request: { query, city, limit, hasLatLng: Boolean(lat && lng) },
      responseSummary: {
        count: recommendations.length,
        echoo: echoo.length,
        ticketmaster: ticketmaster.length,
        googlePlaces: places.length,
      },
    });
    return jsonResponse(response);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown live discovery error";
    return jsonResponse({ error: message, code: "discover_failed" }, 500);
  }
});
