import { getSupabaseAdmin, jsonResponse, sha256Hex } from "./location.ts";

export type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export type IngestionSource =
  "osm" | "open_data" | "ticketmaster" | "echoo_partner" | "echoo_manual";

export type PlaceInput = {
  source: IngestionSource;
  sourceName: string;
  sourceId: string;
  sourceUrl?: string;
  sourceLicense?: string;
  name: string;
  category: string;
  subcategory?: string;
  latitude: number;
  longitude: number;
  municipality?: string;
  address?: string;
  website?: string;
  phone?: string;
  description?: string;
  rawPayload?: Record<string, unknown>;
  confidenceScore?: number;
  locationStatus?: "draft" | "published" | "archived" | "needs_review";
  editorialBoost?: number;
  popularityScore?: number;
  trustScore?: number;
};

export type IngestionRun = {
  id?: string;
  sourceName: string;
  sourceType: IngestionSource;
  status?: "running" | "completed" | "failed";
  sourceUrl?: string;
  metadata?: Record<string, unknown>;
};

const ONTARIO_BOUNDS = {
  minLat: 41.65,
  maxLat: 56.95,
  minLng: -95.2,
  maxLng: -74.25,
};

export const ONTARIO_CITY_BUCKETS = [
  "Toronto",
  "Markham",
  "Scarborough",
  "North York",
  "Vaughan",
  "Richmond Hill",
  "Mississauga",
  "Brampton",
  "Oakville",
  "Burlington",
  "Hamilton",
  "Ottawa",
  "Waterloo",
  "Kitchener",
  "London",
  "Niagara Falls",
  "Kingston",
  "Guelph",
  "Barrie",
  "Windsor",
];

export const TICKETMASTER_CATEGORY_BUCKETS = [
  "music",
  "sports",
  "theatre",
  "arts",
  "family",
  "comedy",
];

const OSM_AMENITIES = new Map([
  ["restaurant", "restaurant"],
  ["cafe", "cafe"],
  ["bar", "bar"],
  ["pub", "pub"],
  ["fast_food", "fast_food"],
  ["cinema", "cinema"],
  ["theatre", "theatre"],
  ["arts_centre", "arts_centre"],
  ["community_centre", "community_centre"],
  ["library", "library"],
]);

const OSM_TOURISM = new Map([
  ["attraction", "attraction"],
  ["museum", "museum"],
  ["gallery", "gallery"],
]);

const OSM_LEISURE = new Map([
  ["park", "park"],
  ["fitness_centre", "fitness_centre"],
  ["nature_reserve", "nature_reserve"],
]);

function cleanText(value: unknown, fallback = "") {
  return String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();
}

function optionalText(value: unknown) {
  const text = cleanText(value);
  return text || undefined;
}

function optionalNumber(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function clamp01(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.min(parsed, 1));
}

export function assertIngestionAuthorized(req: Request) {
  const configuredSecret =
    Deno.env.get("ONTARIO_INGESTION_SECRET") || Deno.env.get("ADMIN_TOKEN");
  if (!configuredSecret) {
    return jsonResponse(
      { error: "ONTARIO_INGESTION_SECRET is not configured." },
      500,
    );
  }

  const submittedSecret =
    req.headers.get("x-ingestion-secret") ||
    req.headers.get("x-admin-token") ||
    "";
  if (submittedSecret !== configuredSecret) {
    return jsonResponse({ error: "Unauthorized ingestion request." }, 401);
  }
}

export function isInsideOntario(lat: number, lng: number) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= ONTARIO_BOUNDS.minLat &&
    lat <= ONTARIO_BOUNDS.maxLat &&
    lng >= ONTARIO_BOUNDS.minLng &&
    lng <= ONTARIO_BOUNDS.maxLng
  );
}

export function inferOsmCategory(tags: Record<string, unknown>) {
  const amenity = cleanText(tags.amenity).toLowerCase();
  if (OSM_AMENITIES.has(amenity)) return OSM_AMENITIES.get(amenity);

  const tourism = cleanText(tags.tourism).toLowerCase();
  if (OSM_TOURISM.has(tourism)) return OSM_TOURISM.get(tourism);

  const leisure = cleanText(tags.leisure).toLowerCase();
  if (OSM_LEISURE.has(leisure)) return OSM_LEISURE.get(leisure);

  if (cleanText(tags.shop).toLowerCase() === "mall") return "mall";
  if (cleanText(tags.club)) return "club";
  if (cleanText(tags.historic)) return "historic";
  return undefined;
}

function addressFromTags(tags: Record<string, unknown>) {
  return (
    [
      tags["addr:housenumber"],
      tags["addr:street"],
      tags["addr:city"],
      tags["addr:province"],
      tags["addr:postcode"],
    ]
      .map(optionalText)
      .filter(Boolean)
      .join(", ") || undefined
  );
}

function osmIdentity(element: any) {
  const rawId = cleanText(
    element.id ||
      element.properties?.id ||
      element.properties?.["@id"] ||
      element.properties?.type_id ||
      element.raw_feature?.id,
  );
  const typedMatch = rawId.match(/^(node|way|relation)[/:_](.+)$/i);
  const rawType = cleanText(
    element.type || element.properties?.type,
    "node",
  ).toLowerCase();
  return {
    type: typedMatch?.[1]?.toLowerCase() || rawType || "node",
    id: typedMatch?.[2] || rawId,
  };
}

function pointFromGeometry(geometry: any) {
  if (
    geometry?.type === "Point" &&
    Array.isArray(geometry.coordinates) &&
    geometry.coordinates.length >= 2
  ) {
    return {
      lat: optionalNumber(geometry.coordinates[1]),
      lng: optionalNumber(geometry.coordinates[0]),
    };
  }
  return {};
}

export function osmElementToPlace(element: any): PlaceInput | null {
  const tags =
    element?.tags || element?.properties?.tags || element?.properties || {};
  const category = inferOsmCategory(tags);
  if (!category) return null;

  const geometryPoint = pointFromGeometry(element.geometry);
  const lat = optionalNumber(
    element.lat ?? element.latitude ?? element.center?.lat ?? geometryPoint.lat,
  );
  const lng = optionalNumber(
    element.lon ??
      element.lng ??
      element.longitude ??
      element.center?.lon ??
      geometryPoint.lng,
  );
  if (lat === undefined || lng === undefined || !isInsideOntario(lat, lng)) {
    return null;
  }

  const { type: osmType, id: osmId } = osmIdentity(element);
  const name = optionalText(tags.name || tags.brand || tags.operator);
  if (!osmId || !name) return null;

  return {
    source: "osm",
    sourceName: "openstreetmap",
    sourceId: `${osmType}/${osmId}`,
    sourceUrl: `https://www.openstreetmap.org/${osmType}/${osmId}`,
    sourceLicense: "ODbL-1.0",
    name,
    category,
    subcategory: optionalText(
      tags.amenity ||
        tags.tourism ||
        tags.leisure ||
        tags.shop ||
        tags.club ||
        tags.historic,
    ),
    latitude: lat,
    longitude: lng,
    municipality: optionalText(tags["addr:city"] || tags["is_in:city"]),
    address: addressFromTags(tags),
    website: optionalText(tags.website || tags["contact:website"]),
    phone: optionalText(tags.phone || tags["contact:phone"]),
    rawPayload: element,
    confidenceScore: 0.62,
    locationStatus: "published",
    trustScore: 0.74,
  };
}

export function openDataRecordToPlace(
  record: Record<string, unknown>,
  config: Record<string, unknown>,
): PlaceInput | null {
  const fields = (config.fields || {}) as Record<string, string>;
  const get = (key: string) => record[fields[key] || key];
  const lat = optionalNumber(get("latitude") ?? get("lat"));
  const lng = optionalNumber(get("longitude") ?? get("lng") ?? get("lon"));
  const name = optionalText(get("name") || get("title"));
  if (!name || lat === undefined || lng === undefined) return null;
  if (!isInsideOntario(lat, lng)) return null;

  const sourceName = cleanText(config.sourceName, "ontario_open_data");
  const sourceId =
    optionalText(get("sourceId") || get("id")) ||
    `${sourceName}:${name}:${lat.toFixed(6)},${lng.toFixed(6)}`;
  const category =
    optionalText(config.category || get("category")) || "public_facility";

  return {
    source: "open_data",
    sourceName,
    sourceId,
    sourceUrl: optionalText(config.sourceUrl),
    sourceLicense: optionalText(config.sourceLicense || "Open Government"),
    name,
    category,
    subcategory: optionalText(config.subcategory || get("subcategory")),
    latitude: lat,
    longitude: lng,
    municipality: optionalText(
      get("municipality") || get("city") || config.municipality,
    ),
    address: optionalText(get("address")),
    website: optionalText(get("website") || get("url")),
    phone: optionalText(get("phone")),
    description: optionalText(get("description")),
    rawPayload: record,
    confidenceScore: 0.7,
    locationStatus: "published",
    trustScore: 0.82,
  };
}

export function partnerRecordToPlace(
  record: Record<string, unknown>,
): PlaceInput | null {
  const lat = optionalNumber(record.latitude ?? record.lat);
  const lng = optionalNumber(record.longitude ?? record.lng ?? record.lon);
  const name = optionalText(record.name || record.title);
  if (!name || lat === undefined || lng === undefined) return null;
  if (!isInsideOntario(lat, lng)) return null;

  const source =
    record.source === "echoo_manual" ? "echoo_manual" : "echoo_partner";
  const sourceName = cleanText(record.sourceName, source);
  const sourceId =
    optionalText(record.sourceId || record.id) ||
    `${sourceName}:${name}:${lat.toFixed(6)},${lng.toFixed(6)}`;

  return {
    source,
    sourceName,
    sourceId,
    sourceUrl: optionalText(record.sourceUrl),
    sourceLicense: optionalText(record.sourceLicense || "Echoo owned"),
    name,
    category: optionalText(record.category) || "partner_place",
    subcategory: optionalText(record.subcategory),
    latitude: lat,
    longitude: lng,
    municipality: optionalText(record.municipality || record.city),
    address: optionalText(record.address),
    website: optionalText(record.website),
    phone: optionalText(record.phone),
    description: optionalText(record.description || record.summary),
    rawPayload: record,
    confidenceScore: clamp01(record.confidenceScore, 0.95),
    locationStatus: "published",
    editorialBoost: Number(record.editorialBoost ?? 0.45),
    popularityScore: Number(record.popularityScore ?? 0.72),
    trustScore: Number(record.trustScore ?? 0.96),
  };
}

export async function startIngestionRun(
  supabase: SupabaseAdmin,
  run: IngestionRun,
) {
  const { data, error } = await supabase
    .from("ontario_ingestion_runs")
    .insert({
      source_name: run.sourceName,
      source_type: run.sourceType,
      status: run.status || "running",
      source_url: run.sourceUrl,
      metadata: run.metadata || {},
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error) {
    console.warn("Could not create ingestion run:", error.message);
    return null;
  }
  return data.id as string;
}

export async function finishIngestionRun(
  supabase: SupabaseAdmin,
  runId: string | null,
  updates: Record<string, unknown>,
) {
  if (!runId) return;
  const status = updates.status || "completed";
  const payload = {
    ...updates,
    status,
    finished_at: new Date().toISOString(),
  };
  await supabase.from("ontario_ingestion_runs").update(payload).eq("id", runId);
}

export async function upsertCanonicalPlace(
  supabase: SupabaseAdmin,
  place: PlaceInput,
) {
  const provider = place.sourceName;
  const providerId = place.sourceId;
  const city = place.municipality || "Ontario";
  const confidenceScore = clamp01(place.confidenceScore, 0.65);
  const status = place.locationStatus || "needs_review";

  const { data, error } = await supabase
    .from("canonical_places")
    .upsert(
      {
        country_code: "CA",
        admin_area_1: "ON",
        city,
        municipality: city,
        formatted_address: place.address || `${place.name}, ${city}, ON`,
        address: place.address,
        latitude: place.latitude,
        longitude: place.longitude,
        timezone: "America/Toronto",
        place_provider: provider,
        place_provider_id: providerId,
        source_provider: provider,
        source_id: providerId,
        name: place.name,
        category: place.category,
        subcategory: place.subcategory,
        website: place.website,
        phone: place.phone,
        confidence_score: confidenceScore,
        is_supported_region: status === "published",
        location_status: status,
        last_seen_at: new Date().toISOString(),
        metadata: {
          ingestion_source: place.source,
          description: place.description,
          raw_source_name: place.sourceName,
        },
      },
      { onConflict: "place_provider,place_provider_id" },
    )
    .select("id")
    .single();
  if (error) throw error;

  const placeId = data.id as string;
  await supabase.from("place_sources").upsert(
    {
      place_id: placeId,
      source_name: place.sourceName,
      source_url: place.sourceUrl,
      source_license: place.sourceLicense,
      source_record_id: place.sourceId,
      raw_payload: place.rawPayload || {},
      fetched_at: new Date().toISOString(),
    },
    { onConflict: "source_name,source_record_id" },
  );

  await mirrorPlaceToLocationEntity(supabase, placeId, place);
  return placeId;
}

export async function mirrorPlaceToLocationEntity(
  supabase: SupabaseAdmin,
  placeId: string,
  place: PlaceInput,
) {
  const sourceProvider = place.sourceName;
  const sourceProviderId = `place:${place.sourceId}`;
  const trustScore = clamp01(place.trustScore, 0.78);
  const editorialBoost = Number.isFinite(place.editorialBoost)
    ? Number(place.editorialBoost)
    : place.source.startsWith("echoo")
      ? 0.45
      : 0;

  const { error } = await supabase.from("location_entities").upsert(
    {
      entity_type: "place",
      entity_id: placeId,
      place_id: placeId,
      title: place.name,
      category: place.category,
      description: place.description || place.subcategory || place.category,
      popularity_score: Number(place.popularityScore ?? 0.42),
      availability_score: 0.55,
      editorial_boost: editorialBoost,
      trust_score: trustScore,
      status: place.locationStatus || "needs_review",
      country_code: "CA",
      admin_area_1: "ON",
      city: place.municipality || "Ontario",
      latitude: place.latitude,
      longitude: place.longitude,
      source_provider: sourceProvider,
      source_provider_id: sourceProviderId,
      metadata: {
        canonical_place_id: placeId,
        source_name: place.sourceName,
        source_license: place.sourceLicense,
        source_url: place.sourceUrl,
      },
    },
    { onConflict: "source_provider,source_provider_id" },
  );
  if (error) throw error;
}

export async function importPlaces(
  supabase: SupabaseAdmin,
  places: PlaceInput[],
) {
  const summary = {
    received: places.length,
    imported: 0,
    skipped: 0,
    errors: [] as string[],
  };

  for (const place of places) {
    try {
      await upsertCanonicalPlace(supabase, place);
      summary.imported += 1;
    } catch (err) {
      summary.skipped += 1;
      summary.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  summary.errors = summary.errors.slice(0, 10);
  return summary;
}

export async function fetchJsonRecords(sourceUrl: string) {
  const response = await fetch(sourceUrl, {
    headers: { Accept: "application/json, application/geo+json, text/plain" },
  });
  if (!response.ok) {
    throw new Error(`Could not fetch source ${sourceUrl}: ${response.status}`);
  }
  const text = await response.text();
  const trimmed = text.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.elements)) return parsed.elements;
    if (Array.isArray(parsed.records)) return parsed.records;
    if (Array.isArray(parsed.features)) {
      return parsed.features.map((feature: any) => ({
        ...feature.properties,
        properties: feature.properties || {},
        ...coordinatesFromGeometry(feature.geometry),
        raw_feature: feature,
      }));
    }
    return [parsed];
  }

  return trimmed
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function stableSourceId(prefix: string, payload: unknown) {
  return `${prefix}:${await sha256Hex(JSON.stringify(payload))}`;
}

function coordinatesFromGeometry(geometry: any) {
  if (!geometry) return {};
  if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    return {
      longitude: geometry.coordinates[0],
      latitude: geometry.coordinates[1],
    };
  }
  const points: number[][] = [];
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      points.push(value as number[]);
      return;
    }
    for (const child of value) collect(child);
  };
  collect(geometry.coordinates);

  if (points.length) {
    const totals = points.reduce(
      (acc: { lng: number; lat: number }, point: number[]) => ({
        lng: acc.lng + Number(point[0]),
        lat: acc.lat + Number(point[1]),
      }),
      { lng: 0, lat: 0 },
    );
    return {
      longitude: totals.lng / points.length,
      latitude: totals.lat / points.length,
    };
  }
  return {};
}
