(function () {
  const ONTARIO_REGION = {
    name: "Ontario",
    province: "ON",
    provinceName: "Ontario",
    timezone: "America/Toronto",
    coords: [44.0, -79.5],
    coverageLevel: "province",
  };

  const SUPPORTED_CITIES = [
    {
      name: "Toronto",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.6532, -79.3832],
    },
    {
      name: "Markham",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.8561, -79.337],
    },
    {
      name: "Scarborough",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.7764, -79.2318],
    },
    {
      name: "North York",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.7615, -79.4111],
    },
    {
      name: "Vaughan",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.8563, -79.5085],
    },
    {
      name: "Richmond Hill",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.8828, -79.4403],
    },
    {
      name: "Mississauga",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.589, -79.6441],
    },
    {
      name: "Brampton",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.7315, -79.7624],
    },
    {
      name: "Oakville",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.4675, -79.6877],
    },
    {
      name: "Burlington",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.3255, -79.799],
    },
    {
      name: "Hamilton",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.2557, -79.8711],
    },
    {
      name: "Vancouver",
      province: "BC",
      provinceName: "British Columbia",
      timezone: "America/Vancouver",
      coords: [49.2827, -123.1207],
    },
    {
      name: "Montreal",
      province: "QC",
      provinceName: "Quebec",
      timezone: "America/Toronto",
      coords: [45.5017, -73.5673],
    },
    {
      name: "Calgary",
      province: "AB",
      provinceName: "Alberta",
      timezone: "America/Edmonton",
      coords: [51.0447, -114.0719],
    },
    {
      name: "Edmonton",
      province: "AB",
      provinceName: "Alberta",
      timezone: "America/Edmonton",
      coords: [53.5461, -113.4938],
    },
    {
      name: "Ottawa",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [45.4215, -75.6972],
    },
    {
      name: "Waterloo",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.4643, -80.5204],
    },
    {
      name: "Kitchener",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.4516, -80.4925],
    },
    {
      name: "London",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [42.9849, -81.2453],
    },
    {
      name: "Niagara Falls",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.0896, -79.0849],
    },
    {
      name: "Kingston",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [44.2312, -76.486],
    },
    {
      name: "Guelph",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [43.5448, -80.2482],
    },
    {
      name: "Barrie",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [44.3894, -79.6903],
    },
    {
      name: "Windsor",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [42.3149, -83.0364],
    },
    {
      name: "Thunder Bay",
      province: "ON",
      provinceName: "Ontario",
      timezone: "America/Toronto",
      coords: [48.3809, -89.2477],
    },
    {
      name: "Winnipeg",
      province: "MB",
      provinceName: "Manitoba",
      timezone: "America/Winnipeg",
      coords: [49.8951, -97.1384],
    },
    {
      name: "Quebec City",
      province: "QC",
      provinceName: "Quebec",
      timezone: "America/Toronto",
      coords: [46.8139, -71.208],
    },
    {
      name: "Halifax",
      province: "NS",
      provinceName: "Nova Scotia",
      timezone: "America/Halifax",
      coords: [44.6488, -63.5752],
    },
    {
      name: "Victoria",
      province: "BC",
      provinceName: "British Columbia",
      timezone: "America/Vancouver",
      coords: [48.4284, -123.3656],
    },
  ];

  const ONTARIO_BOUNDS = {
    minLat: 41.64,
    maxLat: 56.9,
    minLng: -95.2,
    maxLng: -74.25,
  };

  const ONTARIO_GTA_BOUNDS = {
    minLat: 43.0,
    maxLat: 44.35,
    minLng: -80.55,
    maxLng: -78.75,
  };

  function isInsideOntarioBounds(lat, lng) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= ONTARIO_BOUNDS.minLat &&
      lat <= ONTARIO_BOUNDS.maxLat &&
      lng >= ONTARIO_BOUNDS.minLng &&
      lng <= ONTARIO_BOUNDS.maxLng
    );
  }

  function isInsideGtaBounds(lat, lng) {
    return (
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= ONTARIO_GTA_BOUNDS.minLat &&
      lat <= ONTARIO_GTA_BOUNDS.maxLat &&
      lng >= ONTARIO_GTA_BOUNDS.minLng &&
      lng <= ONTARIO_GTA_BOUNDS.maxLng
    );
  }

  function distanceKm(lat1, lng1, lat2, lng2) {
    const earthRadiusKm = 6371;
    const toRad = (value) => (value * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function nearestSupportedCity(lat, lng) {
    const ontarioCities = SUPPORTED_CITIES.filter(
      (city) => city.province === "ON",
    );
    let closest = ontarioCities[0] || SUPPORTED_CITIES[0];
    let minDistance = Infinity;

    ontarioCities.forEach((city) => {
      const distance = distanceKm(lat, lng, city.coords[0], city.coords[1]);
      if (distance < minDistance) {
        closest = city;
        minDistance = distance;
      }
    });

    return { ...closest, distanceKm: minDistance };
  }

  function cityByName(name) {
    if (!name) return null;
    const normalized = String(name).trim().toLowerCase();
    if (normalized === "ontario" || normalized === "on") {
      return ONTARIO_REGION;
    }
    return (
      SUPPORTED_CITIES.find((city) => city.name.toLowerCase() === normalized) ||
      null
    );
  }

  function resolveCoordinates(lat, lng) {
    if (!isInsideOntarioBounds(lat, lng)) {
      return {
        supported: false,
        reason: "outside_ontario",
        message: "Echoo is focused on Ontario and the GTA first.",
        fallbackCity: ONTARIO_REGION,
        fallbackRegion: ONTARIO_REGION,
      };
    }

    return {
      supported: true,
      region: ONTARIO_REGION,
      inGta: isInsideGtaBounds(lat, lng),
      city: nearestSupportedCity(lat, lng),
    };
  }

  function readPreferences() {
    try {
      return JSON.parse(localStorage.getItem("echoo_preferences") || "{}");
    } catch (error) {
      return {};
    }
  }

  function writeLocationState(state) {
    const prefs = readPreferences();
    const next = {
      ...prefs,
      ...state,
      locationCheckedAt: new Date().toISOString(),
    };
    localStorage.setItem("echoo_preferences", JSON.stringify(next));
    return next;
  }

  function isCanadaActive() {
    const prefs = readPreferences();
    return (
      prefs.countryCode === "CA" &&
      (prefs.adminArea1 === "ON" || prefs.city === "Ontario") &&
      prefs.locationSupported !== false
    );
  }

  window.EchooLocationPlatform = {
    ONTARIO_BOUNDS,
    ONTARIO_GTA_BOUNDS,
    ONTARIO_REGION,
    SUPPORTED_CITIES,
    cityByName,
    distanceKm,
    isInsideOntarioBounds,
    isInsideGtaBounds,
    nearestSupportedCity,
    readPreferences,
    resolveCoordinates,
    isCanadaActive,
    writeLocationState,
  };
})();
