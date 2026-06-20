(function () {
  const SUPPORTED_CITIES = [
    { name: "Toronto", province: "ON", provinceName: "Ontario", timezone: "America/Toronto", coords: [43.6532, -79.3832] },
    { name: "Vancouver", province: "BC", provinceName: "British Columbia", timezone: "America/Vancouver", coords: [49.2827, -123.1207] },
    { name: "Montreal", province: "QC", provinceName: "Quebec", timezone: "America/Toronto", coords: [45.5017, -73.5673] },
    { name: "Calgary", province: "AB", provinceName: "Alberta", timezone: "America/Edmonton", coords: [51.0447, -114.0719] },
    { name: "Edmonton", province: "AB", provinceName: "Alberta", timezone: "America/Edmonton", coords: [53.5461, -113.4938] },
    { name: "Ottawa", province: "ON", provinceName: "Ontario", timezone: "America/Toronto", coords: [45.4215, -75.6972] },
    { name: "Winnipeg", province: "MB", provinceName: "Manitoba", timezone: "America/Winnipeg", coords: [49.8951, -97.1384] },
    { name: "Quebec City", province: "QC", provinceName: "Quebec", timezone: "America/Toronto", coords: [46.8139, -71.2080] },
    { name: "Halifax", province: "NS", provinceName: "Nova Scotia", timezone: "America/Halifax", coords: [44.6488, -63.5752] },
    { name: "Victoria", province: "BC", provinceName: "British Columbia", timezone: "America/Vancouver", coords: [48.4284, -123.3656] }
  ];

  const CANADA_BOUNDS = {
    minLat: 41.6,
    maxLat: 83.2,
    minLng: -141.1,
    maxLng: -52.5
  };

  function isInsideCanadaBounds(lat, lng) {
    return Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= CANADA_BOUNDS.minLat &&
      lat <= CANADA_BOUNDS.maxLat &&
      lng >= CANADA_BOUNDS.minLng &&
      lng <= CANADA_BOUNDS.maxLng;
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
    let closest = SUPPORTED_CITIES[0];
    let minDistance = Infinity;

    SUPPORTED_CITIES.forEach((city) => {
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
    return SUPPORTED_CITIES.find((city) => city.name.toLowerCase() === normalized) || null;
  }

  function resolveCoordinates(lat, lng) {
    if (!isInsideCanadaBounds(lat, lng)) {
      return {
        supported: false,
        reason: "outside_canada",
        message: "Echoo is launching location discovery in Canada first.",
        fallbackCity: SUPPORTED_CITIES[0]
      };
    }

    return {
      supported: true,
      city: nearestSupportedCity(lat, lng)
    };
  }

  window.EchooLocationPlatform = {
    CANADA_BOUNDS,
    SUPPORTED_CITIES,
    cityByName,
    distanceKm,
    isInsideCanadaBounds,
    nearestSupportedCity,
    resolveCoordinates
  };
})();
