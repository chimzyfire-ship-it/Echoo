(function () {
  "use strict";

  const STORAGE_KEY = "echoo_culture_lens_v1";
  const BROWSE_GROUPS = [
    ["middle_east", "Middle East"],
    ["east_africa", "East Africa"],
    ["west_africa", "West Africa"],
    ["east_asia", "East Asia"],
    ["south_asia", "South Asia"],
    ["southeast_asia", "Southeast Asia"],
    ["caribbean_latin", "Caribbean & Latin"],
    ["europe", "Europe"],
  ].map(([slug, label]) => ({ slug, label }));

  // Regions are for browsing only. A person always selects a specific cultural view,
  // and can search the full catalogue rather than being limited to these eight regions.
  const CULTURES = [
    ["arab", "Arab", "middle_east", ["Arabic", "Arabian"]],
    ["armenian", "Armenian", "middle_east", ["Armenia"]],
    ["assyrian", "Assyrian", "middle_east", ["Assyria"]],
    ["iranian", "Iranian", "middle_east", ["Iran"]],
    ["iraqi", "Iraqi", "middle_east", ["Iraq"]],
    ["israeli", "Israeli", "middle_east", ["Israel", "Hebrew"]],
    ["jordanian", "Jordanian", "middle_east", ["Jordan"]],
    ["kurdish", "Kurdish", "middle_east", ["Kurd", "Kurdistan"]],
    ["lebanese", "Lebanese", "middle_east", ["Lebanon"]],
    ["palestinian", "Palestinian", "middle_east", ["Palestine"]],
    ["persian", "Persian", "middle_east", ["Farsi", "Persia"]],
    ["syrian", "Syrian", "middle_east", ["Syria"]],
    ["turkish", "Turkish", "middle_east", ["Turkey", "Türkiye"]],
    ["yemeni", "Yemeni", "middle_east", ["Yemen"]],

    ["ethiopian", "Ethiopian", "east_africa", ["Ethiopia", "Amharic"]],
    ["eritrean", "Eritrean", "east_africa", ["Eritrea", "Tigrinya"]],
    ["kenyan", "Kenyan", "east_africa", ["Kenya"]],
    ["somali", "Somali", "east_africa", ["Somalia"]],
    ["sudanese", "Sudanese", "east_africa", ["Sudan"]],
    ["tanzanian", "Tanzanian", "east_africa", ["Tanzania", "Swahili"]],
    ["ugandan", "Ugandan", "east_africa", ["Uganda"]],
    ["rwandan", "Rwandan", "east_africa", ["Rwanda"]],
    ["burundian", "Burundian", "east_africa", ["Burundi"]],

    ["akan", "Akan", "west_africa", ["Ghana", "Twi"]],
    ["ghanaian", "Ghanaian", "west_africa", ["Ghana"]],
    ["gambian", "Gambian", "west_africa", ["Gambia"]],
    ["igbo", "Igbo", "west_africa", ["Igbo Nigerian"]],
    ["ivorian", "Ivorian", "west_africa", ["Côte d’Ivoire", "Ivory Coast"]],
    ["liberian", "Liberian", "west_africa", ["Liberia"]],
    ["malian", "Malian", "west_africa", ["Mali"]],
    ["nigerian", "Nigerian", "west_africa", ["Nigeria"]],
    ["senegalese", "Senegalese", "west_africa", ["Senegal", "Wolof"]],
    ["sierra_leonean", "Sierra Leonean", "west_africa", ["Sierra Leone"]],
    ["yoruba", "Yoruba", "west_africa", ["Yoruba Nigerian"]],

    ["chinese", "Chinese", "east_asia", ["China", "Chinese Canadian", "Cantonese", "Mandarin"]],
    ["hong_kong", "Hong Kong", "east_asia", ["Hong Konger", "Cantonese"]],
    ["japanese", "Japanese", "east_asia", ["Japan"]],
    ["korean", "Korean", "east_asia", ["Korea"]],
    ["mongolian", "Mongolian", "east_asia", ["Mongolia"]],
    ["taiwanese", "Taiwanese", "east_asia", ["Taiwan"]],
    ["tibetan", "Tibetan", "east_asia", ["Tibet"]],

    ["bengali", "Bengali", "south_asia", ["Bangla", "Bengal"]],
    ["bangladeshi", "Bangladeshi", "south_asia", ["Bangladesh"]],
    ["gujarati", "Gujarati", "south_asia", ["Gujarat"]],
    ["indian", "Indian", "south_asia", ["India"]],
    ["malayali", "Malayali", "south_asia", ["Malayalam", "Kerala"]],
    ["nepali", "Nepali", "south_asia", ["Nepal"]],
    ["pakistani", "Pakistani", "south_asia", ["Pakistan"]],
    ["punjabi", "Punjabi", "south_asia", ["Punjab"]],
    ["sri_lankan", "Sri Lankan", "south_asia", ["Sri Lanka", "Sinhalese"]],
    ["tamil", "Tamil", "south_asia", ["Tamil speaking"]],
    ["telugu", "Telugu", "south_asia", ["Telangana", "Andhra"]],

    ["cambodian", "Cambodian", "southeast_asia", ["Cambodia", "Khmer"]],
    ["filipino", "Filipino", "southeast_asia", ["Philippine", "Tagalog"]],
    ["indonesian", "Indonesian", "southeast_asia", ["Indonesia"]],
    ["lao", "Lao", "southeast_asia", ["Laotian", "Laos"]],
    ["malaysian", "Malaysian", "southeast_asia", ["Malaysia"]],
    ["myanmar", "Burmese", "southeast_asia", ["Myanmar", "Burma"]],
    ["singaporean", "Singaporean", "southeast_asia", ["Singapore"]],
    ["thai", "Thai", "southeast_asia", ["Thailand"]],
    ["vietnamese", "Vietnamese", "southeast_asia", ["Vietnam"]],

    ["argentinian", "Argentinian", "caribbean_latin", ["Argentina"]],
    ["brazilian", "Brazilian", "caribbean_latin", ["Brazil"]],
    ["caribbean", "Caribbean", "caribbean_latin", ["West Indian"]],
    ["chilean", "Chilean", "caribbean_latin", ["Chile"]],
    ["colombian", "Colombian", "caribbean_latin", ["Colombia"]],
    ["cuban", "Cuban", "caribbean_latin", ["Cuba"]],
    ["dominican", "Dominican", "caribbean_latin", ["Dominican Republic"]],
    ["haitian", "Haitian", "caribbean_latin", ["Haiti", "Haitian Creole"]],
    ["jamaican", "Jamaican", "caribbean_latin", ["Jamaica"]],
    ["latin_american", "Latin American", "caribbean_latin", ["Latino", "Latina", "Latinx"]],
    ["mexican", "Mexican", "caribbean_latin", ["Mexico"]],
    ["peruvian", "Peruvian", "caribbean_latin", ["Peru"]],
    ["puerto_rican", "Puerto Rican", "caribbean_latin", ["Puerto Rico"]],
    ["salvadoran", "Salvadoran", "caribbean_latin", ["El Salvador"]],
    ["trinidadian", "Trinidadian", "caribbean_latin", ["Trinidad and Tobago", "Trini"]],
    ["venezuelan", "Venezuelan", "caribbean_latin", ["Venezuela"]],

    ["albanian", "Albanian", "europe", ["Albania"]],
    ["balkan", "Balkan", "europe", ["Balkans"]],
    ["croatian", "Croatian", "europe", ["Croatia"]],
    ["french", "French-speaking", "europe", ["Francophone", "French"]],
    ["german", "German", "europe", ["Germany"]],
    ["greek", "Greek", "europe", ["Greece"]],
    ["italian", "Italian", "europe", ["Italy"]],
    ["polish", "Polish", "europe", ["Poland"]],
    ["portuguese", "Portuguese", "europe", ["Portugal"]],
    ["romanian", "Romanian", "europe", ["Romania"]],
    ["serbian", "Serbian", "europe", ["Serbia"]],
    ["spanish_speaking", "Spanish-speaking", "europe", ["Spanish"]],
    ["ukrainian", "Ukrainian", "europe", ["Ukraine"]],

    ["algerian", "Algerian", "north_africa", ["Algeria"]],
    ["egyptian", "Egyptian", "north_africa", ["Egypt"]],
    ["moroccan", "Moroccan", "north_africa", ["Morocco", "Amazigh"]],
    ["tunisian", "Tunisian", "north_africa", ["Tunisia"]],
    ["afghan", "Afghan", "central_asia", ["Afghanistan", "Dari", "Pashto"]],
    ["kazakh", "Kazakh", "central_asia", ["Kazakhstan"]],
    ["uzbek", "Uzbek", "central_asia", ["Uzbekistan"]],
    ["jewish", "Jewish", "diaspora", ["Jewish culture"]],
    ["first_nations", "First Nations", "indigenous", ["Indigenous Canadian"]],
    ["inuit", "Inuit", "indigenous", ["Inuktitut"]],
    ["metis", "Métis", "indigenous", ["Metis"]],
    ["samoan", "Samoan", "pacific", ["Samoa"]],
    ["polynesian", "Polynesian", "pacific", ["Polynesia"]],
  ].map(([slug, label, group, aliases]) => ({ slug, label, group, aliases }));

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
        version: 3,
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
    const topics = {
      trending: "restaurants food music events markets community spots",
      events: "events festivals performances community gatherings",
      "upcoming drop": "upcoming events pop-ups festivals performances",
      food: "restaurants bakeries cafes markets tastings",
      music: "live music concerts DJs record stores performances",
      nightlife: "nightlife bars lounges late music events",
      tourism: "museums galleries landmarks tours cultural attractions",
      nature: "parks walks outdoor community activities",
    };
    const topic = topics[base] || base;
    if (!culture) return base === "trending" ? "popular places things to do" : topic;
    return `${culture.label} ${topic}`;
  }

  window.EchooCultureContext = {
    catalogue: CULTURES,
    browseGroups: BROWSE_GROUPS,
    getActive: active,
    setActive,
    clear(options = {}) { return setActive("", options); },
    queryFor,
  };
})();
