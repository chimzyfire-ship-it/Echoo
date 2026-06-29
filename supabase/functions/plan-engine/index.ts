const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash";

type PlanPayload = {
  query?: string;
  mode?: string;
  city?: string;
  lat?: number;
  lng?: number;
  intent?: string;
  limit?: number;
  previousPlan?: {
    ai?: { assistantMessage?: string };
    summary?: string;
  } | null;
};

type GeminiAnswer = {
  assistantMessage: string;
  suggestedPills?: string[];
  model?: string;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, fallback = "") {
  return String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();
}

function safeStrings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item))
    .filter(Boolean)
    .slice(0, 4);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const ONTARIO_CITY_NAMES = [
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
  "Thunder Bay",
];

function cityFromQuery(query = "") {
  const directCity = ONTARIO_CITY_NAMES.find((cityName) => {
    const pattern = new RegExp(
      `\\b${cityName.replace(/\s+/g, "\\s+")}\\b`,
      "i",
    );
    return pattern.test(query);
  });
  if (directCity) return directCity;

  const text = query.toLowerCase();
  if (/\b(markville|cf markville|unionville|main street unionville)\b/.test(text)) {
    return "Markham";
  }
  if (/\b(ago|art gallery of ontario|rom|royal ontario museum|high park|trinity bellwoods)\b/.test(text)) {
    return "Toronto";
  }
  return "";
}

function isOntarioLocalQuery(query: string, city = "") {
  const text = `${query} ${city}`.toLowerCase();
  const hasOntarioCity = Boolean(cityFromQuery(text)) || /\bontario\b/.test(text);
  const hasLocalIntent =
    /\b(plan|route|near|nearby|nice|good|worth|vibe|chill|chilling|quiet|cozy|lunch|dinner|restaurant|restaurants|cafe|coffee|date|night|park|museum|gallery|culture|things to do|activity|activities|bar|pub|mall)\b/.test(
      text,
    );
  return hasOntarioCity && hasLocalIntent;
}

async function callOntarioPlan(input: {
  req: Request;
  body: PlanPayload;
  query: string;
}) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured.");

  const city = cleanText(input.body.city) || cityFromQuery(input.query);
  const response = await fetch(`${supabaseUrl}/functions/v1/ontario-plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: input.req.headers.get("Authorization") || "",
      apikey: input.req.headers.get("apikey") || "",
    },
    body: JSON.stringify({
      query: input.query,
      city: city || undefined,
      lat: optionalNumber(input.body.lat),
      lng: optionalNumber(input.body.lng),
      intent: input.body.intent || input.body.mode,
      limit: input.body.limit,
      mode: input.body.mode,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error || "Ontario plan request failed.");
  }

  const compatibility = payload?.data?.compatibility;
  if (!compatibility) {
    throw new Error("Ontario plan returned an incompatible response.");
  }

  return {
    ...compatibility,
    supported: payload?.data?.supported ?? true,
    region: payload?.data?.region,
    ontario: {
      plan: payload?.data?.plan,
      sourceStatus: payload?.data?.sourceStatus,
      meta: payload?.meta,
    },
  };
}

function geminiModelCandidates() {
  const configured = Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
  return uniqueStrings([
    configured,
    DEFAULT_GEMINI_MODEL,
    "gemini-flash-latest",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ]);
}

function shouldTryNextGeminiModel(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /404|429|502|503|504|AbortError|aborted|signal|timeout|NOT_FOUND|RESOURCE_EXHAUSTED|UNAVAILABLE|no longer available|not available|rate limit|high demand|overloaded/i.test(
    message,
  );
}

function responseSchema() {
  return {
    type: "OBJECT",
    properties: {
      assistantMessage: { type: "STRING" },
      suggestedPills: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["assistantMessage"],
  };
}

function stripFences(text: string) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseGeminiJson(text: string): Partial<GeminiAnswer> | null {
  const source = stripFences(text);
  const candidates = [
    source,
    source.includes("{")
      ? source.slice(source.indexOf("{"), source.lastIndexOf("}") + 1)
      : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return parsed as Partial<GeminiAnswer>;
      }
    } catch (_err) {
      continue;
    }
  }
  return null;
}

function rawTextFallback(text: string) {
  const cleaned = stripFences(text);
  if (!cleaned || /^[[{]/.test(cleaned)) return "";
  return cleanText(cleaned).slice(0, 6000);
}

async function callGemini(input: {
  query: string;
  previousPlan?: PlanPayload["previousPlan"];
}): Promise<GeminiAnswer> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");

  const previous = cleanText(
    input.previousPlan?.ai?.assistantMessage || input.previousPlan?.summary,
  );
  const prompt = [
    "You are Gemini in a raw chatbox connection. Answer the user's request directly as a general-purpose AI assistant.",
    "Do not limit the answer to Echoo, onboarding, personalization, Canada, supported cities, local app data, or any saved user profile.",
    previous ? `Previous assistant context: ${previous.slice(0, 1200)}` : "",
    `User: ${input.query}`,
    "Return JSON with assistantMessage and suggestedPills. Put the complete answer in assistantMessage.",
  ]
    .filter(Boolean)
    .join("\n\n");

  let lastError: unknown = null;
  for (const model of geminiModelCandidates()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(
        `${GEMINI_ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(key)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.85,
              maxOutputTokens: 4096,
              responseMimeType: "application/json",
              responseSchema: responseSchema(),
            },
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `Gemini request failed (${response.status}): ${errorText.slice(
            0,
            220,
          )}`,
        );
      }

      const payload = await response.json();
      const text =
        payload?.candidates?.[0]?.content?.parts
          ?.map((part: { text?: string }) => part.text || "")
          .join("\n") || "";
      const parsed = parseGeminiJson(text);
      const assistantMessage =
        cleanText(parsed?.assistantMessage) || rawTextFallback(text);

      if (!assistantMessage) {
        throw new Error("Gemini returned an empty response.");
      }

      return {
        assistantMessage: assistantMessage.slice(0, 6000),
        suggestedPills: safeStrings(parsed?.suggestedPills),
        model,
      };
    } catch (err) {
      lastError = err;
      console.warn(`Gemini model ${model} failed, trying fallback:`, err);
      if (!shouldTryNextGeminiModel(err)) throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini could not complete the request.");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const body = (await req.json().catch(() => ({}))) as PlanPayload;
    const query = cleanText(body.query);
    if (!query) {
      return jsonResponse({ error: "Ask Gemini something first." }, 400);
    }

    if (isOntarioLocalQuery(query, cleanText(body.city))) {
      try {
        const ontarioPlan = await callOntarioPlan({ req, body, query });
        return jsonResponse(ontarioPlan);
      } catch (err) {
        console.warn("Ontario retrieval plan failed, falling back to Gemini:", err);
      }
    }

    const aiAnswer = await callGemini({
      query,
      previousPlan: body.previousPlan,
    });

    return jsonResponse({
      supported: true,
      mode: "chat",
      planShape: {
        stopCount: 0,
        intensity: "single",
        confidence: 1,
        reason: "Raw Gemini chat answer.",
      },
      region: {
        name: "Global",
        province: "",
        provinceName: "",
        timezone: "UTC",
        lat: 0,
        lng: 0,
      },
      context: {
        dayName: "",
        localHour: 0,
        daypart: "",
        tags: [],
      },
      ai: {
        provider: "gemini",
        model: aiAnswer.model || Deno.env.get("GEMINI_MODEL"),
        assistantMessage: aiAnswer.assistantMessage,
        routeTitle: "",
        suggestedPills: aiAnswer.suggestedPills,
      },
      summary: "",
      plans: [],
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown Gemini chat error";
    console.error("Raw Gemini chat failed:", err);
    return jsonResponse(
      {
        error: `Gemini could not answer cleanly: ${message}`,
        code: "ai_unavailable",
      },
      502,
    );
  }
});
