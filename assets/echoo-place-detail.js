(function () {
  const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
    return String(value || fallback)
      .replace(/\s+/g, " ")
      .trim();
  }

  function isUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      cleanText(value),
    );
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

  function optionalNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function distanceKmFor(place = {}, options = {}) {
    const suppliedMeters = optionalNumber(options.distanceMeters);
    if (suppliedMeters !== null && suppliedMeters >= 0) {
      return suppliedMeters / 1000;
    }

    const location = window.EchooLocationPlatform?.readPreferences?.() || {};
    const userLatitude =
      optionalNumber(options.userLatitude) ?? optionalNumber(location.lastLat);
    const userLongitude =
      optionalNumber(options.userLongitude) ?? optionalNumber(location.lastLng);
    const placeLatitude = optionalNumber(place.latitude);
    const placeLongitude = optionalNumber(place.longitude);
    if (
      userLatitude === null ||
      userLongitude === null ||
      placeLatitude === null ||
      placeLongitude === null
    ) {
      return null;
    }

    const calculateDistance = window.EchooLocationPlatform?.distanceKm;
    if (typeof calculateDistance !== "function") return null;
    const distance = calculateDistance(
      userLatitude,
      userLongitude,
      placeLatitude,
      placeLongitude,
    );
    return Number.isFinite(distance) && distance >= 0 ? distance : null;
  }

  function distanceLabelFor(place, options) {
    const distance = distanceKmFor(place, options);
    if (distance === null) return "Location off";
    if (distance < 0.1) return "Nearby";
    return `${distance.toFixed(distance < 10 ? 1 : 0)} km away`;
  }

  const TORONTO_GREEN_P = [
    { carparkNumber: "52", name: "Green P Carpark 52", address: "40 Richmond St W", latitude: 43.6514, longitude: -79.3813, capacity: 245, facilityType: "underground", rateSummary: "$3.50 / 30 mins · Night Max $9" },
    { carparkNumber: "36", name: "Green P Carpark 36 (Nathan Phillips Sq)", address: "110 Queen St W", latitude: 43.6525, longitude: -79.3835, capacity: 2024, facilityType: "underground", rateSummary: "$3.50 / 30 mins · Night Max $9" },
    { carparkNumber: "68", name: "Green P Carpark 68", address: "111 Peter St", latitude: 43.6477, longitude: -79.3916, capacity: 184, facilityType: "garage", rateSummary: "$4.00 / 30 mins · Night Max $12" },
    { carparkNumber: "260", name: "Green P Carpark 260 (TIFF Lightbox)", address: "25 Mercer St", latitude: 43.6468, longitude: -79.3888, capacity: 110, facilityType: "underground", rateSummary: "$4.00 / 30 mins · Night Max $12" },
    { carparkNumber: "235", name: "Green P Carpark 235", address: "85 Mercer St", latitude: 43.6465, longitude: -79.3905, capacity: 140, facilityType: "underground", rateSummary: "$4.00 / 30 mins · Night Max $12" },
    { carparkNumber: "204", name: "Green P Carpark 204", address: "106 Spadina Ave", latitude: 43.6482, longitude: -79.3965, capacity: 95, facilityType: "surface", rateSummary: "$3.50 / 30 mins · Night Max $9" },
    { carparkNumber: "122", name: "Green P Carpark 122", address: "461 King St W", latitude: 43.6449, longitude: -79.3989, capacity: 155, facilityType: "surface", rateSummary: "$4.00 / 30 mins · Night Max $12" },
    { carparkNumber: "26", name: "Green P Carpark 26", address: "33 Soho St", latitude: 43.6508, longitude: -79.3941, capacity: 160, facilityType: "surface", rateSummary: "$3.00 / 30 mins · Night Max $8" },
    { carparkNumber: "59", name: "Green P Carpark 59 (OCAD / AGO)", address: "73 McCaul St", latitude: 43.6534, longitude: -79.3912, capacity: 210, facilityType: "underground", rateSummary: "$3.25 / 30 mins · Night Max $8" },
    { carparkNumber: "217", name: "Green P Carpark 217", address: "121 St. Patrick St", latitude: 43.6528, longitude: -79.3891, capacity: 130, facilityType: "surface", rateSummary: "$3.25 / 30 mins · Night Max $8.50" },
    { carparkNumber: "70", name: "Green P Carpark 70 (Opera House)", address: "360 University Ave", latitude: 43.6517, longitude: -79.3871, capacity: 280, facilityType: "underground", rateSummary: "$3.50 / 30 mins · Night Max $9" },
    { carparkNumber: "64", name: "Green P Carpark 64 (Union Station)", address: "31 A Station St", latitude: 43.6448, longitude: -79.3839, capacity: 640, facilityType: "garage", rateSummary: "$4.25 / 30 mins · Night Max $12" },
    { carparkNumber: "236", name: "Green P Carpark 236", address: "45 The Esplanade", latitude: 43.6471, longitude: -79.3752, capacity: 512, facilityType: "garage", rateSummary: "$3.75 / 30 mins · Night Max $10" },
    { carparkNumber: "43", name: "Green P Carpark 43 (St. Lawrence)", address: "2 Church St", latitude: 43.6487, longitude: -79.3736, capacity: 2011, facilityType: "garage", rateSummary: "$3.25 / 30 mins · Night Max $9" },
    { carparkNumber: "13", name: "Green P Carpark 13 (Yonge & Dundas)", address: "250 Victoria St", latitude: 43.656, longitude: -79.3792, capacity: 450, facilityType: "garage", rateSummary: "$3.50 / 30 mins · Night Max $10" },
    { carparkNumber: "215", name: "Green P Carpark 215", address: "34 Elm St", latitude: 43.6571, longitude: -79.3838, capacity: 175, facilityType: "surface", rateSummary: "$3.50 / 30 mins · Night Max $9" },
    { carparkNumber: "29", name: "Green P Carpark 29 (Kensington)", address: "20 St. Andrew St", latitude: 43.6542, longitude: -79.4005, capacity: 420, facilityType: "garage", rateSummary: "$2.75 / 30 mins · Night Max $7" },
    { carparkNumber: "221", name: "Green P Carpark 221", address: "15 Dennison Ave", latitude: 43.6526, longitude: -79.4035, capacity: 88, facilityType: "surface", rateSummary: "$2.50 / 30 mins · Night Max $6" },
    { carparkNumber: "130", name: "Green P Carpark 130 (Ossington)", address: "106 Ossington Ave", latitude: 43.6478, longitude: -79.4198, capacity: 72, facilityType: "surface", rateSummary: "$2.75 / 30 mins · Night Max $7" },
    { carparkNumber: "191", name: "Green P Carpark 191 (Bellwoods)", address: "164 Bellwoods Ave", latitude: 43.6504, longitude: -79.4128, capacity: 55, facilityType: "surface", rateSummary: "$2.50 / 30 mins · Night Max $6" },
    { carparkNumber: "144", name: "Green P Carpark 144 (West Queen West)", address: "1100 Queen St W", latitude: 43.6436, longitude: -79.4215, capacity: 64, facilityType: "surface", rateSummary: "$2.75 / 30 mins · Night Max $7" },
    { carparkNumber: "142", name: "Green P Carpark 142 (Parkdale)", address: "1325 Queen St W", latitude: 43.6397, longitude: -79.4352, capacity: 82, facilityType: "surface", rateSummary: "$2.25 / 30 mins · Night Max $5" },
    { carparkNumber: "256", name: "Green P Carpark 256 (Distillery)", address: "37 Parliament St", latitude: 43.6508, longitude: -79.3592, capacity: 350, facilityType: "surface", rateSummary: "$3.50 / 30 mins · Night Max $10" },
    { carparkNumber: "84", name: "Green P Carpark 84 (Corktown)", address: "512 King St E", latitude: 43.654, longitude: -79.3582, capacity: 90, facilityType: "surface", rateSummary: "$2.75 / 30 mins · Night Max $6" },
    { carparkNumber: "1", name: "Green P Carpark 1 (Yonge & Bloor)", address: "20 Charles St E", latitude: 43.6687, longitude: -79.3854, capacity: 480, facilityType: "garage", rateSummary: "$3.75 / 30 mins · Night Max $10" },
    { carparkNumber: "2", name: "Green P Carpark 2 (Yorkville)", address: "74 Yorkville Ave", latitude: 43.6706, longitude: -79.3907, capacity: 290, facilityType: "garage", rateSummary: "$4.25 / 30 mins · Night Max $12" },
    { carparkNumber: "65", name: "Green P Carpark 65 (ROM / Bloor)", address: "15 Bedford Rd", latitude: 43.6698, longitude: -79.3968, capacity: 250, facilityType: "garage", rateSummary: "$4.00 / 30 mins · Night Max $10" },
    { carparkNumber: "15", name: "Green P Carpark 15 (Wellesley)", address: "15 Wellesley St E", latitude: 43.6653, longitude: -79.3837, capacity: 312, facilityType: "underground", rateSummary: "$3.00 / 30 mins · Night Max $8" },
    { carparkNumber: "208", name: "Green P Carpark 208 (Annex)", address: "184 Harbord St", latitude: 43.6608, longitude: -79.4082, capacity: 65, facilityType: "surface", rateSummary: "$2.50 / 30 mins · Night Max $6" },
    { carparkNumber: "180", name: "Green P Carpark 180 (Harbourfront)", address: "100 Cooper St", latitude: 43.6432, longitude: -79.3734, capacity: 320, facilityType: "surface", rateSummary: "$4.00 / 30 mins · Night Max $14" },
    { carparkNumber: "200", name: "Green P Carpark 200 (Queens Quay)", address: "200 Queens Quay W", latitude: 43.6391, longitude: -79.3831, capacity: 410, facilityType: "underground", rateSummary: "$4.00 / 30 mins · Night Max $14" },
    { carparkNumber: "230", name: "Green P Carpark 230 (High Park)", address: "2196 Bloor St W", latitude: 43.6511, longitude: -79.4751, capacity: 120, facilityType: "surface", rateSummary: "$2.25 / 30 mins · Night Max $5" },
    { carparkNumber: "28", name: "Green P Carpark 28 (Humber Bay)", address: "15 Marine Parade Dr", latitude: 43.6264, longitude: -79.4795, capacity: 180, facilityType: "surface", rateSummary: "$2.00 / 30 mins · Night Max $5" },
    { carparkNumber: "111", name: "Green P Carpark 111 (Midtown)", address: "30 Alvin Ave", latitude: 43.6888, longitude: -79.3934, capacity: 140, facilityType: "garage", rateSummary: "$3.00 / 30 mins · Night Max $7" },
    { carparkNumber: "227", name: "Green P Carpark 227 (Wychwood)", address: "125 Burnside Dr", latitude: 43.6795, longitude: -79.423, capacity: 60, facilityType: "surface", rateSummary: "$2.00 / 30 mins · Night Max $5" },
  ];

  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c);
  }

  function resolveNearbyParking(detail = {}) {
    if (Array.isArray(detail?.parking) && detail.parking.length > 0) {
      return detail.parking;
    }
    const place = detail?.place || {};
    const lat = Number(place.latitude);
    const lng = Number(place.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

    const candidates = TORONTO_GREEN_P.map((item) => {
      const dist = haversineMeters(lat, lng, item.latitude, item.longitude);
      const walkMin = Math.max(1, Math.round(dist / 80));
      return {
        ...item,
        distanceMeters: dist,
        walkingMinutes: walkMin,
        googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${item.latitude},${item.longitude}`,
        appleMapsUrl: `https://maps.apple.com/?daddr=${item.latitude},${item.longitude}`,
      };
    })
      .filter((item) => item.distanceMeters <= 2000)
      .sort((a, b) => a.distanceMeters - b.distanceMeters);

    return candidates.slice(0, 3);
  }

  // Resolves the member's location once per page load when a place view opens
  // without a usable fix, then persists it through the session-scoped location
  // platform so every later distance renders instantly.
  let userLocationPromise = null;
  let lastRenderedPlace = null;

  function resolveUserLocation() {
    if (userLocationPromise) return userLocationPromise;
    userLocationPromise = new Promise((resolve) => {
      const geolocation =
        typeof navigator !== "undefined" &&
        navigator?.geolocation?.getCurrentPosition;
      if (!geolocation) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const latitude = optionalNumber(position?.coords?.latitude);
          const longitude = optionalNumber(position?.coords?.longitude);
          if (latitude === null || longitude === null) return resolve(null);
          try {
            window.EchooLocationPlatform?.writeLocationState?.({
              lastLat: latitude,
              lastLng: longitude,
              accuracy: position?.coords?.accuracy,
              locationPrecision: "gps",
            });
          } catch (_) {}
          resolve({ latitude, longitude });
        },
        () => resolve(null),
        { timeout: 10000, maximumAge: 60000, enableHighAccuracy: false },
      );
    });
    return userLocationPromise;
  }

  function refreshDistancePills() {
    if (typeof document === "undefined" || !lastRenderedPlace) return;
    try {
      const label = distanceLabelFor(lastRenderedPlace, {});
      document
        .querySelectorAll(".echoo-place-distance")
        .forEach((pill) => (pill.textContent = label));
    } catch (_) {}
  }

  function pulseItemsFor(detail) {
    const allowedLabels = new Set([
      "Now",
      "Today",
      "Tonight",
      "Setting",
      "Best for",
      "Good to know",
      "Access",
      "What to expect",
      "Cuisine",
      "Amenities",
    ]);
    const items = (
      Array.isArray(detail?.pulse?.items) ? detail.pulse.items : []
    )
      .map((item) => ({
        label: cleanText(item?.label),
        value: cleanText(item?.value),
        source: cleanText(item?.source),
      }))
      .filter(
        (item) => allowedLabels.has(item.label) && item.value && item.source,
      )
      .slice(0, 3);
    if (items.length) return items;

    // A preview or a temporarily unavailable detail response must not leave a
    // blank panel. This only describes the supplied place record; it does not
    // invent a recommendation or a live operational claim.
    const place = detail?.place || {};
    const category = cleanText(place.subcategory || place.category);
    const locality = cleanText(place.municipality || place.city);
    const address = cleanText(place.formatted_address || place.address);
    const setting =
      category && locality ? `${category} in ${locality}` : address || locality;
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
      cleanText(place.name) ||
      cleanText(place.formatted_address || place.address),
    );
  }

  function summaryFor(detail) {
    const place = detail.place || {};
    const profile = detail.profile || {};
    const sourceDescription = cleanText(
      place.metadata?.description || place.description,
    );
    if (sourceDescription) return sourceDescription;
    if (profile.human_review_status === "approved")
      return cleanText(profile.summary);
    return "";
  }

  function trustedHours(detail) {
    const now = Date.now();
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone: detail?.place?.timezone || "America/Toronto",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
        .formatToParts(new Date())
        .map((part) => [part.type, part.value]),
    );
    const dateKey = `${parts.year}-${parts.month}-${parts.day}`;
    return (Array.isArray(detail?.hours) ? detail.hours : []).filter((row) => {
      const updated = Date.parse(cleanText(row?.updated_at));
      const confidence = Number(row?.confidence_score);
      return (
        Boolean(cleanText(row?.source)) &&
        Number.isFinite(confidence) &&
        confidence >= 0.85 &&
        Number.isFinite(updated) &&
        updated <= now &&
        now - updated <= 1000 * 60 * 60 * 24 * 21 &&
        (!cleanText(row?.valid_from) || cleanText(row.valid_from) <= dateKey) &&
        (!cleanText(row?.valid_to) || cleanText(row.valid_to) >= dateKey)
      );
    });
  }

  function compactHours(detail) {
    const place = detail.place || {};
    const dayIndex = currentDayIndex(place.timezone);
    const validRows = trustedHours(detail)
      .map((row) => {
        const day = Number(row.day_of_week);
        if (!Number.isInteger(day) || day < 0 || day > 6) return null;
        if (row.is_closed)
          return { day, value: "Closed", active: day === dayIndex };
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

    // Keep the complete week. The previous weekday-only grouping silently
    // dropped Saturday and Sunday whenever weekday hours were available.
    const rowsToGroup = validRows;
    const groups = [];
    for (const row of rowsToGroup) {
      const previous = groups.at(-1);
      if (
        previous &&
        previous.end === row.day - 1 &&
        previous.value === row.value
      ) {
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
    const row = trustedHours(detail).find(
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
    const parts = Object.fromEntries(
      local.map((part) => [part.type, part.value]),
    );
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    const isOpen =
      closes > opens
        ? minutes >= opens && minutes < closes
        : minutes >= opens || minutes < closes;
    return isOpen
      ? `Open now · until ${formatTime(row.closes_at)}`
      : `Today · ${formatTime(row.opens_at)} - ${formatTime(row.closes_at)}`;
  }

  function todayHours(detail) {
    const place = detail.place || {};
    const today = currentDayIndex(place.timezone);
    const row = trustedHours(detail).find(
      (item) => Number(item.day_of_week) === today,
    );
    if (!row) return null;
    if (row.is_closed) return { status: "Closed today", value: "" };
    const opens = formatTime(row.opens_at);
    const closes = formatTime(row.closes_at);
    if (!opens || !closes) return null;
    const status = openStatus(detail);
    return {
      status: status.startsWith("Open now") ? "Open now" : "Today",
      value: `${opens} — ${closes}`,
    };
  }

  function mapsLinkFor(place) {
    const latitude = Number(place?.latitude);
    const longitude = Number(place?.longitude);
    const query =
      Number.isFinite(latitude) && Number.isFinite(longitude)
        ? `${latitude},${longitude}`
        : [place?.name, place?.formatted_address || place?.address]
            .filter(Boolean)
            .join(" ");
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

  function renderPlaceDetail(detail = {}, options = {}) {
    if (!isDetailReady(detail)) return renderUnavailablePlaceDetail(detail);

    const place = detail.place || {};
    const profile = detail.profile || {};
    const photos = verifiedPhotos(detail);
    const address = cleanText(place.formatted_address || place.address);
    const title = cleanText(place.name);
    const summary = summaryFor(detail);
    const hours = compactHours(detail);
    const today = todayHours(detail);
    const tags =
      profile.human_review_status === "approved"
        ? listFrom(profile.good_for).slice(0, 4)
        : [];
    const heroImage = heroImageFor(detail, options);
    const galleryPhotos = photos.filter((photo) => photo.url !== heroImage);
    lastRenderedPlace = place;
    const distanceLabel = distanceLabelFor(place, options);
    if (distanceLabel === "Location off") {
      resolveUserLocation().then(() => refreshDistancePills());
    }
    const directionsHref = options.directionsHref || mapsLinkFor(place);
    const routeLatitude = Number(place.latitude);
    const routeLongitude = Number(place.longitude);
    const canRouteInsideEchoo =
      Number.isFinite(routeLatitude) && Number.isFinite(routeLongitude);
    const placeTimeZone = cleanText(place.timezone, "America/Toronto");
    const uberHref = uberLinkFor(place);
    const pulseItems = pulseItemsFor(detail);
    const quickPlanMessage = `Make me a quick plan around ${title || "this place"}.`;
    const invitationPlaceId = cleanText(place.id || place.place_id);
    const parkingList = resolveNearbyParking(detail);
    const primaryParking = parkingList[0] || null;

    setTimeout(() => {
      bindGalleryInteractions();
      bindQuickPlanInteractions();
      bindRouteInteractions();
      bindStayInteractions();
      bindUberInteractions();
      bindParkingInteractions();
      bindInviteInteractions();
      bindCheckinInteractions();
    }, 0);

    return `
      <section class="echoo-place-detail">
        <div class="echoo-place-hero">
          ${
            heroImage
              ? `
            <img id="echoo-place-main-hero-img" class="echoo-place-hero-image" src="${escapeHtml(heroImage)}" alt="${escapeHtml(title)}" loading="eager" decoding="async">
          `
              : `
            <div class="echoo-place-hero-fallback" aria-hidden="true"></div>
          `
          }
           <div class="echoo-place-hero-shade"></div>
          <button
            type="button"
            class="echoo-place-invite-link"
            data-echoo-invite
            data-invite-target-id="${escapeHtml(invitationPlaceId)}"
            data-invite-title="${escapeHtml(title)}"
            data-invite-category="${escapeHtml(cleanText(place.category, "Place"))}"
            data-invite-address="${escapeHtml(address)}"
            data-invite-city="${escapeHtml(cleanText(place.municipality || place.city))}"
            data-invite-latitude="${escapeHtml(String(routeLatitude))}"
            data-invite-longitude="${escapeHtml(String(routeLongitude))}"
          >Invite someone <span aria-hidden="true">↗</span></button>
           <div class="echoo-place-hero-copy">
            <h1>${escapeHtml(title)}</h1>
            ${address ? `<p class="echoo-place-hero-address">${escapeHtml(address)}</p>` : ""}
          </div>
        </div>

        <div class="echoo-place-body">
          <p class="echoo-place-distance">${escapeHtml(distanceLabel)}</p>
          ${
            today
              ? `
            <section class="echoo-place-hours-summary" aria-label="Today's opening hours">
              <span class="echoo-place-hours-summary-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5"></circle><path d="M12 7.8v4.7l3.1 1.9"></path></svg></span>
              <span class="echoo-place-hours-summary-copy"><small>${escapeHtml(today.status)}</small><strong>${escapeHtml(today.value || "Closed")}</strong></span>
            </section>
          `
              : ""
          }
          ${
            pulseItems.length
              ? `
            <section class="echoo-place-section echoo-place-setting-section">
              <div class="echoo-place-setting-values">
                ${pulseItems
                  .map(
                    (fact) => `
                  <div class="echoo-place-setting-text">${escapeHtml(fact.value)}</div>
                `,
                  )
                  .join("")}
              </div>
            </section>
          `
              : ""
          }

          ${
            summary
              ? `
            <section class="echoo-place-section">
              <p class="echoo-place-eyebrow">Overview</p>
              <p class="echoo-place-summary">${escapeHtml(summary)}</p>
            </section>
          `
              : ""
          }

          ${
            galleryPhotos.length
              ? `
            <section class="echoo-place-section echoo-place-photo-section">
              <div class="echoo-place-section-heading">
                <p class="echoo-place-eyebrow">More photos</p>
                <span>${galleryPhotos.length} more</span>
              </div>
              <div class="echoo-place-gallery" aria-label="Verified place photos">
                ${galleryPhotos
                  .map(
                    (photo, index) => `
                  <button class="echoo-place-gallery-item" type="button" data-photo-src="${escapeHtml(photo.url)}" data-photo-alt="${escapeHtml(photo.alt || title)}" aria-label="View photo ${index + 1}">
                    <img src="${escapeHtml(photo.url)}" alt="" loading="lazy" decoding="async">
                  </button>
                `,
                  )
                  .join("")}
              </div>
            </section>
          `
              : ""
          }

          ${
            tags.length
              ? `
            <section class="echoo-place-section">
              <p class="echoo-place-eyebrow">Good for</p>
              <div class="echoo-place-tag-row">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
            </section>
          `
              : ""
          }

          ${
            hours.length
              ? `
            <section class="echoo-place-section">
              <p class="echoo-place-eyebrow">Hours</p>
              <div class="echoo-place-hours-list">
                ${hours
                  .map(
                    (row) => `
                  <div class="echoo-place-hours-row${row.active ? " active" : ""}">
                    <span>${escapeHtml(row.label)}</span><strong>${escapeHtml(row.value)}</strong>
                  </div>
                `,
                  )
                  .join("")}
              </div>
            </section>
          `
              : ""
          }

          ${
            uberHref
              ? `
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
          `
              : ""
          }

          ${
            primaryParking
              ? `
            <section class="echoo-place-section echoo-parking-section" aria-label="Nearby Parking">
              <div class="echoo-parking-header">
                <div class="echoo-parking-header-title">
                  <span class="echoo-parking-badge" aria-hidden="true">P</span>
                  <div>
                    <p class="echoo-place-eyebrow">Nearby Parking</p>
                    <span class="echoo-parking-provider">Toronto Green P</span>
                  </div>
                </div>
                <span class="echoo-parking-meta-tag">${escapeHtml(primaryParking.walkingMinutes)} min walk</span>
              </div>

              <div class="echoo-parking-card">
                <div class="echoo-parking-card-body">
                  <div class="echoo-parking-main-info">
                    <strong class="echoo-parking-name">${escapeHtml(primaryParking.name)}</strong>
                    <p class="echoo-parking-address">${escapeHtml(primaryParking.address)} · <span class="echoo-parking-dist">${escapeHtml(primaryParking.distanceMeters < 1000 ? `${primaryParking.distanceMeters} m` : `${(primaryParking.distanceMeters / 1000).toFixed(1)} km`)} away</span></p>
                  </div>
                  ${
                    primaryParking.rateSummary
                      ? `<div class="echoo-parking-rate-pill">${escapeHtml(primaryParking.rateSummary)}</div>`
                      : ""
                  }
                </div>

                <div class="echoo-parking-actions">
                  <button
                    type="button"
                    class="echoo-parking-btn"
                    data-parking-nav
                    data-parking-apple="${escapeHtml(primaryParking.appleMapsUrl)}"
                    data-parking-google="${escapeHtml(primaryParking.googleMapsUrl)}"
                    data-parking-lat="${escapeHtml(String(primaryParking.latitude))}"
                    data-parking-lng="${escapeHtml(String(primaryParking.longitude))}"
                    data-parking-name="${escapeHtml(primaryParking.name)}"
                    aria-label="Directions to ${escapeHtml(primaryParking.name)}"
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                    <span>Directions to Parking</span>
                  </button>
                </div>

                ${
                  parkingList.length > 1
                    ? `
                  <div class="echoo-parking-alternatives">
                    <span class="echoo-parking-alt-title">More spots nearby</span>
                    ${parkingList
                      .slice(1, 3)
                      .map(
                        (alt) => `
                      <div class="echoo-parking-alt-row">
                        <div class="echoo-parking-alt-info">
                          <span class="echoo-parking-alt-name">${escapeHtml(alt.name)}</span>
                          <span class="echoo-parking-alt-sub">${escapeHtml(alt.distanceMeters < 1000 ? `${alt.distanceMeters}m` : `${(alt.distanceMeters / 1000).toFixed(1)}km`)} · ${escapeHtml(alt.walkingMinutes)}m walk${alt.rateSummary ? ` · ${escapeHtml(alt.rateSummary.split("·")[0].trim())}` : ""}</span>
                        </div>
                        <a href="${escapeHtml(alt.appleMapsUrl)}" target="_blank" rel="noopener noreferrer" class="echoo-parking-alt-link">Map ↗</a>
                      </div>
                    `,
                      )
                      .join("")}
                  </div>
                `
                    : ""
                }
              </div>
            </section>
          `
              : ""
          }

          <div class="echoo-place-actions">
            ${
              canRouteInsideEchoo
                ? `
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
            `
                : `<button type="button" class="echoo-place-btn-primary" data-echoo-route data-route-fallback="${escapeHtml(directionsHref)}"><span>Directions</span><span aria-hidden="true">↗</span></button>`
            }
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
            <span class="echoo-linkup-host" data-echoo-linkup-host data-linkup-place-id="${escapeHtml(cleanText(place.id || place.place_id))}" data-linkup-place-name="${escapeHtml(title)}" data-linkup-lat="${escapeHtml(String(routeLatitude))}" data-linkup-lng="${escapeHtml(String(routeLongitude))}" aria-hidden="true"></span>
          </div>
          ${
            canRouteInsideEchoo
              ? `
            <button
              type="button"
              class="echoo-place-stay-trigger"
              data-live-stays
              data-stay-name="${escapeHtml(title)}"
              data-stay-latitude="${escapeHtml(String(routeLatitude))}"
              data-stay-longitude="${escapeHtml(String(routeLongitude))}"
              data-stay-timezone="${escapeHtml(placeTimeZone)}"
            ><span>Stay nearby</span><span>Real hotels close to this place <i aria-hidden="true">→</i></span></button>
          `
              : ""
          }
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
        mainImage.onload = () => {
          mainImage.style.opacity = "1";
        };
        items.forEach((candidate) =>
          candidate.classList.toggle("active", candidate === item),
        );
      };
    });
  }

  function bindQuickPlanInteractions() {
    document.querySelectorAll("[data-quick-plan-message]").forEach((button) => {
      button.onclick = async () => {
        const message = cleanText(
          button.getAttribute("data-quick-plan-message"),
        );
        if (!message) return;
        const latitude = Number(
          button.getAttribute("data-quick-plan-latitude"),
        );
        const longitude = Number(
          button.getAttribute("data-quick-plan-longitude"),
        );
        window.dispatchEvent(
          new CustomEvent("echoo:quick-plan", {
            detail: {
              message,
              anchor: {
                id: cleanText(button.getAttribute("data-quick-plan-place-id")),
                name: cleanText(
                  button.getAttribute("data-quick-plan-name"),
                  "This place",
                ),
                category: cleanText(
                  button.getAttribute("data-quick-plan-category"),
                ),
                subcategory: cleanText(
                  button.getAttribute("data-quick-plan-subcategory"),
                ),
                city: cleanText(button.getAttribute("data-quick-plan-city")),
                address: cleanText(
                  button.getAttribute("data-quick-plan-address"),
                ),
                latitude: Number.isFinite(latitude) ? latitude : null,
                longitude: Number.isFinite(longitude) ? longitude : null,
                timeZone: cleanText(
                  button.getAttribute("data-quick-plan-timezone"),
                  "America/Toronto",
                ),
                imageUrl: cleanText(
                  button.getAttribute("data-quick-plan-image"),
                ),
              },
            },
          }),
        );
      };
    });
  }

  function bindRouteInteractions() {
    document.querySelectorAll("[data-echoo-route]").forEach((button) => {
      button.onclick = async () => {
        const latitude = Number(button.getAttribute("data-route-latitude"));
        const longitude = Number(button.getAttribute("data-route-longitude"));
        const fallback = button.getAttribute("data-route-fallback") || "";
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          if (fallback) window.open(fallback, "_blank", "noopener,noreferrer");
          return;
        }

        const route = {
          id: cleanText(button.getAttribute("data-route-id")),
          googlePlaceId: cleanText(
            button.getAttribute("data-route-google-place-id"),
          ),
          name: cleanText(button.getAttribute("data-route-name"), "This place"),
          address: cleanText(button.getAttribute("data-route-address")),
          latitude,
          longitude,
          timeZone: cleanText(
            button.getAttribute("data-route-timezone"),
            "America/Toronto",
          ),
        };
        await window.EchooLiveStays?.maybePromptLateRoute(route);
        // Remember this destination so Link Up can silently check the user in
        // when they return to the app and are within proximity.
        window.EchooLinkUp?.rememberDirections?.({
          id: route.id,
          name: route.name,
        });
        if (window.ReactNativeWebView?.postMessage) {
          window.ReactNativeWebView.postMessage(
            `echoo:route:${JSON.stringify(route)}`,
          );
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
        window.dispatchEvent(
          new CustomEvent("echoo:live-stays", {
            detail: {
              anchor: {
                name: cleanText(
                  button.getAttribute("data-stay-name"),
                  "this place",
                ),
                latitude,
                longitude,
                timeZone: cleanText(
                  button.getAttribute("data-stay-timezone"),
                  "America/Toronto",
                ),
              },
            },
          }),
        );
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

  function bindInviteInteractions() {
    document.querySelectorAll("[data-echoo-invite]").forEach((button) => {
      button.onclick = () => {
        const category = cleanText(button.getAttribute("data-invite-category"));
        const city = cleanText(button.getAttribute("data-invite-city"));
        window.EchooInvite?.open({
          targetType: "place",
          targetId: cleanText(button.getAttribute("data-invite-target-id")),
          title: cleanText(
            button.getAttribute("data-invite-title"),
            "An Echoo place",
          ),
          meta: [category, city].filter(Boolean).join(" · "),
          image:
            document.getElementById("echoo-place-main-hero-img")?.src || "",
          snapshot: {
            title: cleanText(button.getAttribute("data-invite-title")),
            category: cleanText(button.getAttribute("data-invite-category")),
            address: cleanText(button.getAttribute("data-invite-address")),
            city: cleanText(button.getAttribute("data-invite-city")),
            latitude: Number(button.getAttribute("data-invite-latitude")),
            longitude: Number(button.getAttribute("data-invite-longitude")),
          },
        });
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
        name: cleanText(
          host.getAttribute("data-linkup-place-name"),
          "this place",
        ),
      };
      if (window.EchooLinkUp) {
        window.EchooLinkUp.setPlaceContext(place);
        document.dispatchEvent(
          new CustomEvent("echoo:place-detail:open", { detail: place }),
        );
      }
    });
  }

  function bindParkingInteractions() {
    document.querySelectorAll("[data-parking-nav]").forEach((button) => {
      button.onclick = () => {
        const apple = button.getAttribute("data-parking-apple");
        const google = button.getAttribute("data-parking-google");
        const isAppleDevice = /(Mac|iPhone|iPod|iPad)/i.test(
          navigator.userAgent || "",
        );
        const targetUrl = isAppleDevice ? apple || google : google || apple;
        if (targetUrl) {
          window.open(targetUrl, "_blank", "noopener,noreferrer");
        }
      };
    });
  }

  window.EchooPlaceDetail = {
    bindGalleryInteractions,
    bindQuickPlanInteractions,
    bindRouteInteractions,
    bindStayInteractions,
    bindUberInteractions,
    bindParkingInteractions,
    bindInviteInteractions,
    bindCheckinInteractions,
    escapeHtml,
    heroImageFor,
    isDetailReady,
    pulseItemsFor,
    renderPlaceDetail,
    renderUnavailablePlaceDetail,
    resolveNearbyParking,
    verifiedPhotos,
  };
})();
