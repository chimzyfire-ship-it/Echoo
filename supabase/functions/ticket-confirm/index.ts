import { CORS_HEADERS, getSupabaseAdmin, jsonResponse } from "../_shared/location.ts";

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get("TICKETING_ADMIN_TOKEN") || Deno.env.get("LOCATION_ADMIN_TOKEN");
  const provided = req.headers.get("x-admin-token") || "";
  return Boolean(expected && provided && expected === provided);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = getSupabaseAdmin();

  try {
    const body = await req.json().catch(() => ({}));
    const orderId = body.orderId;
    if (!orderId) return jsonResponse({ error: "orderId is required." }, 422);

    const { data: order, error: readError } = await supabase
      .from("ticket_orders")
      .select("id,total_cents,status")
      .eq("id", orderId)
      .single();
    if (readError) throw readError;

    const force = Number(order.total_cents) > 0;
    if (force && !isAuthorized(req)) {
      return jsonResponse({ error: "Admin confirmation is required for paid manual orders." }, 401);
    }

    const { data, error } = await supabase.rpc("confirm_ticket_order", {
      p_order_id: orderId,
      p_force: force,
    });
    if (error) throw error;

    return jsonResponse(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return jsonResponse({ error: message }, 500);
  }
});
