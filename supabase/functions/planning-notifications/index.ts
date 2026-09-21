import { getSupabaseAdmin, jsonResponse } from "../_shared/location.ts";

export function pushTicket(
  value: any,
): { status: "accepted" | "failed"; id?: string; retire: boolean } {
  const ticket = Array.isArray(value?.data) ? value.data[0] : value?.data;
  return ticket?.status === "ok" && typeof ticket.id === "string"
    ? { status: "accepted", id: ticket.id, retire: false }
    : {
      status: "failed",
      retire: ticket?.details?.error === "DeviceNotRegistered",
    };
}

export async function notificationHandler(req: Request) {
  // Gateway authentication alone is insufficient: this is a scheduler endpoint.
  const secret = Deno.env.get("PLANNING_CRON_SECRET");
  if (!secret || req.headers.get("x-planning-cron-secret") !== secret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }
  const db = getSupabaseAdmin();
  let sent = 0, failed = 0;
  const started = Date.now();
  try {
    const { error: cleanupError } = await db.rpc("cleanup_planning_data");
    if (cleanupError) throw cleanupError;
    // Receipt acceptance is provider handoff, never proof a person saw a push.
    await db.from("planning_notification_outbox").update({ status: "unknown" })
      .eq("status", "accepted").lt(
        "created_at",
        new Date(Date.now() - 24 * 60 * 60000).toISOString(),
      );
    const { data: receipts } = await db.from("planning_notification_outbox")
      .select("id,ticket_id,user_id,device_token").eq("status", "accepted").lt(
        "updated_at",
        new Date(Date.now() - 15 * 60000).toISOString(),
      ).limit(100);
    if (receipts?.length) {
      const response = await fetch(
        "https://exp.host/--/api/v2/push/getReceipts",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: receipts.map((row: any) => row.ticket_id),
          }),
          signal: AbortSignal.timeout(6000),
        },
      );
      if (response.ok) {
        const data = await response.json();
        for (const row of receipts) {
          const receipt = data.data?.[row.ticket_id];
          if (!receipt) continue;
          if (
            receipt.details?.error === "DeviceNotRegistered" && row.device_token
          ) {
            await db.from("planning_push_devices").delete().eq(
              "token",
              row.device_token,
            ).eq("user_id", row.user_id);
          }
          await db.from("planning_notification_outbox").update({
            status: receipt.status === "ok" ? "handed_off" : "failed",
            updated_at: new Date().toISOString(),
          }).eq("id", row.id);
        }
      }
    }
    // Bounded pages keep each invocation within the edge function's budget.
    const body = await req.json().catch(() => ({}));
    const after = typeof body.after === "string" ? body.after : null;
    let query = db.from("planning_preferences").select(
      "user_id,home_city,timezone,culture_slugs",
    ).eq("push_enabled", true).order("user_id").limit(10);
    if (after) query = query.gt("user_id", after);
    const { data: users, error } = await query;
    if (error) throw error;
    let nextAfter: string | null = null;
    for (const user of users || []) {
      if (Date.now() - started > 40000) break;
      nextAfter = user.user_id;
      const local = new Intl.DateTimeFormat("en-CA", {
        timeZone: user.timezone,
        weekday: "short",
        hour: "2-digit",
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const parts = Object.fromEntries(local.map((p) => [p.type, p.value]));
      const kind = parts.weekday === "Fri" && parts.hour === "16"
        ? "weekend"
        : "culture";
      if (
        Number(parts.hour) < 16 || Number(parts.hour) >= 20 ||
        (kind === "culture" && !user.culture_slugs?.length)
      ) continue;
      const { data: items, error: contentError } = await db.rpc(
        "planning_notification_candidates",
        { p_user_id: user.user_id, p_kind: kind },
      );
      if (contentError) throw contentError;
      if (!items?.length) continue;
      const item = items[0];
      const message = kind === "weekend"
        ? {
          title: `Your weekend in ${user.home_city}`,
          body: `${item.title} is coming up. Explore what's on.`,
          path: "/weekend",
        }
        : {
          title: "A new find for your Culture Lens",
          body: `${item.title} is new to Echoo in ${user.home_city}.`,
          path: `/place/${item.place_id}`,
        };
      const campaign = kind === "weekend"
        ? `weekend:${parts.year}-${parts.month}-${parts.day}`
        : `culture:${item.id}`;
      const { data: reservation, error: reserveError } = await db.rpc(
        "reserve_planning_notification",
        {
          p_user_id: user.user_id,
          p_campaign: campaign,
          p_kind: kind,
          p_payload: message,
        },
      );
      if (reserveError) throw reserveError;
      if (!reservation) continue;
      // Recheck consent just before the network operation. Keep uncertain sends
      // counted and do not blindly retry an external operation.
      const { data: prefs } = await db.from("planning_preferences").select(
        "push_enabled",
      ).eq("user_id", user.user_id).single();
      if (!prefs?.push_enabled) {
        await db.from("planning_notification_outbox").update({
          status: "cancelled",
        }).eq("id", reservation.id);
        continue;
      }
      await db.from("planning_notification_outbox").update({
        status: "unknown",
      }).eq("id", reservation.id);
      try {
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          signal: AbortSignal.timeout(6000),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: reservation.token,
            title: message.title,
            body: message.body,
            channelId: "planning",
            data: {
              path: message.path,
              notificationId: reservation.id,
              userId: user.user_id,
            },
          }),
        });
        const ticket = response.ok
          ? pushTicket(await response.json())
          : { status: "failed" as const, retire: false, id: undefined };
        const { error: writeError } = await db.from(
          "planning_notification_outbox",
        ).update({
          status: ticket.status,
          ticket_id: ticket.id || null,
          updated_at: new Date().toISOString(),
        }).eq("id", reservation.id);
        if (writeError) throw writeError;
        if (ticket.retire) {
          await db.from("planning_push_devices").delete().eq(
            "token",
            reservation.token,
          );
        }
        if (ticket.status === "accepted") sent++;
        else failed++;
      } catch {
        failed++; /* Unknown stays counted. Same campaign is never resent. */
      }
    }
    return jsonResponse({
      sent,
      failed,
      nextAfter: users?.length === 10 ||
          (users?.length && nextAfter !== users.at(-1)?.user_id)
        ? nextAfter
        : null,
    });
  } catch (error) {
    console.error("planning-notifications failed", error);
    return jsonResponse(
      { error: "Notification job failed", sent, failed },
      500,
    );
  }
}
Deno.serve(notificationHandler);
