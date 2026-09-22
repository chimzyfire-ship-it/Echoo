import * as Crypto from "expo-crypto";
import type { EchooLocation, QuickPlan } from "@/src/models";
import {
  edgeRequest,
  EchooApiError,
  normalizeQuickPlan,
} from "@/src/services/api";
import { supabase } from "@/src/services/supabase";
import { saveActiveOuting } from "@/src/services/outing";

export type CompanionResponse = {
  version: 1;
  sessionId: string;
  revision: number;
  status:
    | "plan_ready"
    | "plan_partial"
    | "no_match"
    | "clarification"
    | "service_error";
  message: string;
  plan: QuickPlan | null;
  callback: string | null;
  notices: string[];
  suggestions: string[];
  memoryEnabled: boolean;
  mode?: "conversation" | "plan" | "clarification";
  context?: string[];
  places?: CompanionPlace[];
  preferences: {
    city: string;
    stopCount: number;
    mood: string;
    budgetStyle: string;
    travelMode: string;
    partySize: number;
    day: string;
  };
};
export type CompanionPlace = {
  id: string;
  name: string;
  category: string;
  address: string;
  imageUrl: string;
  source: "echoo" | "google_places";
  photoAuthors?: Array<{ displayName: string; uri: string }>;
};
export type CompanionTurn = { id: string; query: string; response?: CompanionResponse };
export type PlanningPreferences = {
  memory_enabled: boolean;
  push_enabled: boolean;
  home_city: string | null;
  timezone: string;
  culture_slugs: string[];
};
export const defaultPlanningPreferences: PlanningPreferences = {
  memory_enabled: false,
  push_enabled: false,
  home_city: null,
  timezone: "America/Toronto",
  culture_slugs: [],
};
export type SavedPlan = {
  id: string;
  plan: QuickPlan;
  created_at: string;
  saved_at: string | null;
};
export type PlanningFeedback = {
  place_name?: string;
  plan_id: string;
  place_id: string;
  action: string;
  created_at: string;
};

export function validateCompanionResponse(
  value: CompanionResponse,
): CompanionResponse {
  if (
    !value ||
    value.version !== 1 ||
    typeof value.sessionId !== "string" ||
    !Number.isInteger(value.revision) ||
    typeof value.message !== "string" ||
    ![
      "plan_ready",
      "plan_partial",
      "no_match",
      "clarification",
      "service_error",
    ].includes(value.status)
  )
    throw new EchooApiError(
      "Echoo returned an unreadable plan. Please try again.",
      502,
    );
  if (value.plan) {
    const original = value.plan;
    const normalized = normalizeQuickPlan(original, original.anchorId);
    if (
      !Array.isArray(original.stops) ||
      original.stops.length !== normalized.stops.length ||
      original.stopCount !== normalized.stopCount ||
      (value.status === "plan_ready" &&
        original.requestedStopCount !== normalized.stopCount)
    )
      throw new EchooApiError(
        "The route was incomplete. Please try again.",
        502,
      );
    value = { ...value, plan: normalized };
  }
  if (["plan_ready", "plan_partial"].includes(value.status) && !value.plan)
    throw new EchooApiError("The plan did not include usable places.", 502);
  return {
    ...value,
    context: Array.isArray(value.context) ? value.context.filter((x) => typeof x === "string").slice(0, 6) : [],
    places: Array.isArray(value.places) ? value.places.filter((p) => p && typeof p.id === "string" && typeof p.name === "string" && typeof p.category === "string").slice(0, 6).map((p) => ({ ...p,
      imageUrl: typeof p.imageUrl === "string" && /^https:\/\//.test(p.imageUrl) ? p.imageUrl : "",
      address: typeof p.address === "string" ? p.address : "",
      photoAuthors: Array.isArray(p.photoAuthors) ? p.photoAuthors.filter((a) => typeof a.displayName === "string").slice(0, 3) : [],
    })) : [],
    notices: Array.isArray(value.notices)
      ? value.notices.filter((x) => typeof x === "string").slice(0, 8)
      : [],
    suggestions: Array.isArray(value.suggestions)
      ? value.suggestions.filter((x) => typeof x === "string").slice(0, 3)
      : [],
  };
}
export async function planWithEchoo(
  input: {
    query: string;
    location: EchooLocation;
    previous: CompanionResponse | null;
    requestId: string;
  },
  signal?: AbortSignal,
) {
  let result: CompanionResponse;
  try {
    result = await edgeRequest<CompanionResponse>("companion-plan", {
    body: {
      query: input.query,
      city: input.location.city,
      sessionId: input.previous?.sessionId,
      revision: input.previous?.revision ?? 0,
      requestId: input.requestId,
    },
    signal,
    });
  } catch (error) {
    if (error instanceof EchooApiError) {
      if (error.status === 404) throw new EchooApiError("I couldn’t reach the planner. Give it a moment, then try again.", 404);
      if (error.status === 401) throw new EchooApiError("Sign in again and we’ll pick this up.", 401);
      throw error;
    }
    throw new Error("We lost the connection for a moment. Your conversation is still here — try sending that again.");
  }
  return validateCompanionResponse(result);
}

export async function resumeCompanion(city: string, signal?: AbortSignal) {
  const { conversation } = await edgeRequest<{ conversation: { response: CompanionResponse; turns: CompanionTurn[]; expiresAt: string } | null }>("companion-plan", { method: "GET", query: { city }, signal });
  if (!conversation || Date.parse(conversation.expiresAt) <= Date.now()) return null;
  return {
    response: validateCompanionResponse(conversation.response),
    turns: (Array.isArray(conversation.turns) ? conversation.turns : []).filter((t) => typeof t.id === "string" && typeof t.query === "string").slice(-10).map((t) => ({ ...t, response: t.response ? validateCompanionResponse(t.response) : undefined })),
  };
}
export async function clearCompanion(sessionId: string, signal?: AbortSignal) {
  await edgeRequest("companion-plan", { body: { action: "reset", sessionId }, signal });
}
export async function planningPreferences(userId: string) {
  const { data, error } = await supabase
    .from("planning_preferences")
    .select("memory_enabled,push_enabled,home_city,timezone,culture_slugs")
    .eq("user_id", userId)
    .maybeSingle();
  if (error)
    throw new Error(
      "Planning preferences are unavailable. Please try again after server setup completes.",
    );
  return (data ?? defaultPlanningPreferences) as PlanningPreferences;
}
export async function updatePlanningPreferences(prefs: PlanningPreferences) {
  const { error } = await supabase.rpc("set_planning_preferences", {
    p_memory: prefs.memory_enabled,
    p_push: prefs.push_enabled,
    p_city: prefs.home_city,
    p_timezone: prefs.timezone,
    p_cultures: prefs.culture_slugs,
  });
  if (error) throw new Error(error.message);
}
export async function planningHistory(userId: string) {
  const [plans, feedback, hidden] = await Promise.all([
    supabase
      .from("planning_saved_plans")
      .select("id,plan,created_at,saved_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("planning_feedback")
      .select("plan_id,place_id,action,created_at")
      .eq("user_id", userId)
      .neq("action", "shown")
      .neq("action", "disliked")
      .order("created_at", { ascending: false })
      .limit(500),
    supabase
      .from("planning_feedback")
      .select("plan_id,place_id,action,created_at,planning_saved_plans(plan)")
      .eq("user_id", userId)
      .eq("action", "disliked")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  if (plans.error || feedback.error || hidden.error)
    throw new Error("Your planning history could not load.");
  return {
    plans: plans.data as SavedPlan[],
    feedback: [
      ...(feedback.data || []),
      ...(hidden.data || []).map((row: any) => ({
        ...row,
        place_name: row.planning_saved_plans?.plan?.stops?.find(
          (stop: any) => stop.id === row.place_id,
        )?.name,
      })),
    ] as PlanningFeedback[],
  };
}
export async function recordPlanningFeedback(
  planId: string,
  placeId: string,
  action: "shown" | "saved" | "liked" | "disliked" | "directions",
) {
  const { error } = await supabase.rpc("record_planning_feedback", {
    p_plan_id: planId,
    p_place_id: placeId,
    p_action: action,
  });
  if (error) throw new Error(error.message);
}
export async function restorePlanningPlace(placeId: string) {
  const { error } = await supabase.rpc("remove_planning_feedback", {
    p_place_id: placeId,
  });
  if (error) throw new Error(error.message);
}
export async function deletePlanningHistory() {
  const { error } = await supabase.rpc("delete_planning_history");
  if (error) throw new Error(error.message);
}
export async function startPlannedOuting(userId: string, plan: QuickPlan) {
  await saveActiveOuting(userId, {
    id: Crypto.randomUUID(),
    ownerId: userId,
    source: "companion",
    plan,
    choices: {
      stopCount: plan.stopCount === 3 ? 3 : 2,
      budgetStyle: plan.budgetStyle as "value" | "balanced" | "elevated",
      mood: plan.mood as "chill" | "curious" | "hype",
      anchorPosition: 1,
    },
    progress: {},
  });
}

export function directionsUrl(plan: QuickPlan) {
  const stops = plan.stops;
  if (!stops.length) throw new Error("This plan has no stops.");
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set(
    "destination",
    `${stops.at(-1)!.latitude},${stops.at(-1)!.longitude}`,
  );
  if (stops.length > 1)
    url.searchParams.set(
      "origin",
      `${stops[0].latitude},${stops[0].longitude}`,
    );
  if (stops.length > 2)
    url.searchParams.set(
      "waypoints",
      stops
        .slice(1, -1)
        .map((s) => `${s.latitude},${s.longitude}`)
        .join("|"),
    );
  url.searchParams.set(
    "travelmode",
    plan.travelMode === "drive"
      ? "driving"
      : plan.travelMode === "transit"
        ? "transit"
        : "walking",
  );
  return url.toString();
}
