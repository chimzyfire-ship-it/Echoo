import {
  buildCompanionDecision,
  buildCompanionFrame,
  buildSafetyVerdict,
  companionVoiceRules,
  hasCityOrientationIntent,
  hasCulturalFoodIntent,
  hasDateNightIntent,
  hasFoodIntent,
  hasWellbeingIntent,
  isModelMetaQuery,
  MODEL_META_RESPONSE,
  needsVoiceRepair,
  type CompanionDecision,
  type CompanionFrame,
  type CompanionSafetyVerdict,
} from "../_shared/companion-core.ts";
import {
  readCompanionMemory,
  writeCompanionTurn,
  type CompanionMemoryContext,
  type CompanionMemoryState,
} from "../_shared/companion-memory.ts";
import {
  routeCompanionTurn,
  type CompanionRoute,
} from "../_shared/companion-router.ts";
import { getSupabaseAdmin } from "../_shared/location.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

type PlanPayload = {
  query?: string;
  mode?: string;
  city?: string;
  lat?: number;
  lng?: number;
  intent?: string;
  limit?: number;
  sessionId?: string;
  profile?: {
    interests?: string[];
    eventStyles?: string[];
    audiences?: string[];
    budget?: string;
    energy?: string;
    culturalHeritage?: string;
    favouriteCuisines?: string[];
    discoveryMode?: string;
    dietaryRequirements?: string[];
    allergies?: string[];
  };
  previousPlan?: {
    ai?: { assistantMessage?: string };
    summary?: string;
    region?: { name?: string; city?: string };
    conversationState?: {
      city?: string;
      cityConfidence?: string;
      intent?: string;
      strategy?: string;
      mood?: string;
      weather?: {
        city?: string;
        label?: string;
        temperatureC?: number;
      } | null;
      frame?: Partial<CompanionFrame>;
    };
    plans?: Array<{
      title?: string;
      name?: string;
      category?: string;
      type?: string;
      reason?: string;
      why?: string;
      vibe?: string;
      description?: string;
      city?: string;
    }>;
    recommendations?: Array<{
      title?: string;
      name?: string;
      category?: string;
      type?: string;
      reason?: string;
      why?: string;
      vibe?: string;
      description?: string;
      city?: string;
    }>;
  } | null;
};

type GeminiAnswer = {
  assistantMessage: string;
  suggestedPills?: string[];
  model?: string;
};

type ProfileSignals = {
  interests: string[];
  eventStyles: string[];
  audiences: string[];
  budget: string;
  energy: string;
  culturalHeritage: string;
  favouriteCuisines: string[];
  discoveryMode: string;
  dietaryRequirements: string[];
  allergies: string[];
};

type WeatherSnapshot = {
  city: string;
  temperatureC: number;
  apparentC?: number;
  precipitationMm?: number;
  windKmh?: number;
  code?: number;
  label: string;
};

type ConversationMood =
  "low" | "calm" | "lively" | "curious" | "testing" | "practical" | "open";

type ConversationIntent =
  | "identity"
  | "wellbeing"
  | "weather"
  | "followup"
  | "city_correction"
  | "city_reset"
  | "city_orientation"
  | "food_plan"
  | "cultural_food"
  | "date_night"
  | "local_plan"
  | "vague_ontario"
  | "companion";

type ConversationStrategy =
  | "policy_identity"
  | "companion_checkin"
  | "weather_read"
  | "plan_followup"
  | "city_correction"
  | "city_reset"
  | "city_orientation"
  | "choose_city_companion"
  | "guided_plan"
  | "retrieval_plan"
  | "model_companion";

type PreviousPlanItem = {
  title: string;
  category: string;
  city: string;
  note: string;
};

type ConversationState = {
  query: string;
  mode: string;
  city: string;
  cityConfidence:
    "query" | "previous" | "profile" | "chosen" | "province" | "unknown";
  mood: ConversationMood;
  intent: ConversationIntent;
  strategy: ConversationStrategy;
  previousItems: PreviousPlanItem[];
  isTesting: boolean;
  wantsWeather: boolean;
  wantsLocalPlan: boolean;
  needsSmartSuggestion: boolean;
  weather: WeatherSnapshot | null;
  frame: CompanionFrame;
  safety: CompanionSafetyVerdict;
  decision: CompanionDecision;
  route: CompanionRoute;
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
    .slice(0, 3);
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  Toronto: { lat: 43.6532, lng: -79.3832 },
  Markham: { lat: 43.8561, lng: -79.337 },
  Mississauga: { lat: 43.589, lng: -79.6441 },
  Brampton: { lat: 43.7315, lng: -79.7624 },
  Scarborough: { lat: 43.7764, lng: -79.2318 },
  "North York": { lat: 43.7615, lng: -79.4111 },
  "Richmond Hill": { lat: 43.8828, lng: -79.4403 },
  Hamilton: { lat: 43.2557, lng: -79.8711 },
  Ottawa: { lat: 45.4215, lng: -75.6972 },
  Waterloo: { lat: 43.4643, lng: -80.5204 },
  Kitchener: { lat: 43.4516, lng: -80.4925 },
  London: { lat: 42.9849, lng: -81.2453 },
  "Niagara Falls": { lat: 43.0896, lng: -79.0849 },
  Kingston: { lat: 44.2312, lng: -76.486 },
  Guelph: { lat: 43.5448, lng: -80.2482 },
  Barrie: { lat: 44.3894, lng: -79.6903 },
  Windsor: { lat: 42.3149, lng: -83.0364 },
  "Thunder Bay": { lat: 48.3809, lng: -89.2477 },
};

const GTA_CITY_NAMES = [
  "Toronto",
  "Markham",
  "Mississauga",
  "Brampton",
  "Vaughan",
  "Richmond Hill",
  "Scarborough",
  "North York",
  "Oakville",
  "Burlington",
];

function modelMetaPayload() {
  return {
    supported: true,
    mode: "chat",
    planShape: {
      stopCount: 0,
      intensity: "single",
      confidence: 1,
      reason: "Deterministic Echoo identity guard.",
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
      provider: "echoo-policy",
      model: "deterministic",
      assistantMessage: MODEL_META_RESPONSE,
      routeTitle: "",
      suggestedPills: ["Plan lunch", "Find events", "Surprise me"],
    },
    summary: "",
    plans: [],
  };
}

function companionRecoveryMessage(input: {
  query: string;
  city?: string;
  state?: ConversationState | null;
}) {
  const query = cleanText(input.query);
  const city =
    input.state?.city || cityHintFromInput(query, input.city) || "Ontario";
  const text = query.toLowerCase();
  if (hasCulturalFoodIntent(query)) {
    if (/\bnigerian|suya|jollof|egusi|pepper soup\b/i.test(query)) {
      return `${city} may be too narrow for the Nigerian food you actually mean. Better move: widen toward Scarborough or North York for the real lane, or keep ${city} and make tonight a softer food-first date nearby.`;
    }
    return `${city} needs a more careful cultural food search than a generic restaurant list. Keep the city, cuisine, and any halal/allergy needs together, then make it one real food stop plus one easy after-stop.`;
  }
  if (hasDateNightIntent(query)) {
    return `${city} can be sweet without turning into errands. Start with one warm room, then keep dessert or a short walk as the soft second move.`;
  }
  if (hasFoodIntent(query)) {
    return `${city} should go food-first here: one real meal, then a short walk or dessert nearby. Dietary rules stay part of the plan from the start.`;
  }
  if (hasCityOrientationIntent(query, city)) {
    return cityOrientationMessage(city);
  }
  if (
    /\b(why|how|what|when|who|explain|teach|tell me|help me understand)\b/i.test(
      text,
    )
  ) {
    return `Short answer: ${city} is best understood through the kind of day you want, not a giant list. Ask me naturally, and I’ll answer plainly or turn it into a local plan when places matter.`;
  }
  if (/\btonight|today|this afternoon|this evening\b/i.test(text)) {
    return `${city} can stay simple: one easy first stop, then food or a short walk nearby if the night has room.`;
  }
  return `${city} gets a simple default: start close, choose one real stop, then let food, weather, or mood decide the second move.`;
}

function repairAssistantText(input: {
  text: string;
  query: string;
  city?: string;
  state?: ConversationState | null;
}) {
  const text = cleanText(input.text);
  if (!text || needsVoiceRepair(text)) {
    return companionRecoveryMessage(input);
  }
  return text;
}

function polishPayloadVoice<T extends Record<string, unknown>>(
  payload: T,
  input: { query: string; city?: string; state?: ConversationState | null },
) {
  const copy = { ...payload } as Record<string, unknown>;
  const ai =
    copy.ai && typeof copy.ai === "object"
      ? { ...(copy.ai as Record<string, unknown>) }
      : null;
  if (ai) {
    ai.assistantMessage = repairAssistantText({
      text: cleanText(ai.assistantMessage),
      query: input.query,
      city: input.city,
      state: input.state,
    });
    copy.ai = ai;
  }
  if (typeof copy.summary === "string" && needsVoiceRepair(copy.summary)) {
    copy.summary = "";
  }
  const ontario =
    copy.ontario && typeof copy.ontario === "object"
      ? { ...(copy.ontario as Record<string, unknown>) }
      : null;
  if (ontario?.plan && typeof ontario.plan === "object") {
    const plan = { ...(ontario.plan as Record<string, unknown>) };
    if (typeof plan.summary === "string" && needsVoiceRepair(plan.summary)) {
      plan.summary = "";
    }
    if (
      typeof plan.explanation === "string" &&
      needsVoiceRepair(plan.explanation)
    ) {
      plan.explanation =
        ai?.assistantMessage || companionRecoveryMessage(input);
    }
    ontario.plan = plan;
    copy.ontario = ontario;
  }
  return copy as T;
}

function profileSignals(profile?: PlanPayload["profile"]): ProfileSignals {
  const empty = {
    interests: [],
    eventStyles: [],
    audiences: [],
    budget: "",
    energy: "",
    culturalHeritage: "",
    favouriteCuisines: [],
    discoveryMode: "",
    dietaryRequirements: [],
    allergies: [],
  };
  if (!profile) return empty;
  return {
    ...empty,
    interests: safeStrings(profile.interests),
    eventStyles: safeStrings(profile.eventStyles),
    audiences: safeStrings(profile.audiences),
    budget: cleanText(profile.budget),
    energy: cleanText(profile.energy),
    culturalHeritage: cleanText(profile.culturalHeritage),
    favouriteCuisines: safeStrings(profile.favouriteCuisines),
    discoveryMode: cleanText(profile.discoveryMode),
    dietaryRequirements: safeStrings(profile.dietaryRequirements),
    allergies: safeStrings(profile.allergies),
  };
}

function normalizedKnownCity(value = "") {
  const cleaned = cleanText(value);
  if (!cleaned) return "";
  return (
    ONTARIO_CITY_NAMES.find((cityName) => {
      const pattern = new RegExp(`^${cityName.replace(/\s+/g, "\\s+")}$`, "i");
      return pattern.test(cleaned);
    }) || ""
  );
}

function previousContextCity(previousPlan?: PlanPayload["previousPlan"]) {
  return normalizedKnownCity(
    cleanText(previousPlan?.conversationState?.city) ||
      cleanText(previousPlan?.conversationState?.weather?.city) ||
      cleanText(previousPlan?.region?.name || previousPlan?.region?.city),
  );
}

function cityHintFromInput(
  query: string,
  city = "",
  previousPlan?: PlanPayload["previousPlan"],
) {
  if (hasExplicitOntarioScope(query)) return "Ontario";
  const queryCity = cityFromQuery(query);
  if (queryCity) return queryCity;
  const previousCity = previousContextCity(previousPlan);
  if (previousCity) return previousCity;
  const cleaned = cleanText(city);
  return isProvinceOnlyCity(cleaned) ? "Ontario" : cleaned || "Ontario";
}

function isProvinceOnlyCity(city = "") {
  return !cleanText(city) || /^(ontario|on|global)$/i.test(cleanText(city));
}

function hasExplicitOntarioScope(query = "") {
  if (!/\bontario\b/i.test(query)) return false;
  const directCity = cityFromQuery(query);
  if (!directCity) return true;
  return new RegExp(
    `\\b(?:not|instead of|rather than)\\s+(?:in\\s+|around\\s+)?${directCity.replace(/\s+/g, "\\s+")}\\b`,
    "i",
  ).test(query);
}

function defaultOntarioCity(
  query = "",
  city = "",
  previousPlan?: PlanPayload["previousPlan"],
) {
  if (hasExplicitOntarioScope(query)) return "Ontario";
  const direct = cityFromQuery(query);
  if (direct) return direct;
  const previousCity = previousContextCity(previousPlan);
  if (previousCity) return previousCity;
  const cleanCity = cleanText(city);
  if (!isProvinceOnlyCity(cleanCity)) return cleanCity;
  const text = query.toLowerCase();
  if (/quiet|calm|museum|heritage|park|suburb|chill|hangout/.test(text)) {
    return "Markham";
  }
  if (
    /loud|lively|night|music|bar|concert|event|big|random|surprise/.test(text)
  ) {
    return "Toronto";
  }
  return "Toronto";
}

function isNewLocalPlanningQuery(
  query = "",
  resolvedCity = "",
  previousPlan?: PlanPayload["previousPlan"],
) {
  const queryCity = cityFromQuery(query);
  const previousCity = previousContextCity(previousPlan);
  const hasFreshAsk =
    /\b(where can|where should|where do|can i|could i|find me|show me|take me|i need|i want|make|build|plan|somewhere|around|near|nearby|in)\b/i.test(
      query,
    );
  const hasSoftReset =
    /\b(relax|nerves|breathe|reset|quiet|calm|peaceful|chill|chilled|chilling|evening|tonight|today|afternoon)\b/i.test(
      query,
    );
  const changedCity = Boolean(
    queryCity && previousCity && queryCity !== previousCity,
  );
  const explicitPlace = Boolean(
    queryCity || /\b(?:in|around|near)\s+[a-z][a-z\s'-]{2,}\b/i.test(query),
  );
  const localShape = isOntarioLocalQuery(query, resolvedCity);
  return Boolean(
    (changedCity && (hasFreshAsk || hasSoftReset || localShape)) ||
    (explicitPlace && hasFreshAsk && (hasSoftReset || localShape)),
  );
}

function isWeatherQuery(query = "") {
  const text = query.toLowerCase();
  const asksForConditions =
    /\b(weather|forecast|temperature|temp|degrees|celsius|wind|humidity|humid|conditions|feels like)\b/.test(
      text,
    );
  const asksWeatherQuestion =
    /\b(what(?:'s|s| is)|how(?:'s|s| is)|is it|will it|do i need|should i bring|can i|are people)\b/.test(
      text,
    );
  const asksOutdoorConditions =
    /\bare people\b[^.?!]{0,80}\b(outdoors?|outside|walk(?:ing)?)\b/.test(
      text,
    ) && /\b(weather|today|conditions)\b/.test(text);
  const asksAboutPrecipitation =
    /\b(is it|will it|when will it|do i need)\b[^.?!]{0,48}\b(rain|raining|snow|snowing|umbrella|coat)\b/.test(
      text,
    );
  return (
    (asksForConditions && (asksWeatherQuestion || asksOutdoorConditions)) ||
    asksAboutPrecipitation
  );
}

function weatherLabel(code?: number) {
  if (code === undefined) return "weather";
  if ([0].includes(code)) return "clear";
  if ([1, 2, 3].includes(code)) return "cloudy";
  if ([45, 48].includes(code)) return "foggy";
  if ([51, 53, 55, 56, 57].includes(code)) return "drizzly";
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return "rainy";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "snowy";
  if ([95, 96, 99].includes(code)) return "stormy";
  return "mixed";
}

async function fetchWeatherSnapshot(input: {
  query: string;
  city?: string;
  lat?: number;
  lng?: number;
  previousPlan?: PlanPayload["previousPlan"];
}): Promise<WeatherSnapshot | null> {
  const city = defaultOntarioCity(input.query, input.city, input.previousPlan);
  const coords =
    Number.isFinite(input.lat) && Number.isFinite(input.lng)
      ? { lat: Number(input.lat), lng: Number(input.lng) }
      : CITY_COORDS[city];
  if (!coords) return null;

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(coords.lat));
  url.searchParams.set("longitude", String(coords.lng));
  url.searchParams.set(
    "current",
    "temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m",
  );
  url.searchParams.set("timezone", "America/Toronto");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json();
    const current = payload?.current || {};
    const temperatureC = Number(current.temperature_2m);
    if (!Number.isFinite(temperatureC)) return null;
    const code = optionalNumber(current.weather_code);
    return {
      city,
      temperatureC,
      apparentC: optionalNumber(current.apparent_temperature),
      precipitationMm: optionalNumber(current.precipitation),
      windKmh: optionalNumber(current.wind_speed_10m),
      code,
      label: weatherLabel(code),
    };
  } catch (_err) {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function weatherPlanNudge(weather: WeatherSnapshot) {
  if (/rainy|stormy|snowy|drizzly/.test(weather.label)) {
    return "Keep the plan indoors: museum, cafe, listening room, or one warm food stop.";
  }
  if (weather.temperatureC <= 2) {
    return "Cold day. Short walks, warm rooms, and no sprawling route.";
  }
  if (weather.temperatureC >= 26) {
    return "Warm day. Shade, drinks, and one easy outdoor stretch if the energy is right.";
  }
  if (/clear|cloudy|mixed/.test(weather.label)) {
    return "Good enough for a short walk between stops.";
  }
  return "Start indoors, then adjust the walk.";
}

function weatherPayload(weather: WeatherSnapshot) {
  const apparent = Number.isFinite(weather.apparentC)
    ? `, feels like ${Math.round(weather.apparentC || weather.temperatureC)}`
    : "";
  const rain =
    Number(weather.precipitationMm || 0) > 0
      ? ` Rain is showing at ${weather.precipitationMm} mm right now.`
      : "";
  return {
    supported: true,
    mode: "chat",
    planShape: {
      stopCount: 0,
      intensity: "single",
      confidence: 0.95,
      reason: "Live weather companion response.",
    },
    region: {
      name: weather.city,
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      lat: 0,
      lng: 0,
    },
    context: {
      dayName: "",
      localHour: 0,
      daypart: "",
      tags: [weather.label],
    },
    ai: {
      provider: "echoo-weather",
      model: "open-meteo",
      assistantMessage: `${weather.city} is ${Math.round(
        weather.temperatureC,
      )}°C${apparent} and ${weather.label}.${rain} ${weatherPlanNudge(weather)}`,
      routeTitle: "",
      suggestedPills: ["Plan indoors", "Calm hangout", "Food nearby"],
    },
    summary: "",
    plans: [],
  };
}

function previousWeatherSnapshot(
  previousPlan?: PlanPayload["previousPlan"],
): WeatherSnapshot | null {
  const previousWeather = previousPlan?.conversationState?.weather;
  const city = normalizedKnownCity(previousWeather?.city || "");
  const temperatureC = optionalNumber(previousWeather?.temperatureC);
  if (!city || !Number.isFinite(temperatureC)) return null;
  return {
    city,
    temperatureC,
    label: cleanText(previousWeather?.label, "weather"),
  };
}

function cityCorrectionPayload(input: {
  query: string;
  city?: string;
  previousPlan?: PlanPayload["previousPlan"];
  weather?: WeatherSnapshot | null;
}) {
  const correctedCity =
    correctionCityFromQuery(input.query, input.previousPlan) ||
    previousContextCity(input.previousPlan) ||
    cityFromQuery(input.query) ||
    defaultOntarioCity(input.query, input.city, input.previousPlan);
  const staleCity =
    normalizedKnownCity(input.city || "") || cityFromQuery(input.query) || "";
  const relation = regionalRelationshipLine(correctedCity, staleCity);
  const weatherLine =
    input.weather && input.weather.city === correctedCity
      ? ` ${correctedCity} is ${Math.round(input.weather.temperatureC)}°C and ${input.weather.label}; ${weatherPlanNudge(input.weather).toLowerCase()}`
      : "";
  const assistantMessage = cleanText(
    `Fair catch. Keeping this on ${correctedCity}. ${relation}${weatherLine} Next plan stays there unless you ask to switch cities.`,
  );
  return {
    supported: true,
    mode: "chat",
    planShape: {
      stopCount: 0,
      intensity: "single",
      confidence: 0.96,
      reason: "Conversation state corrected the city anchor.",
    },
    region: {
      name: correctedCity,
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      lat: 0,
      lng: 0,
    },
    context: {
      dayName: "",
      localHour: 0,
      daypart: "",
      tags: ["city-correction", isGtaCity(correctedCity) ? "gta" : "ontario"],
    },
    ai: {
      provider: "echoo-state",
      model: "deterministic",
      assistantMessage,
      routeTitle: "",
      suggestedPills: ["Stay there", "Nearby cities", "Build a plan"],
    },
    summary: "",
    plans: [],
  };
}

function cityResetPayload(input: {
  query: string;
  city?: string;
  previousPlan?: PlanPayload["previousPlan"];
}) {
  const rejected =
    rejectedCityFromQuery(input.query) ||
    previousContextCity(input.previousPlan) ||
    normalizedKnownCity(input.city || "");
  const assistantMessage = rejected
    ? `Fair. Dropping ${rejected}. Tell me the city or neighbourhood you actually want, or say “pick nearby” and I’ll choose a better nearby start without dragging Toronto back in.`
    : "Fair. The city got messy. Give me the city or say “pick nearby” and I’ll reset the plan from there.";
  return {
    supported: true,
    mode: "chat",
    planShape: {
      stopCount: 0,
      intensity: "single",
      confidence: 0.92,
      reason: "Conversation state reset a rejected city anchor.",
    },
    region: {
      name: "Ontario",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      lat: 0,
      lng: 0,
    },
    context: {
      dayName: "",
      localHour: 0,
      daypart: "",
      tags: ["city-reset"],
    },
    ai: {
      provider: "echoo-state",
      model: "deterministic",
      assistantMessage,
      routeTitle: "",
      suggestedPills: ["Pick nearby", "Use Markham", "Use Toronto"],
    },
    summary: "",
    plans: [],
  };
}

function guidedPlanPayload(input: {
  query: string;
  city?: string;
  state: ConversationState;
}) {
  const city = input.state.city || cityHintFromInput(input.query, input.city);
  const frame = input.state.frame;
  let assistantMessage = companionRecoveryMessage({
    query: input.query,
    city,
    state: input.state,
  });
  let suggestedPills = ["Widen nearby", "Stay local", "Food first"];

  if (
    frame.dietarySignals.length &&
    ["food", "cultural_food", "date_night", "outing"].includes(frame.planKind)
  ) {
    const subject = frame.cuisine || frame.dietarySignals[0] || "That plan";
    assistantMessage = `${subject} needs one safety check before places: ${frame.dietarySignals[0]}. Keep that constraint hard, then the plan can become one confident first stop instead of a risky guess.`;
    suggestedPills = ["Keep it safe", "Widen area", "No second stop"];
  } else if (frame.planKind === "cultural_food" && frame.nextMove === "widen") {
    assistantMessage = `${frame.cuisine || "That"} food, properly. ${city} may be too narrow tonight; Scarborough or North York gives you the better lane. Stay local only if you want softer food-first, not the real hunt.`;
    suggestedPills = ["Use Scarborough", "Use North York", "Stay Markham"];
  } else if (frame.planKind === "date_night") {
    assistantMessage = `${city} date-night brief is clear: warm room, easy food, no errand energy. One warm first stop, then dessert or a short walk if the night has room.`;
    suggestedPills = ["Build it close", "Make it sweeter", "Add dinner"];
  } else if (frame.planKind === "food") {
    assistantMessage = `${city} goes food-first here. One real meal, then a short walk or dessert nearby. No giant list, just the stop that makes the night make sense.`;
    suggestedPills = ["Find dinner", "Add dessert", "Keep it cheap"];
  } else if (frame.planKind === "outing") {
    assistantMessage = `${city} can stay simple: one easy first stop, then food or a short walk nearby if the night has room.`;
    suggestedPills = ["Quiet and food", "Lively night", "Sweet date"];
  }

  return {
    supported: true,
    mode: "chat",
    planShape: {
      stopCount: 0,
      intensity: "single",
      confidence: 0.9,
      reason: "Guided companion planning response.",
    },
    region: {
      name: city,
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      lat: 0,
      lng: 0,
    },
    context: {
      dayName: "",
      localHour: 0,
      daypart: "",
      tags: [frame.planKind, frame.cuisine, frame.audience].filter(Boolean),
    },
    ai: {
      provider: "echoo-orchestrator",
      model: "deterministic",
      assistantMessage,
      routeTitle: "",
      suggestedPills,
    },
    summary: "",
    plans: [],
  };
}

function deterministicSuggestedPills(query = "") {
  const text = query.toLowerCase();
  if (
    /hard|terrible|overwhelmed|sad|stress|stressed|breathe|quiet|alone/.test(
      text,
    )
  ) {
    return ["Somewhere quiet", "Food after", "Start over"];
  }
  if (/surprise|decide|pick for me|anything/.test(text)) {
    return ["Make it cheaper", "Add food", "Change city"];
  }
  if (/food|lunch|dinner|eat|restaurant|cafe|coffee/.test(text)) {
    return ["Closer", "Quieter", "Add a second stop"];
  }
  return ["Build a plan", "Find events", "Surprise me"];
}

function isNoCityQuery(query = "") {
  return /\b(i don't know any city|i dont know any city|don't know my way around|dont know my way around|not sure where|anywhere in ontario)\b/i.test(
    query,
  );
}

function wantsLivelyHangout(query = "") {
  return /\b(loud|lively|rowdy|energy|music|hangout|party|bar|nightlife)\b/i.test(
    query,
  );
}

function mentionedCities(query = "") {
  const text = cleanText(query);
  if (!text) return [];
  return ONTARIO_CITY_NAMES.filter((cityName) => {
    const pattern = new RegExp(
      `\\b${cityName.replace(/\s+/g, "\\s+")}\\b`,
      "i",
    );
    return pattern.test(text);
  });
}

function correctionCityFromQuery(
  query = "",
  previousPlan?: PlanPayload["previousPlan"],
) {
  const text = query.toLowerCase();
  const cities = mentionedCities(query);
  const contrastMatch = query.match(
    /\b(?:talking about|focused on|focusing on|using|switched to)\s+([a-z\s]+?)\s+(?:and\s+)?not\s+([a-z\s]+?)(?:[.!?]|$)/i,
  );
  if (contrastMatch) {
    const intended = normalizedKnownCity(contrastMatch[2]);
    if (intended) return intended;
  }
  const notCity = cities.find((city) =>
    new RegExp(`\\bnot\\s+${city.replace(/\s+/g, "\\s+")}\\b`, "i").test(query),
  );
  const meantCity = cities.find((city) =>
    new RegExp(
      `\\b(?:meant|mean|said|stay(?:ing)?\\s+(?:in|on)?|stick(?:ing)?\\s+(?:with|to)?|keep\\s+(?:it\\s+)?(?:in|on)?)\\s+${city.replace(/\s+/g, "\\s+")}\\b`,
      "i",
    ).test(query),
  );
  const previousCity = previousContextCity(previousPlan);
  if (meantCity && meantCity !== notCity) return meantCity;
  if (
    previousCity &&
    (!cities.length || !notCity || previousCity !== notCity)
  ) {
    return previousCity;
  }
  if (
    cities.length >= 2 &&
    /not|instead|rather|actually|meant|mean/.test(text)
  ) {
    return cities.find((city) => city !== notCity) || previousCity || "";
  }
  return previousCity || cities[0] || "";
}

function isCityCorrectionQuery(
  query = "",
  previousPlan?: PlanPayload["previousPlan"],
) {
  const text = query.toLowerCase();
  const previousCity = previousContextCity(previousPlan);
  const cities = mentionedCities(query);
  if (!previousCity && cities.length < 2) return false;
  if (
    !cities.length &&
    /\b(how do you mean|what do you mean|i'?m confused|i am confused|confused|i don'?t get|huh|lost me)\b/i.test(
      text,
    )
  ) {
    return false;
  }
  return /\b(wrong city|not\s+\w+|not in|not around|i meant|i mean|talking about|focused on|focus on|stay on|stay in|stick with|keep it in|we were talking|you switched|switching cities)\b/i.test(
    text,
  );
}

function rejectedCityFromQuery(query = "") {
  const cities = mentionedCities(query);
  return (
    cities.find((city) =>
      new RegExp(
        `\\b(?:not\\s+(?:even\\s+)?(?:talking\\s+about|asking\\s+about|focused\\s+on|in|around)?\\s*|don't\\s+mean\\s+|dont\\s+mean\\s+)${city.replace(/\s+/g, "\\s+")}\\b`,
        "i",
      ).test(query),
    ) || ""
  );
}

function isCityRejectionWithoutReplacement(
  query = "",
  previousPlan?: PlanPayload["previousPlan"],
) {
  const rejected = rejectedCityFromQuery(query);
  if (!rejected) return false;
  const cities = mentionedCities(query);
  const replacement = cities.find((city) => city !== rejected);
  if (replacement) return false;
  const previousCity = previousContextCity(previousPlan);
  return !previousCity || previousCity === rejected;
}

function isGtaCity(city = "") {
  const normalized = normalizedKnownCity(city);
  return GTA_CITY_NAMES.some((gtaCity) => gtaCity === normalized);
}

function regionalRelationshipLine(city = "", otherCity = "") {
  const normalizedCity = normalizedKnownCity(city);
  const normalizedOther = normalizedKnownCity(otherCity);
  if (normalizedCity && normalizedOther && normalizedCity !== normalizedOther) {
    if (isGtaCity(normalizedCity) && isGtaCity(normalizedOther)) {
      return `${normalizedCity} and ${normalizedOther} are both GTA, but they are not interchangeable.`;
    }
    return `${normalizedCity} and ${normalizedOther} are separate places, so I should not blur them together.`;
  }
  if (isGtaCity(normalizedCity)) {
    return `${normalizedCity} sits in the GTA orbit, so nearby city context can help without replacing the actual place you asked for.`;
  }
  return "";
}

function inferMood(query = ""): ConversationMood {
  const text = query.toLowerCase();
  if (
    isWellbeingQuery(query) ||
    /\b(test|testing|are you working|broken|robot|real|alive)\b/.test(text)
  ) {
    return "testing";
  }
  if (
    /\b(hard|terrible|sad|low|overwhelmed|stress|stressed|breathe|tired|lonely)\b/.test(
      text,
    )
  ) {
    return "low";
  }
  if (
    /\b(calm|quiet|chill|chilled|peaceful|soft|slow|nothing rowdy)\b/.test(text)
  ) {
    return "calm";
  }
  if (wantsLivelyHangout(query)) return "lively";
  if (/\b(weather|forecast|how much|when|where|which|best)\b/.test(text)) {
    return "practical";
  }
  if (/\b(surprise|random|different|new|curious|explore)\b/.test(text)) {
    return "curious";
  }
  return "open";
}

function cityConfidenceFor(
  query = "",
  city = "",
  previousPlan?: PlanPayload["previousPlan"],
): ConversationState["cityConfidence"] {
  if (hasExplicitOntarioScope(query)) return "province";
  if (cityFromQuery(query)) return "query";
  if (previousContextCity(previousPlan)) return "previous";
  const cleaned = cleanText(city);
  if (!cleaned) return "unknown";
  if (isProvinceOnlyCity(cleaned)) return "province";
  return "profile";
}

function conversationStateMeta(state: ConversationState) {
  return {
    intent: state.intent,
    strategy: state.strategy,
    mood: state.mood,
    city: state.city,
    cityConfidence: state.cityConfidence,
    isTesting: state.isTesting,
    wantsWeather: state.wantsWeather,
    wantsLocalPlan: state.wantsLocalPlan,
    needsSmartSuggestion: state.needsSmartSuggestion,
    previousItemCount: state.previousItems.length,
    frame: {
      planKind: state.frame.planKind,
      cuisine: state.frame.cuisine,
      audience: state.frame.audience,
      discoveryMode: state.frame.discoveryMode,
      nextMove: state.frame.nextMove,
      dietarySignals: state.frame.dietarySignals,
    },
    safety: state.safety,
    decision: {
      version: state.decision.version,
      toolDecision: state.decision.toolDecision,
    },
    route: {
      action: state.route.action,
      toolDecision: state.route.toolDecision,
    },
    weather: state.weather
      ? {
          city: state.weather.city,
          label: state.weather.label,
          temperatureC: state.weather.temperatureC,
        }
      : null,
  };
}

function previousGuidedNeedsAnswer(previousPlan?: PlanPayload["previousPlan"]) {
  if (!previousPlan?.conversationState) return false;
  if (previousPlanItems(previousPlan).length) return false;
  const strategy = previousPlan.conversationState.strategy;
  const nextMove = previousPlan.conversationState.frame?.nextMove;
  return (
    strategy === "guided_plan" &&
    (!nextMove || nextMove === "ask_one" || nextMove === "widen")
  );
}

function previousLocalPlanAttempt(previousPlan?: PlanPayload["previousPlan"]) {
  const city = previousContextCity(previousPlan);
  if (!city) return false;
  const strategy = previousPlan?.conversationState?.strategy || "";
  const planKind = previousPlan?.conversationState?.frame?.planKind || "";
  const previousText = cleanText(
    previousPlan?.ai?.assistantMessage || previousPlan?.summary,
  );
  return Boolean(
    strategy === "guided_plan" ||
    strategy === "retrieval_plan" ||
    ["food", "cultural_food", "date_night", "outing"].includes(planKind) ||
    /\b(plan|place|places|stop|stops|cafe|coffee|park|gallery|district|restaurant|food|afternoon|evening)\b/i.test(
      previousText,
    ),
  );
}

function resolvesGuidedChoice(query = "") {
  return /\b(yes|yeah|yep|ok|okay|sure|that|this|first|second|third|mid|medium|moderate|middle|balanced|not too quiet|not too lively|chill|chilled|quiet|calm|walk|walking|trail|park|food|bite|dinner|lunch|dessert|lively|late|sweet|date|local|nearby|stay|use|build|generate|save|finalize|go with|i like|like|sounds good)\b/i.test(
    query,
  );
}

function wantsVisibleCards(query = "") {
  return /\b(let me see|show me|show them|see them|see those|see these|where are they|what are they|cards?|places?|stops?)\b/i.test(
    query,
  );
}

function isConfusionQuery(query = "") {
  return /\b(i don't get|i dont get|dont get|don't get|confused|not clear|unclear|what do you mean|how do you mean|huh|lost me|yu|you mean)\b/i.test(
    query,
  );
}

function mergePendingPlanFrame(
  frame: CompanionFrame,
  previousPlan?: PlanPayload["previousPlan"],
): CompanionFrame {
  const previousFrame = previousPlan?.conversationState?.frame || {};
  const planKind =
    frame.planKind === "none" || frame.planKind === "weather"
      ? previousFrame.planKind || "outing"
      : frame.planKind;
  const dietarySignals = frame.dietarySignals.length
    ? frame.dietarySignals
    : previousFrame.dietarySignals || [];
  return {
    planKind,
    cuisine: frame.cuisine || previousFrame.cuisine || "",
    audience:
      frame.audience !== "unknown"
        ? frame.audience
        : previousFrame.audience || "unknown",
    discoveryMode:
      frame.discoveryMode !== "unknown"
        ? frame.discoveryMode
        : previousFrame.discoveryMode || "unknown",
    nextMove: dietarySignals.length ? "ask_one" : "retrieve",
    dietarySignals,
  };
}

function retrievalQueryForState(input: {
  query: string;
  state: ConversationState;
  previousPlan?: PlanPayload["previousPlan"];
}) {
  const query = cleanText(input.query);
  const previousText = cleanText(
    input.previousPlan?.ai?.assistantMessage || input.previousPlan?.summary,
  );
  if (
    previousGuidedNeedsAnswer(input.previousPlan) &&
    /\b(mid|medium|moderate|middle|balanced|not too quiet|not too lively)\b/i.test(
      query,
    )
  ) {
    return "relaxed cafe restaurant park plan";
  }
  if (
    previousLocalPlanAttempt(input.previousPlan) &&
    /\b(generate|save|finalize|make it|build it|make my plan|generate my plan|save it)\b/i.test(
      query,
    )
  ) {
    return input.state.city === "Toronto"
      ? "relaxed cafe gallery park plan"
      : "quiet walk cafe restaurant plan";
  }
  if (
    (wantsVisibleCards(query) || isConfusionQuery(query)) &&
    previousLocalPlanAttempt(input.previousPlan)
  ) {
    if (input.state.city === "Toronto") {
      return "relaxed cafe gallery park plan";
    }
    if (/\b(friend|friends|group)\b/i.test(`${query} ${previousText}`)) {
      return "cafe restaurant plan";
    }
    return "quiet walk cafe park plan";
  }
  if (
    input.state.needsSmartSuggestion &&
    input.state.frame.planKind === "outing"
  ) {
    return input.state.city === "Toronto"
      ? "relaxed cafe gallery park plan"
      : "quiet walk cafe park plan";
  }
  if (
    input.state.frame.planKind === "outing" &&
    /\b(tonight|this evening|today|right now|near me|nearby)\b/i.test(query)
  ) {
    return input.state.city === "Toronto"
      ? "relaxed cafe gallery park plan"
      : "quiet walk cafe restaurant plan";
  }
  if (
    input.state.frame.planKind === "outing" &&
    /\b(morning|activity|activities|things to do|best)\b/i.test(query)
  ) {
    return "morning cafe park museum plan";
  }
  if (
    input.state.frame.planKind === "outing" &&
    /\b(relax|nerves|breathe|reset|quiet|calm|peaceful|soft|chill|chilled|walk|walking|trail|park)\b/i.test(
      query,
    )
  ) {
    return "quiet walk cafe park plan";
  }
  if (
    input.state.frame.audience === "group" &&
    input.state.frame.planKind === "outing"
  ) {
    return "cafe restaurant plan";
  }
  if (
    previousGuidedNeedsAnswer(input.previousPlan) &&
    input.state.frame.planKind === "outing" &&
    query.split(/\s+/).filter(Boolean).length <= 6
  ) {
    const shape =
      input.state.mood === "lively"
        ? "lively room late bite"
        : /\b(date|sweet)\b/i.test(query)
          ? "sweet low-key date"
          : "quiet walk food";
    return `${query} ${shape} ${input.state.city} plan`;
  }
  if (
    input.state.frame.planKind === "outing" &&
    /\b(chill|chilled|quiet|calm|relax|nerves|breathe|reset|walk|walking|trail|park)\b/i.test(
      query,
    )
  ) {
    return "quiet walk cafe park plan";
  }
  return query;
}

function withConversationState<T extends Record<string, unknown>>(
  payload: T,
  state: ConversationState,
) {
  const finalPayload =
    state.strategy === "policy_identity"
      ? payload
      : polishPayloadVoice(payload, {
          query: state.query,
          city: state.city,
          state,
        });
  return {
    ...finalPayload,
    conversationState: conversationStateMeta(state),
  };
}

function companionMemoryState(
  state: ConversationState,
): CompanionMemoryState & {
  decision: { toolDecision?: string };
  safety: { flags?: string[] };
  route: { action: string; reason: string };
} {
  return {
    city: state.city,
    cityConfidence: state.cityConfidence,
    intent: state.intent,
    strategy: state.strategy,
    mood: state.mood,
    constraints: {
      frame: state.frame,
      safety: state.safety,
      wantsWeather: state.wantsWeather,
      wantsLocalPlan: state.wantsLocalPlan,
    },
    decision: {
      toolDecision: state.decision.toolDecision,
    },
    safety: {
      flags: state.safety.flags,
    },
    route: {
      action: state.route.action,
      reason: state.route.reason,
    },
  };
}

async function buildConversationState(input: {
  query: string;
  body: PlanPayload;
}): Promise<ConversationState> {
  const query = input.query;
  const body = input.body;
  const previousItems = previousPlanItems(body.previousPlan);
  const cityConfidence = cityConfidenceFor(
    query,
    cleanText(body.city),
    body.previousPlan,
  );
  const mood = inferMood(query);
  const provinceScope = hasExplicitOntarioScope(query);
  const cityReset =
    !provinceScope &&
    isCityRejectionWithoutReplacement(query, body.previousPlan);
  const cityCorrection =
    !provinceScope && isCityCorrectionQuery(query, body.previousPlan);
  const city = cityReset
    ? "Ontario"
    : cityCorrection
      ? correctionCityFromQuery(query, body.previousPlan) ||
        defaultOntarioCity(query, cleanText(body.city), body.previousPlan)
      : defaultOntarioCity(query, cleanText(body.city), body.previousPlan);
  let frame = buildCompanionFrame({
    query,
    city,
    profile: body.profile,
  });
  const resolvesPendingPlan =
    body.mode === "chat" &&
    previousGuidedNeedsAnswer(body.previousPlan) &&
    resolvesGuidedChoice(query);
  if (resolvesPendingPlan) {
    frame = mergePendingPlanFrame(frame, body.previousPlan);
  }
  const shouldShowPreviousAsCards =
    body.mode === "chat" &&
    previousItems.length === 0 &&
    wantsVisibleCards(query) &&
    previousLocalPlanAttempt(body.previousPlan);
  const shouldRecoverLocalPlan =
    body.mode === "chat" &&
    previousItems.length === 0 &&
    isConfusionQuery(query) &&
    previousLocalPlanAttempt(body.previousPlan);
  const shouldFinalizePreviousPlan =
    body.mode === "chat" &&
    previousItems.length === 0 &&
    previousLocalPlanAttempt(body.previousPlan) &&
    /\b(generate|save|finalize|make it|build it|make my plan|generate my plan|save it)\b/i.test(
      query,
    );
  if (
    shouldFinalizePreviousPlan ||
    ((shouldShowPreviousAsCards || shouldRecoverLocalPlan) &&
      (frame.planKind === "none" || frame.planKind === "weather"))
  ) {
    frame = mergePendingPlanFrame(frame, body.previousPlan);
  }
  const wantsWeather = isWeatherQuery(query) && !resolvesPendingPlan;
  const cityOrientation = hasCityOrientationIntent(query, city);
  const wantsLocalPlan =
    isOntarioLocalQuery(query, city) ||
    ["food", "cultural_food", "date_night", "outing"].includes(frame.planKind);
  const vagueOntario =
    isNoCityQuery(query) && /ontario/i.test(`${query} ${body.city || ""}`);
  const startsNewLocalPlan =
    body.mode === "chat" &&
    previousItems.length > 0 &&
    isNewLocalPlanningQuery(query, city, body.previousPlan);
  const asksForPlanExplanation =
    body.mode === "chat" && previousItems.length > 0 && isConfusionQuery(query);
  const isFollowUp =
    body.mode === "chat" &&
    previousItems.length > 0 &&
    !startsNewLocalPlan &&
    (asksForPlanExplanation || isFollowUpQuery(query));
  const isTesting =
    isWellbeingQuery(query) ||
    /\b(test|testing|robot|real|alive|working|broken)\b/i.test(query);
  const needsSmartSuggestion =
    vagueOntario ||
    /\b(surprise|random|pick for me|i don't know|i dont know|not sure|anything|somewhere)\b/i.test(
      query,
    );

  let intent: ConversationIntent = "companion";
  let strategy: ConversationStrategy = "model_companion";
  let weather: WeatherSnapshot | null = previousWeatherSnapshot(
    body.previousPlan,
  );

  if (isModelMetaQuery(query)) {
    intent = "identity";
    strategy = "policy_identity";
  } else if (cityReset) {
    intent = "city_reset";
    strategy = "city_reset";
  } else if (cityCorrection) {
    intent = "city_correction";
    strategy = "city_correction";
  } else if (isWellbeingQuery(query)) {
    intent = "wellbeing";
    strategy = "companion_checkin";
  } else if (wantsWeather) {
    intent = "weather";
    strategy = "weather_read";
  } else if (cityOrientation) {
    intent = "city_orientation";
    strategy = "city_orientation";
  } else if (isFollowUp) {
    intent = "followup";
    strategy = "plan_followup";
  } else if (vagueOntario) {
    intent = "vague_ontario";
    strategy = "choose_city_companion";
  } else if (
    (resolvesPendingPlan ||
      shouldShowPreviousAsCards ||
      shouldRecoverLocalPlan ||
      shouldFinalizePreviousPlan) &&
    frame.nextMove === "retrieve" &&
    wantsLocalPlan
  ) {
    intent =
      frame.planKind === "cultural_food"
        ? "cultural_food"
        : frame.planKind === "date_night"
          ? "date_night"
          : frame.planKind === "food"
            ? "food_plan"
            : "local_plan";
    strategy = "retrieval_plan";
  } else if (frame.nextMove === "ask_one" || frame.nextMove === "widen") {
    intent =
      frame.planKind === "cultural_food" ? "cultural_food" : "local_plan";
    strategy = "guided_plan";
  } else if (wantsLocalPlan) {
    intent =
      frame.planKind === "cultural_food"
        ? "cultural_food"
        : frame.planKind === "date_night"
          ? "date_night"
          : frame.planKind === "food"
            ? "food_plan"
            : "local_plan";
    strategy = "retrieval_plan";
  }

  if (
    wantsWeather ||
    strategy === "choose_city_companion" ||
    /\b(today|tonight|this afternoon|this evening)\b/i.test(query)
  ) {
    weather = await fetchWeatherSnapshot({
      query,
      city,
      lat: optionalNumber(body.lat),
      lng: optionalNumber(body.lng),
      previousPlan: body.previousPlan,
    });
  }
  const safety = buildSafetyVerdict({
    query,
    frame,
    profile: body.profile,
  });
  const decision = buildCompanionDecision({
    intent,
    strategy,
    city,
    cityConfidence,
    frame,
    safety,
  });
  const route = routeCompanionTurn({
    strategy,
    toolDecision: decision.toolDecision,
    weatherAvailable: Boolean(weather),
  });

  return {
    query,
    mode: cleanText(body.mode, "chat"),
    city,
    cityConfidence,
    mood,
    intent,
    strategy,
    previousItems,
    isTesting,
    wantsWeather,
    wantsLocalPlan,
    needsSmartSuggestion,
    weather,
    frame,
    safety,
    decision,
    route,
  };
}

function smartCompanionSuggestion(state: ConversationState) {
  if (state.previousItems.length) {
    const quiet = state.previousItems.find((item) =>
      /museum|gallery|park|library|cafe|coffee|quiet|calm|heritage/i.test(
        `${item.title} ${item.category} ${item.note}`,
      ),
    );
    const lively = state.previousItems.find((item) =>
      /music|bar|nightlife|event|concert|loud|lively/i.test(
        `${item.title} ${item.category} ${item.note}`,
      ),
    );
    return state.mood === "lively"
      ? lively?.title || state.previousItems[0].title
      : quiet?.title || state.previousItems[0].title;
  }
  if (state.mood === "calm" || state.mood === "low") {
    return state.city === "Markham"
      ? "Markham Museum, then a quiet cafe nearby"
      : "AGO, then coffee within a short walk";
  }
  if (state.mood === "lively") {
    return state.city === "Toronto"
      ? "a west-end music room, then late food"
      : "a busy food hall, then dessert nearby";
  }
  return state.city === "Markham"
    ? "Main Street Unionville, then one easy food stop"
    : "Kensington first, then a small food stop";
}

function vagueOntarioPayload(input: {
  query: string;
  city?: string;
  previousPlan?: PlanPayload["previousPlan"];
  weather?: WeatherSnapshot | null;
  state?: ConversationState;
}) {
  const city = defaultOntarioCity(input.query, input.city, input.previousPlan);
  const lively = wantsLivelyHangout(input.query);
  const weatherLine =
    input.weather && isWeatherQuery(input.query)
      ? `${input.weather.city} is ${Math.round(
          input.weather.temperatureC,
        )}°C and ${input.weather.label}. `
      : "";
  const suggestion = input.state
    ? smartCompanionSuggestion(input.state)
    : lively
      ? "a west-end music room, then late food"
      : "one easy place, then one food stop";
  const assistantMessage = lively
    ? `${weatherLine}Toronto is the move for a loud hangout if you don’t know Ontario yet. Try ${suggestion}. Keep it to two places so the night has shape.`
    : `${weatherLine}${city} is the place to start. Try ${suggestion}. No homework, no giant Ontario search.`;
  return {
    supported: true,
    mode: "chat",
    planShape: {
      stopCount: 0,
      intensity: "single",
      confidence: 0.88,
      reason: "Companion chose a launch city for vague Ontario planning.",
    },
    region: {
      name: lively ? "Toronto" : city,
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      lat: 0,
      lng: 0,
    },
    context: {
      dayName: "",
      localHour: 0,
      daypart: "",
      tags: lively ? ["lively", "two-stop"] : ["simple", "two-stop"],
    },
    ai: {
      provider: "echoo-companion",
      model: "deterministic",
      assistantMessage,
      routeTitle: "",
      suggestedPills: lively
        ? ["Make it Toronto", "Less loud", "Add food"]
        : ["Use Markham", "Use Toronto", "Surprise me"],
    },
    summary: "",
    plans: [],
  };
}

const CITY_ORIENTATION: Record<string, string> = {
  Toronto:
    "Toronto is a city of neighbourhoods rather than one single experience: the pace, food, parks, and culture can change completely a few blocks over. Learn it one area at a time and it quickly starts to feel much smaller and more personal.",
  Markham:
    "Markham is calmer and more spread out than central Toronto, with distinct pockets for food, heritage, shopping, parks, and quiet time. Getting to know Unionville, Highway 7, and the areas around you gives the city a much clearer shape.",
  Scarborough:
    "Scarborough is large, varied, and full of strong local pockets rather than one obvious centre. Its food, parks, waterfront, and community spaces make more sense when you explore one area at a time.",
  "North York":
    "North York moves between busy urban corridors and quieter residential pockets, so the right plan depends heavily on the neighbourhood. Start close to where you are and let the city feel local before trying to cover too much.",
  Mississauga:
    "Mississauga has several very different rhythms, from dense city-centre energy to lakeside and neighbourhood pockets. It becomes easier to love when you choose one area for the day instead of treating it as one big suburb.",
  Brampton:
    "Brampton is broad, community-led, and more varied than a quick drive through suggests. The best way to settle in is to learn the food, green space, and local gathering spots closest to your own routine.",
  Hamilton:
    "Hamilton has a strong local character: creative pockets, older neighbourhoods, food, and nature all sit close enough to make a day feel textured without becoming complicated. Pick one side of the city first and let it reveal itself gradually.",
  Ottawa:
    "Ottawa can feel orderly at first, but it opens up through its neighbourhoods, museums, markets, parks, and river paths. Give yourself one small area at a time and it becomes much warmer than the postcard version.",
  Ontario:
    "Ontario is too varied to treat as one place. The useful question is which kind of city or day you want: big-city energy, a quieter main street, water, culture, food, or a small reset close to home.",
};

function cityOrientationMessage(city = "Ontario") {
  return (
    CITY_ORIENTATION[city] ||
    `${city} has its own rhythm, and the quickest way to understand it is through a few neighbourhoods rather than a giant checklist. Start close to your routine, notice where people actually gather, and the city will start to feel like yours.`
  );
}

function cityOrientationPayload(input: { state: ConversationState }) {
  const city = input.state.city || "Ontario";
  return {
    supported: true,
    mode: "chat",
    planShape: {
      stopCount: 0,
      intensity: "single",
      confidence: 0.92,
      reason: "City orientation response.",
    },
    region: {
      name: city,
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      lat: 0,
      lng: 0,
    },
    context: {
      dayName: "",
      localHour: 0,
      daypart: "",
      tags: ["city-orientation"],
    },
    ai: {
      provider: "echoo-city-guide",
      model: "deterministic",
      assistantMessage: cityOrientationMessage(city),
      routeTitle: "",
      suggestedPills: ["Neighbourhoods", "Tonight nearby", "First weekend"],
    },
    summary: "",
    plans: [],
  };
}

function previousPlanItems(previousPlan?: PlanPayload["previousPlan"]) {
  const items = [
    ...(Array.isArray(previousPlan?.plans) ? previousPlan?.plans || [] : []),
    ...(Array.isArray(previousPlan?.recommendations)
      ? previousPlan?.recommendations || []
      : []),
  ];
  return items
    .map((item) => ({
      title: cleanText(item.title || item.name),
      category: cleanText(item.category || item.type),
      city: cleanText(item.city),
      note: cleanText(item.reason || item.why || item.vibe || item.description),
    }))
    .filter((item) => item.title)
    .slice(0, 4);
}

function previousStructuredCards(previousPlan?: PlanPayload["previousPlan"]) {
  const items = [
    ...(Array.isArray(previousPlan?.plans) ? previousPlan?.plans || [] : []),
    ...(Array.isArray(previousPlan?.recommendations)
      ? previousPlan?.recommendations || []
      : []),
  ];
  const seen = new Set<string>();
  return items
    .filter((item) => {
      const title = cleanText(item.title || item.name);
      if (!title || seen.has(title)) return false;
      seen.add(title);
      return true;
    })
    .slice(0, 4);
}

function isFollowUpQuery(query = "") {
  return /\b(these|those|this|that|it|they|them|good|sure|calm|quiet|rowdy|loud|busy|afternoon|hangout|hangouts|honestly|nothing|not too|instead|which|keep|remove|swap|better|direction|directions|route|map|address|get there|yes|no|okay|ok)\b/i.test(
    query,
  );
}

function isPureCompanionQuery(query = "") {
  const text = cleanText(query)
    .toLowerCase()
    .replace(/[.!?]+$/g, "")
    .trim();
  if (
    /^(good morning|good afternoon|good evening|morning|afternoon|evening|hi|hello|hey)( echoo| there| friend| my friend)?$/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /^(?:(?:okay|ok|alright|all right|got it)[,\s]+)?(?:thank you|thanks|appreciate you|appreciate it)( echoo| friend| my friend)?$/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /\b(i(?:'ve| have)? heard you|you(?:'ve| have) already (?:said|told)|stop repeating|don'?t repeat|enough already|leave it there|no more plan)\b/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /(?:^|\s)(?:bye|goodbye|take care|talk (?:soon|later)|see you|have a (?:good|great|nice|lovely) (?:day|night))(?:[.!?]|$)/.test(
      text,
    )
  ) {
    return true;
  }
  if (
    /^(how[’']?s your day( going)?( today)?|how is your day( going)?( today)?|are you okay|are you ok|how are you( feeling)?( today)?|you good)$/.test(
      text,
    )
  ) {
    return true;
  }
  return /^(can i talk to you( about something)?|can we talk|talk to you about something)$/.test(
    text,
  );
}

function isWellbeingQuery(query = "") {
  return hasWellbeingIntent(query) || isPureCompanionQuery(query);
}

function wellbeingPayload(
  query: string,
  city = "",
  previousPlan?: PlanPayload["previousPlan"],
) {
  const cityName = cityHintFromInput(query, city, previousPlan);
  const previous = cleanText(
    previousPlan?.ai?.assistantMessage || previousPlan?.summary,
  ).toLowerCase();
  const text = query.toLowerCase();
  const repeatedFeeling =
    previous.includes("steady") ||
    previous.includes("listening properly") ||
    previous.includes("still here") ||
    previous.includes("heavy");
  let assistantMessage = "Good. Present. What kind of day are we working with?";
  if (
    /\b(i(?:'ve| have)? heard you|you(?:'ve| have) already (?:said|told)|stop repeating|don'?t repeat|enough already|leave it there|no more plan)\b/.test(
      text,
    )
  ) {
    assistantMessage = "You're right. I'll leave it there.";
  } else if (
    /(?:^|\s)(?:bye|goodbye|take care|talk (?:soon|later)|see you|have a (?:good|great|nice|lovely) (?:day|night))(?:[.!?]|$)/.test(
      text,
    )
  ) {
    assistantMessage = "You too. Take care.";
  } else if (/thank you|thanks|appreciate you/.test(text)) {
    assistantMessage = "Anytime. Here when you need me.";
  } else if (
    /good morning|good afternoon|good evening|^morning$|^afternoon$|^evening$/.test(
      text,
    )
  ) {
    const greeting = /afternoon/.test(text)
      ? "Afternoon"
      : /evening/.test(text)
        ? "Evening"
        : "Morning";
    assistantMessage = `${greeting}. Here with you. What are we making easier today?`;
  } else if (
    /how[’']?s your day|how is your day|are you okay|are you ok|how are you|you good|what's wrong|whats wrong|how are you feeling/.test(
      text,
    )
  ) {
    assistantMessage = repeatedFeeling
      ? "Still here, still steady. More importantly, how are you doing?"
      : "Steady here. More importantly, how are you doing?";
  } else if (
    /can i talk to you|can we talk|talk to you about something/.test(text)
  ) {
    assistantMessage = "Absolutely. Tell me what is going on.";
  } else if (
    /getting fat|feel fat|i[’']?m fat|i am fat|workout idea|exercise idea/.test(
      text,
    )
  ) {
    assistantMessage =
      "Let's keep this kind. Start with ten minutes of walking, water, and one simple stretch. No punishment energy.";
  } else if (
    /terrible week|hard week|bad week|overwhelmed|stressed|stressful|sad|lonely|feeling low|feel low|i[’']?m low|i am low|down today|burnt out|burned out|breathe|need air|quiet reset/.test(
      text,
    )
  ) {
    assistantMessage =
      "That sounds heavy. Keep the next move small: breathe, water, one gentle thing. Want quiet company or a tiny plan?";
  } else if (/feeling/.test(text)) {
    assistantMessage = repeatedFeeling
      ? "Still here, still steady. Let's make today easier: quiet, lively, food-first, or something with a bit of air?"
      : "Steady today. More importantly, what kind of pace do you want: quiet, lively, food-first, or outdoors?";
  } else if (/okay|ok|good|wrong/.test(text)) {
    assistantMessage =
      "All good. What do you need next: a real plan, a weather read, or just a slower back-and-forth?";
  }
  return {
    supported: true,
    mode: "chat",
    planShape: {
      stopCount: 0,
      intensity: "single",
      confidence: 0.96,
      reason: "Deterministic companion check-in response.",
    },
    region: {
      name: cityName,
      province: "",
      provinceName: "",
      timezone: "America/Toronto",
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
      provider: "echoo-companion",
      model: "deterministic",
      assistantMessage,
      routeTitle: "",
      suggestedPills: ["Slow afternoon", "Quiet food", "Start fresh"],
    },
    summary: "",
    plans: [],
  };
}

function deterministicPlanFollowUpMessage(input: {
  query: string;
  city?: string;
  previousPlan?: PlanPayload["previousPlan"];
}) {
  const text = input.query.toLowerCase();
  const city =
    cleanText(input.city) ||
    cleanText(
      input.previousPlan?.region?.name || input.previousPlan?.region?.city,
    ) ||
    cityFromQuery(input.query) ||
    "there";
  const items = previousPlanItems(input.previousPlan);
  const names = items.map((item) => item.title);
  const quieter = items.filter((item) =>
    /museum|gallery|park|library|garden|trail|historic|heritage|cafe|coffee|tea|book|art|culture|quiet|calm/i.test(
      `${item.title} ${item.category} ${item.note}`,
    ),
  );
  const busier = items.filter((item) =>
    /bar|pub|nightlife|concert|festival|market|mall|tour|busy|crowd|loud|music/i.test(
      `${item.title} ${item.category} ${item.note}`,
    ),
  );

  if (!items.length) {
    return `Yes, calm is the right brief. Give me the neighbourhood in ${city} and I’ll narrow it to one quiet place plus an easy food stop.`;
  }

  if (
    /\b(direction|directions|route|map|address|get there|how do i get)\b/.test(
      text,
    )
  ) {
    const first = items[0];
    const second = items.find((item) => item.title !== first.title);
    return second
      ? `Use the map button for the route. Start with ${first.title}, then keep ${second.title} as the optional second stop.`
      : `Use the map button for the route. Start with ${first.title} and keep the plan simple.`;
  }

  if (isConfusionQuery(input.query)) {
    const first = quieter[0] || items[0];
    const second = items.find((item) => item.title !== first.title);
    return second
      ? `Fair. Simple version: start with ${first.title}. Keep ${second.title} only if you still feel like a second stop.`
      : `Fair. Simple version: start with ${first.title}. Let that be enough unless you actually want more.`;
  }

  if (
    /\b(ok|okay|yes|sounds good|good)\b/.test(text) &&
    !/rowdy|loud|nothing rowdy|calm|quiet|breathe/.test(text)
  ) {
    const first = items[0];
    const second = items.find((item) => item.title !== first.title);
    return second
      ? `Good. Start with ${first.title}; keep ${second.title} only if you still want a second stop.`
      : `Good. Start with ${first.title} and let that be enough.`;
  }

  if (/rowdy|loud|nothing rowdy|calm|quiet|breathe|sure|good/.test(text)) {
    const keep = quieter.slice(0, 2).map((item) => item.title);
    const skip = busier.find((item) => !keep.includes(item.title))?.title;
    if (keep.length) {
      return `${keep.join(" and ")} fit the calmer version. ${
        skip ? `Leave ${skip} out if you want less noise. ` : ""
      }One slow stop first, then food only if you still feel like it.`;
    }
    return `${
      names[0]
    } is the calmer move here. Start there and only add food if you still want company after.`;
  }

  if (/which|keep|remove|swap|better/.test(text)) {
    const first = quieter[0] || items[0];
    return `Keep ${first.title}. ${
      items[1]?.title
        ? `${items[1].title} can be the optional second stop. `
        : ""
    }Quiet first, food second, home before it starts feeling like effort.`;
  }

  return `${names
    .slice(0, 2)
    .join(
      " and ",
    )} are enough. Start with the place that feels easiest, then keep the second one optional.`;
}

function followUpPayload(input: {
  query: string;
  city?: string;
  previousPlan?: PlanPayload["previousPlan"];
}) {
  const city =
    previousContextCity(input.previousPlan) ||
    cleanText(input.city) ||
    cleanText(
      input.previousPlan?.region?.name || input.previousPlan?.region?.city,
    ) ||
    cityHintFromInput(input.query, input.city, input.previousPlan);
  const visibleCards = previousStructuredCards(input.previousPlan);
  return {
    supported: true,
    mode: "chat",
    planShape: {
      stopCount: 0,
      intensity: "single",
      confidence: 0.92,
      reason: "Fast deterministic follow-up on the previous plan.",
    },
    region: {
      name: city,
      province: "",
      provinceName: "",
      timezone: "America/Toronto",
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
      provider: "echoo-followup",
      model: "deterministic",
      assistantMessage: deterministicPlanFollowUpMessage(input),
      routeTitle: "",
      suggestedPills: ["Make it quieter", "Add food", "Swap one stop"],
    },
    summary: "",
    plans: visibleCards,
  };
}

function deterministicCompanionMessage(input: {
  query: string;
  city?: string;
  profile?: PlanPayload["profile"];
  previousPlan?: PlanPayload["previousPlan"];
}) {
  const query = cleanText(input.query);
  const text = query.toLowerCase();
  const city = cityHintFromInput(query, input.city, input.previousPlan);
  const profile = profileSignals(input.profile);
  const budget = cleanText(profile.budget);
  const energy = cleanText(profile.energy);
  const dietary = [
    ...safeStrings(profile.dietaryRequirements),
    ...safeStrings(profile.allergies),
  ];
  const dietaryLine = dietary.length
    ? ` ${dietary[0]} stays a hard line until a venue is confirmed safe.`
    : "";
  const budgetLine = budget ? ` Keep it around ${budget}.` : "";
  const energyLine = energy ? ` Keep the pace ${energy}.` : "";

  if (
    /hard|terrible|overwhelmed|sad|stress|stressed|breathe|quiet|alone/.test(
      text,
    )
  ) {
    return `That kind of day needs air and no performance.${dietaryLine} Start somewhere quiet in ${city}, then only add food if your body asks for it.${budgetLine}`;
  }

  if (/surprise|decide|pick for me|anything/.test(text)) {
    return `${city} gets one clean move: a neighbourhood shift, one first stop, then food close by.${dietaryLine}${budgetLine}${energyLine}`;
  }

  if (/bored|nothing to do|stuck/.test(text)) {
    return `Bored in ${city} means the plan needs motion, not a huge list.${dietaryLine} Pick one place, add a short walk, then let food be the reward.${budgetLine}`;
  }

  if (/food|lunch|dinner|eat|restaurant|cafe|coffee|date|drink/.test(text)) {
    return `${city} should be narrowed to three things: the room, the walk after, and whether the food fits your constraints.${dietaryLine}${budgetLine}${energyLine}`;
  }

  if (
    /\b(why|how|what|when|who|explain|teach|tell me|help me understand)\b/.test(
      text,
    )
  ) {
    return `Short answer: Echoo can talk through the question, then turn it into a local move when places matter.${dietaryLine}${budgetLine}${energyLine}`;
  }

  return `${city} gets a practical default: one clear first stop, one optional second move, and no giant list.${dietaryLine}${budgetLine}${energyLine}`;
}

function companionPayload(input: {
  query: string;
  city?: string;
  profile?: PlanPayload["profile"];
  previousPlan?: PlanPayload["previousPlan"];
  reason?: string;
}) {
  const city = cityHintFromInput(input.query, input.city, input.previousPlan);
  return {
    supported: true,
    mode: "chat",
    planShape: {
      stopCount: 0,
      intensity: "single",
      confidence: 0.78,
      reason: input.reason || "Deterministic Echoo companion response.",
    },
    region: {
      name: city || "Ontario",
      province: city === "Ontario" ? "ON" : "",
      provinceName: city === "Ontario" ? "Ontario" : "",
      timezone: "America/Toronto",
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
      provider: "echoo-companion",
      model: "deterministic",
      assistantMessage: deterministicCompanionMessage(input),
      routeTitle: "",
      suggestedPills: deterministicSuggestedPills(input.query),
    },
    summary: "",
    plans: [],
  };
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
  if (
    /\b(markville|cf markville|unionville|main street unionville|arkham)\b/.test(
      text,
    )
  ) {
    return "Markham";
  }
  if (
    /\b(ago|art gallery of ontario|rom|royal ontario museum|high park|trinity bellwoods)\b/.test(
      text,
    )
  ) {
    return "Toronto";
  }
  return "";
}

function isOntarioLocalQuery(query: string, city = "") {
  const text = `${query} ${city}`.toLowerCase();
  const hasOntarioCity =
    Boolean(cityFromQuery(text)) ||
    /\bontario\b/.test(text) ||
    !isProvinceOnlyCity(city);
  const hasLocalIntent =
    /\b(plan|route|direction|directions|near|nearby|nice|good|best|worth|vibe|chill|chilled|chilling|quiet|cozy|peaceful|soft|relax|reset|breathe|nerves|walk|walking|trail|today|early|morning|afternoon|surprise|random|somewhere|friend|friends|lunch|dinner|restaurant|restaurants|cafe|coffee|food|eat|eating|cuisine|date|night|tonight|sweet|romantic|baby|partner|beautiful spot|lovely spot|park|museum|gallery|library|libraries|culture|things to do|activity|activities|bar|pub|mall|nigerian|ghanaian|jollof|suya|egusi|halal|vegan)\b/.test(
      text,
    );
  return hasOntarioCity && hasLocalIntent;
}

async function callOntarioPlan(input: {
  req: Request;
  body: PlanPayload;
  query: string;
  state: ConversationState;
}) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured.");

  const city =
    input.state.city ||
    cityFromQuery(input.query) ||
    cleanText(input.body.city);
  const requestCity = normalizedKnownCity(cleanText(input.body.city));
  const resolvedCity = normalizedKnownCity(city);
  const useRequestCoordinates =
    !requestCity || !resolvedCity || requestCity === resolvedCity;
  const plannerQuery = retrievalQueryForState({
    query: input.query,
    state: input.state,
    previousPlan: input.body.previousPlan,
  });
  const response = await fetch(`${supabaseUrl}/functions/v1/ontario-plan`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: input.req.headers.get("Authorization") || "",
      apikey: input.req.headers.get("apikey") || "",
    },
    body: JSON.stringify({
      query: plannerQuery,
      city: city || undefined,
      lat: useRequestCoordinates ? optionalNumber(input.body.lat) : undefined,
      lng: useRequestCoordinates ? optionalNumber(input.body.lng) : undefined,
      intent: input.body.intent || input.state.intent || input.body.mode,
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
      meta: payload?.meta,
    },
  };
}

function geminiModelCandidates() {
  const configured = Deno.env.get("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
  const configuredFallbacks = (Deno.env.get("GEMINI_MODEL_FALLBACKS") || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return uniqueStrings([
    "gemini-2.5-flash",
    configured,
    ...configuredFallbacks,
    DEFAULT_GEMINI_MODEL,
    "gemini-2.0-flash",
    "gemini-flash-latest",
  ]);
}

function shouldTryNextGeminiModel(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /400.*(?:model|schema|mime|generation|invalid argument)|403|404|429|502|503|504|AbortError|aborted|signal|timeout|NOT_FOUND|PERMISSION_DENIED|INVALID_ARGUMENT|RESOURCE_EXHAUSTED|UNAVAILABLE|no longer available|not available|rate limit|high demand|overloaded|forbidden/i.test(
    message,
  );
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
  city?: string;
  profile?: PlanPayload["profile"];
  previousPlan?: PlanPayload["previousPlan"];
  state?: ConversationState;
}): Promise<GeminiAnswer> {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY is not configured.");

  const previous = cleanText(
    input.previousPlan?.ai?.assistantMessage || input.previousPlan?.summary,
  );
  const previousItems = previousPlanItems(input.previousPlan);
  const prompt = [
    companionVoiceRules(),
    "For ordinary non-local chat, answer directly in the product voice. Do not overuse the word Echoo.",
    "If the user is reacting to previous cards, answer that follow-up directly. Do not ask for city/mood again when the previous cards already give context.",
    "For Ontario/local factual planning, do not fabricate hours, prices, events, safety claims, or venue certainty. If you lack enough certainty, ask one natural question or offer a wider nearby area. Never mention records, database, retrieval, validation, imports, backend, provider, or tooling.",
    "Suggested pills must be short and useful. Return no more than three.",
    `Current city hint: ${cityHintFromInput(
      input.query,
      input.city,
      input.previousPlan,
    )}`,
    "If the conversation state has a previous city, preserve it for follow-ups unless the user clearly changes city. Toronto, Markham, Mississauga, Brampton, Vaughan, Richmond Hill, Scarborough, North York, Oakville, and Burlington are connected GTA places, but do not treat one as a replacement for another.",
    `User profile signals: ${JSON.stringify(profileSignals(input.profile))}`,
    input.state
      ? `Conversation state: ${JSON.stringify(
          conversationStateMeta(input.state),
        )}`
      : "",
    previous ? `Previous assistant context: ${previous.slice(0, 1200)}` : "",
    previousItems.length
      ? `Previous visible cards: ${JSON.stringify(previousItems)}`
      : "",
    `User: ${input.query}`,
    "Return JSON with assistantMessage and suggestedPills. Put the complete answer in assistantMessage.",
  ]
    .filter(Boolean)
    .join("\n\n");

  let lastError: unknown = null;
  for (const model of geminiModelCandidates()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(
        `${GEMINI_ENDPOINT}/${model}:generateContent?key=${encodeURIComponent(
          key,
        )}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1200,
              responseMimeType: "application/json",
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

  let body = {} as PlanPayload;
  let query = "";
  let state: ConversationState | null = null;
  let memory: CompanionMemoryContext | null = null;
  let memorySupabase: ReturnType<typeof getSupabaseAdmin> | null = null;

  async function respondWithState<T extends Record<string, unknown>>(
    payload: T,
    responseState: ConversationState,
  ) {
    const responsePayload = withConversationState(payload, responseState);
    if (memorySupabase && memory?.available) {
      try {
        await writeCompanionTurn({
          supabase: memorySupabase,
          memory,
          query: query || cleanText(body.query),
          state: companionMemoryState(responseState),
          response: responsePayload,
        });
      } catch (memoryErr) {
        console.warn("Echoo companion memory write skipped:", memoryErr);
      }
    }
    return jsonResponse(responsePayload);
  }

  try {
    body = (await req.json().catch(() => ({}))) as PlanPayload;
    query = cleanText(body.query);
    if (!query) {
      return jsonResponse({ error: "Ask Echoo something first." }, 400);
    }

    state = await buildConversationState({ query, body });
    try {
      memorySupabase = getSupabaseAdmin();
      memory = await readCompanionMemory({
        supabase: memorySupabase,
        req,
        sessionKey: body.sessionId,
        state: companionMemoryState(state),
      });
    } catch (memoryErr) {
      console.warn("Echoo companion memory read skipped:", memoryErr);
    }

    if (state.route.action === "policy_identity") {
      return await respondWithState(modelMetaPayload(), state);
    }

    if (state.route.action === "companion_checkin") {
      return await respondWithState(
        wellbeingPayload(query, cleanText(body.city), body.previousPlan),
        state,
      );
    }

    if (state.route.action === "weather_read" && state.weather) {
      return await respondWithState(weatherPayload(state.weather), state);
    }

    if (state.route.action === "city_correction") {
      return await respondWithState(
        cityCorrectionPayload({
          query,
          city: cleanText(body.city),
          previousPlan: body.previousPlan,
          weather: state.weather,
        }),
        state,
      );
    }

    if (state.route.action === "city_reset") {
      return await respondWithState(
        cityResetPayload({
          query,
          city: cleanText(body.city),
          previousPlan: body.previousPlan,
        }),
        state,
      );
    }

    if (state.route.action === "city_orientation") {
      return await respondWithState(cityOrientationPayload({ state }), state);
    }

    if (state.route.action === "guided_plan") {
      return await respondWithState(
        guidedPlanPayload({
          query,
          city: cleanText(body.city),
          state,
        }),
        state,
      );
    }

    if (state.route.action === "choose_city_companion") {
      return await respondWithState(
        vagueOntarioPayload({
          query,
          city: cleanText(body.city),
          previousPlan: body.previousPlan,
          weather: state.weather,
          state,
        }),
        state,
      );
    }

    if (state.route.action === "plan_followup") {
      return await respondWithState(
        followUpPayload({
          query,
          city: cleanText(body.city),
          previousPlan: body.previousPlan,
        }),
        state,
      );
    }

    if (state.route.action === "retrieve_places") {
      try {
        const ontarioPlan = await callOntarioPlan({ req, body, query, state });
        return await respondWithState(ontarioPlan, state);
      } catch (err) {
        console.warn(
          "Ontario retrieval plan failed, using deterministic recovery:",
          err,
        );
        return await respondWithState(
          guidedPlanPayload({
            query,
            city: state.city,
            state,
          }),
          state,
        );
      }
    }

    const aiAnswer = await callGemini({
      query,
      city: cleanText(body.city),
      profile: body.profile,
      previousPlan: body.previousPlan,
      state,
    });

    return await respondWithState(
      {
        supported: true,
        mode: "chat",
        planShape: {
          stopCount: 0,
          intensity: "single",
          confidence: 1,
          reason: "General Echoo chat answer.",
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
      },
      state,
    );
  } catch (err) {
    console.error(
      "Echoo companion model path failed, using deterministic response:",
      err,
    );
    if (state) {
      return await respondWithState(
        companionPayload({
          query: query || cleanText(body.query) || "Help me plan something",
          city: cleanText(body.city),
          profile: body.profile,
          previousPlan: body.previousPlan,
          reason:
            "Model path unavailable; deterministic Echoo companion response.",
        }),
        state,
      );
    }
    return jsonResponse(
      companionPayload({
        query: query || cleanText(body.query) || "Help me plan something",
        city: cleanText(body.city),
        profile: body.profile,
        previousPlan: body.previousPlan,
        reason:
          "Model path unavailable; deterministic Echoo companion response.",
      }),
    );
  }
});
