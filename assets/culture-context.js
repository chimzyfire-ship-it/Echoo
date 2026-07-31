(function () {
  "use strict";

  const STORAGE_KEY = "echoo_culture_lens_v1";
  const CULTURES = [
    ["arab", "Arab", ["Arabic"]], ["armenian", "Armenian", ["Armenia"]],
    ["bengali", "Bengali", ["Bangla"]], ["brazilian", "Brazilian", ["Brazil"]],
    ["caribbean", "Caribbean", ["West Indian"]], ["chinese", "Chinese", ["China", "Chinese Canadian"]],
    ["ethiopian", "Ethiopian", ["Ethiopia", "Amharic"]], ["filipino", "Filipino", ["Philippine", "Tagalog"]],
    ["french", "French-speaking", ["Francophone"]], ["greek", "Greek", ["Greece"]],
    ["gujarati", "Gujarati", ["Gujarat"]], ["haitian", "Haitian", ["Haiti"]],
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
  ].map(([slug, label, aliases]) => ({ slug, label, aliases }));

  function clean(value) {
    return String(value || "").trim();
  }

  function readRaw() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return value && typeof value === "object" ? value : {};
    } catch (_error) {
      return {};
    }
  }

  function cultureFor(slug) {
    return CULTURES.find((culture) => culture.slug === clean(slug)) || null;
  }

  function active() {
    const stored = readRaw();
    return cultureFor(stored.active || stored.current || stored.selected?.[0]);
  }

  function updateProfile(culture) {
    try {
      const preferences = JSON.parse(localStorage.getItem("echoo_preferences") || "{}");
      const next = {
        ...preferences,
        cultureLens: culture ? culture.label : "",
        cultureLensSlug: culture ? culture.slug : "",
        personalizationProfile: {
          ...(preferences.personalizationProfile || {}),
          cultureLens: culture ? culture.label : "",
          cultureLensSlug: culture ? culture.slug : "",
        },
      };
      localStorage.setItem("echoo_preferences", JSON.stringify(next));
    } catch (_error) {
      // Discover still works if a browser has restricted local storage.
    }
  }

  function setActive(slug, options = {}) {
    const culture = cultureFor(slug);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        active: culture?.slug || "",
        selected: culture ? [culture.slug] : [],
        current: culture?.slug || "",
        updatedAt: new Date().toISOString(),
      }));
    } catch (_error) {}
    updateProfile(culture);
    if (!options.silent) {
      window.dispatchEvent(new CustomEvent("echoo:culture-changed", { detail: { culture } }));
    }
    return culture;
  }

  function queryFor(query, culture = active()) {
    const base = clean(query).toLowerCase() || "trending";
    if (!culture) return base === "trending" ? "top attractions" : base;
    const suffix = {
      trending: "restaurants cultural events music markets local businesses",
      food: "food restaurants bakeries cafes markets",
      music: "music live music record stores cultural events",
      nightlife: "nightlife live music bars cultural events",
      tourism: "museums galleries landmarks cultural attractions",
      nature: "parks walks community activities",
    }[base] || base;
    return `${culture.label} ${suffix}`;
  }

  window.EchooCultureContext = {
    catalogue: CULTURES,
    getActive: active,
    setActive,
    clear(options = {}) { return setActive("", options); },
    queryFor,
  };
})();
