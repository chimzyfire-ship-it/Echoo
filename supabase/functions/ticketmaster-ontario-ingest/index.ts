import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import {
  assertIngestionAuthorized,
  finishIngestionRun,
  isInsideOntario,
  ONTARIO_CITY_BUCKETS,
  startIngestionRun,
  TICKETMASTER_CATEGORY_BUCKETS,
} from "../_shared/ontario-ingestion.ts";

type Payload = {
  cities?: string[];
  categories?: string[];
  size?: number;
  startDateTime?: string;
  endDateTime?: string;
};

function cleanText(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function optionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function eventWindow(payload: Payload) {
  const start = payload.startDateTime
    ? new Date(payload.startDateTime)
    : new Date();
  const end = payload.endDateTime
    ? new Date(payload.endDateTime)
    : new Date(Date.now() + 1000 * 60 * 60 * 24 * 45);
  return {
    startDateTime: start.toISOString().replace(/\.\d{3}Z$/, "Z"),
    endDateTime: end.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

function segmentForCategory(category: string) {
  const normalized = category.toLowerCase();
  if (normalized === "music") return "Music";
  if (normalized === "sports") return "Sports";
  if (normalized === "theatre") return "Arts & Theatre";
  if (normalized === "arts") return "Arts & Theatre";
  if (normalized === "family") return "Family";
  if (normalized === "comedy") return "Comedy";
  return category;
}

function priceLabel(event: any) {
  const price = event?.priceRanges?.[0];
  if (!price) return "See tickets";
  const min = Math.round(Number(price.min || 0));
  const max = Math.round(Number(price.max || 0));
  if (!min && !max) return "See tickets";
  if (min === max) return `${price.currency || "CAD"} ${min}`;
  return `${price.currency || "CAD"} ${min}-${max}`;
}

function isUsefulEvent(event: any) {
  const title = cleanText(event?.name).toLowerCase();
  if (/combo ticket|weekend pass|parking|add-on|package/.test(title)) {
    return false;
  }

  const startsAt = cleanText(
    event?.dates?.start?.dateTime || event?.dates?.start?.localDate,
  );
  if (!startsAt) return false;

  const startsAtMs = new Date(startsAt).getTime();
  if (!Number.isFinite(startsAtMs)) return false;

  return startsAtMs >= Date.now() - 1000 * 60 * 60 * 3;
}

async function fetchTicketmasterEvents(input: {
  apiKey: string;
  city: string;
  category: string;
  size: number;
  startDateTime: string;
  endDateTime: string;
}) {
  const url = new URL("https://app.ticketmaster.com/discovery/v2/events.json");
  url.searchParams.set("apikey", input.apiKey);
  url.searchParams.set("countryCode", "CA");
  url.searchParams.set("stateCode", "ON");
  url.searchParams.set("city", input.city);
  url.searchParams.set(
    "classificationName",
    segmentForCategory(input.category),
  );
  url.searchParams.set("size", String(input.size));
  url.searchParams.set("sort", "date,asc");
  url.searchParams.set("startDateTime", input.startDateTime);
  url.searchParams.set("endDateTime", input.endDateTime);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Ticketmaster ${input.city}/${input.category} failed: ${response.status}`,
    );
  }
  const payload = await response.json();
  return (payload?._embedded?.events || []).filter(isUsefulEvent);
}

async function upsertEvent(supabase: any, event: any, category: string) {
  const venue = event?._embedded?.venues?.[0] || {};
  const lat = optionalNumber(venue?.location?.latitude);
  const lng = optionalNumber(venue?.location?.longitude);
  const city = cleanText(venue?.city?.name, "Ontario");
  const startsAt = cleanText(
    event?.dates?.start?.dateTime || event?.dates?.start?.localDate,
  );
  const sourceId = cleanText(event.id || event.url || event.name);
  if (!sourceId || !event?.name) {
    return { imported: false, reason: "missing_id" };
  }

  const { data, error } = await supabase
    .from("ontario_events")
    .upsert(
      {
        title: cleanText(event.name, "Ticketmaster event"),
        description: cleanText(event.info || event.pleaseNote),
        starts_at: startsAt || null,
        ends_at: cleanText(event?.dates?.end?.dateTime) || null,
        category,
        price_label: priceLabel(event),
        ticket_url: event.url,
        source_provider: "ticketmaster",
        source_id: sourceId,
        status: "published",
        last_seen_at: new Date().toISOString(),
      },
      { onConflict: "source_provider,source_id" },
    )
    .select("id")
    .single();
  if (error) throw error;

  if (lat !== undefined && lng !== undefined && isInsideOntario(lat, lng)) {
    const image =
      event?.images?.find((item: any) => item.ratio === "16_9") ||
      event?.images?.[0];
    const address = [
      venue?.address?.line1,
      venue?.city?.name,
      venue?.state?.stateCode,
    ]
      .filter(Boolean)
      .join(", ");

    const { error: entityError } = await supabase
      .from("location_entities")
      .upsert(
        {
          entity_type: "event",
          entity_id: data.id,
          title: cleanText(event.name, "Ticketmaster event"),
          category,
          description: cleanText(event.info || event.pleaseNote),
          image_url: image?.url,
          starts_at: startsAt || null,
          ends_at: cleanText(event?.dates?.end?.dateTime) || null,
          popularity_score: 0.64,
          availability_score: 0.84,
          editorial_boost: 0,
          trust_score: 0.82,
          status: "published",
          country_code: "CA",
          admin_area_1: "ON",
          city,
          latitude: lat,
          longitude: lng,
          source_provider: "ticketmaster",
          source_provider_id: sourceId,
          metadata: {
            ontario_event_id: data.id,
            venue_name: cleanText(venue.name),
            address,
            ticket_url: event.url,
            source: "ticketmaster",
          },
        },
        { onConflict: "source_provider,source_provider_id" },
      );
    if (entityError) throw entityError;
  }

  return { imported: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const unauthorized = assertIngestionAuthorized(req);
  if (unauthorized) return unauthorized;

  const apiKey = Deno.env.get("TICKETMASTER_API_KEY");
  if (!apiKey) {
    return jsonResponse(
      { error: "TICKETMASTER_API_KEY is not configured." },
      400,
    );
  }

  const supabase = getSupabaseAdmin();
  let runId: string | null = null;

  try {
    const payload = (await req.json().catch(() => ({}))) as Payload;
    const cities =
      (payload.cities?.length ? payload.cities : ONTARIO_CITY_BUCKETS)
        .slice(0, 40);
    const categories = (payload.categories?.length
      ? payload.categories
      : TICKETMASTER_CATEGORY_BUCKETS).slice(0, 12);
    const size = Math.max(1, Math.min(Number(payload.size || 20), 50));
    const window = eventWindow(payload);

    runId = await startIngestionRun(supabase, {
      sourceName: "ticketmaster",
      sourceType: "ticketmaster",
      metadata: { cities, categories, size, ...window },
    });

    const summary = {
      queries: 0,
      seen: 0,
      imported: 0,
      skipped: 0,
      errors: [] as string[],
    };
    for (const city of cities) {
      for (const category of categories) {
        summary.queries += 1;
        try {
          const events = await fetchTicketmasterEvents({
            apiKey,
            city,
            category,
            size,
            ...window,
          });
          summary.seen += events.length;
          for (const event of events) {
            const result = await upsertEvent(supabase, event, category);
            if (result.imported) summary.imported += 1;
            else summary.skipped += 1;
          }
        } catch (err) {
          summary.errors.push(err instanceof Error ? err.message : String(err));
        }
      }
    }

    await finishIngestionRun(supabase, runId, {
      status: summary.errors.length && !summary.imported ? "failed" : "completed",
      records_seen: summary.seen,
      records_imported: summary.imported,
      records_skipped: summary.skipped,
      error_sample: summary.errors.slice(0, 10),
    });

    return jsonResponse({ success: !summary.errors.length, runId, summary });
  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : "Unknown Ticketmaster ingestion error";
    await finishIngestionRun(supabase, runId, {
      status: "failed",
      error_sample: [message],
    });
    return jsonResponse({ error: message, runId }, 500);
  }
});
