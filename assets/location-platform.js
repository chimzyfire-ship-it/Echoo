(function () {
  "use strict";

  // Echoo launches across the 25 municipal search scopes of the Greater Toronto
  // Area. Keep this concise browser fallback in lock-step with the database
  // registry; the server boundary resolver remains authoritative for GPS.
  const GTA_REGION = {
    name: "Greater Toronto Area",
    province: "ON",
    provinceName: "Ontario",
    timezone: "America/Toronto",
    coords: [43.8561, -79.337],
    coverageLevel: "region",
    aliases: ["GTA", "Greater Toronto"],
  };

  const GTA_MUNICIPALITIES = [
    ["Toronto", 43.6532, -79.3832, "Toronto", ["Scarborough", "North York", "Etobicoke", "East York", "York", "Downtown Toronto"]],
    ["Ajax", 43.8509, -79.0204, "Durham"],
    ["Brock", 44.3045, -78.7276, "Durham"],
    ["Clarington", 43.9353, -78.608, "Durham"],
    ["Oshawa", 43.8971, -78.8658, "Durham"],
    ["Pickering", 43.8384, -79.0868, "Durham"],
    ["Scugog", 44.1116, -78.9445, "Durham"],
    ["Uxbridge", 44.1086, -79.1224, "Durham"],
    ["Whitby", 43.8975, -78.9429, "Durham"],
    ["Aurora", 44.0065, -79.4504, "York"],
    ["East Gwillimbury", 44.103, -79.447, "York"],
    ["Georgina", 44.303, -79.366, "York"],
    ["King", 43.997, -79.63, "York", ["King Township"]],
    ["Markham", 43.8561, -79.337, "York"],
    ["Newmarket", 44.0592, -79.4613, "York"],
    ["Richmond Hill", 43.8828, -79.4403, "York"],
    ["Vaughan", 43.8563, -79.5085, "York"],
    ["Whitchurch-Stouffville", 43.9708, -79.2444, "York", ["Stouffville", "Whitchurch Stouffville"]],
    ["Brampton", 43.7315, -79.7624, "Peel"],
    ["Caledon", 43.8769, -79.8654, "Peel"],
    ["Mississauga", 43.589, -79.6441, "Peel"],
    ["Burlington", 43.3255, -79.799, "Halton"],
    ["Halton Hills", 43.63, -79.95, "Halton"],
    ["Milton", 43.5183, -79.8774, "Halton"],
    ["Oakville", 43.4675, -79.6877, "Halton"],
  ].map(([name, lat, lng, regionalMunicipality, aliases = []]) => ({
    name,
    province: "ON",
    provinceName: "Ontario",
    timezone: "America/Toronto",
    coords: [lat, lng],
    regionalMunicipality,
    coverageLevel: "municipality",
    aliases,
  }));

  // This is only a quick browser preflight. The API uses official municipal
  // polygons before it labels a GPS origin with a municipality.
  const GTA_BOUNDS = { minLat: 43.24, maxLat: 44.37, minLng: -80.06, maxLng: -78.54 };
  const ACTIVE_LOCATION_KEY = "echoo_active_location";

  function isInsideGtaBounds(lat, lng) {
    return Number.isFinite(lat) && Number.isFinite(lng) &&
      lat >= GTA_BOUNDS.minLat && lat <= GTA_BOUNDS.maxLat &&
      lng >= GTA_BOUNDS.minLng && lng <= GTA_BOUNDS.maxLng;
  }

  function distanceKm(lat1, lng1, lat2, lng2) {
    const toRad = (value) => (value * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function nearestSupportedCity(lat, lng) {
    let closest = GTA_MUNICIPALITIES[0];
    let minDistance = Infinity;
    GTA_MUNICIPALITIES.forEach((city) => {
      const distance = distanceKm(lat, lng, city.coords[0], city.coords[1]);
      if (distance < minDistance) {
        closest = city;
        minDistance = distance;
      }
    });
    return { ...closest, distanceKm: minDistance, resolution: "approximate" };
  }

  function cityByName(name) {
    if (!name) return null;
    const normalized = String(name).trim().toLowerCase();
    if (["gta", "greater toronto", "greater toronto area"].includes(normalized)) {
      return GTA_REGION;
    }
    return GTA_MUNICIPALITIES.find((city) =>
      city.name.toLowerCase() === normalized ||
      city.aliases.some((alias) => alias.toLowerCase() === normalized),
    ) || null;
  }

  function resolveCoordinates(lat, lng) {
    if (!isInsideGtaBounds(lat, lng)) {
      return {
        supported: false,
        reason: "outside_gta",
        message: "Echoo is currently live across the Greater Toronto Area.",
        fallbackCity: GTA_REGION,
        fallbackRegion: GTA_REGION,
      };
    }
    return {
      supported: true,
      region: GTA_REGION,
      // The server replaces this provisional client match with a municipality
      // resolved from an official boundary polygon.
      city: nearestSupportedCity(lat, lng),
    };
  }

  function persistentPreferences() {
    try {
      return JSON.parse(localStorage.getItem("echoo_preferences") || "{}");
    } catch (_) {
      return {};
    }
  }

  function activeLocation() {
    try {
      const active = JSON.parse(sessionStorage.getItem(ACTIVE_LOCATION_KEY) || "{}");
      if (!active.locationCheckedAt) return {};
      // Do not revive a precise location after a tab has been left open all day.
      if (Date.now() - new Date(active.locationCheckedAt).getTime() > 30 * 60 * 1000) {
        sessionStorage.removeItem(ACTIVE_LOCATION_KEY);
        return {};
      }
      return active;
    } catch (_) {
      return {};
    }
  }

  function readPreferences() {
    return { ...persistentPreferences(), ...activeLocation() };
  }

  function writeLocationState(state) {
    const nextState = { ...state, locationCheckedAt: new Date().toISOString() };
    const persistent = { ...persistentPreferences(), ...nextState };
    const hasPreciseCoordinates = Number.isFinite(Number(nextState.lastLat)) &&
      Number.isFinite(Number(nextState.lastLng));

    // Exact GPS stays in session storage only. Existing persisted coordinates
    // are removed on the next location update.
    delete persistent.lastLat;
    delete persistent.lastLng;
    localStorage.setItem("echoo_preferences", JSON.stringify(persistent));

    if (hasPreciseCoordinates) {
      sessionStorage.setItem(ACTIVE_LOCATION_KEY, JSON.stringify({
        lastLat: Number(nextState.lastLat),
        lastLng: Number(nextState.lastLng),
        accuracy: Number(nextState.accuracy) || undefined,
        locationPrecision: nextState.locationPrecision || "gps",
        locationCheckedAt: nextState.locationCheckedAt,
      }));
    } else {
      sessionStorage.removeItem(ACTIVE_LOCATION_KEY);
    }
    return readPreferences();
  }

  function isCanadaActive() {
    const prefs = readPreferences();
    return prefs.countryCode === "CA" && prefs.locationSupported !== false;
  }

  window.EchooLocationPlatform = {
    GTA_BOUNDS,
    GTA_REGION,
    SUPPORTED_CITIES: GTA_MUNICIPALITIES,
    cityByName,
    distanceKm,
    isInsideGtaBounds,
    // Compatibility aliases for older call sites while their copy migrates.
    isInsideOntarioBounds: isInsideGtaBounds,
    nearestSupportedCity,
    readPreferences,
    resolveCoordinates,
    isCanadaActive,
    writeLocationState,
  };
})();
