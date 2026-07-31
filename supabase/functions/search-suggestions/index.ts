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

type SuggestionsPayload = { query?: unknown; city?: unknown; limit?: unknown };

Deno.serve(async (req) => {
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
    if (!query) return jsonResponse({ supported: true, suggestions: [] });

    const supabase = getSupabaseAdmin();
    const limit = clampDiscoveryLimit(
      body.limit ?? url.searchParams.get("limit"),
      8,
      20,
    );
    const { data, error } = await supabase.rpc("discovery_search_suggestions", {
      p_prefix: query,
      p_city: city.coverageLevel === "municipality" ? city.name : null,
      p_limit: limit,
    });
    if (error) throw error;

    // The fast RPC serves starts-with suggestions. Add a small keyword pass so
    // people can discover a venue by a word in its name, category, or approved
    // description as well (for example "sushi", "rooftop", or a mid-name
    // fragment). GTA deliberately has no city constraint: it is a regional
    // search, not a fictitious municipality named "GTA".
    const keyword = query.replace(/[%,()]/g, " ").trim();
    let keywordRequest = supabase
      .from("location_entities")
      .select("id,title,category,description,popularity_score,editorial_boost")
      .eq("status", "published")
      .eq("country_code", "CA")
      .eq("admin_area_1", "ON")
      .or(
        `title.ilike.%${keyword}%,category.ilike.%${keyword}%,description.ilike.%${keyword}%`,
      )
      .order("editorial_boost", { ascending: false })
      .order("popularity_score", { ascending: false })
      .limit(limit);
    if (city.coverageLevel === "municipality") {
      keywordRequest = keywordRequest.ilike("city", city.name);
    }
    const { data: keywordMatches, error: keywordError } = await keywordRequest;
    if (keywordError) throw keywordError;

    const prefixSuggestions = (data || []).map((item: any) => ({
      type: item.suggestion_type,
      value: item.value,
      label: item.label,
      category: item.category || null,
      entityId: item.entity_id || null,
    }));
    const keywordSuggestions = (keywordMatches || []).map((item: any) => ({
      type: "place",
      value: item.title,
      label: item.title,
      category: item.category || null,
      entityId: item.id || null,
    }));
    const suggestions = [...prefixSuggestions, ...keywordSuggestions]
      .filter((item, index, all) => {
        const key = `${item.type}:${String(item.value || "").toLowerCase()}`;
        return key && all.findIndex((candidate) => `${candidate.type}:${String(candidate.value || "").toLowerCase()}` === key) === index;
      })
      .slice(0, limit);

    return jsonResponse({
      supported: true,
      query,
      city: city.name,
      suggestions,
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
