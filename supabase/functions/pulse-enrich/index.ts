import { CORS_HEADERS, getSupabaseAdmin, jsonResponse } from "../_shared/location.ts";
import { assertIngestionAuthorized } from "../_shared/ontario-ingestion.ts";

type Payload = {
  offset?: unknown;
  limit?: unknown;
  municipality?: unknown;
  dryRun?: unknown;
};

type PulseFact = {
  place_id: string;
  fact_key: string;
  fact_type: "cuisine" | "amenity" | "access" | "notice";
  value: string;
  source_name: string;
  source_url: string | null;
  source_record_id: string;
  confidence_score: number;
  observed_at: string;
  expires_at: string;
  approval_status: "approved";
  approved_at: string;
};

const MAX_BATCH = 100;
const FACT_TTL_DAYS = 120;

function cleanText(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(Math.round(parsed), maximum));
}

function titleCase(value: string) {
  return value
    .split(/\s+/)
    .map((word) => word ? `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}` : "")
    .join(" ");
}

function tagValue(tags: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = cleanText(tags[key]);
    if (value) return value;
  }
  return "";
}

function truthyOsm(value: string) {
  return ["yes", "true", "wlan", "wifi", "wi-fi"].includes(value.toLowerCase());
}

function sourceTags(rawPayload: unknown) {
  const payload = rawPayload && typeof rawPayload === "object" ? rawPayload as Record<string, unknown> : {};
  const properties = payload.properties && typeof payload.properties === "object"
    ? payload.properties as Record<string, unknown>
    : {};
  const tags = payload.tags || properties.tags || properties;
  return tags && typeof tags === "object" ? tags as Record<string, unknown> : {};
}

function sourceFacts(place: any, source: any): PulseFact[] {
  if (cleanText(source.source_name).toLowerCase() !== "openstreetmap") return [];
  const tags = sourceTags(source.raw_payload);
  const now = new Date();
  const observedAt = cleanText(source.fetched_at) || now.toISOString();
  const recordId = cleanText(source.source_record_id);
  if (!recordId) return [];
  const base = {
    place_id: place.id,
    source_name: "OpenStreetMap",
    source_url: cleanText(source.source_url) || null,
    source_record_id: recordId,
    confidence_score: 0.9,
    observed_at: observedAt,
    expires_at: new Date(now.getTime() + FACT_TTL_DAYS * 86_400_000).toISOString(),
    approval_status: "approved" as const,
    approved_at: now.toISOString(),
  };
  const facts: PulseFact[] = [];
  const cuisine = tagValue(tags, "cuisine");
  if (cuisine) {
    const readable = cuisine.split(/[;,]/).map((item) => titleCase(item.replace(/[_-]+/g, " ").trim())).filter(Boolean).slice(0, 3).join(" · ");
    if (readable) facts.push({ ...base, fact_key: "cuisine", fact_type: "cuisine", value: readable });
  }
  if (truthyOsm(tagValue(tags, "outdoor_seating"))) {
    facts.push({ ...base, fact_key: "outdoor_seating", fact_type: "amenity", value: "Outdoor seating listed" });
  }
  if (truthyOsm(tagValue(tags, "internet_access", "internet_access:service"))) {
    facts.push({ ...base, fact_key: "wifi", fact_type: "amenity", value: "Wi-Fi listed" });
  }
  const wheelchair = tagValue(tags, "wheelchair").toLowerCase();
  if (wheelchair === "yes") facts.push({ ...base, fact_key: "wheelchair_access", fact_type: "access", value: "Wheelchair access listed" });
  if (wheelchair === "limited") facts.push({ ...base, fact_key: "wheelchair_access", fact_type: "access", value: "Limited wheelchair access listed" });
  if (truthyOsm(tagValue(tags, "takeaway"))) facts.push({ ...base, fact_key: "takeaway", fact_type: "notice", value: "Takeaway listed" });
  if (truthyOsm(tagValue(tags, "delivery"))) facts.push({ ...base, fact_key: "delivery", fact_type: "notice", value: "Delivery listed" });
  if (truthyOsm(tagValue(tags, "reservation"))) facts.push({ ...base, fact_key: "reservations", fact_type: "notice", value: "Reservations listed" });
  if (tagValue(tags, "fee").toLowerCase() === "no") facts.push({ ...base, fact_key: "no_entry_fee", fact_type: "notice", value: "No entry fee listed" });
  return facts.slice(0, 4);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  const unauthorized = assertIngestionAuthorized(req);
  if (unauthorized) return unauthorized;

  try {
    const payload = await req.json().catch(() => ({})) as Payload;
    const offset = boundedInteger(payload.offset, 0, 0, 1_000_000);
    const limit = boundedInteger(payload.limit, 50, 1, MAX_BATCH);
    const supabase = getSupabaseAdmin();
    let placesQuery = supabase
      .from("canonical_places")
      .select("id,municipality")
      .eq("country_code", "CA")
      .eq("admin_area_1", "ON")
      .eq("is_supported_region", true)
      .eq("location_status", "published")
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);
    const municipality = cleanText(payload.municipality);
    if (municipality) placesQuery = placesQuery.ilike("municipality", municipality);
    const { data: places, error: placesError } = await placesQuery;
    if (placesError) throw placesError;
    const ids = (places || []).map((place: any) => place.id);
    if (!ids.length) return jsonResponse({ success: true, offset, limit, scanned: 0, facts: 0, nextOffset: null });
    const { data: sources, error: sourcesError } = await supabase
      .from("place_sources")
      .select("place_id,source_name,source_url,source_record_id,raw_payload,fetched_at")
      .in("place_id", ids)
      .eq("source_name", "openstreetmap");
    if (sourcesError) throw sourcesError;
    const sourceByPlace = new Map<string, any>();
    for (const source of sources || []) if (!sourceByPlace.has(source.place_id)) sourceByPlace.set(source.place_id, source);
    const facts = (places || []).flatMap((place: any) => {
      const source = sourceByPlace.get(place.id);
      return source ? sourceFacts(place, source) : [];
    });
    if (!payload.dryRun && facts.length) {
      const { error } = await supabase.from("place_pulse_facts").upsert(facts, {
        onConflict: "place_id,source_name,source_record_id,fact_key",
      });
      if (error) throw error;
    }
    return jsonResponse({
      success: true, offset, limit, scanned: ids.length, facts: facts.length,
      nextOffset: ids.length === limit ? offset + limit : null,
      dryRun: Boolean(payload.dryRun),
    });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Pulse enrichment failed" }, 500);
  }
});
