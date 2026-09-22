import { providerFailure } from "../_shared/provider-status.ts";
import type { getSupabaseAdmin } from "../_shared/location.ts";

type Database = ReturnType<typeof getSupabaseAdmin>;
async function recordModelHealth(db: Database, status: string, reason?: string) {
  try {
    await db.from("location_query_cache").upsert({
      cache_key: "planning:gemini:health",
      payload: { status, reason, checkedAt: new Date().toISOString() },
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    }, { onConflict: "cache_key" });
  } catch { /* Diagnostics must never break a conversation. */ }
}

export async function reserveProvider(
  db: Database,
  provider: "gemini" | "places",
) {
  const raw = Deno.env.get(
    provider === "gemini"
      ? "PLANNING_GEMINI_DAILY_CALLS"
      : "PLANNING_PLACES_DAILY_CALLS",
  );
  const limit = raw === undefined
    ? (provider === "gemini" ? 10000 : 2000)
    : Number(raw);
  if (!Number.isInteger(limit) || limit < 1) return false;
  const { data, error } = await db.rpc("reserve_planning_provider", {
    p_provider: provider,
    p_daily_limit: limit,
  });
  return !error && data === true;
}

export async function modelJson(
  db: Database,
  system: string,
  input: unknown,
  schema: unknown,
  tokens = 1800,
) {
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) { await recordModelHealth(db, "unavailable", "not_configured"); return null; }
  try {
    if (!await reserveProvider(db, "gemini")) { await recordModelHealth(db, "unavailable", "internal_budget_or_database"); return null; }
    const model = Deno.env.get("GEMINI_PLANNING_MODEL") || "gemini-2.5-flash";
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${
        encodeURIComponent(model)
      }:generateContent`,
      {
        method: "POST",
        signal: AbortSignal.timeout(10000),
        headers: { "Content-Type": "application/json", "x-goog-api-key": key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{
            role: "user",
            parts: [{ text: JSON.stringify(input) }],
          }],
          generationConfig: {
            temperature: 0.35,
            maxOutputTokens: tokens,
            responseMimeType: "application/json",
            responseSchema: schema,
            ...(model.startsWith("gemini-2.5")
              ? { thinkingConfig: { thinkingBudget: 0 } }
              : {}),
          },
        }),
      },
    );
    if (!response.ok) {
      const reason = await providerFailure(response);
      await recordModelHealth(db, "unavailable", reason);
      console.warn("planning model unavailable", { status: response.status, reason });
      return null;
    }
    const body = await response.json();
    if (body.candidates?.[0]?.finishReason !== "STOP") { await recordModelHealth(db, "unavailable", "incomplete_output"); return null; }
    const text = body.candidates?.[0]?.content?.parts?.filter((p: any) =>
      !p.thought
    ).map((p: any) => p.text || "").join("");
    const parsed = JSON.parse(text || "null");
    await recordModelHealth(db, "available");
    return parsed;
  } catch {
    await recordModelHealth(db, "unavailable", "timeout_or_invalid_response");
    console.warn("planning model unavailable", {
      reason: "timeout_or_invalid_response",
    });
    return null;
  }
}
