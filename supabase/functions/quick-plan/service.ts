import { planningSearchFilter } from "../_shared/planning-intent.ts";
import { loadRouteMatrix } from "../_shared/route-matrix.ts";
import {
  persistPlanningResult,
  type PlanningMemory,
  readPlanningMemory,
} from "../_shared/planning-memory.ts";
import type { PlanConstraints } from "./planner.ts";
import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
  logLocationEvent,
} from "../_shared/location.ts";
import {
  budgetFromProfile,
  buildPlan,
  clampStopCount,
  haversineMeters,
  isCanonicalPlaceId,
  list,
  normalizeBudget,
  number,
  openAt,
  type PlannerCandidate,
  PlannerError,
  type PlannerHours,
  type PlannerPlace,
  type PlannerPlaceProfile,
  recentIds,
  selectStops,
  text,
} from "./planner.ts";

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
  rotationKey?: unknown;
  now?: unknown;
  profile?: Record<string, unknown>;
  mood?: unknown;
  anchorPosition?: unknown;
};

type Hours = PlannerHours;

async function profileForMember(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
) {
  const { data } = await supabase
    .from("user_onboarding_profiles")
    .select(
      "interests,event_styles,audiences,motivations,budget,energy,home_city,completed_at",
    )
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

function profileForGuest(
  value: Record<string, unknown> | undefined,
  city = "Greater Toronto Area",
) {
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
  if (!placeIds.length) return new Map<string, PlannerPlaceProfile>();
  const { data, error } = await supabase
    .from("place_profiles")
    .select(
      "place_id,vibe_tags,good_for,meal_tags,activity_tags,noise_level,price_band,lunch_score,date_score,group_score,solo_score,confidence_score,human_review_status",
    )
    .in("place_id", placeIds);
  if (error) throw error;
  return new Map(
    (data || []).map((row) => [row.place_id, row as PlannerPlaceProfile]),
  );
}

async function loadHours(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  placeIds: string[],
) {
  if (!placeIds.length) return new Map<string, Hours[]>();
  const { data, error } = await supabase
    .from("place_hours")
    .select(
      "place_id,day_of_week,opens_at,closes_at,is_closed,confidence_score,valid_from,valid_to,updated_at",
    )
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
    if (placeId && !covers.has(placeId) && /^https?:\/\//i.test(imageUrl)) {
      covers.set(placeId, imageUrl);
    }
  }
  return covers;
}

// Trust the caller's device clock only when it agrees with the server within
// a small drift window; anything else falls back to server time so hours
// checks never key off a badly-set device.
function requestNow(value: unknown) {
  const parsed = new Date(text(value));
  if (Number.isNaN(parsed.getTime())) return new Date();
  const drift = Math.abs(parsed.getTime() - Date.now());
  return drift <= 15 * 60_000 ? parsed : new Date();
}

// Live Discover cards carry Google place ids. Resolve them server-side so the
// anchor is a real, operational Ontario venue — never client-asserted data.
// The resolved id keeps its `google:` prefix so client caching, regeneration
// history, and normalization stay stable across requests.
async function resolveLiveAnchor(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  googlePlaceId: string,
): Promise<PlannerPlace | null> {
  const env = typeof Deno !== "undefined" ? Deno.env : undefined;
  const apiKey = env?.get("GOOGLE_PLACES_API_KEY") ||
    env?.get("GOOGLE_MAPS_API_KEY") || null;
  if (!apiKey || !googlePlaceId) return null;
  let payload: Record<string, any> | null = null;
  try {
    const response = await fetch(
      `https://places.googleapis.com/v1/places/${
        encodeURIComponent(googlePlaceId)
      }`,
      {
        headers: {
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask":
            "id,displayName,location,formattedAddress,addressComponents,primaryType,businessStatus",
        },
        signal: AbortSignal.timeout(4_000),
      },
    );
    if (!response.ok) return null;
    payload = await response.json();
  } catch {
    return null;
  }
  return importLivePlanningPlace(supabase, payload);
}

// Accept only a provider response obtained by trusted server code. Never pass
// request-body venue data here. Reused by companion live search without making
// a second Places details request for every candidate.
export async function importLivePlanningPlace(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  payload: Record<string, any> | null,
): Promise<PlannerPlace | null> {
  const components: Array<Record<string, any>> =
    Array.isArray(payload?.addressComponents) ? payload.addressComponents : [];
  const componentText = (type: string) =>
    text(
      components.find((component) =>
        Array.isArray(component?.types) && component.types.includes(type)
      )
        ?.longText,
    );
  const hasCanada = componentText("country") === "Canada" ||
    components.some((component) =>
      component?.shortText === "CA" &&
      (component?.types || []).includes("country")
    );
  const hasOntario =
    componentText("administrative_area_level_1") === "Ontario" ||
    components.some((component) =>
      component?.shortText === "ON" &&
      (component?.types || []).includes("administrative_area_level_1")
    );
  if (!hasCanada || !hasOntario) return null;
  const status = text(payload?.businessStatus);
  if (status && status !== "OPERATIONAL") return null;
  const latitude = number(payload?.location?.latitude, NaN);
  const longitude = number(payload?.location?.longitude, NaN);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const name = text(payload?.displayName?.text);
  if (!name) return null;
  const city = componentText("locality") || componentText("postal_town");
  const address = text(payload?.formattedAddress);
  const primaryType = text(payload?.primaryType || payload?.types?.[0]);
  const types: string[] = [primaryType, ...(payload?.types || [])];
  const category = types.some((type) => /cafe|coffee_shop|tea_house/.test(type))
    ? "cafe"
    : types.some((type) => /restaurant/.test(type))
    ? "restaurant"
    : types.find((type) =>
      ["park", "museum", "art_gallery", "bar", "bakery"].includes(type)
    )?.replace("art_gallery", "gallery") || primaryType;

  // Promote the Google-verified place into Echoo's own inventory so outings,
  // arrival checks, and city points treat it like any canonical venue. Google's
  // server-to-server response is the only source — never client-asserted data.
  // Select-then-insert because the unique index on google_place_id is partial,
  // which ON CONFLICT cannot infer; the index still guards duplicate races.
  const resolvedGoogleId = text(payload?.id);
  if (!resolvedGoogleId) return null;
  const nowIso = new Date().toISOString();
  const { data: existingRow } = await supabase
    .from("canonical_places")
    .select("id,location_status")
    .eq("google_place_id", resolvedGoogleId)
    .maybeSingle();
  let canonicalId = text(existingRow?.id);
  if (canonicalId) {
    if (existingRow?.location_status !== "published") return null;
    await supabase
      .from("canonical_places")
      .update({ last_verified_at: nowIso })
      .eq("id", canonicalId);
  } else {
    const { data: inserted, error: insertError } = await supabase
      .from("canonical_places")
      .insert({
        google_place_id: resolvedGoogleId,
        name,
        normalized_name: name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
        category,
        subcategory: primaryType,
        city,
        municipality: city,
        address,
        formatted_address: address,
        latitude,
        longitude,
        country_code: "CA",
        admin_area_1: "ON",
        timezone: "America/Toronto",
        place_provider: "google_places",
        place_provider_id: resolvedGoogleId,
        source_provider: "google_places",
        source_id: resolvedGoogleId,
        confidence_score: 0.9,
        is_supported_region: true,
        location_status: "published",
        last_verified_at: nowIso,
      })
      .select("id")
      .maybeSingle();
    if (insertError && (insertError as { code?: string }).code !== "23505") {
      throw insertError;
    }
    if (inserted?.id) {
      canonicalId = text(inserted.id);
    } else {
      const { data: raced } = await supabase
        .from("canonical_places")
        .select("id")
        .eq("google_place_id", resolvedGoogleId)
        .maybeSingle();
      canonicalId = text(raced?.id);
    }
  }
  if (!canonicalId) return null;
  return {
    id: canonicalId,
    name,
    category,
    subcategory: "",
    city,
    municipality: city,
    address,
    latitude,
    longitude,
    timezone: "America/Toronto",
    image_url: "",
  };
}

export type PlanningOptions = {
  constraints?: PlanConstraints;
  startAt?: Date;
  lockedStops?: Array<{ id: string; index: number }>;
  slotQueries?: string[];
  memory?: PlanningMemory;
  requestId?: string;
  // IDs are supplied by the trusted companion's stored/live search, not the
  // client. Reuse the results so every anchor attempt sees the same evidence.
  slotPlaceIds?: string[][];
  liveImages?: Record<string, string>;
};
export async function handleQuickPlan(
  req: Request,
  options: PlanningOptions = {},
) {
  const startedAt = Date.now();
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as QuickPlanRequest;
    const anchorId = text(body.anchor?.id);
    if (!anchorId) {
      return jsonResponse({ error: "Choose a place to build around" }, 422);
    }

    const supabase = getSupabaseAdmin();
    // A Quick Plan is an on-the-spot utility, so guests can use their local
    // preference cache. A completed member profile still takes precedence.
    const requestCity = text(body.anchor?.city, "Greater Toronto Area");
    let profile = profileForGuest(body.profile, requestCity);
    let memberId = "";
    const token =
      (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] ||
      "";
    if (token) {
      const { data: auth } = await supabase.auth.getUser(token);
      if (auth?.user) {
        memberId = auth.user.id;
        const memberProfile = await profileForMember(supabase, auth.user.id);
        if (memberProfile) profile = memberProfile;
      }
    }
    const requestedBudget = normalizeBudget(
      body.budgetStyle || budgetFromProfile(profile.budget),
    );
    const mood = ["chill", "curious", "hype"].includes(text(body.mood))
      ? text(body.mood)
      : profile.energy;
    profile = { ...profile, energy: mood };
    const stopCount = clampStopCount(body.stopCount);
    const now = options.startAt ?? requestNow(body.now);
    const memory = options.memory ??
      (memberId ? await readPlanningMemory(supabase, memberId) : null);

    const { data: anchorRow, error: anchorError } = isCanonicalPlaceId(anchorId)
      ? await supabase
        .from("canonical_places")
        .select("*")
        .eq("id", anchorId)
        .eq("location_status", "published")
        .eq("is_supported_region", true)
        .eq("country_code", "CA")
        .eq("admin_area_1", "ON")
        .maybeSingle()
      : { data: null, error: null };
    if (anchorError) throw anchorError;
    // Canonical anchors come from the published inventory. Live Discover cards
    // (google: ids) are resolved server-side against the Places API so the
    // anchor is a real operational Ontario venue, never client coordinates.
    let anchor = anchorRow as PlannerPlace | null;
    if (!anchor && anchorId.toLowerCase().startsWith("google:")) {
      anchor = await resolveLiveAnchor(
        supabase,
        anchorId.slice("google:".length),
      );
      if (!anchor) {
        return jsonResponse({
          error:
            "We cannot verify this place with Google right now. Try again in a moment.",
        }, 422);
      }
    }
    if (!anchor) {
      return jsonResponse({
        error:
          "We cannot verify this place in Echoo's published inventory yet. Choose another place to plan an outing.",
      }, 422);
    }
    if (
      !Number.isFinite(number(anchor.latitude, NaN)) ||
      Math.abs(Number(anchor.latitude)) > 90 ||
      !Number.isFinite(number(anchor.longitude, NaN)) ||
      Math.abs(Number(anchor.longitude)) > 180
    ) {
      return jsonResponse({
        error:
          "This place needs a precise location before Echoo can route around it",
      }, 422);
    }

    if (memory?.excludedIds.includes(anchor.id)) {
      return jsonResponse({
        error:
          "You hid this place. Restore it in planning memory before adding it to a route.",
      }, 422);
    }
    const city = text(
      anchor.municipality || anchor.city || profile.city || "Ontario",
    );
    // The RPC's uncategorized scan times out on the live table, so Quick Plan
    // fans out over the category families it actually plans with. A category
    // that times out degrades to empty instead of failing the whole plan.
    let categoryFailures = 0;
    const categories =
      stopCount === 1 || options.slotQueries?.length === stopCount ? [] : [
        "restaurant",
        "cafe",
        "bakery",
        "bar",
        "museum",
        "gallery",
        "tourist_attraction",
        "park",
      ];
    const categoryResults = await Promise.all(
      categories.map(async (category) => {
        try {
          const { data, error } = await supabase.rpc("search_planning_places", {
            p_query: null,
            p_city: city,
            p_lat: Number(anchor!.latitude),
            p_lng: Number(anchor!.longitude),
            p_radius_meters: 14000,
            p_category: category,
            p_limit: 24,
          });
          if (error) {
            categoryFailures++;
            return [];
          }
          return data || [];
        } catch {
          categoryFailures++;
          return [];
        }
      }),
    );
    if (categories.length && categoryFailures === categories.length) {
      return jsonResponse({
        error: "Place search is temporarily unavailable. Try again shortly.",
        code: "INVENTORY_UNAVAILABLE",
      }, 503);
    }
    const slotResults = await Promise.all(
      (options.slotQueries || []).map(async (query, index) => {
        if (options.slotPlaceIds) {
          return (options.slotPlaceIds[index] || []).map((id) => ({ id }));
        }
        const { data, error } = await supabase.rpc("search_planning_places", {
          ...planningSearchFilter(query),
          p_city: city,
          p_lat: Number(anchor!.latitude),
          p_lng: Number(anchor!.longitude),
          p_radius_meters: 14000,
          p_limit: 20,
        });
        if (error) throw error;
        return (data || []) as Array<{ id: string }>;
      }),
    );
    const nearbyRows = [...categoryResults.flat(), ...slotResults.flat()];
    const nearbyIds = Array.from(
      new Set([
        ...nearbyRows.map((row: any) => text(row.id)).filter(Boolean),
        ...(options.lockedStops || []).map((stop) => stop.id),
      ]),
    );

    const { data: fullRows, error: fullError } = nearbyIds.length
      ? await supabase.from("canonical_places").select("*").in("id", nearbyIds)
        .eq("location_status", "published").eq("is_supported_region", true).eq(
          "country_code",
          "CA",
        ).eq("admin_area_1", "ON")
      : { data: [], error: null };
    if (fullError) throw fullError;

    // Profile and hours tables use UUID foreign keys. Live Google IDs are not
    // persisted there yet, so never send them into a UUID `in (...)` filter.
    const placeIds = [
      anchor.id,
      ...((fullRows || []) as PlannerPlace[]).map((place) => place.id),
    ];
    const [profiles, hoursByPlace, coverImages] = await Promise.all([
      loadProfiles(supabase, placeIds),
      loadHours(supabase, placeIds),
      loadApprovedCoverImages(supabase, placeIds),
    ]);
    anchor = {
      ...anchor,
      image_url: coverImages.get(anchor.id) ||
        options.liveImages?.[anchor.id] || anchor.image_url,
    };
    // Covers enrich the plan cards but are not a gate: the live table has few
    // approved photos, and the app renders an honest fallback tile instead.
    const places = new Map<string, PlannerPlace>([
      [anchor.id, anchor],
      ...((fullRows || []) as PlannerPlace[]).map((
        place,
      ): [string, PlannerPlace] => [
        place.id,
        {
          ...place,
          image_url: coverImages.get(place.id) ||
            options.liveImages?.[place.id] || place.image_url,
        },
      ]),
    ]);
    const timezone = text(anchor.timezone, "America/Toronto");
    const anchorCandidate: PlannerCandidate = {
      ...anchor,
      profile: profiles.get(anchor.id),
      distanceMeters: 0,
    };
    const isExcludedType = (place: PlannerPlace) =>
      (options.constraints?.excludedTerms || []).some((term) => {
        const category = String(place.category || "").toLowerCase();
        return term === "club"
          ? /club|nightlife/.test(category)
          : term === "bar"
          ? /bar|pub|club|nightlife/.test(category)
          : category.includes(term);
      });
    if (isExcludedType(anchorCandidate)) {
      return jsonResponse({
        error:
          "The first place conflicts with an excluded type of venue. Try a different first stop.",
      }, 422);
    }
    const anchorHours = hoursByPlace.get(anchor.id) || [];

    // Quick Plan never falls back to generic live-search results. Every
    // additional stop is from Echoo's persisted local inventory; the UI
    // supplies the same polished cover treatment when photo enrichment is
    // still pending for an otherwise curated place.
    const candidates: PlannerCandidate[] = [...places.values()]
      .filter((place) =>
        place.id !== anchor.id && !memory?.excludedIds.includes(place.id) &&
        !isExcludedType(place) && !recentIds(body.recentPlaceIds).has(place.id)
      )
      .filter((place) =>
        Number.isFinite(number(place.latitude, NaN)) &&
        Math.abs(Number(place.latitude)) <= 90 &&
        Number.isFinite(number(place.longitude, NaN)) &&
        Math.abs(Number(place.longitude)) <= 180
      )
      .map((place) => ({
        ...place,
        profile: profiles.get(place.id),
        distanceMeters: haversineMeters(
          Number(anchor!.latitude),
          Number(anchor!.longitude),
          Number(place.latitude),
          Number(place.longitude),
        ),
      }))
      .filter((place) =>
        Number.isFinite(place.distanceMeters) && place.distanceMeters <= 14000
      );

    const ranked = selectStops({
      anchor: anchorCandidate,
      candidates,
      stopCount: 10,
      requestedBudget,
      recentPlaceIds: recentIds(body.recentPlaceIds),
      rotationKey: text(body.rotationKey, "default"),
      profile,
    }).slice(1).sort((a, b) =>
      Number(memory?.recentIds.includes(a.id) || false) -
        Number(memory?.recentIds.includes(b.id) || false) ||
      Number(memory?.likedIds.includes(b.id) || false) -
        Number(memory?.likedIds.includes(a.id) || false)
    );
    const locked = (options.lockedStops || []).filter((stop) =>
      stop.id !== anchor!.id
    ).map((stop) => candidates.find((candidate) => candidate.id === stop.id));
    if (locked.some((place) => !place)) {
      return jsonResponse({
        error:
          "A place in the previous plan is no longer available. Start a new plan.",
      }, 422);
    }
    const slotCandidates = slotResults.slice(1).flatMap((rows) =>
      rows.slice(0, 3).map((row) =>
        candidates.find((place) => place.id === row.id)
      )
    ).filter(Boolean);
    const pool = [
      ...new Map(
        [...locked, ...slotCandidates, ...ranked].filter(Boolean).map(
          (place) => [place!.id, place!],
        ),
      ).values(),
    ].slice(0, 8);
    if (pool.length < stopCount - 1 && recentIds(body.recentPlaceIds).size) {
      return jsonResponse({
        error:
          "No further alternatives in the available inventory. Your current outing is unchanged.",
        code: "ALTERNATIVES_EXHAUSTED",
      }, 409);
    }
    const constraints: PlanConstraints = {
      ...options.constraints,
      fixedPositions: options.lockedStops,
      allowedIdsByPosition: slotResults.map((rows) =>
        rows.map((row) => row.id)
      ),
    };
    if (slotResults.some((rows) => !rows.length)) {
      return jsonResponse({
        error:
          "A requested type of place is unavailable nearby. Try a different second stop.",
        code: "NO_MATCHING_STOP",
      }, 422);
    }
    if (constraints.travelMode && stopCount > 1) {
      constraints.routes = await loadRouteMatrix(
        [anchorCandidate, ...pool],
        constraints.travelMode,
        now,
      );
      if (constraints.requireRoutes && !constraints.routes) {
        return jsonResponse({
          error:
            "Travel checking is unavailable right now. Your travel requirement has been kept; try again later.",
          code: "ROUTES_UNAVAILABLE",
        }, 503);
      }
    }
    const groups: PlannerCandidate[][] = stopCount === 1
      ? [[anchorCandidate]]
      : [];
    for (let i = 0; i < pool.length; i++) {
      if (stopCount === 2) groups.push([anchorCandidate, pool[i]]);
      if (stopCount === 3) {
        for (let j = i + 1; j < pool.length; j++) {
          groups.push([anchorCandidate, pool[i], pool[j]]);
        }
      }
    }
    // Sparse initial inventory can offer a shorter route, never on a constrained
    // companion request or a request to change an existing route.
    if (
      !groups.length && !options.constraints && !options.lockedStops?.length
    ) groups.push([anchorCandidate, ...pool].slice(0, stopCount));
    let plan: ReturnType<typeof buildPlan> | undefined;
    for (const group of groups) {
      try {
        const candidate = buildPlan({
          anchor: anchorCandidate,
          selected: group,
          hoursByPlace,
          timezone,
          startAt: now,
          requestedBudget,
          requestedStopCount: stopCount,
          mood,
          anchorPosition: [1, 2, 3].includes(Number(body.anchorPosition))
            ? Math.min(stopCount, Number(body.anchorPosition))
            : undefined,
          constraints,
        });
        if (
          constraints.openOnly && candidate.startsAt &&
          Date.parse(candidate.startsAt) > now.getTime() + 60000
        ) continue;
        if (
          candidate.stops.some((stop) =>
            stop.availability === "check_hours" ||
            (constraints.openOnly && stop.availability !== "open")
          )
        ) continue;
        if (
          options.lockedStops?.some((stop) =>
            candidate.stops[stop.index]?.id !== stop.id
          )
        ) continue;
        if (
          slotResults.some((matches, index) =>
            options.slotQueries?.[index] &&
            !matches.some((row) => row.id === candidate.stops[index]?.id)
          )
        ) continue;
        if (
          constraints.maxPerPerson != null &&
          (!candidate.budgetEstimate || candidate.budgetEstimate.unknownCount ||
            candidate.budgetEstimate.max > constraints.maxPerPerson)
        ) continue;
        plan = candidate;
        break;
      } catch (error) {
        if (!(error instanceof PlannerError)) throw error;
      }
    }
    if (!plan) {
      return jsonResponse({
        error:
          "No complete route fits these preferences and the available hours, prices or travel data. Try another time, fewer stops, or change a preference.",
        code: "NO_FEASIBLE_PLAN",
      }, 422);
    }
    plan.alternativesExhausted = candidates.filter((place) =>
      !recentIds(body.recentPlaceIds).has(place.id) &&
      !plan!.stops.some((picked) =>
        picked.id === place.id
      )
    ).length < stopCount - 1;
    if (memberId && memory?.enabled) {
      await persistPlanningResult(
        supabase,
        memberId,
        options.requestId || crypto.randomUUID(),
        plan,
      );
    }

    const anchorStatus = openAt(anchorHours, timezone, now);
    await logLocationEvent(supabase, {
      functionName: "quick-plan",
      eventType: Date.now() - startedAt > 750
        ? "slow_native_plan"
        : "native_plan",
      durationMs: Date.now() - startedAt,
      countryCode: "CA",
      adminArea1: "ON",
      city,
      request: { anchorId, stopCount, budgetStyle: requestedBudget },
      responseSummary: {
        returnedStops: plan.stops.length,
        candidateCount: candidates.length,
        categoryFailures,
        totalTravelMinutes: plan.totalTravelMinutes,
        anchorOpen: anchorStatus.known ? anchorStatus.open : null,
      },
    });

    return jsonResponse({
      supported: true,
      provider: "echoo-native-planner",
      plan,
    });
  } catch (error) {
    if (error instanceof PlannerError) {
      return jsonResponse({ error: error.message }, 422);
    }
    console.error("quick-plan failed", error);
    return jsonResponse({
      error: "Quick Plan could not build a reliable route right now",
    }, 500);
  }
}
