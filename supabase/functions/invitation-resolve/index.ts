import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import { sha256Hex, targetIsPublished } from "../_shared/invitations.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = getSupabaseAdmin();

  try {
    const body = await req.json().catch(() => ({}));
    const rawToken = String(body.token || "").trim();
    if (!/^[A-Za-z0-9_-]{43}$/.test(rawToken)) {
      return jsonResponse({ error: "Invitation unavailable." }, 404);
    }

    const tokenHash = await sha256Hex(rawToken);
    const result = await supabase
      .from("echoo_invitations")
      .select("id,sender_name,target_type,target_id,expires_at")
      .eq("token_hash", tokenHash)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) return jsonResponse({ error: "Invitation unavailable." }, 404);

    if (
      !(await targetIsPublished(
        supabase,
        result.data.target_type,
        result.data.target_id,
      ))
    ) {
      return jsonResponse({ error: "Invitation unavailable." }, 404);
    }

    return new Response(
      JSON.stringify({
        invitation: {
          id: result.data.id,
          senderName: result.data.sender_name,
          targetType: result.data.target_type,
          targetId: result.data.target_id,
          expiresAt: result.data.expires_at,
        },
      }),
      {
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("invitation-resolve", error);
    return jsonResponse({ error: "Invitation unavailable." }, 500);
  }
});
