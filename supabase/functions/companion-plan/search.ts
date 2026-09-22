import { providerFailure } from "../_shared/provider-status.ts";
import {
  getSupabaseAdmin,
  normalizeCityName,
  readLocationCache,
  sha256Hex,
  writeLocationCache,
} from "../_shared/location.ts";
import { planningSearchFilter } from "../_shared/planning-intent.ts";
import { importLivePlanningPlace } from "../quick-plan/service.ts";
import { reserveProvider } from "./model.ts";

export type PlacePreview = {
  id: string;
  name: string;
  category: string;
  address: string;
  imageUrl: string;
  source: "echoo" | "google_places";
  photoAuthors?: Array<{ displayName: string; uri: string }>;
  latitude?: number;
  longitude?: number;
};
export type SearchResult = {
  places: PlacePreview[];
  liveUnavailable: boolean;
  storedUnavailable: boolean;
};

export async function hydratePlacePreviews(
  db: ReturnType<typeof getSupabaseAdmin>,
  places: PlacePreview[],
) {
  if (!places.length) return places;
  try {
    const ids = places.map((p) => p.id);
    const [details, photos] = await Promise.all([
      db.from("canonical_places").select(
        "id,address,formatted_address,image_url",
      ).in("id", ids),
      db.from("place_photos").select("place_id,image_url").in("place_id", ids)
        .eq("approval_status", "approved").order("sort_order", {
          ascending: true,
        }),
    ]);
    return places.map((p) => {
      const row = details.data?.find((r) => r.id === p.id);
      const image = photos.data?.find((r) => r.place_id === p.id)?.image_url ||
        row?.image_url;
      return {
        ...p,
        address: p.address || row?.formatted_address || row?.address || "",
        imageUrl: image && /^https:\/\//.test(image) ? image : p.imageUrl,
      };
    });
  } catch {
    // Missing enrichment never hides a real place.
    return places;
  }
}

async function photoUrl(name: string) {
  const secret = Deno.env.get("PLACE_MEDIA_SIGNING_SECRET");
  if (!secret || !/^places\/[^/]+\/photos\/[^/]+$/.test(name)) return "";
  const token = btoa(
    JSON.stringify({ photoName: name, expiresAt: Date.now() + 9 * 60000 }),
  ).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token)),
    ),
  ).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${Deno.env.get("SUPABASE_URL")}/functions/v1/place-photo?token=${
    encodeURIComponent(token)
  }&signature=${signature}`;
}

export function isPlaceInCity(place: any, city: string) {
  const component = (type: string) =>
    place.addressComponents?.find((c: any) => c.types?.includes(type));
  const locality = component("locality")?.longText ||
    component("postal_town")?.longText;
  const lat = place.location?.latitude, lng = place.location?.longitude;
  return component("country")?.shortText === "CA" &&
    component("administrative_area_level_1")?.shortText === "ON" &&
    normalizeCityName(locality)?.name === city && typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    (!place.businessStatus || place.businessStatus === "OPERATIONAL") &&
    Boolean(place.id && place.displayName?.text);
}

export async function searchPlanningPlaces(
  db: ReturnType<typeof getSupabaseAdmin>,
  query: string,
  city: string,
  origin?: { latitude?: number; longitude?: number },
): Promise<SearchResult> {
  const { data, error } = await db.rpc("search_planning_places", {
    ...planningSearchFilter(query),
    p_city: city,
    p_limit: 20,
    p_radius_meters: 14000,
    ...(Number.isFinite(origin?.latitude) && Number.isFinite(origin?.longitude)
      ? { p_lat: origin!.latitude, p_lng: origin!.longitude }
      : {}),
  });
  const places: PlacePreview[] = (data || []).map((p: any) => ({
    id: p.id,
    name: p.name || "",
    category: p.category || "place",
    address: p.address || "",
    imageUrl: "",
    source: "echoo",
    latitude: p.latitude,
    longitude: p.longitude,
  }));
  const result: SearchResult = {
    places,
    storedUnavailable: Boolean(error),
    liveUnavailable: false,
  };
  // Broad categories with ample local inventory do not need paid calls. Specific
  // cuisine/name searches can blend live results with our stored selection.
  const specific = planningSearchFilter(query).p_category === null;
  if (places.length >= 5 && !specific) return result;
  const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY") ||
    Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!apiKey) {
    result.liveUnavailable = true;
    return result;
  }
  try {
    if (await readLocationCache(db, "planning:places:unavailable")) {
      result.liveUnavailable = true;
      return result;
    }
    const cacheKey = `planning:places:v1:${await sha256Hex(
      `${city}:${query.toLowerCase()}`,
    )}`;
    let payload = await readLocationCache(db, cacheKey);
    if (!payload) {
      if (!await reserveProvider(db, "places")) {
        result.liveUnavailable = true;
        return result;
      }
      const scope = normalizeCityName(city);
      const response = await fetch(
        "https://places.googleapis.com/v1/places:searchText",
        {
          method: "POST",
          signal: AbortSignal.timeout(4500),
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask":
              "places.id,places.displayName,places.formattedAddress,places.addressComponents,places.location,places.primaryType,places.types,places.businessStatus,places.photos",
          },
          body: JSON.stringify({
            textQuery: `${query} in ${city}, Ontario, Canada`,
            pageSize: 6,
            languageCode: "en",
            regionCode: "CA",
            ...(scope
              ? {
                locationBias: {
                  circle: {
                    center: { latitude: scope.lat, longitude: scope.lng },
                    radius: 15000,
                  },
                },
              }
              : {}),
          }),
        },
      );
      if (!response.ok) {
        // Billing/auth failures are shared across users; avoid repeatedly paying
        // latency for a known outage. Recovery is retried after a short cooldown.
        await writeLocationCache(db, "planning:places:unavailable", {
          unavailable: true,
          reason: await providerFailure(response),
        }, [401, 403, 429].includes(response.status) ? 300 : 45);
        result.liveUnavailable = true;
        return result;
      }
      payload = await response.json();
      await writeLocationCache(db, cacheKey, payload, 300);
    }
    for (const place of (payload.places || []).slice(0, 6)) {
      if (!isPlaceInCity(place, city)) continue;
      const canonical = await importLivePlanningPlace(db, place);
      if (!canonical) continue;
      const preview: PlacePreview = {
        id: canonical.id,
        name: String(canonical.name),
        category: String(canonical.category || "place"),
        address: String(canonical.address || ""),
        imageUrl: await photoUrl(place.photos?.[0]?.name || ""),
        source: "google_places",
        latitude: Number(canonical.latitude),
        longitude: Number(canonical.longitude),
        photoAuthors: (place.photos?.[0]?.authorAttributions || []).slice(0, 3)
          .map((a: any) => ({
            displayName: String(a.displayName || "").slice(0, 160),
            uri: /^https:\/\//.test(a.uri) ? a.uri : "",
          })),
      };
      const index = places.findIndex((p) => p.id === preview.id);
      if (index >= 0) places[index] = preview;
      else places.push(preview);
    }
  } catch {
    result.liveUnavailable = true;
  }
  return result;
}
