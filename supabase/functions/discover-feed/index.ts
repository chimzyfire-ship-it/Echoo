import {
  CORS_HEADERS,
  clampLimit,
  getSupabaseAdmin,
  jsonResponse,
  logLocationEvent,
  normalizeCityName,
} from "../_shared/location.ts";

type FeedPayload = {
  city?: string;
  lat?: number;
  lng?: number;
  limit?: number;
  mode?: string;
};

type FeedCard = {
  id: string;
  type: "event" | "place" | "news" | "music";
  title: string;
  subtitle?: string;
  city?: string;
  imageUrl?: string;
  statusLabel?: string;
  actionLabel?: string;
  detailUrl?: string;
  source?: string;
  startsAt?: string;
  priceLabel?: string;
  category?: string;
  distanceMeters?: number;
  score?: number;
};

type FeedLane = {
  id: string;
  title: string;
  label?: string;
  cards: FeedCard[];
};

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

function approvedImageUrl(value: unknown) {
  const image = cleanText(value);
  if (!image) return undefined;
  if (/^https?:\/\//i.test(image)) return image;
  // This is reviewed Echoo venue media in the public discovery-covers bucket,
  // not a generated or stock-image fallback.
  return `https://dlezregdjpdqmooubwvl.supabase.co/storage/v1/object/public/discovery-covers/${image.split("/").map(encodeURIComponent).join("/")}`;
}

function errorMessage(err: unknown, fallback: string) {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    return cleanText((err as { message?: unknown }).message, fallback);
  }
  return fallback;
}

function envelope(data: unknown, meta: Record<string, unknown> = {}) {
  return { data, error: null, meta };
}

function isToday(value?: string) {
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const now = new Date();
  return date.toDateString() === now.toDateString();
}

function formatDateLabel(value?: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("en-CA", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function ticketmasterDateWindow(mode = "") {
  const now = new Date();
  const end = new Date(now);
  if (/tonight|today/i.test(mode)) {
    end.setHours(end.getHours() + 18);
  } else if (/weekend/i.test(mode)) {
    const day = end.getDay();
    const daysUntilMonday = (8 - day) % 7 || 7;
    end.setDate(end.getDate() + daysUntilMonday);
    end.setHours(8, 0, 0, 0);
  } else {
    end.setDate(end.getDate() + 14);
  }
  const toApiDate = (date: Date) =>
    date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return { startDateTime: toApiDate(now), endDateTime: toApiDate(end) };
}

function ticketmasterCity(city = "") {
  // "GTA" is an Echoo regional choice, not a city Ticketmaster recognises.
  // Toronto is the correct Ticketmaster market for that regional setting.
  if (/^(gta|greater toronto area|markham|scarborough|north york|richmond hill|vaughan)$/i.test(city)) {
    return "Toronto";
  }
  if (!city || /^ontario$/i.test(city)) return "Toronto";
  return city;
}

function scorePlace(place: any) {
  const profileQuality = Number(place.profile_quality_score ?? 0.45);
  const confidence = Number(place.confidence_score ?? 0.45);
  const editorialBoost = Number(place.editorial_boost ?? 0);
  const rank = Number(place.rank_score ?? 0.45);
  return (
    rank * 0.42 +
    profileQuality * 0.24 +
    confidence * 0.2 +
    editorialBoost * 0.14
  );
}

function normalizeEventCard(item: any): FeedCard {
  const startsAt = cleanText(item.starts_at);
  const metadata = item.metadata || {};
  const category = cleanText(item.category || "event");
  return {
    id: cleanText(item.entity_id || item.id || item.source_provider_id),
    type: "event",
    title: cleanText(item.title, "GTA event"),
    subtitle: cleanText(metadata.venue_name || item.description || item.city),
    city: cleanText(item.city, "Greater Toronto Area"),
    imageUrl: approvedImageUrl(item.image_url || item.cover_url),
    statusLabel: isToday(startsAt) ? "Tonight" : formatDateLabel(startsAt),
    actionLabel: metadata.ticket_url ? "See tickets" : "Open",
    detailUrl:
      metadata.ticket_url ||
      `event.html?id=${encodeURIComponent(cleanText(item.entity_id || item.id))}`,
    source: cleanText(item.source_provider || "echoo"),
    startsAt,
    priceLabel: cleanText(metadata.price_label),
    category,
    distanceMeters: optionalNumber(item.distance_meters),
    score: optionalNumber(item.rank_score || item.popularity_score),
  };
}

function normalizeTicketmasterCard(event: any, city: string): FeedCard {
  const venue = event?._embedded?.venues?.[0] || {};
  const image =
    event?.images?.find((item: any) => item.ratio === "16_9") ||
    event?.images?.[0];
  const price = event?.priceRanges?.[0];
  const startsAt = cleanText(
    event?.dates?.start?.dateTime || event?.dates?.start?.localDate,
  );
  const category = cleanText(
    event?.classifications?.[0]?.segment?.name ||
      event?.classifications?.[0]?.genre?.name ||
      "event",
  );
  return {
    id: cleanText(event.id || event.url || event.name),
    type: "event",
    title: cleanText(event.name, "GTA event"),
    subtitle: cleanText(venue.name || event.info || city),
    city: cleanText(venue?.city?.name || city || "Greater Toronto Area"),
    imageUrl: cleanText(image?.url) || undefined,
    statusLabel: isToday(startsAt) ? "Tonight" : formatDateLabel(startsAt),
    actionLabel: "See tickets",
    detailUrl: cleanText(event.url),
    source: "ticketmaster",
    startsAt,
    priceLabel: price
      ? `${price.currency || "CAD"} ${Math.round(price.min)}-${Math.round(
          price.max,
        )}`
      : "Selling now",
    category,
    distanceMeters: optionalNumber(event.distance),
    score: 0.82,
  };
}

function normalizePlaceCard(place: any): FeedCard {
  const category = cleanText(place.category || "place");
  const city = cleanText(place.municipality || place.city || "Greater Toronto Area");
  const tags = [
    ...(Array.isArray(place.vibe_tags) ? place.vibe_tags : []),
    ...(Array.isArray(place.good_for) ? place.good_for : []),
  ]
    .map((tag) => cleanText(tag))
    .filter(Boolean)
    .slice(0, 2);

  return {
    id: cleanText(place.id),
    type: "place",
    title: cleanText(place.name || place.title, "GTA place"),
    subtitle: tags.length
      ? tags.join(" · ")
      : cleanText(place.address || category),
    city,
    imageUrl: undefined,
    statusLabel: place.distance_meters ? "Near you" : "GTA pick",
    actionLabel: "View place",
    detailUrl: `app.html?q=${encodeURIComponent(`${cleanText(place.name || place.title)} ${city}`)}`,
    source: cleanText(place.source_provider || "echoo"),
    category,
    distanceMeters: optionalNumber(place.distance_meters),
    score: Number(scorePlace(place).toFixed(4)),
  };
}

function normalizeEntityPlaceCard(place: any): FeedCard {
  const category = cleanText(place.category || "place");
  const city = cleanText(place.city || "Greater Toronto Area");
  return {
    id: cleanText(place.entity_id || place.place_id || place.id),
    type: "place",
    title: cleanText(place.title || place.name, "GTA place"),
    subtitle: cleanText(place.description || category),
    city,
    imageUrl: approvedImageUrl(place.image_url || place.cover_url),
    statusLabel: place.distance_meters ? "Near you" : "GTA pick",
    actionLabel: "View place",
    detailUrl: `app.html?q=${encodeURIComponent(`${cleanText(place.title || place.name)} ${city}`)}`,
    source: cleanText(place.source_provider || "echoo"),
    category,
    distanceMeters: optionalNumber(place.distance_meters),
    score: optionalNumber(place.rank_score || place.popularity_score),
  };
}

async function loadEventLane(input: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  city: string;
  lat?: number;
  lng?: number;
  limit: number;
  mode?: string;
}) {
  // Tickets must never depend on an optional internal-events index. The live
  // Ticketmaster lane is the source of truth for events that can be bought.
  return loadTicketmasterEventLane({
    city: input.city,
    lat: input.lat,
    lng: input.lng,
    limit: input.limit,
    mode: input.mode,
  });
}

async function loadTicketmasterEventLane(input: {
  city: string;
  lat?: number;
  lng?: number;
  limit: number;
  mode?: string;
}) {
  const key = Deno.env.get("TICKETMASTER_API_KEY");
  if (!key) return [];

  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  const dateWindow = ticketmasterDateWindow(input.mode);
  url.searchParams.set("apikey", key);
  url.searchParams.set("size", String(Math.min(Math.max(input.limit, 6), 20)));
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("countryCode", "CA");
  url.searchParams.set("startDateTime", dateWindow.startDateTime);
  url.searchParams.set("endDateTime", dateWindow.endDateTime);
  url.searchParams.set(
    "classificationName",
    "music,arts,theatre,comedy,sports,family",
  );
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    url.searchParams.set("latlong", `${input.lat},${input.lng}`);
    url.searchParams.set("radius", "35");
    url.searchParams.set("unit", "km");
  } else {
    url.searchParams.set("city", ticketmasterCity(input.city));
  }

  const response = await fetch(url);
  if (!response.ok) {
    console.warn(
      "discover-feed Ticketmaster lane skipped:",
      await response.text(),
    );
    return [];
  }

  const payload = await response.json();
  return (payload?._embedded?.events || [])
    .map((event: any) =>
      normalizeTicketmasterCard(event, ticketmasterCity(input.city)),
    )
    .filter((event: FeedCard) => {
      if (!event.startsAt) return true;
      return (
        new Date(event.startsAt).getTime() >= Date.now() - 1000 * 60 * 60 * 3
      );
    })
    .filter(
      (event: FeedCard) =>
        !/combo ticket|weekend pass|parking|add-on|package/i.test(event.title),
    )
    .filter((event: FeedCard) => Boolean(event.imageUrl))
    .slice(0, input.limit);
}

async function loadPlaceLane(input: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  city: string;
  lat?: number;
  lng?: number;
  limit: number;
}) {
  const hasCoordinates =
    Number.isFinite(input.lat) && Number.isFinite(input.lng);
  const cityRecord = normalizeCityName(input.city || "GTA");
  // Do not make an unbounded table scan just to fill a visual lane. Each
  // category query is indexed, scoped, and only returns approved photography.
  const categories = ["restaurant", "cafe", "bar", "museum", "park"];
  const batches = await Promise.all(categories.map(async (category) => {
    const { data, error } = await input.supabase.rpc(
      "search_discovery_owned_entities",
      {
        p_query: category,
        p_feature_slugs: [],
        p_lat: hasCoordinates ? Number(input.lat) : null,
        p_lng: hasCoordinates ? Number(input.lng) : null,
        p_radius_meters: hasCoordinates ? 30000 : 100000,
        p_city: cityRecord?.coverageLevel === "municipality" ? cityRecord.name : null,
        p_category: category,
        p_limit: Math.max(3, Math.ceil(input.limit / 2)),
        p_cursor_score: null,
        p_cursor_id: null,
      },
    );
    if (error) {
      console.warn("discover-feed place lane category skipped:", category, error.message);
      return [];
    }
    return data || [];
  }));
  return Array.from(new Map(
    batches.flat()
      .filter((item: any) => item.entity_type === "place")
      .map((item: any) => [item.id, item]),
  ).values())
    .map(normalizeEntityPlaceCard)
    .filter((card: FeedCard) => Boolean(card.imageUrl))
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, input.limit);
}

async function loadNewsLane(input: {
  supabase: ReturnType<typeof getSupabaseAdmin>;
  city: string;
  limit: number;
}) {
  const { data, error } = await input.supabase
    .from("news")
    .select("id,title,tag,image_url,city,published_at")
    .or(`city.eq.${input.city},city.eq.Global,city.eq.Ontario`)
    .order("published_at", { ascending: false })
    .limit(input.limit);

  if (error) {
    console.warn("discover-feed news lane skipped:", error.message);
    return [];
  }

  return (data || []).map(
    (item: any) =>
      ({
        id: cleanText(item.id || item.published_at || item.title),
        type: "news",
        title: cleanText(item.title, "GTA entertainment update"),
        subtitle: cleanText(item.tag || item.city || "Entertainment"),
        city: cleanText(item.city || "Greater Toronto Area"),
        imageUrl: cleanText(item.image_url) || undefined,
        statusLabel: item.published_at ? "Updated today" : "GTA news",
        actionLabel: "Read",
        source: "echoo-news",
        category: cleanText(item.tag || "news"),
      }) satisfies FeedCard,
  ).filter((card: FeedCard) => Boolean(card.imageUrl));
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
    const payload: FeedPayload = {
      city: cleanText(body.city ?? url.searchParams.get("city"), "GTA"),
      lat: optionalNumber(body.lat ?? url.searchParams.get("lat")),
      lng: optionalNumber(body.lng ?? url.searchParams.get("lng")),
      limit: optionalNumber(body.limit ?? url.searchParams.get("limit")),
      mode: cleanText(body.mode ?? url.searchParams.get("mode"), "ontario"),
    };

    const supabase = getSupabaseAdmin();
    const limit = Math.min(clampLimit(payload.limit), 12);
    const city = payload.city || "GTA";
    const hasGps = Number.isFinite(payload.lat) && Number.isFinite(payload.lng);
    const eventOnly = /^(tickets|events)$/i.test(payload.mode || "");

    const [events, places, news] = await Promise.all([
      loadEventLane({
        supabase,
        city,
        lat: payload.lat,
        lng: payload.lng,
        limit,
        mode: payload.mode,
      }),
      eventOnly
        ? Promise.resolve([] as FeedCard[])
        : loadPlaceLane({
            supabase,
            city,
            lat: payload.lat,
            lng: payload.lng,
            limit,
          }),
      eventOnly
        ? Promise.resolve([] as FeedCard[])
        : loadNewsLane({ supabase, city, limit: Math.min(limit, 6) }),
    ]);

    const lanes: FeedLane[] = [
      {
        id: "shows-tickets",
        title: hasGps ? `Shows near you` : "GTA shows",
        label: events.some((event) => event.statusLabel === "Tonight")
          ? "Tonight"
          : "Selling now",
        cards: events,
      },
      ...(!eventOnly ? [
        {
          id: "trending-places",
          title: hasGps ? `Places near you` : "Trending GTA places",
          label: hasGps ? "Near you" : "GTA pick",
          cards: places,
        },
        {
          id: "entertainment-news",
          title: "Entertainment news",
          label: news.length ? "Updated today" : "Coming soon",
          cards: news,
        },
      ] : []),
    ];

    await logLocationEvent(supabase, {
      functionName: "discover-feed",
      eventType: Date.now() - startedAt > 750 ? "slow_feed" : "feed",
      durationMs: Date.now() - startedAt,
      countryCode: "CA",
      adminArea1: "ON",
      city,
      request: {
        city,
        hasGps,
        mode: payload.mode,
        limit,
      },
      responseSummary: {
        lanes: lanes.length,
        cards: lanes.reduce((sum, lane) => sum + lane.cards.length, 0),
      },
    });

    return jsonResponse(
      envelope(
        {
          location: {
            mode: hasGps ? "gps" : "ontario",
            city,
            province: "Ontario",
            radiusMeters: hasGps ? 30000 : null,
          },
          generatedAt: new Date().toISOString(),
          lanes,
        },
        {
          durationMs: Date.now() - startedAt,
          phase: "phase4b-live-ontario-feed",
          source: "echoo-retrieval",
        },
      ),
    );
  } catch (err) {
    const message = errorMessage(err, "Unknown Discover feed error");
    return jsonResponse({ data: null, error: message, meta: {} }, 500);
  }
});
