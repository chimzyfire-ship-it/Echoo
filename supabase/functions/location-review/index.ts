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
