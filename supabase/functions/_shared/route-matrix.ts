import type { PlannerCandidate } from "../quick-plan/planner.ts";
import type { TravelMode } from "./planning-intent.ts";

export type RouteMatrix = Record<string, number>;
export const legKey = (from: string, to: string) => `${from}:${to}`;

// Only numeric durations from the provider enter scheduling. Missing routes
// stay missing; we never substitute a straight line for a verified walk.
export async function loadRouteMatrix(
  places: PlannerCandidate[],
  mode: TravelMode,
  departure: Date,
): Promise<RouteMatrix | null> {
  const key = Deno.env.get("GOOGLE_ROUTES_API_KEY") ||
    Deno.env.get("GOOGLE_MAPS_API_KEY");
  if (!key || places.length < 2) return places.length < 2 ? {} : null;
  const point = (place: PlannerCandidate) => ({
    waypoint: {
      location: {
        latLng: { latitude: place.latitude, longitude: place.longitude },
      },
    },
  });
  try {
    const response = await fetch(
      "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix",
      {
        method: "POST",
        signal: AbortSignal.timeout(7000),
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "originIndex,destinationIndex,duration,status,condition",
        },
        body: JSON.stringify({
          origins: places.map(point),
          destinations: places.map(point),
          travelMode:
            { walk: "WALK", drive: "DRIVE", transit: "TRANSIT" }[mode],
          ...(mode === "transit"
            ? { departureTime: departure.toISOString() }
            : {}),
        }),
      },
    );
    if (!response.ok) return null;
    const rows = await response.json();
    if (!Array.isArray(rows)) return null;
    const result: RouteMatrix = {};
    for (const row of rows) {
      if (
        row.condition !== "ROUTE_EXISTS" ||
        (row.status?.code && row.status.code !== 0)
      ) continue;
      const from = places[row.originIndex ?? 0],
        to = places[row.destinationIndex ?? 0];
      const seconds = typeof row.duration === "string" &&
          /^\d+(?:\.\d+)?s$/.test(row.duration)
        ? Number(row.duration.slice(0, -1))
        : NaN;
      if (from && to && Number.isFinite(seconds)) {
        result[legKey(from.id, to.id)] = Math.max(1, Math.ceil(seconds / 60));
      }
    }
    return result;
  } catch {
    return null;
  }
}
