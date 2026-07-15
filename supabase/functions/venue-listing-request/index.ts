import { CORS_HEADERS, getSupabaseAdmin, jsonResponse } from "../_shared/location.ts";

type RequestPayload = {
  locationEntityId?: unknown;
  businessName?: unknown;
  businessEmail?: unknown;
  businessPhone?: unknown;
  businessWebsite?: unknown;
  requestedCategories?: unknown;
  note?: unknown;
};

const clean = (value: unknown, max: number) => String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const bearer = (req: Request) => (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || "";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const supabase = getSupabaseAdmin();
    const { data: auth, error: authError } = await supabase.auth.getUser(bearer(req));
    if (authError || !auth.user) return jsonResponse({ error: "Sign in to register a business" }, 401);
    const body = (await req.json().catch(() => ({}))) as RequestPayload;
    const locationEntityId = clean(body.locationEntityId, 64);
    const businessName = clean(body.businessName, 160);
    const businessEmail = clean(body.businessEmail, 254).toLowerCase();
    const requestedCategories = Array.isArray(body.requestedCategories)
      ? [...new Set(body.requestedCategories.map((value) => clean(value, 80).toLowerCase()).filter(Boolean))].slice(0, 8)
      : [];
    if (!uuid(locationEntityId) || !businessName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(businessEmail)) {
      return jsonResponse({ error: "A valid business, email, and Echoo place are required" }, 422);
    }
    const { data: entity, error: entityError } = await supabase.from("location_entities")
      .select("id,entity_type,category").eq("id", locationEntityId).eq("status", "published").maybeSingle();
    if (entityError) throw entityError;
    if (!entity || entity.entity_type !== "place") return jsonResponse({ error: "Choose a published Echoo place" }, 404);
    const { data, error } = await supabase.from("venue_listing_requests").insert({
      location_entity_id: locationEntityId,
      requested_by: auth.user.id,
      business_name: businessName,
      business_email: businessEmail,
      business_phone: clean(body.businessPhone, 40) || null,
      business_website: clean(body.businessWebsite, 500) || null,
      requested_categories: requestedCategories.length ? requestedCategories : [entity.category].filter(Boolean),
      note: clean(body.note, 1500) || null,
    }).select("id,status,created_at").single();
    if (error) throw error;
    return jsonResponse({ ok: true, request: data, next: "We verify the business and activate placement only after approval and billing." }, 201);
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Could not submit business registration" }, 500);
  }
});
