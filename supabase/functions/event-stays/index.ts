import {
  CORS_HEADERS,
  SUPPORTED_CANADA_CITIES,
  getSupabaseAdmin,
  haversineMeters,
  jsonResponse,
} from "../_shared/location.ts";

function timezoneForCity(cityName: string) {
  return (
    SUPPORTED_CANADA_CITIES.find((city) => city.name === cityName)?.timezone ||
    "America/Toronto"
  );
}

function scoreStay(stay: any, event: any) {
  const distanceMeters = haversineMeters(
    Number(event.latitude),
    Number(event.longitude),
    Number(stay.latitude),
    Number(stay.longitude),
  );
  const distanceScore = Math.max(0, 1 - distanceMeters / 6000);
  const ratingScore = Math.min(Number(stay.rating || 0) / 5, 1);
  const priceScore = stay.nightly_rate_cents
    ? Math.max(0, 1 - Number(stay.nightly_rate_cents) / 45000)
    : 0.45;
  const startsAt = event.starts_at ? new Date(event.starts_at) : null;
  const eventHour = startsAt
    ? Number(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: timezoneForCity(event.city),
          hour: "numeric",
          hour12: false,
        }).format(startsAt),
      )
    : 20;
  const amenities = Array.isArray(stay.amenities)
    ? stay.amenities.join(" ").toLowerCase()
    : "";
  const lateBoost =
    eventHour >= 18 && /late check-in|transit|walkable/.test(amenities)
      ? 0.12
      : 0;
  const score =
    distanceScore * 0.42 +
    ratingScore * 0.28 +
    priceScore * 0.18 +
    lateBoost +
    0.04;
  return { distanceMeters, score };
}

function stayReason(stay: any, distanceMeters: number, index: number) {
  const km = Math.max(0.1, distanceMeters / 1000).toFixed(1);
  const amenities = Array.isArray(stay.amenities) ? stay.amenities : [];
  if (index === 0) {
    return `Best stay match: ${km} km from the venue with ${amenities.slice(0, 2).join(" and ") || "a strong event-night fit"}.`;
  }
  if (Number(stay.nightly_rate_cents || 0) < 19000) {
    return `Good value pick: close enough for the event without pushing the stay budget too high.`;
  }
  if (amenities.includes("quiet")) {
    return `Calmer backup: better for guests who want an easier reset after the event.`;
  }
  return `Solid nearby backup with a practical route back after the event.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "GET")
    return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = getSupabaseAdmin();

  try {
    const url = new URL(req.url);
    const eventId = url.searchParams.get("eventId");
    if (!eventId) return jsonResponse({ error: "eventId is required." }, 422);

    let { data: event, error: eventError } = await supabase
      .from("ticketed_events")
      .select("*")
      .eq("id", eventId)
      .maybeSingle();
    if (eventError) throw eventError;

    if (!event) {
      const fallback = await supabase
        .from("ticketed_events")
        .select("*")
        .eq("location_entity_id", eventId)
        .maybeSingle();
      if (fallback.error) throw fallback.error;
      event = fallback.data;
    }

    if (!event) return jsonResponse({ error: "Event not found." }, 404);

    const { data, error } = await supabase
      .from("event_stays")
      .select("*")
      .eq("status", "published")
      .eq("country_code", "CA")
      .eq("city", event.city)
      .limit(24);
    if (error) throw error;

    const stays = (data || [])
      .map((stay: any) => {
        const scored = scoreStay(stay, event);
        return { ...stay, ...scored };
      })
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 4)
      .map((stay: any, index: number) => ({
        id: stay.id,
        hotelName: stay.hotel_name,
        description: stay.description,
        imageUrl: stay.image_url,
        address: stay.address,
        city: stay.city,
        province: stay.province,
        latitude: stay.latitude,
        longitude: stay.longitude,
        nightlyRateCents: stay.nightly_rate_cents,
        currency: stay.currency,
        rating: stay.rating,
        amenities: stay.amenities || [],
        bookingUrl: stay.booking_url,
        distanceMeters: Math.round(stay.distanceMeters),
        matchScore: Number(stay.score.toFixed(3)),
        why: stayReason(stay, stay.distanceMeters, index),
      }));

    return jsonResponse({
      event: {
        id: event.id,
        title: event.title,
        city: event.city,
        venueName: event.venue_name,
      },
      summary: stays.length
        ? `Smart stay picks near ${event.venue_name || event.title}.`
        : `No stay partners are loaded near this event yet.`,
      stays,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return jsonResponse({ error: message }, 500);
  }
});
