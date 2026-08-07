// Link Up · match response + end
//
// POST { action: 'respond', matchId, response: 'accepted' | 'declined' }
//   - Records the caller's response. If both members accepted, flips the match
//     to 'accepted' and opens a conversation (expires at now + grace window).
//   - If either declined, flips to 'declined'.
//
// POST { action: 'end', matchId }
//   - Either member can end an accepted match. Sets status 'ended' and the
//     conversation expiry to now + grace (so chat history is briefly readable
//     but no longer writable).

import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import {
  LINKUP_ENABLED,
  MATCH_FUSE_MINUTES,
  CONVERSATION_GRACE_HOURS,
  bearerToken,
  isUuid,
  checkRateLimit,
  recordAction,
  disabledResponse,
} from "../_shared/linkup.ts";

interface MatchPayload {
  action?: unknown;
  matchId?: unknown;
  response?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);
  if (!LINKUP_ENABLED) return disabledResponse();

  try {
    const body = (await req.json().catch(() => ({}))) as MatchPayload;
    const action = String(body.action || "").trim();
    const matchId = String(body.matchId || "").trim();

    if (!["respond", "end"].includes(action))
      return jsonResponse({ error: "Invalid action" }, 422);
    if (!isUuid(matchId))
      return jsonResponse({ error: "Invalid matchId" }, 422);

    const supabase = getSupabaseAdmin();
    const { data: auth, error: authError } = await supabase.auth.getUser(
      bearerToken(req),
    );
    if (authError || !auth.user)
      return jsonResponse({ error: "Sign in to use Link Up" }, 401);
    const userId = auth.user.id;

    // Verify the caller is a member of this match and load match + members.
    const { data: match, error: matchError } = await supabase
      .from("linkup_matches")
      .select("id, status, expires_at, created_at")
      .eq("id", matchId)
      .maybeSingle();
    if (matchError || !match)
      return jsonResponse({ error: "Match not found" }, 404);

    const { data: members, error: membersError } = await supabase
      .from("linkup_match_members")
      .select("user_id, response, responded_at")
      .eq("match_id", matchId);
    if (membersError) throw membersError;
    const me = (members ?? []).find((m) => m.user_id === userId);
    if (!me)
      return jsonResponse({ error: "Not a member of this match" }, 403);

    if (action === "end") {
      if (!(await checkRateLimit(supabase, userId, "end")))
        return jsonResponse({ error: "Slow down" }, 429);
      await supabase
        .from("linkup_matches")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("id", matchId);
      // Conversation gets a grace window then becomes read-only/expired.
      await supabase
        .from("linkup_conversations")
        .update({
          expires_at: new Date(
            Date.now() + CONVERSATION_GRACE_HOURS * 60 * 60_000,
          ).toISOString(),
        })
        .eq("match_id", matchId);
      await recordAction(supabase, userId, "end", matchId);
      return jsonResponse({ ok: true, status: "ended" });
    }

    // ── respond ─────────────────────────────────────────────────────────
    const response = String(body.response || "").trim();
    if (!["accepted", "declined"].includes(response))
      return jsonResponse({ error: "Invalid response" }, 422);

    const ratelimitAction = response === "accepted" ? "match_accept" : "match_decline";
    if (!(await checkRateLimit(supabase, userId, ratelimitAction)))
      return jsonResponse({ error: "Slow down" }, 429);

    // Match must be pending and within its fuse.
    if (match.status !== "pending")
      return jsonResponse({ ok: true, status: match.status });
    if (new Date(match.expires_at).getTime() < Date.now()) {
      await supabase
        .from("linkup_matches")
        .update({ status: "expired" })
        .eq("id", matchId);
      return jsonResponse({ ok: true, status: "expired" });
    }

    await supabase
      .from("linkup_match_members")
      .update({ response, responded_at: new Date().toISOString() })
      .eq("match_id", matchId)
      .eq("user_id", userId);
    await recordAction(supabase, userId, ratelimitAction, matchId);

    // Reload members to evaluate the joint state.
    const { data: after } = await supabase
      .from("linkup_match_members")
      .select("response")
      .eq("match_id", matchId);
    const responses = (after ?? []).map((m) => m.response);
    const anyDeclined = responses.includes("declined");
    const allAccepted = responses.length === 2 && responses.every((r) => r === "accepted");

    if (anyDeclined) {
      await supabase
        .from("linkup_matches")
        .update({ status: "declined", ended_at: new Date().toISOString() })
        .eq("id", matchId);
      return jsonResponse({ ok: true, status: "declined" });
    }

    if (allAccepted) {
      await supabase
        .from("linkup_matches")
        .update({ status: "accepted" })
        .eq("id", matchId);
      // Open the conversation (idempotent via unique index on match_id).
      const convExpiry = new Date(
        Date.now() + CONVERSATION_GRACE_HOURS * 60 * 60_000 + MATCH_FUSE_MINUTES * 60_000,
      ).toISOString();
      await supabase.from("linkup_conversations").upsert(
        { match_id: matchId, expires_at: convExpiry },
        { onConflict: "match_id" },
      );
      return jsonResponse({ ok: true, status: "accepted" });
    }

    return jsonResponse({ ok: true, status: "pending" });
  } catch (error) {
    console.error("linkup-match failed", error);
    return jsonResponse({ error: "Could not update match" }, 500);
  }
});
