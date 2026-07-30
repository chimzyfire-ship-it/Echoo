(function () {
  "use strict";

  const CONFIG = {
    endpoint: "https://dlezregdjpdqmooubwvl.supabase.co/functions/v1/culture-lens",
    storageKey: "echoo_culture_lens_v1",
    maxLenses: 4,
  };

  // This is only a graceful display fallback when the catalogue migration has
  // not reached an environment yet. The service catalogue remains canonical.
  const FALLBACK_CATALOG = [
    ["arab", "Arab", ["Arabic"]], ["armenian", "Armenian", ["Armenia"]],
    ["bengali", "Bengali", ["Bangla"]], ["brazilian", "Brazilian", ["Brazil"]],
    ["caribbean", "Caribbean", ["West Indian"]], ["chinese", "Chinese", ["China", "Chinese Canadian"]],
    ["ethiopian", "Ethiopian", ["Ethiopia", "Amharic"]], ["filipino", "Filipino", ["Philippine", "Tagalog"]],
    ["french", "French-speaking", ["Francophone", "French Canadian"]], ["greek", "Greek", ["Greece"]],
    ["gujarati", "Gujarati", ["Gujarat"]], ["haitian", "Haitian", ["Haiti", "Haitian Creole"]],
    ["igbo", "Igbo", ["Igbo Nigerian"]], ["iranian", "Iranian", ["Persian", "Iran"]],
    ["italian", "Italian", ["Italy"]], ["jamaican", "Jamaican", ["Jamaica"]],
    ["japanese", "Japanese", ["Japan"]], ["jewish", "Jewish", ["Jewish culture"]],
    ["korean", "Korean", ["Korea"]], ["latin_american", "Latin American", ["Latino", "Latina", "Latinx"]],
    ["lebanese", "Lebanese", ["Lebanon"]], ["mexican", "Mexican", ["Mexico"]],
    ["nigerian", "Nigerian", ["Nigeria"]], ["pakistani", "Pakistani", ["Pakistan"]],
    ["persian", "Persian", ["Farsi"]], ["polish", "Polish", ["Poland"]],
    ["punjabi", "Punjabi", ["Punjab"]], ["somali", "Somali", ["Somalia"]],
    ["south_asian", "South Asian", ["Desi"]], ["spanish_speaking", "Spanish-speaking", ["Spanish"]],
    ["tamil", "Tamil", ["Tamil speaking"]], ["turkish", "Turkish", ["Turkey", "Türkiye"]],
    ["ukrainian", "Ukrainian", ["Ukraine"]], ["vietnamese", "Vietnamese", ["Vietnam"]],
    ["west_african", "West African", ["West Africa"]], ["yoruba", "Yoruba", ["Yoruba Nigerian"]],
  ].map(([slug, label, aliases], index) => ({ id: null, slug, label, aliases, search_terms: [label, ...aliases], sort_order: index }));

  const TOPIC_COPY = {
    food: { title: "A taste of {culture}", note: "Places to linger over" },
    music: { title: "Sound from {culture}", note: "Listen, move, discover" },
    events: { title: "Gather around {culture}", note: "What is coming up" },
    businesses: { title: "Keep it local", note: "Independent places to know" },
  };

  const ui = {
    city: document.getElementById("city-label"),
    lensTitle: document.getElementById("active-lens-title"),
    stageKicker: document.getElementById("stage-kicker"),
    summary: document.getElementById("lens-summary"),
    primaryAction: document.getElementById("lens-primary-action"),
    primaryLabel: document.getElementById("lens-primary-label"),
    switcherWrap: document.getElementById("lens-switcher-wrap"),
    switcher: document.getElementById("lens-switcher"),
    topicBar: document.getElementById("topic-bar"),
    feed: document.getElementById("culture-feed"),
    sheet: document.getElementById("lens-sheet"),
    grid: document.getElementById("culture-grid"),
    search: document.getElementById("culture-search"),
    suggestion: document.getElementById("profile-suggestion"),
    relationship: document.getElementById("relationship-options"),
    selectionCount: document.getElementById("selection-count"),
    save: document.getElementById("save-lenses"),
    toast: document.getElementById("culture-toast"),
  };

  const state = {
    catalogue: [...FALLBACK_CATALOG],
    profile: {},
    selected: [],
    current: "",
    topics: "all",
    relationships: {},
    draftSelected: [],
    draftRelationship: "interested",
    hiddenItems: new Set(),
    savedItems: new Set(),
    renderedItems: new Map(),
    suggestions: new Set(),
    request: 0,
    authenticated: false,
    userId: "",
  };

  function clean(value, fallback = "") {
    return String(value || fallback).replace(/\s+/g, " ").trim();
  }

  function escapeHtml(value) {
    return clean(value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function selectorEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function readStored() {
    try {
      const stored = JSON.parse(localStorage.getItem(CONFIG.storageKey) || "{}");
      return stored && typeof stored === "object" ? stored : {};
    } catch (_error) {
      return {};
    }
  }

  function store() {
    try {
      localStorage.setItem(CONFIG.storageKey, JSON.stringify({
        selected: state.selected,
        current: state.current,
        relationships: state.relationships,
        hiddenItems: [...state.hiddenItems].slice(-200),
        savedItems: [...state.savedItems].slice(-200),
        updatedAt: new Date().toISOString(),
      }));
    } catch (_error) {
      // Local persistence is a convenience for guests, never required for use.
    }
  }

  function catalogBySlug(slug) {
    return state.catalogue.find((item) => item.slug === slug) || null;
  }

  function currentCulture() {
    return catalogBySlug(state.current) || catalogBySlug(state.selected[0]) || null;
  }

  function selectedCatalogues() {
    return state.selected.map(catalogBySlug).filter(Boolean);
  }

  function normal(value) {
    return clean(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  function profileSuggestions() {
    const values = Array.isArray(state.profile.nationalities) ? state.profile.nationalities : [];
    const raw = values.map(normal).filter(Boolean);
    return state.catalogue.filter((culture) => {
      const terms = [culture.label, ...(culture.aliases || []), ...(culture.search_terms || [])].map(normal);
      return raw.some((profileValue) => terms.some((term) => term && (profileValue.includes(term) || term.includes(profileValue))));
    }).map((culture) => culture.slug);
  }

  function cityFromProfile() {
    return clean(state.profile.city, "Greater Toronto Area");
  }

  function localCoordinates() {
    const lat = Number(state.profile.lastLat);
    const lng = Number(state.profile.lastLng);
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : {};
  }

  let toastTimer;
  function toast(message) {
    if (!ui.toast) return;
    ui.toast.textContent = message;
    ui.toast.classList.add("visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => ui.toast.classList.remove("visible"), 2600);
  }

  async function loadCatalogue() {
    const client = window.EchooAuth?.client;
    if (!client) return;
    try {
      const { data, error } = await client
        .from("culture_catalog")
        .select("id,slug,label,aliases,search_terms,sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });
      if (error || !Array.isArray(data) || !data.length) return;
      state.catalogue = data.map((row) => ({
        id: row.id,
        slug: clean(row.slug),
        label: clean(row.label),
        aliases: Array.isArray(row.aliases) ? row.aliases : [],
        search_terms: Array.isArray(row.search_terms) ? row.search_terms : [],
        sort_order: Number(row.sort_order || 100),
      }));
    } catch (_error) {
      // The fallback catalogue keeps lens setup usable during a partial deploy.
    }
  }

  async function loadAccount() {
    try {
      const auth = await window.EchooAuth?.getAuthState?.();
      state.authenticated = Boolean(auth?.session?.user);
      state.userId = clean(auth?.session?.user?.id);
      const loaded = await window.EchooAuth?.loadOnboardingProfile?.();
      if (loaded?.preferences) state.profile = loaded.preferences;
    } catch (_error) {
      state.authenticated = false;
    }
    if (!Object.keys(state.profile).length) {
      state.profile = window.EchooAuth?.readLocalPreferences?.() || {};
    }
  }

  async function loadRemoteLenses() {
    if (!state.authenticated || !state.userId || !window.EchooAuth?.client) return [];
    try {
      const { data, error } = await window.EchooAuth.client
        .from("user_culture_lenses")
        .select("culture_id,is_enabled,relationship")
        .eq("user_id", state.userId)
        .eq("is_enabled", true);
      if (error || !Array.isArray(data)) return [];
      const source = new Map(state.catalogue.filter((culture) => culture.id).map((culture) => [culture.id, culture.slug]));
      data.forEach((row) => {
        const slug = source.get(row.culture_id);
        if (slug) state.relationships[slug] = clean(row.relationship, "interested");
      });
      return data.map((row) => source.get(row.culture_id)).filter(Boolean);
    } catch (_error) {
      return [];
    }
  }

  async function syncRemoteLenses() {
    if (!state.authenticated || !state.userId || !window.EchooAuth?.client) return;
    const client = window.EchooAuth.client;
    const rows = selectedCatalogues().filter((culture) => culture.id);
    if (!rows.length) return;
    try {
      const { data: existing, error: readError } = await client
        .from("user_culture_lenses")
        .select("culture_id")
        .eq("user_id", state.userId);
      if (readError) throw readError;
      const desiredIds = new Set(rows.map((culture) => culture.id));
      const stale = (existing || []).map((row) => row.culture_id).filter((id) => !desiredIds.has(id));
      if (stale.length) {
        const { error } = await client
          .from("user_culture_lenses")
          .update({ is_enabled: false })
          .eq("user_id", state.userId)
          .in("culture_id", stale);
        if (error) throw error;
      }
      const { error: upsertError } = await client
        .from("user_culture_lenses")
        .upsert(rows.map((culture) => ({
          user_id: state.userId,
          culture_id: culture.id,
          relationship: state.relationships[culture.slug] || "interested",
          focus_topics: [],
          is_enabled: true,
          consented_at: new Date().toISOString(),
          selection_source: "user_selected",
        })), { onConflict: "user_id,culture_id" });
      if (upsertError) throw upsertError;
    } catch (error) {
      console.warn("Culture Lens preference sync failed", error);
      toast("Saved here — we’ll sync this to your account shortly.");
    }
  }

  function renderStage() {
    const culture = currentCulture();
    ui.city.textContent = cityFromProfile();
    if (!culture) {
      ui.stageKicker.textContent = "YOUR CULTURAL MAP";
      ui.lensTitle.textContent = "Set the lens.";
      ui.summary.textContent = "Choose the cultures you want Echoo to bring closer.";
      ui.primaryLabel.textContent = "Choose a culture";
      ui.switcherWrap.hidden = true;
      ui.topicBar.hidden = true;
      return;
    }
    ui.stageKicker.textContent = "NOW EXPLORING";
    ui.lensTitle.textContent = culture.label;
    ui.summary.textContent = `${culture.label} finds, with a local point of view.`;
    ui.primaryLabel.textContent = "Edit lenses";
    ui.switcherWrap.hidden = false;
    ui.topicBar.hidden = false;
    ui.switcher.innerHTML = [
      ...selectedCatalogues().map((item) => `<button class="lens-pill${item.slug === culture.slug ? " active" : ""}" type="button" data-lens="${escapeAttribute(item.slug)}" aria-pressed="${item.slug === culture.slug}">${escapeHtml(item.label)}</button>`),
      `<button class="lens-pill add" type="button" data-open-manager>+ Add</button>`,
    ].join("");
  }

  function loadingMarkup() {
    return `<div class="loading-stack" aria-label="Finding local culture picks"><section class="loading-section"><span class="loading-line"></span><div class="loading-row"><span class="loading-card"></span><span class="loading-card"></span></div></section><section class="loading-section"><span class="loading-line"></span><div class="loading-row"><span class="loading-card"></span><span class="loading-card"></span></div></section></div>`;
  }

  function cardMarkup(item, key) {
    const hasImage = /^https?:\/\//i.test(item.imageUrl || "");
    const saved = state.savedItems.has(key);
    const provider = item.attribution ? `<span class="card-provider">${escapeHtml(item.attribution)}</span>` : "";
    const visual = hasImage
      ? `<img class="card-image" src="${escapeAttribute(item.imageUrl)}" alt="${escapeAttribute(item.imageAlt || item.title)}" loading="lazy" decoding="async" />`
      : `<span class="card-surface" aria-hidden="true"></span>`;
    const kicker = item.startsAt
      ? new Date(item.startsAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : item.category || "Local find";
    const meta = item.venueName || item.description || item.city;
    return `<article class="culture-card${hasImage ? " with-image" : ""}" data-open-card="${key}" tabindex="0" role="link" aria-label="Open ${escapeAttribute(item.title)}">
      ${visual}${provider}
      <button class="card-save${saved ? " saved" : ""}" type="button" data-save-card="${key}" aria-label="${saved ? "Saved" : "Save"} ${escapeAttribute(item.title)}" aria-pressed="${saved}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 20-1.35-1.23C5.85 14.42 3 11.83 3 8.65 3 6.06 5.03 4 7.6 4c1.45 0 2.84.68 3.74 1.75C12.23 4.68 13.63 4 15.08 4 17.64 4 19.68 6.06 19.68 8.65c0 3.18-2.85 5.77-7.65 10.13Z" /></svg>
      </button>
      <div class="card-content"><span class="card-kicker">${escapeHtml(kicker)}</span><h3 class="card-title">${escapeHtml(item.title)}</h3><p class="card-meta">${escapeHtml(meta)}</p></div>
    </article>`;
  }

  function sectionMarkup(section, culture) {
    const copy = TOPIC_COPY[section.topic] || TOPIC_COPY.businesses;
    const title = copy.title.replace("{culture}", culture.label);
    const rows = section.items.filter((item) => !state.hiddenItems.has(`${item.source}:${item.id}`));
    if (!rows.length) return "";
    return `<section class="feed-section" aria-label="${escapeAttribute(title)}"><div class="section-heading"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(copy.note)}</p></div><div class="discovery-row">${rows.map((item) => {
      const key = `${item.source}:${item.id}`;
      state.renderedItems.set(key, item);
      return cardMarkup(item, key);
    }).join("")}</div></section>`;
  }

  function renderFeed(payload) {
    const culture = currentCulture();
    if (!culture) return;
    state.renderedItems.clear();
    const sections = Array.isArray(payload?.sections) ? payload.sections : [];
    const filtered = state.topics === "all" ? sections : sections.filter((section) => section.topic === state.topics);
    const markup = filtered.map((section) => sectionMarkup(section, culture)).filter(Boolean).join("");
    if (!markup) {
      const label = state.topics === "all" ? "this lens" : `the ${state.topics} side of ${culture.label}`;
      ui.feed.innerHTML = `<section class="feed-empty"><strong>We’re still building ${escapeHtml(label)} locally.</strong>Try another discovery angle, switch lenses, or come back as more verified places and live listings arrive.</section>`;
      return;
    }
    ui.feed.innerHTML = markup;
  }

  async function loadFeed() {
    const culture = currentCulture();
    if (!culture) return;
    const request = ++state.request;
    ui.feed.innerHTML = loadingMarkup();
    try {
      const headers = await window.EchooAuth?.authHeaders?.({ "Content-Type": "application/json" }) || { "Content-Type": "application/json" };
      const response = await fetch(CONFIG.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          cultureSlug: culture.slug,
          city: cityFromProfile(),
          ...localCoordinates(),
          topics: state.topics === "all" ? [] : [state.topics],
        }),
      });
      if (!response.ok) throw new Error(`Culture Lens request failed: ${response.status}`);
      const payload = await response.json();
      if (request !== state.request) return;
      renderFeed(payload);
    } catch (error) {
      if (request !== state.request) return;
      console.warn("Culture Lens feed unavailable", error);
      ui.feed.innerHTML = `<section class="feed-empty"><strong>We couldn’t refresh this lens right now.</strong>Your saved lenses are intact. Please try again in a moment.</section>`;
    }
  }

  function renderManager() {
    const search = normal(ui.search.value);
    const selected = new Set(state.draftSelected);
    const items = state.catalogue.filter((culture) => {
      if (!search) return true;
      return [culture.label, ...(culture.aliases || []), ...(culture.search_terms || [])].some((value) => normal(value).includes(search));
    });
    ui.grid.innerHTML = items.length ? items.map((culture) => {
      const isSelected = selected.has(culture.slug);
      const isSuggested = state.suggestions.has(culture.slug);
      return `<button class="culture-choice${isSelected ? " selected" : ""}${isSuggested && !isSelected ? " suggested" : ""}" type="button" role="listitem" data-culture-choice="${escapeAttribute(culture.slug)}" aria-pressed="${isSelected}"><span>${escapeHtml(culture.label)}</span><span class="culture-choice-check" aria-hidden="true">${isSelected ? "✓" : ""}</span></button>`;
    }).join("") : `<p class="empty-search">No lens matches that search yet.</p>`;
    ui.selectionCount.textContent = `${state.draftSelected.length} of ${CONFIG.maxLenses} selected`;
    ui.save.disabled = state.draftSelected.length === 0;
    const hasSuggestions = state.suggestions.size > 0;
    ui.suggestion.hidden = !hasSuggestions;
    [...ui.relationship.querySelectorAll("[data-relationship]")].forEach((button) => {
      button.classList.toggle("active", button.dataset.relationship === state.draftRelationship);
      button.setAttribute("aria-pressed", String(button.dataset.relationship === state.draftRelationship));
    });
  }

  function openManager() {
    state.draftSelected = [...state.selected];
    state.draftRelationship = state.relationships[state.current] || "interested";
    ui.search.value = "";
    renderManager();
    ui.sheet.classList.add("is-open");
    ui.sheet.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    setTimeout(() => ui.search.focus({ preventScroll: true }), 250);
  }

  function closeManager() {
    ui.sheet.classList.remove("is-open");
    ui.sheet.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  async function saveLenses() {
    if (!state.draftSelected.length) return;
    state.selected = [...state.draftSelected];
    if (!state.selected.includes(state.current)) state.current = state.selected[0];
    state.selected.forEach((slug) => { state.relationships[slug] = state.draftRelationship; });
    store();
    closeManager();
    renderStage();
    await syncRemoteLenses();
    toast(state.authenticated ? "Your Culture Lens is saved." : "Your lens is saved on this device.");
    loadFeed();
  }

  async function recordFeedback(item, signal) {
    const key = `${item.source}:${item.id}`;
    if (!state.authenticated || !state.userId || !window.EchooAuth?.client) return;
    const culture = currentCulture();
    if (!culture?.id) return;
    try {
      const payload = {
        user_id: state.userId,
        culture_id: culture.id,
        signal,
        ...(item.source === "echoo" && /^[0-9a-f-]{36}$/i.test(item.id)
          ? { location_entity_id: item.id }
          : { external_entity_id: `${item.source}:${item.id}` }),
      };
      const { error } = await window.EchooAuth.client.from("user_culture_lens_feedback").insert(payload);
      if (error) throw error;
    } catch (error) {
      console.warn("Culture Lens feedback sync failed", error);
    }
  }

  async function toggleSaved(key) {
    const item = state.renderedItems.get(key);
    if (!item) return;
    if (state.savedItems.has(key)) {
      state.savedItems.delete(key);
      toast("Removed from your saved finds.");
    } else {
      state.savedItems.add(key);
      toast("Saved to your local finds.");
      recordFeedback(item, "saved");
    }
    store();
    const button = ui.feed.querySelector(`[data-save-card="${selectorEscape(key)}"]`);
    if (button) {
      const saved = state.savedItems.has(key);
      button.classList.toggle("saved", saved);
      button.setAttribute("aria-pressed", String(saved));
      button.setAttribute("aria-label", `${saved ? "Saved" : "Save"} ${item.title}`);
    }
  }

  function openCard(key) {
    const item = state.renderedItems.get(key);
    if (!item) return;
    if (item.actionUrl && /^https?:\/\//i.test(item.actionUrl)) {
      window.location.assign(item.actionUrl);
      return;
    }
    const query = encodeURIComponent(`${item.title} ${cityFromProfile()}`);
    window.location.assign(`events.html?query=${query}`);
  }

  function bind() {
    document.addEventListener("click", (event) => {
      const target = event.target.closest("button, [data-open-card]");
      if (!target) return;
      if (target.matches("[data-open-manager]")) return openManager();
      if (target.matches("[data-close-manager]")) return closeManager();
      if (target.matches("[data-lens]")) {
        state.current = target.dataset.lens;
        state.topics = "all";
        document.querySelectorAll(".topic-chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.topic === "all"));
        store(); renderStage(); loadFeed(); return;
      }
      if (target.matches("[data-topic]")) {
        state.topics = target.dataset.topic || "all";
        document.querySelectorAll(".topic-chip").forEach((chip) => chip.classList.toggle("active", chip === target));
        loadFeed(); return;
      }
      if (target.matches("[data-culture-choice]")) {
        const slug = target.dataset.cultureChoice;
        const selected = state.draftSelected.includes(slug);
        if (selected) state.draftSelected = state.draftSelected.filter((item) => item !== slug);
        else if (state.draftSelected.length < CONFIG.maxLenses) state.draftSelected.push(slug);
        else toast(`Choose up to ${CONFIG.maxLenses} lenses at once.`);
        renderManager(); return;
      }
      if (target.matches("[data-relationship]")) {
        state.draftRelationship = target.dataset.relationship || "interested";
        renderManager(); return;
      }
      if (target.matches("#save-lenses")) return saveLenses();
      if (target.matches("[data-save-card]")) {
        event.stopPropagation();
        return toggleSaved(target.dataset.saveCard);
      }
      if (target.matches("[data-open-card]")) return openCard(target.dataset.openCard);
    });

    ui.search.addEventListener("input", renderManager);
    ui.primaryAction.addEventListener("click", openManager);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && ui.sheet.classList.contains("is-open")) closeManager();
      const card = event.target.closest?.("[data-open-card]");
      if (card && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault(); openCard(card.dataset.openCard);
      }
    });
  }

  async function initialise() {
    const stored = readStored();
    state.selected = Array.isArray(stored.selected) ? stored.selected.filter((item) => typeof item === "string") : [];
    state.current = clean(stored.current);
    state.relationships = stored.relationships && typeof stored.relationships === "object" ? stored.relationships : {};
    state.hiddenItems = new Set(Array.isArray(stored.hiddenItems) ? stored.hiddenItems : []);
    state.savedItems = new Set(Array.isArray(stored.savedItems) ? stored.savedItems : []);

    await Promise.all([loadAccount(), loadCatalogue()]);
    const remote = await loadRemoteLenses();
    if (remote.length) state.selected = remote;
    state.selected = [...new Set(state.selected)].filter((slug) => catalogBySlug(slug)).slice(0, CONFIG.maxLenses);
    if (!state.selected.includes(state.current)) state.current = state.selected[0] || "";
    state.suggestions = new Set(profileSuggestions());
    renderStage();
    if (currentCulture()) loadFeed();
  }

  bind();
  initialise();
})();
