import {
  CORS_HEADERS,
  getSupabaseAdmin,
  haversineMeters,
  jsonResponse,
  logLocationEvent,
} from "../_shared/location.ts";

type QuickPlanRequest = {
  anchor?: {
    id?: unknown;
    name?: unknown;
    category?: unknown;
    subcategory?: unknown;
    city?: unknown;
    address?: unknown;
    latitude?: unknown;
    longitude?: unknown;
    imageUrl?: unknown;
  };
  stopCount?: unknown;
  budgetStyle?: unknown;
  recentPlaceIds?: unknown;
  profile?: Record<string, unknown>;
};

type PlaceProfile = {
  place_id: string;
  vibe_tags?: string[] | null;
  good_for?: string[] | null;
  meal_tags?: string[] | null;
  activity_tags?: string[] | null;
  noise_level?: string | null;
  price_band?: string | null;
  lunch_score?: number | null;
  date_score?: number | null;
  group_score?: number | null;
  solo_score?: number | null;
  confidence_score?: number | null;
  human_review_status?: string | null;
};

type Place = {
  id: string;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
  city?: string | null;
  municipality?: string | null;
  address?: string | null;
  formatted_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  timezone?: string | null;
  image_url?: string | null;
  price_band?: string | null;
  confidence_score?: number | null;
};

type Hours = {
  place_id: string;
  day_of_week: number;
  opens_at?: string | null;
  closes_at?: string | null;
  is_closed?: boolean | null;
  confidence_score?: number | null;
};

type Candidate = Place & { profile?: PlaceProfile; distanceMeters: number };

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function text(value: unknown, fallback = "") {
  return String(value ?? fallback).replace(/\s+/g, " ").trim();
}

function isCanonicalPlaceId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function list(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => text(item).toLowerCase()).filter(Boolean)
    : [];
}

function number(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function authToken(req: Request) {
  return (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";
}

function clampStopCount(value: unknown) {
  return Number(value) === 2 ? 2 : 3;
}

function normalizeBudget(value: unknown) {
  const raw = text(value).toLowerCase();
  if (["value", "low", "$"].includes(raw)) return "value";
  if (["elevated", "premium", "classy", "$$$"].includes(raw)) return "elevated";
  return "balanced";
}

function budgetFromProfile(value: unknown) {
  const raw = text(value);
  if (raw === "$") return "value";
  if (raw === "$$$") return "elevated";
  return "balanced";
}

function priceTier(priceBand: unknown) {
  const raw = text(priceBand).toLowerCase();
  if (!raw) return "unknown";
  if (/free|inexpensive|low|budget|price_level_inexpensive/.test(raw) || raw === "$") return "value";
  if (raw.includes("$$$") || /very_expensive|expensive|premium|upscale|elevated|high/.test(raw)) return "elevated";
  if (raw.includes("$$") || /moderate|mid|balanced|price_level_moderate/.test(raw)) return "balanced";
  return "unknown";
}

function priceFit(priceBand: unknown, planBudget: string) {
  const price = priceTier(priceBand);
  if (price === "unknown") return 0.42;
  if (price === planBudget) return 1;
  if (planBudget === "balanced") return 0.46;
  if (planBudget === "value") return price === "balanced" ? 0.22 : 0.03;
  return price === "balanced" ? 0.40 : 0.04;
}

function priceLabel(place: Candidate) {
  const tier = priceTier(place.profile?.price_band || place.price_band);
  if (tier === "value") return "Value pick";
  if (tier === "balanced") return "Mid-range";
  if (tier === "elevated") return "Elevated pick";
  return "Price not listed";
}

function isBudgetMatch(place: Candidate, planBudget: string) {
  return priceTier(place.profile?.price_band || place.price_band) === planBudget;
}

function recentIds(value: unknown) {
  return new Set(
    list(value).filter((id) => id.length <= 180).slice(0, 30),
  );
}

function profileTags(profile?: PlaceProfile) {
  return [
    ...list(profile?.vibe_tags),
    ...list(profile?.good_for),
    ...list(profile?.meal_tags),
    ...list(profile?.activity_tags),
    text(profile?.noise_level).toLowerCase(),
  ].filter(Boolean);
}

function userTerms(profile: Record<string, unknown>) {
  return [
    ...list(profile.interests),
    ...list(profile.eventStyles),
    ...list(profile.event_styles),
    ...list(profile.audiences),
    ...list(profile.motivations),
  ]
    .flatMap((term) => term.split(/[^a-z0-9]+/i))
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 2);
}

function personalizationFit(candidate: Candidate, profile: Record<string, unknown>) {
  const tags = profileTags(candidate.profile);
  const terms = userTerms(profile);
  const matches = terms.filter((term) => tags.some((tag) => tag.includes(term) || term.includes(tag))).length;
  let score = terms.length ? Math.min(1, matches / Math.min(terms.length, 3)) : 0.58;
  const energy = text(profile.energy).toLowerCase();
  if (energy === "chill" && tags.some((tag) => /quiet|cozy|calm|relaxed|low.key/.test(tag))) score += 0.2;
  if (energy === "hype" && tags.some((tag) => /lively|social|nightlife|active|music/.test(tag))) score += 0.2;
  if (energy === "curious" && tags.some((tag) => /art|culture|museum|gallery|independent|explor/.test(tag))) score += 0.2;
  return Math.min(1, score);
}

function categoryFamily(place: Candidate) {
  const raw = `${text(place.category)} ${text(place.subcategory)}`.toLowerCase();
  if (/restaurant|cafe|bakery|food|bar|pub|dessert/.test(raw)) return "food";
  if (/museum|gallery|arts|culture|tourism|library|attraction|historic|heritage/.test(raw)) return "culture";
  if (/park|trail|nature|garden|beach/.test(raw)) return "outdoors";
  if (/shop|mall|market/.test(raw)) return "browse";
  return raw || "place";
}

function categoryComplement(anchor: Candidate, candidate: Candidate) {
  const anchorFamily = categoryFamily(anchor);
  const candidateFamily = categoryFamily(candidate);
  if (anchorFamily !== candidateFamily) return 1;
  if (anchorFamily === "food") return 0.28;
  return 0.48;
}

function localClock(timezone: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    day: WEEKDAY_INDEX[values.weekday] ?? at.getDay(),
    minute: Number(values.hour || 0) * 60 + Number(values.minute || 0),
  };
}

function minuteOfDay(value: string | null | undefined) {
  const found = text(value).match(/^(\d{1,2}):(\d{2})/);
  return found ? Number(found[1]) * 60 + Number(found[2]) : null;
}

function openAt(hours: Hours[], timezone: string, at: Date) {
  if (!hours.length) return { known: false, open: true };
  const clock = localClock(timezone, at);
  const row = hours.find((item) => Number(item.day_of_week) === clock.day);
  if (!row) return { known: false, open: true };
  if (row.is_closed) return { known: true, open: false };
  const opens = minuteOfDay(row.opens_at);
  const closes = minuteOfDay(row.closes_at);
  if (opens === null || closes === null) return { known: false, open: true };
  const open = closes > opens
    ? clock.minute >= opens && clock.minute < closes
    : clock.minute >= opens || clock.minute < closes;
  return { known: true, open };
}

function timeLabel(timezone: string, offsetMinutes: number) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(Date.now() + offsetMinutes * 60_000));
}

function travelMinutes(from: Candidate, to: Candidate) {
  const meters = haversineMeters(
    number(from.latitude),
    number(from.longitude),
    number(to.latitude),
    number(to.longitude),
  );
  // A conservative mixed walk/short-ride estimate. Route previews can later
  // refine this, but ranking never depends on a paid maps call.
  return Math.max(6, Math.min(28, Math.round(5 + meters / 1000 * 3.3)));
}

function requestAnchor(anchor: QuickPlanRequest["anchor"]): Place | null {
  const latitude = number(anchor?.latitude, NaN);
  const longitude = number(anchor?.longitude, NaN);
  const name = text(anchor?.name);
  if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    id: text(anchor?.id, `live:${latitude.toFixed(5)},${longitude.toFixed(5)}`),
    name,
    category: text(anchor?.category),
    subcategory: text(anchor?.subcategory),
    city: text(anchor?.city),
    municipality: text(anchor?.city),
    address: text(anchor?.address),
    latitude,
    longitude,
    timezone: "America/Toronto",
    image_url: text(anchor?.imageUrl),
  };
}

function hasCoverImage(place: Place) {
  return /^https?:\/\//i.test(text(place.image_url));
}

function liveSearchTypes(anchor: Place) {
  const family = categoryFamily({ ...anchor, distanceMeters: 0 });
  if (family === "food") return ["park", "tourist_attraction", "cafe"];
  if (family === "outdoors") return ["cafe", "restaurant", "tourist_attraction"];
  if (family === "culture") return ["cafe", "restaurant", "park"];
  return ["restaurant", "cafe", "tourist_attraction"];
}

async function liveNearbyCandidates(anchor: Place, limit: number): Promise<Candidate[]> {
  const key = Deno.env.get("GOOGLE_PLACES_API_KEY") || Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key) return [];
  const city = text(anchor.municipality || anchor.city, "nearby");
  const groups = await Promise.all(liveSearchTypes(anchor).map(async (includedType) => {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.types,places.priceLevel",
      },
      body: JSON.stringify({
        // Coordinates are the authority here. A live search card can carry a
        // broad display city even when its real pin is elsewhere.
        textQuery: includedType.replace(/_/g, " "),
        includedType,
        strictTypeFiltering: true,
        pageSize: Math.min(Math.max(limit, 3), 8),
        languageCode: "en",
        regionCode: "CA",
        rankPreference: "DISTANCE",
        locationBias: { circle: { center: { latitude: Number(anchor.latitude), longitude: Number(anchor.longitude) }, radius: 12_000 } },
      }),
    });
    if (!response.ok) return [] as Candidate[];
    const payload = await response.json();
    return (payload.places || []).map((place: any): Candidate | null => {
      const latitude = number(place.location?.latitude, NaN);
      const longitude = number(place.location?.longitude, NaN);
      if (!place.id || !Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
      const distanceMeters = haversineMeters(Number(anchor.latitude), Number(anchor.longitude), latitude, longitude);
      if (!Number.isFinite(distanceMeters) || distanceMeters > 14_000 || distanceMeters < 30) return null;
      return {
        id: `google:${text(place.id)}`,
        name: text(place.displayName?.text, "A nearby stop"),
        category: text(place.types?.[0], includedType).replace(/_/g, " "),
        city,
        municipality: city,
        address: text(place.formattedAddress),
        latitude,
        longitude,
        timezone: text(anchor.timezone, "America/Toronto"),
        price_band: text(place.priceLevel),
        distanceMeters,
      };
    }).filter(Boolean) as Candidate[];
  }));
  return Array.from(new Map(groups.flat().map((place) => [place.id, place])).values())
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .slice(0, Math.max(limit * 2, 8));
}

function reasonFor(place: Candidate, index: number, anchor: Candidate) {
  if (place.id === anchor.id) return "Your anchor";
  const family = categoryFamily(place);
  if (family === "food") return index === 1 ? "An easy next bite" : "A good place to land";
  if (family === "culture") return "Adds a real activity";
  if (family === "outdoors") return "Keeps the plan feeling light";
  if (family === "browse") return "A low-pressure browse";
  return "Matched to your plan";
}

async function profileForMember(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
) {
  const { data } = await supabase
    .from("user_onboarding_profiles")
    .select("interests,event_styles,audiences,motivations,budget,energy,home_city,completed_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (!data?.completed_at) return null;
  return {
    interests: data.interests || [],
    eventStyles: data.event_styles || [],
    audiences: data.audiences || [],
    motivations: data.motivations || [],
    budget: data.budget || "$",
    energy: data.energy || "chill",
    city: data.home_city || "Greater Toronto Area",
  };
}

function profileForGuest(value: Record<string, unknown> | undefined, city = "Greater Toronto Area") {
  const profile = value && typeof value === "object" ? value : {};
  const budget = text(profile.budget, "$");
  const energy = text(profile.energy, "chill");
  return {
    interests: list(profile.interests),
    eventStyles: list(profile.eventStyles || profile.event_styles),
    audiences: list(profile.audiences),
    motivations: list(profile.motivations),
    budget: ["$", "$$", "$$$"].includes(budget) ? budget : "$",
    energy: ["chill", "hype", "curious"].includes(energy) ? energy : "chill",
    city: text(profile.city, city),
  };
}

async function loadProfiles(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  placeIds: string[],
) {
  if (!placeIds.length) return new Map<string, PlaceProfile>();
  const { data, error } = await supabase
    .from("place_profiles")
    .select("place_id,vibe_tags,good_for,meal_tags,activity_tags,noise_level,price_band,lunch_score,date_score,group_score,solo_score,confidence_score,human_review_status")
    .in("place_id", placeIds);
  if (error) throw error;
  return new Map((data || []).map((row) => [row.place_id, row as PlaceProfile]));
}

async function loadHours(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  placeIds: string[],
) {
  if (!placeIds.length) return new Map<string, Hours[]>();
  const { data, error } = await supabase
    .from("place_hours")
    .select("place_id,day_of_week,opens_at,closes_at,is_closed,confidence_score")
    .in("place_id", placeIds);
  if (error) throw error;
  const byPlace = new Map<string, Hours[]>();
  for (const row of (data || []) as Hours[]) {
    byPlace.set(row.place_id, [...(byPlace.get(row.place_id) || []), row]);
  }
  return byPlace;
}

async function loadApprovedCoverImages(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  placeIds: string[],
) {
  if (!placeIds.length) return new Map<string, string>();
  const { data, error } = await supabase
    .from("place_photos")
    .select("place_id,image_url,sort_order,created_at")
    .in("place_id", placeIds)
    .eq("approval_status", "approved")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw error;
  const covers = new Map<string, string>();
  for (const row of data || []) {
    const placeId = text(row.place_id);
    const imageUrl = text(row.image_url);
    if (placeId && !covers.has(placeId) && /^https?:\/\//i.test(imageUrl)) covers.set(placeId, imageUrl);
  }
  return covers;
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = (await req.json().catch(() => ({}))) as QuickPlanRequest;
    const anchorId = text(body.anchor?.id);
    if (!anchorId) return jsonResponse({ error: "Choose a place to build around" }, 422);

    const supabase = getSupabaseAdmin();
    // A Quick Plan is an on-the-spot utility, so guests can use their local
    // preference cache. A completed member profile still takes precedence.
    const requestCity = text(body.anchor?.city, "Greater Toronto Area");
    let profile = profileForGuest(body.profile, requestCity);
    const token = authToken(req);
    if (token) {
      const { data: auth } = await supabase.auth.getUser(token);
      if (auth?.user) {
        const memberProfile = await profileForMember(supabase, auth.user.id);
        if (memberProfile) profile = memberProfile;
      }
    }
    const requestedBudget = normalizeBudget(body.budgetStyle || budgetFromProfile(profile.budget));
    const stopCount = clampStopCount(body.stopCount);

    const { data: anchorRow, error: anchorError } = isCanonicalPlaceId(anchorId)
      ? await supabase
        .from("canonical_places")
        .select("*")
        .eq("id", anchorId)
        .maybeSingle()
      : { data: null, error: null };
    if (anchorError) throw anchorError;
    // A place discovered live from Google has not necessarily been saved to
    // canonical_places. Its tapped coordinates are still valid for a plan.
    const requestPlace = requestAnchor(body.anchor);
    let anchor = (anchorRow as Place | null) || requestPlace;
    if (!anchor) return jsonResponse({ error: "This place needs a name and precise location before Echoo can plan around it" }, 422);
    // An Explore card can already have a verified cover while the canonical
    // record awaits photo enrichment. Preserve it for the plan's anchor.
    if (!hasCoverImage(anchor) && requestPlace?.image_url) anchor.image_url = requestPlace.image_url;
    if (!Number.isFinite(number(anchor.latitude, NaN)) || !Number.isFinite(number(anchor.longitude, NaN))) {
      return jsonResponse({ error: "This place needs a precise location before Echoo can route around it" }, 422);
    }

    const city = text(anchor.municipality || anchor.city || profile.city || "Ontario");
    const { data: nearbyRows, error: nearbyError } = anchorRow
      ? await supabase.rpc("search_ontario_places", {
        p_query: null,
        p_city: city,
        p_lat: Number(anchor.latitude),
        p_lng: Number(anchor.longitude),
        p_radius_meters: 14000,
        p_category: null,
        p_limit: 80,
      })
      : { data: [], error: null };
    if (nearbyError) throw nearbyError;
    const nearbyIds = Array.from(new Set((nearbyRows || []).map((row: any) => text(row.id)).filter(Boolean)));

    const { data: fullRows, error: fullError } = nearbyIds.length
      ? await supabase.from("canonical_places").select("*").in("id", nearbyIds)
      : { data: [], error: null };
    if (fullError) throw fullError;

    // Profile and hours tables use UUID foreign keys. Live Google IDs are not
    // persisted there yet, so never send them into a UUID `in (...)` filter.
    const placeIds = [
      ...(anchorRow ? [anchor.id] : []),
      ...((fullRows || []) as Place[]).map((place) => place.id),
    ];
    const [profiles, hoursByPlace, coverImages] = await Promise.all([
      loadProfiles(supabase, placeIds),
      loadHours(supabase, placeIds),
      loadApprovedCoverImages(supabase, placeIds),
    ]);
    anchor = { ...anchor, image_url: coverImages.get(anchor.id) || anchor.image_url };
    const places = new Map<string, Place>([
      [anchor.id, anchor],
      ...((fullRows || []) as Place[]).map((place) => [
        place.id,
        { ...place, image_url: coverImages.get(place.id) || place.image_url },
      ]),
    ]);
    const timezone = text(anchor.timezone, "America/Toronto");
    const anchorCandidate: Candidate = {
      ...anchor,
      profile: profiles.get(anchor.id),
      distanceMeters: 0,
    };
    const anchorHours = hoursByPlace.get(anchor.id) || [];
    const anchorAvailability = openAt(anchorHours, timezone, new Date());

    const inventoryCandidates: Candidate[] = [...places.values()]
      .filter((place) => place.id !== anchor.id)
      // Quick Plan never falls back to generic live-search results. Every
      // additional stop is from Echoo's persisted local inventory; the UI
      // supplies the same polished cover treatment when photo enrichment is
      // still pending for an otherwise curated place.
      .map((place) => ({
        ...place,
        profile: profiles.get(place.id),
        distanceMeters: haversineMeters(
          Number(anchor.latitude),
          Number(anchor.longitude),
          Number(place.latitude),
          Number(place.longitude),
        ),
      }))
      .filter((place) => Number.isFinite(place.distanceMeters) && place.distanceMeters <= 14000)
      .filter((place) => {
        const status = openAt(hoursByPlace.get(place.id) || [], timezone, new Date());
        return !status.known || status.open;
      });
    const candidates = inventoryCandidates;
    const recentPlaceIds = recentIds(body.recentPlaceIds);

    const score = (candidate: Candidate) => {
      const distance = Math.max(0, 1 - candidate.distanceMeters / 14000);
      const profileConfidence = number(candidate.profile?.confidence_score, number(candidate.confidence_score, 0.46));
      return (
        priceFit(candidate.profile?.price_band || candidate.price_band, requestedBudget) * 0.44 +
        personalizationFit(candidate, profile) * 0.22 +
        categoryComplement(anchorCandidate, candidate) * 0.16 +
        distance * 0.10 +
        profileConfidence * 0.08
      );
    };

    const selected: Candidate[] = [anchorCandidate];
    const requiredNearbyStops = stopCount - 1;
    const freshCandidates = candidates.filter((candidate) => !recentPlaceIds.has(candidate.id));
    const rotationPool = freshCandidates.length >= requiredNearbyStops ? freshCandidates : candidates;
    const exactBudgetMatches = rotationPool.filter((candidate) => isBudgetMatch(candidate, requestedBudget));
    // When the area has enough priced inventory, make the spend choice a hard
    // rail. If it does not, gracefully widen the pool rather than inventing a
    // price or returning an empty plan.
    const budgetPool = exactBudgetMatches.length >= requiredNearbyStops
      ? exactBudgetMatches
      : rotationPool;
    const sorted = [...budgetPool].sort((a, b) => score(b) - score(a));
    for (const candidate of sorted) {
      if (selected.length >= stopCount) break;
      const duplicateFamily = selected.some((picked) => categoryFamily(picked) === categoryFamily(candidate));
      if (duplicateFamily && sorted.some((alternative) => !selected.some((picked) => picked.id === alternative.id) && categoryFamily(alternative) !== categoryFamily(candidate))) continue;
      selected.push(candidate);
    }
    for (const candidate of sorted) {
      if (selected.length >= stopCount) break;
      if (!selected.some((picked) => picked.id === candidate.id)) selected.push(candidate);
    }

    let elapsed = 0;
    let totalTravel = 0;
    const stops = selected.map((place, index) => {
      if (index > 0) {
        const minutes = travelMinutes(selected[index - 1], place);
        elapsed += minutes;
        totalTravel += minutes;
      }
      const availability = openAt(hoursByPlace.get(place.id) || [], timezone, new Date(Date.now() + elapsed * 60_000));
      const stop = {
        id: place.id,
        name: text(place.name, "A nearby stop"),
        category: text(place.subcategory || place.category, "Place"),
        address: text(place.address || place.formatted_address),
        latitude: Number(place.latitude),
        longitude: Number(place.longitude),
        imageUrl: text(place.image_url),
        time: timeLabel(timezone, elapsed),
        travelMinutes: index === 0 ? 0 : travelMinutes(selected[index - 1], place),
        reason: reasonFor(place, index, anchorCandidate),
        priceLabel: priceLabel(place),
        availability: availability.known ? (availability.open ? "open" : "check_hours") : "unverified",
        isAnchor: place.id === anchor.id,
      };
      elapsed += index === 0 ? 65 : 75;
      return stop;
    });

    const availabilityNote = selected.length < 2
      ? `Start at ${text(anchor.name, "this place")}. Nearby matches are temporarily unavailable, so Echoo kept your route focused instead of guessing.`
      : selected.length < stopCount
      ? `Echoo found ${selected.length} nearby places it can stand behind right now, so it kept this plan tight.`
      : anchorAvailability.known && !anchorAvailability.open
        ? `${text(anchor.name, "Your anchor")} is not marked open right now—check its hours before heading out.`
        : stops.some((stop) => stop.availability === "unverified")
          ? "Echoo matched this on place, profile, and distance data; check hours before you leave."
        : stops.some((stop) => stop.availability === "check_hours")
          ? "One stop may change hours before your arrival—check it before leaving."
          : "Built from Echoo’s live place, profile, distance, and hours data.";
    const plan = {
      title: `${stops.length}-stop ${requestedBudget} plan`,
      subtitle: `Built around ${text(anchor.name, "your place")}`,
      stopCount: stops.length,
      requestedStopCount: stopCount,
      budgetStyle: requestedBudget,
      anchorId: anchor.id,
      anchorName: text(anchor.name, "your place"),
      totalTravelMinutes: totalTravel,
      availabilityNote,
      stops,
    };

    await logLocationEvent(supabase, {
      functionName: "quick-plan",
      eventType: Date.now() - startedAt > 750 ? "slow_native_plan" : "native_plan",
      durationMs: Date.now() - startedAt,
      countryCode: "CA",
      adminArea1: "ON",
      city,
      request: { anchorId, stopCount, budgetStyle: requestedBudget },
      responseSummary: {
        returnedStops: stops.length,
        candidateCount: candidates.length,
        totalTravelMinutes: totalTravel,
        anchorOpen: anchorAvailability.known ? anchorAvailability.open : null,
      },
    });

    return jsonResponse({ supported: true, provider: "echoo-native-planner", plan });
  } catch (error) {
    console.error("quick-plan failed", error);
    return jsonResponse({ error: "Quick Plan could not build a reliable route right now" }, 500);
  }
});
