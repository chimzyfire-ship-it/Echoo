// Pure interpretation shared by Discover and the companion. This module never
// invents venue facts. Unverified constraints remain visible to the caller.
export type TravelMode = "walk" | "drive" | "transit";
export type PlanningIntent = {
  query: string;
  searchTerm: string;
  stopCount: 1 | 2 | 3;
  mood: "chill" | "curious" | "hype";
  budgetStyle: "value" | "balanced" | "elevated";
  maxBudget: number | null;
  budgetScope: "person" | "total" | "unknown";
  partySize: number;
  travelMode: TravelMode;
  travelExplicit: boolean;
  day: "now" | "tonight" | "tomorrow" | "weekend";
  openOnly: boolean;
  replaceIndex: number | null;
  excludedTerms: string[];
  notices: string[];
  blockers: string[];
};

const CUISINES =
  /\b(sushi|ramen|jollof|ethiopian|nigerian|caribbean|japanese|korean|chinese|italian|indian|mexican|thai|vietnamese|filipino|jamaican|greek|lebanese|pizza|tacos|burgers?|dumplings?|shawarma|seafood|steak|dim sum|hot pot|bubble tea|matcha)\b/i;
const TOPICS: Array<[RegExp, string]> = [
  [/\b(bowling|bowling alleys)\b/i, "bowling"],
  [/\b(escape rooms?)\b/i, "escape"],
  [/\b(board games?|tabletop)\b/i, "board game"],
  [/\b(climbing|bouldering)\b/i, "climbing"],
  [/\b(pottery|ceramics?)\b/i, "pottery"],
  [/\b(ski|skiing|snowboard(?:ing)?)\b/i, "ski"],
  [/\b(skat(?:e|es|ing)|ice rinks?)\b/i, "skating"],
  [/\b(brewer(?:y|ies)|taprooms?)\b/i, "brewery"],
  [/\b(kayaks?|canoes?|paddleboards?)\b/i, "paddle"],
  [/\b(spas?|saunas?)\b/i, "spa"],
  [/\b(hik(?:e|es|ing)|trails?)\b/i, "trail"],
  [/\b(desserts?|sweet treats?)\b/i, "dessert"],
  [/\b(brunch|breakfast)\b/i, "brunch"],
  [/\b(live music|jazz)\b/i, "live music"],
  [/\b(comedy|stand.up)\b/i, "comedy"],
  [/\b(coffee|caf[eé]s?|espresso|(?:warm|hot) (?:drink|beverage)|hot chocolate)\b/i, "cafe"],
  [/\b(museums?)\b/i, "museum"],
  [/\b(galler(?:y|ies)|art)\b/i, "gallery"],
  [/\b(parks?|nature|trails?)\b/i, "park"],
  [/\b(cocktails?|speakeas(?:y|ies))\b/i, "cocktail bar"],
  [
    /\b(restaurants?|resturants?|restaraunts?|food|dining|eat|dinner|lunch|brunch)\b/i,
    "restaurant",
  ],
  [/\b(bars?|pubs?|nightlife|clubs?)\b/i, "bar"],
];

// Strong user-specified targets must survive model interpretation. Broad words
// like park or cafe are not strong targets: they can be part of a more specific
// venue name or activity (trampoline park, cat cafe, ceramics cafe).
export function exactPlanningTarget(query: string): string | null {
  const quoted = query.match(/["“]([^"”]{2,100})["”]/);
  if (quoted && !/\b(?:no|not|avoid|without|exclude|don.t want|do not want)\s*$/i.test(query.slice(0, quoted.index))) return quoted[1];
  for (const match of query.matchAll(new RegExp(CUISINES.source, "gi"))) {
    if (!/\b(?:no|not|avoid|without|exclude|don.t want|do not want)\s*$/i.test(query.slice(0, match.index))) return match[0].toLowerCase();
  }
  return null;
}

export function hasSpecificPlanningTarget(query: string): boolean {
  return CUISINES.test(query) ||
    TOPICS.some(([pattern]) => pattern.test(query)) ||
    /["“]([^"”]{2,100})["”]/.test(query);
}

// Generic categories should use the database's category filter. A text search
// for "park" also matches venue names and makes the spatial query much slower.
export function planningSearchFilter(query: string) {
  const category = query.trim().toLowerCase();
  return ["cafe", "park", "museum", "gallery", "restaurant", "bar", "bakery"]
      .includes(category)
    ? { p_query: null, p_category: category }
    : { p_query: query, p_category: null };
}

export function specificSearchTerm(query: string): string {
  const text = query.replace(
    /\b(no|avoid|without|exclude)\s+(\w+)\s+(?:or|and)\s+/gi,
    "$1 $2, $1 ",
  ).replace(
    /\b(?:no|avoid|without|exclude)\s+(clubs?|bars?|alcohol|parks?|museums?|galleries)\b/gi,
    "",
  ).replace(/\s+/g, " ").trim().slice(0, 240);
  // A quoted venue name is intentional, even if it contains a category word.
  const quoted = text.match(/["“]([^"”]{2,100})["”]/)?.[1];
  if (quoted) return quoted;
  const cuisine = text.match(CUISINES)?.[0];
  if (cuisine) return cuisine.toLowerCase();
  for (const [pattern, term] of TOPICS) if (pattern.test(text)) return term;
  if (/^(discover|trending|popular|things to do)$/i.test(text)) return "";
  // Preserve unknown venue names and cuisines rather than widening to food.
  return text.replace(
    /^(?:please\s+)?(?:find(?: me)?|show me|i(?:'m| am) looking for|i want|looking for)\s+/i,
    "",
  )
    .replace(/\s+(?:near me|nearby|please)[.!?]?$/i, "").trim();
}

export function isPlanningFollowUp(query: string): boolean {
  return /\b(keep|replace|swap|change|make (?:it|the)|second|first|third|another|alternatives?|quieter|cheaper|per person|each|total|walking only|walk only|drive instead|transit instead|lower budget|calmer mood)\b/i
    .test(query) ||
    /^(?:for )?(?:tonight|tomorrow|this weekend|under \$?\d+|for (?:two|three|four|\d+))[.!?]?$/i
      .test(query.trim());
}

export function interpretPlanningQuery(
  query: string,
  previous?: PlanningIntent,
): PlanningIntent {
  const q = query.replace(/\s+/g, " ").trim().slice(0, 500);
  const patch = isPlanningFollowUp(q);
  const base = patch && previous ? previous : undefined;
  const amount = q.match(
    /(?:under|below|less than|up to|budget(?: of)?)\s*\$?\s*(\d+(?:\.\d{1,2})?)/i,
  ) ?? q.match(/\$(\d+(?:\.\d{1,2})?)\s*(?:budget|total|each|per person)/i);
  const party = q.match(
    /\b(?:for|party of|group of)\s+(\d{1,2}|one|two|three|four|five|six)\b/i,
  );
  const words: Record<string, number> = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
  };
  const partySize = party
    ? Math.max(
      1,
      Math.min(20, words[party[1].toLowerCase()] ?? Number(party[1])),
    )
    : /\b(date|couple)\b/i.test(q)
    ? 2
    : base?.partySize ?? 1;
  const travel = /\b(walk(?:ing|able)?|on foot|no (?:car|driving))\b/i.test(q)
    ? "walk"
    : /\b(transit|bus|subway|ttc)\b/i.test(q)
    ? "transit"
    : /\b(driv(?:e|ing)|car|uber|taxi)\b/i.test(q)
    ? "drive"
    : base?.travelMode ?? "walk";
  const replace = q.match(
    /\b(?:replace|swap|change)\s+(?:the\s+)?(first|second|third|1st|2nd|3rd)\b/i,
  ) ?? q.match(/\b(first|second|third|1st|2nd|3rd)\b.*\binstead\b/i);
  const specific = specificSearchTerm(q);
  const hasTopic = CUISINES.test(q) || TOPICS.some(([re]) => re.test(q));
  const requestedStops = q.match(
    /\b([123]|one|two|three)[ -]*(?:stops?|places?)\b/i,
  );
  const keepOther = /\bkeep\s+(?:the\s+)?(?:second|third|2nd|3rd)\b/i.test(q);
  const maxBudget = amount
    ? Math.min(10000, Number(amount[1]))
    : base?.maxBudget ?? null;
  const budgetScope = /\b(each|per person|a person)\b/i.test(q)
    ? "person"
    : /\b(total|altogether|between us|for (?:two|\d+))\b/i.test(q)
    ? "total"
    : amount
    ? "unknown"
    : base?.budgetScope ?? "unknown";
  const blockers: string[] = [];
  const notices: string[] = [];
  if (keepOther && !replace) {
    blockers.push(
      "To keep the other stops, tell me which one to replace: first, second or third.",
    );
  }
  const excludedTerms = [...(base?.excludedTerms ?? [])];
  for (
    const match of q.replace(
      /\b(no|avoid|without|exclude)\s+(\w+)\s+(?:or|and)\s+/gi,
      "$1 $2, $1 ",
    ).matchAll(
      /\b(?:no|avoid|without|exclude)\s+(clubs?|bars?|alcohol|parks?|museums?|galleries)\b/gi,
    )
  ) {
    const term = match[1].toLowerCase();
    excludedTerms.push(
      term === "alcohol"
        ? "bar"
        : term === "galleries"
        ? "gallery"
        : term.replace(/s$/, ""),
    );
  }
  if (
    /\b(?:[4-9]|[1-9]\d+|four|five|six|seven|eight|nine|ten)[ -]*(?:stops?|places?)\b/i
      .test(q) || q.split(/\s+(?:then|followed by)\s+/i).length > 3
  ) {
    blockers.push(
      "I can build routes with one to three stops. Choose up to three places.",
    );
  }
  if (/\b(?:at|after)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(q)) {
    blockers.push(
      "Exact start times are not supported yet. Try now, tonight, tomorrow or this weekend; later plans start at 6 pm.",
    );
  }
  if (/\bnear me\b/i.test(q)) {
    notices.push(
      "Places are matched within your selected city. Travel checking starts at the first stop, not your current location.",
    );
  }
  if (
    /\b(write (?:me |a |an )?(?:essay|code|poem)|solve|homework|stock price|medical advice)\b/i
      .test(q)
  ) {
    blockers.push(
      "I can help find places and build short local routes. Tell me a craving, activity or outing you have in mind.",
    );
  }
  if (maxBudget !== null) {
    if (budgetScope === "unknown" && partySize > 1) {
      blockers.push("Is that budget per person or for everyone?");
    }
    notices.push(
      "Budget uses venue price-band estimates. Tax, tips and transport are extra.",
    );
  }
  if (
    /\b(allerg(?:y|ic|ies)|celiac|coeliac|nut.free|gluten.free|halal|kosher|wheelchair|accessible)\b/i
      .test(q)
  ) {
    blockers.push(
      "I cannot verify that dietary or accessibility requirement yet. Confirm it with the venue before choosing a plan.",
    );
  }
  if (
    /\b(home|back) by\b|\b(before|by)\s+\d{1,2}(?::\d{2})?\s*(?:pm|am)?\b/i
      .test(q)
  ) {
    blockers.push(
      "I can estimate time between stops, but cannot guarantee that return deadline. Remove the deadline to explore options.",
    );
  }
  if (/\b(book|reserve|reservation)\b/i.test(q)) {
    notices.push(
      "These are suggestions; availability and reservations are not confirmed.",
    );
  }
  if (/\b(quiet|quieter|low.key|cozy)\b/i.test(q)) {
    notices.push("Quietness is based on venue tags, not live noise levels.");
  }
  const stopCount = requestedStops
    ? Number(words[requestedStops[1].toLowerCase()] ?? requestedStops[1])
    : base?.stopCount ??
      (/\b(then|afterward|afterwards|followed by|date night|outing|plan|route)\b/i
          .test(q)
        ? 2
        : 1);
  return {
    query: q,
    searchTerm: base && !hasTopic ? base.searchTerm : specific,
    stopCount: Math.max(1, Math.min(3, stopCount)) as 1 | 2 | 3,
    mood: /\b(quiet|quieter|calmer|chill|low.key|relaxed|cozy)\b/i.test(q)
      ? "chill"
      : /\b(lively|party|energetic|dancing)\b/i.test(q)
      ? "hype"
      : /\b(curious|art|explore|museum)\b/i.test(q)
      ? "curious"
      : base?.mood ?? "chill",
    budgetStyle: /\b(cheap(?:er)?|affordable|budget|low.cost)\b/i.test(q) ||
        (maxBudget !== null && maxBudget <= 35)
      ? "value"
      : /\b(luxury|splurge|fine dining)\b/i.test(q)
      ? "elevated"
      : base?.budgetStyle ?? "balanced",
    maxBudget,
    budgetScope,
    partySize,
    travelMode: travel,
    travelExplicit:
      /\b(walk|walking|walkable|foot|transit|bus|subway|ttc|drive|driving|car|uber|taxi)\b/i
        .test(q) || base?.travelExplicit || false,
    day: /\btomorrow\b/i.test(q)
      ? "tomorrow"
      : /\bweekend\b/i.test(q)
      ? "weekend"
      : /\btonight\b/i.test(q)
      ? "tonight"
      : base?.day ?? "now",
    openOnly: /\b(open (?:now|tonight)|still open)\b/i.test(q) ||
      base?.openOnly || false,
    replaceIndex: replace
      ? ({
        first: 0,
        second: 1,
        third: 2,
        "1st": 0,
        "2nd": 1,
        "3rd": 2,
      }[replace[1].toLowerCase()] ?? null)
      : null,
    excludedTerms: [...new Set(excludedTerms)],
    notices: [...new Set([...(base?.notices ?? []), ...notices])],
    blockers: [
      ...new Set([
        ...(base?.blockers ?? []).filter((note) =>
          !(note.startsWith("Is that budget") && budgetScope !== "unknown")
        ),
        ...blockers,
      ]),
    ],
  };
}

export function discoveryUnderstanding(query: string) {
  const intent = interpretPlanningQuery(query);
  const notes = [...intent.notices, ...intent.blockers];
  if (intent.openOnly || intent.day !== "now") {
    notes.push(
      "Search results do not confirm opening hours for your chosen time.",
    );
  }
  if (intent.travelExplicit) {
    notes.push(
      "Search results are not a checked route. Plan with Echoo to check travel between stops.",
    );
  }
  return {
    searchTerm: intent.searchTerm,
    notices: [...new Set(notes)],
    canPlan: !intent.blockers.length,
  };
}
