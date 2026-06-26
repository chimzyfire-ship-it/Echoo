import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;

export type SupportedCity = {
  name: string;
  province: string;
  provinceName: string;
  timezone: string;
  lat: number;
  lng: number;
};

export const CANADA_BOUNDS = {
  minLat: 41.6,
  maxLat: 83.2,
  minLng: -141.1,
  maxLng: -52.5,
};

export const SUPPORTED_CANADA_CITIES: SupportedCity[] = [
  {
    name: "Toronto",
    province: "ON",
    provinceName: "Ontario",
    timezone: "America/Toronto",
    lat: 43.6532,
    lng: -79.3832,
  },
  {
    name: "Vancouver",
    province: "BC",
    provinceName: "British Columbia",
    timezone: "America/Vancouver",
    lat: 49.2827,
    lng: -123.1207,
  },
  {
    name: "Montreal",
    province: "QC",
    provinceName: "Quebec",
    timezone: "America/Toronto",
    lat: 45.5017,
    lng: -73.5673,
  },
  {
    name: "Calgary",
    province: "AB",
    provinceName: "Alberta",
    timezone: "America/Edmonton",
    lat: 51.0447,
    lng: -114.0719,
  },
  {
    name: "Edmonton",
    province: "AB",
    provinceName: "Alberta",
    timezone: "America/Edmonton",
    lat: 53.5461,
    lng: -113.4938,
  },
  {
    name: "Ottawa",
    province: "ON",
    provinceName: "Ontario",
    timezone: "America/Toronto",
    lat: 45.4215,
    lng: -75.6972,
  },
  {
    name: "Winnipeg",
    province: "MB",
    provinceName: "Manitoba",
    timezone: "America/Winnipeg",
    lat: 49.8951,
    lng: -97.1384,
  },
  {
    name: "Quebec City",
    province: "QC",
    provinceName: "Quebec",
    timezone: "America/Toronto",
    lat: 46.8139,
    lng: -71.208,
  },
  {
    name: "Halifax",
    province: "NS",
    provinceName: "Nova Scotia",
    timezone: "America/Halifax",
    lat: 44.6488,
    lng: -63.5752,
  },
  {
    name: "Victoria",
    province: "BC",
    provinceName: "British Columbia",
    timezone: "America/Vancouver",
    lat: 48.4284,
    lng: -123.3656,
  },
];

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-admin-token",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
};

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

export function getSupabaseAdmin() {
  const url = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function readLocationCache(
  supabase: SupabaseAdmin,
  cacheKey: string,
) {
  const { data, error } = await (supabase as any)
    .from("location_query_cache")
    .select("payload, expires_at")
    .eq("cache_key", cacheKey)
    .maybeSingle();

  if (error || !data) return null;
  if (new Date(data.expires_at).getTime() <= Date.now()) return null;
  return data.payload;
}

export async function writeLocationCache(
  supabase: SupabaseAdmin,
  cacheKey: string,
  payload: unknown,
  ttlSeconds = 120,
) {
  await (supabase as any).from("location_query_cache").upsert(
    {
      cache_key: cacheKey,
      payload,
      expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    },
    { onConflict: "cache_key" },
  );
}

export async function logLocationEvent(
  supabase: SupabaseAdmin,
  event: {
    functionName: string;
    eventType: string;
    status?: string;
    cacheHit?: boolean;
    durationMs?: number;
    countryCode?: string | null;
    adminArea1?: string | null;
    city?: string | null;
    reason?: string | null;
    request?: Record<string, unknown>;
    responseSummary?: Record<string, unknown>;
  },
) {
  await (supabase as any).from("location_request_logs").insert({
    function_name: event.functionName,
    event_type: event.eventType,
    status: event.status || "ok",
    cache_hit: event.cacheHit || false,
    duration_ms: event.durationMs,
    country_code: event.countryCode,
    admin_area_1: event.adminArea1,
    city: event.city,
    reason: event.reason,
    request: event.request || {},
    response_summary: event.responseSummary || {},
  });
}

export function isInsideCanadaBounds(lat: number, lng: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= CANADA_BOUNDS.minLat &&
    lat <= CANADA_BOUNDS.maxLat &&
    lng >= CANADA_BOUNDS.minLng &&
    lng <= CANADA_BOUNDS.maxLng
  );
}

export function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const earthRadiusMeters = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function nearestSupportedCity(
  lat: number,
  lng: number,
): SupportedCity & { distanceMeters: number } {
  let best = SUPPORTED_CANADA_CITIES[0];
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const city of SUPPORTED_CANADA_CITIES) {
    const distance = haversineMeters(lat, lng, city.lat, city.lng);
    if (distance < bestDistance) {
      best = city;
      bestDistance = distance;
    }
  }

  return { ...best, distanceMeters: Math.round(bestDistance) };
}

export function normalizeCityName(input?: string | null): SupportedCity | null {
  if (!input) return null;
  const normalized = input.trim().toLowerCase();
  return (
    SUPPORTED_CANADA_CITIES.find(
      (city) => city.name.toLowerCase() === normalized,
    ) || null
  );
}

export function clampRadiusMeters(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 25000;
  return Math.max(1000, Math.min(Math.round(parsed), 100000));
}

export function clampLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(Math.round(parsed), 100));
}
