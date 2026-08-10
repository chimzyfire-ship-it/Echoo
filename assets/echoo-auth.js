(function () {
  const CONFIG = {
    supabaseUrl: "https://dlezregdjpdqmooubwvl.supabase.co",
    supabaseAnonKey: "sb_publishable_4FeunYH-ItDm68Sjg93c_w_s8yMizxH",
  };
  const PROFILE_TABLE = "user_onboarding_profiles";
  const VALID_BUDGETS = new Set(["$", "$$", "$$$"]);
  const VALID_ENERGIES = new Set(["chill", "hype", "curious"]);
  const VALID_TONES = new Set(["direct", "detailed"]);
  const AUTH_STORAGE_KEY = "echoo.auth.session";

  // Echoo deliberately keeps authentication scoped to the open browser or
  // WebView session. Preferences may persist locally, but an access token
  // never does: closing the browser/app requires an intentional sign-in.
  const sessionStorageAdapter = {
    getItem(key) {
      try {
        return window.sessionStorage.getItem(key);
      } catch (_err) {
        return null;
      }
    },
    setItem(key, value) {
      try {
        window.sessionStorage.setItem(key, value);
      } catch (_err) {}
    },
    removeItem(key) {
      try {
        window.sessionStorage.removeItem(key);
      } catch (_err) {}
    },
  };

  const client =
    window.echooSupabaseClient ||
    (window.supabase
      ? window.supabase.createClient(
          CONFIG.supabaseUrl,
          CONFIG.supabaseAnonKey,
          {
            auth: {
              persistSession: true,
              autoRefreshToken: true,
              detectSessionInUrl: true,
              storage: sessionStorageAdapter,
              storageKey: AUTH_STORAGE_KEY,
            },
          },
        )
      : null);

  if (client) window.echooSupabaseClient = client;

  function clean(value, fallback = "") {
    return String(value || fallback).trim();
  }

  function arrayFrom(value) {
    const raw = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];
    return [...new Set(raw.map((item) => clean(item)).filter(Boolean))].slice(
      0,
      32,
    );
  }

  function safeBudget(value) {
    return VALID_BUDGETS.has(value) ? value : "$";
  }

  function safeEnergy(value) {
    return VALID_ENERGIES.has(value) ? value : "chill";
  }

  function safeTone(value) {
    return VALID_TONES.has(value) ? value : "direct";
  }

  function safeDate(value) {
    if (!value) return null;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return null;
    return String(value).slice(0, 10);
  }

  function nationalitiesFrom(value) {
    return arrayFrom(value).slice(0, 8);
  }

  function normalizeUsername(value) {
    return clean(value)
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "")
      .slice(0, 24);
  }

  function isValidUsername(value) {
    const raw = clean(value);
    return raw === normalizeUsername(raw) && /^[a-z0-9_]{3,24}$/.test(raw);
  }

  function currentRelativeUrl() {
    const file = window.location.pathname.split("/").pop() || "index.html";
    return `${file}${window.location.search}${window.location.hash}`;
  }

  function normalizeNext(next, fallback = "index.html") {
    if (!next) return fallback;
    try {
      const url = new URL(next, window.location.href);
      if (url.origin !== window.location.origin) return fallback;
      const file = url.pathname.split("/").pop() || "index.html";
      return `${file}${url.search}${url.hash}`;
    } catch (_err) {
      return fallback;
    }
  }

  function redirectToAuth(next = currentRelativeUrl(), mode = "signup", meta = {}) {
    const params = new URLSearchParams({
      next: normalizeNext(next),
      mode,
    });
    const intent = clean(meta.intent);
    const reason = clean(meta.reason);
    const caption = clean(meta.caption);
    if (intent) params.set("intent", intent);
    if (reason) params.set("reason", reason);
    if (caption) params.set("caption", caption);
    window.location.href = `auth.html?${params.toString()}`;
  }

  function readLocalPreferences() {
    try {
      return JSON.parse(localStorage.getItem("echoo_preferences") || "{}");
    } catch (_err) {
      return {};
    }
  }

  function writeLocalPreferences(prefs) {
    const next = {
      ...readLocalPreferences(),
      ...prefs,
      personalizationProfile: {
        ...(readLocalPreferences().personalizationProfile || {}),
        ...(prefs.personalizationProfile || {}),
      },
    };
    localStorage.setItem("echoo_preferences", JSON.stringify(next));
    return next;
  }

  function profileToPreferences(row, user) {
    if (!row) return null;
    const interests = arrayFrom(row.interests);
    const eventStyles = arrayFrom(row.event_styles);
    const audiences = arrayFrom(row.audiences);
    const motivations = arrayFrom(row.motivations);
    const name =
      clean(row.display_name) ||
      clean(user?.user_metadata?.display_name) ||
      clean(user?.email, "User").split("@")[0];
    const email = clean(row.email) || clean(user?.email);
    const budget = safeBudget(row.budget);
    const energy = safeEnergy(row.energy);
    const storedCity = clean(row.home_city, "Greater Toronto Area");
    const city = /^ontario$/i.test(storedCity)
      ? "Greater Toronto Area"
      : storedCity;
    const gender = clean(row.gender, "Prefer not to say");
    const nationalities = nationalitiesFrom(row.nationalities);
    const dob = row.date_of_birth || "";
    const tone = safeTone(row.tone);
    const username = clean(row.username);
    const personalizationProfile = {
      interests,
      eventStyles,
      audiences,
      motivations,
      budget,
      energy,
      city,
      gender,
      nationalities,
      dob,
      tone,
    };
    return {
      userId: row.user_id || user?.id,
      username,
      name,
      email,
      vibes: interests.join(","),
      interests,
      eventStyles,
      audiences,
      motivations,
      budget,
      energy,
      city,
      gender,
      nationalities,
      dob,
      tone,
      profilePhotoUrl: clean(row.profile_photo_url) || null,
      bio: clean(row.bio),
      onboardingCompletedAt: row.completed_at,
      personalizationProfile,
      pipeda_consent_at: row.metadata?.pipeda_consent_at || null,
      city_intel_consent_at: row.metadata?.city_intel_consent_at || null,
      casl_push_consent_at: row.metadata?.casl_push_consent_at || null,
    };
  }

  function dbPayloadFromPreferences(profile, user) {
    const interests = arrayFrom(profile.interests || profile.vibes);
    const eventStyles = arrayFrom(profile.eventStyles || profile.event_styles);
    const audiences = arrayFrom(profile.audiences);
    const motivations = arrayFrom(profile.motivations);
    const budget = safeBudget(profile.budget);
    const energy = safeEnergy(profile.energy);
    const tone = safeTone(profile.tone);
    const nationalities = nationalitiesFrom(profile.nationalities);
    return {
      user_id: user.id,
      username: normalizeUsername(
        profile.username || profile.handle || profile.name,
      ),
      display_name:
        clean(profile.name || profile.displayName) ||
        clean(user.user_metadata?.display_name) ||
        clean(user.email, "User").split("@")[0],
      email: clean(profile.email) || clean(user.email),
      interests,
      event_styles: eventStyles,
      audiences,
      motivations,
      budget,
      energy,
      home_city: /^ontario$/i.test(clean(profile.city || profile.home_city))
        ? "Greater Toronto Area"
        : clean(profile.city || profile.home_city, "Greater Toronto Area"),
      gender: clean(profile.gender, "Prefer not to say"),
      nationalities,
      nationality_disclosed_at:
        nationalities.length > 0
          ? profile.nationality_disclosed_at || new Date().toISOString()
          : null,
      date_of_birth: safeDate(profile.dob || profile.date_of_birth),
      tone,
      profile_photo_url: clean(profile.profilePhotoUrl || profile.profile_photo_url) || null,
      bio: clean(profile.bio, ""),
      profile_version: 1,
      completed_at: new Date().toISOString(),
      personality_signals: {
        interests,
        eventStyles,
        audiences,
        motivations,
        budget,
        energy,
        tone,
        nationalities,
      },
      metadata: {
        source: clean(profile.source, "web_onboarding"),
        pipeda_consent_at: profile.pipeda_consent_at || null,
        city_intel_consent_at: profile.city_intel_consent_at || null,
        casl_push_consent_at: profile.casl_push_consent_at || null,
      },
    };
  }

  async function getSession() {
    if (!client)
      return { session: null, error: new Error("Supabase is not loaded.") };
    const { data, error } = await client.auth.getSession();
    return { session: data?.session || null, error };
  }

  function sessionFreshness(session, graceMinutes = 5) {
    const expiresAt = Number(session?.expires_at || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
      return {
        expiresAt: null,
        expiresInMs: null,
        expiresSoon: true,
      };
    }
    const expiresInMs = expiresAt * 1000 - Date.now();
    return {
      expiresAt,
      expiresInMs,
      expiresSoon: expiresInMs <= graceMinutes * 60 * 1000,
    };
  }

  async function getAuthState(options = {}) {
    let { session, error } = await getSession();
    let freshness = sessionFreshness(session, options.graceMinutes || 5);
    let refreshAttempted = false;

    // Renew a near-expiry session before interrupting a detail view with auth.
    if (session?.user && options.requireFresh && freshness.expiresSoon && client) {
      refreshAttempted = true;
      const refreshed = await client.auth.refreshSession();
      session = refreshed.data?.session || session;
      error = refreshed.error || error;
      freshness = sessionFreshness(session, options.graceMinutes || 5);
    }

    const signedIn = Boolean(session?.user);
    const needsLogin = !signedIn || Boolean(error);
    const needsReauth = Boolean(options.requireFresh && freshness.expiresSoon);
    return {
      ok: signedIn && !needsReauth && !error,
      signedIn,
      needsLogin,
      needsReauth,
      session,
      user: session?.user || null,
      error: error || null,
      refreshAttempted,
      ...freshness,
    };
  }

  async function loadOnboardingProfile() {
    const { session, error: sessionError } = await getSession();
    if (sessionError || !session?.user) {
      return {
        ok: false,
        reason: "no_session",
        session: null,
        user: null,
        profile: null,
        preferences: null,
        error: sessionError || null,
      };
    }

    const { data, error } = await client
      .from(PROFILE_TABLE)
      .select("*")
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error) {
      return {
        ok: false,
        reason: "profile_error",
        session,
        user: session.user,
        profile: null,
        preferences: null,
        error,
      };
    }

    const preferences = profileToPreferences(data, session.user);
    if (preferences) writeLocalPreferences(preferences);

    return {
      ok: Boolean(data?.completed_at),
      reason: data?.completed_at ? "ready" : "missing_profile",
      session,
      user: session.user,
      profile: data || null,
      preferences,
      error: null,
    };
  }

  async function lookupEmailByUsername(username) {
    const value = clean(username).toLowerCase();
    if (!value) return null;
    const { data, error } = await client.rpc("lookup_email_by_username", {
      p_username: value,
    });
    if (error) throw error;
    return clean(data) || null;
  }

  async function requireOnboarding(options = {}) {
    const state = await loadOnboardingProfile();
    if (!state.ok && options.redirect !== false) {
      redirectToAuth(
        options.next || currentRelativeUrl(),
        options.mode || "signup",
        {
          intent: options.intent || "onboarding",
          reason: options.reason || "onboarding_required",
          caption: options.caption || "",
        },
      );
    }
    return state;
  }

  async function requireAuthenticatedAction(options = {}) {
    const state = await requireOnboarding({
      ...options,
      redirect: false,
    });
    if (state.ok) return state;

    if (options.redirect !== false) {
      redirectToAuth(
        options.next || currentRelativeUrl(),
        options.mode || "signup",
        {
          intent: options.intent || "member_action",
          reason: options.reason || "member_action_required",
          caption:
            options.caption ||
            "Create an account to save this moment and keep your plan personal.",
        },
      );
    }
    return state;
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut({ scope: "local" });
    sessionStorageAdapter.removeItem(AUTH_STORAGE_KEY);
  }

  // Upload a profile photo to the owner-only folder profile-photos/<userId>/avatar.<ext>
  // and return the public URL. upsert:true replaces any previous photo.
  const PHOTO_EXT_BY_TYPE = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
  };

  async function uploadProfilePhoto(file, userId) {
    if (!client) throw new Error("Supabase is not loaded.");
    if (!file || !userId) throw new Error("File and user id are required.");
    const ext = PHOTO_EXT_BY_TYPE[file.type] || "jpg";
    const path = `${userId}/avatar.${ext}`;
    const { error: upError } = await client.storage
      .from("profile-photos")
      .upload(path, file, { upsert: true, contentType: file.type || `image/${ext}` });
    if (upError) throw upError;
    const { data } = client.storage.from("profile-photos").getPublicUrl(path);
    // Cache-bust so the freshly-uploaded image replaces any cached version.
    return data?.publicUrl ? `${data.publicUrl}?t=${Date.now()}` : null;
  }

  async function saveOnboardingProfile(profile) {
    const { session, error } = await getSession();
    if (error || !session?.user) {
      throw error || new Error("Create or sign in to an Echoo account first.");
    }
    const payload = dbPayloadFromPreferences(profile, session.user);
    const { data, error: upsertError } = await client
      .from(PROFILE_TABLE)
      .upsert(payload, { onConflict: "user_id" })
      .select("*")
      .single();
    if (upsertError) throw upsertError;
    const preferences = profileToPreferences(data, session.user);
    if (preferences) writeLocalPreferences(preferences);
    return { profile: data, preferences };
  }

  async function updateOnboardingPatch(patch) {
    const { session, error } = await getSession();
    if (error || !session?.user) return null;
    const update = {};
    if (patch.budget) update.budget = safeBudget(patch.budget);
    if (patch.energy) update.energy = safeEnergy(patch.energy);
    if (patch.tone) update.tone = safeTone(patch.tone);
    if (patch.city) update.home_city = clean(patch.city, "Greater Toronto Area");
    if (!Object.keys(update).length) return null;
    const { error: updateError } = await client
      .from(PROFILE_TABLE)
      .update(update)
      .eq("user_id", session.user.id);
    if (updateError) throw updateError;
    writeLocalPreferences({
      budget: update.budget || patch.budget,
      energy: update.energy || patch.energy,
      tone: update.tone || patch.tone,
      city: update.home_city || patch.city,
    });
    return update;
  }

  async function authHeaders(extra = {}) {
    const { session } = await getSession();
    return {
      ...extra,
      Authorization: `Bearer ${session?.access_token || CONFIG.supabaseAnonKey}`,
      apikey: CONFIG.supabaseAnonKey,
    };
  }

  /**
   * Retry profile sync if onboarding saved preferences only to localStorage.
   * Call this on pages that load after auth (e.g. app.html).
   */
  async function syncPendingProfile() {
    if (localStorage.getItem("echoo_profile_pending_sync") !== "true") return;
    try {
      const prefs = readLocalPreferences();
      if (!prefs || !Object.keys(prefs).length) {
        localStorage.removeItem("echoo_profile_pending_sync");
        return;
      }
      await saveOnboardingProfile({ ...prefs, source: "web_onboarding_retry" });
      localStorage.removeItem("echoo_profile_pending_sync");
      console.log("Echoo: pending profile synced to database.");
    } catch (e) {
      console.warn("Echoo: pending profile sync failed, will retry later.", e);
    }
  }

  window.EchooAuth = {
    CONFIG,
    PROFILE_TABLE,
    client,
    authHeaders,
    currentRelativeUrl,
    getAuthState,
    isValidUsername,
    loadOnboardingProfile,
    lookupEmailByUsername,
    normalizeNext,
    readLocalPreferences,
    redirectToAuth,
    requireOnboarding,
    requireAuthenticatedAction,
    saveOnboardingProfile,
    signOut,
    uploadProfilePhoto,
    syncPendingProfile,
    updateOnboardingPatch,
    normalizeUsername,
    writeLocalPreferences,
  };
})();
