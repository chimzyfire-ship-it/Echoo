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

  function joinLimited(values, limit = 3) {
    return listFrom(values).slice(0, limit).join(" · ");
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
    const activity = listFrom(profile.activity_tags).slice(0, 2).join(" and ");
    const parts = [];
    if (vibe) parts.push(`feels ${vibe}`);
    if (goodFor) parts.push(`works well for ${goodFor}`);
    if (activity) parts.push(`and suits ${activity}`);
    if (!parts.length) {
      return "Echoo has a verified local profile here, with enough context to make the tap worth it.";
    }
    return `${place.name || "This place"} ${parts.join(", ")}.`;
  }

  function buildHighlights(detail) {
    const place = detail.place || {};
    const profile = detail.profile || {};
    const sourceStatus = detail.sourceStatus || {};
    const hours = Array.isArray(detail.hours) ? detail.hours : [];
    const timeZone = place.timezone || "America/Toronto";
    const current = getCurrentParts(timeZone);
    const todayHours = hours.find(
      (item) => Number(item.day_of_week) === current.weekdayIndex,
    );

    const highlights = [];
    const bestFor = listFrom(profile.good_for).slice(0, 3);
    const vibeTags = listFrom(profile.vibe_tags).slice(0, 3);
    const activityTags = listFrom(profile.activity_tags).slice(0, 2);
    const mealTags = listFrom(profile.meal_tags).slice(0, 2);

    if (bestFor.length) {
      highlights.push(`Best for ${bestFor.join(", ")}`);
    }
    if (vibeTags.length) {
      highlights.push(`Vibe signals: ${vibeTags.join(", ")}`);
    }
    if (activityTags.length || mealTags.length) {
      highlights.push(
        [activityTags.join(", "), mealTags.join(", ")].filter(Boolean).join(" · "),
      );
    }

    const confidence = confidenceLabel(sourceStatus.confidenceScore || profile.confidence_score);
    const sources = Number(sourceStatus.sourceCount || 0);
    if (sources) {
      highlights.push(`${sources} source${sources === 1 ? "" : "s"} and ${confidence.toLowerCase()}`);
    } else if (confidence) {
      highlights.push(confidence);
    }

    if (todayHours) {
      const opensAt = parseMinutes(todayHours.opens_at);
      const closesAt = parseMinutes(todayHours.closes_at);
      if (todayHours.is_closed) {
        highlights.push("Closed today");
      } else if (Number.isFinite(opensAt) && Number.isFinite(closesAt)) {
        if (closesAt > opensAt) {
          const isOpen = current.minutes >= opensAt && current.minutes < closesAt;
          highlights.push(
            isOpen
              ? `Open now until ${formatTime(todayHours.closes_at)}`
              : `Opens ${current.minutes < opensAt ? "today" : "later"} at ${formatTime(todayHours.opens_at)}`,
          );
        } else {
          const isOpen =
            current.minutes >= opensAt || current.minutes < closesAt;
          highlights.push(
            isOpen
              ? `Open now until ${formatTime(todayHours.closes_at)}`
              : `Opens at ${formatTime(todayHours.opens_at)}`,
          );
        }
      }
    }

    return highlights.filter(Boolean).slice(0, 4);
  }

  function buildFacts(detail) {
    const place = detail.place || {};
    const profile = detail.profile || {};
    const sourceStatus = detail.sourceStatus || {};
    const hours = Array.isArray(detail.hours) ? detail.hours : [];
    const relatedEvents = Array.isArray(detail.relatedEvents)
      ? detail.relatedEvents
      : [];
    const stats = [
      {
        label: "Status",
        value: confidenceLabel(sourceStatus.confidenceScore || profile.confidence_score),
      },
      {
        label: "Sources",
        value: `${Number(sourceStatus.sourceCount || 0) || "0"} verified`,
      },
      {
        label: "Price",
        value: cleanText(profile.price_band) || cleanText(place.metadata?.price_band) || "Not listed",
      },
      {
        label: "Noise",
        value: cleanText(profile.noise_level) || "Not listed",
      },
    ];

    if (hours.length) {
      stats.push({
        label: "Hours",
        value: `${hours.filter((row) => !row.is_closed).length}/7 days open`,
      });
    }
    if (relatedEvents.length) {
      stats.push({
        label: "Nearby live",
        value: `${relatedEvents.length} event${relatedEvents.length === 1 ? "" : "s"}`,
      });
    }
    return stats.slice(0, 6);
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
          active: false,
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

  function buildBullets(detail) {
    const place = detail.place || {};
    const profile = detail.profile || {};
    const sourceStatus = detail.sourceStatus || {};
    const bullets = [];
    const bestFor = listFrom(profile.good_for).slice(0, 2).join(" and ");
    const vibe = listFrom(profile.vibe_tags).slice(0, 2).join(" and ");
    const activity = listFrom(profile.activity_tags).slice(0, 2).join(" and ");
    const meal = listFrom(profile.meal_tags).slice(0, 2).join(" and ");

    if (bestFor || vibe) {
      bullets.push(
        [
          bestFor ? `Best for ${bestFor}` : "",
          vibe ? `the vibe reads ${vibe}` : "",
        ]
          .filter(Boolean)
          .join(" and "),
      );
    }

    if (activity || meal) {
      bullets.push(
        [
          activity ? `Activity signals lean toward ${activity}` : "",
          meal ? `meal cues include ${meal}` : "",
        ]
          .filter(Boolean)
          .join(" and "),
      );
    }

    if (profile.caveats) {
      bullets.push(cleanText(profile.caveats));
    } else if (sourceStatus.sourceCount) {
      bullets.push(
        `${sourceStatus.sourceCount} source${sourceStatus.sourceCount === 1 ? "" : "s"} are attached, so this profile stays accountable.`,
      );
    }

    if (place.last_verified_at) {
      bullets.push(
        `Last verified ${new Intl.DateTimeFormat("en-CA", {
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(new Date(place.last_verified_at))}.`,
      );
    }

    return bullets.filter(Boolean).slice(0, 4);
  }

  function buildAlternatives(detail) {
    const alternatives = Array.isArray(detail.alternatives)
      ? detail.alternatives
      : [];
    return alternatives.slice(0, 3);
  }

  function buildEvents(detail) {
    const relatedEvents = Array.isArray(detail.relatedEvents)
      ? detail.relatedEvents
      : [];
    return relatedEvents.slice(0, 3);
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
    const heroImage =
      options.heroImage ||
      place.image_url ||
      place.imageUrl ||
      place.cover_image_url ||
      place.photo_url ||
      "assets/optimized/news-date-768.jpg";
    const title = cleanText(place.name, "Verified place");
    const kicker = [
      cleanText(place.category, "Place"),
      cleanText(place.municipality || place.city || place.admin_area_1, "Ontario"),
    ]
      .filter(Boolean)
      .join(" · ");
    const summary = buildSummary(detail);
    const highlights = buildHighlights(detail);
    const facts = buildFacts(detail);
    const bullets = buildBullets(detail);
    const hoursRows = buildHoursRows(detail);
    const sources = Array.isArray(detail.sources) ? detail.sources : [];
    const relatedEvents = buildEvents(detail);
    const alternatives = buildAlternatives(detail);
    const directionsHref = options.directionsHref || mapsLinkFor(place);
    const sourceStatus = detail.sourceStatus || {};
    const trustLabel = confidenceLabel(sourceStatus.confidenceScore || profile.confidence_score);
    const currentDay = hoursRows.find((row) => row.active) || hoursRows[0];
    const heroStatus = currentDay
      ? `${currentDay.label} · ${currentDay.state}${currentDay.text ? ` · ${currentDay.text}` : ""}`
      : trustLabel;
    const bestFor = listFrom(profile.good_for).slice(0, 4);

    return `
      <section class="echoo-place-detail">
        <div class="echoo-place-hero">
          <img class="echoo-place-hero-image" src="${escapeHtml(heroImage)}" alt="${escapeHtml(title)}" loading="eager" decoding="async">
          <div class="echoo-place-hero-meta">
            <div class="echoo-place-hero-stack">
              <div class="echoo-place-hero-chip">${escapeHtml(trustLabel)}</div>
              <div class="echoo-place-hero-status">${escapeHtml(heroStatus)}</div>
            </div>
            <div class="echoo-place-trust">${escapeHtml(`${Number(sourceStatus.sourceCount || 0) || 0} source${Number(sourceStatus.sourceCount || 0) === 1 ? "" : "s"}`)}</div>
          </div>
        </div>

        <div class="echoo-place-content">
          <div class="echoo-place-kicker">${escapeHtml(kicker)}</div>
          <h2 class="echoo-place-title">${escapeHtml(title)}</h2>
          <p class="echoo-place-summary">${escapeHtml(summary)}</p>

          <div class="echoo-place-fact-grid">
            ${facts
              .map(
                (fact) => `
                  <div class="echoo-place-fact">
                    <span class="echoo-place-fact-label">${escapeHtml(fact.label)}</span>
                    <div class="echoo-place-fact-value">${escapeHtml(fact.value)}</div>
                  </div>
                `,
              )
              .join("")}
          </div>

          ${
            highlights.length
              ? `
            <section class="echoo-place-section">
              <h3 class="echoo-place-section-title">Why Echoo picked it</h3>
              <ul class="echoo-place-bullets">
                ${highlights
                  .map((item) => `<li class="echoo-place-bullet">${escapeHtml(item)}</li>`)
                  .join("")}
              </ul>
            </section>
          `
              : ""
          }

          ${
            bestFor.length
              ? `
            <section class="echoo-place-section">
              <h3 class="echoo-place-section-title">Best for</h3>
              <div class="echoo-place-chip-row">
                ${bestFor.map((item) => `<span class="echoo-place-chip">${escapeHtml(item)}</span>`).join("")}
              </div>
            </section>
          `
              : ""
          }

          <section class="echoo-place-section">
            <h3 class="echoo-place-section-title">Practical details</h3>
            <div class="echoo-place-hour-list">
              ${hoursRows
                .map(
                  (row) => `
                    <div class="echoo-place-hour-row${row.active ? " active" : ""}">
                      <div>
                        <div class="echoo-place-hour-day">${escapeHtml(row.label)}</div>
                        <div class="echoo-place-hour-value">${escapeHtml(row.text)}</div>
                      </div>
                      <div class="echoo-place-hour-state">${escapeHtml(row.state)}</div>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </section>

          ${
            bullets.length
              ? `
            <section class="echoo-place-section">
              <h3 class="echoo-place-section-title">Good to know</h3>
              <ul class="echoo-place-bullets">
                ${bullets.map((item) => `<li class="echoo-place-bullet">${escapeHtml(item)}</li>`).join("")}
              </ul>
            </section>
          `
              : ""
          }

          ${
            relatedEvents.length
              ? `
            <section class="echoo-place-section">
              <h3 class="echoo-place-section-title">Live nearby</h3>
              <div class="echoo-place-card-list">
                ${relatedEvents
                  .map((item) => {
                    const time = item.starts_at
                      ? new Intl.DateTimeFormat("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }).format(new Date(item.starts_at))
                      : "";
                    const subtitle = [time, item.price_label || item.category].filter(Boolean).join(" · ");
                    return `
                      <article class="echoo-place-card">
                        <div class="echoo-place-card-top">
                          <div class="echoo-place-card-main">
                            <div class="echoo-place-card-title">${escapeHtml(item.title || "Nearby event")}</div>
                            <div class="echoo-place-card-meta">${escapeHtml(subtitle || "Live now")}</div>
                          </div>
                          <div class="echoo-place-card-pill">Event</div>
                        </div>
                        ${item.description ? `<div class="echoo-place-card-sub">${escapeHtml(item.description)}</div>` : ""}
                      </article>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          `
              : ""
          }

          ${
            alternatives.length
              ? `
            <section class="echoo-place-section">
              <h3 class="echoo-place-section-title">Similar options</h3>
              <div class="echoo-place-card-list">
                ${alternatives
                  .map((item) => {
                    const meta = [
                      cleanText(item.category),
                      formatDistance(item.distanceMeters),
                    ]
                      .filter(Boolean)
                      .join(" · ");
                    return `
                      <article class="echoo-place-card">
                        <div class="echoo-place-card-top">
                          <div class="echoo-place-card-main">
                            <div class="echoo-place-card-title">${escapeHtml(item.title || "Nearby place")}</div>
                            <div class="echoo-place-card-meta">${escapeHtml(meta || cleanText(item.city))}</div>
                          </div>
                          <div class="echoo-place-card-pill">Alt</div>
                        </div>
                        ${item.address ? `<div class="echoo-place-card-sub">${escapeHtml(item.address)}</div>` : ""}
                      </article>
                    `;
                  })
                  .join("")}
              </div>
            </section>
          `
              : ""
          }

          <section class="echoo-place-section">
            <h3 class="echoo-place-section-title">Sources</h3>
            ${
              sources.length
                ? `
                  <div class="echoo-place-source-list">
                    ${sources
                      .slice(0, 3)
                      .map((source) => {
                        const fetched = source.fetched_at
                          ? new Intl.DateTimeFormat("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }).format(new Date(source.fetched_at))
                          : "";
                        return `
                          <div class="echoo-place-source">
                            <div>
                              <div class="echoo-place-source-title">${escapeHtml(source.source_name || "Source")}</div>
                              <div class="echoo-place-source-meta">${escapeHtml([source.source_license, fetched].filter(Boolean).join(" · ") || "Verified record")}</div>
                            </div>
                          </div>
                        `;
                      })
                      .join("")}
                  </div>
                `
                : `<div class="echoo-place-empty">Echoo has a partial profile here, but not enough source-backed records to list yet.</div>`
            }
          </section>

          <div class="echoo-place-actions">
            <a class="primary" href="${escapeHtml(directionsHref)}" target="_blank" rel="noopener">Get directions</a>
            <button type="button" data-close-sheet>Close</button>
          </div>
        </div>
      </section>
    `;
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
      <section class="echoo-place-detail">
        <div class="echoo-place-auth">
          <div class="echoo-place-auth-top">
            <div class="echoo-place-auth-badge">
              <span class="echoo-place-auth-icon">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#E7C98E" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                  <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                </svg>
              </span>
              <span class="echoo-place-auth-label">ECHOO PASS REQUIRED</span>
            </div>
          </div>
          <h2 class="echoo-place-auth-title">${escapeHtml(title)}</h2>
          <div class="echoo-place-auth-divider"></div>
          <p class="echoo-place-auth-subhead">${escapeHtml(subhead)}</p>
          <p class="echoo-place-auth-note">${escapeHtml(note)}</p>
          <div class="echoo-place-auth-actions">
            <a class="primary" href="${escapeHtml(authHref)}">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                <polyline points="10 17 15 12 10 7"></polyline>
                <line x1="15" y1="12" x2="3" y2="12"></line>
              </svg>
              <span>${escapeHtml(primaryLabel)}</span>
            </a>
            <a class="secondary" href="${escapeHtml(secondaryHref)}" data-close-sheet>${escapeHtml(secondaryLabel)}</a>
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
    pickCaption,
    renderAuthPrompt,
    renderPlaceDetail,
  };
})();
