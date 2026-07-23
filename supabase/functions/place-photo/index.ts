import { CORS_HEADERS, jsonResponse } from "../_shared/location.ts";

function fromBase64Url(value: string) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4);
  return atob(padded);
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    const token = url.searchParams.get("token") || "";
    const signature = url.searchParams.get("signature") || "";
    const secret = Deno.env.get("PLACE_MEDIA_SIGNING_SECRET") || "";
    if (!secret || !token || signature !== await sign(token, secret)) {
      return jsonResponse({ error: "Invalid media token" }, 403);
    }
    const payload = JSON.parse(fromBase64Url(token));
    if (
      !payload?.expiresAt ||
      Number(payload.expiresAt) < Date.now() ||
      Number(payload.expiresAt) > Date.now() + 10 * 60_000 ||
      !/^places\/[^/]+\/photos\/[^/]+$/.test(String(payload.photoName || ""))
    ) return jsonResponse({ error: "Expired media token" }, 403);

    const apiKey = Deno.env.get("GOOGLE_PLACES_API_KEY") || Deno.env.get("GOOGLE_MAPS_API_KEY");
    if (!apiKey) return jsonResponse({ error: "Photo provider is unavailable" }, 503);
    const response = await fetch(
      `https://places.googleapis.com/v1/${payload.photoName}/media?maxWidthPx=1200`,
      { headers: { "X-Goog-Api-Key": apiKey }, redirect: "manual" },
    );
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      return new Response(null, {
        status: 302,
        headers: { ...CORS_HEADERS, Location: location, "Cache-Control": "no-store" },
      });
    }
    return jsonResponse({ error: "Photo provider did not return media" }, 502);
  } catch (_error) {
    return jsonResponse({ error: "Could not load place photo" }, 502);
  }
});
