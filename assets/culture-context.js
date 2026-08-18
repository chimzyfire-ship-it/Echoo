(function () {
  "use strict";

  const STORAGE_KEY = "echoo_culture_lens_v1";
  const STORAGE_VERSION = 4;

  // Culture Lens is category-only. Each entry is a broad cultural view used to
  // shape discovery queries — not a list of individual nationalities.
  const CATEGORIES = [
    {
      slug: "canadian",
      label: "Canadian",
      terms: ["Canadian", "Canada", "Canadiana", "local Canadian"],
      aliases: ["Canada", "Canadiana"],
    },
    {
      slug: "american",
      label: "American",
      terms: ["American", "USA", "United States", "US American"],
      aliases: ["USA", "US", "United States", "America"],
    },
    {
      slug: "indigenous",
      label: "Indigenous",
      terms: ["Indigenous", "First Nations", "Inuit", "Métis", "Native"],
      aliases: ["First Nations", "Inuit", "Métis", "Metis", "Aboriginal"],
    },
    {
      slug: "middle_east",
      label: "Middle East",
      terms: ["Middle Eastern", "Arab", "Levantine", "Persian", "Turkish"],
      aliases: ["Middle Eastern", "Arab", "Levant", "MENA"],
    },
    {
      slug: "north_africa",
      label: "North Africa",
      terms: ["North African", "Maghreb", "Moroccan", "Egyptian", "Amazigh"],
      aliases: ["Maghreb", "North African"],
    },
    {
      slug: "east_africa",
      label: "East Africa",
      terms: ["East African", "Ethiopian", "Somali", "Kenyan", "Swahili"],
      aliases: ["East African", "Horn of Africa"],
    },
    {
      slug: "west_africa",
      label: "West Africa",
      terms: ["West African", "Nigerian", "Ghanaian", "Senegalese", "Afro"],
      aliases: ["West African", "west_african"],
    },
    {
      slug: "east_asia",
      label: "East Asia",
      terms: ["East Asian", "Chinese", "Japanese", "Korean", "Taiwanese"],
      aliases: ["East Asian"],
    },
    {
      slug: "south_asia",
      label: "South Asia",
      terms: ["South Asian", "Indian", "Pakistani", "Bangladeshi", "Desi", "Sri Lankan"],
      aliases: ["South Asian", "Desi", "south_asian"],
    },
    {
      slug: "southeast_asia",
      label: "Southeast Asia",
      terms: ["Southeast Asian", "Filipino", "Vietnamese", "Thai", "Indonesian"],
      aliases: ["Southeast Asian", "SE Asia"],
    },
    {
      slug: "central_asia",
      label: "Central Asia",
      terms: ["Central Asian", "Afghan", "Uzbek", "Kazakh"],
      aliases: ["Central Asian"],
    },
    {
      slug: "caribbean_latin",
      label: "Caribbean & Latin",
      terms: [
        "Caribbean",
        "Latin American",
        "Latino",
        "Jamaican",
        "Mexican",
        "Brazilian",
      ],
      aliases: [
        "Caribbean",
        "Latin",
        "Latino",
        "Latina",
        "Latinx",
        "Latin American",
        "West Indian",
      ],
    },
    {
      slug: "europe",
      label: "Europe",
      terms: ["European", "Italian", "Greek", "French", "Eastern European"],
      aliases: ["European"],
    },
    {
      slug: "pacific",
      label: "Pacific",
      terms: ["Pacific Islander", "Polynesian", "Samoan", "Oceanic"],
      aliases: ["Pacific Islander", "Polynesian", "Oceania"],
    },
    {
      slug: "jewish",
      label: "Jewish",
      terms: ["Jewish", "Jewish culture", "Kosher", "Israeli"],
      aliases: ["Jewish culture", "Judaism"],
    },
  ].map((entry) => ({
    ...entry,
    // Keep a stable shape for older callers that read .group / .catalogue
    group: entry.slug,
  }));

  // Map legacy individual-culture slugs → category slugs so stored lenses
  // keep working after the category-only switch.
  const LEGACY_TO_CATEGORY = {
    arab: "middle_east",
    armenian: "middle_east",
    assyrian: "middle_east",
    iranian: "middle_east",
    iraqi: "middle_east",
    israeli: "middle_east",
    jordanian: "middle_east",
    kurdish: "middle_east",
    lebanese: "middle_east",
    palestinian: "middle_east",
    persian: "middle_east",
    syrian: "middle_east",
    turkish: "middle_east",
    yemeni: "middle_east",
    ethiopian: "east_africa",
    eritrean: "east_africa",
    kenyan: "east_africa",
    somali: "east_africa",
    sudanese: "east_africa",
    tanzanian: "east_africa",
    ugandan: "east_africa",
    rwandan: "east_africa",
    burundian: "east_africa",
    akan: "west_africa",
    ghanaian: "west_africa",
    gambian: "west_africa",
    igbo: "west_africa",
    ivorian: "west_africa",
    liberian: "west_africa",
    malian: "west_africa",
    nigerian: "west_africa",
    senegalese: "west_africa",
    sierra_leonean: "west_africa",
    yoruba: "west_africa",
    west_african: "west_africa",
    chinese: "east_asia",
    hong_kong: "east_asia",
    japanese: "east_asia",
    korean: "east_asia",
    mongolian: "east_asia",
    taiwanese: "east_asia",
    tibetan: "east_asia",
    bengali: "south_asia",
    bangladeshi: "south_asia",
    gujarati: "south_asia",
    indian: "south_asia",
    malayali: "south_asia",
    nepali: "south_asia",
    pakistani: "south_asia",
    punjabi: "south_asia",
    sri_lankan: "south_asia",
    tamil: "south_asia",
    telugu: "south_asia",
    south_asian: "south_asia",
    cambodian: "southeast_asia",
    filipino: "southeast_asia",
    indonesian: "southeast_asia",
    lao: "southeast_asia",
    malaysian: "southeast_asia",
    myanmar: "southeast_asia",
    singaporean: "southeast_asia",
    thai: "southeast_asia",
    vietnamese: "southeast_asia",
    argentinian: "caribbean_latin",
    brazilian: "caribbean_latin",
    caribbean: "caribbean_latin",
    chilean: "caribbean_latin",
    colombian: "caribbean_latin",
    cuban: "caribbean_latin",
    dominican: "caribbean_latin",
    haitian: "caribbean_latin",
    jamaican: "caribbean_latin",
    latin_american: "caribbean_latin",
    mexican: "caribbean_latin",
    peruvian: "caribbean_latin",
    puerto_rican: "caribbean_latin",
    salvadoran: "caribbean_latin",
    trinidadian: "caribbean_latin",
    venezuelan: "caribbean_latin",
    albanian: "europe",
    balkan: "europe",
    croatian: "europe",
    french: "europe",
    german: "europe",
    greek: "europe",
    italian: "europe",
    polish: "europe",
    portuguese: "europe",
    romanian: "europe",
    serbian: "europe",
    spanish_speaking: "europe",
    ukrainian: "europe",
    algerian: "north_africa",
    egyptian: "north_africa",
    moroccan: "north_africa",
    tunisian: "north_africa",
    afghan: "central_asia",
    kazakh: "central_asia",
    uzbek: "central_asia",
    first_nations: "indigenous",
    inuit: "indigenous",
    metis: "indigenous",
    samoan: "pacific",
    polynesian: "pacific",
    diaspora: "jewish",
  };

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

  function categoryFor(slug) {
    const key = clean(slug).toLowerCase();
    if (!key) return null;
    return (
      CATEGORIES.find((category) => category.slug === key) ||
      CATEGORIES.find((category) =>
        (category.aliases || []).some(
          (alias) => clean(alias).toLowerCase() === key,
        ),
      ) ||
      null
    );
  }

  function resolveSlug(raw) {
    const key = clean(raw).toLowerCase();
    if (!key) return "";
    if (categoryFor(key)) return categoryFor(key).slug;
    const legacy = LEGACY_TO_CATEGORY[key];
    return legacy && categoryFor(legacy) ? legacy : "";
  }

  function active() {
    const stored = readRaw();
    const rawSlug = clean(
      stored.active || stored.current || stored.selected?.[0] || "",
    ).toLowerCase();
    const resolved = resolveSlug(rawSlug);
    const culture = categoryFor(resolved);
    // Persist migration when an old individual culture is still stored.
    if (culture && rawSlug && rawSlug !== culture.slug) {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({
            version: STORAGE_VERSION,
            active: culture.slug,
            selected: [culture.slug],
            current: culture.slug,
            updatedAt: new Date().toISOString(),
          }),
        );
      } catch (_error) {}
      updateProfile(culture);
    }
    return culture;
  }

  function updateProfile(culture) {
    try {
      const preferences = JSON.parse(
        localStorage.getItem("echoo_preferences") || "{}",
      );
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
    const resolved = resolveSlug(slug);
    const culture = categoryFor(resolved);
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: STORAGE_VERSION,
          active: culture?.slug || "",
          selected: culture ? [culture.slug] : [],
          current: culture?.slug || "",
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch (_error) {}
    updateProfile(culture);
    if (!options.silent) {
      window.dispatchEvent(
        new CustomEvent("echoo:culture-changed", { detail: { culture } }),
      );
    }
    return culture;
  }

  function queryFor(query, culture = active()) {
    const base = clean(query).toLowerCase() || "discover";
    const topics = {
      discover: "restaurants food music events markets community spots",
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
    if (!culture) {
      return base === "trending" || base === "discover"
        ? "popular places things to do"
        : topic;
    }
    const lensTerms = [culture.label, ...(culture.terms || [])]
      .filter(Boolean)
      .slice(0, 4)
      .join(" ");
    return `${lensTerms} ${topic}`;
  }

  window.EchooCultureContext = {
    catalogue: CATEGORIES,
    categories: CATEGORIES,
    // browseGroups kept as alias so older UI code still enumerates options
    browseGroups: CATEGORIES.map(({ slug, label }) => ({ slug, label })),
    getActive: active,
    setActive,
    clear(options = {}) {
      return setActive("", options);
    },
    queryFor,
    resolveSlug,
  };
})();
