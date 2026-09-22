import type { RouteMatrix } from "../_shared/route-matrix.ts";
// Pure Quick Plan logic. No Deno APIs, no I/O — the edge function and the
// native test suite both exercise this module, so every scheduling and budget
// decision stays in one auditable place.

export type PlannerPlace = {
  id: string;
  name?: string | null;
  category?: string | null;
  subcategory?: string | null;
  city?: string | null;
  municipality?: string | null;
  address?: string | null;
  formatted_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  timezone?: string | null;
  image_url?: string | null;
  price_band?: string | null;
  confidence_score?: number | null;
};

export type PlannerPlaceProfile = {
  place_id?: string;
  vibe_tags?: string[] | null;
  good_for?: string[] | null;
  meal_tags?: string[] | null;
  activity_tags?: string[] | null;
  noise_level?: string | null;
  price_band?: string | null;
  confidence_score?: number | null;
};

export type PlannerHours = {
  place_id: string;
  day_of_week: number;
  opens_at?: string | null;
  closes_at?: string | null;
  is_closed?: boolean | null;
  valid_from?: string | null;
  valid_to?: string | null;
  updated_at?: string | null;
};

export type PlannerCandidate = PlannerPlace & {
  profile?: PlannerPlaceProfile;
  distanceMeters: number;
};

export type CostEstimate = { min: number; max: number } | null;

export type PlannedStop = {
  id: string;
  name: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  imageUrl: string;
  time: string;
  arrivalAt: string;
  durationMinutes: number;
  travelMinutes: number;
  reason: string;
  priceLabel: string;
  priceBand: string | null;
  costEstimate: CostEstimate;
  availability: "open" | "check_hours" | "unverified";
  isAnchor: boolean;
};

export type BudgetEstimate = {
  min: number;
  max: number;
  currency: string;
  perPerson: boolean;
  knownCount: number;
  unknownCount: number;
} | null;

export type QuickPlanResult = {
  title: string;
  subtitle: string;
  stopCount: number;
  requestedStopCount: number;
  budgetStyle: string;
  anchorId: string;
  anchorName: string;
  totalTravelMinutes: number;
  totalDurationMinutes: number;
  startsAt?: string;
  timezone?: string;
  generatedAt: string;
  city: string;
  mood: string;
  planId?: string;
  travelMode?: string;
  travelVerified?: boolean;
  alternativesExhausted?: boolean;
  availabilityNote: string;
  budgetEstimate: BudgetEstimate;
  stops: PlannedStop[];
};

export class PlannerError extends Error {}
export type PlanConstraints = {
  routes?: RouteMatrix | null;
  travelMode?: "walk" | "drive" | "transit";
  requireRoutes?: boolean;
  maxLegMinutes?: number;
  maxPerPerson?: number | null;
  openOnly?: boolean;
  excludedTerms?: string[];
  fixedPositions?: Array<{ id: string; index: number }>;
  allowedIdsByPosition?: string[][];
};
function routeMinutes(
  from: PlannerCandidate,
  to: PlannerCandidate,
  constraints?: PlanConstraints,
) {
  const mapped = constraints?.routes?.[`${from.id}:${to.id}`];
  if (mapped !== undefined) return mapped;
  if (constraints?.requireRoutes) return Infinity;
  if (constraints?.travelMode === "walk") {
    return Math.max(
      1,
      Math.ceil(
        haversineMeters(
          number(from.latitude),
          number(from.longitude),
          number(to.latitude),
          number(to.longitude),
        ) * 1.3 / 75,
      ),
    );
  }
  return travelMinutes(from, to);
}

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

// Per-person cost windows per evidence tier. These are clearly-labelled
// estimates, never quoted venue prices: a "free" band is a real $0, an
// unknown band stays null rather than being guessed at zero.
const COST_WINDOWS: Record<string, { min: number; max: number }> = {
  free: { min: 0, max: 0 },
  value: { min: 8, max: 28 },
  balanced: { min: 25, max: 65 },
  elevated: { min: 60, max: 140 },
};

// Suggested dwell times; these are not venue-specific duration claims.
const FIRST_STOP_DWELL_MINUTES = 65;
const NEXT_STOP_DWELL_MINUTES = 75;
// If the anchor is closed now but opens within this window, the plan waits
// for opening instead of routing the user to a locked door.
const MAX_OPENING_WAIT_MINUTES = 240;

export function text(value: unknown, fallback = "") {
  return String(value ?? fallback).replace(/\s+/g, " ").trim();
}

export function list(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => text(item).toLowerCase()).filter(Boolean)
    : [];
}

export function number(value: unknown, fallback = 0) {
  if (
    value === null || value === undefined || value === "" ||
    typeof value === "boolean"
  ) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isCanonicalPlaceId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

export function clampStopCount(value: unknown) {
  return value === 1 || value === 2 || value === 3 ? value : 3;
}

export function normalizeBudget(value: unknown) {
  const raw = text(value).toLowerCase();
  if (["value", "low", "$"].includes(raw)) return "value";
  if (["elevated", "high", "premium", "classy", "$$$"].includes(raw)) {
    return "elevated";
  }
  return "balanced";
}

export function budgetFromProfile(value: unknown) {
  const raw = text(value);
  if (raw === "$") return "value";
  if (raw === "$$$") return "elevated";
  return "balanced";
}

export function priceTier(priceBand: unknown) {
  const raw = text(priceBand).toLowerCase();
  if (!raw) return "unknown";
  if (
    /free|inexpensive|low|budget|price_level_inexpensive/.test(raw) ||
    raw === "$"
  ) return "value";
  if (
    raw.includes("$$$") ||
    /very_expensive|expensive|premium|upscale|elevated|high/.test(raw)
  ) return "elevated";
  if (
    raw.includes("$$") || /moderate|mid|balanced|price_level_moderate/.test(raw)
  ) return "balanced";
  return "unknown";
}

export function priceFit(priceBand: unknown, planBudget: string) {
  const price = priceTier(priceBand);
  if (price === "unknown") return 0.42;
  if (price === planBudget) return 1;
  if (planBudget === "balanced") return 0.46;
  if (planBudget === "value") return price === "balanced" ? 0.22 : 0.03;
  return price === "balanced" ? 0.40 : 0.04;
}

export function priceLabel(place: PlannerCandidate) {
  const tier = priceTier(place.profile?.price_band || place.price_band);
  if (tier === "value") return "Value pick";
  if (tier === "balanced") return "Mid-range";
  if (tier === "elevated") return "Elevated pick";
  return "Price not listed";
}

export function isBudgetMatch(place: PlannerCandidate, planBudget: string) {
  return priceTier(place.profile?.price_band || place.price_band) ===
    planBudget;
}

export function recentIds(value: unknown) {
  return new Set(
    list(value).filter((id) => id.length <= 180).slice(0, 30),
  );
}

export function stableNumber(value: unknown) {
  let hash = 2166136261;
  for (const character of text(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

export function profileTags(profile?: PlannerPlaceProfile) {
  return [
    ...list(profile?.vibe_tags),
    ...list(profile?.good_for),
    ...list(profile?.meal_tags),
    ...list(profile?.activity_tags),
    text(profile?.noise_level).toLowerCase(),
  ].filter(Boolean);
}

export function userTerms(profile: Record<string, unknown>) {
  return [
    ...list(profile.interests),
    ...list(profile.eventStyles),
    ...list(profile.event_styles),
    ...list(profile.audiences),
    ...list(profile.motivations),
  ]
    .flatMap((term) => term.split(/[^a-z0-9]+/i))
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 2);
}

export function personalizationFit(
  candidate: PlannerCandidate,
  profile: Record<string, unknown>,
) {
  const tags = profileTags(candidate.profile);
  const terms = userTerms(profile);
  const matches =
    terms.filter((term) =>
      tags.some((tag) => tag.includes(term) || term.includes(tag))
    ).length;
  let score = terms.length
    ? Math.min(1, matches / Math.min(terms.length, 3))
    : 0.58;
  const energy = text(profile.energy).toLowerCase();
  if (
    energy === "chill" &&
    tags.some((tag) => /quiet|cozy|calm|relaxed|low.key/.test(tag))
  ) score += 0.2;
  if (
    energy === "hype" &&
    tags.some((tag) => /lively|social|nightlife|active|music/.test(tag))
  ) score += 0.2;
  if (
    energy === "curious" &&
    tags.some((tag) =>
      /art|culture|museum|gallery|independent|explor/.test(tag)
    )
  ) score += 0.2;
  return Math.min(1, score);
}

export function categoryFamily(place: PlannerCandidate) {
  const raw = `${text(place.category)} ${text(place.subcategory)}`
    .toLowerCase();
  if (/restaurant|cafe|bakery|food|bar|pub|dessert/.test(raw)) return "food";
  if (
    /museum|gallery|arts|culture|tourism|library|attraction|historic|heritage/
      .test(raw)
  ) return "culture";
  if (/park|trail|nature|garden|beach/.test(raw)) return "outdoors";
  if (/shop|mall|market/.test(raw)) return "browse";
  return raw || "place";
}

export function categoryComplement(
  anchor: PlannerCandidate,
  candidate: PlannerCandidate,
) {
  const anchorFamily = categoryFamily(anchor);
  const candidateFamily = categoryFamily(candidate);
  if (anchorFamily !== candidateFamily) return 1;
  if (anchorFamily === "food") return 0.28;
  return 0.48;
}

export function localClock(timezone: string, at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return {
    day: WEEKDAY_INDEX[values.weekday] ?? at.getDay(),
    minute: Number(values.hour || 0) * 60 + Number(values.minute || 0),
  };
}

export function minuteOfDay(value: string | null | undefined) {
  const found = text(value).match(/^(\d{1,2}):(\d{2})/);
  return found && Number(found[1]) < 24 && Number(found[2]) < 60
    ? Number(found[1]) * 60 + Number(found[2])
    : null;
}

// A yesterday row only extends past midnight when it closes before it opens.
function overnightWindow(row?: PlannerHours) {
  if (!row || row.is_closed) return null;
  const opens = minuteOfDay(row.opens_at);
  const closes = minuteOfDay(row.closes_at);
  if (opens === null || closes === null || closes > opens) return null;
  return { opens, closes };
}

// Handles overnight windows (e.g. 19:00 → 02:00): tonight's window wraps past
// midnight, and early-morning checks consult yesterday's row so a 01:00
// arrival during a "19:00–02:00" night reads as open, not unknown.
function usableHours(hours: PlannerHours[], timezone: string, at: Date) {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  return hours.filter((row) =>
    (!row.valid_from || row.valid_from <= date) &&
    (!row.valid_to || row.valid_to >= date) &&
    (!row.updated_at ||
      (Number.isFinite(Date.parse(row.updated_at)) &&
        at.getTime() - Date.parse(row.updated_at) <= 90 * 86400000))
  );
}

function openingWindow(hours: PlannerHours[], timezone: string, at: Date) {
  const usable = usableHours(hours, timezone, at);
  if (!usable.length) return { known: false, open: true, remaining: 0 };
  const clock = localClock(timezone, at);
  const today = usable.filter((row) => Number(row.day_of_week) === clock.day);
  const yesterday = usable.filter((row) =>
    Number(row.day_of_week) === (clock.day + 6) % 7
  );
  let remaining = 0;
  for (const row of yesterday) {
    const window = overnightWindow(row);
    if (window && clock.minute < window.closes) {
      remaining = Math.max(remaining, window.closes - clock.minute);
    }
  }
  for (const row of today) {
    if (row.is_closed) continue;
    const opens = minuteOfDay(row.opens_at),
      closes = minuteOfDay(row.closes_at);
    if (opens === null || closes === null) continue;
    if (clock.minute >= opens && (closes <= opens || clock.minute < closes)) {
      remaining = Math.max(
        remaining,
        (closes <= opens ? closes + 1440 : closes) - clock.minute,
      );
    }
  }
  if (remaining > 0) return { known: true, open: true, remaining };
  const known = today.some((row) =>
    row.is_closed ||
    (minuteOfDay(row.opens_at) !== null &&
      minuteOfDay(row.closes_at) !== null)
  ) || yesterday.some((row) => overnightWindow(row));
  return { known: Boolean(known), open: !known, remaining: 0 };
}

export function openAt(hours: PlannerHours[], timezone: string, at: Date) {
  const status = openingWindow(hours, timezone, at);
  return { known: status.known, open: status.open };
}

// The entire visit must fit one continuous opening interval. An arrival five
// minutes before closing cannot validate a 65-minute visit.
export function openForVisit(
  hours: PlannerHours[],
  timezone: string,
  at: Date,
  durationMinutes: number,
) {
  const start = openingWindow(hours, timezone, at);
  if (!start.known || !start.open) {
    return { known: start.known, open: start.open };
  }
  const end = openingWindow(
    hours,
    timezone,
    new Date(at.getTime() + Math.max(0, durationMinutes * 60000 - 1)),
  );
  return {
    known: true,
    open: start.remaining >= durationMinutes && end.known && end.open,
  };
}

export function haversineMeters(
  fromLatitude: number,
  fromLongitude: number,
  toLatitude: number,
  toLongitude: number,
) {
  const earthRadius = 6_371_000;
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLatitude = toRadians(toLatitude - fromLatitude);
  const deltaLongitude = toRadians(toLongitude - fromLongitude);
  const width = Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(toRadians(fromLatitude)) *
      Math.cos(toRadians(toLatitude)) *
      Math.sin(deltaLongitude / 2) ** 2;
  return Math.round(2 * earthRadius * Math.asin(Math.sqrt(width)));
}

// A conservative mixed walk/short-ride estimate. Route previews can refine
// this later; ranking never depends on a paid maps call.
export function travelMinutes(from: PlannerCandidate, to: PlannerCandidate) {
  const meters = haversineMeters(
    number(from.latitude),
    number(from.longitude),
    number(to.latitude),
    number(to.longitude),
  );
  return Math.max(6, Math.min(28, Math.round(5 + meters / 1000 * 3.3)));
}

// Evidence-tiered per-person cost window. Free is a real zero; unknown is
// null so the client never shows a made-up price.
export function costEstimateFor(place: PlannerCandidate): CostEstimate {
  const band = text(place.profile?.price_band || place.price_band)
    .toLowerCase();
  if (!band) return null;
  if (band.includes("free")) return { ...COST_WINDOWS.free };
  const window = COST_WINDOWS[priceTier(band)];
  return window ? { ...window } : null;
}

export function costEstimateLabel(estimate: CostEstimate) {
  if (!estimate) return null;
  if (estimate.min === 0 && estimate.max === 0) return "Free";
  return `$${estimate.min}–${estimate.max} est.`;
}

export function timeLabel(
  timezone: string,
  baseAt: Date,
  offsetMinutes: number,
) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(baseAt.getTime() + offsetMinutes * 60_000));
}

export function reasonFor(
  place: PlannerCandidate,
  index: number,
  anchor: PlannerCandidate,
) {
  if (place.id === anchor.id) return "The place you chose";
  const family = categoryFamily(place);
  if (family === "food") {
    return index === 1 ? "An easy next bite" : "A good place to land";
  }
  if (family === "culture") return "Adds a real activity";
  if (family === "outdoors") return "Keeps the plan feeling light";
  if (family === "browse") return "A low-pressure browse";
  return "Matched to your plan";
}

// If the anchor is marked closed right now but reopens later today, start the
// outing at reopening (capped) instead of planning an arrival at a locked
// door. Unknown hours leave the start time untouched.
export function planStartAt(
  anchorId: string,
  hoursByPlace: Map<string, PlannerHours[]>,
  timezone: string,
  now: Date,
) {
  if (openAt(hoursByPlace.get(anchorId) || [], timezone, now).open) {
    return { startAt: now, waitedForOpening: false };
  }
  const clock = localClock(timezone, now);
  const row = (hoursByPlace.get(anchorId) || []).find(
    (item) => Number(item.day_of_week) === clock.day,
  );
  if (!row || row.is_closed) return { startAt: now, waitedForOpening: false };
  const opens = minuteOfDay(row.opens_at);
  if (opens === null) return { startAt: now, waitedForOpening: false };
  if (clock.minute >= opens) return { startAt: now, waitedForOpening: false };
  const waitMinutes = opens - clock.minute;
  if (waitMinutes > MAX_OPENING_WAIT_MINUTES) {
    return { startAt: now, waitedForOpening: false };
  }
  return {
    startAt: new Date(now.getTime() + waitMinutes * 60_000),
    waitedForOpening: true,
  };
}

type Arrangement = {
  startAt: Date;
  order: PlannerCandidate[];
  travel: number;
  hourViolations: number;
  flowPenalty: number;
};

function simulateArrangement(
  order: PlannerCandidate[],
  hoursByPlace: Map<string, PlannerHours[]>,
  timezone: string,
  startAt: Date,
  constraints?: PlanConstraints,
): Arrangement {
  let cursor = startAt.getTime();
  let travel = 0;
  let hourViolations = 0;
  order.forEach((place, index) => {
    if (index > 0) {
      const leg = routeMinutes(order[index - 1], place, constraints);
      if (
        !Number.isFinite(leg) ||
        (constraints?.maxLegMinutes && leg > constraints.maxLegMinutes)
      ) {
        hourViolations += 100;
        return;
      }
      travel += leg;
      cursor += leg * 60_000;
    }
    const status = openForVisit(
      hoursByPlace.get(place.id) || [],
      timezone,
      new Date(cursor),
      index === 0 ? FIRST_STOP_DWELL_MINUTES : NEXT_STOP_DWELL_MINUTES,
    );
    if (status.known && !status.open) hourViolations += 1;
    cursor +=
      (index === 0 ? FIRST_STOP_DWELL_MINUTES : NEXT_STOP_DWELL_MINUTES) *
      60_000;
  });
  // Keep the arc activity-first: leading a multi-stop outing with food makes
  // the rest of the plan feel like an errand, so nudge food stops inward.
  const flowPenalty = order.length > 1 && categoryFamily(order[0]) === "food" &&
      order.some((place) => categoryFamily(place) !== "food")
    ? 40
    : 0;
  return { order, travel, hourViolations, flowPenalty, startAt };
}

// Tries every ordering (≤3 stops, so ≤6 permutations) and prefers, in order:
// zero known-hours violations, then the food-flow arc, then less travel.
export function orderStops(
  selected: PlannerCandidate[],
  hoursByPlace: Map<string, PlannerHours[]>,
  timezone: string,
  startAt: Date,
  anchorId?: string,
  anchorPosition?: number,
  constraints?: PlanConstraints,
) {
  const permutations: PlannerCandidate[][] = [];
  const permute = (items: PlannerCandidate[], current: PlannerCandidate[]) => {
    if (!items.length) {
      permutations.push(current);
      return;
    }
    for (let index = 0; index < items.length; index += 1) {
      permute(
        [...items.slice(0, index), ...items.slice(index + 1)],
        [...current, items[index]],
      );
    }
  };
  permute(selected, []);
  const ranked = permutations.filter((order) =>
    (!anchorPosition ||
      order[Math.min(anchorPosition, order.length) - 1]?.id === anchorId) &&
    !constraints?.fixedPositions?.some((stop) =>
      order[stop.index]?.id !== stop.id
    ) &&
    !constraints?.allowedIdsByPosition?.some((ids, index) =>
      ids.length > 0 && !ids.includes(order[index]?.id)
    )
  ).map((order) =>
    simulateArrangement(
      order,
      hoursByPlace,
      timezone,
      planStartAt(order[0].id, hoursByPlace, timezone, startAt).startAt,
      constraints,
    )
  );
  ranked.sort(
    (left, right) =>
      left.hourViolations - right.hourViolations ||
      left.startAt.getTime() - right.startAt.getTime() ||
      left.flowPenalty - right.flowPenalty ||
      left.travel - right.travel,
  );
  if (!ranked.length) {
    throw new PlannerError("No ordering preserves the requested stops.");
  }
  return ranked[0];
}

export function selectStops(input: {
  anchor: PlannerCandidate;
  candidates: PlannerCandidate[];
  stopCount: number;
  requestedBudget: string;
  recentPlaceIds: Set<string>;
  rotationKey: string;
  profile: Record<string, unknown>;
}) {
  const {
    anchor,
    candidates,
    stopCount,
    requestedBudget,
    recentPlaceIds,
    rotationKey,
    profile,
  } = input;
  const score = (candidate: PlannerCandidate) => {
    const distance = Math.max(0, 1 - candidate.distanceMeters / 14000);
    const profileConfidence = number(
      candidate.profile?.confidence_score,
      number(candidate.confidence_score, 0.46),
    );
    return (
      priceFit(
          candidate.profile?.price_band || candidate.price_band,
          requestedBudget,
        ) * 0.44 +
      personalizationFit(candidate, profile) * 0.22 +
      categoryComplement(anchor, candidate) * 0.16 +
      distance * 0.10 +
      profileConfidence * 0.08 +
      stableNumber(`${rotationKey}:${candidate.id}`) * 0.055
    );
  };

  const selected: PlannerCandidate[] = [anchor];
  const requiredNearbyStops = stopCount - 1;
  const freshCandidates = candidates.filter((candidate) =>
    candidate.id !== anchor.id && !recentPlaceIds.has(candidate.id)
  );
  // Never silently recycle the same outing when the local supply is exhausted.
  const rotationPool = freshCandidates;
  const exactBudgetMatches = rotationPool.filter((candidate) =>
    isBudgetMatch(candidate, requestedBudget)
  );
  // When the area has enough priced inventory, make the spend choice a hard
  // rail. If it does not, gracefully widen the pool rather than inventing a
  // price or returning an empty plan.
  const budgetPool = exactBudgetMatches.length >= requiredNearbyStops
    ? exactBudgetMatches
    : rotationPool;
  const sorted = [...budgetPool].sort((a, b) => score(b) - score(a));
  for (const candidate of sorted) {
    if (selected.length >= stopCount) break;
    if (selected.some((picked) => picked.id === candidate.id)) continue;
    const duplicateFamily = selected.some((picked) =>
      categoryFamily(picked) === categoryFamily(candidate)
    );
    if (
      duplicateFamily &&
      sorted.some((alternative) =>
        !selected.some((picked) => picked.id === alternative.id) &&
        categoryFamily(alternative) !== categoryFamily(candidate)
      )
    ) continue;
    selected.push(candidate);
  }
  for (const candidate of sorted) {
    if (selected.length >= stopCount) break;
    if (!selected.some((picked) => picked.id === candidate.id)) {
      selected.push(candidate);
    }
  }
  return selected;
}

export function buildPlan(input: {
  anchor: PlannerCandidate;
  selected: PlannerCandidate[];
  hoursByPlace: Map<string, PlannerHours[]>;
  timezone: string;
  startAt: Date;
  requestedBudget: string;
  requestedStopCount: number;
  anchorPosition?: number;
  mood?: string;
  constraints?: PlanConstraints;
}): QuickPlanResult {
  const {
    anchor,
    hoursByPlace,
    timezone,
    requestedBudget,
    requestedStopCount,
  } = input;
  const { order, travel: totalTravel, startAt } = orderStops(
    input.selected,
    hoursByPlace,
    timezone,
    input.startAt,
    anchor.id,
    input.anchorPosition,
    input.constraints,
  );

  const stops: PlannedStop[] = [];
  let cursor = startAt.getTime();
  order.forEach((place, index) => {
    let travelLeg = 0;
    if (index > 0) {
      travelLeg = routeMinutes(order[index - 1], place, input.constraints);
      if (
        !Number.isFinite(travelLeg) ||
        (input.constraints?.maxLegMinutes &&
          travelLeg > input.constraints.maxLegMinutes)
      ) throw new PlannerError("No route fits the selected travel limit.");
      cursor += travelLeg * 60_000;
    }
    const arrival = new Date(cursor);
    const availability = openForVisit(
      hoursByPlace.get(place.id) || [],
      timezone,
      arrival,
      index === 0 ? FIRST_STOP_DWELL_MINUTES : NEXT_STOP_DWELL_MINUTES,
    );
    const costEstimate = costEstimateFor(place);
    stops.push({
      id: place.id,
      name: text(place.name),
      category: text(place.subcategory || place.category, "Place"),
      address: text(place.address || place.formatted_address),
      latitude: number(place.latitude, NaN),
      longitude: number(place.longitude, NaN),
      imageUrl: text(place.image_url),
      time: timeLabel(
        timezone,
        input.startAt,
        Math.round((cursor - input.startAt.getTime()) / 60_000),
      ),
      arrivalAt: arrival.toISOString(),
      durationMinutes: index === 0
        ? FIRST_STOP_DWELL_MINUTES
        : NEXT_STOP_DWELL_MINUTES,
      travelMinutes: index === 0 ? 0 : travelLeg,
      reason: reasonFor(place, index, anchor),
      priceLabel: priceLabel(place),
      priceBand: text(place.profile?.price_band || place.price_band) || null,
      costEstimate,
      availability: availability.known
        ? (availability.open ? "open" : "check_hours")
        : "unverified",
      isAnchor: place.id === anchor.id,
    });
    cursor +=
      (index === 0 ? FIRST_STOP_DWELL_MINUTES : NEXT_STOP_DWELL_MINUTES) *
      60_000;
  });

  const knownEstimates = stops.map((stop) => stop.costEstimate).filter(
    Boolean,
  ) as Array<{ min: number; max: number }>;
  const budgetEstimate: BudgetEstimate = knownEstimates.length
    ? {
      min: knownEstimates.reduce((total, estimate) => total + estimate.min, 0),
      max: knownEstimates.reduce((total, estimate) => total + estimate.max, 0),
      currency: "CAD",
      perPerson: true,
      knownCount: knownEstimates.length,
      unknownCount: stops.length - knownEstimates.length,
    }
    : null;

  const degraded = stops.length < requestedStopCount;
  const baseNote = stops.some((stop) => stop.availability === "check_hours")
    ? "A complete visit does not fit the listed hours. Choose another time or outing."
    : stops.some((stop) => stop.availability === "unverified")
    ? "Suggested times only. Hours are missing for some places; confirm before leaving."
    : "Suggested visits fit the listed hours. Confirm current hours and admission with each venue.";
  const availabilityNote = degraded
    ? `${baseNote} Only ${stops.length} places available here: shorter, never filler.`
    : baseNote;

  const plan: QuickPlanResult = {
    travelMode: input.constraints?.travelMode,
    travelVerified: order.length <= 1 ||
      order.slice(1).every((place, index) =>
        input.constraints?.routes?.[`${order[index].id}:${place.id}`] !==
          undefined
      ),
    title: "A little more of your city.",
    subtitle: `Built around ${text(anchor.name, "your place")}`,
    stopCount: stops.length,
    requestedStopCount,
    budgetStyle: requestedBudget,
    anchorId: anchor.id,
    anchorName: text(anchor.name, "your place"),
    totalTravelMinutes: totalTravel,
    totalDurationMinutes: Math.round((cursor - startAt.getTime()) / 60_000),
    generatedAt: input.startAt.toISOString(),
    startsAt: startAt.toISOString(),
    timezone,
    city: text(anchor.municipality || anchor.city),
    mood: input.mood || "chill",
    availabilityNote,
    budgetEstimate,
    stops,
  };
  return enforcePlanInvariants(plan);
}

// The response contract: the anchor is always present exactly once, stops are
// real places with names and coordinates, and capacity stays within 1–3.
export function enforcePlanInvariants(plan: QuickPlanResult): QuickPlanResult {
  if (
    !Array.isArray(plan.stops) || plan.stops.length < 1 || plan.stops.length > 3
  ) {
    throw new PlannerError("Quick Plan must carry between 1 and 3 real stops.");
  }
  if (plan.stops.length !== plan.stopCount) {
    throw new PlannerError("Quick Plan stop count disagrees with its stops.");
  }
  const seen = new Set<string>();
  for (const stop of plan.stops) {
    if (!stop.id || seen.has(stop.id)) {
      throw new PlannerError("Quick Plan produced an empty or duplicate stop.");
    }
    seen.add(stop.id);
    if (
      !text(stop.name) || !Number.isFinite(stop.latitude) ||
      !Number.isFinite(stop.longitude) || Math.abs(stop.latitude) > 90 ||
      Math.abs(stop.longitude) > 180
    ) {
      throw new PlannerError(
        "Quick Plan produced a stop without a name or location.",
      );
    }
  }
  if (!plan.anchorId || !seen.has(plan.anchorId)) {
    throw new PlannerError("Quick Plan lost its anchor place.");
  }
  return plan;
}
