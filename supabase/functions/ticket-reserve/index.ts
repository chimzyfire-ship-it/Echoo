import { CORS_HEADERS, getSupabaseAdmin, jsonResponse } from "../_shared/location.ts";

type ReservePayload = {
  eventId?: string;
  tierId?: string;
  quantity?: number;
  buyerEmail?: string;
  buyerName?: string;
  sessionId?: string;
};

function paymentProvider() {
  if (Deno.env.get("STRIPE_SECRET_KEY")) return "stripe";
  return "manual";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = getSupabaseAdmin();

  try {
    const body = await req.json().catch(() => ({})) as ReservePayload;
    const quantity = Math.max(1, Math.min(Math.round(Number(body.quantity || 1)), 10));
    if (!body.eventId || !body.tierId) return jsonResponse({ error: "eventId and tierId are required." }, 422);

    const { data, error } = await supabase.rpc("reserve_ticket_order", {
      p_event_id: body.eventId,
      p_tier_id: body.tierId,
      p_quantity: quantity,
      p_buyer_email: body.buyerEmail || null,
      p_buyer_name: body.buyerName || null,
      p_session_id: body.sessionId || null,
      p_payment_provider: paymentProvider(),
    });
    if (error) throw error;

    const order = data.order;
    let confirmed = null;
    if (Number(order.total_cents) === 0) {
      const confirmation = await supabase.rpc("confirm_ticket_order", {
        p_order_id: order.id,
        p_force: true,
      });
      if (confirmation.error) throw confirmation.error;
      confirmed = confirmation.data;
    }

    return jsonResponse({
      ...data,
      confirmed,
      paymentGateway: {
        provider: paymentProvider(),
        status: Number(order.total_cents) === 0 ? "paid" : "not_configured",
        checkoutUrl: null,
        providerReference: null,
        message: Number(order.total_cents) === 0
          ? "Free RSVP confirmed."
          : "Payment provider is not connected yet. Owner/admin can manually confirm this order.",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return jsonResponse({ error: message }, 500);
  }
});
