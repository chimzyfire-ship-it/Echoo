import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
  normalizeCityName,
} from "../_shared/location.ts";
import {
  clampDiscoveryLimit,
  cleanDiscoveryText,
} from "../_shared/hybrid-discovery.ts";
import { googleSuggestions } from './google.ts';

type SuggestionsPayload = { query?: unknown; city?: unknown; limit?: unknown };

Deno.serve(async (req) => {
  const { requireMobileAccess } = await import('../_shared/mobile-access.ts');
  const blocked = await requireMobileAccess(req);
  if (blocked) return blocked;
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "GET" && req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const url = new URL(req.url);
    const body: SuggestionsPayload =
      req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const query = cleanDiscoveryText(
      body.query ?? url.searchParams.get("query"),
      80,
    );
    const cityInput = cleanDiscoveryText(
      body.city ?? url.searchParams.get("city"),
      80,
    );
    const city = normalizeCityName(cityInput || "GTA");
    if (!city) {
      return jsonResponse({
        supported: false,
        reason: "unsupported_city",
        suggestions: [],
      });
    }
    if (query.length < 2) return jsonResponse({ supported: true, suggestions: [] });

    const supabase = getSupabaseAdmin();
    const limit = clampDiscoveryLimit(
      body.limit ?? url.searchParams.get("limit"),
      8,
      20,
    );
    const [local, google] = await Promise.all([
      supabase.rpc("discovery_search_suggestions", {
      p_prefix: query,
      p_city: city.coverageLevel === "municipality" ? city.name : null,
      p_limit: limit,
      }).abortSignal(AbortSignal.timeout(2500)).then((result) => result, () => ({ data: [], error: true })),
      googleSuggestions({ query, city, apiKey: Deno.env.get('GOOGLE_PLACES_API_KEY') || Deno.env.get('GOOGLE_MAPS_API_KEY') }),
    ]);
    const data = local.data;
    if (local.error && google.status !== 'available') throw new Error('Suggestions are temporarily unavailable.');

    return jsonResponse({
      supported: true,
      query,
      city: city.name,
      providerStatus: google.status,
      suggestions: [...google.suggestions, ...(data || []).map((item: any) => ({
        type: item.suggestion_type,
        value: item.value,
        label: item.label,
        category: item.category || null,
        entityId: item.entity_id || null,
        source: 'echoo',
      })).filter((item: any) => !google.suggestions.some((place: any) => place.label.toLowerCase() === item.label.toLowerCase()))].slice(0, limit),
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error ? error.message : "Suggestion search failed",
      },
      500,
    );
  }
});
