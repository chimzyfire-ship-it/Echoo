(function () {
  "use strict";

  const STORAGE_KEY = "echoo_culture_lens_v1";
  const STORAGE_VERSION = 5;

  // ISO 3166-1 alpha-2 territories. Labels come from the device locale so the
  // country picker feels native and searchable without shipping a custom list UI.
  const COUNTRY_CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW`.split(" ");

  const ENGLISH_NAMES =
    typeof Intl !== "undefined" && Intl.DisplayNames
      ? new Intl.DisplayNames(["en"], { type: "region" })
      : null;
  const LOCAL_NAMES =
    typeof Intl !== "undefined" && Intl.DisplayNames
      ? new Intl.DisplayNames([navigator.language || "en"], { type: "region" })
      : ENGLISH_NAMES;

  const NAME_OVERRIDES = {
    US: "United States",
    CA: "Canada",
    GB: "United Kingdom",
    CD: "Democratic Republic of the Congo",
    CG: "Republic of the Congo",
    CI: "Côte d’Ivoire",
    KR: "South Korea",
    KP: "North Korea",
    LA: "Laos",
    MM: "Myanmar",
    PS: "Palestine",
    RU: "Russia",
    SY: "Syria",
    TW: "Taiwan",
    TZ: "Tanzania",
    VA: "Vatican City",
    VE: "Venezuela",
    VN: "Vietnam",
    XK: "Kosovo",
  };

  const SEARCH_ALIASES = {
    CA: ["Canadian"],
    US: ["America", "American", "USA", "US", "United States of America"],
    GB: ["Britain", "British", "UK", "Great Britain"],
    CI: ["Ivory Coast"],
    CZ: ["Czech Republic"],
    KR: ["Korea"],
    MM: ["Burma"],
    NL: ["Holland"],
    PS: ["Palestinian"],
    RU: ["Russian Federation"],
    SZ: ["Swaziland"],
    TL: ["East Timor"],
    TR: ["Turkey", "Türkiye"],
  };

  const COUNTRIES = COUNTRY_CODES.map((code) => {
    const label = NAME_OVERRIDES[code] || ENGLISH_NAMES?.of(code) || code;
    const localLabel = LOCAL_NAMES?.of(code) || label;
    return {
      code,
      slug: code.toLowerCase(),
      label,
      localLabel,
      aliases: [...new Set([localLabel, ...(SEARCH_ALIASES[code] || [])])],
      terms: [label, `${label} culture`, ...(SEARCH_ALIASES[code] || [])],
      group: code.toLowerCase(),
    };
  }).sort((a, b) => a.label.localeCompare(b.label));

  // Preserve existing personal selections where an old nationality slug maps
  // cleanly to one country. Broad region lenses are intentionally cleared.
  const LEGACY_TO_COUNTRY = {
    afghan: "af", albanian: "al", algerian: "dz", american: "us",
    argentinian: "ar", armenian: "am", australian: "au", bangladeshi: "bd",
    brazilian: "br", burundian: "bi", cambodian: "kh", canadian: "ca",
    chilean: "cl", chinese: "cn", colombian: "co", croatian: "hr",
    cuban: "cu", dominican: "do", egyptian: "eg", eritrean: "er",
    ethiopian: "et", filipino: "ph", french: "fr", gambian: "gm",
    german: "de", ghanaian: "gh", greek: "gr", haitian: "ht",
    hong_kong: "hk", indian: "in", indonesian: "id", iranian: "ir",
    iraqi: "iq", israeli: "il", italian: "it", ivorian: "ci",
    jamaican: "jm", japanese: "jp", jordanian: "jo", kazakh: "kz",
    kenyan: "ke", korean: "kr", lao: "la", lebanese: "lb",
    liberian: "lr", malaysian: "my", malian: "ml", mexican: "mx",
    mongolian: "mn", moroccan: "ma", myanmar: "mm", nepali: "np",
    nigerian: "ng", pakistani: "pk", palestinian: "ps", peruvian: "pe",
    polish: "pl", portuguese: "pt", puerto_rican: "pr", romanian: "ro",
    rwandan: "rw", salvadoran: "sv", samoan: "ws", senegalese: "sn",
    serbian: "rs", singaporean: "sg", somali: "so", sri_lankan: "lk",
    sudanese: "sd", syrian: "sy", taiwanese: "tw", tanzanian: "tz",
    thai: "th", trinidadian: "tt", tunisian: "tn", turkish: "tr",
    ugandan: "ug", ukrainian: "ua", uzbek: "uz", venezuelan: "ve",
    vietnamese: "vn", yemeni: "ye",
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

  function countryFor(value) {
    const key = clean(value).toLowerCase();
    if (!key) return null;
    return (
      COUNTRIES.find(
        (country) =>
          country.slug === key ||
          country.code.toLowerCase() === key ||
          country.label.toLowerCase() === key ||
          country.localLabel.toLowerCase() === key ||
          country.aliases.some((alias) => alias.toLowerCase() === key),
      ) || null
    );
  }

  function resolveSlug(raw) {
    const key = clean(raw).toLowerCase();
    if (!key) return "";
    const country = countryFor(key);
    if (country) return country.slug;
    return LEGACY_TO_COUNTRY[key] || "";
  }

  function updateProfile(country) {
    try {
      const preferences = JSON.parse(
        localStorage.getItem("echoo_preferences") || "{}",
      );
      localStorage.setItem(
        "echoo_preferences",
        JSON.stringify({
          ...preferences,
          cultureLens: country ? country.label : "",
          cultureLensSlug: country ? country.slug : "",
          personalizationProfile: {
            ...(preferences.personalizationProfile || {}),
            cultureLens: country ? country.label : "",
            cultureLensSlug: country ? country.slug : "",
          },
        }),
      );
    } catch (_error) {}
  }

  function writeCountry(country) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          version: STORAGE_VERSION,
          active: country?.slug || "",
          selected: country ? [country.slug] : [],
          current: country?.slug || "",
          updatedAt: new Date().toISOString(),
        }),
      );
    } catch (_error) {}
    updateProfile(country);
  }

  function active() {
    const stored = readRaw();
    const rawSlug = clean(
      stored.active || stored.current || stored.selected?.[0] || "",
    ).toLowerCase();
    const resolved = resolveSlug(rawSlug);
    const country = countryFor(resolved);
    if (country && rawSlug !== country.slug) writeCountry(country);
    return country;
  }

  function setActive(slug, options = {}) {
    const country = countryFor(resolveSlug(slug));
    writeCountry(country);
    if (!options.silent) {
      window.dispatchEvent(
        new CustomEvent("echoo:culture-changed", {
          detail: { culture: country },
        }),
      );
    }
    return country;
  }

  function queryFor(query, country = active()) {
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
    if (!country) {
      return base === "trending" || base === "discover"
        ? "popular places things to do"
        : topic;
    }
    return `${country.label} culture ${topic}`;
  }

  window.EchooCultureContext = {
    catalogue: COUNTRIES,
    countries: COUNTRIES,
    categories: COUNTRIES,
    browseGroups: COUNTRIES.map(({ slug, label }) => ({ slug, label })),
    getActive: active,
    getByValue: countryFor,
    setActive,
    clear(options = {}) {
      return setActive("", options);
    },
    queryFor,
    resolveSlug,
  };
})();
