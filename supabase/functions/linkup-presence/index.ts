// Link Up · presence + matching
//
// POST with { action: 'checkin' | 'checkout', placeId, sessionToken? }
//
// checkin:
//   1. Verify eligibility (onboarding complete). Email/DOB are advisory.
//   2. Enforce rate limit on 'checkin' actions.
//   3. Upsert one active presence (per user-per-place) with a TTL.
//   4. Find compatible co-present members at the same place and propose
//      matches — prioritizing whoever has been there longest ("already
//      there"). Skip if blocked, open match exists, age-incompatible (when
//      both have a DOB), or below the affinity threshold.
//
// checkout:
//   Mark the user's active presence(s) ended and end any accepted matches.

import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import {
  LINKUP_ENABLED,
  PRESENCE_TTL_MINUTES,
  MATCH_FUSE_MINUTES,
  AFFINITY_THRESHOLD,
  bearerToken,
  isUuid,
  isUserEligible,
  ageBandCompatible,
  getOnboardingProfile,
  computeAffinity,
  checkRateLimit,
  recordAction,
  activeBlockBetween,
  recentlyMatched,
  disabledResponse,
} from "../_shared/linkup.ts";

interface PresencePayload {
  action?: unknown;
  placeId?: unknown;
  sessionToken?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (req.method !== "POST")
    return jsonResponse({ error: "Method not allowed" }, 405);
  if (!LINKUP_ENABLED) return disabledResponse();

  try {
    const body = (await req.json().catch(() => ({}))) as PresencePayload;
    const action = String(body.action || "").trim();
    const placeId = String(body.placeId || "").trim();
    const sessionToken = body.sessionToken
      ? String(body.sessionToken).slice(0, 64)
      : null;

    // A cheap liveness/flag probe the client uses at boot to decide whether
    // to render any Link Up UI. Returns ok:true only when the flag is on and
    // the function is reachable.
    if (action === "probe") return jsonResponse({ ok: true, probe: true });

    if (!["checkin", "checkout"].includes(action))
      return jsonResponse({ error: "Invalid action" }, 422);

    const supabase = getSupabaseAdmin();
    const { data: auth, error: authError } = await supabase.auth.getUser(
      bearerToken(req),
    );
    if (authError || !auth.user)
      return jsonResponse({ error: "Sign in to use Link Up" }, 401);
    const userId = auth.user.id;

    // Checkout ends every active presence for the caller — no placeId needed.
    if (action === "checkout") {
      await supabase
        .from("linkup_presence")
        .update({ status: "ended" })
        .eq("user_id", userId)
        .eq("status", "active");
      await endAcceptedMatchesForUser(supabase, userId);
      await recordAction(supabase, userId, "checkout");
      return jsonResponse({ ok: true });
    }

    if (!isUuid(placeId))
      return jsonResponse({ error: "Invalid placeId" }, 422);

    // ── checkin ────────────────────────────────────────────────────────
    // Presence eligibility. Hard gates that block even presence: no
    // onboarding, no photo/bio, under-18/no DOB (invariant 8). Non-active
    // linkup_status maps to "paused" — ghost members keep presence with the
    // scan skipped below; truly paused/opted-out members are fully out.
    const eligibility = await isUserEligible(supabase, userId);
    if (!eligibility.eligible && eligibility.reason !== "paused") {
      const reason = eligibility.reason || "ineligible";
      return jsonResponse(
        {
          ok: false,
          error: "Link Up isn't available for this account",
          reason,
        },
        403,
      );
    }

    // Ghost: presence without matching. isUserEligible returns "paused" for
    // every non-active status, so re-read the raw status to tell ghost apart.
    const myProfile =
      eligibility.profile ?? (await getOnboardingProfile(supabase, userId));
    const isGhost = myProfile?.linkup_status === "ghost";
    const isPaused =
      !eligibility.eligible && eligibility.reason === "paused" && !isGhost;
    if (isPaused) {
      return jsonResponse(
        {
          ok: false,
          error: "Link Up is paused for this account",
          reason: "paused",
        },
        403,
      );
    }

    if (!(await checkRateLimit(supabase, userId, "checkin")))
      return jsonResponse({ error: "Slow down — try again in a moment" }, 429);

    // Validate the place exists.
    const { data: place, error: placeError } = await supabase
      .from("canonical_places")
      .select("id, formatted_address, timezone")
      .eq("id", placeId)
      .maybeSingle();
    if (placeError || !place)
      return jsonResponse({ error: "Place not found" }, 404);

    // Upsert active presence (one per user-per-place).
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + PRESENCE_TTL_MINUTES * 60_000,
    ).toISOString();

    // End any prior active presence at this place first, then insert.
    await supabase
      .from("linkup_presence")
      .update({ status: "ended" })
      .eq("user_id", userId)
      .eq("place_id", placeId)
      .eq("status", "active");

    const { data: presence, error: insertError } = await supabase
      .from("linkup_presence")
      .insert({
        user_id: userId,
        place_id: placeId,
        arrived_at: now.toISOString(),
        expires_at: expiresAt,
        status: "active",
        session_token: sessionToken,
      })
      .select("id, expires_at")
      .single();
    if (insertError) throw insertError;

    await recordAction(supabase, userId, "checkin", placeId);

    // ── Matching ───────────────────────────────────────────────────────
    // Ghost members keep presence but never scan (invariant 10).
    if (isGhost) {
      return jsonResponse({
        ok: true,
        presence: { id: presence.id, expiresAt: presence.expiresAt },
        ghost: true,
        proposedMatches: 0,
      });
    }

    const myAge = eligibility.age ?? null;

    // Active presences at the same place, not me. Order by arrived_at ASC so
    // the person who has been "already there" the longest is considered first —
    // they're the one waiting, and the newcomer's check-in is the trigger.
    const { data: others, error: othersError } = await supabase
      .from("linkup_presence")
      .select("user_id, arrived_at")
      .eq("place_id", placeId)
      .eq("status", "active")
      .neq("user_id", userId)
      .gt("expires_at", now.toISOString())
      .order("arrived_at", { ascending: true });
    if (othersError) throw othersError;

    const newMatches: { matchId: string; withUserId: string }[] = [];

    for (const other of others ?? []) {
      const otherId = other.user_id as string;

      // Skip if blocked either direction.
      if (await activeBlockBetween(supabase, userId, otherId)) continue;
      // Skip if there's an open (pending/accepted) match with this person.
      if (await recentlyMatched(supabase, userId, otherId)) continue;

      // Eligibility on the other side — non-active statuses (paused, ghost,
      // opted_out) are never proposed as peers.
      const otherElig = await isUserEligible(supabase, otherId);
      if (!otherElig.eligible) continue;

      // Age band. DOB is a hard gate on both sides (invariant 8), so a
      // missing age here means the peer was eligible pre-migration — treat
      // conservatively and skip.
      if (otherElig.age === undefined || otherElig.age === null) continue;
      if (!ageBandCompatible(myAge, otherElig.age)) continue;

      const otherProfile = await getOnboardingProfile(supabase, otherId);
      const { affinity, reason_tags } = computeAffinity(
        myProfile,
        otherProfile,
      );

      // Only propose when there's real compatibility signal. This is the line
      // between "magical" (the right person) and "spammy" (any person).
      if (affinity < AFFINITY_THRESHOLD) continue;

      const fuse = new Date(
        now.getTime() + MATCH_FUSE_MINUTES * 60_000,
      ).toISOString();

      const { data: match, error: matchError } = await supabase
        .from("linkup_matches")
        .insert({
          place_id: placeId,
          status: "pending",
          affinity,
          reason_tags,
          expires_at: fuse,
        })
        .select("id")
        .single();
      if (matchError || !match) {
        console.error("linkup-presence match insert failed", matchError);
        continue;
      }

      const { error: membersError } = await supabase
        .from("linkup_match_members")
        .insert([
          { match_id: match.id, user_id: userId, response: "pending" },
          { match_id: match.id, user_id: otherId, response: "pending" },
        ]);
      if (membersError) {
        // Roll back the match if we couldn't create both members.
        await supabase.from("linkup_matches").delete().eq("id", match.id);
        console.error("linkup-presence members insert failed", membersError);
        continue;
      }

      newMatches.push({ matchId: match.id, withUserId: otherId });
    }

    return jsonResponse({
      ok: true,
      presence: { id: presence.id, expiresAt: presence.expires_at },
      proposedMatches: newMatches.length,
    });
  } catch (error) {
    console.error("linkup-presence failed", error);
    return jsonResponse({ error: "Could not update Link Up presence" }, 500);
  }
});

async function endAcceptedMatchesForUser(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userId: string,
) {
  // Find accepted matches involving this user and end them.
  const { data: mine, error } = await supabase
    .from("linkup_match_members")
    .select("match_id")
    .eq("user_id", userId);
  if (error || !mine || mine.length === 0) return;
  const ids = mine.map((r: { match_id: string }) => r.match_id);
  await supabase
    .from("linkup_matches")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("status", "accepted")
    .in("id", ids);
}
