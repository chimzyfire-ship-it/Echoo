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
  // Public Uber application identifier used only to identify Echoo in the
  // handoff link. It is not an access token or a private credential.
  const UBER_APPLICATION_ID = "Oao1ZwwzG4M-DV-nR1lr9go1DYjpfYHe";

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

  function confidenceLabel(score, sourceCount = 0) {
    const value = Number(score);
    if (sourceCount <= 0) return "Core profile";
    if (!Number.isFinite(value)) return "Source-backed";
    if (value >= 0.9) return "Highly verified";
    if (value >= 0.75) return "Well sourced";
    return "Source-backed";
  }

  function sourceCountFor(detail) {
    return Number(detail?.sourceStatus?.sourceCount || detail?.sources?.length || 0);
  }

  function pulseItemsFor(detail) {
    const allowedLabels = new Set([
      "Now", "Today", "Tonight", "Setting", "Best for", "Good to know", "Access", "What to expect", "Cuisine", "Amenities",
    ]);
    const items = (Array.isArray(detail?.pulse?.items) ? detail.pulse.items : [])
      .map((item) => ({
        label: cleanText(item?.label),
        value: cleanText(item?.value),
        source: cleanText(item?.source),
      }))
      .filter((item) => allowedLabels.has(item.label) && item.value && item.source)
      .slice(0, 3);
    if (items.length) return items;

    // A preview or a temporarily unavailable detail response must not leave a
    // blank panel. This only describes the supplied place record; it does not
    // invent a recommendation or a live operational claim.
    const place = detail?.place || {};
    const category = cleanText(place.subcategory || place.category);
    const locality = cleanText(place.municipality || place.city);
    const address = cleanText(place.formatted_address || place.address);
    const setting = category && locality ? `${category} in ${locality}` : address || locality;
    return setting
      ? [{ label: "Setting", value: setting, source: "Echoo place record" }]
      : [];
  }

  function heroImageFor(detail = {}, options = {}) {
    const place = detail.place || {};
    const candidate = cleanText(
      options.heroImage ||
        place.hero_image_url ||
        place.image_url ||
        place.imageUrl ||
        place.photo_url ||
        "",
    );
    if (candidate) return candidate;
    const photos = verifiedPhotos(detail);
    return photos[0]?.url || "";
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
      cleanText(place.name) || cleanText(place.formatted_address || place.address),
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

    const weekdayRows = validRows.filter((row) => row.day >= 1 && row.day <= 5);
    const rowsToGroup = weekdayRows.length ? weekdayRows : validRows;
    const groups = [];
    for (const row of rowsToGroup) {
      const previous = groups.at(-1);
      if (previous && previous.end === row.day - 1 && previous.value === row.value) {
        previous.end = row.day;
        previous.active = previous.active || row.active;
      } else {
        groups.push({ ...row, start: row.day, end: row.day });
      }
    }
    const selectedGroups = groups;
    return selectedGroups.map((group) => ({
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
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}&dir_action=navigate`;
  }

  function uberLinkFor(place) {
    const latitude = Number(place?.latitude);
    const longitude = Number(place?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return "";

    const name = cleanText(place?.name, "Destination");
    const address = cleanText(place?.formatted_address || place?.address, name);
    const dropoff = {
      latitude,
      longitude,
      addressLine1: name,
      addressLine2: address,
    };
    const query = new URLSearchParams({
      client_id: UBER_APPLICATION_ID,
      pickup: "my_location",
      "drop[0]": JSON.stringify(dropoff),
    });
    return `https://m.uber.com/looking?${query.toString()}`;
  }

  function renderUnavailablePlaceDetail(detail = {}) {
    const name = cleanText(detail?.place?.name, "This place");
    return `
      <section class="echoo-place-detail echoo-place-unavailable">
        <div class="echoo-place-unavailable-mark">E</div>
        <p class="echoo-place-eyebrow">Couldn’t load details</p>
        <h2>${escapeHtml(name)} could not load right now.</h2>
        <p>Try again in a moment. Echoo will keep the profile lean until it has something real to show.</p>
        <button type="button" class="echoo-place-btn-secondary" data-close-sheet>Back to Discover</button>
      </section>
    `;
  }

  function photoCreditMarkup(photo) {
    if (!photo) return "";
    const content = escapeHtml(photo.credit || "");
    const credit = photo.creditUrl
      ? `<a href="${escapeHtml(photo.creditUrl)}" target="_blank" rel="noopener">${content}</a>`
      : content;
    return `<p id="echoo-place-photo-credit" class="echoo-place-photo-credit"${photo.credit ? "" : " hidden"}>Photo: ${credit}</p>`;
  }

  function renderPlaceDetail(detail = {}, options = {}) {
    if (!isDetailReady(detail)) return renderUnavailablePlaceDetail(detail);

    const place = detail.place || {};
    const profile = detail.profile || {};
    const photos = verifiedPhotos(detail);
    const address = cleanText(place.formatted_address || place.address);
    const title = cleanText(place.name);
    const summary = summaryFor(detail);
    const hours = compactHours(detail);
    const sourceCount = sourceCountFor(detail);
    const sourceNames = [...new Set((detail.sources || []).map((source) => cleanText(source.source_name)).filter(Boolean))].slice(0, 2);
    const tags = profile.human_review_status === "approved"
      ? listFrom(profile.good_for).slice(0, 4)
      : [];
    const heroImage = heroImageFor(detail, options);
    const heroPhoto = photos.find((photo) => photo.url === heroImage) || null;
    const galleryPhotos = photos.filter((photo) => photo.url !== heroImage);
    const initialPhotoCredit = heroPhoto || galleryPhotos[0] || null;
    const directionsHref = options.directionsHref || mapsLinkFor(place);
    const routeLatitude = Number(place.latitude);
    const routeLongitude = Number(place.longitude);
    const canRouteInsideEchoo = Number.isFinite(routeLatitude) && Number.isFinite(routeLongitude);
    const placeTimeZone = cleanText(place.timezone, "America/Toronto");
    const uberHref = uberLinkFor(place);
    const pulseItems = pulseItemsFor(detail);
    const quickPlanMessage = `Make me a quick plan around ${title || "this place"}.`;

    setTimeout(() => {
      bindGalleryInteractions();
      bindQuickPlanInteractions();
      bindRouteInteractions();
      bindStayInteractions();
      bindUberInteractions();
      bindCheckinInteractions();
    }, 0);

    return `
      <section class="echoo-place-detail">
        <div class="echoo-place-hero">
          ${heroImage ? `
            <img id="echoo-place-main-hero-img" class="echoo-place-hero-image" src="${escapeHtml(heroImage)}" alt="${escapeHtml(title)}" loading="eager" decoding="async">
          ` : `
            <div class="echoo-place-hero-fallback" aria-hidden="true"></div>
          `}
          <div class="echoo-place-hero-shade"></div>
          <div class="echoo-place-hero-copy">
            <h1>${escapeHtml(title)}</h1>
            ${address ? `<p class="echoo-place-hero-address">${escapeHtml(address)}</p>` : ""}
          </div>
        </div>

        <div class="echoo-place-body">
          ${pulseItems.length ? `
            <section class="echoo-place-section echoo-place-setting-section">
              <div class="echoo-place-setting-values">
                ${pulseItems.map((fact) => `
                  <div class="echoo-place-setting-text">${escapeHtml(fact.value)}</div>
                `).join("")}
              </div>
            </section>
          ` : ""}

          ${summary ? `
            <section class="echoo-place-section">
              <p class="echoo-place-eyebrow">Overview</p>
              <p class="echoo-place-summary">${escapeHtml(summary)}</p>
            </section>
          ` : ""}

          ${galleryPhotos.length ? `
            <section class="echoo-place-section echoo-place-photo-section">
              <div class="echoo-place-section-heading">
                <p class="echoo-place-eyebrow">More photos</p>
                <span>${galleryPhotos.length} more</span>
              </div>
              <div class="echoo-place-gallery" aria-label="Verified place photos">
                ${galleryPhotos.map((photo, index) => `
                  <button class="echoo-place-gallery-item" type="button" data-photo-src="${escapeHtml(photo.url)}" data-photo-alt="${escapeHtml(photo.alt || title)}" data-photo-credit="${escapeHtml(photo.credit)}" data-photo-credit-url="${escapeHtml(photo.creditUrl)}" aria-label="View photo ${index + 1}">
                    <img src="${escapeHtml(photo.url)}" alt="" loading="lazy" decoding="async">
                  </button>
                `).join("")}
              </div>
              ${photoCreditMarkup(initialPhotoCredit)}
            </section>
          ` : heroPhoto ? photoCreditMarkup(heroPhoto) : ""}

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

          ${sourceCount > 0 || sourceNames.length ? `
            <div class="echoo-place-source-line">
              <span>${escapeHtml(confidenceLabel(detail.sourceStatus?.confidenceScore || profile.confidence_score, sourceCount))}</span>
              ${sourceCount > 0 ? `<span>${escapeHtml(`${sourceCount} ${sourceCount === 1 ? "source" : "sources"}`)}</span>` : ""}
              ${sourceNames.length ? `<span>${escapeHtml(sourceNames.join(" · "))}</span>` : ""}
            </div>
          ` : ""}

          ${uberHref ? `
            <section class="echoo-uber-card" aria-label="Ride with Uber">
              <span class="echoo-uber-car" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M5.2 10.1 6.5 6.7c.3-.8 1-1.3 1.9-1.3h7.2c.8 0 1.6.5 1.9 1.3l1.3 3.4c.7.4 1.2 1.2 1.2 2.1v4.1c0 .8-.6 1.4-1.4 1.4h-1.1c-.7 0-1.3-.5-1.4-1.2H7.9c-.1.7-.7 1.2-1.4 1.2H5.4c-.8 0-1.4-.6-1.4-1.4v-4.1c0-.9.5-1.7 1.2-2.1Zm2.2.1h9.2l-.9-2.5c-.1-.3-.4-.5-.8-.5H8.2c-.3 0-.6.2-.8.5l-1 2.5Zm.3 4.2a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2Zm8.6 0a1.1 1.1 0 1 0 0-2.2 1.1 1.1 0 0 0 0 2.2Z"/></svg></span>
              <div class="echoo-uber-card-copy">
                <p>Uber</p>
                <strong>Ride to ${escapeHtml(title || "this place")}</strong>
              </div>
              <button type="button" class="echoo-uber-button" data-echoo-uber-href="${escapeHtml(uberHref)}" aria-label="Open Uber for ${escapeHtml(title || "this place")}">
                <span>Open</span><svg aria-hidden="true" viewBox="0 0 16 16" focusable="false"><path d="M3 8h9M8.5 3.5 13 8l-4.5 4.5"/></svg>
              </button>
            </section>
          ` : ""}

          <div class="echoo-place-actions">
            ${canRouteInsideEchoo ? `
              <button
                type="button"
                class="echoo-place-btn-primary"
                data-echoo-route
                data-route-id="${escapeHtml(cleanText(place.id || place.place_id || place.google_place_id))}"
                data-route-google-place-id="${escapeHtml(cleanText(place.google_place_id))}"
                data-route-name="${escapeHtml(title)}"
                data-route-address="${escapeHtml(address)}"
                data-route-latitude="${escapeHtml(String(routeLatitude))}"
                data-route-longitude="${escapeHtml(String(routeLongitude))}"
                data-route-timezone="${escapeHtml(placeTimeZone)}"
                data-route-fallback="${escapeHtml(directionsHref)}"
              ><span>Directions</span><span aria-hidden="true">↗</span></button>
            ` : `<button type="button" class="echoo-place-btn-primary" data-echoo-route data-route-fallback="${escapeHtml(directionsHref)}"><span>Directions</span><span aria-hidden="true">↗</span></button>`}
            <button
              type="button"
              class="echoo-place-btn-secondary"
              data-quick-plan-message="${escapeHtml(quickPlanMessage)}"
              data-quick-plan-place-id="${escapeHtml(cleanText(place.id || place.place_id || place.google_place_id))}"
              data-quick-plan-name="${escapeHtml(title)}"
              data-quick-plan-category="${escapeHtml(cleanText(place.category))}"
              data-quick-plan-subcategory="${escapeHtml(cleanText(place.subcategory))}"
              data-quick-plan-city="${escapeHtml(cleanText(place.municipality || place.city))}"
              data-quick-plan-address="${escapeHtml(address)}"
              data-quick-plan-latitude="${escapeHtml(String(routeLatitude))}"
              data-quick-plan-longitude="${escapeHtml(String(routeLongitude))}"
              data-quick-plan-timezone="${escapeHtml(placeTimeZone)}"
              data-quick-plan-image="${escapeHtml(/^https?:\/\//i.test(heroImage) ? heroImage : "")}"
            ><span>Quick plan</span><span aria-hidden="true">→</span></button>
            <span class="echoo-linkup-host" data-echoo-linkup-host data-linkup-place-id="${escapeHtml(cleanText(place.id || place.place_id))}" data-linkup-place-name="${escapeHtml(title)}" aria-hidden="true"></span>
          </div>
          ${canRouteInsideEchoo ? `
            <button
              type="button"
              class="echoo-place-stay-trigger"
              data-live-stays
              data-stay-name="${escapeHtml(title)}"
              data-stay-latitude="${escapeHtml(String(routeLatitude))}"
              data-stay-longitude="${escapeHtml(String(routeLongitude))}"
              data-stay-timezone="${escapeHtml(placeTimeZone)}"
            ><span>Stay nearby</span><span>Real hotels close to this place <i aria-hidden="true">→</i></span></button>
          ` : ""}
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
          credit.hidden = !text;
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

  function bindQuickPlanInteractions() {
    document.querySelectorAll("[data-quick-plan-message]").forEach((button) => {
      button.onclick = async () => {
        if (!(await gateMemberAction("quick_plan", "quick_plan_required"))) return;
        const message = cleanText(button.getAttribute("data-quick-plan-message"));
        if (!message) return;
        const latitude = Number(button.getAttribute("data-quick-plan-latitude"));
        const longitude = Number(button.getAttribute("data-quick-plan-longitude"));
        window.dispatchEvent(new CustomEvent("echoo:quick-plan", {
          detail: {
            message,
            anchor: {
              id: cleanText(button.getAttribute("data-quick-plan-place-id")),
              name: cleanText(button.getAttribute("data-quick-plan-name"), "This place"),
              category: cleanText(button.getAttribute("data-quick-plan-category")),
              subcategory: cleanText(button.getAttribute("data-quick-plan-subcategory")),
              city: cleanText(button.getAttribute("data-quick-plan-city")),
              address: cleanText(button.getAttribute("data-quick-plan-address")),
              latitude: Number.isFinite(latitude) ? latitude : null,
              longitude: Number.isFinite(longitude) ? longitude : null,
              timeZone: cleanText(button.getAttribute("data-quick-plan-timezone"), "America/Toronto"),
              imageUrl: cleanText(button.getAttribute("data-quick-plan-image")),
            },
          },
        }));
      };
    });
  }

  function bindRouteInteractions() {
    document.querySelectorAll("[data-echoo-route]").forEach((button) => {
      button.onclick = async () => {
        if (!(await gateMemberAction("directions", "directions_required"))) return;
        const latitude = Number(button.getAttribute("data-route-latitude"));
        const longitude = Number(button.getAttribute("data-route-longitude"));
        const fallback = button.getAttribute("data-route-fallback") || "";
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          if (fallback) window.open(fallback, "_blank", "noopener,noreferrer");
          return;
        }

        const route = {
          id: cleanText(button.getAttribute("data-route-id")),
          googlePlaceId: cleanText(button.getAttribute("data-route-google-place-id")),
          name: cleanText(button.getAttribute("data-route-name"), "This place"),
          address: cleanText(button.getAttribute("data-route-address")),
          latitude,
          longitude,
          timeZone: cleanText(button.getAttribute("data-route-timezone"), "America/Toronto"),
        };
        await window.EchooLiveStays?.maybePromptLateRoute(route);
        if (window.ReactNativeWebView?.postMessage) {
          window.ReactNativeWebView.postMessage(`echoo:route:${JSON.stringify(route)}`);
          return;
        }
        if (fallback) window.open(fallback, "_blank", "noopener,noreferrer");
      };
    });
  }

  function bindStayInteractions() {
    document.querySelectorAll("[data-live-stays]").forEach((button) => {
      button.onclick = () => {
        const latitude = Number(button.getAttribute("data-stay-latitude"));
        const longitude = Number(button.getAttribute("data-stay-longitude"));
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        window.dispatchEvent(new CustomEvent("echoo:live-stays", {
          detail: {
            anchor: {
              name: cleanText(button.getAttribute("data-stay-name"), "this place"),
              latitude,
              longitude,
              timeZone: cleanText(button.getAttribute("data-stay-timezone"), "America/Toronto"),
            },
          },
        }));
      };
    });
  }

  function bindUberInteractions() {
    document.querySelectorAll("[data-echoo-uber-href]").forEach((button) => {
      button.onclick = () => {
        const href = button.getAttribute("data-echoo-uber-href");
        if (!href) return;
        // The native shell detects external URLs and hands this link to the
        // operating system, which lets Uber open when it is installed.
        window.location.assign(href);
      };
    });
  }

  // Link Up: surface the "I'm here" check-in affordance when a place detail
  // opens, and tell the EchooLinkUp module what place is in context. The host
  // element is rendered inert (aria-hidden) until the module fills it; the
  // feature flag is checked inside the module so nothing renders when off.
  function bindCheckinInteractions() {
    document.querySelectorAll("[data-echoo-linkup-host]").forEach((host) => {
      host.setAttribute("aria-hidden", "false");
      const place = {
        id: cleanText(host.getAttribute("data-linkup-place-id")),
        name: cleanText(host.getAttribute("data-linkup-place-name"), "this place"),
      };
      if (window.EchooLinkUp) {
        window.EchooLinkUp.setPlaceContext(place);
        document.dispatchEvent(new CustomEvent("echoo:place-detail:open", { detail: place }));
      }
    });
  }

  async function gateMemberAction(intent, reason) {
    const nextUrl = `${window.location.pathname.split("/").pop() || "events.html"}${window.location.search}${window.location.hash}`;
    if (window.EchooAuth?.requireAuthenticatedAction) {
      const state = await window.EchooAuth.requireAuthenticatedAction({
        next: nextUrl,
        mode: "signup",
        intent,
        reason,
        caption: "Create an account to make this part of your day yours.",
      });
      return state.ok;
    }
    window.location.href = buildAuthUrl(nextUrl, {
      mode: "signup",
      intent,
      reason,
      caption: "Create an account to make this part of your day yours.",
    });
    return false;
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
    bindGalleryInteractions,
    bindQuickPlanInteractions,
    bindRouteInteractions,
    bindStayInteractions,
    bindUberInteractions,
    bindCheckinInteractions,
    buildAuthUrl,
    confidenceLabel,
    escapeHtml,
    heroImageFor,
    isDetailReady,
    pickCaption,
    pulseItemsFor,
    renderAuthPrompt,
    renderPlaceDetail,
    renderUnavailablePlaceDetail,
    verifiedPhotos,
  };
})();
