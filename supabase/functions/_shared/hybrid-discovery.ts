export type DiscoveryFeature = {
  slug: string;
  label: string;
  synonyms: string[];
};

export const DISCOVERY_INTENTS = {
  discover: {
    id: "discover",
    label: "Discover",
    providerQuery: "things to do",
  },
  food: {
    id: "food",
    label: "Food",
    providerQuery: "restaurants cafes bakeries and food",
  },
  comedy: {
    id: "comedy",
    label: "Comedy",
    providerQuery: "comedy clubs and live comedy",
  },
  music: {
    id: "music",
    label: "Live music",
    providerQuery: "live music venues concerts and record stores",
  },
  nightlife: {
    id: "nightlife",
    label: "Nightlife",
    providerQuery: "nightlife bars lounges and clubs",
  },
  events: {
    id: "events",
    label: "Events",
    providerQuery: "events shows festivals and performances",
  },
  tourism: {
    id: "tourism",
    label: "Tourism",
    providerQuery: "museums galleries landmarks and attractions",
  },
  search: {
    id: "search",
    label: "Search",
    providerQuery: "things to do",
  },
} as const;

export type DiscoveryIntentId = keyof typeof DISCOVERY_INTENTS;
export type DiscoveryIntent = (typeof DISCOVERY_INTENTS)[DiscoveryIntentId];

export function discoveryTermPattern(expression: string, global = false) {
  return new RegExp(
    `(?<![\\p{L}\\p{N}])(?:${expression})(?![\\p{L}\\p{N}])`,
    global ? "giu" : "iu",
  );
}

export function resolveDiscoveryIntent(
  value: unknown,
  query: unknown = "",
): DiscoveryIntent {
  const explicit = cleanDiscoveryText(value, 32).toLowerCase();
  if (explicit in DISCOVERY_INTENTS) {
    return DISCOVERY_INTENTS[explicit as DiscoveryIntentId];
  }

  const text = cleanDiscoveryText(query, 160).toLowerCase();
  if (
    !text ||
    discoveryTermPattern("discover|trending|things to do").test(text)
  ) {
    return DISCOVERY_INTENTS.discover;
  }
  if (
    discoveryTermPattern(
      "restaurants?|food|dining|eat|brunch|bakery|cafes?|coffee",
    ).test(text)
  ) {
    return DISCOVERY_INTENTS.food;
  }
  if (discoveryTermPattern("comedy|stand[ -]?up").test(text)) {
    return DISCOVERY_INTENTS.comedy;
  }
  if (
    discoveryTermPattern("music|concerts?|bands?|djs?|record stores?").test(
      text,
    )
  ) {
    return DISCOVERY_INTENTS.music;
  }
  if (
    discoveryTermPattern(
      "nightlife|bars?|pubs?|lounges?|clubs?|late night",
    ).test(text)
  ) {
    return DISCOVERY_INTENTS.nightlife;
  }
  if (
    discoveryTermPattern("events?|festivals?|performances?|shows?").test(text)
  ) {
    return DISCOVERY_INTENTS.events;
  }
  if (
    discoveryTermPattern(
      "tourism|museums?|galleries?|landmarks?|attractions?|tours?",
    ).test(text)
  ) {
    return DISCOVERY_INTENTS.tourism;
  }
  return DISCOVERY_INTENTS.search;
}

export function cleanDiscoveryText(value: unknown, max = 180) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function optionalDiscoveryNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function clampDiscoveryLimit(value: unknown, fallback = 20, max = 50) {
  const parsed = optionalDiscoveryNumber(value);
  if (parsed === undefined) return fallback;
  return Math.max(1, Math.min(Math.round(parsed), max));
}

export function matchedFeatureSlugs(
  query: string,
  features: DiscoveryFeature[],
) {
  const text = ` ${query.toLowerCase().replace(/[^a-z0-9+]+/g, " ")} `;
  return features
    .filter((feature) =>
      [feature.slug.replace(/_/g, " "), feature.label, ...feature.synonyms]
        .map((term) => term.toLowerCase().trim())
        .filter(Boolean)
        .some((term) => text.includes(` ${term} `)),
    )
    .map((feature) => feature.slug)
    .slice(0, 8);
}

export function encodeDiscoveryCursor(score: unknown, id: unknown) {
  const parsed = Number(score);
  const entityId = cleanDiscoveryText(id, 64);
  if (!Number.isFinite(parsed) || !entityId) return null;
  return btoa(JSON.stringify({ score: parsed, id: entityId }));
}

export function decodeDiscoveryCursor(value: unknown) {
  const cursor = cleanDiscoveryText(value, 512);
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(atob(cursor));
    const score = Number(parsed?.score);
    const id = cleanDiscoveryText(parsed?.id, 64);
    return Number.isFinite(score) && id ? { score, id } : null;
  } catch (_error) {
    return null;
  }
}
