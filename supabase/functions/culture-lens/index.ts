import {
  CORS_HEADERS,
  clampLimit,
  getSupabaseAdmin,
  jsonResponse,
  normalizeCityName,
  readLocationCache,
  sha256Hex,
  writeLocationCache,
} from "../_shared/location.ts";

type CultureRequest = {
  cultureSlug?: unknown;
  city?: unknown;
  lat?: unknown;
  lng?: unknown;
  topics?: unknown;
};

type CultureRow = {
  slug: string;
  label: string;
  search_terms: string[] | null;
};

type CultureItem = {
  id: string;
  source: "echoo" | "google_places" | "ticketmaster";
  title: string;
  category: string;
  description: string;
  city: string;
  imageUrl?: string;
  imageAlt?: string;
  actionUrl?: string;
  startsAt?: string;
  venueName?: string;
  latitude?: number;
  longitude?: number;
  cultureSlug: string;
  isOwned: boolean;
  attribution?: string;
};

const TOPICS = ["food", "music", "events", "businesses"] as const;
type Topic = (typeof TOPICS)[number];

function clean(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function optionalNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function cityFrom(value: unknown) {
  const raw = typeof value === "object" && value
    ? (value as Record<string, unknown>).city || (value as Record<string, unknown>).name
    : value;
  return clean(raw, "Greater Toronto Area");
}

function topicsFrom(value: unknown): Topic[] {
  if (!Array.isArray(value)) return [...TOPICS];
  const selected = [
    ...new Set(value.map((item) => clean(item).toLowerCase()).filter((item): item is Topic => TOPICS.includes(item as Topic))),
  ];
  return selected.length ? selected : [...TOPICS];
}

function freshDate(value: unknown) {
  const date = clean(value);
  if (!date) return undefined;
  const time = new Date(date).getTime();
  return Number.isFinite(time) && time >= Date.now() - 3 * 60 * 60 * 1000
    ? date
    : undefined;
}

function topicQuery(culture: CultureRow, topic: Topic) {
  const terms = [culture.label, ...(culture.search_terms || [])]
    .map((term) => clean(term))
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");
  const suffix: Record<Topic, string> = {
    food: "restaurants bakeries cafes markets",
    music: "live music record stores music venues",
    events: "cultural events festivals community events",
    businesses: "shops bookstores groceries small businesses",
  };
  return `${terms} ${suffix[topic]}`;
}

function classifyPlaceTopic(item: CultureItem) {
  const text = `${item.title} ${item.category} ${item.description}`.toLowerCase();
  if (/restaurant|cafe|bakery|meal|food|grocery|market|bar/.test(text)) return "food";
  if (/music|record|concert|nightclub|dj/.test(text)) return "music";
  if (/event|festival|museum|community|theatre|theater|art/.test(text)) return "events";
  return "businesses";
}

function unique(items: CultureItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.source}:${item.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function toBase64Url(value: string) {
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
  const name = clean(photoName, "");
  const secret = clean(Deno.env.get("PLACE_MEDIA_SIGNING_SECRET"));
  if (!secret || !/^places\/[^/]+\/photos\/[^/]+$/.test(name)) return undefined;
  const token = toBase64Url(JSON.stringify({ photoName: name, expiresAt: Date.now() + 6 * 60_000 }));
  const signature = await sign(token, secret);
  const url = new URL(req.url);
  return `${url.origin}/functions/v1/place-photo?token=${encodeURIComponent(token)}&signature=${signature}`;
}

async function livePlaces(input: {
  req: Request;
  culture: CultureRow;
  city: string;
  lat?: number;
  lng?: number;
  topic: Topic;
}) {
  const key = clean(Deno.env.get("GOOGLE_PLACES_API_KEY") || Deno.env.get("GOOGLE_MAPS_API_KEY"));
  if (!key) return [] as CultureItem[];

  const body: Record<string, unknown> = {
    textQuery: `${topicQuery(input.culture, input.topic)} in ${input.city}, Ontario`,
    pageSize: 8,
    languageCode: "en",
    regionCode: "CA",
  };
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    body.locationBias = {
      circle: {
        center: { latitude: input.lat, longitude: input.lng },
        radius: 30000,
      },
    };
  }

  try {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.googleMapsUri,places.photos",
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      console.warn("Culture Lens Google Places query failed", response.status);
      return [] as CultureItem[];
    }
    const payload = await response.json();
    return await Promise.all((payload?.places || []).slice(0, 8).map(async (place: any) => {
      const photo = place?.photos?.[0]?.name;
      return {
        id: clean(place.id || place.googleMapsUri || place.displayName?.text),
        source: "google_places" as const,
        title: clean(place.displayName?.text, "Local place"),
        category: clean(place.types?.[0], "place").replaceAll("_", " "),
        description: clean(place.formattedAddress),
        city: input.city,
        imageUrl: await signedPhotoUrl(input.req, photo),
        imageAlt: clean(place.displayName?.text),
        actionUrl: clean(place.googleMapsUri),
        latitude: optionalNumber(place.location?.latitude),
        longitude: optionalNumber(place.location?.longitude),
        cultureSlug: input.culture.slug,
        isOwned: false,
        attribution: "Google Maps",
      } satisfies CultureItem;
    }));
  } catch (error) {
    console.warn("Culture Lens Google Places unavailable", error);
    return [] as CultureItem[];
  }
}

async function liveEvents(input: {
  culture: CultureRow;
  city: string;
  lat?: number;
  lng?: number;
}) {
  const key = clean(Deno.env.get("TICKETMASTER_API_KEY"));
  if (!key) return [] as CultureItem[];
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.searchParams.set("apikey", key);
  url.searchParams.set("size", "8");
  url.searchParams.set("countryCode", "CA");
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("keyword", `${input.culture.label} culture`);
  url.searchParams.set("startDateTime", new Date().toISOString().replace(/\.\d{3}Z$/, "Z"));
  const end = new Date();
  end.setDate(end.getDate() + 45);
  url.searchParams.set("endDateTime", end.toISOString().replace(/\.\d{3}Z$/, "Z"));
  if (Number.isFinite(input.lat) && Number.isFinite(input.lng)) {
    url.searchParams.set("latlong", `${input.lat},${input.lng}`);
    url.searchParams.set("radius", "40");
    url.searchParams.set("unit", "km");
  } else {
    // Ticketmaster understands municipal names but not the GTA umbrella.
    url.searchParams.set("city", /greater toronto area|gta/i.test(input.city) ? "Toronto" : input.city);
  }

  try {
    const response = await fetch(url);
    if (!response.ok) return [] as CultureItem[];
    const payload = await response.json();
    return (payload?._embedded?.events || []).map((event: any) => {
      const venue = event?._embedded?.venues?.[0] || {};
      const image = event?.images?.find((item: any) => item.ratio === "16_9") || event?.images?.[0];
      return {
        id: clean(event.id || event.url || event.name),
        source: "ticketmaster" as const,
        title: clean(event.name, "Upcoming event"),
        category: clean(event?.classifications?.[0]?.genre?.name || "event"),
        description: clean(event.info || event.pleaseNote || venue.name),
        city: clean(venue?.city?.name, input.city),
        imageUrl: clean(image?.url),
        imageAlt: clean(event.name),
        actionUrl: clean(event.url),
        startsAt: freshDate(event?.dates?.start?.dateTime || event?.dates?.start?.localDate),
        venueName: clean(venue.name),
        latitude: optionalNumber(venue?.location?.latitude),
        longitude: optionalNumber(venue?.location?.longitude),
        cultureSlug: input.culture.slug,
        isOwned: false,
        attribution: "Ticketmaster",
      } satisfies CultureItem;
    }).filter((item: CultureItem) => Boolean(item.startsAt));
  } catch (error) {
    console.warn("Culture Lens Ticketmaster unavailable", error);
    return [] as CultureItem[];
  }
}

function ownedItems(items: any[], culture: CultureRow): CultureItem[] {
  return items.map((item) => ({
    id: clean(item.id),
    source: "echoo" as const,
    title: clean(item.title, "Echoo pick"),
    category: clean(item.category, "place"),
    description: clean(item.description),
    city: clean(item.city, "Greater Toronto Area"),
    imageUrl: clean(item.image_url),
    imageAlt: clean(item.title),
    startsAt: freshDate(item.starts_at),
    latitude: optionalNumber(item.latitude),
    longitude: optionalNumber(item.longitude),
    cultureSlug: culture.slug,
    isOwned: true,
  }));
}

function sectionsFor(input: { owned: CultureItem[]; live: CultureItem[]; topics: Topic[] }) {
  const all = unique([...input.owned, ...input.live]);
  return input.topics.map((topic) => {
    const owned = input.owned.filter((item) => {
      const classification = classifyPlaceTopic(item);
      return topic === "events" ? Boolean(item.startsAt) || classification === topic : classification === topic;
    });
    const live = input.live.filter((item) => {
      const classification = item.source === "ticketmaster" ? "events" : classifyPlaceTopic(item);
      return classification === topic;
    });
    const items = unique([...owned, ...live]).slice(0, 8);
    return { topic, items, sourceCount: { owned: owned.length, live: live.length } };
  }).filter((section) => section.items.length);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({})) as CultureRequest;
    const cultureSlug = clean(body.cultureSlug).toLowerCase();
    if (!/^[a-z0-9]+(?:_[a-z0-9]+)*$/.test(cultureSlug)) {
      return jsonResponse({ error: "Choose a valid Culture Lens first.", code: "culture_required" }, 422);
    }

    const requestedCity = cityFrom(body.city);
    const normalized = normalizeCityName(requestedCity);
    const city = normalized?.coverageLevel === "province" ? "Greater Toronto Area" : normalized?.name || requestedCity;
    const lat = optionalNumber(body.lat);
    const lng = optionalNumber(body.lng);
    if ((lat === undefined) !== (lng === undefined)) {
      return jsonResponse({ error: "lat and lng must be provided together" }, 422);
    }
    const topics = topicsFrom(body.topics);
    const supabase = getSupabaseAdmin();
    const { data: culture, error: cultureError } = await supabase
      .from("culture_catalog")
      .select("slug,label,search_terms")
      .eq("slug", cultureSlug)
      .eq("is_active", true)
      .maybeSingle();
    if (cultureError) throw cultureError;
    if (!culture) return jsonResponse({ error: "This Culture Lens is not available.", code: "culture_unavailable" }, 404);

    const cacheKey = await sha256Hex(JSON.stringify({
      v: 1,
      culture: cultureSlug,
      city: city.toLowerCase(),
      lat: lat?.toFixed(3) || null,
      lng: lng?.toFixed(3) || null,
      topics,
    }));
    const cached = await readLocationCache(supabase, cacheKey);
    if (cached) return jsonResponse({ ...cached, cacheHit: true });

    const cityForOwned = /greater toronto area|gta/i.test(city) ? null : city;
    const [ownedResult, ...providerResults] = await Promise.all([
      supabase.rpc("culture_lens_owned_discovery", {
        p_culture_slugs: [cultureSlug],
        p_city: cityForOwned,
        p_limit: clampLimit(28),
      }),
      ...topics.map((topic) => livePlaces({
        req,
        culture: culture as CultureRow,
        city,
        lat,
        lng,
        topic,
      })),
      topics.includes("events")
        ? liveEvents({ culture: culture as CultureRow, city, lat, lng })
        : Promise.resolve([] as CultureItem[]),
    ]);
    if (ownedResult.error) throw ownedResult.error;
    const owned = ownedItems(ownedResult.data || [], culture as CultureRow);
    const live = providerResults.flat() as CultureItem[];
    const sections = sectionsFor({ owned, live, topics });
    const response = {
      supported: true,
      mode: "culture_lens",
      city,
      culture: { slug: cultureSlug, label: clean(culture.label) },
      sections,
      freshness: { cachedForSeconds: 240, generatedAt: new Date().toISOString() },
      coverage: {
        owned: owned.length,
        live: live.length,
        hasReviewedLocalMatches: owned.length > 0,
      },
    };
    await writeLocationCache(supabase, cacheKey, response, 240);
    return jsonResponse(response);
  } catch (error) {
    console.error("Culture Lens request failed", error);
    return jsonResponse({ error: "Culture Lens is temporarily unavailable.", code: "culture_discovery_failed" }, 500);
  }
});
