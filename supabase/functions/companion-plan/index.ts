import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withMobileAccess } from '../_shared/mobile-access.ts';
import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
  normalizeCityName,
  ONTARIO_MUNICIPALITIES,
} from "../_shared/location.ts";
import {
  factualCallback,
  readPlanningMemory,
} from "../_shared/planning-memory.ts";
import { handleQuickPlan } from "../quick-plan/service.ts";
import { planningStart } from "./intent.ts";
import { describePlan, understandConversation } from "./conversation.ts";
import { routeNarration } from './voice.ts';
import {
  hydratePlacePreviews,
  type PlacePreview,
  searchPlanningPlaces,
  type SearchResult,
} from "./search.ts";

const uuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);

export async function handleCompanion(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST" && req.method !== "GET") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const started = Date.now();
  const db = getSupabaseAdmin();
  let userId = "", sessionId = "", requestId = "";
  try {
    const token = (req.headers.get("authorization") || "").replace(
      /^Bearer\s+/i,
      "",
    );
    const { data: auth, error: authError } = await db.auth.getUser(token);
    if (authError || !auth?.user) {
      return jsonResponse({ error: "Sign in to plan with Echoo." }, 401);
    }
    userId = auth.user.id;
    if (req.method === "GET") {
      const city = normalizeCityName(new URL(req.url).searchParams.get("city"));
      if (!city) return jsonResponse({ conversation: null });
      const { data, error } = await db.from("planning_sessions")
        .select("id,state,response,expires_at")
        .eq("user_id", userId).eq("state->>city", city.name)
        .gt("expires_at", new Date().toISOString()).is("processing_until", null)
        .not("response", "is", null).order("updated_at", { ascending: false })
        .limit(1).maybeSingle();
      if (error) throw error;
      return jsonResponse({
        conversation: data
          ? {
            response: data.response,
            turns: data.state?.history || [],
            expiresAt: data.expires_at,
          }
          : null,
      });
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return jsonResponse({ error: "Send a valid planning request." }, 422);
    }
    if (body.action === "reset" && uuid(body.sessionId)) {
      const { error } = await db.from("planning_sessions").delete().eq(
        "id",
        body.sessionId,
      ).eq("user_id", userId);
      if (error) throw error;
      return jsonResponse({ cleared: true });
    }
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (
      !query || query.length > 1200 || !uuid(body.requestId) ||
      (body.sessionId && !uuid(body.sessionId))
    ) {
      return jsonResponse({
        error: "Keep your message under 1,200 characters and try again.",
      }, 422);
    }
    requestId = body.requestId;
    const cityMention = ONTARIO_MUNICIPALITIES.filter((candidate) =>
      new RegExp(`\\b(?:in|around|near|to)\\s+${candidate.name}\\b`, "i").test(
        query,
      )
    ).sort((a, b) =>
      b.name.length - a.name.length
    )[0];
    const requestedCity = normalizeCityName(String(body.city || "")) ||
      cityMention;
    if (!requestedCity || requestedCity.coverageLevel !== "municipality") {
      return jsonResponse({
        error: "Choose a specific Ontario city before planning.",
      }, 422);
    }
    const scoped = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false },
      },
    );
    const { data: turn, error: turnError } = await scoped.rpc(
      "begin_planning_turn",
      {
        p_session_id: body.sessionId || null,
        p_revision: Number.isInteger(body.revision) ? body.revision : 0,
        p_request_id: requestId,
      },
    );
    if (turnError) {
      return jsonResponse(
        {
          error: /TURN_BUSY/.test(turnError.message)
            ? "Your previous request is still finishing. Try again shortly."
            : /REVISION_CONFLICT|SESSION_EXPIRED/.test(turnError.message)
            ? "This conversation changed or expired. Start a new plan."
            : /limit|Too many/i.test(turnError.message)
            ? "You have reached the planning limit. Try again later."
            : "Planning is unavailable while server setup completes.",
          code: /TURN_BUSY/.test(turnError.message)
            ? "TURN_BUSY"
            : /REVISION_CONFLICT|SESSION_EXPIRED/.test(turnError.message)
            ? "SESSION_CHANGED"
            : "PLANNING_UNAVAILABLE",
        },
        /TURN_BUSY|REVISION_CONFLICT|SESSION_EXPIRED/.test(turnError.message)
          ? 409
          : /limit|Too many/i.test(turnError.message)
          ? 429
          : 503,
      );
    }
    if (turn.cached) return jsonResponse(turn.cached);
    sessionId = turn.sessionId;
    let city = cityMention || normalizeCityName(turn.state?.city || "") ||
      requestedCity;
    let previous = turn.state?.city === city.name ? turn.state : {};
    const decision = await understandConversation(
      db,
      query,
      city.name,
      previous,
    );
    const { intent, parser } = decision;
    const interpretedCity = normalizeCityName(decision.city);
    if (!interpretedCity || interpretedCity.coverageLevel !== "municipality") {
      decision.action = "clarify";
      decision.message =
        "I’m keeping things local to Ontario for now. Which Ontario city would you like to explore?";
    } else if (interpretedCity.name !== city.name) {
      city = interpretedCity;
      previous = {};
      if (decision.action === "edit") decision.action = "plan";
    }
    const { data: profile } = await db.from("user_onboarding_profiles").select(
      "energy,budget,completed_at",
    ).eq("user_id", userId).maybeSingle();
    if (parser === "rules" && !previous.intent && profile?.completed_at) {
      if (
        !/quiet|chill|lively|party|curious|art|explore|museum|cozy|relax/i.test(
          query,
        )
      ) intent.mood = profile.energy;
      if (
        !/cheap|affordable|budget|luxury|splurge|fine dining|\$/i.test(query) &&
        intent.maxBudget === null
      ) {
        intent.budgetStyle = profile.budget === "$"
          ? "value"
          : profile.budget === "$$$"
          ? "elevated"
          : "balanced";
      }
    }
    if (
      previous.plan && intent.replaceIndex !== null &&
      intent.replaceIndex >= previous.plan.stops.length
    ) {
      intent.blockers.push(
        "That stop is not in your current route. Choose a stop that is shown.",
      );
    }
    const memory = await readPlanningMemory(db, userId);
    const cheaper = Boolean(
      previous.plan && /\b(cheaper|lower budget)\b/i.test(query),
    );
    if (
      cheaper &&
      (!previous.plan.budgetEstimate ||
        previous.plan.budgetEstimate.unknownCount)
    ) {
      intent.blockers.push(
        "I do not have enough price information to compare this route. Try an explicit budget instead.",
      );
    }
    let plan: any = null,
      status = "clarification",
      message = "",
      failureCode = "";
    let searches: SearchResult[] = [];
    if (decision.action === "reply" || decision.action === "clarify") {
      message = decision.message;
    } else if (intent.blockers.length) message = intent.blockers[0];
    else {
      let anchorId = previous.plan?.anchorId;
      const target = intent.replaceIndex;
      const isEdit = Boolean(previous.plan && decision.action === "edit");
      // Search each slot once, including live inventory where useful. Reuse the
      // same provider-grounded IDs for all route attempts and locked positions.
      const firstSearch = await searchPlanningPlaces(
        db,
        intent.slotQueries[0],
        city.name,
      );
      const origin = isEdit && target !== 0
        ? previous.plan.stops[0]
        : firstSearch.places[0];
      searches = [
        firstSearch,
        ...await Promise.all(
          intent.slotQueries.slice(1).map((term) =>
            searchPlanningPlaces(db, term, city.name, origin)
          ),
        ),
      ];
      const slotPlaceIds = searches.map((s) =>
        s.places.filter((p) => !memory.excludedIds.includes(p.id)).map((p) =>
          p.id
        )
      );
      let anchorIds: string[] = [];
      if (
        !isEdit || target === 0 ||
        (intent.stopCount === 1 &&
          /another|alternative|cheaper|lower budget/i.test(query))
      ) {
        anchorIds = (searches[0]?.places || []).filter((place: any) =>
          !memory.excludedIds.includes(place.id) &&
          (!isEdit || place.id !== previous.plan?.stops[0]?.id)
        ).sort((a, b) =>
          Number(memory.likedIds.includes(b.id)) -
          Number(memory.likedIds.includes(a.id))
        ).slice(0, 5).map((place: any) => place.id);
        anchorId = anchorIds[0];
      }
      if (!anchorId) {
        status = "no_match";
        message =
          `I haven’t found a solid match for that in ${city.name} yet. Want to try a different craving, or a nearby city?`;
      } else {
        const lockedStops = isEdit && target !== null
          ? previous.plan.stops.map((stop: any, index: number) => ({
            id: stop.id,
            index,
          })).filter((stop: any) => stop.index !== target)
          : isEdit && intent.stopCount > previous.plan.stops.length
          ? previous.plan.stops.map((stop: any, index: number) => ({
            id: stop.id,
            index,
          }))
          : [];
        for (const stop of lockedStops) {
          if (
            slotPlaceIds[stop.index] &&
            !slotPlaceIds[stop.index].includes(stop.id)
          ) slotPlaceIds[stop.index].push(stop.id);
        }
        const exclude = isEdit && intent.stopCount <= previous.plan.stops.length
          ? previous.plan.stops.filter((_: any, index: number) =>
            target === null ? index > 0 : index === target
          ).map((stop: any) => stop.id)
          : [];
        // An edit to a later stop keeps the original first stop, not the old
        // plan's movable anchor. Both are server-owned canonical IDs.
        if (isEdit && target !== 0 && !anchorIds.length) {
          anchorId = previous.plan.stops[0].id;
          if (!slotPlaceIds[0].includes(anchorId)) {
            slotPlaceIds[0].push(anchorId);
          }
        }
        if (!anchorIds.length) anchorIds = [anchorId];
        for (const candidateAnchor of anchorIds) {
          const response = await handleMeteredQuickPlan(
            new Request(req.url, {
              method: "POST",
              headers: req.headers,
              body: JSON.stringify({
                anchor: { id: candidateAnchor, city: city.name },
                stopCount: intent.stopCount,
                anchorPosition: 1,
                budgetStyle: intent.budgetStyle,
                mood: intent.mood,
                recentPlaceIds: exclude,
                rotationKey: requestId,
              }),
            }),
            {
              startAt: planningStart(intent.day, city.timezone),
              memory,
              requestId,
              lockedStops,
              slotQueries: intent.slotQueries,
              slotPlaceIds,
              liveImages: Object.fromEntries(
                searches.flatMap((s) => s.places).filter((p) => p.imageUrl).map(
                  (p) => [p.id, p.imageUrl],
                ),
              ),
              constraints: {
                excludedTerms: intent.excludedTerms,
                travelMode: intent.travelMode,
                requireRoutes: intent.travelExplicit,
                maxLegMinutes: intent.travelMode === "walk" ? 25 : 45,
                openOnly: intent.openOnly,
                maxPerPerson: cheaper
                  ? Math.min(
                    previous.plan.budgetEstimate.max - 1,
                    intent.maxBudget === null ? Infinity : intent.maxBudget /
                      (intent.budgetScope === "total" ? intent.partySize : 1),
                  )
                  : intent.maxBudget === null
                  ? null
                  : intent.maxBudget /
                    (intent.budgetScope === "total" ? intent.partySize : 1),
              },
            },
          );
          const payload = await response.json();
          if (!response.ok) {
            failureCode = payload.code || "";
            status = response.status >= 500 ? "service_error" : "no_match";
            message = payload.error || "No route fits those preferences yet.";
          } else {
            plan = payload.plan;
            status = plan.stopCount < plan.requestedStopCount
              ? "plan_partial"
              : "plan_ready";
            message = isEdit
              ? (target !== null
                ? "Here’s the updated route. The other stops are kept."
                : "Here’s another route with your preferences kept.")
              : `A ${plan.stopCount}-stop ${
                plan.travelMode === "walk" ? "walking " : ""
              }route in ${city.name}, with room to make it yours.`;
          }
          if (plan || response.status >= 500) break;
        }
      }
    }
    const providerNotices: string[] = [];
    if (
      searches.some((s) => s.liveUnavailable) &&
      (!plan || searches.some((s) => s.places.length < 3))
    ) {
      providerNotices.push(
        "Live place search is taking a break. I’m working with the places already in Echoo.",
      );
    }
    if (searches.some((s) => s.storedUnavailable)) {
      providerNotices.push(
        "Part of our place collection is unavailable right now, so this selection may be smaller.",
      );
    }
    if (failureCode === "ROUTES_UNAVAILABLE") {
      message =
        "I found places to consider, but I can’t check the travel between them right now. I’ve kept your travel preference — you can explore the places below or try a single stop.";
    }
    if (failureCode === "NO_FEASIBLE_PLAN") {
      message = intent.maxBudget !== null
        ? "I found some possibilities, but I don’t have a complete match with enough price information to promise that budget. We can loosen the budget, or try a different kind of place."
        : "There are some possibilities here, but I couldn’t fit them into a reliable route with these preferences. Want to try fewer stops, or change the last one?";
    }
    if (plan) {
      plan.title = decision.title || plan.title;
      message = parser === "gemini"
        ? await describePlan(db, query, decision, plan, [
          ...intent.notices,
          ...providerNotices,
        ], requestId, (turn.state?.history || []).map((t: any) => t.response?.message || ''))
        : routeNarration(plan, requestId, (turn.state?.history || []).map((t: any) => t.response?.message || ''));
    }
    const matches = searches.flatMap((s) => s.places);
    const places: PlacePreview[] = plan
      ? plan.stops.map((s: any) => ({
        id: s.id,
        name: s.name,
        category: s.category,
        address: s.address,
        imageUrl: s.imageUrl,
        source: matches.find((p) => p.id === s.id)?.source || "echoo",
        photoAuthors: matches.find((p) => p.id === s.id)?.photoAuthors || [],
      }))
      : await hydratePlacePreviews(
        db,
        [...new Map(
          matches.filter((p) => !memory.excludedIds.includes(p.id)).map((
            p,
          ) => [p.id, p]),
        ).values()].slice(0, 3),
      );
    const result = {
      version: 1,
      sessionId,
      revision: turn.revision + 1,
      status,
      message,
      mode: decision.action === "reply"
        ? "conversation"
        : plan
        ? "plan"
        : "clarification",
      context: decision.context,
      places,
      plan,
      callback: plan ? factualCallback(memory, plan) : null,
      preferences: {
        city: city.name,
        stopCount: intent.stopCount,
        mood: intent.mood,
        budgetStyle: intent.budgetStyle,
        travelMode: intent.travelMode,
        partySize: intent.partySize,
        day: intent.day,
      },
      notices: [
        ...intent.notices,
        ...providerNotices,
        ...(intent.travelMode === "transit"
          ? [
            "Transit times are estimates for the planned start. Recheck service before each leg.",
          ]
          : []),
        ...(plan && !plan.travelVerified && plan.stopCount > 1
          ? [
            "Travel times are rough walking estimates; the route has not been verified.",
          ]
          : []),
      ],
      suggestions: decision.suggestions.length &&
          (plan || decision.action === "reply" || decision.action === "clarify")
        ? decision.suggestions
        : plan
        ? ["Try a lower budget", "Try a calmer mood", "Try another plan"]
        : intent.blockers.some((note) => note.startsWith("Is that budget"))
        ? ["Per person", "For everyone total"]
        : ["Coffee then a park", "Sushi", "A two-stop date night"],
      memoryEnabled: memory.enabled,
    };
    const { data: finished, error: finishError } = await db.rpc(
      "finish_planning_turn",
      {
        p_user_id: userId,
        p_session_id: sessionId,
        p_request_id: requestId,
        p_state: {
          city: city.name,
          intent: !plan && previous.plan ? previous.intent : intent,
          plan: plan || previous.plan || null,
          pendingIntent: decision.action === "reply"
            ? previous.pendingIntent || null
            : !plan
            ? intent
            : null,
          context: decision.context,
          history: [...(turn.state?.history || []), {
            id: requestId,
            query,
            response: result,
          }].slice(-10),
        },
        p_response: result,
      },
    );
    if (finishError || !finished) {
      return jsonResponse({
        error:
          "Your conversation changed before this plan finished. Start a new plan.",
      }, 409);
    }
    await db.from("planning_metrics").insert({
      user_id: userId,
      kind: status,
      duration_ms: Date.now() - started,
      properties: { parser, stopCount: plan?.stopCount || 0, city: city.name },
    });
    return jsonResponse(result);
  } catch (error) {
    console.error("companion-plan failed", {
      sessionId,
      message: error instanceof Error ? error.message : "unknown",
    });
    if (sessionId) {
      await db.from("planning_sessions").update({
        processing_until: null,
        request_id: null,
      }).eq("id", sessionId).eq("user_id", userId).eq("request_id", requestId);
    }
    return jsonResponse({
      error:
        "Echoo could not finish planning. Your previous route is unchanged; try again.",
    }, 503);
  }
}

function handleMeteredQuickPlan(req: Request, options: Parameters<typeof handleQuickPlan>[1]) {
  return withMobileAccess(request => handleQuickPlan(request, options), 'routes')(req);
}
Deno.serve(withMobileAccess(handleCompanion, 'concierge'));
