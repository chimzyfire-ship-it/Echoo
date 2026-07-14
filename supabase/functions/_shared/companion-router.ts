import type { CompanionToolDecision } from "./companion-core.ts";

export type CompanionRouteAction =
  | "policy_identity"
  | "companion_checkin"
  | "weather_read"
  | "city_correction"
  | "city_reset"
  | "city_orientation"
  | "guided_plan"
  | "choose_city_companion"
  | "plan_followup"
  | "retrieve_places"
  | "model_companion";

export type CompanionRoute = {
  action: CompanionRouteAction;
  toolDecision: CompanionToolDecision;
  reason: string;
};

export function routeCompanionTurn(input: {
  strategy: string;
  toolDecision: CompanionToolDecision;
  weatherAvailable?: boolean;
}): CompanionRoute {
  if (input.strategy === "policy_identity") {
    return {
      action: "policy_identity",
      toolDecision: "answer",
      reason: "identity and model/provider questions use policy copy",
    };
  }
  if (input.strategy === "companion_checkin") {
    return {
      action: "companion_checkin",
      toolDecision: "answer",
      reason: "emotional or companion check-in should not trigger retrieval",
    };
  }
  if (input.strategy === "weather_read") {
    return input.weatherAvailable
      ? {
          action: "weather_read",
          toolDecision: "weather",
          reason: "weather answer has a live weather snapshot",
        }
      : {
          action: "model_companion",
          toolDecision: "converse",
          reason: "weather snapshot unavailable, use companion fallback",
        };
  }
  if (input.strategy === "city_correction") {
    return {
      action: "city_correction",
      toolDecision: "answer",
      reason: "city correction updates state before more planning",
    };
  }
  if (input.strategy === "city_reset") {
    return {
      action: "city_reset",
      toolDecision: "answer",
      reason: "rejected city anchor needs reset before tool use",
    };
  }
  if (input.strategy === "city_orientation") {
    return {
      action: "city_orientation",
      toolDecision: "answer",
      reason: "city understanding uses a dedicated orientation response",
    };
  }
  if (input.strategy === "guided_plan") {
    return {
      action: "guided_plan",
      toolDecision: input.toolDecision,
      reason: "deterministic planner asks or widens before retrieval",
    };
  }
  if (input.strategy === "choose_city_companion") {
    return {
      action: "choose_city_companion",
      toolDecision: "answer",
      reason: "vague Ontario request needs one chosen anchor",
    };
  }
  if (input.strategy === "plan_followup") {
    return {
      action: "plan_followup",
      toolDecision: "answer",
      reason: "follow-up should reference visible cards/state first",
    };
  }
  if (input.strategy === "retrieval_plan") {
    return {
      action: "retrieve_places",
      toolDecision: "retrieve_places",
      reason: "local factual planning requires Ontario retrieval",
    };
  }
  return {
    action: "model_companion",
    toolDecision: input.toolDecision,
    reason: "ordinary companion conversation can use the model drafter",
  };
}
