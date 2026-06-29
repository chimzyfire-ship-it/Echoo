import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
  sha256Hex,
} from "../_shared/location.ts";
import { assertIngestionAuthorized } from "../_shared/ontario-ingestion.ts";

type CanonicalPlace = {
  id: string;
  name: string | null;
  category: string | null;
  subcategory: string | null;
  municipality: string | null;
  address: string | null;
  website: string | null;
  source_provider: string | null;
  confidence_score: number | null;
  location_status: string | null;
  metadata: Record<string, unknown> | null;
};

type ProfileDraft = {
  vibe_tags: string[];
  good_for: string[];
  meal_tags: string[];
  activity_tags: string[];
  noise_level: string | null;
  price_band: string | null;
  lunch_score: number;
  date_score: number;
  group_score: number;
  solo_score: number;
  family_score: number;
  rainy_day_score: number;
  summary: string;
  caveats: string;
  confidence_score: number;
  human_review_status: "pending" | "approved" | "needs_update";
};

type Payload = {
  placeId?: string;
  municipality?: string;
  category?: string;
  categories?: string[];
  sourceProvider?: string;
  offset?: number;
  limit?: number;
  includeExisting?: boolean;
  dryRun?: boolean;
};

const CATEGORY_PROFILES: Record<string, Partial<ProfileDraft>> = {
  restaurant: {
    vibe_tags: ["food", "social", "sit-down"],
    good_for: ["lunch", "date", "group"],
    meal_tags: ["lunch", "dinner"],
    noise_level: "medium",
    price_band: "$$",
    lunch_score: 0.82,
    date_score: 0.72,
    group_score: 0.78,
    solo_score: 0.54,
    family_score: 0.62,
    rainy_day_score: 0.76,
  },
  fast_food: {
    vibe_tags: ["quick", "casual", "food"],
    good_for: ["lunch", "solo", "group"],
    meal_tags: ["lunch", "quick_bite"],
    noise_level: "medium",
    price_band: "$",
    lunch_score: 0.72,
    date_score: 0.18,
    group_score: 0.48,
    solo_score: 0.7,
    family_score: 0.58,
    rainy_day_score: 0.62,
  },
  cafe: {
    vibe_tags: ["cozy", "casual", "low-key"],
    good_for: ["coffee", "solo", "date", "lunch"],
    meal_tags: ["coffee", "snack", "lunch"],
    noise_level: "low-medium",
    price_band: "$",
    lunch_score: 0.68,
    date_score: 0.66,
    group_score: 0.52,
    solo_score: 0.86,
    family_score: 0.54,
    rainy_day_score: 0.82,
  },
  library: {
    vibe_tags: ["quiet", "civic", "study-friendly"],
    good_for: ["solo", "family", "rainy_day"],
    activity_tags: ["reading", "study", "community"],
    noise_level: "low",
    price_band: "free",
    lunch_score: 0.18,
    date_score: 0.24,
    group_score: 0.42,
    solo_score: 0.9,
    family_score: 0.78,
    rainy_day_score: 0.92,
  },
  park: {
    vibe_tags: ["outdoors", "walkable", "relaxed"],
    good_for: ["solo", "family", "group", "date"],
    activity_tags: ["walking", "fresh_air", "picnic"],
    noise_level: "variable",
    price_band: "free",
    lunch_score: 0.32,
    date_score: 0.68,
    group_score: 0.72,
    solo_score: 0.74,
    family_score: 0.84,
    rainy_day_score: 0.18,
  },
  trail: {
    vibe_tags: ["outdoors", "walkable", "active", "quiet"],
    good_for: ["solo", "date", "family", "group"],
    activity_tags: ["walking", "hiking", "fresh_air"],
    noise_level: "low",
    price_band: "free",
    lunch_score: 0.08,
    date_score: 0.68,
    group_score: 0.56,
    solo_score: 0.86,
    family_score: 0.7,
    rainy_day_score: 0.08,
  },
  museum: {
    vibe_tags: ["cultural", "curious", "indoor"],
    good_for: ["date", "solo", "family", "rainy_day"],
    activity_tags: ["culture", "learning", "exhibits"],
    noise_level: "low-medium",
    price_band: "$$",
    lunch_score: 0.22,
    date_score: 0.82,
    group_score: 0.62,
    solo_score: 0.76,
    family_score: 0.72,
    rainy_day_score: 0.9,
  },
  gallery: {
    vibe_tags: ["artful", "cultural", "quiet"],
    good_for: ["date", "solo", "rainy_day"],
    activity_tags: ["art", "culture", "exhibits"],
    noise_level: "low",
    price_band: "$$",
    lunch_score: 0.18,
    date_score: 0.82,
    group_score: 0.52,
    solo_score: 0.82,
    family_score: 0.48,
    rainy_day_score: 0.88,
  },
  community_centre: {
    vibe_tags: ["community", "practical", "active"],
    good_for: ["family", "group", "rainy_day"],
    activity_tags: ["recreation", "classes", "community"],
    noise_level: "medium",
    price_band: "$",
    lunch_score: 0.12,
    date_score: 0.18,
    group_score: 0.74,
    solo_score: 0.42,
    family_score: 0.82,
    rainy_day_score: 0.78,
  },
  theatre: {
    vibe_tags: ["performing-arts", "evening", "cultural"],
    good_for: ["date", "group", "rainy_day"],
    activity_tags: ["show", "performance", "culture"],
    noise_level: "medium",
    price_band: "$$",
    lunch_score: 0.1,
    date_score: 0.84,
    group_score: 0.72,
    solo_score: 0.48,
    family_score: 0.5,
    rainy_day_score: 0.88,
  },
  bar: {
    vibe_tags: ["nightlife", "social", "lively"],
    good_for: ["group", "date"],
    meal_tags: ["drinks", "late"],
    noise_level: "high",
    price_band: "$$",
    lunch_score: 0.2,
    date_score: 0.62,
    group_score: 0.82,
    solo_score: 0.28,
    family_score: 0.08,
    rainy_day_score: 0.62,
  },
  pub: {
    vibe_tags: ["social", "casual", "lively"],
    good_for: ["group", "date"],
    meal_tags: ["drinks", "dinner"],
    noise_level: "medium-high",
    price_band: "$$",
    lunch_score: 0.38,
    date_score: 0.58,
    group_score: 0.78,
    solo_score: 0.38,
    family_score: 0.22,
    rainy_day_score: 0.68,
  },
  cinema: {
    vibe_tags: ["movie", "indoor", "easy-plan"],
    good_for: ["date", "group", "family", "rainy_day"],
    activity_tags: ["film", "screening", "entertainment"],
    noise_level: "low-medium",
    price_band: "$$",
    lunch_score: 0.08,
    date_score: 0.78,
    group_score: 0.66,
    solo_score: 0.58,
    family_score: 0.72,
    rainy_day_score: 0.92,
  },
  arts_centre: {
    vibe_tags: ["creative", "cultural", "indoor"],
    good_for: ["date", "solo", "group", "rainy_day"],
    activity_tags: ["arts", "culture", "community"],
    noise_level: "low-medium",
    price_band: "$$",
    lunch_score: 0.1,
    date_score: 0.8,
    group_score: 0.64,
    solo_score: 0.76,
    family_score: 0.58,
    rainy_day_score: 0.9,
  },
  cultural_space: {
    vibe_tags: ["cultural", "local-interest", "explore"],
    good_for: ["date", "solo", "family", "group"],
    activity_tags: ["culture", "learning", "explore"],
    noise_level: "variable",
    price_band: "$",
    lunch_score: 0.14,
    date_score: 0.7,
    group_score: 0.62,
    solo_score: 0.68,
    family_score: 0.62,
    rainy_day_score: 0.58,
  },
  attraction: {
    vibe_tags: ["local-interest", "explore", "sightseeing"],
    good_for: ["date", "family", "group", "solo"],
    activity_tags: ["sightseeing", "explore", "photos"],
    noise_level: "variable",
    price_band: "$$",
    lunch_score: 0.18,
    date_score: 0.68,
    group_score: 0.72,
    solo_score: 0.62,
    family_score: 0.76,
    rainy_day_score: 0.42,
  },
  historic: {
    vibe_tags: ["historic", "reflective", "local-interest"],
    good_for: ["solo", "date", "family"],
    activity_tags: ["history", "walking", "learning"],
    noise_level: "low",
    price_band: "free",
    lunch_score: 0.08,
    date_score: 0.44,
    group_score: 0.38,
    solo_score: 0.66,
    family_score: 0.54,
    rainy_day_score: 0.22,
  },
  mall: {
    vibe_tags: ["shopping", "indoor", "practical"],
    good_for: ["family", "group", "rainy_day"],
    activity_tags: ["shopping", "food_court", "errands"],
    noise_level: "medium-high",
    price_band: "$$",
    lunch_score: 0.56,
    date_score: 0.22,
    group_score: 0.58,
    solo_score: 0.54,
    family_score: 0.72,
    rainy_day_score: 0.88,
  },
  fitness_centre: {
    vibe_tags: ["active", "wellness", "indoor"],
    good_for: ["solo", "rainy_day"],
    activity_tags: ["fitness", "wellness", "workout"],
    noise_level: "medium",
    price_band: "$$",
    lunch_score: 0.02,
    date_score: 0.08,
    group_score: 0.32,
    solo_score: 0.78,
    family_score: 0.18,
    rainy_day_score: 0.8,
  },
  public_facility: {
    vibe_tags: ["civic", "practical", "local"],
    good_for: ["solo", "family"],
    activity_tags: ["community", "services"],
    noise_level: "variable",
    price_band: "free",
    lunch_score: 0.06,
    date_score: 0.08,
    group_score: 0.34,
    solo_score: 0.42,
    family_score: 0.54,
    rainy_day_score: 0.6,
  },
  food_premise: {
    vibe_tags: ["food", "local", "casual"],
    good_for: ["lunch", "solo", "group"],
    meal_tags: ["lunch", "dinner"],
    noise_level: "unknown",
    price_band: null,
    lunch_score: 0.64,
    date_score: 0.38,
    group_score: 0.52,
    solo_score: 0.56,
    family_score: 0.5,
    rainy_day_score: 0.58,
  },
  nature_reserve: {
    vibe_tags: ["outdoors", "quiet", "nature"],
    good_for: ["solo", "date", "family", "group"],
    activity_tags: ["walking", "nature", "fresh_air"],
    noise_level: "low",
    price_band: "free",
    lunch_score: 0.12,
    date_score: 0.72,
    group_score: 0.58,
    solo_score: 0.84,
    family_score: 0.76,
    rainy_day_score: 0.08,
  },
};

const DEFAULT_PROFILE: Partial<ProfileDraft> = {
  vibe_tags: ["local", "practical"],
  good_for: ["solo"],
  meal_tags: [],
  activity_tags: ["local_stop"],
  noise_level: "unknown",
  price_band: null,
  lunch_score: 0.25,
  date_score: 0.35,
  group_score: 0.42,
  solo_score: 0.48,
  family_score: 0.38,
  rainy_day_score: 0.42,
};

function clamp01(value: unknown, fallback = 0.5) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(1, parsed));
}

function cleanText(value: unknown) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(
      values.map((value) => cleanText(value).toLowerCase()).filter(Boolean),
    ),
  );
}

function profileTemplate(category: string | null) {
  const normalized = cleanText(category).toLowerCase();
  return {
    ...DEFAULT_PROFILE,
    ...(CATEGORY_PROFILES[normalized] || {}),
  };
}

function confidenceFor(place: CanonicalPlace, templateKnown: boolean) {
  let score = templateKnown ? 0.72 : 0.58;
  score += clamp01(place.confidence_score, 0.5) * 0.16;
  if (place.source_provider?.startsWith("echoo_")) score += 0.08;
  if (place.website) score += 0.02;
  if (place.address) score += 0.02;
  return clamp01(score, 0.5);
}

function buildProfile(place: CanonicalPlace): ProfileDraft {
  const category = cleanText(place.category).toLowerCase();
  const templateKnown = Boolean(CATEGORY_PROFILES[category]);
  const template = profileTemplate(category);
  const name = cleanText(place.name) || "This place";
  const city = cleanText(place.municipality) || "Ontario";
  const readableCategory =
    cleanText(place.subcategory) || cleanText(place.category) || "local place";
  const confidence = confidenceFor(place, templateKnown);
  const reviewStatus = confidence >= 0.78 ? "approved" : "needs_update";

  return {
    vibe_tags: uniq([...(template.vibe_tags || []), readableCategory]),
    good_for: uniq(template.good_for || []),
    meal_tags: uniq(template.meal_tags || []),
    activity_tags: uniq(template.activity_tags || []),
    noise_level: template.noise_level || null,
    price_band: template.price_band || null,
    lunch_score: clamp01(template.lunch_score, 0.25),
    date_score: clamp01(template.date_score, 0.35),
    group_score: clamp01(template.group_score, 0.42),
    solo_score: clamp01(template.solo_score, 0.48),
    family_score: clamp01(template.family_score, 0.38),
    rainy_day_score: clamp01(template.rainy_day_score, 0.42),
    summary: `${name} is a ${readableCategory} in ${city}. Echoo's initial profile is based on verified place data and category signals, so it should be treated as directional until reviewed.`,
    caveats: templateKnown
      ? "Generated from category, source, and location metadata; confirm hours, pricing, and current vibe before featuring."
      : "Low-specificity category profile; needs editorial review before strong recommendations.",
    confidence_score: Number(confidence.toFixed(3)),
    human_review_status: reviewStatus,
  };
}

function limit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(Math.round(parsed), 500));
}

function offset(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function categoriesFromPayload(payload: Payload) {
  return Array.from(
    new Set(
      [
        payload.category,
        ...(Array.isArray(payload.categories) ? payload.categories : []),
      ]
        .map((category) => cleanText(category).toLowerCase())
        .filter(Boolean),
    ),
  );
}

async function selectPlaces(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  payload: Payload,
) {
  const requestedLimit = limit(payload.limit);
  const requestedOffset = offset(payload.offset);
  const categories = categoriesFromPayload(payload);
  let query = supabase
    .from("canonical_places")
    .select(
      "id,name,category,subcategory,municipality,address,website,source_provider,confidence_score,location_status,metadata,place_profiles!left(id)",
    )
    .eq("country_code", "CA")
    .eq("admin_area_1", "ON")
    .neq("location_status", "archived")
    .order("confidence_score", { ascending: false })
    .order("id", { ascending: true })
    .range(requestedOffset, requestedOffset + requestedLimit - 1);

  if (payload.placeId) query = query.eq("id", payload.placeId);
  if (payload.municipality)
    query = query.ilike("municipality", payload.municipality);
  if (categories.length === 1) query = query.eq("category", categories[0]);
  if (categories.length > 1) query = query.in("category", categories);
  if (payload.sourceProvider)
    query = query.eq("source_provider", payload.sourceProvider);
  if (!payload.includeExisting) query = query.is("place_profiles.id", null);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as Array<
    CanonicalPlace & { place_profiles?: unknown[] }
  >;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const unauthorized = assertIngestionAuthorized(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();

  try {
    const payload = (await req.json().catch(() => ({}))) as Payload;
    const places = await selectPlaces(supabase, payload);
    const dryRun = Boolean(payload.dryRun);
    const results = [];

    for (const place of places) {
      const profile = buildProfile(place);
      const inputHash = await sha256Hex(
        JSON.stringify({
          placeId: place.id,
          name: place.name,
          category: place.category,
          subcategory: place.subcategory,
          municipality: place.municipality,
          sourceProvider: place.source_provider,
          confidenceScore: place.confidence_score,
          profileVersion: 2,
        }),
      );

      if (dryRun) {
        results.push({ placeId: place.id, name: place.name, profile, dryRun });
        continue;
      }

      const { data: job, error: jobError } = await supabase
        .from("ai_enrichment_jobs")
        .upsert(
          {
            entity_type: "place",
            entity_id: place.id,
            job_type: "place_profile_v2",
            status: "running",
            input_hash: inputHash,
            model: "echoo-deterministic-profile-v2",
            started_at: new Date().toISOString(),
            error: null,
          },
          {
            onConflict: "entity_type,entity_id,job_type,input_hash",
          },
        )
        .select("id")
        .single();
      if (jobError) throw jobError;

      const { data: savedProfile, error: profileError } = await supabase
        .from("place_profiles")
        .upsert(
          {
            place_id: place.id,
            ...profile,
            ai_generated_at: new Date().toISOString(),
            reviewed_at:
              profile.human_review_status === "approved"
                ? new Date().toISOString()
                : null,
          },
          { onConflict: "place_id" },
        )
        .select("id,place_id,confidence_score,human_review_status")
        .single();
      if (profileError) {
        await supabase
          .from("ai_enrichment_jobs")
          .update({
            status: "failed",
            error: profileError.message,
            completed_at: new Date().toISOString(),
          })
          .eq("id", job.id);
        throw profileError;
      }

      await supabase
        .from("ai_enrichment_jobs")
        .update({
          status: "completed",
          output_json: profile,
          completed_at: new Date().toISOString(),
        })
        .eq("id", job.id);

      results.push({
        placeId: place.id,
        name: place.name,
        profileId: savedProfile.id,
        confidenceScore: savedProfile.confidence_score,
        reviewStatus: savedProfile.human_review_status,
      });
    }

    return jsonResponse({
      success: true,
      dryRun,
      offset: offset(payload.offset),
      limit: limit(payload.limit),
      categories: categoriesFromPayload(payload),
      sourceProvider: payload.sourceProvider || null,
      scanned: places.length,
      enriched: dryRun ? 0 : results.length,
      queuedForReview: results.filter(
        (result: any) => result.reviewStatus === "needs_update",
      ).length,
      results,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown place enrichment error";
    return jsonResponse({ error: message }, 500);
  }
});
