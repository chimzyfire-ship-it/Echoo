import { CORS_HEADERS, getSupabaseAdmin, jsonResponse } from "../_shared/location.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = getSupabaseAdmin();

  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("sessionId");
    const email = url.searchParams.get("email");
    if (!sessionId && !email) return jsonResponse({ tickets: [] });

    let ordersQuery = supabase
      .from("ticket_orders")
      .select("id")
      .eq("status", "confirmed")
      .order("created_at", { ascending: false });

    if (sessionId && email) {
      ordersQuery = ordersQuery.or(`session_id.eq.${sessionId},buyer_email.eq.${email}`);
    } else if (sessionId) {
      ordersQuery = ordersQuery.eq("session_id", sessionId);
    } else {
      ordersQuery = ordersQuery.eq("buyer_email", email);
    }

    const { data: orders, error: ordersError } = await ordersQuery.limit(100);
    if (ordersError) throw ordersError;
    const orderIds = (orders || []).map((order) => order.id);
    if (!orderIds.length) return jsonResponse({ tickets: [] });

    const { data, error } = await supabase
      .from("ticket_items")
      .select(`
        *,
        ticket_orders(id,buyer_name,buyer_email,session_id,quantity,total_cents,currency,status),
        ticketed_events(id,title,venue_name,city,province,starts_at,image_url),
        ticket_tiers(id,name,price_cents,currency)
      `)
      .in("order_id", orderIds)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw error;

    return jsonResponse({ tickets: data || [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown ticket lookup error";
    return jsonResponse({ error: message }, 500);
  }
});
