import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";

function isAuthorized(req: Request): boolean {
  const expected =
    Deno.env.get("TICKETING_ADMIN_TOKEN") ||
    Deno.env.get("LOCATION_ADMIN_TOKEN");
  const provided = req.headers.get("x-admin-token") || "";
  return Boolean(expected && provided && expected === provided);
}

function toInt(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

async function loadOps(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  eventId: string,
) {
  await supabase.rpc("release_expired_ticket_holds");

  const { data: event, error: eventError } = await supabase
    .from("ticketed_events")
    .select("*")
    .eq("id", eventId)
    .single();
  if (eventError) throw eventError;

  const [
    { data: tiers, error: tiersError },
    { data: orders, error: ordersError },
    { data: tickets, error: ticketsError },
    { data: holds, error: holdsError },
  ] = await Promise.all([
    supabase
      .from("ticket_tiers")
      .select("*")
      .eq("event_id", eventId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("ticket_orders")
      .select("*, ticket_tiers(name), payment_attempts(*)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(300),
    supabase
      .from("ticket_items")
      .select(
        "*, ticket_orders(buyer_name,buyer_email,status,total_cents,currency,created_at), ticket_tiers(name)",
      )
      .eq("event_id", eventId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("ticket_holds")
      .select("*")
      .eq("event_id", eventId)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString()),
  ]);
  if (tiersError) throw tiersError;
  if (ordersError) throw ordersError;
  if (ticketsError) throw ticketsError;
  if (holdsError) throw holdsError;

  const ticketRows = tickets || [];
  const orderRows = orders || [];
  const holdRows = holds || [];
  const metrics = {
    confirmedTickets: ticketRows.length,
    checkedIn: ticketRows.filter((ticket: any) => ticket.checked_in_at).length,
    pendingOrders: orderRows.filter((order: any) => order.status === "pending")
      .length,
    revenueCents: orderRows
      .filter((order: any) => order.status === "confirmed")
      .reduce(
        (sum: number, order: any) => sum + Number(order.total_cents || 0),
        0,
      ),
  };

  const enrichedTiers = (tiers || []).map((tier: any) => {
    const confirmed = ticketRows.filter(
      (ticket: any) => ticket.tier_id === tier.id,
    ).length;
    const activeHeld = holdRows
      .filter((hold: any) => hold.tier_id === tier.id)
      .reduce((sum: number, hold: any) => sum + Number(hold.quantity || 0), 0);
    const pending = orderRows
      .filter(
        (order: any) => order.tier_id === tier.id && order.status === "pending",
      )
      .reduce(
        (sum: number, order: any) => sum + Number(order.quantity || 0),
        0,
      );
    return { ...tier, confirmed, activeHeld, pending };
  });

  return {
    event,
    tiers: enrichedTiers,
    orders: orderRows,
    attendees: ticketRows,
    metrics,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (!isAuthorized(req)) return jsonResponse({ error: "Unauthorized" }, 401);

  const supabase = getSupabaseAdmin();

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const eventId = url.searchParams.get("eventId");
      if (!eventId) return jsonResponse({ error: "eventId is required." }, 422);
      return jsonResponse(await loadOps(supabase, eventId));
    }

    if (req.method !== "PATCH" && req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action;
    const eventId = body.eventId;
    if (!eventId) return jsonResponse({ error: "eventId is required." }, 422);

    if (action === "event-status") {
      const status = body.status;
      if (!["draft", "published", "archived"].includes(status))
        return jsonResponse({ error: "Invalid event status." }, 422);
      const { data: event, error } = await supabase
        .from("ticketed_events")
        .update({ status })
        .eq("id", eventId)
        .select("id,location_entity_id")
        .single();
      if (error) throw error;
      if (event.location_entity_id) {
        const locationStatus =
          status === "published"
            ? "published"
            : status === "archived"
              ? "archived"
              : "draft";
        const { error: locationError } = await supabase
          .from("location_entities")
          .update({ status: locationStatus })
          .eq("id", event.location_entity_id);
        if (locationError) throw locationError;
      }
    } else if (action === "tier-update") {
      const tierId = body.tierId;
      const capacity = toInt(body.capacity);
      const saleStatus = body.saleStatus;
      if (!tierId || !["on_sale", "paused", "sold_out"].includes(saleStatus)) {
        return jsonResponse(
          { error: "tierId and valid saleStatus are required." },
          422,
        );
      }
      const ops = await loadOps(supabase, eventId);
      const tier = ops.tiers.find((item: any) => item.id === tierId);
      if (!tier) return jsonResponse({ error: "Tier not found." }, 404);
      const committed =
        Number(tier.confirmed || 0) + Number(tier.activeHeld || 0);
      if (capacity < committed) {
        return jsonResponse(
          {
            error:
              "Capacity cannot be below confirmed tickets plus active holds.",
          },
          422,
        );
      }
      const remaining = Math.max(0, capacity - committed);
      const { error } = await supabase
        .from("ticket_tiers")
        .update({
          capacity,
          remaining_quantity: remaining,
          sale_status: saleStatus,
        })
        .eq("id", tierId)
        .eq("event_id", eventId);
      if (error) throw error;
    } else if (action === "confirm-order") {
      const orderId = body.orderId;
      if (!orderId) return jsonResponse({ error: "orderId is required." }, 422);
      const { error } = await supabase.rpc("confirm_ticket_order", {
        p_order_id: orderId,
        p_force: true,
      });
      if (error) throw error;
    } else {
      return jsonResponse({ error: "Unknown action." }, 422);
    }

    return jsonResponse(await loadOps(supabase, eventId));
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return jsonResponse({ error: message }, 500);
  }
});
