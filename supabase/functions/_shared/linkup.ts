// Link Up · shared helpers
//
// Imported by every linkup-* Edge Function. Mirrors the conventions of
// ./location.ts (CORS_HEADERS, jsonResponse, getSupabaseAdmin) and the
// rate-limit pattern from discovery-community (ACTION_LIMITS + sliding
// window over an action-events ledger).

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsonResponse } from "./location.ts";

// ─────────────────────────────────────────────────────────────────────────
// Feature flag — default OFF. Set LINKUP_ENABLED=1 in the project secrets to
// turn the module on (per environment / per city rollout).
// ─────────────────────────────────────────────────────────────────────────
export const LINKUP_ENABLED = Deno.env.get("LINKUP_ENABLED") === "1";

// ─────────────────────────────────────────────────────────────────────────
// Tunable constants
// ─────────────────────────────────────────────────────────────────────────
export const PRESENCE_TTL_MINUTES = 180; // active presence lives up to 3h
export const PRESENCE_TTL_MAX_MINUTES = 360; // hard cap
export const MATCH_FUSE_MINUTES = 10; // pending match acceptance window
export const CONVERSATION_GRACE_HOURS = 24; // chat stays writable after match ends

export const MIN_AGE = 18;

// Compatible-age band: tighter for younger adults, wider for older adults.
// Two members match only if their ages (computed server-side from DOB) both
// clear MIN_AGE and fall within each other's band.
export function ageBandHalfWidth(years: number): number {
  if (years < 30) return 5;
  if (years < 45) return 8;
  return 12;
}

// ─────────────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────────────
export function bearerToken(req: Request): string {
  return (
    (req.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] ||
    ""
  );
}

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function disabledResponse(): Response {
  // Returns HTTP 200 with disabled:true so clients can no-op quietly.
  return jsonResponse({ ok: false, disabled: true, error: "Link Up is not available" }, 200);
}

// ─────────────────────────────────────────────────────────────────────────
// Eligibility: completed onboarding + verified identity + 18+.
// Reads auth.users metadata (service role) and user_onboarding_profiles.
// ─────────────────────────────────────────────────────────────────────────
export interface LinkupEligibility {
  eligible: boolean;
  reason?: "no_onboarding" | "underage" | "unverified";
  dateOfBirth?: string;
  age?: number;
}

export async function getOnboardingProfile(
  supabase: SupabaseClient,
  userId: string,
) {
  const { data, error } = await supabase
    .from("user_onboarding_profiles")
    .select(
      "display_name, username, home_city, interests, event_styles, motivations, audiences, budget, energy, tone, gender, date_of_birth, completed_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age--;
  return age >= 0 && age < 130 ? age : null;
}

export async function isUserEligible(
  supabase: SupabaseClient,
  userId: string,
): Promise<LinkupEligibility> {
  // Relaxed gates: the only hard requirement is a completed onboarding
  // profile. Email verification and DOB are advisory — DOB is optional in the
  // onboarding form ("private and optional"), and email verification is not
  // enforced consistently across signup paths yet. When a DOB is present we
  // still use it for age-band compatibility below, but its absence no longer
  // blocks the feature.
  const profile = await getOnboardingProfile(supabase, userId);
  if (!profile || !profile.completed_at) {
    return { eligible: false, reason: "no_onboarding" };
  }
  const age = ageFromDob(profile.date_of_birth);
  return { eligible: true, age: age ?? undefined, dateOfBirth: profile.date_of_birth ?? undefined };
}

export function ageBandCompatible(ageA: number | null | undefined, ageB: number | null | undefined): boolean {
  // If either side has no DOB, we can't enforce a band — allow it (identity is
  // gated by completed onboarding + the affinity threshold elsewhere). If both
  // have a DOB, enforce the band and the 18+ floor.
  if (ageA === null || ageA === undefined || ageB === null || ageB === undefined) return true;
  if (ageA < MIN_AGE || ageB < MIN_AGE) return false;
  return Math.abs(ageA - ageB) <= Math.min(ageBandHalfWidth(ageA), ageBandHalfWidth(ageB));
}

// ─────────────────────────────────────────────────────────────────────────
// Affinity + reason tags (explainability cues surfaced as eyebrow caps).
// Weighted blend of array overlaps (interests, event_styles, motivations,
// audiences) and scalar matches (energy, budget, tone, home_city). Returns a
// 0–100 score and human-readable reason tags. AFFINITY_THRESHOLD is the bar a
// pair must clear to be proposed — this is what makes matching feel magical
// (right person) rather than spammy (any person).
// ─────────────────────────────────────────────────────────────────────────
export const AFFINITY_THRESHOLD = 20; // 0–100; tuned for "only compatible people"

function jaccard(a: string[] | null, b: string[] | null): number {
  const setA = new Set((a ?? []).map((x) => String(x).toLowerCase().trim()));
  const setB = new Set((b ?? []).map((x) => String(x).toLowerCase().trim()));
  if (setA.size === 0 || setB.size === 0) return 0;
  let inter = 0;
  for (const x of setA) if (setB.has(x)) inter++;
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function sameScalar(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return String(a).toLowerCase().trim() === String(b).toLowerCase().trim();
}

export interface AffinityProfile {
  interests?: string[];
  event_styles?: string[];
  motivations?: string[];
  audiences?: string[];
  budget?: string;
  energy?: string;
  tone?: string;
  gender?: string;
  home_city?: string;
}

export function computeAffinity(
  profileA: AffinityProfile | null,
  profileB: AffinityProfile | null,
): { affinity: number; reason_tags: string[] } {
  // Array overlaps (the strongest signal).
  const interests = jaccard(profileA?.interests, profileB?.interests);
  const styles = jaccard(profileA?.event_styles, profileB?.event_styles);
  const motiv = jaccard(profileA?.motivations, profileB?.motivations);
  const audiences = jaccard(profileA?.audiences, profileB?.audiences);

  // Scalar matches (lighter, tie-breaking signal).
  const sameEnergy = sameScalar(profileA?.energy, profileB?.energy);
  const sameBudget = sameScalar(profileA?.budget, profileB?.budget);
  const sameTone = sameScalar(profileA?.tone, profileB?.tone);
  const sameCity = sameScalar(profileA?.home_city, profileB?.home_city);

  // Weighted blend. Arrays dominate; scalars nudge.
  const raw =
    interests * 0.34 +
    styles * 0.22 +
    motiv * 0.14 +
    audiences * 0.10 +
    (sameEnergy ? 0.06 : 0) +
    (sameBudget ? 0.05 : 0) +
    (sameTone ? 0.04 : 0) +
    (sameCity ? 0.05 : 0);
  const affinity = Math.max(0, Math.min(100, Math.round(raw * 100)));

  const reason_tags: string[] = [];
  if (interests > 0) reason_tags.push("shared_interests");
  if (styles > 0) reason_tags.push("shared_style");
  if (motiv > 0) reason_tags.push("shared_energy");
  if (audiences > 0) reason_tags.push("shared_crowd");
  if (sameCity) reason_tags.push("same_home_city");
  if (sameEnergy) reason_tags.push("same_energy");
  if (sameBudget) reason_tags.push("same_budget");
  return { affinity, reason_tags };
}

// ─────────────────────────────────────────────────────────────────────────
// Rate limiting — sliding window over linkup_action_events.
// Mirrors discovery-community's ACTION_LIMITS approach.
// ─────────────────────────────────────────────────────────────────────────
export type LinkupAction =
  | "checkin"
  | "checkout"
  | "match_accept"
  | "match_decline"
  | "message"
  | "report"
  | "block"
  | "end";

export const ACTION_LIMITS: Record<LinkupAction, { max: number; windowMinutes: number }> = {
  checkin: { max: 10, windowMinutes: 60 },
  checkout: { max: 20, windowMinutes: 60 },
  match_accept: { max: 20, windowMinutes: 60 },
  match_decline: { max: 20, windowMinutes: 60 },
  message: { max: 30, windowMinutes: 10 },
  report: { max: 8, windowMinutes: 60 * 24 },
  block: { max: 20, windowMinutes: 60 },
  end: { max: 20, windowMinutes: 60 },
};

export async function recordAction(
  supabase: SupabaseClient,
  userId: string,
  action: LinkupAction,
  targetId?: string,
): Promise<void> {
  const { error } = await supabase.from("linkup_action_events").insert({
    user_id: userId,
    action,
    target_id: targetId && isUuid(targetId) ? targetId : null,
  });
  if (error) throw error;
}

export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  action: LinkupAction,
): Promise<boolean> {
  const limit = ACTION_LIMITS[action];
  const since = new Date(Date.now() - limit.windowMinutes * 60_000).toISOString();
  const { count, error } = await supabase
    .from("linkup_action_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("action", action)
    .gte("created_at", since);
  if (error) throw error;
  return (count ?? 0) < limit.max;
}

// ─────────────────────────────────────────────────────────────────────────
// Blocks — symmetric. Stored once via least()/greatest().
// ─────────────────────────────────────────────────────────────────────────
export async function activeBlockBetween(
  supabase: SupabaseClient,
  userA: string,
  userB: string,
): Promise<boolean> {
  if (userA === userB) return false;
  const [lo, hi] = userA < userB ? [userA, userB] : [userB, userA];
  const { count, error } = await supabase
    .from("linkup_blocks")
    .select("user_a", { count: "exact", head: true })
    .eq("user_a", lo)
    .eq("user_b", hi);
  if (error) throw error;
  return (count ?? 0) > 0;
}

export async function recentlyMatched(
  supabase: SupabaseClient,
  userA: string,
  userB: string,
  withinHours = 24,
): Promise<boolean> {
  // Suppress re-proposing ONLY when a prior match between this pair is still
  // open (pending) or was accepted (a real conversation happened). A declined
  // or expired match does NOT block a natural re-encounter — two people can
  // still cross paths again at the same place and get another shot.
  if (userA === userB) return false;
  const since = new Date(Date.now() - withinHours * 60 * 60_000).toISOString();
  const { data: aRows, error: e1 } = await supabase
    .from("linkup_match_members")
    .select("match_id")
    .eq("user_id", userA)
    .gte("created_at", since);
  if (e1 || !aRows || aRows.length === 0) return false;
  const ids = aRows.map((r: { match_id: string }) => r.match_id);
  // Are any of those shared matches still pending or accepted?
  const { data: shared, error: e2 } = await supabase
    .from("linkup_match_members")
    .select("match_id")
    .eq("user_id", userB)
    .in("match_id", ids);
  if (e2 || !shared || shared.length === 0) return false;
  const sharedIds = shared.map((r: { match_id: string }) => r.match_id);
  const { count, error: e3 } = await supabase
    .from("linkup_matches")
    .select("id", { count: "exact", head: true })
    .in("id", sharedIds)
    .in("status", ["pending", "accepted"]);
  if (e3) return false;
  return (count ?? 0) > 0;
}
