import {
  CORS_HEADERS,
  getSupabaseAdmin,
  isInsideCanadaBounds,
  jsonResponse,
  normalizeCityName,
} from "../_shared/location.ts";

type TierInput = {
  id?: string;
  name: string;
  description?: string;
  priceCents?: number;
  currency?: string;
  capacity?: number;
  saleStatus?: string;
  sortOrder?: number;
};

type EventInput = {
  id?: string;
  title: string;
  description?: string;
  category?: string;
  imageUrl?: string;
  venueName: string;
  address?: string;
  city: string;
  province?: string;
  countryCode?: string;
  latitude: number;
  longitude: number;
  startsAt: string;
  endsAt?: string;
  status?: string;
  tiers?: TierInput[];
};

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get("TICKETING_ADMIN_TOKEN") || Deno.env.get("LOCATION_ADMIN_TOKEN");
  const provided = req.headers.get("x-admin-token") || "";
  return Boolean(expected && provided && expected === provided);
}

function asInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (!isAuthorized(req)) return jsonResponse({ error: "Unauthorized" }, 401);

  const supabase = getSupabaseAdmin();

  try {
    await supabase.rpc("release_expired_ticket_holds");

    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("orders") === "pending") {
        const { data, error } = await supabase
          .from("ticket_orders")
          .select("*, ticketed_events(title,starts_at,venue_name,city), ticket_tiers(name), payment_attempts(*)")
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(80);
        if (error) throw error;
        return jsonResponse({ orders: data || [] });
      }

      const status = url.searchParams.get("status");
      let query = supabase
        .from("ticketed_events")
        .select("*, ticket_tiers(*)")
        .order("created_at", { ascending: false });
      if (status && status !== "all") query = query.eq("status", status);
      const { data, error } = await query.limit(80);
      if (error) throw error;
      return jsonResponse({ events: data || [] });
    }

    if (req.method !== "POST" && req.method !== "PATCH") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const body = await req.json().catch(() => ({})) as EventInput;
    const city = normalizeCityName(body.city);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    const status = body.status || "draft";

    if (!body.title || !body.venueName || !city || !Number.isFinite(latitude) || !Number.isFinite(longitude) || !body.startsAt) {
      return jsonResponse({ error: "title, venueName, supported city, latitude, longitude, and startsAt are required." }, 422);
    }
    if (!["draft", "published", "archived"].includes(status)) {
      return jsonResponse({ error: "Invalid event status." }, 422);
    }
    if (!isInsideCanadaBounds(latitude, longitude)) {
      return jsonResponse({ error: "Ticketed events are Canada-first for launch." }, 422);
    }

    const eventPayload = {
      title: body.title.trim(),
      description: body.description || "",
      category: body.category || "event",
      image_url: body.imageUrl || null,
      venue_name: body.venueName.trim(),
      address: body.address || null,
      city: city.name,
      province: body.province || city.province,
      country_code: (body.countryCode || "CA").toUpperCase(),
      latitude,
      longitude,
      starts_at: new Date(body.startsAt).toISOString(),
      ends_at: body.endsAt ? new Date(body.endsAt).toISOString() : null,
      status,
    };

    const { data: savedEvent, error: eventError } = body.id
      ? await supabase.from("ticketed_events").update(eventPayload).eq("id", body.id).select("*").single()
      : await supabase.from("ticketed_events").insert(eventPayload).select("*").single();
    if (eventError) throw eventError;

    let locationEntityId = savedEvent.location_entity_id;
    const locationPayload = {
      entity_type: "event",
      entity_id: savedEvent.id,
      title: savedEvent.title,
      category: savedEvent.category,
      description: savedEvent.description,
      image_url: savedEvent.image_url,
      starts_at: savedEvent.starts_at,
      ends_at: savedEvent.ends_at,
      popularity_score: 0.76,
      availability_score: 0.88,
      editorial_boost: status === "published" ? 0.2 : 0,
      trust_score: 0.9,
      status: status === "published" ? "published" : status === "archived" ? "archived" : "draft",
      country_code: "CA",
      admin_area_1: savedEvent.province,
      city: savedEvent.city,
      latitude: savedEvent.latitude,
      longitude: savedEvent.longitude,
      metadata: { ticketed_event_id: savedEvent.id, venue_name: savedEvent.venue_name },
    };

    if (locationEntityId) {
      const { error } = await supabase.from("location_entities").update(locationPayload).eq("id", locationEntityId);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("location_entities").insert(locationPayload).select("id").single();
      if (error) throw error;
      locationEntityId = data.id;
      const { error: linkError } = await supabase
        .from("ticketed_events")
        .update({ location_entity_id: locationEntityId })
        .eq("id", savedEvent.id);
      if (linkError) throw linkError;
    }

    const submittedTiers = Array.isArray(body.tiers) ? body.tiers : [];
    const submittedIds = submittedTiers.map((tier) => tier.id).filter(Boolean);
    if (submittedIds.length) {
      await supabase
        .from("ticket_tiers")
        .update({ sale_status: "paused" })
        .eq("event_id", savedEvent.id)
        .not("id", "in", `(${submittedIds.map((id) => `"${id}"`).join(",")})`);
    }

    for (let index = 0; index < submittedTiers.length; index += 1) {
      const tier = submittedTiers[index];
      if (!tier.name) continue;
      const capacity = asInt(tier.capacity, 0);
      const priceCents = asInt(tier.priceCents, 0);
      if (tier.id) {
        const { data: existing, error: tierReadError } = await supabase
          .from("ticket_tiers")
          .select("*")
          .eq("id", tier.id)
          .eq("event_id", savedEvent.id)
          .single();
        if (tierReadError) throw tierReadError;
        const sold = Number(existing.capacity) - Number(existing.remaining_quantity);
        if (capacity < sold) {
          return jsonResponse({ error: `${tier.name} capacity cannot be below tickets already sold or held.` }, 422);
        }
        const { error } = await supabase.from("ticket_tiers").update({
          name: tier.name,
          description: tier.description || null,
          price_cents: priceCents,
          currency: tier.currency || "CAD",
          capacity,
          remaining_quantity: capacity - sold,
          sale_status: tier.saleStatus || "on_sale",
          sort_order: tier.sortOrder ?? index,
        }).eq("id", tier.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("ticket_tiers").insert({
          event_id: savedEvent.id,
          name: tier.name,
          description: tier.description || null,
          price_cents: priceCents,
          currency: tier.currency || "CAD",
          capacity,
          remaining_quantity: capacity,
          sale_status: tier.saleStatus || "on_sale",
          sort_order: tier.sortOrder ?? index,
        });
        if (error) throw error;
      }
    }

    const { data: result, error: resultError } = await supabase
      .from("ticketed_events")
      .select("*, ticket_tiers(*)")
      .eq("id", savedEvent.id)
      .single();
    if (resultError) throw resultError;

    return jsonResponse({ event: result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown event management error";
    return jsonResponse({ error: message }, 500);
  }
});
