import {
  CORS_HEADERS,
  clampLimit,
  getSupabaseAdmin,
  isInsideCanadaBounds,
  jsonResponse,
  logLocationEvent,
  nearestSupportedCity,
  normalizeCityName,
} from "../_shared/location.ts";

type PlanPayload = {
  lat?: number;
  lng?: number;
  city?: string;
  query?: string;
  energy?: string;
  budget?: string;
  mode?: "build_plan" | "surprise" | "food" | "showtimes" | string;
  profile?: PlanProfile;
  groupSize?: number;
  limit?: number;
  previousPlan?: {
    region?: { name?: string; province?: string };
    ai?: { routeTitle?: string; assistantMessage?: string };
    summary?: string;
    plans?: Array<{
      title?: string;
      category?: string;
      city?: string;
      distanceMeters?: number | null;
      why?: string;
      description?: string;
    }>;
  };
};

type PlanProfile = {
  interests?: string[];
  eventStyles?: string[];
  audiences?: string[];
  motivations?: string[];
  budget?: string;
  energy?: string;
  city?: string;
  gender?: string;
  dob?: string;
  tone?: string;
};

type Candidate = {
  id?: string;
  entity_id?: string;
  entity_type?: string;
  title: string;
  description?: string;
  category?: string;
  image_url?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
  distance_meters?: number;
  rank_score?: number;
  popularity_score?: number;
  score: number;
};

type GeminiPlan = {
  assistantMessage?: string;
  routeTitle?: string;
  summary?: string;
  suggestedPills?: string[];
  model?: string;
  stopNotes?: Array<{
    id?: string;
    title?: string;
    why?: string;
    timing?: string;
  }>;
};

type PlanShape = {
  stopCount: number;
  intensity: "single" | "pair" | "flow";
  confidence: number;
  reason: string;
};

const dayparts = [
  {
    id: "morning",
    min: 7,
    max: 11,
    tags: ["coffee", "brunch", "parks", "wellness", "galleries"],
  },
  {
    id: "midday",
    min: 11,
    max: 14,
    tags: ["food", "museums", "shopping", "parks", "family"],
  },
  {
    id: "afternoon",
    min: 14,
    max: 17,
    tags: ["culture", "galleries", "coffee", "outdoors", "solo"],
  },
  {
    id: "after_work",
    min: 17,
    max: 20,
    tags: ["food", "date", "group", "sports", "movies"],
  },
  {
    id: "evening",
    min: 20,
    max: 23,
    tags: ["music", "movies", "date", "food", "cocktails"],
  },
  {
    id: "late",
    min: 23,
    max: 28,
    tags: ["music", "food", "nightlife", "arcade"],
  },
];

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function currentContext(timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "long",
    hour: "numeric",
    hour12: false,
  }).formatToParts(new Date());
  const dayName =
    parts.find((part) => part.type === "weekday")?.value || "Today";
  const hourRaw = Number(
    parts.find((part) => part.type === "hour")?.value || 12,
  );
  const hour = hourRaw < 4 ? hourRaw + 24 : hourRaw;
  const daypart =
    dayparts.find((part) => hour >= part.min && hour < part.max) || dayparts[2];
  return { dayName, hour: hourRaw, daypart };
}

function safeStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .slice(0, 16);
}

function bearerToken(req: Request) {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function authenticatedUserId(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  req: Request,
) {
  const token = bearerToken(req);
  if (!token) return "";
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) return "";
  return data.user.id;
}

async function savedProfileForUser(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
): Promise<Partial<PlanProfile> | null> {
  if (!userId) return null;
  const { data, error } = await supabase
    .from("user_onboarding_profiles")
    .select(
      "interests,event_styles,audiences,motivations,budget,energy,home_city,gender,date_of_birth,tone,completed_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data?.completed_at) return null;
  return {
    interests: safeStrings(data.interests),
    eventStyles: safeStrings(data.event_styles),
    audiences: safeStrings(data.audiences),
    motivations: safeStrings(data.motivations),
    budget: String(data.budget || "$"),
    energy: String(data.energy || "chill"),
    city: String(data.home_city || "Toronto"),
    gender: String(data.gender || "Prefer not to say"),
    dob: String(data.date_of_birth || ""),
    tone: String(data.tone || "direct"),
  };
}

function profileArray(
  clientProfile: PlanProfile,
  savedProfile: Partial<PlanProfile>,
  key: keyof Pick<
    PlanProfile,
    "interests" | "eventStyles" | "audiences" | "motivations"
  >,
) {
  const clientValues = safeStrings(clientProfile[key]);
  if (clientValues.length) return clientValues;
  return safeStrings(savedProfile[key]);
}

function normalizedProfile(
  body: PlanPayload,
  savedProfile: Partial<PlanProfile> = {},
): PlanProfile {
  const source = body.profile || {};
  return {
    interests: profileArray(source, savedProfile, "interests"),
    eventStyles: profileArray(source, savedProfile, "eventStyles"),
    audiences: profileArray(source, savedProfile, "audiences"),
    motivations: profileArray(source, savedProfile, "motivations"),
    budget: String(body.budget || source.budget || savedProfile.budget || "$"),
    energy: String(
      body.energy || source.energy || savedProfile.energy || "chill",
    ),
    city: String(body.city || source.city || savedProfile.city || "Toronto"),
    gender: String(source.gender || savedProfile.gender || "Prefer not to say"),
    dob: String(source.dob || savedProfile.dob || ""),
    tone: String(source.tone || savedProfile.tone || "direct"),
  };
}

function ageRange(dob = "") {
  const birth = new Date(dob);
  if (!Number.isFinite(birth.getTime())) return "";
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDelta = now.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && now.getDate() < birth.getDate()))
    age -= 1;
  if (age < 18 || age > 120) return "";
  if (age <= 24) return "18-24";
  if (age <= 34) return "25-34";
  if (age <= 44) return "35-44";
  if (age <= 54) return "45-54";
  return "55+";
}

function profileSignal(profile: PlanProfile) {
  return [
    ...(profile.interests || []),
    ...(profile.eventStyles || []),
    ...(profile.audiences || []),
    ...(profile.motivations || []),
  ];
}

function inferPlanShape(
  query = "",
  mode = "",
  profile: PlanProfile = {},
  requestedLimit = 4,
): PlanShape {
  const text =
    `${query} ${mode} ${profile.energy || ""} ${profileSignal(profile).join(" ")}`.toLowerCase();
  const maxStops = Math.max(1, Math.min(requestedLimit || 4, 4));
  const oneStop =
    /\b(one|1|single|quick|simple|nearby|just eat|coffee|solo|quiet|calm|low[- ]key|not much)\b/.test(
      text,
    ) ||
    /small gatherings|quiet events|thoughtful|meditation|wellness|just looking|no preference/.test(
      text,
    );
  const twoStops =
    /\b(two|2|date|dinner|drinks|movie|cinema|after|before|pair|couple)\b/.test(
      text,
    ) || /find a date|people my age|same-minded|food & drinks|talks/.test(text);
  const threeStops =
    /\b(three|3|crawl|full|whole night|big night|crew|friends|group|festival|hype|active|loud)\b/.test(
      text,
    ) ||
    /big events|sport activities|grow my network|get more active|discover new hobbies|professional networking/.test(
      text,
    );

  if (oneStop && !threeStops && !/\b(route|flow|night out)\b/.test(text)) {
    return {
      stopCount: 1,
      intensity: "single",
      confidence: 0.86,
      reason:
        "The profile or request points to one excellent, low-friction move.",
    };
  }

  if (threeStops && maxStops >= 3) {
    return {
      stopCount: 3,
      intensity: "flow",
      confidence: 0.78,
      reason:
        "The signal asks for movement, discovery, or a fuller social arc.",
    };
  }

  if (twoStops && maxStops >= 2) {
    return {
      stopCount: 2,
      intensity: "pair",
      confidence: 0.8,
      reason:
        "Two stops gives the outing structure without making it feel overplanned.",
    };
  }

  if (mode === "surprise") {
    if (profile.energy === "hype" && maxStops >= 3) {
      return {
        stopCount: 3,
        intensity: "flow",
        confidence: 0.7,
        reason: "A high-energy surprise benefits from a fuller arc.",
      };
    }
    if (profile.energy === "curious" && maxStops >= 2) {
      return {
        stopCount: 2,
        intensity: "pair",
        confidence: 0.72,
        reason: "A curious surprise should have one anchor and one turn.",
      };
    }
    return {
      stopCount: 1,
      intensity: "single",
      confidence: 0.74,
      reason:
        "The cleanest surprise is one strong move with optional branches afterward.",
    };
  }

  if (
    (profile.motivations || []).some((item) =>
      /meet|community|network|active|hobbies/i.test(item),
    ) &&
    maxStops >= 2
  ) {
    return {
      stopCount: profile.energy === "hype" && maxStops >= 3 ? 3 : 2,
      intensity: profile.energy === "hype" && maxStops >= 3 ? "flow" : "pair",
      confidence: 0.69,
      reason:
        "The motivation is social, so Echoo should offer more than a passive single stop.",
    };
  }

  return {
    stopCount: Math.min(2, maxStops),
    intensity: "pair",
    confidence: 0.62,
    reason: "A compact two-step plan is useful without being too rigid.",
  };
}

function intentTags(query = "", energy = "", profile: PlanProfile = {}) {
  const text =
    `${query} ${energy} ${profileSignal(profile).join(" ")}`.toLowerCase();
  const tags = new Set<string>();
  if (/coffee|cafe|work|read|calm|quiet|solo/.test(text))
    tags.add("coffee").add("solo").add("quiet");
  if (/food|eat|lunch|dinner|brunch|restaurant|hungry/.test(text))
    tags.add("food");
  if (/date|romantic|partner/.test(text)) tags.add("date");
  if (/friend|group|crew|people/.test(text)) tags.add("group");
  if (/movie|film|cinema/.test(text)) tags.add("movies");
  if (/music|concert|dj|dance/.test(text)) tags.add("music");
  if (/museum|gallery|art|culture/.test(text))
    tags.add("culture").add("galleries");
  if (/park|walk|outside|outdoor|hike/.test(text))
    tags.add("outdoors").add("parks");
  if (/wellness|meditation|yoga|healthy|nutrition/.test(text))
    tags.add("wellness");
  if (/business|network|professional|startup|entrepreneur|career/.test(text))
    tags.add("business").add("networking");
  if (/game|gaming|arcade|board/.test(text)) tags.add("games").add("arcade");
  if (/community|volunteer|service|sustainability/.test(text))
    tags.add("community");
  if (/cheap|free|budget/.test(text)) tags.add("cheap");
  if (/hype|active|loud|energy/.test(text)) tags.add("group").add("music");
  if (tags.size === 0) tags.add("food").add("culture").add("coffee");
  return [...tags];
}

function cleanText(value: unknown, fallback = "") {
  return String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const clean = value.trim();
    if (!clean || seen.has(clean)) return false;
    seen.add(clean);
    return true;
  });
}

function candidateKey(item: Candidate) {
  return String(item.entity_id || item.id || item.title);
}

function scoreCandidate(item: any, tags: string[], profile: PlanProfile) {
  const signal = profileSignal(profile).join(" ");
  const haystack =
    `${item.title} ${item.description || ""} ${item.category || ""} ${item.entity_type || ""}`.toLowerCase();
  const tagHits = tags.filter(
    (tag) =>
      haystack.includes(tag) ||
      (tag === "food" &&
        /kitchen|dinner|lunch|restaurant|bar|cafe/.test(haystack)) ||
      (tag === "culture" &&
        /museum|gallery|theater|theatre|art/.test(haystack)) ||
      (tag === "business" &&
        /network|startup|professional|business/.test(haystack)) ||
      (tag === "games" && /game|arcade|board|card/.test(haystack)),
  ).length;
  const profileHits = signal
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 4 && haystack.includes(word)).length;
  const budget = profile.budget || "$";
  let budgetScore = 0;
  if (budget === "$") {
    budgetScore +=
      /free|cheap|casual|community|park|coffee|street|pub|no cover|low[- ]key/.test(
        haystack,
      )
        ? 0.16
        : 0;
    budgetScore -= /premium|fine dining|luxury|splurge|exclusive/.test(haystack)
      ? 0.08
      : 0;
  } else if (budget === "$$$") {
    budgetScore +=
      /premium|fine|rooftop|theater|theatre|hotel|lounge|cocktail|reservation|immersive/.test(
        haystack,
      )
        ? 0.14
        : 0;
  } else {
    budgetScore +=
      /indie|cozy|dining|show|gallery|cafe|curated|reasonable/.test(haystack)
        ? 0.08
        : 0;
  }
  const distanceScore = item.distance_meters
    ? Math.max(0, 1 - item.distance_meters / 30000)
    : 0.55;
  const rankScore = Number(item.rank_score || item.popularity_score || 0);
  return (
    tagHits * 0.22 +
    Math.min(profileHits, 5) * 0.05 +
    budgetScore +
    distanceScore * 0.25 +
    rankScore * 0.35 +
    0.18
  );
}

function stripGeminiFences(text: string) {
  return String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function firstJsonObject(text: string) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0 && start >= 0) return text.slice(start, index + 1);
    }
  }
  return "";
}

function coerceGeminiPlan(value: unknown): GeminiPlan | null {
  if (!value) return null;
  if (typeof value === "string") return parseGeminiJson(value);
  if (typeof value === "object") return value as GeminiPlan;
  return null;
}

function parseGeminiJson(text: string): GeminiPlan | null {
  const source = String(text || "");
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] || "";
  const candidates = [
    stripGeminiFences(source),
    stripGeminiFences(fenced),
    firstJsonObject(source),
    firstJsonObject(stripGeminiFences(source)),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const cleaned = stripGeminiFences(candidate);
    if (!cleaned) continue;
    try {
      const parsed = JSON.parse(cleaned);
      const plan = coerceGeminiPlan(parsed);
      if (plan) return plan;
    } catch (_err) {
      continue;
    }
  }
  return null;
}

function extractJsonStringField(text: string, field: string) {
  const source = stripGeminiFences(text);
  const pattern = new RegExp(`"${field}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, "i");
  const match = source.match(pattern);
  if (!match) return "";
  try {
    return cleanText(JSON.parse(`"${match[1]}"`));
  } catch (_err) {
    return cleanText(match[1].replace(/\\"/g, '"'));
  }
}

function geminiModelCandidates() {
  const configured = Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
  return uniqueStrings([configured]);
}

function geminiResponseSchema() {
  return {
    type: "OBJECT",
    properties: {
      assistantMessage: { type: "STRING" },
      routeTitle: { type: "STRING" },
      summary: { type: "STRING" },
      suggestedPills: { type: "ARRAY", items: { type: "STRING" } },
      stopNotes: {
        type: "ARRAY",
        items: {
          type: "OBJECT",
          properties: {
            id: { type: "STRING" },
            title: { type: "STRING" },
            why: { type: "STRING" },
            timing: { type: "STRING" },
          },
        },
      },
    },
    required: ["assistantMessage", "routeTitle", "summary"],
  };
}

function geminiDirectResponseSchema() {
  return {
    type: "OBJECT",
    properties: {
      assistantMessage: { type: "STRING" },
      suggestedPills: { type: "ARRAY", items: { type: "STRING" } },
    },
    required: ["assistantMessage"],
  };
}

function echooChatResponse(
  aiAnswer: GeminiPlan,
  input: {
    mode: string;
    region: { name: string; province: string };
    context: ReturnType<typeof currentContext>;
    tags: string[];
  },
) {
  return {
    supported: true,
    mode: input.mode,
    planShape: {
      stopCount: 0,
      intensity: "single",
      confidence: 1,
      reason: "Direct Gemini chat answer. Plan engine is paused.",
    },
    region: input.region,
    context: {
      dayName: input.context.dayName,
      localHour: input.context.hour,
      daypart: input.context.daypart.id,
      tags: input.tags,
    },
    ai: {
      provider: "gemini",
      model:
        aiAnswer.model || Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL,
      assistantMessage: aiAnswer.assistantMessage,
      routeTitle: "",
      suggestedPills: aiAnswer.suggestedPills,
    },
    summary: "",
    plans: [],
  };
}

function shouldTryNextGeminiModel(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /503|502|504|UNAVAILABLE|high demand|overloaded/i.test(message);
}

async function callGeminiDirect(input: {
  query: string;
  mode: string;
  region: { name: string; province: string };
  context: ReturnType<typeof currentContext>;
  profile: PlanProfile;
  previousPlan?: PlanPayload["previousPlan"];
}): Promise<GeminiPlan> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");

  const safeProfile = {
    interests: (input.profile.interests || []).slice(0, 10),
    eventStyles: (input.profile.eventStyles || []).slice(0, 8),
    audiences: (input.profile.audiences || []).slice(0, 8),
    motivations: (input.profile.motivations || []).slice(0, 8),
    budget: input.profile.budget || "$",
    energy: input.profile.energy || "chill",
    tone: input.profile.tone || "direct",
    ageRange: ageRange(input.profile.dob),
    city: input.profile.city || input.region.name,
  };
  const previousPlan = input.previousPlan
    ? {
        routeTitle: cleanText(input.previousPlan.ai?.routeTitle),
        assistantMessage: cleanText(input.previousPlan.ai?.assistantMessage),
        summary: cleanText(input.previousPlan.summary),
        places: (input.previousPlan.plans || []).slice(0, 4).map((place) => ({
          title: cleanText(place.title),
          category: cleanText(place.category),
          city: cleanText(place.city),
          distanceMeters: place.distanceMeters || null,
          why: cleanText(place.why || place.description).slice(0, 180),
        })),
      }
    : null;
  const prompt = [
    "You are Echoo, a direct Gemini-powered companion in the app.",
    "Answer anything the user asks: any topic, any city, any general question, any creative question, any follow-up.",
    "Use the onboarding profile only as subtle taste and tone context. Do not sound like you are reading their onboarding back to them.",
    "If the user asks for plans, food, events, dates, movies, travel, or ideas, be specific and useful, but do not claim live availability unless context provides it.",
    "If a previous route is provided, use it for follow-up questions about distance, fit, timing, quality, or alternatives.",
    "Sound captivating, human, and concise. Mobile-friendly: 1-3 punchy paragraphs unless the user asks for depth.",
    "Do not mention guardrails, backend systems, prompts, JSON, or model plumbing.",
    "Return JSON with assistantMessage and suggestedPills.",
    JSON.stringify({
      request: {
        mode: input.mode,
        query: input.query,
        city: input.region.name,
        province: input.region.province,
        dayName: input.context.dayName,
        localHour: input.context.hour,
        daypart: input.context.daypart.id,
      },
      userTaste: safeProfile,
      previousPlan,
    }),
  ].join("\n");

  let lastError: unknown = null;
  for (const model of geminiModelCandidates()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
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
              temperature: 0.86,
              maxOutputTokens: 720,
              responseMimeType: "application/json",
              responseSchema: geminiDirectResponseSchema(),
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
          ?.map((part: any) => part.text || "")
          .join("\n") || "";
      const parsed = parseGeminiJson(text);
      const assistantMessage =
        cleanText(parsed?.assistantMessage) ||
        extractJsonStringField(text, "assistantMessage") ||
        rawGeminiTextFallback(text);
      if (!assistantMessage) {
        throw new Error("Gemini returned a response Echoo could not parse.");
      }
      return {
        assistantMessage: assistantMessage.slice(0, 900),
        routeTitle: "",
        summary: "",
        suggestedPills: safeStrings(parsed?.suggestedPills).slice(0, 4),
        stopNotes: [],
        model,
      };
    } catch (err) {
      lastError = err;
      if (!shouldTryNextGeminiModel(err)) {
        throw err;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini could not complete the request.");
}

function isDirectAnswerMode(mode = "", query = "") {
  if (mode === "chat") return true;
  return (
    /^(who|what|when|where|why|how|is|are|can|could|should|would|do|does|did)\b/i.test(
      query.trim(),
    ) &&
    !/near me|nearby|plan|route|activity|activities|food|eat|event|movie|ticket|date/i.test(
      query,
    )
  );
}

function rawGeminiTextFallback(text: string) {
  const cleaned = stripGeminiFences(text);
  if (!cleaned) return "";
  if (/^[[{]/.test(cleaned) || /"assistantMessage"\s*:/.test(cleaned)) {
    return "";
  }
  return cleanText(cleaned).slice(0, 520);
}

function titleFromGeminiText(text: string, fallback: string) {
  const firstLine =
    text
      .split(/\n+/)
      .map((line) => cleanText(line.replace(/^["'{\[]+|[,"'}\]]+$/g, "")))
      .find(Boolean) || fallback;
  return firstLine.slice(0, 120);
}

async function callGeminiPlan(input: {
  query: string;
  mode: string;
  region: { name: string; province: string };
  context: ReturnType<typeof currentContext>;
  profile: PlanProfile;
  planShape: PlanShape;
  plans: Candidate[];
}): Promise<GeminiPlan> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");

  const gender =
    input.profile.gender && input.profile.gender !== "Prefer not to say"
      ? input.profile.gender
      : "";
  const safeProfile = {
    interests: (input.profile.interests || []).slice(0, 10),
    eventStyles: (input.profile.eventStyles || []).slice(0, 8),
    audiences: (input.profile.audiences || []).slice(0, 8),
    motivations: (input.profile.motivations || []).slice(0, 8),
    budget: input.profile.budget || "$",
    energy: input.profile.energy || "chill",
    tone: input.profile.tone || "direct",
    ageRange: ageRange(input.profile.dob),
    gender,
  };
  const stopBrief = input.plans.map((plan, index) => ({
    id: candidateKey(plan),
    order: index + 1,
    title: cleanText(plan.title),
    category: cleanText(plan.category || plan.entity_type, "Echoo"),
    city: cleanText(plan.city || input.region.name),
    distanceMeters: plan.distance_meters || null,
    description: cleanText(plan.description).slice(0, 260),
  }));

  const prompt = [
    "You are Echoo's planning brain for a premium local discovery app.",
    "Write like a tasteful local friend with a point of view: vivid, specific, warm, and a little magnetic.",
    "Make the first sentence feel like an invitation, not a database result.",
    "Avoid generic lines like 'here is a plan' unless the user asked for plain structure.",
    "Use only the candidate stops provided. Do not invent venues, prices, times, tickets, addresses, or guarantees.",
    "Echoo combines events, music, food, movies, culture, hotels, date guides, and social discovery.",
    "Never scold the user or say you can only help inside a lane. If their wording is broad or messy, infer the nearest useful local plan.",
    "If they ask whether this is Gemini, answer naturally and then continue helping with the local plan.",
    "Budget is a hard preference. Make the plan feel appropriate for the selected budget tier.",
    "Use onboarding signals as taste, not as repeated copy. Do not list the profile back to the user.",
    "Surprise mode should feel unexpected but still safe, local, and coherent with the user's profile.",
    "Build-plan mode should solve the user's stated request immediately.",
    "Respect the chosen plan shape. If stopCount is 1, make the single stop feel intentional, not thin.",
    "Return JSON with: assistantMessage, routeTitle, summary, suggestedPills, stopNotes.",
    "Each stopNotes item must include the candidate id and a why sentence under 120 characters.",
    JSON.stringify({
      request: {
        mode: input.mode,
        query: input.query,
        city: input.region.name,
        province: input.region.province,
        dayName: input.context.dayName,
        localHour: input.context.hour,
        daypart: input.context.daypart.id,
      },
      chosenPlanShape: input.planShape,
      userPreferenceSignals: safeProfile,
      candidateStops: stopBrief,
    }),
  ].join("\n");

  let lastError: unknown = null;
  for (const model of geminiModelCandidates()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
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
              temperature: input.mode === "surprise" ? 0.82 : 0.62,
              maxOutputTokens: 900,
              responseMimeType: "application/json",
              responseSchema: geminiResponseSchema(),
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
          ?.map((part: any) => part.text || "")
          .join("\n") || "";
      const parsed = parseGeminiJson(text);
      const assistantMessage =
        cleanText(parsed?.assistantMessage) ||
        extractJsonStringField(text, "assistantMessage");
      const routeTitle =
        cleanText(parsed?.routeTitle) ||
        extractJsonStringField(text, "routeTitle");
      const summary =
        cleanText(parsed?.summary) || extractJsonStringField(text, "summary");
      const assistantFallback = cleanText(
        assistantMessage || summary || routeTitle,
      ).slice(0, 520);
      if (!assistantFallback) {
        const rawFallback = rawGeminiTextFallback(text);
        if (!rawFallback) {
          throw new Error("Gemini returned a response Echoo could not parse.");
        }
        return {
          assistantMessage: rawFallback,
          routeTitle: titleFromGeminiText(
            rawFallback,
            `${input.region.name} plan`,
          ),
          summary: rawFallback.slice(0, 220),
          suggestedPills: [],
          stopNotes: [],
          model,
        };
      }
      const result = {
        assistantMessage: cleanText(assistantMessage, assistantFallback).slice(
          0,
          520,
        ),
        routeTitle: cleanText(
          routeTitle,
          titleFromGeminiText(assistantFallback, `${input.region.name} plan`),
        ).slice(0, 120),
        summary: cleanText(summary, assistantFallback).slice(0, 220),
        suggestedPills: safeStrings(parsed?.suggestedPills).slice(0, 4),
        model,
        stopNotes: Array.isArray(parsed?.stopNotes)
          ? parsed.stopNotes.slice(0, 6).map((note) => ({
              id: cleanText(note.id),
              title: cleanText(note.title),
              why: cleanText(note.why).slice(0, 180),
              timing: cleanText(note.timing).slice(0, 80),
            }))
          : [],
      };
      return result;
    } catch (err) {
      lastError = err;
      if (!shouldTryNextGeminiModel(err)) {
        throw err;
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Gemini could not complete the request.");
}

Deno.serve(async (req) => {
  const startedAt = Date.now();
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);

  const supabase = getSupabaseAdmin();

  try {
    const userId = await authenticatedUserId(supabase, req);
    if (!userId) {
      return jsonResponse(
        {
          error: "Authentication required",
          code: "auth_required",
        },
        401,
      );
    }

    const savedProfile = await savedProfileForUser(supabase, userId);
    if (!savedProfile) {
      return jsonResponse(
        {
          error: "Onboarding required",
          code: "onboarding_required",
        },
        403,
      );
    }

    const body = (await req.json().catch(() => ({}))) as PlanPayload;
    const lat = optionalNumber(body.lat);
    const lng = optionalNumber(body.lng);
    const requestedLimit = Math.min(clampLimit(body.limit || 4), 4);
    const query = body.query || "";
    const mode =
      body.mode ||
      (/surprise|bored|get out/i.test(query) ? "surprise" : "build_plan");
    const profile = normalizedProfile(body, savedProfile);
    const planShape = inferPlanShape(query, mode, profile, requestedLimit);

    const region =
      lat !== undefined && lng !== undefined && isInsideCanadaBounds(lat, lng)
        ? nearestSupportedCity(lat, lng)
        : normalizeCityName(body.city || "Toronto") ||
          ({
            name: cleanText(body.city || profile.city || "Toronto"),
            province: "",
            provinceName: "",
            timezone: "America/Toronto",
            lat: 0,
            lng: 0,
            distanceMeters: 0,
          } as ReturnType<typeof nearestSupportedCity>);
    const context = currentContext(region.timezone);
    const tags = [
      ...new Set([
        ...context.daypart.tags,
        ...intentTags(query, body.energy || profile.energy, profile),
      ]),
    ];

    const aiAnswer = await callGeminiDirect({
      query,
      mode: "chat",
      region,
      context,
      profile,
      previousPlan: body.previousPlan,
    });
    const directResponse = echooChatResponse(aiAnswer, {
      mode: "chat",
      region,
      context,
      tags,
    });
    await logLocationEvent(supabase, {
      functionName: "plan-engine",
      eventType: Date.now() - startedAt > 1000 ? "slow_chat" : "chat",
      durationMs: Date.now() - startedAt,
      countryCode: "CA",
      adminArea1: region.province,
      city: region.name,
      request: {
        query,
        requestedMode: mode,
        actualMode: "chat",
        authenticated: true,
        budget: profile.budget,
        precise: lat !== undefined && lng !== undefined,
        hasGeminiKey: Boolean(Deno.env.get("GEMINI_API_KEY")),
        planEnginePaused: true,
        hasPreviousPlan: Boolean(body.previousPlan),
      },
      responseSummary: {
        count: 0,
        daypart: context.daypart.id,
        aiProvider: directResponse.ai.provider,
        aiModel: directResponse.ai.model,
      },
    });
    return jsonResponse(directResponse);

    if (isDirectAnswerMode(mode, query)) {
      const aiAnswer = await callGeminiDirect({
        query,
        mode,
        region,
        context,
        profile,
        previousPlan: body.previousPlan,
      });
      const response = {
        supported: true,
        mode,
        planShape: {
          stopCount: 0,
          intensity: "single",
          confidence: 1,
          reason: "Direct Gemini chat answer.",
        },
        region,
        context: {
          dayName: context.dayName,
          localHour: context.hour,
          daypart: context.daypart.id,
          tags,
        },
        ai: {
          provider: "gemini",
          model:
            aiAnswer.model ||
            Deno.env.get("GEMINI_MODEL") ||
            DEFAULT_GEMINI_MODEL,
          assistantMessage: aiAnswer.assistantMessage,
          routeTitle: "",
          suggestedPills: aiAnswer.suggestedPills,
        },
        summary: "",
        plans: [],
      };
      await logLocationEvent(supabase, {
        functionName: "plan-engine",
        eventType: Date.now() - startedAt > 1000 ? "slow_chat" : "chat",
        durationMs: Date.now() - startedAt,
        countryCode: "CA",
        adminArea1: region.province,
        city: region.name,
        request: {
          query,
          mode,
          authenticated: true,
          budget: profile.budget,
          precise: lat !== undefined && lng !== undefined,
          hasGeminiKey: Boolean(Deno.env.get("GEMINI_API_KEY")),
          hasPreviousPlan: Boolean(body.previousPlan),
        },
        responseSummary: {
          count: 0,
          daypart: context.daypart.id,
          aiProvider: response.ai.provider,
          aiModel: response.ai.model,
        },
      });
      return jsonResponse(response);
    }

    const { data, error } =
      lat !== undefined && lng !== undefined
        ? await supabase.rpc("search_nearby_entities", {
            p_lat: lat,
            p_lng: lng,
            p_radius_meters: 30000,
            p_entity_type: null,
            p_category: null,
            p_limit: 24,
          })
        : await supabase.rpc("search_region_entities", {
            p_country_code: "CA",
            p_admin_area_1: region.province,
            p_city: region.name,
            p_entity_type: null,
            p_category: null,
            p_limit: 24,
          });
    if (error) throw error;

    const candidates = (data || [])
      .map((item: any) => ({
        ...item,
        score: scoreCandidate(item, tags, profile),
      }))
      .sort((a: Candidate, b: Candidate) => b.score - a.score)
      .slice(0, Math.max(4, planShape.stopCount));

    if (!candidates.length) {
      const aiAnswer = await callGeminiDirect({
        query,
        mode: "chat",
        region,
        context,
        profile,
        previousPlan: body.previousPlan,
      });
      return jsonResponse({
        supported: true,
        mode: "chat",
        planShape: {
          stopCount: 0,
          intensity: "single",
          confidence: 0.9,
          reason:
            "No candidate places were available, so Gemini answered directly.",
        },
        region,
        context: {
          dayName: context.dayName,
          localHour: context.hour,
          daypart: context.daypart.id,
          tags,
        },
        ai: {
          provider: "gemini",
          model:
            aiAnswer.model ||
            Deno.env.get("GEMINI_MODEL") ||
            DEFAULT_GEMINI_MODEL,
          assistantMessage: aiAnswer.assistantMessage,
          routeTitle: "",
          suggestedPills: aiAnswer.suggestedPills,
        },
        summary: "",
        plans: [],
      });
    }
    const actualStopCount = Math.min(planShape.stopCount, candidates.length);
    const actualPlanShape =
      actualStopCount === planShape.stopCount
        ? planShape
        : {
            ...planShape,
            stopCount: actualStopCount,
            intensity:
              actualStopCount === 1
                ? "single"
                : actualStopCount === 2
                  ? "pair"
                  : "flow",
            reason:
              "Echoo used the strongest real candidates available for this city.",
          };

    const aiPlan = await callGeminiPlan({
      query,
      mode,
      region,
      context,
      profile,
      planShape: actualPlanShape,
      plans: candidates.slice(0, actualStopCount),
    });
    const noteById = new Map(
      (aiPlan?.stopNotes || []).map((note) => [
        note.id || note.title || "",
        note,
      ]),
    );

    const plans = candidates
      .slice(0, actualStopCount)
      .map((item: Candidate, index: number) => {
        const note =
          noteById.get(candidateKey(item)) || noteById.get(item.title);
        return {
          id: item.id,
          entityId: item.entity_id,
          entityType: item.entity_type,
          title: item.title,
          category: item.category || item.entity_type,
          imageUrl: item.image_url,
          city: item.city || region.name,
          latitude: item.latitude,
          longitude: item.longitude,
          distanceMeters: item.distance_meters || null,
          why: note?.why || "",
          timing: note?.timing || null,
          description: item.description,
          score: Number(item.score.toFixed(3)),
        };
      });

    const response = {
      supported: true,
      mode,
      planShape: actualPlanShape,
      region,
      context: {
        dayName: context.dayName,
        localHour: context.hour,
        daypart: context.daypart.id,
        tags,
      },
      ai: {
        provider: "gemini",
        model:
          aiPlan.model || Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL,
        assistantMessage: aiPlan.assistantMessage,
        routeTitle: aiPlan.routeTitle,
        suggestedPills: aiPlan.suggestedPills,
      },
      summary: aiPlan.summary,
      plans,
    };

    await logLocationEvent(supabase, {
      functionName: "plan-engine",
      eventType: Date.now() - startedAt > 1000 ? "slow_plan" : "plan",
      durationMs: Date.now() - startedAt,
      countryCode: "CA",
      adminArea1: region.province,
      city: region.name,
      request: {
        query,
        mode,
        tags,
        authenticated: true,
        budget: profile.budget,
        requestedLimit,
        planShape: actualPlanShape,
        precise: lat !== undefined && lng !== undefined,
        hasGeminiKey: Boolean(Deno.env.get("GEMINI_API_KEY")),
      },
      responseSummary: {
        count: plans.length,
        daypart: context.daypart.id,
        aiProvider: response.ai.provider,
        aiModel: response.ai.model,
        stopCount: actualPlanShape.stopCount,
      },
    });

    return jsonResponse(response);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown plan engine error";
    const isGeminiError =
      /Gemini|GEMINI_API_KEY|empty response|request failed/i.test(message);
    await logLocationEvent(supabase, {
      functionName: "plan-engine",
      eventType: isGeminiError ? "gemini_failed" : "plan_failed",
      status: "error",
      reason: message,
      durationMs: Date.now() - startedAt,
    });
    return jsonResponse(
      {
        error: isGeminiError
          ? "Echoo AI had trouble answering that. Try again in a moment."
          : message,
        code: isGeminiError ? "ai_unavailable" : "plan_failed",
      },
      isGeminiError ? 502 : 500,
    );
  }
});
