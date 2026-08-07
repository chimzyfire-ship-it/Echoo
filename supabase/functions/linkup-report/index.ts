// Link Up · report
//
// POST { targetType: 'match'|'message'|'user', targetId, reason, details? }
//   Mirrors discovery-community's report branch: validate enums, enforce the
//   per-user report cap via linkup_action_events, insert into linkup_reports,
//   and append the 'report' action event. Severe reasons (harassment, hate)
//   also auto-block the reporter from the reported user.

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

const TARGET_TYPES = new Set(["match", "message", "user"]);
const REASONS = new Set(["spam", "harassment", "hate", "misinformation", "rights", "other"]);
const SEVERE_REASONS = new Set(["harassment", "hate"]);

interface ReportPayload {
  targetType?: unknown;
  targetId?: unknown;
  reason?: unknown;
  details?: unknown;
}

export async function applySymmetricBlock(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userA: string,
  userB: string,
): Promise<void> {
  if (userA === userB) return;
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
  await supabase.from("linkup_blocks").upsert(
    { user_a: lo, user_b: hi },
    { onConflict: "user_a,user_b" },
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);
  if (!LINKUP_ENABLED) return disabledResponse();

  try {
    const body = (await req.json().catch(() => ({}))) as ReportPayload;
    const targetType = String(body.targetType || "").trim();
    const targetId = String(body.targetId || "").trim();
    const reason = String(body.reason || "").trim();
    const detailsRaw = body.details ? String(body.details).trim() : "";
    const details = detailsRaw.slice(0, 1000);

    if (!TARGET_TYPES.has(targetType))
      return jsonResponse({ error: "Invalid target type" }, 422);
    if (!isUuid(targetId))
      return jsonResponse({ error: "Invalid target id" }, 422);
    if (!REASONS.has(reason))
      return jsonResponse({ error: "Invalid reason" }, 422);

    const supabase = getSupabaseAdmin();
    const { data: auth, error: authError } = await supabase.auth.getUser(
      bearerToken(req),
    );
    if (authError || !auth.user)
      return jsonResponse({ error: "Sign in to report" }, 401);
    const userId = auth.user.id;

    if (!(await checkRateLimit(supabase, userId, "report")))
      return jsonResponse({ error: "Report limit reached for today" }, 429);

    const { error: insertError } = await supabase.from("linkup_reports").insert({
      reporter_user_id: userId,
      target_type: targetType,
      target_id: targetId,
      reason,
      details: details || null,
      status: "open",
    });
    if (insertError) throw insertError;
    await recordAction(supabase, userId, "report", targetId);

    // Auto-block on severe reasons when we can resolve a counterparty user.
    if (SEVERE_REASONS.has(reason)) {
      let counterpartyId: string | null = null;
      if (targetType === "user") {
        counterpartyId = targetId;
      } else if (targetType === "match") {
        const { data } = await supabase
          .from("linkup_match_members")
          .select("user_id")
          .eq("match_id", targetId)
          .neq("user_id", userId)
          .limit(1)
          .maybeSingle();
        counterpartyId = data?.user_id ?? null;
      } else if (targetType === "message") {
        const { data } = await supabase
          .from("linkup_messages")
          .select("sender_id, conversation_id")
          .eq("id", targetId)
          .maybeSingle();
        if (data?.sender_id) counterpartyId = data.sender_id;
      }
      if (counterpartyId) {
        await applySymmetricBlock(supabase, userId, counterpartyId);
        // End any active match between them.
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
            .eq("status", "accepted");
        }
      }
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    console.error("linkup-report failed", error);
    return jsonResponse({ error: "Could not file report" }, 500);
  }
});
