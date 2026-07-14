import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get("LOCATION_ADMIN_TOKEN");
  const provided = req.headers.get("x-admin-token") || "";
  return Boolean(expected && provided && expected === provided);
}

function cleanText(value: unknown, fallback = "") {
  return String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();
}

function demandKey(row: Record<string, unknown>) {
  return [
    cleanText(row.query).toLowerCase(),
    cleanText(row.city, "Ontario").toLowerCase(),
    cleanText(row.intent, "unknown").toLowerCase(),
  ].join("|");
}

function summarizeDemand(rows: Array<Record<string, unknown>>) {
  const grouped = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const key = demandKey(row);
    const existing = grouped.get(key);
    if (existing) {
      existing.count = Number(existing.count || 0) + 1;
      existing.totalResultCount =
        Number(existing.totalResultCount || 0) + Number(row.result_count || 0);
      existing.lastSeenAt =
        String(row.created_at || "") > String(existing.lastSeenAt || "")
          ? row.created_at
          : existing.lastSeenAt;
      continue;
    }
    grouped.set(key, {
      query: cleanText(row.query),
      city: cleanText(row.city, "Ontario"),
      province: cleanText(row.province, "ON"),
      intent: cleanText(row.intent, "unknown"),
      count: 1,
      totalResultCount: Number(row.result_count || 0),
      lastSeenAt: row.created_at,
      sampleId: row.id,
    });
  }
  return [...grouped.values()].sort((a, b) => {
    const countDiff = Number(b.count || 0) - Number(a.count || 0);
    if (countDiff) return countDiff;
    return String(b.lastSeenAt || "").localeCompare(String(a.lastSeenAt || ""));
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (!isAuthorized(req)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabase = getSupabaseAdmin();

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const queue = url.searchParams.get("queue") || "places";
      const status = url.searchParams.get("status") || "needs_review";
      const limit = Math.max(
        1,
        Math.min(Number(url.searchParams.get("limit") || 50), 100),
      );

      if (queue === "duplicates") {
        const { data, error } = await supabase.rpc(
          "ontario_duplicate_place_candidates",
          { p_limit: limit },
        );
        if (error) throw error;
        return jsonResponse({ queue, candidates: data || [] });
      }

      if (queue === "profiles") {
        const { data, error } = await supabase.rpc(
          "ontario_profile_review_queue",
          { p_limit: limit },
        );
        if (error) throw error;
        return jsonResponse({ queue, profiles: data || [] });
      }

      if (queue === "schedules") {
        const { data, error } = await supabase
          .from("ontario_worker_schedules")
          .select("*")
          .order("job_name", { ascending: true });
        if (error) throw error;
        return jsonResponse({ queue, schedules: data || [] });
      }

      if (queue === "demand") {
        const rowLimit = Math.max(50, Math.min(limit * 5, 500));
        const { data, error } = await supabase
          .from("zero_result_queries")
          .select(
            "id, query, city, province, intent, result_count, lat, lng, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(rowLimit);
        if (error) throw error;
        const rows = (data || []) as Array<Record<string, unknown>>;
        return jsonResponse({
          queue,
          demand: summarizeDemand(rows).slice(0, limit),
          recent: rows.slice(0, limit),
        });
      }

      if (queue === "community") {
        const { data, error } = await supabase
          .from("discovery_entity_reviews")
          .select(
            "id,body,moderation_status,created_at,location_entity_id,location_entities(title,city)",
          )
          .eq(
            "moderation_status",
            status === "needs_review" ? "pending" : status,
          )
          .order("created_at", { ascending: true })
          .limit(limit);
        if (error) throw error;
        const { data: reports, error: reportsError } = await supabase
          .from("discovery_abuse_reports")
          .select("id,target_type,target_id,reason,details,status,created_at")
          .eq("status", "open")
          .order("created_at", { ascending: true })
          .limit(limit);
        if (reportsError) throw reportsError;
        const { data: media, error: mediaError } = await supabase
          .from("discovery_entity_media")
          .select(
            "id,storage_path,alt_text,source_type,rights_status,created_at,location_entity_id,location_entities(title,city)",
          )
          .eq("review_status", "pending")
          .order("created_at", { ascending: true })
          .limit(limit);
        if (mediaError) throw mediaError;
        return jsonResponse({
          queue,
          reviews: data || [],
          reports: reports || [],
          media: media || [],
        });
      }

      const { data, error } = await supabase
        .from("canonical_places")
        .select("*")
        .eq("location_status", status)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      return jsonResponse({ places: data || [] });
    }

    if (req.method === "PATCH") {
      const body = await req.json();
      const action = body.action || "review_place";

      if (action === "review_profile") {
        const profileId = body.profileId;
        const status = body.status;
        const confidenceScore = body.confidenceScore ?? null;
        if (
          !profileId ||
          !["pending", "approved", "rejected", "needs_update"].includes(status)
        ) {
          return jsonResponse(
            { error: "profileId and valid status are required." },
            422,
          );
        }

        const { data, error } = await supabase.rpc("review_place_profile", {
          p_profile_id: profileId,
          p_status: status,
          p_confidence_score: confidenceScore,
        });
        if (error) throw error;
        return jsonResponse({ profile: data });
      }

      if (action === "merge_places") {
        const primaryPlaceId = body.primaryPlaceId;
        const duplicatePlaceId = body.duplicatePlaceId;
        if (!primaryPlaceId || !duplicatePlaceId) {
          return jsonResponse(
            { error: "primaryPlaceId and duplicatePlaceId are required." },
            422,
          );
        }

        const { data, error } = await supabase.rpc("merge_canonical_places", {
          p_primary_place_id: primaryPlaceId,
          p_duplicate_place_id: duplicatePlaceId,
        });
        if (error) throw error;
        return jsonResponse({ place: data });
      }

      if (action === "moderate_discovery_content") {
        const contentType = body.contentType;
        const contentId = body.contentId;
        const status = body.status;
        const note = cleanText(body.note).slice(0, 1000) || null;
        if (
          !contentId ||
          !["review", "media"].includes(contentType) ||
          !["approved", "rejected", "pending"].includes(status)
        ) {
          return jsonResponse(
            { error: "contentType, contentId, and valid status are required." },
            422,
          );
        }
        const table =
          contentType === "review"
            ? "discovery_entity_reviews"
            : "discovery_entity_media";
        const patch =
          contentType === "review"
            ? { moderation_status: status, moderation_note: note }
            : { review_status: status, reviewed_at: new Date().toISOString() };
        const { data, error } = await supabase
          .from(table)
          .update(patch)
          .eq("id", contentId)
          .select("id")
          .maybeSingle();
        if (error) throw error;
        if (!data)
          return jsonResponse({ error: "Content was not found." }, 404);
        return jsonResponse({ content: data, status });
      }

      const placeId = body.placeId;
      const status = body.status;
      const confidenceScore = body.confidenceScore ?? null;

      if (
        !placeId ||
        !["published", "needs_review", "archived"].includes(status)
      ) {
        return jsonResponse(
          { error: "placeId and valid status are required." },
          422,
        );
      }

      const { data, error } = await supabase.rpc("review_location_place", {
        p_place_id: placeId,
        p_status: status,
        p_confidence_score: confidenceScore,
      });

      if (error) throw error;
      return jsonResponse({ place: data });
    }

    return jsonResponse({ error: "Method not allowed" }, 405);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown location review error";
    return jsonResponse({ error: message }, 500);
  }
});
