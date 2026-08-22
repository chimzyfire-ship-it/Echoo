import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type InvitationTargetType = "event" | "place";

export function bearerToken(req: Request) {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
}

export function isUuid(value: unknown): value is string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || ""),
  );
}

export function isTargetType(value: unknown): value is InvitationTargetType {
  return value === "event" || value === "place";
}

export async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export async function targetIsPublished(
  supabase: SupabaseClient,
  targetType: InvitationTargetType,
  targetId: string,
) {
  if (targetType === "place") {
    const result = await supabase
      .from("canonical_places")
      .select("id")
      .eq("id", targetId)
      .eq("country_code", "CA")
      .eq("admin_area_1", "ON")
      .eq("is_supported_region", true)
      .eq("location_status", "published")
      .maybeSingle();
    if (result.error) throw result.error;
    return Boolean(result.data);
  }

  const ticketed = await supabase
    .from("ticketed_events")
    .select("id")
    .or(`id.eq.${targetId},location_entity_id.eq.${targetId}`)
    .eq("status", "published")
    .eq("country_code", "CA")
    .limit(1)
    .maybeSingle();
  if (ticketed.error) throw ticketed.error;
  if (ticketed.data) return true;

  const entity = await supabase
    .from("location_entities")
    .select("id")
    .eq("id", targetId)
    .eq("entity_type", "event")
    .eq("status", "published")
    .eq("country_code", "CA")
    .maybeSingle();
  if (entity.error) throw entity.error;
  return Boolean(entity.data);
}
