import type { QuickPlanResult } from "../quick-plan/planner.ts";

export type PlanningMemory = {
  enabled: boolean;
  excludedIds: string[];
  recentIds: string[];
  likedIds: string[];
  actions: Array<
    { place_id: string; action: string; created_at: string; plan: any }
  >;
};
export const emptyPlanningMemory = (): PlanningMemory => ({
  enabled: false,
  excludedIds: [],
  recentIds: [],
  likedIds: [],
  actions: [],
});

export async function readPlanningMemory(
  db: any,
  userId: string,
): Promise<PlanningMemory> {
  const { data: prefs, error } = await db.from("planning_preferences").select(
    "memory_enabled",
  ).eq("user_id", userId).maybeSingle();
  if (error) throw error;
  if (!prefs?.memory_enabled) return emptyPlanningMemory();
  const [negative, recent] = await Promise.all([
    db.from("planning_feedback").select("place_id").eq("user_id", userId).eq(
      "action",
      "disliked",
    ).limit(501),
    db.from("planning_feedback").select(
      "place_id,action,created_at,planning_saved_plans(plan)",
    ).eq("user_id", userId).order("created_at", { ascending: false }).limit(
      200,
    ),
  ]);
  if (negative.error || recent.error) throw negative.error || recent.error;
  // Fail closed if the integrity bound is ever broken, never truncate exclusions.
  if ((negative.data || []).length > 500) {
    throw new Error("Too many exclusions to safely load");
  }
  const rows = recent.data || [];
  const engaged = new Set(
    rows.filter((r: any) => ["saved", "liked"].includes(r.action)).map((
      r: any,
    ) => r.place_id),
  );
  const impressions = new Map<string, number>();
  for (const row of rows) {
    if (
      row.action === "shown" &&
      Date.now() - Date.parse(row.created_at) < 14 * 86400000
    ) impressions.set(row.place_id, (impressions.get(row.place_id) || 0) + 1);
  }
  return {
    enabled: true,
    excludedIds: (negative.data || []).map((r: any) => r.place_id),
    recentIds: [...impressions].filter(([id, count]) =>
      count >= 2 && !engaged.has(id)
    ).map(([id]) => id),
    likedIds: [...engaged] as string[],
    actions: rows.filter((r: any) => ["saved", "liked"].includes(r.action)).map(
      (r: any) => ({ ...r, plan: r.planning_saved_plans?.plan }),
    ),
  };
}

export function factualCallback(
  memory: PlanningMemory,
  plan: QuickPlanResult,
): string | null {
  if (!memory.enabled) return null;
  for (const action of memory.actions) {
    if (
      Date.now() - Date.parse(action.created_at) > 90 * 86400000 ||
      memory.excludedIds.includes(action.place_id)
    ) continue;
    const previous = action.plan?.stops?.find((stop: any) =>
      stop.id === action.place_id
    );
    if (!previous?.name || action.plan?.city !== plan.city) continue;
    const match = plan.stops.find((stop) => stop.id === action.place_id);
    if (match) {
      return `You ${action.action === "saved" ? "saved" : "liked"} ${
        String(previous.name).slice(0, 100)
      }. It fits into this route.`;
    }
    const sameCategory = plan.stops.some((stop) =>
      stop.category === previous.category
    );
    if (sameCategory) {
      return `You ${action.action === "saved" ? "saved" : "liked"} ${
        String(previous.name).slice(0, 100)
      }. This plan includes a different place in that category.`;
    }
  }
  return null;
}

export async function persistPlanningResult(
  db: any,
  userId: string,
  requestId: string,
  plan: QuickPlanResult,
) {
  const { data, error } = await db.rpc("store_planning_result", {
    p_user_id: userId,
    p_request_id: requestId,
    p_plan: plan,
  });
  if (error) throw error;
  if (data) plan.planId = data;
  return plan;
}
