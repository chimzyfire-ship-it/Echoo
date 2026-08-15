/*
 * Echoo · Link Up (window.EchooLinkUp)
 *
 * Self-contained client module for the Link Up feature: explicit "I'm here"
 * check-ins, server-side matching, an aesthetic match pop-up, ephemeral
 * in-app chat, and block/report. Designed to be a no-op when the feature flag
 * is off (LINKUP_ENABLED on the backend), so it is safe to load on every
 * discover page regardless of rollout.
 *
 * Depends on window.EchooAuth (for the Supabase client + auth headers) and on
 * the linkup-* Edge Functions. All realtime uses the existing Supabase client
 * (window.EchooAuth.client) — no new client is created.
 */
(function () {
  "use strict";

  const PRESENCE_TTL_MS = 3 * 60 * 60 * 1000; // mirror of server PRESENCE_TTL_MINUTES
  const PROXIMITY_RADIUS_M = 150; // within this distance → "ready" to check in
  const GPS_MAX_ACCURACY_M = 500; // accept a fix only if reported accuracy ≤ this
  const RETURN_TRIP_DELAY_MS = 25_000; // min time away before a return-trip ping fires

  const state = {
    enabled: null, // unknown until probed; null | true | false
    ready: false,
    userId: null,
    supabase: null,
    placeContext: null, // { id, name } of the currently open place detail
    placeCoords: null, // { lat, lng } for the open place detail (for proximity)
    presenceState: "locked", // "locked" | "ready" | "here" (affordance state machine)
    activePresence: null, // { id, placeId, expiresAt }
    pendingDirections: null, // { placeId, lat, lng, leftAt } remembered for return-trip
    visibility: "visible", // tab visibility — used for return-trip detection
    matchChannel: null,
    chatChannel: null,
    openChat: null, // { conversationId, matchId, peerProfile, expiresAt }
    popupQueue: [],
    activePopup: null,
    pendingActions: new Set(),
  };

  // ────────────────────────────────────────────────────────────────────
  // Utilities
  // ────────────────────────────────────────────────────────────────────
  function supabase() {
    return window.EchooAuth?.client || null;
  }

  function authHeaders() {
    return window.EchooAuth?.authHeaders
      ? window.EchooAuth.authHeaders()
      : { "Content-Type": "application/json" };
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function initials(name) {
    const n = String(name || "").trim();
    if (!n) return "?";
    return (
      n
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0]?.toUpperCase() || "")
        .join("") || "?"
    );
  }

  async function callFunction(name, payload) {
    const client = supabase();
    if (!client) return { ok: false, error: "Auth not ready" };
    const { data, error } = await client.functions.invoke(name, {
      body: payload,
      headers: authHeaders(),
    });
    if (error) return { ok: false, error: error.message || "Network error" };
    return data || { ok: false, error: "No response" };
  }

  function postNative(payload) {
    try {
      window.ReactNativeWebView?.postMessage(
        "echoo:linkup:" + JSON.stringify(payload),
      );
    } catch (_e) {
      /* web-only context */
    }
  }

  function notifyBadge(count) {
    postNative({ type: "badge", count });
  }

  // ────────────────────────────────────────────────────────────────────
  // Proximity — single foreground GPS pings only. No background tracking,
  // no watchPosition. This keeps the feature within free-tier / Expo Go
  // constraints while still enabling a smart, quiet "you're near" signal.
  // ────────────────────────────────────────────────────────────────────

  // Haversine distance in metres between two {lat,lng}.
  function distanceMeters(a, b) {
    if (!a || !b) return Infinity;
    const R = 6371000;
    const dLat = ((b.lat - a.lat) * Math.PI) / 180;
    const dLng = ((b.lng - a.lng) * Math.PI) / 180;
    const s =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((a.lat * Math.PI) / 180) *
        Math.cos((b.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  // One-shot GPS fix. Resolves to { lat, lng, accuracy } or null on any failure
  // (denied, unavailable, timeout). Never throws — failures are silence.
  function pingLocation() {
    return new Promise((resolve) => {
      if (!navigator?.geolocation?.getCurrentPosition) return resolve(null);
      const timer = setTimeout(() => resolve(null), 8000);
      try {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            clearTimeout(timer);
            const acc = pos.coords?.accuracy ?? Infinity;
            if (acc > GPS_MAX_ACCURACY_M) return resolve(null); // too fuzzy → treat as unknown
            resolve({
              lat: pos.coords.latitude,
              lng: pos.coords.longitude,
              accuracy: acc,
            });
          },
          () => {
            clearTimeout(timer);
            resolve(null);
          },
          { enableHighAccuracy: false, timeout: 7000, maximumAge: 30000 },
        );
      } catch (_e) {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  // Resolve the place's coordinates from the place-detail host's route attrs.
  function resolvePlaceCoords() {
    const host = document.querySelector("[data-echoo-linkup-host]");
    if (!host) return null;
    // The sibling route button carries lat/lng; fall back to any route button.
    const routeBtn =
      host.parentElement?.querySelector("[data-echoo-route]") ||
      document.querySelector("[data-echoo-route]");
    const lat = Number(routeBtn?.getAttribute("data-route-latitude"));
    const lng = Number(routeBtn?.getAttribute("data-route-longitude"));
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    return null;
  }

  // Run a single proximity check for the current place and update the
  // affordance state. Returns the resolved state.
  async function refreshProximity() {
    if (!state.placeContext || !state.enabled) return state.presenceState;
    if (
      state.activePresence &&
      state.activePresence.placeId === state.placeContext.id
    ) {
      setPresenceState("here");
      return "here";
    }
    const placeCoords = state.placeCoords || resolvePlaceCoords();
    state.placeCoords = placeCoords;
    if (!placeCoords) {
      setPresenceState("locked");
      return "locked";
    }
    const fix = await pingLocation();
    if (!fix) {
      setPresenceState("locked");
      return "locked";
    }
    const within = distanceMeters(fix, placeCoords) <= PROXIMITY_RADIUS_M;
    setPresenceState(within ? "ready" : "locked");
    return state.presenceState;
  }

  function setPresenceState(s) {
    if (state.presenceState === s) return;
    state.presenceState = s;
    renderCheckinAffordance();
  }

  // ────────────────────────────────────────────────────────────────────
  // Return-trip detection: when the user gets directions we remember the
  // destination. When they come back to the app (visibilitychange → visible)
  // after enough time away, we do ONE proximity ping. If it places them at
  // the destination, we silently check them in — no banner, no tap. The text
  // just flips to "You're here."
  // ────────────────────────────────────────────────────────────────────
  function rememberDirectionsForReturnTrip(place) {
    const coords = resolvePlaceCoords();
    if (!place?.id || !coords) return;
    state.pendingDirections = {
      placeId: place.id,
      name: place.name,
      lat: coords.lat,
      lng: coords.lng,
      leftAt: Date.now(),
    };
  }

  function wireReturnTrip() {
    document.addEventListener("visibilitychange", () => {
      state.visibility = document.visibilityState;
      if (document.visibilityState !== "visible") return;
      const pd = state.pendingDirections;
      if (!pd) return;
      if (Date.now() - pd.leftAt < RETURN_TRIP_DELAY_MS) return; // too quick, probably accidental
      // Only auto-check-in if the place detail for that destination is still
      // the open context (otherwise the user moved on — don't surprise them).
      if (!state.placeContext || state.placeContext.id !== pd.placeId) return;
      attemptReturnTripCheckin(pd);
    });
    // On mobile, the page often stays "visible" while backgrounded behind the
    // maps app. Also catch the window regaining focus as a second signal.
    window.addEventListener("pageshow", () => {
      const pd = state.pendingDirections;
      if (
        pd &&
        Date.now() - pd.leftAt >= RETURN_TRIP_DELAY_MS &&
        state.placeContext?.id === pd.placeId
      ) {
        attemptReturnTripCheckin(pd);
      }
    });
  }

  async function attemptReturnTripCheckin(pd) {
    state.pendingDirections = null; // one-shot
    const fix = await pingLocation();
    if (!fix) return; // GPS unavailable → user can tap the (locked) affordance manually
    const within =
      distanceMeters(fix, { lat: pd.lat, lng: pd.lng }) <= PROXIMITY_RADIUS_M;
    if (!within) return;
    // Silently check in. No banner. The text flip is the whole confirmation.
    await performCheckin(pd.placeId, pd.name);
  }

  // ────────────────────────────────────────────────────────────────────
  // Bootstrap + feature flag
  // ────────────────────────────────────────────────────────────────────
  async function ensureUser() {
    const client = supabase();
    if (!client) return null;
    const { data } = await client.auth.getUser();
    return data?.user?.id || null;
  }

  async function probeEnabled() {
    // The Edge Function returns { disabled: true } when the flag is off, and
    // { ok: true, probe: true } when on. Anything else (auth error, network
    // failure, unexpected shape) → treat as off so we never render UI without
    // a working backend.
    const res = await callFunction("linkup-presence", {
      action: "probe",
    }).catch(() => null);
    if (res && res.disabled) {
      state.enabled = false;
      return false;
    }
    state.enabled = Boolean(res && res.ok && res.probe === true);
    return state.enabled;
  }

  // ────────────────────────────────────────────────────────────────────
  // Init — wired from events.html DOMContentLoaded.
  // ────────────────────────────────────────────────────────────────────
  async function init() {
    if (state.ready) return;
    state.ready = true;
    state.supabase = supabase();
    if (!state.supabase) return;

    state.userId = await ensureUser();
    if (!state.userId) return; // not signed in; check-in affordance still can render and will gate via auth

    const on = await probeEnabled();
    if (!on) return;
    state.enabled = true;

    subscribeToMatches();
    wireReturnTrip();

    // Listen for place-detail open/close. On open, reset to the locked
    // (blurred) state immediately, then run a single proximity ping to
    // potentially promote to "ready" or "here".
    document.addEventListener("echoo:place-detail:open", (e) => {
      state.placeContext = e.detail || null;
      state.placeCoords = null;
      state.presenceState = "locked";
      renderCheckinAffordance();
      // No await — let the ping resolve async; it updates the state when done.
      if (
        state.activePresence &&
        state.activePresence.placeId === state.placeContext?.id
      ) {
        setPresenceState("here");
      } else {
        refreshProximity();
      }
    });
    document.addEventListener("echoo:place-detail:close", () => {
      state.placeContext = null;
      state.placeCoords = null;
      state.presenceState = "locked";
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Realtime: match proposals for this user.
  // ────────────────────────────────────────────────────────────────────
  function subscribeToMatches() {
    if (!state.supabase || !state.userId || state.matchChannel) return;
    const channel = state.supabase
      .channel(`linkup:user:${state.userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "linkup_match_members",
          filter: `user_id=eq.${state.userId}`,
        },
        (payload) => onMatchMemberChange(payload),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "linkup_match_members",
          filter: `user_id=eq.${state.userId}`,
        },
        (payload) => onMatchMemberChange(payload),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "linkup_matches",
        },
        (payload) => onMatchStatusChange(payload),
      )
      .subscribe();
    state.matchChannel = channel;
  }

  // The authoritative joint state lives on linkup_matches (RLS scopes the
  // payload to matches this user can read). Listening here — not only on the
  // caller's own member row — is what reliably tells the FIRST accepter that
  // the second person accepted and a conversation now exists.
  async function onMatchStatusChange(payload) {
    const match = payload.new;
    if (!match || !match.id) return;

    if (match.status === "accepted") {
      const { data: conv } = await state.supabase
        .from("linkup_conversations")
        .select("id, expires_at")
        .eq("match_id", match.id)
        .maybeSingle();
      if (conv) {
        const { data: members } = await state.supabase
          .from("linkup_match_members")
          .select("user_id")
          .eq("match_id", match.id);
        const other = (members || []).find((m) => m.user_id !== state.userId);
        state.popupQueue = state.popupQueue.filter((p) => p.id !== match.id);
        if (state.activePopup?.id === match.id) dismissPopup("resolved");
        openChat({
          conversationId: conv.id,
          matchId: match.id,
          expiresAt: conv.expires_at,
          peerUserId: other?.user_id || null,
        });
      }
    }
    Hub.scheduleRefresh();
  }

  async function onMatchMemberChange(payload) {
    const memberRow = payload.new;
    if (!memberRow || !memberRow.match_id) return;
    // Load the match + the other member + their profile.
    const { data: match } = await state.supabase
      .from("linkup_matches")
      .select("id, status, place_id, reason_tags, expires_at, created_at")
      .eq("id", memberRow.match_id)
      .maybeSingle();
    if (!match) return;

    if (match.status === "pending") {
      enqueuePopup(match);
    } else if (match.status === "accepted") {
      // Both accepted — open the conversation.
      const { data: members } = await state.supabase
        .from("linkup_match_members")
        .select("user_id")
        .eq("match_id", match.id);
      const other = (members || []).find((m) => m.user_id !== state.userId);
      const { data: conv } = await state.supabase
        .from("linkup_conversations")
        .select("id, expires_at")
        .eq("match_id", match.id)
        .maybeSingle();
      if (conv)
        openChat({
          conversationId: conv.id,
          matchId: match.id,
          expiresAt: conv.expires_at,
          peerUserId: other?.user_id || null,
        });
    }
    Hub.scheduleRefresh();
  }

  // ────────────────────────────────────────────────────────────────────
  // Check-in affordance — three quiet states, one element, zero noise.
  //   locked : blurred + dimmed, not tappable (default / location unknown)
  //   ready  : crisp, full opacity, peach — within proximity, tappable
  //   here   : text becomes "You're here" — checked in
  // No dots, no helper text, no exclamation. The blur and the word change
  // carry the whole interaction.
  // ────────────────────────────────────────────────────────────────────
  function renderCheckinAffordance() {
    if (!state.placeContext || !state.placeContext.id) return;
    const host = document.querySelector("[data-echoo-linkup-host]");
    if (!host) return;
    host.innerHTML = "";

    const here =
      state.activePresence &&
      state.activePresence.placeId === state.placeContext.id;
    const s = here ? "here" : state.presenceState; // "here" overrides everything

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `echoo-linkup-checkin is-${s}`;
    btn.textContent = here ? "You're here" : "I'm here";

    if (s === "ready" || s === "here") {
      btn.setAttribute(
        "aria-label",
        here
          ? "You're checked in here — tap to leave"
          : "Mark yourself as here for Link Up",
      );
      btn.addEventListener("click", () => onCheckinToggle());
    } else {
      // Locked: blurred, not focusable, not clickable.
      btn.setAttribute("disabled", "disabled");
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("tabindex", "-1");
      btn.setAttribute("aria-label", "Link Up check-in is nearby only");
    }
    host.appendChild(btn);
  }

  async function onCheckinToggle() {
    if (state.enabled === false) return;
    // Checkout path: already here → leave.
    if (
      state.activePresence &&
      state.placeContext?.id === state.activePresence.placeId
    ) {
      await callFunction("linkup-presence", { action: "checkout" }).catch(
        () => {},
      );
      state.activePresence = null;
      // Re-proximity to drop back to ready/locked rather than re-check-in.
      await refreshProximity();
      return;
    }
    // Require the "ready" state — the blur already gates this, but double-check.
    if (state.presenceState !== "ready") return;

    state.userId = await ensureUser();
    if (!state.userId) return;

    await performCheckin(state.placeContext.id, state.placeContext.name);
  }

  // Shared check-in path used by both the manual tap and the silent return-trip.
  async function performCheckin(placeId /*, placeName */) {
    const res = await callFunction("linkup-presence", {
      action: "checkin",
      placeId,
      sessionToken: sessionStorage.getItem("echoo_linkup_session") || null,
    });
    // The server requires a profile photo + bio to be eligible. If the user
    // hasn't added them yet, prompt quietly rather than failing silently.
    if (res && res.reason === "incomplete_profile") {
      showIncompleteProfilePrompt();
      return;
    }
    if (res?.ok && res.presence) {
      state.activePresence = {
        id: res.presence.id,
        placeId,
        expiresAt: res.presence.expiresAt,
      };
      sessionStorage.setItem("echoo_linkup_session", state.activePresence.id);
      setTimeout(() => {
        if (state.activePresence?.id === res.presence.id) autoCheckout();
      }, PRESENCE_TTL_MS);
      setPresenceState("here");
    }
  }

  function showIncompleteProfilePrompt() {
    let el = document.getElementById("echoo-linkup-notice");
    if (!el) {
      el = document.createElement("div");
      el.id = "echoo-linkup-notice";
      el.className = "echoo-linkup-notice";
      el.innerHTML = `
        <span class="echoo-linkup-notice-copy">Add a photo and a one-liner to start linking up.</span>
        <a class="echoo-linkup-notice-link" href="auth.html#profile">Add</a>`;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add("is-open"));
      setTimeout(() => {
        el.classList.remove("is-open");
        setTimeout(() => el.remove(), 300);
      }, 6000);
    }
  }

  async function autoCheckout() {
    await callFunction("linkup-presence", { action: "checkout" }).catch(
      () => {},
    );
    state.activePresence = null;
    await refreshProximity();
  }

  // ────────────────────────────────────────────────────────────────────
  // Match pop-up.
  // ────────────────────────────────────────────────────────────────────
  async function enqueuePopup(match) {
    // Avoid duplicate popups for the same match.
    if (
      state.popupQueue.some((m) => m.id === match.id) ||
      state.activePopup?.id === match.id
    )
      return;
    // Load the other member's profile for the popup.
    const { data: members } = await state.supabase
      .from("linkup_match_members")
      .select("user_id")
      .eq("match_id", match.id);
    const other = (members || []).find((m) => m.user_id !== state.userId);
    if (!other) return;
    // Onboarding profiles are owner-read only; use the security-definer RPC
    // that exposes share-safe fields for a matched peer.
    const { data: profile } = await state.supabase
      .rpc("linkup_peer_profile", { target_user: other.user_id })
      .maybeSingle();
    const { data: place } = await state.supabase
      .from("canonical_places")
      .select("formatted_address")
      .eq("id", match.place_id)
      .maybeSingle();

    state.popupQueue.push({
      id: match.id,
      expiresAt: match.expires_at,
      reasonTags: match.reason_tags || [],
      peer: {
        userId: other.user_id,
        displayName: profile?.display_name || profile?.username || "Someone",
        photoUrl: profile?.profile_photo_url || null,
        bio: profile?.bio || "",
        cue: cueFrom(profile),
      },
      placeName:
        place?.formatted_address || state.placeContext?.name || "this place",
    });
    notifyBadge(state.popupQueue.length + (state.activePopup ? 1 : 0));
    pumpPopupQueue();
  }

  function cueFrom(profile) {
    if (!profile) return "";
    const bits = [];
    if (profile.interests && profile.interests.length) {
      bits.push(`Into ${lower(profile.interests[0])}`);
    }
    if (profile.home_city) bits.push(profile.home_city);
    return bits.slice(0, 2).join(" · ");
  }
  function lower(s) {
    return String(s || "").toLowerCase();
  }

  async function pumpPopupQueue() {
    if (state.activePopup) return;
    const next = state.popupQueue.shift();
    if (!next) {
      notifyBadge(0);
      return;
    }
    notifyBadge(state.popupQueue.length);
    state.activePopup = next;
    showPopup(next);
  }

  function showPopup(item) {
    ensureModalMount();
    const modal = document.getElementById("echoo-linkup-modal");
    const eyebrow = modal.querySelector(".echoo-linkup-eyebrow");
    eyebrow.textContent = reasonLabel(item.reasonTags);

    // Hero avatar: peer's photo, or initials fallback.
    const avatar = modal.querySelector("[data-linkup-avatar-peer]");
    const name = item.peer.displayName || "Someone";
    if (item.peer.photoUrl) {
      avatar.style.backgroundImage = `url('${item.peer.photoUrl}')`;
      avatar.classList.add("has-photo");
      avatar.textContent = "";
    } else {
      avatar.style.backgroundImage = "";
      avatar.classList.remove("has-photo");
      avatar.textContent = initials(name);
    }

    modal.querySelector(".echoo-linkup-name").textContent = name;
    // Bio line takes precedence over the computed cue — it's the human line.
    const bioNode = modal.querySelector("[data-linkup-bio]");
    bioNode.textContent = item.peer.bio || item.peer.cue || "";
    bioNode.style.display = bioNode.textContent ? "" : "none";

    modal.querySelector(".echoo-linkup-place").textContent =
      `at ${truncate(item.placeName, 42)}`;
    modal.querySelector("[data-linkup-accept]").disabled = false;
    modal.querySelector("[data-linkup-decline]").disabled = false;

    modal.hidden = false;
    requestAnimationFrame(() =>
      modal.querySelector(".echoo-linkup-backdrop").classList.add("is-open"),
    );

    // Auto-dismiss on fuse expiry.
    const fuse = new Date(item.expiresAt).getTime() - Date.now();
    item.timer = setTimeout(
      () => dismissPopup("expired"),
      Math.max(2000, fuse),
    );
    modal._current = item;
  }

  // Pick the strongest available reason tag (order = signal strength).
  function reasonLabel(tags) {
    const ordered = [
      ["shared_interests", "Same taste"],
      ["shared_style", "Same vibe"],
      ["shared_crowd", "Same crowd"],
      ["same_energy", "Same energy"],
      ["shared_energy", "Same wavelength"],
      ["same_home_city", "Same city"],
      ["same_budget", "Same budget"],
    ];
    const set = new Set(tags || []);
    for (const [tag, label] of ordered) if (set.has(tag)) return label;
    return "Link up?";
  }
  function truncate(s, n) {
    s = String(s || "");
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  function ensureModalMount() {
    if (document.getElementById("echoo-linkup-modal")) return;
    const wrap = document.createElement("div");
    wrap.id = "echoo-linkup-modal";
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="echoo-linkup-backdrop" role="presentation">
        <div class="echoo-linkup-card" role="dialog" aria-modal="true" aria-labelledby="echoo-linkup-title">
          <div class="echoo-linkup-hero-avatar" data-linkup-avatar-peer aria-hidden="true"></div>
          <h2 class="echoo-linkup-name" id="echoo-linkup-title">Someone</h2>
          <p class="echoo-linkup-bio" data-linkup-bio></p>
          <p class="echoo-linkup-eyebrow">Link up?</p>
          <p class="echoo-linkup-place">at this place</p>
          <div class="echoo-linkup-actions">
            <button type="button" class="echoo-linkup-btn echoo-linkup-btn--primary" data-linkup-accept>Link up</button>
            <button type="button" class="echoo-linkup-btn echoo-linkup-btn--secondary" data-linkup-decline>Not now</button>
          </div>
          <p class="echoo-linkup-footer">You can end this anytime. Be kind.</p>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap
      .querySelector(".echoo-linkup-backdrop")
      .addEventListener("click", (e) => {
        // A backdrop tap is a real "Not now" — record the decline server-side
        // so the proposal doesn't come back on the hub until re-encounter rules
        // allow it.
        if (e.target === e.currentTarget) respondPopup("declined");
      });
    wrap
      .querySelector("[data-linkup-accept]")
      .addEventListener("click", () => respondPopup("accepted"));
    wrap
      .querySelector("[data-linkup-decline]")
      .addEventListener("click", () => respondPopup("declined"));
  }

  async function respondPopup(choice) {
    const item = document.getElementById("echoo-linkup-modal")?._current;
    if (!item) return;
    const modal = document.getElementById("echoo-linkup-modal");
    modal.querySelector(
      choice === "accepted" ? "[data-linkup-accept]" : "[data-linkup-decline]",
    ).disabled = true;
    await callFunction("linkup-match", {
      action: "respond",
      matchId: item.id,
      response: choice,
    });
    clearTimeout(item.timer);
    closePopup();
    state.activePopup = null;
    pumpPopupQueue();
  }

  function dismissPopup(_reason) {
    const modal = document.getElementById("echoo-linkup-modal");
    if (!modal || !modal._current) return;
    clearTimeout(modal._current.timer);
    closePopup();
    state.activePopup = null;
    pumpPopupQueue();
  }

  function closePopup() {
    const modal = document.getElementById("echoo-linkup-modal");
    if (!modal) return;
    const backdrop = modal.querySelector(".echoo-linkup-backdrop");
    backdrop.classList.remove("is-open");
    setTimeout(() => {
      modal.hidden = true;
    }, 200);
  }

  // ────────────────────────────────────────────────────────────────────
  // Chat.
  // ────────────────────────────────────────────────────────────────────
  async function openChat(ctx) {
    state.openChat = ctx;
    ensureChatMount();
    const sheet = document.getElementById("echoo-linkup-chat");
    sheet.querySelector(".echoo-linkup-chat-title").textContent =
      ctx.title || state.placeContext?.name || "Link Up";
    sheet.querySelector(".echoo-linkup-chat-sub").textContent =
      "Ephemeral chat";
    const list = sheet.querySelector(".echoo-linkup-messages");
    list.innerHTML = "";

    // Load history via direct fetch (functions.invoke doesn't pass query params well).
    const hist = await fetchChat(ctx.conversationId);
    (hist.messages || []).forEach((m) =>
      appendMessage(m, m.sender_id === state.userId),
    );

    sheet.hidden = false;
    requestAnimationFrame(() =>
      sheet
        .querySelector(".echoo-linkup-chat-backdrop")
        .classList.add("is-open"),
    );
    subscribeToChat(ctx.conversationId);
  }

  async function fetchChat(conversationId) {
    const client = state.supabase;
    const url = `${client.supabaseUrl}/functions/v1/linkup-chat?conversationId=${encodeURIComponent(conversationId)}`;
    const res = await fetch(url, {
      headers: { ...authHeaders(), apikey: client.supabaseKey },
    });
    if (!res.ok) return { messages: [] };
    return res.json();
  }

  function subscribeToChat(conversationId) {
    if (state.chatChannel) {
      state.supabase.removeChannel(state.chatChannel);
      state.chatChannel = null;
    }
    const channel = state.supabase
      .channel(`linkup:chat:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "linkup_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new;
          appendMessage(m, m.sender_id === state.userId);
        },
      )
      .subscribe();
    state.chatChannel = channel;
  }

  function appendMessage(m, mine) {
    const list = document.querySelector(
      "#echoo-linkup-chat .echoo-linkup-messages",
    );
    if (!list) return;
    const el = document.createElement("div");
    el.className = `echoo-linkup-bubble ${mine ? "echoo-linkup-bubble--mine" : "echoo-linkup-bubble--theirs"}`;
    el.textContent = m.body;
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
  }

  async function sendMessage() {
    const input = document.querySelector(
      "#echoo-linkup-chat .echoo-linkup-composer input",
    );
    if (!input || !state.openChat) return;
    const body = String(input.value || "")
      .trim()
      .slice(0, 1000);
    if (!body) return;
    input.value = "";
    const { error } = await state.supabase.from("linkup_messages").insert({
      conversation_id: state.openChat.conversationId,
      sender_id: state.userId,
      body,
    });
    if (error) {
      input.value = body;
      // Soft error: surface nothing loud; the message simply didn't send.
    }
  }

  function ensureChatMount() {
    if (document.getElementById("echoo-linkup-chat")) return;
    const wrap = document.createElement("div");
    wrap.id = "echoo-linkup-chat";
    wrap.hidden = true;
    wrap.innerHTML = `
      <div class="echoo-linkup-chat-backdrop" role="presentation">
        <div class="echoo-linkup-chat-sheet" role="dialog" aria-modal="true" aria-label="Link Up chat">
          <div class="echoo-linkup-chat-header">
            <div>
              <div class="echoo-linkup-chat-title">Link Up</div>
              <div class="echoo-linkup-chat-sub">Ephemeral chat</div>
            </div>
            <div class="echoo-linkup-chat-actions">
              <button type="button" class="echoo-linkup-chat-action" data-linkup-report>Report</button>
              <button type="button" class="echoo-linkup-chat-action" data-linkup-block>Block</button>
              <button type="button" class="echoo-linkup-chat-action" data-linkup-end>End</button>
            </div>
          </div>
          <div class="echoo-linkup-messages" aria-live="polite"></div>
          <form class="echoo-linkup-composer" data-linkup-composer>
            <input type="text" placeholder="Say hi" maxlength="1000" aria-label="Message" />
            <button type="submit" aria-label="Send">↑</button>
          </form>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    wrap
      .querySelector(".echoo-linkup-chat-backdrop")
      .addEventListener("click", (e) => {
        if (e.target === e.currentTarget) closeChat();
      });
    wrap
      .querySelector("[data-linkup-composer]")
      .addEventListener("submit", (e) => {
        e.preventDefault();
        sendMessage();
      });
    wrap
      .querySelector("[data-linkup-end]")
      .addEventListener("click", () => endCurrentMatch());
    wrap
      .querySelector("[data-linkup-block]")
      .addEventListener("click", () => blockCurrentChat());
    wrap
      .querySelector("[data-linkup-report]")
      .addEventListener("click", () => reportCurrentChat());
  }

  // Block: permanent for matching purposes, ends the open chat immediately.
  // Requires the peer's user id, threaded through openChat contexts.
  async function blockCurrentChat() {
    const ctx = state.openChat;
    if (!ctx?.peerUserId) return;
    if (
      !confirm(
        "Block this person? They won't be able to match or chat with you again.",
      )
    )
      return;
    await callFunction("linkup-block", { userId: ctx.peerUserId }).catch(
      () => {},
    );
    closeChat();
    state.openChat = null;
    Hub.scheduleRefresh();
  }

  function closeChat() {
    const sheet = document.getElementById("echoo-linkup-chat");
    if (!sheet) return;
    sheet
      .querySelector(".echoo-linkup-chat-backdrop")
      .classList.remove("is-open");
    setTimeout(() => {
      sheet.hidden = true;
    }, 220);
    if (state.chatChannel) {
      state.supabase?.removeChannel(state.chatChannel);
      state.chatChannel = null;
    }
  }

  async function endCurrentMatch() {
    if (!state.openChat) return;
    if (!confirm("End this Link Up? The chat will close and become read-only."))
      return;
    await callFunction("linkup-match", {
      action: "end",
      matchId: state.openChat.matchId,
    });
    closeChat();
    state.openChat = null;
  }

  async function reportCurrentChat() {
    if (!state.openChat) return;
    const reason = prompt(
      "Report reason: spam, harassment, hate, misinformation, rights, other",
      "other",
    );
    if (!reason) return;
    await callFunction("linkup-report", {
      targetType: "match",
      targetId: state.openChat.matchId,
      reason,
    });
    closeChat();
    state.openChat = null;
  }

  // ────────────────────────────────────────────────────────────────────
  // Hub renderer — the Link Up module home (linkup.html).
  //
  // Renders LIVE state off the backend: active presence with a real TTL
  // countdown, pending match proposals, and active conversations. Every row
  // is a real row — no mock data. No-ops when the hub viewport
  // (#echoo-linkup-viewport) isn't on the page, so the same script still
  // powers the place-detail check-in affordance on events.html.
  // ────────────────────────────────────────────────────────────────────
  const ICON_PERSON =
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>';
  const ICON_LINK =
    '<svg viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
  const ICON_CHEVRON =
    '<svg viewBox="0 0 24 24"><path d="M9 18l6-6-6-6"/></svg>';

  const Hub = (() => {
    let active = false;
    let ttlTimer = null;
    let refreshTimer = null;

    function viewport() {
      return document.getElementById("echoo-linkup-viewport");
    }

    function scheduleRefresh() {
      if (!active) return;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(run, 250);
    }

    async function init() {
      if (active) return;
      if (!viewport()) return; // not on the hub page
      active = true;
      renderLoading();
      subscribePresence();
      await run();
    }

    function subscribePresence() {
      if (!state.supabase || !state.userId || state.presenceChannel) return;
      // A presence row changing (TTL sweep -> 'ended', checkout from another
      // tab, or a fresh check-in) should refresh the hub.
      state.presenceChannel = state.supabase
        .channel(`linkup:presence:${state.userId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "linkup_presence",
            filter: `user_id=eq.${state.userId}`,
          },
          () => scheduleRefresh(),
        )
        .subscribe();
    }

    async function run() {
      if (!active) return;
      const vp = viewport();
      if (!vp) return;

      if (!state.userId) state.userId = await ensureUser();
      if (!state.userId) return renderSignedOut();

      if (state.enabled === null) await probeEnabled();
      if (state.enabled === false) return renderDisabled();

      let snap;
      try {
        snap = await loadSnapshot(state.userId);
      } catch (_e) {
        return renderLoading();
      }
      render(snap);
    }

    async function loadSnapshot(userId) {
      const client = state.supabase;
      const nowIso = new Date().toISOString();

      // Owner-read profile to surface the photo+bio gate proactively. The
      // server enforces it again at check-in; this is just a heads-up.
      const { data: profile } = await client
        .from("user_onboarding_profiles")
        .select("profile_photo_url, bio, completed_at, linkup_status")
        .eq("user_id", userId)
        .maybeSingle();
      const incomplete = false;
      const paused =
        !!profile?.linkup_status && profile.linkup_status !== "active";

      const { data: presences } = await client
        .from("linkup_presence")
        .select("id, place_id, arrived_at, expires_at")
        .eq("user_id", userId)
        .eq("status", "active")
        .gt("expires_at", nowIso)
        .order("arrived_at", { ascending: false })
        .limit(1);
      const presence = presences && presences[0] ? presences[0] : null;

      let placeName = null;
      if (presence) placeName = await placeNameFor(client, presence.place_id);

      // My match memberships → pending proposals + active conversations.
      const { data: myMembers } = await client
        .from("linkup_match_members")
        .select("match_id, response")
        .eq("user_id", userId);
      const matchIds = (myMembers || []).map((m) => m.match_id);

      const pending = [];
      const conversations = [];
      if (matchIds.length) {
        const { data: matches } = await client
          .from("linkup_matches")
          .select("id, status, expires_at, reason_tags, place_id, created_at")
          .in("id", matchIds)
          .in("status", ["pending", "accepted"])
          .order("created_at", { ascending: false });
        for (const m of matches || []) {
          if (
            m.status === "pending" &&
            new Date(m.expires_at).getTime() > Date.now()
          ) {
            const row = await loadMatchPeer(client, m, userId);
            if (row) pending.push(row);
          } else if (m.status === "accepted") {
            const row = await loadAcceptedConvo(client, m, userId);
            if (row) conversations.push(row);
          }
        }
      }

      return {
        incomplete,
        paused,
        presence,
        placeName,
        pending,
        conversations,
      };
    }

    async function placeNameFor(client, placeId) {
      if (!placeId) return null;
      const { data: place } = await client
        .from("canonical_places")
        .select("name, formatted_address")
        .eq("id", placeId)
        .maybeSingle();
      return place?.name || place?.formatted_address || null;
    }

    async function loadMatchPeer(client, match, userId) {
      const { data: members } = await client
        .from("linkup_match_members")
        .select("user_id")
        .eq("match_id", match.id);
      const peerId = (members || []).find((m) => m.user_id !== userId)?.user_id;
      if (!peerId) return null;
      const { data: profile } = await client
        .rpc("linkup_peer_profile", { target_user: peerId })
        .maybeSingle();
      return {
        matchId: match.id,
        reasonTags: match.reason_tags || [],
        placeName: await placeNameFor(client, match.place_id),
        peer: {
          userId: peerId,
          displayName: profile?.display_name || profile?.username || "Someone",
          photoUrl: profile?.profile_photo_url || null,
          bio: profile?.bio || "",
        },
      };
    }

    async function loadAcceptedConvo(client, match, userId) {
      const { data: conv } = await client
        .from("linkup_conversations")
        .select("id, expires_at")
        .eq("match_id", match.id)
        .maybeSingle();
      if (!conv) return null;
      const { data: members } = await client
        .from("linkup_match_members")
        .select("user_id")
        .eq("match_id", match.id);
      const peerId = (members || []).find((m) => m.user_id !== userId)?.user_id;
      let peer = null;
      if (peerId) {
        const { data: profile } = await client
          .rpc("linkup_peer_profile", { target_user: peerId })
          .maybeSingle();
        peer = {
          userId: peerId,
          displayName: profile?.display_name || profile?.username || "Someone",
          photoUrl: profile?.profile_photo_url || null,
        };
      }
      return {
        matchId: match.id,
        conversationId: conv.id,
        expiresAt: conv.expires_at,
        peer,
      };
    }

    // ── Rendering ──────────────────────────────────────────────────────
    function setHtml(html) {
      const vp = viewport();
      if (!vp) return;
      vp.innerHTML = html;
      wireActions();
    }

    function renderLoading() {
      setHtml(
        '<div class="echoo-linkup-state"><div class="echoo-linkup-spinner" aria-label="Loading Link Up"></div><p class="echoo-linkup-state-copy">Finding your Link Up status…</p></div>',
      );
    }

    function renderSignedOut() {
      const next = encodeURIComponent("linkup.html");
      setHtml(`
        <div class="echoo-linkup-state">
          <div class="echoo-linkup-state-icon">${ICON_PERSON}</div>
          <h2 class="echoo-linkup-state-title">Sign in to Link Up</h2>
          <p class="echoo-linkup-state-copy">Create an account to connect with the right people, at the right place.</p>
          <a class="echoo-linkup-btn--hero" href="auth.html?next=${next}&mode=signup&intent=linkup">Create account</a>
          <a class="echoo-linkup-btn--outline" href="auth.html?next=${next}&mode=signin">Sign in</a>
        </div>`);
    }

    function renderDisabled() {
      setHtml(`
        <div class="echoo-linkup-state">
          <div class="echoo-linkup-state-icon">${ICON_LINK}</div>
          <h2 class="echoo-linkup-state-title">Link Up is rolling out</h2>
          <p class="echoo-linkup-state-copy">We're opening Link Up city by city. Hang tight — it's almost here.</p>
        </div>`);
    }

    function renderIncomplete() {
      setHtml(`
        <div class="echoo-linkup-state">
          <div class="echoo-linkup-state-icon">${ICON_PERSON}</div>
          <h2 class="echoo-linkup-state-title">Add a photo and a bio</h2>
          <p class="echoo-linkup-state-copy">Every Link Up match has a face and a one-liner. Finish your profile to start matching.</p>
          <a class="echoo-linkup-btn--hero" href="auth.html#profile">Complete profile</a>
        </div>`);
    }

    function renderPaused() {
      setHtml(`
        <div class="echoo-linkup-state">
          <div class="echoo-linkup-state-icon">${ICON_LINK}</div>
          <h2 class="echoo-linkup-state-title">Link Up is paused</h2>
          <p class="echoo-linkup-state-copy">You won't be matched while paused. Your active conversations are unaffected.</p>
          <button type="button" class="echoo-linkup-btn--hero" data-linkup-resume>Resume Link Up</button>
          <a class="echoo-linkup-btn--outline" href="linkup-settings.html">Settings</a>
        </div>`);
    }

    function render(snap) {
      stopTtl();
      // Paused / opted out via settings — show a resume card.
      if (snap.paused) return renderPaused();

      const parts = [renderPresence(snap)];
      if (snap.pending.length) parts.push(renderPending(snap.pending));
      if (snap.conversations.length)
        parts.push(renderConversations(snap.conversations));
      if (!snap.pending.length && !snap.conversations.length) {
        parts.push(snap.presence ? renderScanning() : renderEmptyStandby());
      }
      setHtml(parts.join(""));
      if (snap.presence) startTtl(snap.presence.expires_at);
    }

    function renderPresence(snap) {
      if (!snap.presence) {
        return `<div class="echoo-linkup-presence-card echoo-linkup-presence-card--standby">
          <span class="echoo-linkup-presence-dot"></span>
          <div class="echoo-linkup-presence-text">
            <span class="echoo-linkup-presence-title">Presence off · Standby</span>
            <span class="echoo-linkup-presence-sub">Check in at a venue to start matching.</span>
          </div>
          <a class="echoo-linkup-presence-cta" href="events.html">Find a place</a>
        </div>`;
      }
      const where = escapeHtml(snap.placeName || "your spot");
      return `<div class="echoo-linkup-presence-card echoo-linkup-presence-card--active">
        <span class="echoo-linkup-presence-dot echoo-linkup-presence-dot--live"></span>
        <div class="echoo-linkup-presence-text">
          <span class="echoo-linkup-presence-title">Presence active · ${where}</span>
          <span class="echoo-linkup-presence-sub" data-linkup-ttl>Expires soon</span>
        </div>
        <button type="button" class="echoo-linkup-presence-cta echoo-linkup-presence-cta--ghost" data-linkup-leave>Leave</button>
      </div>`;
    }

    function renderPending(list) {
      const cards = list
        .map((m) => {
          const name = escapeHtml(m.peer.displayName);
          const photo = m.peer.photoUrl
            ? `style="background-image:url('${escapeHtml(m.peer.photoUrl)}')"`
            : "";
          const fallback = m.peer.photoUrl ? "" : initials(m.peer.displayName);
          const bio = escapeHtml(m.peer.bio || "");
          const where = escapeHtml(m.placeName || "this place");
          return `<article class="echoo-linkup-peer-card">
            <div class="echoo-linkup-peer-avatar ${m.peer.photoUrl ? "has-photo" : ""}" ${photo}>${fallback}</div>
            <div class="echoo-linkup-peer-body">
              <div class="echoo-linkup-peer-row">
                <span class="echoo-linkup-peer-name">${name}</span>
                <span class="echoo-linkup-peer-reason">${escapeHtml(reasonLabel(m.reasonTags))}</span>
              </div>
              ${bio ? `<p class="echoo-linkup-peer-bio">${bio}</p>` : ""}
              <span class="echoo-linkup-peer-meta">at ${where}</span>
            </div>
            <div class="echoo-linkup-peer-actions">
              <button type="button" class="echoo-linkup-btn--hero echoo-linkup-btn--sm" data-linkup-accept="${escapeHtml(m.matchId)}">Link up</button>
              <button type="button" class="echoo-linkup-btn--outline echoo-linkup-btn--sm" data-linkup-decline="${escapeHtml(m.matchId)}">Not now</button>
            </div>
          </article>`;
        })
        .join("");
      return `<section class="echoo-linkup-section">
        <h3 class="echoo-linkup-section-title">People to link up with</h3>
        <div class="echoo-linkup-match-list">${cards}</div>
      </section>`;
    }

    function renderConversations(list) {
      const rows = list
        .map((c) => {
          const name = escapeHtml(c.peer?.displayName || "Someone");
          const photo = c.peer?.photoUrl
            ? `style="background-image:url('${escapeHtml(c.peer.photoUrl)}')"`
            : "";
          const fallback = c.peer?.photoUrl ? "" : initials(name);
          return `<article class="echoo-linkup-peer-card echoo-linkup-peer-card--chat" role="button" tabindex="0"
                   data-linkup-conv="${escapeHtml(c.conversationId)}"
                   data-linkup-match="${escapeHtml(c.matchId)}"
                   data-linkup-title="${name}"
                   data-linkup-peer="${escapeHtml(c.peer?.userId || "")}"
                   data-linkup-expires="${escapeHtml(c.expiresAt || "")}">
            <div class="echoo-linkup-peer-avatar ${c.peer?.photoUrl ? "has-photo" : ""}" ${photo}>${fallback}</div>
            <div class="echoo-linkup-peer-body">
              <div class="echoo-linkup-peer-row"><span class="echoo-linkup-peer-name">${name}</span></div>
              <span class="echoo-linkup-peer-meta">Ephemeral chat · tap to open</span>
            </div>
            <div class="echoo-linkup-way-arrow">${ICON_CHEVRON}</div>
          </article>`;
        })
        .join("");
      return `<section class="echoo-linkup-section">
        <h3 class="echoo-linkup-section-title">Your conversations</h3>
        <div class="echoo-linkup-match-list">${rows}</div>
      </section>`;
    }

    function renderEmptyStandby() {
      return `<div class="echoo-linkup-empty"><p class="echoo-linkup-empty-copy">No matches yet. Check in somewhere to meet the right people.</p></div>`;
    }

    function renderScanning() {
      return `<div class="echoo-linkup-empty"><p class="echoo-linkup-empty-copy">Scanning for the right people here — we'll ping you the moment there's a match.</p></div>`;
    }

    // ── Actions ────────────────────────────────────────────────────────
    function wireActions() {
      const vp = viewport();
      if (!vp) return;
      vp.querySelectorAll("[data-linkup-leave]").forEach((b) =>
        b.addEventListener("click", onLeave),
      );
      vp.querySelectorAll("[data-linkup-resume]").forEach((b) =>
        b.addEventListener("click", onResume),
      );
      vp.querySelectorAll("[data-linkup-accept]").forEach((b) =>
        b.addEventListener("click", () =>
          onRespond(b.getAttribute("data-linkup-accept"), "accepted", b),
        ),
      );
      vp.querySelectorAll("[data-linkup-decline]").forEach((b) =>
        b.addEventListener("click", () =>
          onRespond(b.getAttribute("data-linkup-decline"), "declined", b),
        ),
      );
      vp.querySelectorAll("[data-linkup-conv]").forEach((row) => {
        const open = () => onOpenConvo(row);
        row.addEventListener("click", open);
        row.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        });
      });
    }

    async function onLeave() {
      await callFunction("linkup-presence", { action: "checkout" }).catch(
        () => {},
      );
      state.activePresence = null;
      await run();
    }

    async function onResume() {
      if (!state.supabase || !state.userId) return;
      const { error } = await state.supabase
        .from("user_onboarding_profiles")
        .update({ linkup_status: "active" })
        .eq("user_id", state.userId);
      if (error) return;
      await run();
    }

    async function onRespond(matchId, response, btn) {
      if (btn) btn.disabled = true;
      await callFunction("linkup-match", {
        action: "respond",
        matchId,
        response,
      });
      await run();
    }

    async function onOpenConvo(row) {
      const conversationId = row.getAttribute("data-linkup-conv");
      const matchId = row.getAttribute("data-linkup-match");
      const title = row.getAttribute("data-linkup-title") || "Link Up";
      const expiresAt = row.getAttribute("data-linkup-expires") || undefined;
      const peerUserId = row.getAttribute("data-linkup-peer") || null;
      if (!conversationId) return;
      await openChat({ conversationId, matchId, title, expiresAt, peerUserId });
    }

    // ── TTL countdown ──────────────────────────────────────────────────
    function startTtl(expiresAt) {
      stopTtl();
      const tick = () => {
        const node = viewport()?.querySelector("[data-linkup-ttl]");
        if (!node) return stopTtl();
        node.textContent = `Expires in ${ttlWords(expiresAt)}`;
      };
      tick();
      ttlTimer = setInterval(tick, 30_000);
    }
    function stopTtl() {
      if (ttlTimer) clearInterval(ttlTimer);
      ttlTimer = null;
    }
    function ttlWords(expiresAt) {
      const ms = new Date(expiresAt).getTime() - Date.now();
      if (!Number.isFinite(ms) || ms <= 0) return "soon";
      const mins = Math.max(0, Math.round(ms / 60000));
      if (mins < 60) return `${mins}m`;
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h}h ${m}m`;
    }

    return { init, scheduleRefresh, run };
  })();

  // ────────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────────
  window.EchooLinkUp = {
    init,
    initHub: Hub.init,
    refreshHub: Hub.scheduleRefresh,
    checkIn: onCheckinToggle,
    isEnabled: () => state.enabled === true,
    // For the place-detail integration to call when a place sheet opens.
    setPlaceContext(ctx) {
      state.placeContext = ctx;
      renderCheckinAffordance();
    },
    clearPlaceContext() {
      state.placeContext = null;
    },
    // Call this when the user taps Directions so the return-trip check can
    // silently check them in when they come back to Echoo.
    rememberDirections(place) {
      rememberDirectionsForReturnTrip(place);
    },
  };

  // ────────────────────────────────────────────────────────────────────
  // Intro Onboarding Slide Carousel & Minimal Auth Sheet
  // ────────────────────────────────────────────────────────────────────
  function initIntroCarousel() {
    const overlay = document.getElementById("intro-slide-overlay");
    const slides = document.querySelectorAll(".intro-slide");
    const dots = document.querySelectorAll("[data-slide-indicator]");

    const skipBtn = document.getElementById("intro-skip-btn");
    const btnCreateAccount = document.getElementById("btn-create-account");
    const btnSignIn = document.getElementById("btn-sign-in");
    const overlayBtnCreate = document.getElementById("overlay-btn-create");
    const overlayBtnSignin = document.getElementById("overlay-btn-signin");

    let currentSlide = 0;
    let autoTimer = null;

    function goToSlide(index) {
      if (!slides.length) return;
      currentSlide = (index + slides.length) % slides.length;
      slides.forEach((s, i) =>
        s.classList.toggle("active", i === currentSlide),
      );
      dots.forEach((d, i) => d.classList.toggle("active", i === currentSlide));
    }

    function startAutoPlay() {
      stopAutoPlay();
      if (!slides.length) return;
      autoTimer = setInterval(() => {
        goToSlide(currentSlide + 1);
      }, 4000);
    }

    function stopAutoPlay() {
      if (autoTimer) clearInterval(autoTimer);
      autoTimer = null;
    }

    dots.forEach((dot, index) => {
      dot.addEventListener("click", () => {
        stopAutoPlay();
        goToSlide(index);
      });
    });

    function dismissOverlay() {
      stopAutoPlay();
      try {
        localStorage.setItem("echoo_linkup_intro_seen", "true");
      } catch (_e) {}
      if (overlay) overlay.style.display = "none";
    }

    if (skipBtn) {
      skipBtn.addEventListener("click", () => {
        dismissOverlay();
        // If user is already signed in, reveal viewport cleanly
        if (state.userId) {
          const introShell = document.getElementById(
            "echoo-linkup-intro-shell",
          );
          const viewport = document.getElementById("echoo-linkup-viewport");
          if (introShell) introShell.style.display = "none";
          if (viewport) viewport.style.display = "flex";
        }
      });
    }

    const openCreate = () => {
      dismissOverlay();
      openMinimalAuth("signup");
    };

    const openSignIn = () => {
      dismissOverlay();
      openMinimalAuth("signin");
    };

    if (btnCreateAccount)
      btnCreateAccount.addEventListener("click", openCreate);
    if (overlayBtnCreate)
      overlayBtnCreate.addEventListener("click", openCreate);

    if (btnSignIn) btnSignIn.addEventListener("click", openSignIn);
    if (overlayBtnSignin)
      overlayBtnSignin.addEventListener("click", openSignIn);

    if (overlay && overlay.style.display !== "none") {
      startAutoPlay();
    }
  }

  function openMinimalAuth(mode = "signup") {
    const sheet = document.getElementById("linkup-minimal-auth-sheet");
    if (!sheet) return;

    const tabSignup = document.getElementById("auth-tab-signup");
    const tabSignin = document.getElementById("auth-tab-signin");
    const submitBtn = document.getElementById("auth-submit-btn");
    let currentMode = mode === "signin" ? "signin" : "signup";

    function paintMode() {
      if (currentMode === "signup") {
        tabSignup?.classList.add("active");
        tabSignin?.classList.remove("active");
        if (submitBtn) submitBtn.textContent = "Create account →";
      } else {
        tabSignin?.classList.add("active");
        tabSignup?.classList.remove("active");
        if (submitBtn) submitBtn.textContent = "Sign in →";
      }
    }
    paintMode();

    sheet.classList.add("is-open");
    sheet.setAttribute("aria-hidden", "false");

    if (tabSignup)
      tabSignup.onclick = () => {
        currentMode = "signup";
        paintMode();
      };
    if (tabSignin)
      tabSignin.onclick = () => {
        currentMode = "signin";
        paintMode();
      };

    const closeBtn = document.getElementById("auth-close-btn");
    if (closeBtn) {
      closeBtn.onclick = () => {
        sheet.classList.remove("is-open");
        sheet.setAttribute("aria-hidden", "true");
      };
    }

    const form = document.getElementById("linkup-minimal-auth-form");
    if (form && !form.dataset.echooAuthWired) {
      form.dataset.echooAuthWired = "true";
      form.onsubmit = async (e) => {
        e.preventDefault();
        const errorEl = document.getElementById("linkup-auth-error");
        const showError = (message) => {
          if (!errorEl) return;
          errorEl.textContent = message;
          errorEl.hidden = false;
        };
        if (errorEl) errorEl.hidden = true;

        const email = String(
          document.getElementById("auth-email-input")?.value || "",
        )
          .trim()
          .toLowerCase();
        const password = String(
          document.getElementById("auth-pass-input")?.value || "",
        );
        if (!email || !password)
          return showError("Enter your email and password.");

        const client = window.EchooAuth?.client;
        if (!client) return showError("Sign in isn't available right now.");

        if (submitBtn) submitBtn.disabled = true;
        try {
          if (currentMode === "signup") {
            const { data, error } = await client.auth.signUp({
              email,
              password,
            });
            if (error) return showError(error.message);
            if (!data?.session) {
              return showError(
                "Check your email to confirm your account, then sign in.",
              );
            }
          } else {
            const { error } = await client.auth.signInWithPassword({
              email,
              password,
            });
            if (error) return showError(error.message);
          }
          try {
            localStorage.setItem("echoo_linkup_intro_seen", "true");
          } catch (_e) {}
          window.location.reload();
        } catch (_e) {
          showError("Couldn't sign in right now. Try again in a moment.");
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      };
    }
  }

  // Auto-init: engine first, then Hub & smart intro slide overlay
  function boot() {
    let accessAllowed = false;
    Promise.resolve(window.echooAccessReady)
      .then((access) => {
        if (!access?.ok) return null;
        accessAllowed = true;
        return init();
      })
      .then(() => {
        if (!accessAllowed) return;
        Hub.init();
        const introShell = document.getElementById("echoo-linkup-intro-shell");
        const overlay = document.getElementById("intro-slide-overlay");
        const viewport = document.getElementById("echoo-linkup-viewport");

        let hasSeenIntro = false;
        try {
          hasSeenIntro =
            localStorage.getItem("echoo_linkup_intro_seen") === "true";
        } catch (_e) {}

        if (state.userId) {
          // User is logged into Echoo -> IMMEDIATELY show Link Up normal logged-in feature page!
          if (introShell) introShell.style.display = "none";
          if (overlay) overlay.style.display = "none";
          if (viewport) viewport.style.display = "flex";
        } else {
          // Signed-out user → show hero landing screen
          if (introShell) introShell.style.display = "";
          if (viewport) viewport.style.display = "none";

          if (!hasSeenIntro && overlay) {
            overlay.style.display = "flex";
            initIntroCarousel();
          } else if (overlay) {
            overlay.style.display = "none";
          }
        }
      })
      .catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
