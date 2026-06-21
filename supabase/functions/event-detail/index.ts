import { CORS_HEADERS, getSupabaseAdmin, jsonResponse } from "../_shared/location.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = getSupabaseAdmin();

  try {
    await supabase.rpc("release_expired_ticket_holds");

    const url = new URL(req.url);
    const id = url.searchParams.get("id");
    if (!id) return jsonResponse({ error: "id is required." }, 422);

    let { data: event, error } = await supabase
      .from("ticketed_events")
      .select("*, ticket_tiers(*)")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;

    if (!event) {
      const fallback = await supabase
        .from("ticketed_events")
        .select("*, ticket_tiers(*)")
        .eq("location_entity_id", id)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      event = fallback.data;
    }

    if (!event) {
      const fallback = await supabase
        .from("location_entities")
        .select("*")
        .eq("id", id)
        .eq("status", "published")
        .eq("country_code", "CA")
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      if (!fallback.data) return jsonResponse({ error: "Event not found." }, 404);
      return jsonResponse({
        event: {
          id: fallback.data.id,
          location_entity_id: fallback.data.id,
          title: fallback.data.title,
          description: fallback.data.description,
          category: fallback.data.category || fallback.data.entity_type || "event",
          image_url: fallback.data.image_url,
          venue_name: fallback.data.metadata?.venue_name || fallback.data.title,
          city: fallback.data.city,
          province: fallback.data.admin_area_1,
          country_code: fallback.data.country_code,
          latitude: fallback.data.latitude,
          longitude: fallback.data.longitude,
          starts_at: fallback.data.starts_at,
          status: "published",
        },
        tiers: [],
      });
    }

    if (event.status !== "published" || event.country_code !== "CA") {
      return jsonResponse({ error: "Event not found." }, 404);
    }

    const tiers = (event.ticket_tiers || []).sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    delete event.ticket_tiers;

    return jsonResponse({ event, tiers });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown event detail error";
    return jsonResponse({ error: message }, 500);
  }
});
