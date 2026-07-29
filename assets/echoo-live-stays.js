(function () {
  const DEFAULT_RADIUS_METERS = 2500;
  const WIDER_RADIUS_METERS = 5000;
  const RESULT_CACHE_MS = 150000;
  const REQUEST_TIMEOUT_MS = 12000;
  let config = {};
  const resultCache = new Map();
  let sheetState = null;

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function safeUrl(value) {
    const candidate = String(value || "");
    return /^https:\/\//i.test(candidate) ? candidate : "";
  }

  function cleanText(value, fallback = "") {
    return String(value || fallback).replace(/\s+/g, " ").trim();
  }

  function safeTimeZone(value) {
    const candidate = cleanText(value, "America/Toronto");
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: candidate }).format();
      return candidate;
    } catch {
      return "America/Toronto";
    }
  }

  function isLateNight(timeZone) {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: safeTimeZone(timeZone),
        hour: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date()).map((part) => [part.type, part.value]),
    );
    const hour = Number(parts.hour);
    return Number.isFinite(hour) && (hour >= 22 || hour < 2);
  }

  function requestHeaders() {
    const headers = { "Content-Type": "application/json" };
    if (config.anonKey) {
      headers.Authorization = `Bearer ${config.anonKey}`;
      headers.apikey = config.anonKey;
    }
    return headers;
  }

  function normalizedAnchor(input = {}) {
    const latitude = Number(input.latitude);
    const longitude = Number(input.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude,
      longitude,
      destinationName: cleanText(input.destinationName || input.name, "this destination"),
      timeZone: safeTimeZone(input.timeZone || input.timezone),
    };
  }

  function cacheKey(anchor, radiusMeters) {
    return [
      anchor.latitude.toFixed(3),
      anchor.longitude.toFixed(3),
      Math.round(radiusMeters),
    ].join(":");
  }

  async function fetchStays(input = {}) {
    const anchor = normalizedAnchor(input);
    if (!anchor) throw new Error("A precise destination is required to find nearby stays.");
    if (!config.apiUrl) throw new Error("Live stay search has not been configured.");
    const radiusMeters = Math.min(
      Math.max(Number(input.radiusMeters) || DEFAULT_RADIUS_METERS, 250),
      WIDER_RADIUS_METERS,
    );
    const key = cacheKey(anchor, radiusMeters);
    const cached = resultCache.get(key);
    if (cached && Date.now() - cached.createdAt < RESULT_CACHE_MS) {
      return { ...cached.payload, destinationName: anchor.destinationName };
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(config.apiUrl, {
        method: "POST",
        headers: requestHeaders(),
        body: JSON.stringify({
          latitude: anchor.latitude,
          longitude: anchor.longitude,
          destinationName: anchor.destinationName,
          timeZone: anchor.timeZone,
          radiusMeters,
          limit: 3,
        }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Live stay search is unavailable right now.");
      const safePayload = {
        ...payload,
        stays: Array.isArray(payload?.stays) ? payload.stays : [],
      };
      resultCache.set(key, { createdAt: Date.now(), payload: safePayload });
      return safePayload;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("Live stay search took too long. Please try again.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function distanceLabel(distanceMeters) {
    const distance = Number(distanceMeters);
    if (!Number.isFinite(distance)) return "Nearby";
    if (distance < 1000) return `${Math.max(50, Math.round(distance / 50) * 50)} m away`;
    return `${(distance / 1000).toFixed(1)} km away`;
  }

  function ratingMarkup(stay) {
    const rating = Number(stay?.rating);
    if (!Number.isFinite(rating)) return "";
    const count = Number(stay?.ratingCount);
    const countLabel = Number.isFinite(count) && count > 0
      ? ` · ${new Intl.NumberFormat("en-CA", { notation: "compact" }).format(count)} reviews`
      : "";
    return `<span>${escapeHtml(rating.toFixed(1))} rating${escapeHtml(countLabel)}</span>`;
  }

  function cardMarkup(stay) {
    const imageUrl = safeUrl(stay?.imageUrl);
    const mapUrl = safeUrl(stay?.mapUrl);
    const photoCredit = cleanText(stay?.photoCredit);
    const photoCreditUrl = safeUrl(stay?.photoCreditUrl);
    const credit = photoCredit
      ? photoCreditUrl
        ? `<a href="${escapeHtml(photoCreditUrl)}" target="_blank" rel="noopener">${escapeHtml(photoCredit)}</a>`
        : escapeHtml(photoCredit)
      : "";
    return `
      <article class="echoo-live-stay-card">
        <div class="echoo-live-stay-image${imageUrl ? "" : " is-empty"}">
          ${imageUrl
            ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(cleanText(stay?.name, "Hotel"))}" loading="lazy" decoding="async">`
            : `<span aria-hidden="true">E</span>`}
          ${credit ? `<p class="echoo-live-stay-photo-credit">${credit}</p>` : ""}
        </div>
        <div class="echoo-live-stay-copy">
          <h3>${escapeHtml(cleanText(stay?.name, "Nearby stay"))}</h3>
          <p class="echoo-live-stay-meta">
            <span>${escapeHtml(distanceLabel(stay?.distanceMeters))}</span>
            ${ratingMarkup(stay)}
          </p>
          <p class="echoo-live-stay-reason">${escapeHtml(cleanText(stay?.reason, "Listed close to this destination."))}</p>
          ${mapUrl ? `<a class="echoo-live-stay-link" href="${escapeHtml(mapUrl)}" target="_blank" rel="noopener noreferrer">View hotel <span aria-hidden="true">↗</span></a>` : ""}
        </div>
      </article>
    `;
  }

  function loadingMarkup() {
    return `<div class="echoo-live-stay-loading" aria-live="polite"><span></span><span></span><span></span></div>`;
  }

  function emptyMarkup(radiusMeters) {
    return `<p class="echoo-live-stay-empty">No listed stays were found within ${(radiusMeters / 1000).toFixed(radiusMeters < 1000 ? 1 : 0)} km of this destination.</p>`;
  }

  function failureMarkup(message) {
    return `<p class="echoo-live-stay-empty">${escapeHtml(cleanText(message, "Live stays are unavailable right now."))}</p>`;
  }

  function resultMarkup(payload, radiusMeters) {
    const stays = Array.isArray(payload?.stays) ? payload.stays : [];
    return stays.length ? stays.map(cardMarkup).join("") : emptyMarkup(radiusMeters);
  }

  async function fillResults(root, anchor, options = {}) {
    const resultTarget = root.querySelector("[data-live-stays-results]");
    if (!resultTarget) return;
    const initialRadius = Number(options.radiusMeters) || DEFAULT_RADIUS_METERS;
    resultTarget.innerHTML = loadingMarkup();
    try {
      let payload = await fetchStays({ ...anchor, radiusMeters: initialRadius });
      let usedRadius = initialRadius;
      if (!payload.stays.length && initialRadius < WIDER_RADIUS_METERS) {
        payload = await fetchStays({ ...anchor, radiusMeters: WIDER_RADIUS_METERS });
        usedRadius = WIDER_RADIUS_METERS;
      }
      resultTarget.innerHTML = resultMarkup(payload, usedRadius);
      const source = root.querySelector("[data-live-stays-source]");
      if (source) source.hidden = !payload.stays.length;
    } catch (error) {
      resultTarget.innerHTML = failureMarkup(error?.message);
      const source = root.querySelector("[data-live-stays-source]");
      if (source) source.hidden = true;
    }
  }

  function inlineMarkup(anchor, options = {}) {
    const compactTitle = cleanText(options.title, "Stay nearby");
    const subtitle = cleanText(
      options.subtitle,
      `Live hotel matches near ${anchor.destinationName}.`,
    );
    return `
      <section class="echoo-live-stays" aria-label="Nearby stays">
        <div class="echoo-live-stays-heading">
          <div><p>Stay nearby</p><h2>${escapeHtml(compactTitle)}</h2></div>
          ${options.openSheet ? `<button type="button" class="echoo-live-stays-see-all" data-live-stays-open>See all</button>` : ""}
        </div>
        <p class="echoo-live-stays-subtitle">${escapeHtml(subtitle)}</p>
        <div class="echoo-live-stays-list" data-live-stays-results>${loadingMarkup()}</div>
        <p class="echoo-live-stays-source" data-live-stays-source hidden>Live place details from Google Maps</p>
      </section>
    `;
  }

  function renderInline(container, input = {}, options = {}) {
    if (!container) return;
    const anchor = normalizedAnchor(input);
    if (!anchor) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = inlineMarkup(anchor, options);
    container.querySelector("[data-live-stays-open]")?.addEventListener("click", () => openSheet(anchor));
    fillResults(container, anchor, options);
  }

  function ensureSheet() {
    let modal = document.getElementById("echoo-live-stays-modal");
    if (modal) return modal;
    modal = document.createElement("section");
    modal.id = "echoo-live-stays-modal";
    modal.className = "echoo-live-stay-modal";
    modal.setAttribute("aria-hidden", "true");
    modal.innerHTML = `
      <button class="echoo-live-stay-backdrop" type="button" aria-label="Close nearby stays"></button>
      <div class="echoo-live-stay-sheet" role="dialog" aria-modal="true" aria-labelledby="echoo-live-stay-sheet-title">
        <div class="echoo-live-stay-handle" aria-hidden="true"></div>
        <div data-live-stay-sheet-content></div>
      </div>
    `;
    document.body.appendChild(modal);
    modal.querySelector(".echoo-live-stay-backdrop").addEventListener("click", () => closeSheet());
    return modal;
  }

  function closeSheet() {
    const modal = document.getElementById("echoo-live-stays-modal");
    if (modal) modal.setAttribute("aria-hidden", "true");
    const resolve = sheetState?.resolve;
    sheetState = null;
    if (resolve) resolve(true);
  }

  function sheetMarkup(anchor, options = {}) {
    const late = Boolean(options.late);
    return `
      <div class="echoo-live-stay-sheet-topline">
        <p>${late ? "Late-night stay" : "Stay nearby"}</p>
        <button type="button" data-live-stay-close aria-label="Close nearby stays">×</button>
      </div>
      <div class="echoo-live-stay-sheet-heading">
        <h2 id="echoo-live-stay-sheet-title">${late ? "Keep a stay close" : "Real stays nearby"}</h2>
        <p>${late
          ? `Heading to ${anchor.destinationName}. These are real hotels close to your destination.`
          : `Live hotel matches near ${anchor.destinationName}.`}</p>
      </div>
      <div class="echoo-live-stays-list is-sheet" data-live-stays-results>${loadingMarkup()}</div>
      <p class="echoo-live-stays-source" data-live-stays-source hidden>Live place details from Google Maps</p>
      ${options.routePrompt ? `<button type="button" class="echoo-live-stay-continue" data-live-stay-continue>Continue to directions</button>` : ""}
    `;
  }

  function openSheet(input = {}, options = {}) {
    const anchor = normalizedAnchor(input);
    if (!anchor) return Promise.resolve(true);
    const modal = ensureSheet();
    const content = modal.querySelector("[data-live-stay-sheet-content]");
    if (!content) return Promise.resolve(true);
    if (sheetState?.resolve) sheetState.resolve(true);
    content.innerHTML = sheetMarkup(anchor, options);
    modal.setAttribute("aria-hidden", "false");
    content.querySelector("[data-live-stay-close]")?.addEventListener("click", closeSheet);
    content.querySelector("[data-live-stay-continue]")?.addEventListener("click", closeSheet);
    fillResults(content, anchor, options);
    return new Promise((resolve) => { sheetState = { resolve }; });
  }

  function maybePromptLateRoute(input = {}) {
    const anchor = normalizedAnchor(input);
    if (!anchor || !isLateNight(anchor.timeZone)) return Promise.resolve(true);
    return openSheet(anchor, { late: true, routePrompt: true });
  }

  function configure(nextConfig = {}) {
    config = { ...config, ...nextConfig };
  }

  window.addEventListener("echoo:live-stays", (event) => {
    openSheet(event.detail?.anchor || event.detail || {});
  });

  window.EchooLiveStays = {
    configure,
    fetchStays,
    isLateNight,
    maybePromptLateRoute,
    openSheet,
    renderInline,
  };
})();
