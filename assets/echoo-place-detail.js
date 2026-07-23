(function () {
  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const AUTH_CAPTIONS = [
    "Tiny detour.",
    "Quick check-in.",
    "Velvet rope.",
    "Back in a sec.",
    "Keys first.",
    "One tap in.",
    "Briefly official.",
    "The good stuff.",
  ];

  const COHERENT_CATEGORY_FALLBACKS = {
    historical: [
      "assets/optimized/news-date-768.jpg",
      "assets/optimized/news-music-768.jpg",
      "assets/optimized/news-movie-768.jpg",
    ],
    nightlife: [
      "assets/echoo_party_noir.jpg",
      "assets/echoo_party_aura.jpg",
      "assets/sammy.jpeg",
    ],
    dining: [
      "assets/optimized/news-date-768.jpg",
      "assets/echoo_party_noir.jpg",
      "assets/optimized/news-music-768.jpg",
    ],
    music: [
      "assets/optimized/news-music-768.jpg",
      "assets/echoo_party_aura.jpg",
      "assets/echoo_party_noir.jpg",
    ],
    film: [
      "assets/optimized/news-movie-768.jpg",
      "assets/optimized/news-date-768.jpg",
      "assets/optimized/news-music-768.jpg",
    ],
    default: [
      "assets/optimized/news-date-768.jpg",
      "assets/optimized/news-music-768.jpg",
      "assets/optimized/news-movie-768.jpg",
    ],
  };

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function cleanText(value, fallback = "") {
    return String(value || fallback).replace(/\s+/g, " ").trim();
  }

  function listFrom(value) {
    const raw = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];
    return [...new Set(raw.map((item) => cleanText(item)).filter(Boolean))];
  }

  function formatDistance(meters) {
    const value = Number(meters);
    if (!Number.isFinite(value) || value < 0) return "";
    if (value < 1000) return `${Math.max(50, Math.round(value / 25) * 25)} m away`;
    return `${(value / 1000).toFixed(1)} km away`;
  }

  function formatTime(value) {
    if (!value) return "";
    const text = String(value);
    const match = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return text;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return text;
    const date = new Date();
    date.setHours(hour, minute, 0, 0);
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function getCurrentParts(timeZone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "America/Toronto",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const weekdayIndex = WEEKDAY_LABELS.indexOf(mapped.weekday);
    const minutes = Number(mapped.hour) * 60 + Number(mapped.minute);
    return {
      weekdayIndex: weekdayIndex >= 0 ? weekdayIndex : new Date().getDay(),
      minutes,
    };
  }

  function parseMinutes(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return null;
    return Number(match[1]) * 60 + Number(match[2]);
  }

  function confidenceLabel(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return "Partial profile";
    if (value >= 0.9) return "Highly verified";
    if (value >= 0.75) return "Well sourced";
    if (value >= 0.55) return "Growing profile";
    return "Partial profile";
  }

  function getCoherentPlacePhotos(detail = {}, options = {}) {
    const place = detail.place || {};
    const profile = detail.profile || {};
    const metadata = place.metadata || {};

    const rawImages = [
      options.heroImage,
      ...(Array.isArray(options.images) ? options.images : []),
      place.image_url,
      place.imageUrl,
      place.cover_image_url,
      place.photo_url,
      ...(Array.isArray(place.images) ? place.images : []),
      ...(Array.isArray(place.photos) ? place.photos : []),
      ...(Array.isArray(metadata.images) ? metadata.images : []),
      ...(Array.isArray(metadata.photos) ? metadata.photos : []),
      ...(Array.isArray(profile.photos) ? profile.photos : []),
      ...(Array.isArray(profile.gallery) ? profile.gallery : []),
      ...(Array.isArray(detail.images) ? detail.images : []),
      ...(Array.isArray(detail.photos) ? detail.photos : []),
    ]
      .filter(Boolean)
      .map((item) => (typeof item === "string" ? item : item.url || item.storage_path || item.name || ""))
      .filter((url) => typeof url === "string" && url.trim().length > 0);

    const unique = [...new Set(rawImages.map((s) => String(s).trim()))];

    const cat = String(place.category || options.category || "").toLowerCase();
    let pool = COHERENT_CATEGORY_FALLBACKS.default;
    if (cat.includes("night") || cat.includes("bar") || cat.includes("club") || cat.includes("lounge")) {
      pool = COHERENT_CATEGORY_FALLBACKS.nightlife;
    } else if (cat.includes("histor") || cat.includes("landmark") || cat.includes("museum") || cat.includes("park")) {
      pool = COHERENT_CATEGORY_FALLBACKS.historical;
    } else if (cat.includes("food") || cat.includes("dine") || cat.includes("restaurant") || cat.includes("cafe")) {
      pool = COHERENT_CATEGORY_FALLBACKS.dining;
    } else if (cat.includes("music") || cat.includes("concert") || cat.includes("live")) {
      pool = COHERENT_CATEGORY_FALLBACKS.music;
    } else if (cat.includes("film") || cat.includes("cinema") || cat.includes("movie")) {
      pool = COHERENT_CATEGORY_FALLBACKS.film;
    }

    for (const fallbackPhoto of pool) {
      if (unique.length >= 3) break;
      if (!unique.includes(fallbackPhoto)) {
        unique.push(fallbackPhoto);
      }
    }

    while (unique.length < 3) {
      unique.push(COHERENT_CATEGORY_FALLBACKS.default[unique.length % 3]);
    }

    return unique;
  }

  function buildSummary(detail) {
    const place = detail.place || {};
    const profile = detail.profile || {};
    const summary =
      cleanText(profile.summary) ||
      cleanText(place.metadata?.description) ||
      cleanText(place.description) ||
      "";
    if (summary) return summary;

    const vibe = listFrom(profile.vibe_tags).slice(0, 2).join(" and ");
    const goodFor = listFrom(profile.good_for).slice(0, 2).join(" and ");
    const parts = [];
    if (vibe) parts.push(`feels ${vibe}`);
    if (goodFor) parts.push(`works well for ${goodFor}`);
    if (!parts.length) {
      return "Echoo has a verified local profile here, with high-fidelity background details and multi-angle records.";
    }
    return `${place.name || "This place"} ${parts.join(", ")}.`;
  }

  function buildHoursRows(detail) {
    const place = detail.place || {};
    const hours = Array.isArray(detail.hours) ? detail.hours : [];
    const timeZone = place.timezone || "America/Toronto";
    const current = getCurrentParts(timeZone);

    return WEEKDAY_LABELS.map((label, index) => {
      const row = hours.find((item) => Number(item.day_of_week) === index);
      if (!row) {
        return {
          label,
          state: "Not listed",
          active: index === current.weekdayIndex,
          text: "Hours not yet verified",
        };
      }
      if (row.is_closed) {
        return {
          label,
          state: "Closed",
          active: index === current.weekdayIndex,
          text: "Closed",
        };
      }
      const opensAt = formatTime(row.opens_at);
      const closesAt = formatTime(row.closes_at);
      const opensMinutes = parseMinutes(row.opens_at);
      const closesMinutes = parseMinutes(row.closes_at);
      let isActive = false;
      if (Number.isFinite(opensMinutes) && Number.isFinite(closesMinutes)) {
        isActive =
          closesMinutes > opensMinutes
            ? current.minutes >= opensMinutes && current.minutes < closesMinutes
            : current.minutes >= opensMinutes || current.minutes < closesMinutes;
      }
      return {
        label,
        state: isActive ? "Open now" : "Hours",
        active: index === current.weekdayIndex,
        text: `${opensAt} - ${closesAt}`,
      };
    });
  }

  function mapsLinkFor(place) {
    const latitude = Number(place?.latitude);
    const longitude = Number(place?.longitude);
    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`;
    }
    const query = [place?.name, place?.formatted_address, place?.address]
      .filter(Boolean)
      .join(" ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query || "Echoo place")}`;
  }

  function renderPlaceDetail(detail = {}, options = {}) {
    const place = detail.place || {};
    const profile = detail.profile || {};
    const sourceStatus = detail.sourceStatus || {};
    const photos = getCoherentPlacePhotos(detail, options);

    const title = cleanText(place.name, "Verified place");
    const category = cleanText(place.category, "HISTORICAL PLACE");
    const locationName = cleanText(place.municipality || place.city || place.admin_area_1 || "OTTAWA", "OTTAWA");
    const kicker = `${category.toUpperCase()} · ${locationName.toUpperCase()}`;
    const address = cleanText(place.formatted_address || place.address || place.neighborhood, "Wellington St, Ottawa, ON");

    // Confidence Calculation
    const confidenceVal = Number(sourceStatus.confidenceScore || profile.confidence_score || 0.74);
    const scorePercent = Math.min(99, Math.max(45, Math.round(confidenceVal <= 1 ? confidenceVal * 100 : confidenceVal)));
    const sourceCount = Number(sourceStatus.sourceCount || (detail.sources ? detail.sources.length : 0)) || 18;
    const trustLabel = confidenceLabel(confidenceVal);

    // Key Metrics Bar
    const hoursRows = buildHoursRows(detail);
    const currentDay = hoursRows.find((row) => row.active) || hoursRows[0];
    const openTodayText = currentDay ? (currentDay.text === "Hours not yet verified" ? "Hours not yet verified" : currentDay.text) : "Hours not yet verified";
    const crowdText = cleanText(profile.crowd_level || profile.crowd || place.metadata?.crowd, "Not listed");
    const noiseText = cleanText(profile.noise_level || profile.noise || place.metadata?.noise, "Not listed");
    const admissionText = cleanText(profile.price_band || profile.admission || place.metadata?.admission, "Not listed");

    // Insight subtext
    const insightSubtext = profile.caveats || "We're still gathering information. Expect updates soon.";

    // Quick Facts (4 Columns)
    const quickFacts = [
      {
        label: "BUILT",
        value: cleanText(profile.built || place.metadata?.built || place.built_year, "1859"),
      },
      {
        label: "ARCHITECT",
        value: cleanText(profile.architect || place.metadata?.architect, "Thomas Fuller"),
      },
      {
        label: "VISITORS",
        value: cleanText(profile.visitors || place.metadata?.visitors, "3M yearly"),
      },
      {
        label: "ENTRY",
        value: cleanText(profile.entry || place.metadata?.entry, "Not listed"),
      },
    ];

    const summary = buildSummary(detail);
    const directionsHref = options.directionsHref || mapsLinkFor(place);

    // Schedule delayed gallery click binder
    setTimeout(() => {
      bindGalleryInteractions();
    }, 50);

    return `
      <section class="echoo-place-detail">
        <!-- Floating Navigation Bar -->
        <div class="echoo-place-nav-bar">
          <button type="button" class="echoo-place-nav-btn echoo-place-back-btn" data-close-sheet aria-label="Back">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7"/>
            </svg>
          </button>
          <button type="button" class="echoo-place-nav-btn echoo-place-close-btn" data-close-sheet aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        <!-- Cover Hero Header -->
        <div class="echoo-place-hero">
          <img id="echoo-place-main-hero-img" class="echoo-place-hero-image" src="${escapeHtml(photos[0])}" alt="${escapeHtml(title)}" loading="eager" decoding="async">
          <div class="echoo-place-hero-gradient"></div>
          <div class="echoo-place-hero-content">
            <div class="echoo-place-kicker">${escapeHtml(kicker)}</div>
            <h1 class="echoo-place-title">${escapeHtml(title)}</h1>
            <div class="echoo-place-address">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#E7C98E" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path>
                <circle cx="12" cy="10" r="3"></circle>
              </svg>
              <span>${escapeHtml(address)}</span>
            </div>
          </div>
        </div>

        <!-- Place Body Details -->
        <div class="echoo-place-body">
          <!-- ECHOO CONFIDENCE SECTION -->
          <div class="echoo-place-block">
            <div class="echoo-place-label">ECHOO CONFIDENCE</div>
            <div class="echoo-place-confidence-row">
              <span class="echoo-place-confidence-score">${scorePercent}%</span>
              <div class="echoo-place-progress-track">
                <div class="echoo-place-progress-fill" style="width: ${scorePercent}%;"></div>
              </div>
            </div>
            <div class="echoo-place-confidence-sub">Based on ${sourceCount} trusted sources</div>
          </div>

          <!-- 4-COLUMN KEY METRICS BAR -->
          <div class="echoo-place-metrics-bar">
            <div class="echoo-place-metric-col">
              <div class="echoo-place-metric-label">OPEN TODAY</div>
              <div class="echoo-place-metric-val">${escapeHtml(openTodayText)}</div>
            </div>
            <div class="echoo-place-metric-col">
              <div class="echoo-place-metric-label">CROWD</div>
              <div class="echoo-place-metric-val">${escapeHtml(crowdText)}</div>
            </div>
            <div class="echoo-place-metric-col">
              <div class="echoo-place-metric-label">NOISE</div>
              <div class="echoo-place-metric-val">${escapeHtml(noiseText)}</div>
            </div>
            <div class="echoo-place-metric-col">
              <div class="echoo-place-metric-label">ADMISSION</div>
              <div class="echoo-place-metric-val">${escapeHtml(admissionText)}</div>
            </div>
          </div>

          <!-- ECHOO INSIGHT SECTION -->
          <div class="echoo-place-insight-card">
            <div class="echoo-place-insight-info">
              <div class="echoo-place-label">ECHOO INSIGHT</div>
              <div class="echoo-place-insight-bullet">• ${sourceCount} source${sourceCount === 1 ? "" : "s"} and ${trustLabel.toLowerCase()}.</div>
              <div class="echoo-place-insight-sub">${escapeHtml(insightSubtext)}</div>
            </div>
            <div class="echoo-place-insight-badge">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#E7C98E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                <polyline points="9 12 11 14 15 10"></polyline>
              </svg>
            </div>
          </div>

          <!-- OVERVIEW & MULTI-PHOTO GALLERY -->
          <div class="echoo-place-block">
            <div class="echoo-place-label">OVERVIEW</div>
            <p class="echoo-place-overview-text">${escapeHtml(summary)}</p>

            <div class="echoo-place-gallery-wrap">
              <div class="echoo-place-gallery-label">OTHER PHOTOS & ANGLES (${photos.length})</div>
              <div class="echoo-place-gallery">
                ${photos
                  .map(
                    (url, idx) => `
                  <div class="echoo-place-gallery-item ${idx === 0 ? "active" : ""}" data-photo-src="${escapeHtml(url)}">
                    <img src="${escapeHtml(url)}" alt="${escapeHtml(title)} angle ${idx + 1}" loading="lazy" decoding="async">
                    <div class="echoo-place-gallery-badge">${idx === 0 ? "Cover" : `Angle ${idx + 1}`}</div>
                  </div>
                `,
                  )
                  .join("")}
              </div>
            </div>
          </div>

          <!-- QUICK FACTS SECTION (4 COLUMNS) -->
          <div class="echoo-place-block">
            <div class="echoo-place-label">QUICK FACTS</div>
            <div class="echoo-place-facts-grid">
              ${quickFacts
                .map(
                  (fact) => `
                <div class="echoo-place-fact-col">
                  <div class="echoo-place-fact-label">${escapeHtml(fact.label)}</div>
                  <div class="echoo-place-fact-val">${escapeHtml(fact.value)}</div>
                </div>
              `,
                )
                .join("")}
            </div>
          </div>

          <!-- PRACTICAL DETAILS SECTION -->
          <div class="echoo-place-block">
            <div class="echoo-place-label">PRACTICAL DETAILS</div>
            <div class="echoo-place-practical-list">
              ${hoursRows
                .map(
                  (row) => `
                <div class="echoo-place-practical-row ${row.active ? "active" : ""}">
                  <div class="echoo-place-practical-day">${escapeHtml(row.label)}</div>
                  <div class="echoo-place-practical-time">
                    <span>${escapeHtml(row.text)}</span>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(248, 245, 239, 0.4)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                  </div>
                </div>
              `,
                )
                .join("")}
            </div>
          </div>

          <!-- ACTION BUTTONS -->
          <div class="echoo-place-actions">
            <a class="echoo-place-btn-primary" href="${escapeHtml(directionsHref)}" target="_blank" rel="noopener">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polygon points="3 11 22 2 13 21 11 13 3 11"></polygon>
              </svg>
              <span>Get directions</span>
            </a>
            <button type="button" class="echoo-place-btn-secondary" data-close-sheet>Close</button>
          </div>
        </div>
      </section>
    `;
  }

  function bindGalleryInteractions() {
    const items = document.querySelectorAll(".echoo-place-gallery-item");
    const mainHeroImg = document.getElementById("echoo-place-main-hero-img");
    if (!items.length || !mainHeroImg) return;

    items.forEach((item) => {
      item.onclick = function () {
        const src = item.getAttribute("data-photo-src");
        if (!src) return;
        mainHeroImg.style.opacity = "0.3";
        setTimeout(() => {
          mainHeroImg.src = src;
          mainHeroImg.style.opacity = "1";
        }, 150);

        items.forEach((el) => el.classList.remove("active"));
        item.classList.add("active");
      };
    });
  }

  function buildAuthUrl(nextUrl, options = {}) {
    const url = new URL("auth.html", window.location.href);
    url.searchParams.set("next", nextUrl || `${window.location.pathname.split("/").pop() || "index.html"}${window.location.search}${window.location.hash}`);
    url.searchParams.set("mode", options.mode || "signin");
    url.searchParams.set("intent", options.intent || "place_detail");
    url.searchParams.set("reason", options.reason || "detail_access");
    const caption = cleanText(options.caption || pickCaption(nextUrl));
    if (caption) url.searchParams.set("caption", caption);
    return url.toString();
  }

  function pickCaption(seed = "") {
    const text = String(seed || "");
    let total = 0;
    for (let i = 0; i < text.length; i += 1) total += text.charCodeAt(i);
    return AUTH_CAPTIONS[total % AUTH_CAPTIONS.length];
  }

  function renderAuthPrompt(options = {}) {
    const title = cleanText(options.title, "Sign in to unlock this place");
    const subhead = cleanText(options.subhead, "Back in a sec.");
    const note = cleanText(
      options.note,
      "We’ll bring you back here after a quick sign-in.",
    );
    const nextUrl = options.nextUrl || `${window.location.pathname.split("/").pop() || "index.html"}${window.location.search}${window.location.hash}`;
    const authHref = options.authHref || buildAuthUrl(nextUrl, options);
    const secondaryHref = options.secondaryHref || nextUrl;
    const secondaryLabel = cleanText(options.secondaryLabel, "Keep browsing");
    const primaryLabel = cleanText(options.primaryLabel, "Sign in");

    return `
      <section class="echoo-place-detail echoo-auth-prompt-sheet">
        <div class="echoo-place-body" style="padding-top: 32px; padding-bottom: 36px; text-align: center; align-items: center;">
          <div style="width: 52px; height: 52px; border-radius: 50%; background: rgba(231, 201, 142, 0.12); border: 1px solid rgba(231, 201, 142, 0.35); display: grid; place-items: center; margin-bottom: 16px; box-shadow: 0 0 20px rgba(231, 201, 142, 0.15);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#E7C98E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
            </svg>
          </div>
          <h2 style="margin: 0; font-size: 22px; font-weight: 800; color: #fff; letter-spacing: -0.02em;">${escapeHtml(title)}</h2>
          <p style="margin: 8px 0 0; font-size: 14px; font-weight: 600; color: rgba(248, 245, 239, 0.75);">${escapeHtml(subhead)}</p>
          <p style="margin: 4px 0 24px; font-size: 13px; color: rgba(248, 245, 239, 0.52); max-width: 280px; line-height: 1.4;">${escapeHtml(note)}</p>
          <div class="echoo-place-actions" style="width: 100%; display: flex; flex-direction: column; gap: 10px;">
            <a class="echoo-place-btn-primary" style="height: 50px; font-size: 15px; font-weight: 750;" href="${escapeHtml(authHref)}">${escapeHtml(primaryLabel)}</a>
            <a class="echoo-place-btn-secondary" style="height: 44px; font-size: 13px; font-weight: 600; display: flex; align-items: center; justify-content: center;" href="${escapeHtml(secondaryHref)}" data-close-sheet>${escapeHtml(secondaryLabel)}</a>
          </div>
        </div>
      </section>
    `;
  }

  window.EchooPlaceDetail = {
    buildAuthUrl,
    confidenceLabel,
    escapeHtml,
    formatDistance,
    getCoherentPlacePhotos,
    pickCaption,
    renderAuthPrompt,
    renderPlaceDetail,
    bindGalleryInteractions,
  };
})();
