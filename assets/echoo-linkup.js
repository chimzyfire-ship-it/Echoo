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
    return n.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
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
      window.ReactNativeWebView?.postMessage("echoo:linkup:" + JSON.stringify(payload));
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
    if (state.activePresence && state.activePresence.placeId === state.placeContext.id) {
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
      if (pd && Date.now() - pd.leftAt >= RETURN_TRIP_DELAY_MS &&
          state.placeContext?.id === pd.placeId) {
        attemptReturnTripCheckin(pd);
      }
    });
  }

  async function attemptReturnTripCheckin(pd) {
    state.pendingDirections = null; // one-shot
    const fix = await pingLocation();
    if (!fix) return; // GPS unavailable → user can tap the (locked) affordance manually
    const within = distanceMeters(fix, { lat: pd.lat, lng: pd.lng }) <= PROXIMITY_RADIUS_M;
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
    const res = await callFunction("linkup-presence", { action: "probe" }).catch(() => null);
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
      if (state.activePresence && state.activePresence.placeId === state.placeContext?.id) {
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
      .subscribe();
    state.matchChannel = channel;
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
      const { data: conv } = await state.supabase
        .from("linkup_conversations")
        .select("id, expires_at")
        .eq("match_id", match.id)
        .maybeSingle();
      if (conv) openChat({ conversationId: conv.id, matchId: match.id, expiresAt: conv.expires_at });
    }
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

    const here = state.activePresence && state.activePresence.placeId === state.placeContext.id;
    const s = here ? "here" : state.presenceState; // "here" overrides everything

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `echoo-linkup-checkin is-${s}`;
    btn.textContent = here ? "You're here" : "I'm here";

    if (s === "ready" || s === "here") {
      btn.setAttribute("aria-label", here ? "You're checked in here — tap to leave" : "Mark yourself as here for Link Up");
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
    if (state.activePresence && state.placeContext?.id === state.activePresence.placeId) {
      await callFunction("linkup-presence", { action: "checkout" }).catch(() => {});
      state.activePresence = null;
      // Re-proximity to drop back to ready/locked rather than re-check-in.
      await refreshProximity();
      return;
    }
    // Require the "ready" state — the blur already gates this, but double-check.
    if (state.presenceState !== "ready") return;

    // Auth gate — reuse the place-detail gate so the flow is consistent.
    if (window.EchooAuth?.requireAuthenticatedAction) {
      const gate = await window.EchooAuth.requireAuthenticatedAction({
        next: window.location.pathname.split("/").pop() || "events.html",
        mode: "signup",
        intent: "linkup_checkin",
        reason: "linkup_required",
        caption: "Create an account to Link Up with people around you.",
      });
      if (!gate?.ok) return;
    }
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
    await callFunction("linkup-presence", { action: "checkout" }).catch(() => {});
    state.activePresence = null;
    await refreshProximity();
  }

  // ────────────────────────────────────────────────────────────────────
  // Match pop-up.
  // ────────────────────────────────────────────────────────────────────
  async function enqueuePopup(match) {
    // Avoid duplicate popups for the same match.
    if (state.popupQueue.some((m) => m.id === match.id) || state.activePopup?.id === match.id) return;
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
      placeName: place?.formatted_address || state.placeContext?.name || "this place",
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
  function lower(s) { return String(s || "").toLowerCase(); }

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

    modal.querySelector(".echoo-linkup-place").textContent = `at ${truncate(item.placeName, 42)}`;
    modal.querySelector("[data-linkup-accept]").disabled = false;
    modal.querySelector("[data-linkup-decline]").disabled = false;

    modal.hidden = false;
    requestAnimationFrame(() => modal.querySelector(".echoo-linkup-backdrop").classList.add("is-open"));

    // Auto-dismiss on fuse expiry.
    const fuse = new Date(item.expiresAt).getTime() - Date.now();
    item.timer = setTimeout(() => dismissPopup("expired"), Math.max(2000, fuse));
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
  function truncate(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1) + "…" : s; }

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
    wrap.querySelector(".echoo-linkup-backdrop").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) dismissPopup("declined");
    });
    wrap.querySelector("[data-linkup-accept]").addEventListener("click", () => respondPopup("accepted"));
    wrap.querySelector("[data-linkup-decline]").addEventListener("click", () => dismissPopup("declined"));
  }

  async function respondPopup(choice) {
    const item = document.getElementById("echoo-linkup-modal")?._current;
    if (!item) return;
    const modal = document.getElementById("echoo-linkup-modal");
    modal.querySelector(choice === "accepted" ? "[data-linkup-accept]" : "[data-linkup-decline]").disabled = true;
    await callFunction("linkup-match", { action: "respond", matchId: item.id, response: choice });
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
    setTimeout(() => { modal.hidden = true; }, 200);
  }

  // ────────────────────────────────────────────────────────────────────
  // Chat.
  // ────────────────────────────────────────────────────────────────────
  async function openChat(ctx) {
    state.openChat = ctx;
    ensureChatMount();
    const sheet = document.getElementById("echoo-linkup-chat");
    sheet.querySelector(".echoo-linkup-chat-title").textContent = state.placeContext?.name || "Link Up";
    sheet.querySelector(".echoo-linkup-chat-sub").textContent = "Ephemeral chat";
    const list = sheet.querySelector(".echoo-linkup-messages");
    list.innerHTML = "";

    // Load history via direct fetch (functions.invoke doesn't pass query params well).
    const hist = await fetchChat(ctx.conversationId);
    (hist.messages || []).forEach((m) => appendMessage(m, m.sender_id === state.userId));

    sheet.hidden = false;
    requestAnimationFrame(() => sheet.querySelector(".echoo-linkup-chat-backdrop").classList.add("is-open"));
    subscribeToChat(ctx.conversationId);
  }

  async function fetchChat(conversationId) {
    const client = state.supabase;
    const url = `${client.supabaseUrl}/functions/v1/linkup-chat?conversationId=${encodeURIComponent(conversationId)}`;
    const res = await fetch(url, { headers: { ...authHeaders(), apikey: client.supabaseKey } });
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
    const list = document.querySelector("#echoo-linkup-chat .echoo-linkup-messages");
    if (!list) return;
    const el = document.createElement("div");
    el.className = `echoo-linkup-bubble ${mine ? "echoo-linkup-bubble--mine" : "echoo-linkup-bubble--theirs"}`;
    el.textContent = m.body;
    list.appendChild(el);
    list.scrollTop = list.scrollHeight;
  }

  async function sendMessage() {
    const input = document.querySelector("#echoo-linkup-chat .echoo-linkup-composer input");
    if (!input || !state.openChat) return;
    const body = String(input.value || "").trim().slice(0, 1000);
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
    wrap.querySelector(".echoo-linkup-chat-backdrop").addEventListener("click", (e) => {
      if (e.target === e.currentTarget) closeChat();
    });
    wrap.querySelector("[data-linkup-composer]").addEventListener("submit", (e) => {
      e.preventDefault();
      sendMessage();
    });
    wrap.querySelector("[data-linkup-end]").addEventListener("click", () => endCurrentMatch());
    wrap.querySelector("[data-linkup-report]").addEventListener("click", () => reportCurrentChat());
  }

  function closeChat() {
    const sheet = document.getElementById("echoo-linkup-chat");
    if (!sheet) return;
    sheet.querySelector(".echoo-linkup-chat-backdrop").classList.remove("is-open");
    setTimeout(() => { sheet.hidden = true; }, 220);
    if (state.chatChannel) {
      state.supabase?.removeChannel(state.chatChannel);
      state.chatChannel = null;
    }
  }

  async function endCurrentMatch() {
    if (!state.openChat) return;
    if (!confirm("End this Link Up? You won't be matched again with this person.")) return;
    await callFunction("linkup-match", { action: "end", matchId: state.openChat.matchId });
    closeChat();
    state.openChat = null;
  }

  async function reportCurrentChat() {
    if (!state.openChat) return;
    const reason = prompt("Report reason: spam, harassment, hate, misinformation, rights, other", "other");
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
  // Public API
  // ────────────────────────────────────────────────────────────────────
  window.EchooLinkUp = {
    init,
    checkIn: onCheckinToggle,
    isEnabled: () => state.enabled === true,
    // For the place-detail integration to call when a place sheet opens.
    setPlaceContext(ctx) { state.placeContext = ctx; renderCheckinAffordance(); },
    clearPlaceContext() { state.placeContext = null; },
    // Call this when the user taps Directions so the return-trip check can
    // silently check them in when they come back to Echoo.
    rememberDirections(place) { rememberDirectionsForReturnTrip(place); },
  };

  // Auto-init on DOMContentLoaded if a script flag asks for it.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => init().catch(() => {}));
  } else {
    init().catch(() => {});
  }
})();
