// Link Up · block
//
// POST { userId }  — blocks the caller and the given user symmetrically.
// Immediately ends any accepted match between them so neither sees the other
// again. Blocks are permanent for matching purposes (no unblock in v1).

import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import {
  LINKUP_ENABLED,
  bearerToken,
  isUuid,
  checkRateLimit,
  recordAction,
  disabledResponse,
} from "../_shared/linkup.ts";

interface BlockPayload {
  userId?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);
  if (!LINKUP_ENABLED) return disabledResponse();

  try {
    const body = (await req.json().catch(() => ({}))) as BlockPayload;
    const targetUserId = String(body.userId || "").trim();
    if (!isUuid(targetUserId))
      return jsonResponse({ error: "Invalid user id" }, 422);

    const supabase = getSupabaseAdmin();
    const { data: auth, error: authError } = await supabase.auth.getUser(
      bearerToken(req),
    );
    if (authError || !auth.user)
      return jsonResponse({ error: "Sign in to block" }, 401);
    const userId = auth.user.id;

    if (targetUserId === userId)
      return jsonResponse({ error: "Cannot block yourself" }, 422);

    if (!(await checkRateLimit(supabase, userId, "block")))
      return jsonResponse({ error: "Slow down" }, 429);

    const [lo, hi] = userId < targetUserId ? [userId, targetUserId] : [targetUserId, userId];
    const { error: blockError } = await supabase.from("linkup_blocks").upsert(
      { user_a: lo, user_b: hi },
      { onConflict: "user_a,user_b" },
    );
    if (blockError) throw blockError;
    await recordAction(supabase, userId, "block", targetUserId);

    // End any active/accepted match between them.
    const { data: mine } = await supabase
      .from("linkup_match_members")
      .select("match_id")
      .eq("user_id", userId);
    if (mine && mine.length) {
      await supabase
        .from("linkup_matches")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .in(
          "id",
          mine.map((m: { match_id: string }) => m.match_id),
        )
        .in("status", ["accepted", "pending"]);
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("linkup-block failed", error);
    return jsonResponse({ error: "Could not block user" }, 500);
  }
});
