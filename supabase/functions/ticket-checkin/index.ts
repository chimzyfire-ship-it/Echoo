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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (!isAuthorized(req)) return jsonResponse({ error: "Unauthorized" }, 401);
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = getSupabaseAdmin();

  try {
    const body = await req.json().catch(() => ({}));
    const eventId = body.eventId;
    const code = String(body.code || "").trim();
    const operatorLabel = body.operatorLabel || null;
    if (!eventId || !code)
      return jsonResponse({ error: "eventId and code are required." }, 422);

    const { data: ticket, error } = await supabase
      .from("ticket_items")
      .select(
        "*, ticket_orders(buyer_name,buyer_email,status), ticketed_events(title), ticket_tiers(name)",
      )
      .or(`display_code.eq.${code.toUpperCase()},qr_token.eq.${code}`)
      .maybeSingle();
    if (error) throw error;

    if (!ticket) {
      await supabase.from("ticket_checkin_logs").insert({
        event_id: eventId,
        display_code: code,
        status: "invalid",
        operator_label: operatorLabel,
      });
      return jsonResponse(
        { status: "invalid", message: "Ticket not found." },
        404,
      );
    }

    if (ticket.event_id !== eventId) {
      await supabase.from("ticket_checkin_logs").insert({
        ticket_item_id: ticket.id,
        event_id: eventId,
        display_code: ticket.display_code,
        status: "wrong_event",
        operator_label: operatorLabel,
      });
      return jsonResponse(
        {
          status: "wrong_event",
          message: "Ticket belongs to a different event.",
          ticket,
        },
        409,
      );
    }

    if (ticket.checked_in_at) {
      await supabase.from("ticket_checkin_logs").insert({
        ticket_item_id: ticket.id,
        event_id: eventId,
        display_code: ticket.display_code,
        status: "already_used",
        checked_in_at: ticket.checked_in_at,
        operator_label: operatorLabel,
      });
      return jsonResponse(
        {
          status: "already_used",
          message: "Ticket was already checked in.",
          ticket,
        },
        409,
      );
    }

    const checkedInAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabase
      .from("ticket_items")
      .update({ checked_in_at: checkedInAt })
      .eq("id", ticket.id)
      .select(
        "*, ticket_orders(buyer_name,buyer_email,status), ticketed_events(title), ticket_tiers(name)",
      )
      .single();
    if (updateError) throw updateError;

    await supabase.from("ticket_checkin_logs").insert({
      ticket_item_id: updated.id,
      event_id: eventId,
      display_code: updated.display_code,
      status: "valid",
      checked_in_at: checkedInAt,
      operator_label: operatorLabel,
    });

    return jsonResponse({
      status: "valid",
      message: "Ticket checked in.",
      ticket: updated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return jsonResponse({ error: message }, 500);
  }
});
