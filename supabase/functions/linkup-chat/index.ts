// Link Up · chat history
//
// GET ?conversationId=<uuid>
//   Returns the most recent 100 messages (oldest→newest) for a conversation
//   the caller is a member of. Message INSERTS happen client-side (gated by
//   RLS — see migration 202608070005) for low latency; this endpoint only
//   handles history + pagination.

import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import {
  LINKUP_ENABLED,
  bearerToken,
  isUuid,
  disabledResponse,
} from "../_shared/linkup.ts";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "GET")
    return jsonResponse({ error: "Method not allowed" }, 405);
  if (!LINKUP_ENABLED) return disabledResponse();

  try {
    const conversationId = url.searchParams.get("conversationId") || "";
    if (!isUuid(conversationId))
      return jsonResponse({ error: "Invalid conversationId" }, 422);

    const supabase = getSupabaseAdmin();
    const { data: auth, error: authError } = await supabase.auth.getUser(
      bearerToken(req),
    );
    if (authError || !auth.user)
      return jsonResponse({ error: "Sign in to use Link Up" }, 401);
    const userId = auth.user.id;

    // Verify membership via the conversation → match → members path.
    const { data: conv, error: convError } = await supabase
      .from("linkup_conversations")
      .select("id, match_id, expires_at")
      .eq("id", conversationId)
      .maybeSingle();
    if (convError || !conv)
      return jsonResponse({ error: "Conversation not found" }, 404);

    const { data: membership } = await supabase
      .from("linkup_match_members")
      .select("user_id")
      .eq("match_id", conv.match_id)
      .eq("user_id", userId)
      .maybeSingle();
    if (!membership)
      return jsonResponse({ error: "Not a member of this conversation" }, 403);

    const { data: messages, error: msgError } = await supabase
      .from("linkup_messages")
      .select("id, sender_id, body, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(100);
    if (msgError) throw msgError;

    return jsonResponse({
      ok: true,
      conversation: {
        id: conv.id,
        expiresAt: conv.expires_at,
        writable: new Date(conv.expires_at).getTime() > Date.now(),
      },
      messages: messages ?? [],
    });
  } catch (error) {
    console.error("linkup-chat failed", error);
    return jsonResponse({ error: "Could not load chat" }, 500);
  }
});
