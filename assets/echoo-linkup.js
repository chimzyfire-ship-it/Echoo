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
      state.lockReason = null;
      setPresenceState("here");
      return "here";
    }
    const placeCoords = state.placeCoords || resolvePlaceCoords();
    state.placeCoords = placeCoords;
    if (!placeCoords) {
      state.lockReason = "no-coords";
      setPresenceState("locked");
      return "locked";
    }
    const fix = await pingLocation();
    if (!fix) {
      state.lockReason = "location-off";
      setPresenceState("locked");
      return "locked";
    }
    const within = distanceMeters(fix, placeCoords) <= PROXIMITY_RADIUS_M;
    state.lockReason = within ? null : "too-far";
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
    // Invariant 1: presence is declared, never derived. Being back near the
    // venue may PROMPT, never act — one quiet confirm, then the normal
    // explicit check-in path.
    const arrived = confirm(
      `Back at ${pd.name || "this place"}? Check in for Link Up?`,
    );
    if (!arrived) return;
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
      // Locked: blurred, not focusable. The quiet hint says WHY — location
      // off, too far, or the venue has no coordinates — so the state never
      // feels broken.
      const hint =
        state.lockReason === "location-off"
          ? "Turn on location to check in here"
          : state.lockReason === "too-far"
            ? "Get within 150 m to check in"
            : state.lockReason === "no-coords"
              ? "This place can't host check-ins yet"
              : "Link Up check-in is nearby only";
      btn.setAttribute("disabled", "disabled");
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("tabindex", "-1");
      btn.setAttribute("aria-label", hint);
      btn.title = hint;
      host.appendChild(btn);
      const caption = document.createElement("span");
      caption.className = "echoo-linkup-checkin-hint";
      caption.textContent = hint;
      host.appendChild(caption);
      return;
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
    // Invariant 8: adults only. No DOB (or under 18) → no Link Up.
    if (res && res.reason === "age_unverified") {
      showNotice(
        "Link Up is 18+. Add your date of birth to join.",
        "auth.html#profile",
        "Add",
      );
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
    showNotice(
      "Add a photo and a one-liner to start linking up.",
      "auth.html#profile",
      "Add",
    );
  }

  function showNotice(copy, linkHref, linkLabel) {
    let el = document.getElementById("echoo-linkup-notice");
    if (!el) {
      el = document.createElement("div");
      el.id = "echoo-linkup-notice";
      el.className = "echoo-linkup-notice";
      el.innerHTML = `
        <span class="echoo-linkup-notice-copy"></span>
        <a class="echoo-linkup-notice-link" href="#"></a>`;
      document.body.appendChild(el);
      requestAnimationFrame(() => el.classList.add("is-open"));
      setTimeout(() => {
        el.classList.remove("is-open");
        setTimeout(() => el.remove(), 300);
      }, 6000);
    }
    el.querySelector(".echoo-linkup-notice-copy").textContent = copy;
    const link = el.querySelector(".echoo-linkup-notice-link");
    link.href = linkHref;
    link.textContent = linkLabel;
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
      const ghost = profile?.linkup_status === "ghost";
      const paused =
        !!profile?.linkup_status &&
        profile.linkup_status !== "active" &&
        profile.linkup_status !== "ghost";

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
      const myResponses = new Map(
        (myMembers || []).map((m) => [m.match_id, m.response]),
      );

      const pending = [];
      const waiting = [];
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
            if (!row) continue;
            // Split pending by my response: "You're in — waiting for them."
            if (myResponses.get(m.id) === "accepted") waiting.push(row);
            else pending.push(row);
          } else if (m.status === "accepted") {
            const row = await loadAcceptedConvo(client, m, userId);
            if (row) conversations.push(row);
          }
        }
      }

      return {
        incomplete,
        paused,
        ghost,
        presence,
        placeName,
        pending,
        waiting,
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

      const hasActivity =
        snap.pending.length ||
        snap.waiting.length ||
        snap.conversations.length;

      // Clean standby landing when not checked in and no matches/chats.
      if (!snap.presence && !hasActivity) {
        setHtml(renderEmptyStandby());
        return;
      }

      const parts = [renderPresence(snap)];
      if (snap.pending.length) parts.push(renderPending(snap.pending));
      if (snap.waiting.length) parts.push(renderWaiting(snap.waiting));
      if (snap.conversations.length)
        parts.push(renderConversations(snap.conversations));
      if (!hasActivity) {
        parts.push(snap.ghost ? renderGhosting() : renderScanning());
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
          <button type="button" class="echoo-linkup-presence-cta" data-linkup-find-place>Find a place</button>
        </div>`;
      }
      const where = escapeHtml(snap.placeName || "your spot");
      const ghostActive = snap.ghost
        ? `<button type="button" class="echoo-linkup-presence-cta echoo-linkup-presence-cta--ghost" data-linkup-unghost title="Visible to new matches again">Ghost · on</button>`
        : `<button type="button" class="echoo-linkup-presence-cta echoo-linkup-presence-cta--ghost" data-linkup-ghost title="Stay checked in but hidden from new matches">Ghost</button>`;
      return `<div class="echoo-linkup-presence-card echoo-linkup-presence-card--active${snap.ghost ? " is-ghost" : ""}">
        <span class="echoo-linkup-presence-dot echoo-linkup-presence-dot--live"></span>
        <div class="echoo-linkup-presence-text">
          <span class="echoo-linkup-presence-title">${snap.ghost ? "Ghosting" : "Presence active"} · ${where}</span>
          <span class="echoo-linkup-presence-sub" data-linkup-ttl>Expires soon</span>
        </div>
        ${ghostActive}
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
      return `<div class="echoo-linkup-standby">
        <div class="echoo-linkup-standby-icon" aria-hidden="true">${ICON_LINK}</div>
        <h2 class="echoo-linkup-standby-title">Ready when you are</h2>
        <p class="echoo-linkup-standby-copy">Find a place nearby, check in when you arrive, and meet people who match your vibe.</p>
        <button type="button" class="echoo-linkup-standby-cta" data-linkup-find-place>
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>
          Find a place
        </button>
        <p class="echoo-linkup-standby-hint">Matching only starts after you check in.</p>
      </div>`;
    }

    function renderScanning() {
      return `<div class="echoo-linkup-empty"><p class="echoo-linkup-empty-copy">Scanning for the right people here — we'll ping you the moment there's a match.</p></div>`;
    }

    function renderGhosting() {
      return `<div class="echoo-linkup-empty"><p class="echoo-linkup-empty-copy">Ghosting — you're checked in but hidden from new matches. Your conversations stay open.</p></div>`;
    }

    function renderWaiting(list) {
      const cards = list
        .map((m) => {
          const name = escapeHtml(m.peer.displayName);
          const photo = m.peer.photoUrl
            ? `style="background-image:url('${escapeHtml(m.peer.photoUrl)}')"`
            : "";
          const fallback = m.peer.photoUrl ? "" : initials(m.peer.displayName);
          const where = escapeHtml(m.placeName || "this place");
          return `<article class="echoo-linkup-peer-card echoo-linkup-peer-card--waiting">
            <div class="echoo-linkup-peer-avatar ${m.peer.photoUrl ? "has-photo" : ""}" ${photo}>${fallback}</div>
            <div class="echoo-linkup-peer-body">
              <div class="echoo-linkup-peer-row">
                <span class="echoo-linkup-peer-name">${name}</span>
                <span class="echoo-linkup-peer-reason">You're in</span>
              </div>
              <span class="echoo-linkup-peer-meta">Waiting for them · at ${where}</span>
            </div>
          </article>`;
        })
        .join("");
      return `<section class="echoo-linkup-section">
        <h3 class="echoo-linkup-section-title">Waiting on them</h3>
        <div class="echoo-linkup-match-list">${cards}</div>
      </section>`;
    }

    // ── Actions ────────────────────────────────────────────────────────
    function wireActions() {
      const vp = viewport();
      if (!vp) return;
      vp.querySelectorAll("[data-linkup-find-place]").forEach((b) =>
        b.addEventListener("click", () => FindPlace.open()),
      );
      vp.querySelectorAll("[data-linkup-leave]").forEach((b) =>
        b.addEventListener("click", onLeave),
      );
      vp.querySelectorAll("[data-linkup-resume]").forEach((b) =>
        b.addEventListener("click", onResume),
      );
      vp.querySelectorAll("[data-linkup-ghost]").forEach((b) =>
        b.addEventListener("click", () => onGhostToggle("ghost")),
      );
      vp.querySelectorAll("[data-linkup-unghost]").forEach((b) =>
        b.addEventListener("click", () => onGhostToggle("active")),
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

    // Ghost mode: presence without new matching (invariant 10). One field
    // toggle on the presence card — no scanner, no infra.
    async function onGhostToggle(nextStatus) {
      if (!state.supabase || !state.userId) return;
      const { error } = await state.supabase
        .from("user_onboarding_profiles")
        .update({ linkup_status: nextStatus })
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
    openFindPlace: () => FindPlace.open(),
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
  // First-time welcome overlay (localStorage-gated, blurs the hub)
  // ────────────────────────────────────────────────────────────────────
  const WELCOME_KEY = "echoo_linkup_welcome_seen";

  function hasSeenWelcome() {
    try {
      return localStorage.getItem(WELCOME_KEY) === "1";
    } catch (_e) {
      return false;
    }
  }

  function markWelcomeSeen() {
    try {
      localStorage.setItem(WELCOME_KEY, "1");
    } catch (_e) {
      /* private mode */
    }
  }

  const Welcome = (() => {
    let index = 0;
    let wired = false;
    let onDone = null;

    function root() {
      return document.getElementById("echoo-linkup-welcome");
    }

    function paint() {
      const el = root();
      if (!el) return;
      const slides = el.querySelectorAll("[data-welcome-slide]");
      const dots = el.querySelectorAll("[data-welcome-dot]");
      const next = document.getElementById("linkup-welcome-next");
      slides.forEach((s, i) => s.classList.toggle("is-active", i === index));
      dots.forEach((d, i) => d.classList.toggle("is-on", i === index));
      if (next) {
        next.textContent = index >= slides.length - 1 ? "Done" : "Next";
      }
    }

    function finish() {
      markWelcomeSeen();
      const el = root();
      if (el) {
        el.hidden = true;
        el.setAttribute("aria-hidden", "true");
      }
      document.body.classList.remove("linkup-welcome-open");
      if (typeof onDone === "function") {
        const cb = onDone;
        onDone = null;
        cb();
      }
    }

    function open(done) {
      const el = root();
      // Returning visitors: never show carousel, never auto-open Find a place.
      if (!el || hasSeenWelcome()) return;
      onDone = done || null;
      index = 0;
      el.hidden = false;
      el.setAttribute("aria-hidden", "false");
      document.body.classList.add("linkup-welcome-open");
      paint();
      wire();
    }

    function wire() {
      if (wired) return;
      wired = true;
      const el = root();
      if (!el) return;
      const next = document.getElementById("linkup-welcome-next");
      const skip = document.getElementById("linkup-welcome-skip");
      const slides = el.querySelectorAll("[data-welcome-slide]");

      if (next) {
        next.addEventListener("click", () => {
          if (index < slides.length - 1) {
            index += 1;
            paint();
          } else {
            finish();
          }
        });
      }
      if (skip) skip.addEventListener("click", finish);
      el.querySelectorAll("[data-welcome-skip]").forEach((n) =>
        n.addEventListener("click", finish),
      );
    }

    return { open, finish };
  })();

  // ────────────────────────────────────────────────────────────────────
  // Find a place sheet — nearby search + discover handoff
  // ────────────────────────────────────────────────────────────────────
  const FindPlace = (() => {
    const SEARCH_URL =
      "https://dlezregdjpdqmooubwvl.supabase.co/functions/v1/location-search";
    const EXPLORE_URL =
      "https://dlezregdjpdqmooubwvl.supabase.co/functions/v1/explore-search";
    const ANON = "sb_publishable_4FeunYH-ItDm68Sjg93c_w_s8yMizxH";

    let wired = false;
    let category = "";
    let query = "";
    let debounce = null;
    let coords = null;
    let lastToken = 0;

    function root() {
      return document.getElementById("echoo-linkup-find");
    }
    function resultsEl() {
      return document.getElementById("linkup-find-results");
    }
    function inputEl() {
      return document.getElementById("linkup-find-input");
    }

    async function headers() {
      if (window.EchooAuth?.authHeaders) {
        return window.EchooAuth.authHeaders({
          "Content-Type": "application/json",
        });
      }
      return {
        "Content-Type": "application/json",
        apikey: ANON,
        Authorization: `Bearer ${ANON}`,
      };
    }

    function cityFallback() {
      try {
        const prefs = JSON.parse(
          localStorage.getItem("echoo_preferences") || "{}",
        );
        return prefs.city || "Toronto";
      } catch (_e) {
        return "Toronto";
      }
    }

    function formatDistance(meters) {
      if (!Number.isFinite(meters)) return "";
      if (meters < 1000) return `${Math.max(1, Math.round(meters))} m`;
      return `${(meters / 1000).toFixed(meters < 10000 ? 1 : 0)} km`;
    }

    function mapRow(item) {
      const id = item.entity_id || item.id || item.canonicalId || "";
      const name = item.title || item.name || item.display_name || "Place";
      const categoryLabel =
        item.category || item.entity_type || item.primaryCategory || "";
      const address =
        item.address ||
        item.formatted_address ||
        item.city ||
        item.subtitle ||
        "";
      const meters =
        item.distance_meters ??
        item.distanceMeters ??
        (Number.isFinite(item.distance) ? item.distance : null);
      const image =
        item.image_url ||
        item.imageUrl ||
        item.image?.url ||
        item.photo_url ||
        "";
      return {
        id: String(id || ""),
        name: String(name),
        detail: [categoryLabel, address].filter(Boolean).join(" · "),
        distance: formatDistance(Number(meters)),
        image: String(image || ""),
      };
    }

    function setLoading(copy) {
      const box = resultsEl();
      if (!box) return;
      box.innerHTML = `<div class="linkup-find-loading"><div class="echoo-linkup-spinner" aria-hidden="true"></div><span>${escapeHtml(copy || "Looking nearby…")}</span></div>`;
    }

    function setEmpty(copy) {
      const box = resultsEl();
      if (!box) return;
      box.innerHTML = `<div class="linkup-find-empty">${escapeHtml(copy || "No places found. Try another search.")}</div>`;
    }

    function renderRows(rows) {
      const box = resultsEl();
      if (!box) return;
      if (!rows.length) return setEmpty();
      box.innerHTML = rows
        .map((r) => {
          const thumb = r.image
            ? `style="background-image:url('${escapeHtml(r.image)}')"`
            : "";
          const letter = escapeHtml((r.name || "?").charAt(0).toUpperCase());
          const href = r.id
            ? `events.html?place=${encodeURIComponent(r.id)}&name=${encodeURIComponent(r.name)}`
            : `events.html?query=${encodeURIComponent(r.name)}`;
          return `<a class="linkup-find-row" href="${escapeHtml(href)}">
            <span class="linkup-find-thumb" ${thumb}>${r.image ? "" : letter}</span>
            <span class="linkup-find-meta">
              <span class="linkup-find-name">${escapeHtml(r.name)}</span>
              <span class="linkup-find-detail">${escapeHtml(r.detail || "Nearby place")}</span>
            </span>
            ${r.distance ? `<span class="linkup-find-dist">${escapeHtml(r.distance)}</span>` : ""}
          </a>`;
        })
        .join("");
    }

    async function searchNearby() {
      const token = ++lastToken;
      setLoading(query ? "Searching…" : "Looking nearby…");
      if (!coords) {
        coords = await pingLocation();
      }
      const hdrs = await headers();
      let rows = [];

      try {
        if (coords) {
          const res = await fetch(SEARCH_URL, {
            method: "POST",
            headers: hdrs,
            body: JSON.stringify({
              lat: coords.lat,
              lng: coords.lng,
              radiusMeters: 12000,
              category: category || undefined,
              limit: 24,
            }),
          });
          if (res.ok) {
            const payload = await res.json();
            rows = (payload.results || []).map(mapRow);
          }
        }
      } catch (_e) {
        /* fall through */
      }

      if (query || !rows.length) {
        try {
          const q =
            query ||
            (category
              ? `${category} near me`
              : `places to go in ${cityFallback()}`);
          const res = await fetch(EXPLORE_URL, {
            method: "POST",
            headers: hdrs,
            body: JSON.stringify({
              query: q,
              city: cityFallback(),
              lat: coords?.lat,
              lng: coords?.lng,
              includeLiveFallback: true,
              limit: 16,
            }),
          });
          if (res.ok) {
            const payload = await res.json();
            const explore = (payload.results || []).map(mapRow);
            if (query || !rows.length) rows = explore;
            else {
              const seen = new Set(rows.map((r) => r.id || r.name));
              for (const r of explore) {
                const key = r.id || r.name;
                if (!seen.has(key)) {
                  seen.add(key);
                  rows.push(r);
                }
              }
            }
          }
        } catch (_e) {
          /* ignore */
        }
      }

      if (token !== lastToken) return;

      if (query) {
        const q = query.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.detail.toLowerCase().includes(q),
        );
      }
      if (category && rows.length) {
        const c = category.toLowerCase();
        const filtered = rows.filter((r) =>
          `${r.name} ${r.detail}`.toLowerCase().includes(c),
        );
        if (filtered.length) rows = filtered;
      }

      renderRows(rows.slice(0, 20));
    }

    function scheduleSearch() {
      clearTimeout(debounce);
      debounce = setTimeout(searchNearby, 220);
    }

    function open() {
      const el = root();
      if (!el) {
        window.location.href = "events.html";
        return;
      }
      wire();
      el.hidden = false;
      el.setAttribute("aria-hidden", "false");
      requestAnimationFrame(() => el.classList.add("is-open"));
      document.body.classList.add("linkup-find-open");
      const input = inputEl();
      if (input && !input.value) input.focus({ preventScroll: true });
      searchNearby();
    }

    function close() {
      const el = root();
      if (!el) return;
      el.classList.remove("is-open");
      document.body.classList.remove("linkup-find-open");
      setTimeout(() => {
        if (!el.classList.contains("is-open")) {
          el.hidden = true;
          el.setAttribute("aria-hidden", "true");
        }
      }, 240);
    }

    function wire() {
      if (wired) return;
      wired = true;
      const el = root();
      if (!el) return;

      el.querySelectorAll("[data-find-close]").forEach((n) =>
        n.addEventListener("click", close),
      );

      el.querySelectorAll("[data-find-chip]").forEach((chip) => {
        chip.addEventListener("click", () => {
          category = chip.getAttribute("data-find-chip") || "";
          el.querySelectorAll("[data-find-chip]").forEach((c) =>
            c.classList.toggle("is-on", c === chip),
          );
          scheduleSearch();
        });
      });

      const input = inputEl();
      if (input) {
        input.addEventListener("input", () => {
          query = input.value.trim();
          scheduleSearch();
        });
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            query = input.value.trim();
            searchNearby();
          }
        });
      }
    }

    return { open, close };
  })();

  // Auto-init: stable hub first (no carousel flash), welcome only once
  function boot() {
    const vp = document.getElementById("echoo-linkup-viewport");
    if (vp) vp.style.display = "flex";

    Promise.resolve(window.echooAccessReady)
      .then((access) => {
        if (!access?.ok) return null;
        return init();
      })
      .then(() => {
        if (document.getElementById("echoo-linkup-viewport")) {
          Hub.init();
        }
      })
      .catch(() => {
        /* hub stays on loading / signed-out state */
      })
      .finally(() => {
        Welcome.open(() => {
          // After first-time carousel, surface Find a place for signed-in standby.
          if (state.userId) {
            setTimeout(() => FindPlace.open(), 280);
          }
        });
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
