import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import {
  bearerToken,
  isTargetType,
  isUuid,
  randomToken,
  sha256Hex,
  targetIsPublished,
} from "../_shared/invitations.ts";

const MAX_INVITES_PER_DAY = 30;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = getSupabaseAdmin();

  try {
    const token = bearerToken(req);
    const auth = await supabase.auth.getUser(token);
    if (auth.error || !auth.data.user)
      return jsonResponse({ error: "Sign in to create an invitation." }, 401);

    const body = await req.json().catch(() => ({}));
    if (!isTargetType(body.targetType) || !isUuid(body.targetId)) {
      return jsonResponse({ error: "A valid event or place is required." }, 422);
    }

    if (!(await targetIsPublished(supabase, body.targetType, body.targetId))) {
      return jsonResponse({ error: "This destination cannot be shared." }, 404);
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const recent = await supabase
      .from("echoo_invitations")
      .select("id", { count: "exact", head: true })
      .eq("created_by", auth.data.user.id)
      .gte("created_at", since);
    if (recent.error) throw recent.error;
    if (Number(recent.count || 0) >= MAX_INVITES_PER_DAY) {
      return jsonResponse(
        { error: "Invitation limit reached. Try again tomorrow." },
        429,
      );
    }

    const profile = await supabase
      .from("user_onboarding_profiles")
      .select("display_name,username")
      .eq("user_id", auth.data.user.id)
      .maybeSingle();
    if (profile.error) throw profile.error;
    const senderName = String(
      profile.data?.display_name || profile.data?.username || "Someone",
    )
      .trim()
      .slice(0, 80);

    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(
      Date.now() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const created = await supabase
      .from("echoo_invitations")
      .insert({
        token_hash: tokenHash,
        created_by: auth.data.user.id,
        sender_name: senderName || "Someone",
        target_type: body.targetType,
        target_id: body.targetId,
        expires_at: expiresAt,
      })
      .select("id")
      .single();
    if (created.error?.message?.includes("echoo_invitation_daily_limit")) {
      return jsonResponse(
        { error: "Invitation limit reached. Try again tomorrow." },
        429,
      );
    }
    if (created.error) throw created.error;

    const baseUrl = String(
      Deno.env.get("ECHOO_PUBLIC_URL") || "https://echoocity.com/",
    ).replace(/\/?$/, "/");
    const invitationUrl = new URL("invite.html", baseUrl);
    invitationUrl.hash = rawToken;

    return new Response(
      JSON.stringify({
        invitation: {
          id: created.data.id,
          url: invitationUrl.toString(),
          expiresAt,
        },
      }),
      {
        status: 201,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    console.error("invitation-create", error);
    return jsonResponse({ error: "Invitation could not be created." }, 500);
  }
});
