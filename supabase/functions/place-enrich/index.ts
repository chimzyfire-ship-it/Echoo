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
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniq(values: Array<string | undefined | null>) {
  return Array.from(
    new Set(values.map((value) => cleanText(value).toLowerCase()).filter(Boolean)),
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
  const readableCategory = cleanText(place.subcategory) ||
    cleanText(place.category) ||
    "local place";
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
    summary:
      `${name} is a ${readableCategory} in ${city}. Echoo's initial profile is based on verified place data and category signals, so it should be treated as directional until reviewed.`,
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
  return Math.max(1, Math.min(Math.round(parsed), 250));
}

async function selectPlaces(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  payload: Payload,
) {
  let query = supabase
    .from("canonical_places")
    .select(
      "id,name,category,subcategory,municipality,address,website,source_provider,confidence_score,location_status,metadata,place_profiles!left(id)",
    )
    .eq("country_code", "CA")
    .eq("admin_area_1", "ON")
    .neq("location_status", "archived")
    .order("confidence_score", { ascending: false })
    .limit(limit(payload.limit));

  if (payload.placeId) query = query.eq("id", payload.placeId);
  if (payload.municipality) query = query.ilike("municipality", payload.municipality);
  if (payload.category) query = query.eq("category", payload.category);
  if (!payload.includeExisting) query = query.is("place_profiles.id", null);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as unknown as Array<CanonicalPlace & { place_profiles?: unknown[] }>;
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
      const inputHash = await sha256Hex(JSON.stringify({
        placeId: place.id,
        name: place.name,
        category: place.category,
        subcategory: place.subcategory,
        municipality: place.municipality,
        sourceProvider: place.source_provider,
        confidenceScore: place.confidence_score,
        profileVersion: 1,
      }));

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
            job_type: "place_profile_v1",
            status: "running",
            input_hash: inputHash,
            model: "echoo-deterministic-profile-v1",
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
            reviewed_at: profile.human_review_status === "approved"
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
      scanned: places.length,
      enriched: dryRun ? 0 : results.length,
      queuedForReview: results.filter((result: any) =>
        result.reviewStatus === "needs_update"
      ).length,
      results,
    });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "Unknown place enrichment error";
    return jsonResponse({ error: message }, 500);
  }
});
