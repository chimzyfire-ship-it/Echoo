type SupabaseClientLike = {
  auth?: {
    getUser?: (token: string) => Promise<{
      data?: { user?: { id?: string } | null };
      error?: unknown;
    }>;
  };
  from: (table: string) => any;
};

export type CompanionMemoryContext = {
  available: boolean;
  reason?: string;
  sessionId?: string;
  sessionKey?: string;
  userId?: string;
  memories: Array<Record<string, unknown>>;
  safetyConstraints: Array<Record<string, unknown>>;
  visibleCards: Array<Record<string, unknown>>;
};

export type CompanionMemoryState = {
  city: string;
  cityConfidence: string;
  intent: string;
  strategy: string;
  mood: string;
  constraints?: Record<string, unknown>;
};

function cleanText(value: unknown, fallback = "") {
  return String(value || fallback)
    .replace(/\s+/g, " ")
    .trim();
}

function bearerToken(req: Request) {
  const header = req.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return cleanText(match?.[1]);
}

async function userIdFromRequest(supabase: SupabaseClientLike, req: Request) {
  const token = bearerToken(req);
  if (!token || !supabase.auth?.getUser) return "";
  const { data, error } = await supabase.auth.getUser(token);
  if (error) return "";
  return cleanText(data?.user?.id);
}

function safeSessionKey(input?: string, userId = "") {
  const cleaned = cleanText(input)
    .replace(/[^a-zA-Z0-9:_-]/g, "")
    .slice(0, 96);
  if (cleaned) return cleaned;
  return userId ? "default" : "";
}

async function findSession(input: {
  supabase: SupabaseClientLike;
  userId: string;
  sessionKey: string;
}) {
  let query = input.supabase
    .from("companion_sessions")
    .select("*")
    .eq("session_key", input.sessionKey)
    .limit(1);
  query = input.userId
    ? query.eq("user_id", input.userId)
    : query.is("user_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data || null;
}

async function createSession(input: {
  supabase: SupabaseClientLike;
  userId: string;
  sessionKey: string;
  state: CompanionMemoryState;
}) {
  const { data, error } = await input.supabase
    .from("companion_sessions")
    .insert({
      user_id: input.userId || null,
      session_key: input.sessionKey,
      city_anchor: input.state.city || "Ontario",
      city_confidence: input.state.cityConfidence || "unknown",
      current_intent: input.state.intent || "companion",
      current_strategy: input.state.strategy || "model_companion",
      current_mood: input.state.mood || "open",
      current_constraints: input.state.constraints || {},
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function readCompanionMemory(input: {
  supabase: SupabaseClientLike;
  req: Request;
  sessionKey?: string;
  state: CompanionMemoryState;
}): Promise<CompanionMemoryContext> {
  const userId = await userIdFromRequest(input.supabase, input.req);
  const sessionKey = safeSessionKey(input.sessionKey, userId);
  if (!userId && !sessionKey) {
    return {
      available: false,
      reason: "no_user_or_session",
      memories: [],
      safetyConstraints: [],
      visibleCards: [],
    };
  }

  const existing = await findSession({
    supabase: input.supabase,
    userId,
    sessionKey,
  });
  const session =
    existing ||
    (await createSession({
      supabase: input.supabase,
      userId,
      sessionKey,
      state: input.state,
    }));
  const nowIso = new Date().toISOString();

  const [memoriesResult, safetyResult, cardsResult] = await Promise.all([
    userId
      ? input.supabase
          .from("companion_memories")
          .select("*")
          .eq("user_id", userId)
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
          .order("updated_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    userId
      ? input.supabase
          .from("companion_safety_constraints")
          .select("*")
          .eq("user_id", userId)
          .eq("active", true)
          .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
          .order("severity", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [], error: null }),
    input.supabase
      .from("companion_visible_cards")
      .select("*")
      .eq("session_id", session.id)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order("shown_at", { ascending: false })
      .limit(12),
  ]);

  if (memoriesResult.error) throw memoriesResult.error;
  if (safetyResult.error) throw safetyResult.error;
  if (cardsResult.error) throw cardsResult.error;

  return {
    available: true,
    sessionId: session.id,
    sessionKey,
    userId,
    memories: memoriesResult.data || [],
    safetyConstraints: safetyResult.data || [],
    visibleCards: cardsResult.data || [],
  };
}

function cardId(card: Record<string, unknown>, index: number) {
  return cleanText(
    card.id || card.placeId || card.place_id || card.entityId || card.actionUrl,
    `card-${index}`,
  );
}

function displayCards(payload: Record<string, unknown>) {
  const items = Array.isArray(payload.plans)
    ? payload.plans
    : Array.isArray(payload.recommendations)
      ? payload.recommendations
      : [];
  return items.slice(0, 6).map((item, index) => {
    const card =
      item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const type = cleanText(card.type || card.category || "place", "place");
    return {
      card_id: cardId(card, index),
      card_type: type,
      title: cleanText(card.title || card.name, `Option ${index + 1}`),
      city: cleanText(card.city || card.municipality),
      payload: card,
    };
  });
}

export async function writeCompanionTurn(input: {
  supabase: SupabaseClientLike;
  memory: CompanionMemoryContext | null;
  query: string;
  state: CompanionMemoryState & {
    decision?: { toolDecision?: string };
    safety?: { flags?: string[] };
  };
  response: Record<string, unknown>;
}) {
  if (!input.memory?.available || !input.memory.sessionId) return;
  const cards = displayCards(input.response);
  const visibleCardIds = cards.map((card) => card.card_id);
  const ai =
    input.response.ai && typeof input.response.ai === "object"
      ? (input.response.ai as Record<string, unknown>)
      : {};
  const summary = cleanText(
    ai.assistantMessage || input.response.summary,
  ).slice(0, 500);

  const { data: turn, error: turnError } = await input.supabase
    .from("companion_turns")
    .insert({
      session_id: input.memory.sessionId,
      user_id: input.memory.userId || null,
      query: input.query,
      normalized_state: input.state,
      tool_decision: input.state.decision?.toolDecision || "converse",
      safety_flags: input.state.safety?.flags || [],
      response_summary: summary,
      visible_card_ids: visibleCardIds,
      visible_cards: cards,
    })
    .select("id")
    .single();
  if (turnError) throw turnError;

  await input.supabase
    .from("companion_sessions")
    .update({
      city_anchor: input.state.city || "Ontario",
      city_confidence: input.state.cityConfidence || "unknown",
      current_intent: input.state.intent || "companion",
      current_strategy: input.state.strategy || "model_companion",
      current_mood: input.state.mood || "open",
      current_constraints: input.state.constraints || {},
      last_visible_cards: cards,
    })
    .eq("id", input.memory.sessionId);

  if (!cards.length) return;

  const visibleRows = cards.map((card) => ({
    session_id: input.memory?.sessionId,
    user_id: input.memory?.userId || null,
    turn_id: turn?.id || null,
    ...card,
  }));
  const { error: cardError } = await input.supabase
    .from("companion_visible_cards")
    .upsert(visibleRows, {
      onConflict: "session_id,card_id,card_type",
    });
  if (cardError) throw cardError;
}
