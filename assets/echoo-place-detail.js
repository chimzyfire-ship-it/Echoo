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

  function formatTime(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    if (!match) return "";
    const date = new Date();
    date.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return new Intl.DateTimeFormat("en-CA", {
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
  }

  function parseMinutes(value) {
    const match = String(value || "").match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : null;
  }

  function currentDayIndex(timeZone) {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone: timeZone || "America/Toronto",
      weekday: "short",
    }).format(new Date());
    return WEEKDAY_LABELS.indexOf(weekday);
  }

  function confidenceLabel(score) {
    const value = Number(score);
    if (!Number.isFinite(value)) return "Verified detail";
    if (value >= 0.9) return "Highly verified";
    if (value >= 0.75) return "Well sourced";
    return "Source-backed";
  }

  function sourceCountFor(detail) {
    return Number(detail?.sourceStatus?.sourceCount || detail?.sources?.length || 0);
  }

  function verifiedPhotos(detail = {}) {
    const photos = Array.isArray(detail.photos) ? detail.photos : [];
    const seen = new Set();
    return photos
      .map((photo) => ({
        url: cleanText(photo?.image_url || photo?.url),
        alt: cleanText(photo?.alt_text || photo?.caption),
        credit: cleanText(photo?.attribution || photo?.source_name),
        creditUrl: /^https?:\/\//i.test(cleanText(photo?.attribution_url))
          ? cleanText(photo.attribution_url)
          : "",
      }))
      .filter((photo) => /^https?:\/\//i.test(photo.url))
      .filter((photo) => {
        if (seen.has(photo.url)) return false;
        seen.add(photo.url);
        return true;
      })
      .slice(0, 8);
  }

  function isDetailReady(detail) {
    const place = detail?.place || {};
    return Boolean(
      cleanText(place.name) &&
        cleanText(place.formatted_address || place.address) &&
        sourceCountFor(detail) > 0 &&
        verifiedPhotos(detail).length > 0,
    );
  }

  function summaryFor(detail) {
    const place = detail.place || {};
    const profile = detail.profile || {};
    const sourceDescription = cleanText(place.metadata?.description || place.description);
    if (sourceDescription) return sourceDescription;
    if (profile.human_review_status === "approved") return cleanText(profile.summary);
    return "";
  }

  function compactHours(detail) {
    const place = detail.place || {};
    const dayIndex = currentDayIndex(place.timezone);
    const validRows = (Array.isArray(detail.hours) ? detail.hours : [])
      .map((row) => {
        const day = Number(row.day_of_week);
        if (!Number.isInteger(day) || day < 0 || day > 6) return null;
        if (row.is_closed) return { day, value: "Closed", active: day === dayIndex };
        const opens = formatTime(row.opens_at);
        const closes = formatTime(row.closes_at);
        if (!opens || !closes) return null;
        return {
          day,
          value: `${opens} - ${closes}`,
          active: day === dayIndex,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.day - b.day);

    const groups = [];
    for (const row of validRows) {
      const previous = groups.at(-1);
      if (previous && previous.end === row.day - 1 && previous.value === row.value) {
        previous.end = row.day;
        previous.active = previous.active || row.active;
      } else {
        groups.push({ ...row, end: row.day });
      }
    }
    return groups.map((group) => ({
      label:
        group.day === group.end
          ? WEEKDAY_LABELS[group.day]
          : `${WEEKDAY_LABELS[group.day]}-${WEEKDAY_LABELS[group.end]}`,
      value: group.value,
      active: group.active,
    }));
  }

  function openStatus(detail) {
    const place = detail.place || {};
    const today = currentDayIndex(place.timezone);
    const row = (Array.isArray(detail.hours) ? detail.hours : []).find(
      (item) => Number(item.day_of_week) === today,
    );
    if (!row) return "";
    if (row.is_closed) return "Closed today";
    const opens = parseMinutes(row.opens_at);
    const closes = parseMinutes(row.closes_at);
    if (opens === null || closes === null) return "";
    const now = new Date();
    const local = new Intl.DateTimeFormat("en-CA", {
      timeZone: place.timezone || "America/Toronto",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now);
    const parts = Object.fromEntries(local.map((part) => [part.type, part.value]));
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    const isOpen = closes > opens
      ? minutes >= opens && minutes < closes
      : minutes >= opens || minutes < closes;
    return isOpen ? `Open now · until ${formatTime(row.closes_at)}` : `Today · ${formatTime(row.opens_at)} - ${formatTime(row.closes_at)}`;
  }

  function mapsLinkFor(place) {
    const latitude = Number(place?.latitude);
    const longitude = Number(place?.longitude);
    const query = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? `${latitude},${longitude}`
      : [place?.name, place?.formatted_address || place?.address].filter(Boolean).join(" ");
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function renderUnavailablePlaceDetail(detail = {}) {
    const name = cleanText(detail?.place?.name, "This place");
    return `
      <section class="echoo-place-detail echoo-place-unavailable">
        <div class="echoo-place-unavailable-mark">E</div>
        <p class="echoo-place-eyebrow">Details in progress</p>
        <h2>${escapeHtml(name)} is not ready to feature yet.</h2>
        <p>Echoo only opens profiles with a real photo and source-backed place information.</p>
        <button type="button" class="echoo-place-btn-secondary" data-close-sheet>Back to Discover</button>
      </section>
    `;
  }

  function photoCreditMarkup(photo) {
    if (!photo?.credit) return "";
    const content = escapeHtml(photo.credit);
    const credit = photo.creditUrl
      ? `<a href="${escapeHtml(photo.creditUrl)}" target="_blank" rel="noopener">${content}</a>`
      : content;
    return `<p id="echoo-place-photo-credit" class="echoo-place-photo-credit">Photo: ${credit}</p>`;
  }

  function renderPlaceDetail(detail = {}, options = {}) {
    if (!isDetailReady(detail)) return renderUnavailablePlaceDetail(detail);

    const place = detail.place || {};
    const profile = detail.profile || {};
    const photos = verifiedPhotos(detail);
    const address = cleanText(place.formatted_address || place.address);
    const title = cleanText(place.name);
    const kicker = [cleanText(place.category), cleanText(place.municipality || place.city)]
      .filter(Boolean)
      .join(" · ");
    const summary = summaryFor(detail);
    const hours = compactHours(detail);
    const status = openStatus(detail);
    const sourceCount = sourceCountFor(detail);
    const sourceNames = [...new Set((detail.sources || []).map((source) => cleanText(source.source_name)).filter(Boolean))].slice(0, 2);
    const tags = profile.human_review_status === "approved"
      ? listFrom(profile.good_for).slice(0, 4)
      : [];
    const directionsHref = options.directionsHref || mapsLinkFor(place);
    const website = cleanText(place.website);

    setTimeout(bindGalleryInteractions, 0);

    return `
      <section class="echoo-place-detail">
        <div class="echoo-place-hero">
          <img id="echoo-place-main-hero-img" class="echoo-place-hero-image" src="${escapeHtml(photos[0].url)}" alt="${escapeHtml(photos[0].alt || title)}" loading="eager" decoding="async">
          <div class="echoo-place-hero-shade"></div>
          <button type="button" class="echoo-place-close" data-close-sheet aria-label="Close place details">Close</button>
          <div class="echoo-place-hero-copy">
            ${kicker ? `<p class="echoo-place-eyebrow">${escapeHtml(kicker)}</p>` : ""}
            <h1>${escapeHtml(title)}</h1>
          </div>
        </div>

        <div class="echoo-place-body">
          <div class="echoo-place-location-row">
            <span>${escapeHtml(address)}</span>
            ${status ? `<span class="echoo-place-open-status">${escapeHtml(status)}</span>` : ""}
          </div>

          ${summary ? `
            <section class="echoo-place-section">
              <p class="echoo-place-eyebrow">Overview</p>
              <p class="echoo-place-summary">${escapeHtml(summary)}</p>
            </section>
          ` : ""}

          ${photos.length > 1 ? `
            <section class="echoo-place-section echoo-place-photo-section">
              <div class="echoo-place-section-heading">
                <p class="echoo-place-eyebrow">Photo moments</p>
                <span>${photos.length} verified</span>
              </div>
              <div class="echoo-place-gallery" aria-label="Verified place photos">
                ${photos.map((photo, index) => `
                  <button class="echoo-place-gallery-item${index === 0 ? " active" : ""}" type="button" data-photo-src="${escapeHtml(photo.url)}" data-photo-alt="${escapeHtml(photo.alt || title)}" data-photo-credit="${escapeHtml(photo.credit)}" data-photo-credit-url="${escapeHtml(photo.creditUrl)}" aria-label="View photo ${index + 1}">
                    <img src="${escapeHtml(photo.url)}" alt="" loading="lazy" decoding="async">
                  </button>
                `).join("")}
              </div>
              ${photoCreditMarkup(photos[0])}
            </section>
          ` : ""}

          ${tags.length ? `
            <section class="echoo-place-section">
              <p class="echoo-place-eyebrow">Good for</p>
              <div class="echoo-place-tag-row">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
            </section>
          ` : ""}

          ${hours.length ? `
            <section class="echoo-place-section">
              <p class="echoo-place-eyebrow">Hours</p>
              <div class="echoo-place-hours-list">
                ${hours.map((row) => `
                  <div class="echoo-place-hours-row${row.active ? " active" : ""}">
                    <span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong>
                  </div>
                `).join("")}
              </div>
            </section>
          ` : ""}

          <div class="echoo-place-source-line">
            <span>${escapeHtml(confidenceLabel(detail.sourceStatus?.confidenceScore || profile.confidence_score))}</span>
            <span>${escapeHtml(`${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`)}</span>
            ${sourceNames.length ? `<span>${escapeHtml(sourceNames.join(" · "))}</span>` : ""}
          </div>

          <div class="echoo-place-actions">
            <a class="echoo-place-btn-primary" href="${escapeHtml(directionsHref)}" target="_blank" rel="noopener">Directions</a>
            ${website ? `<a class="echoo-place-btn-secondary" href="${escapeHtml(website)}" target="_blank" rel="noopener">Website</a>` : `<button type="button" class="echoo-place-btn-secondary" data-close-sheet>Close</button>`}
          </div>
        </div>
      </section>
    `;
  }

  function bindGalleryInteractions() {
    const mainImage = document.getElementById("echoo-place-main-hero-img");
    const items = document.querySelectorAll(".echoo-place-gallery-item");
    if (!mainImage || !items.length) return;
    items.forEach((item) => {
      item.onclick = () => {
        const src = item.getAttribute("data-photo-src");
        if (!src || mainImage.src === src) return;
        mainImage.style.opacity = "0.45";
        mainImage.src = src;
        mainImage.alt = item.getAttribute("data-photo-alt") || "Place photo";
        mainImage.onload = () => { mainImage.style.opacity = "1"; };
        const credit = document.getElementById("echoo-place-photo-credit");
        if (credit) {
          const text = item.getAttribute("data-photo-credit") || "";
          const url = item.getAttribute("data-photo-credit-url") || "";
          credit.replaceChildren("Photo: ");
          if (/^https?:\/\//i.test(url)) {
            const link = document.createElement("a");
            link.href = url;
            link.target = "_blank";
            link.rel = "noopener";
            link.textContent = text;
            credit.appendChild(link);
          } else {
            credit.append(text);
          }
        }
        items.forEach((candidate) => candidate.classList.toggle("active", candidate === item));
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
    let total = 0;
    for (const character of String(seed || "")) total += character.charCodeAt(0);
    return AUTH_CAPTIONS[total % AUTH_CAPTIONS.length];
  }

  function renderAuthPrompt(options = {}) {
    const title = cleanText(options.title, "Sign in to unlock this place");
    const note = cleanText(options.note, "We’ll bring you right back here after a quick sign-in.");
    const nextUrl = options.nextUrl || `${window.location.pathname.split("/").pop() || "index.html"}${window.location.search}${window.location.hash}`;
    const authHref = options.authHref || buildAuthUrl(nextUrl, options);
    return `
      <section class="echoo-place-detail echoo-place-unavailable">
        <div class="echoo-place-unavailable-mark">E</div>
        <p class="echoo-place-eyebrow">${escapeHtml(pickCaption(options.seed || title))}</p>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(note)}</p>
        <div class="echoo-place-actions">
          <a class="echoo-place-btn-primary" href="${escapeHtml(authHref)}">${escapeHtml(cleanText(options.primaryLabel, "Sign in"))}</a>
          <button type="button" class="echoo-place-btn-secondary" data-close-sheet>${escapeHtml(cleanText(options.secondaryLabel, "Keep browsing"))}</button>
        </div>
      </section>
    `;
  }

  window.EchooPlaceDetail = {
    buildAuthUrl,
    confidenceLabel,
    escapeHtml,
    isDetailReady,
    pickCaption,
    renderAuthPrompt,
    renderPlaceDetail,
    renderUnavailablePlaceDetail,
    verifiedPhotos,
  };
})();
