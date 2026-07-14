import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import { cleanDiscoveryText } from "../_shared/hybrid-discovery.ts";

type Action = "save" | "visit" | "rate" | "review" | "report";
type Payload = {
  action?: unknown;
  entityId?: unknown;
  saved?: unknown;
  rating?: unknown;
  body?: unknown;
  occurredAt?: unknown;
  targetType?: unknown;
  targetId?: unknown;
  reason?: unknown;
  details?: unknown;
};

function bearerToken(req: Request) {
  return (
    (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] ||
    ""
  );
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

const ACTION_LIMITS: Record<Action, { max: number; windowHours: number }> = {
  save: { max: 40, windowHours: 1 },
  visit: { max: 5, windowHours: 24 },
  rate: { max: 20, windowHours: 24 },
  review: { max: 3, windowHours: 24 },
  report: { max: 8, windowHours: 24 },
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const body = (await req.json().catch(() => ({}))) as Payload;
    const action = cleanDiscoveryText(body.action, 20).toLowerCase() as Action;
    if (!(action in ACTION_LIMITS))
      return jsonResponse({ error: "Unsupported community action" }, 422);
    const supabase = getSupabaseAdmin();
    const token = bearerToken(req);
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user)
      return jsonResponse({ error: "Sign in to add to Echoo" }, 401);
    const userId = auth.user.id;
    const limit = ACTION_LIMITS[action];
    const cutoff = new Date(
      Date.now() - limit.windowHours * 60 * 60 * 1000,
    ).toISOString();
    const { count, error: limitError } = await supabase
      .from("discovery_action_events")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("action", action)
      .gte("created_at", cutoff);
    if (limitError) throw limitError;
    if ((count || 0) >= limit.max)
      return jsonResponse(
        {
          error: "That action has reached its limit for now. Try again later.",
        },
        429,
      );

    if (action === "report") {
      const targetType = cleanDiscoveryText(body.targetType, 12).toLowerCase();
      const targetId = cleanDiscoveryText(body.targetId, 64);
      const reason = cleanDiscoveryText(body.reason, 24).toLowerCase();
      const details = cleanDiscoveryText(body.details, 1000) || null;
      if (
        !["review", "media"].includes(targetType) ||
        !isUuid(targetId) ||
        ![
          "spam",
          "harassment",
          "hate",
          "misinformation",
          "rights",
          "other",
        ].includes(reason)
      )
        return jsonResponse({ error: "Invalid report" }, 422);
      const { error } = await supabase.from("discovery_abuse_reports").insert({
        reporter_user_id: userId,
        target_type: targetType,
        target_id: targetId,
        reason,
        details,
      });
      if (error) throw error;
      await supabase
        .from("discovery_action_events")
        .insert({ user_id: userId, action: "report" });
      return jsonResponse({ ok: true, status: "received" });
    }

    const entityId = cleanDiscoveryText(body.entityId, 64);
    if (!isUuid(entityId))
      return jsonResponse({ error: "Invalid Echoo place" }, 422);
    const { data: entity, error: entityError } = await supabase
      .from("location_entities")
      .select("id")
      .eq("id", entityId)
      .eq("status", "published")
      .maybeSingle();
    if (entityError) throw entityError;
    if (!entity)
      return jsonResponse(
        { error: "This place is not available for community actions" },
        404,
      );

    if (action === "save") {
      const saved = body.saved !== false;
      const result = saved
        ? await supabase.from("discovery_entity_saves").upsert(
            { location_entity_id: entityId, user_id: userId },
            {
              onConflict: "location_entity_id,user_id",
              ignoreDuplicates: true,
            },
          )
        : await supabase
            .from("discovery_entity_saves")
            .delete()
            .eq("location_entity_id", entityId)
            .eq("user_id", userId);
      if (result.error) throw result.error;
      await supabase.from("discovery_action_events").insert({
        user_id: userId,
        action: saved ? "save" : "unsave",
        location_entity_id: entityId,
      });
      return jsonResponse({ ok: true, saved });
    }
    if (action === "visit") {
      const occurredAt = body.occurredAt
        ? new Date(String(body.occurredAt))
        : new Date();
      if (
        !Number.isFinite(occurredAt.getTime()) ||
        occurredAt.getTime() > Date.now() + 60 * 60 * 1000 ||
        occurredAt.getTime() < Date.now() - 10 * 365 * 24 * 60 * 60 * 1000
      )
        return jsonResponse({ error: "Choose a valid visit date" }, 422);
      const { error } = await supabase.from("discovery_entity_visits").insert({
        location_entity_id: entityId,
        user_id: userId,
        occurred_at: occurredAt.toISOString(),
        visit_source: "self_report",
        verification_status: "unverified",
      });
      if (error) throw error;
      await supabase.from("discovery_action_events").insert({
        user_id: userId,
        action: "visit",
        location_entity_id: entityId,
      });
      return jsonResponse({ ok: true, visited: true });
    }
    if (action === "rate") {
      const rating = Math.round(Number(body.rating));
      if (!Number.isInteger(rating) || rating < 1 || rating > 5)
        return jsonResponse({ error: "Rating must be between 1 and 5" }, 422);
      const { error } = await supabase
        .from("discovery_entity_ratings")
        .upsert(
          { location_entity_id: entityId, user_id: userId, rating },
          { onConflict: "location_entity_id,user_id" },
        );
      if (error) throw error;
      await supabase.from("discovery_action_events").insert({
        user_id: userId,
        action: "rate",
        location_entity_id: entityId,
      });
      return jsonResponse({ ok: true, rating });
    }
    const review = cleanDiscoveryText(body.body, 1200);
    if (review.length < 20)
      return jsonResponse(
        { error: "A review needs at least 20 characters" },
        422,
      );
    const { error } = await supabase.from("discovery_entity_reviews").upsert(
      {
        location_entity_id: entityId,
        user_id: userId,
        body: review,
        moderation_status: "pending",
        moderation_note: null,
      },
      { onConflict: "location_entity_id,user_id" },
    );
    if (error) throw error;
    await supabase.from("discovery_action_events").insert({
      user_id: userId,
      action: "review",
      location_entity_id: entityId,
    });
    return jsonResponse({ ok: true, status: "pending_review" });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Community action failed",
      },
      500,
    );
  }
});
