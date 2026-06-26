(function () {
  const CONFIG = {
    supabaseUrl: "https://dlezregdjpdqmooubwvl.supabase.co",
    supabaseAnonKey: "sb_publishable_4FeunYH-ItDm68Sjg93c_w_s8yMizxH",
  };
  const PROFILE_TABLE = "user_onboarding_profiles";
  const VALID_BUDGETS = new Set(["$", "$$", "$$$"]);
  const VALID_ENERGIES = new Set(["chill", "hype", "curious"]);
  const VALID_TONES = new Set(["direct", "detailed"]);

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

  function currentRelativeUrl() {
    const file = window.location.pathname.split("/").pop() || "index.html";
    return `${file}${window.location.search}${window.location.hash}`;
  }

  function normalizeNext(next, fallback = "app.html") {
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

  function redirectToAuth(next = currentRelativeUrl(), mode = "signup") {
    const params = new URLSearchParams({
      next: normalizeNext(next),
      mode,
    });
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
    const city = clean(row.home_city, "Toronto");
    const gender = clean(row.gender, "Prefer not to say");
    const dob = row.date_of_birth || "";
    const tone = safeTone(row.tone);
    const personalizationProfile = {
      interests,
      eventStyles,
      audiences,
      motivations,
      budget,
      energy,
      city,
      gender,
      dob,
      tone,
    };
    return {
      userId: row.user_id || user?.id,
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
      dob,
      tone,
      onboardingCompletedAt: row.completed_at,
      personalizationProfile,
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
    return {
      user_id: user.id,
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
      home_city: clean(profile.city || profile.home_city, "Toronto"),
      gender: clean(profile.gender, "Prefer not to say"),
      date_of_birth: safeDate(profile.dob || profile.date_of_birth),
      tone,
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
      },
      metadata: {
        source: clean(profile.source, "web_onboarding"),
      },
    };
  }

  async function getSession() {
    if (!client)
      return { session: null, error: new Error("Supabase is not loaded.") };
    const { data, error } = await client.auth.getSession();
    return { session: data?.session || null, error };
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

  async function requireOnboarding(options = {}) {
    const state = await loadOnboardingProfile();
    if (!state.ok && options.redirect !== false) {
      redirectToAuth(
        options.next || currentRelativeUrl(),
        options.mode || "signup",
      );
    }
    return state;
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
    if (patch.city) update.home_city = clean(patch.city, "Toronto");
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

  window.EchooAuth = {
    CONFIG,
    PROFILE_TABLE,
    client,
    authHeaders,
    currentRelativeUrl,
    loadOnboardingProfile,
    normalizeNext,
    readLocalPreferences,
    redirectToAuth,
    requireOnboarding,
    saveOnboardingProfile,
    updateOnboardingPatch,
    writeLocalPreferences,
  };
})();
