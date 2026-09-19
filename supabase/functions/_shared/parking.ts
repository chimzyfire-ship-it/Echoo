// ==============================================================================
// supabase/functions/_shared/parking.ts
// Free, robust Green P & municipal parking data and spatial resolver for Echoo
// ==============================================================================

export interface ParkingFacility {
  id: string;
  carparkNumber?: string;
  name: string;
  operator: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  walkingMinutes: number;
  capacity?: number;
  facilityType: "surface" | "garage" | "underground" | "structure";
  rateSummary?: string;
  rateHalfHour?: number;
  dayMax?: number;
  nightMax?: number;
  paymentMethods: string[];
  googleMapsUrl: string;
  appleMapsUrl: string;
}

export interface SeedParkingFacility {
  id: string;
  carparkNumber: string;
  name: string;
  operator: string;
  address: string;
  city: string;
  latitude: number;
  longitude: number;
  capacity: number;
  facilityType: "surface" | "garage" | "underground" | "structure";
  rateSummary: string;
  rateHalfHour: number;
  dayMax: number;
  nightMax: number;
  paymentMethods: string[];
}

export const TORONTO_GREEN_P_FACILITIES: SeedParkingFacility[] = [
  {
    id: "gp-52",
    carparkNumber: "52",
    name: "Green P Carpark 52",
    operator: "Green P",
    address: "40 Richmond St W",
    city: "Toronto",
    latitude: 43.6514,
    longitude: -79.3813,
    capacity: 245,
    facilityType: "underground",
    rateSummary: "$3.50 / 30 mins",
    rateHalfHour: 3.5,
    dayMax: 18.0,
    nightMax: 9.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-36",
    carparkNumber: "36",
    name: "Green P Carpark 36 (Nathan Phillips Sq)",
    operator: "Green P",
    address: "110 Queen St W",
    city: "Toronto",
    latitude: 43.6525,
    longitude: -79.3835,
    capacity: 2024,
    facilityType: "underground",
    rateSummary: "$3.50 / 30 mins",
    rateHalfHour: 3.5,
    dayMax: 20.0,
    nightMax: 9.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-68",
    carparkNumber: "68",
    name: "Green P Carpark 68",
    operator: "Green P",
    address: "111 Peter St",
    city: "Toronto",
    latitude: 43.6477,
    longitude: -79.3916,
    capacity: 184,
    facilityType: "garage",
    rateSummary: "$4.00 / 30 mins",
    rateHalfHour: 4.0,
    dayMax: 22.0,
    nightMax: 12.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-260",
    carparkNumber: "260",
    name: "Green P Carpark 260 (TIFF Lightbox)",
    operator: "Green P",
    address: "25 Mercer St",
    city: "Toronto",
    latitude: 43.6468,
    longitude: -79.3888,
    capacity: 110,
    facilityType: "underground",
    rateSummary: "$4.00 / 30 mins",
    rateHalfHour: 4.0,
    dayMax: 24.0,
    nightMax: 12.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-235",
    carparkNumber: "235",
    name: "Green P Carpark 235",
    operator: "Green P",
    address: "85 Mercer St",
    city: "Toronto",
    latitude: 43.6465,
    longitude: -79.3905,
    capacity: 140,
    facilityType: "underground",
    rateSummary: "$4.00 / 30 mins",
    rateHalfHour: 4.0,
    dayMax: 24.0,
    nightMax: 12.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-204",
    carparkNumber: "204",
    name: "Green P Carpark 204",
    operator: "Green P",
    address: "106 Spadina Ave",
    city: "Toronto",
    latitude: 43.6482,
    longitude: -79.3965,
    capacity: 95,
    facilityType: "surface",
    rateSummary: "$3.50 / 30 mins",
    rateHalfHour: 3.5,
    dayMax: 18.0,
    nightMax: 9.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-122",
    carparkNumber: "122",
    name: "Green P Carpark 122",
    operator: "Green P",
    address: "461 King St W",
    city: "Toronto",
    latitude: 43.6449,
    longitude: -79.3989,
    capacity: 155,
    facilityType: "surface",
    rateSummary: "$4.00 / 30 mins",
    rateHalfHour: 4.0,
    dayMax: 24.0,
    nightMax: 12.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-26",
    carparkNumber: "26",
    name: "Green P Carpark 26",
    operator: "Green P",
    address: "33 Soho St",
    city: "Toronto",
    latitude: 43.6508,
    longitude: -79.3941,
    capacity: 160,
    facilityType: "surface",
    rateSummary: "$3.00 / 30 mins",
    rateHalfHour: 3.0,
    dayMax: 16.0,
    nightMax: 8.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-59",
    carparkNumber: "59",
    name: "Green P Carpark 59 (OCAD / AGO)",
    operator: "Green P",
    address: "73 McCaul St",
    city: "Toronto",
    latitude: 43.6534,
    longitude: -79.3912,
    capacity: 210,
    facilityType: "underground",
    rateSummary: "$3.25 / 30 mins",
    rateHalfHour: 3.25,
    dayMax: 16.0,
    nightMax: 8.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-217",
    carparkNumber: "217",
    name: "Green P Carpark 217",
    operator: "Green P",
    address: "121 St. Patrick St",
    city: "Toronto",
    latitude: 43.6528,
    longitude: -79.3891,
    capacity: 130,
    facilityType: "surface",
    rateSummary: "$3.25 / 30 mins",
    rateHalfHour: 3.25,
    dayMax: 17.0,
    nightMax: 8.5,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-70",
    carparkNumber: "70",
    name: "Green P Carpark 70 (Opera House)",
    operator: "Green P",
    address: "360 University Ave",
    city: "Toronto",
    latitude: 43.6517,
    longitude: -79.3871,
    capacity: 280,
    facilityType: "underground",
    rateSummary: "$3.50 / 30 mins",
    rateHalfHour: 3.5,
    dayMax: 18.0,
    nightMax: 9.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-64",
    carparkNumber: "64",
    name: "Green P Carpark 64 (Union Station)",
    operator: "Green P",
    address: "31 A Station St",
    city: "Toronto",
    latitude: 43.6448,
    longitude: -79.3839,
    capacity: 640,
    facilityType: "garage",
    rateSummary: "$4.25 / 30 mins",
    rateHalfHour: 4.25,
    dayMax: 25.0,
    nightMax: 12.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-236",
    carparkNumber: "236",
    name: "Green P Carpark 236",
    operator: "Green P",
    address: "45 The Esplanade",
    city: "Toronto",
    latitude: 43.6471,
    longitude: -79.3752,
    capacity: 512,
    facilityType: "garage",
    rateSummary: "$3.75 / 30 mins",
    rateHalfHour: 3.75,
    dayMax: 20.0,
    nightMax: 10.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-43",
    carparkNumber: "43",
    name: "Green P Carpark 43 (St. Lawrence)",
    operator: "Green P",
    address: "2 Church St",
    city: "Toronto",
    latitude: 43.6487,
    longitude: -79.3736,
    capacity: 2011,
    facilityType: "garage",
    rateSummary: "$3.25 / 30 mins",
    rateHalfHour: 3.25,
    dayMax: 18.0,
    nightMax: 9.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-13",
    carparkNumber: "13",
    name: "Green P Carpark 13 (Yonge & Dundas)",
    operator: "Green P",
    address: "250 Victoria St",
    city: "Toronto",
    latitude: 43.656,
    longitude: -79.3792,
    capacity: 450,
    facilityType: "garage",
    rateSummary: "$3.50 / 30 mins",
    rateHalfHour: 3.5,
    dayMax: 20.0,
    nightMax: 10.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-215",
    carparkNumber: "215",
    name: "Green P Carpark 215",
    operator: "Green P",
    address: "34 Elm St",
    city: "Toronto",
    latitude: 43.6571,
    longitude: -79.3838,
    capacity: 175,
    facilityType: "surface",
    rateSummary: "$3.50 / 30 mins",
    rateHalfHour: 3.5,
    dayMax: 18.0,
    nightMax: 9.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-29",
    carparkNumber: "29",
    name: "Green P Carpark 29 (Kensington)",
    operator: "Green P",
    address: "20 St. Andrew St",
    city: "Toronto",
    latitude: 43.6542,
    longitude: -79.4005,
    capacity: 420,
    facilityType: "garage",
    rateSummary: "$2.75 / 30 mins",
    rateHalfHour: 2.75,
    dayMax: 14.0,
    nightMax: 7.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-221",
    carparkNumber: "221",
    name: "Green P Carpark 221",
    operator: "Green P",
    address: "15 Dennison Ave",
    city: "Toronto",
    latitude: 43.6526,
    longitude: -79.4035,
    capacity: 88,
    facilityType: "surface",
    rateSummary: "$2.50 / 30 mins",
    rateHalfHour: 2.5,
    dayMax: 12.0,
    nightMax: 6.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-130",
    carparkNumber: "130",
    name: "Green P Carpark 130 (Ossington)",
    operator: "Green P",
    address: "106 Ossington Ave",
    city: "Toronto",
    latitude: 43.6478,
    longitude: -79.4198,
    capacity: 72,
    facilityType: "surface",
    rateSummary: "$2.75 / 30 mins",
    rateHalfHour: 2.75,
    dayMax: 14.0,
    nightMax: 7.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-191",
    carparkNumber: "191",
    name: "Green P Carpark 191 (Bellwoods)",
    operator: "Green P",
    address: "164 Bellwoods Ave",
    city: "Toronto",
    latitude: 43.6504,
    longitude: -79.4128,
    capacity: 55,
    facilityType: "surface",
    rateSummary: "$2.50 / 30 mins",
    rateHalfHour: 2.5,
    dayMax: 12.0,
    nightMax: 6.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-144",
    carparkNumber: "144",
    name: "Green P Carpark 144 (West Queen West)",
    operator: "Green P",
    address: "1100 Queen St W",
    city: "Toronto",
    latitude: 43.6436,
    longitude: -79.4215,
    capacity: 64,
    facilityType: "surface",
    rateSummary: "$2.75 / 30 mins",
    rateHalfHour: 2.75,
    dayMax: 14.0,
    nightMax: 7.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-142",
    carparkNumber: "142",
    name: "Green P Carpark 142 (Parkdale)",
    operator: "Green P",
    address: "1325 Queen St W",
    city: "Toronto",
    latitude: 43.6397,
    longitude: -79.4352,
    capacity: 82,
    facilityType: "surface",
    rateSummary: "$2.25 / 30 mins",
    rateHalfHour: 2.25,
    dayMax: 10.0,
    nightMax: 5.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-256",
    carparkNumber: "256",
    name: "Green P Carpark 256 (Distillery)",
    operator: "Green P",
    address: "37 Parliament St",
    city: "Toronto",
    latitude: 43.6508,
    longitude: -79.3592,
    capacity: 350,
    facilityType: "surface",
    rateSummary: "$3.50 / 30 mins",
    rateHalfHour: 3.5,
    dayMax: 18.0,
    nightMax: 10.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-84",
    carparkNumber: "84",
    name: "Green P Carpark 84 (Corktown)",
    operator: "Green P",
    address: "512 King St E",
    city: "Toronto",
    latitude: 43.654,
    longitude: -79.3582,
    capacity: 90,
    facilityType: "surface",
    rateSummary: "$2.75 / 30 mins",
    rateHalfHour: 2.75,
    dayMax: 12.0,
    nightMax: 6.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-1",
    carparkNumber: "1",
    name: "Green P Carpark 1 (Yonge & Bloor)",
    operator: "Green P",
    address: "20 Charles St E",
    city: "Toronto",
    latitude: 43.6687,
    longitude: -79.3854,
    capacity: 480,
    facilityType: "garage",
    rateSummary: "$3.75 / 30 mins",
    rateHalfHour: 3.75,
    dayMax: 20.0,
    nightMax: 10.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-2",
    carparkNumber: "2",
    name: "Green P Carpark 2 (Yorkville)",
    operator: "Green P",
    address: "74 Yorkville Ave",
    city: "Toronto",
    latitude: 43.6706,
    longitude: -79.3907,
    capacity: 290,
    facilityType: "garage",
    rateSummary: "$4.25 / 30 mins",
    rateHalfHour: 4.25,
    dayMax: 24.0,
    nightMax: 12.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-65",
    carparkNumber: "65",
    name: "Green P Carpark 65 (ROM / Bloor)",
    operator: "Green P",
    address: "15 Bedford Rd",
    city: "Toronto",
    latitude: 43.6698,
    longitude: -79.3968,
    capacity: 250,
    facilityType: "garage",
    rateSummary: "$4.00 / 30 mins",
    rateHalfHour: 4.0,
    dayMax: 22.0,
    nightMax: 10.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-15",
    carparkNumber: "15",
    name: "Green P Carpark 15 (Wellesley)",
    operator: "Green P",
    address: "15 Wellesley St E",
    city: "Toronto",
    latitude: 43.6653,
    longitude: -79.3837,
    capacity: 312,
    facilityType: "underground",
    rateSummary: "$3.00 / 30 mins",
    rateHalfHour: 3.0,
    dayMax: 16.0,
    nightMax: 8.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-208",
    carparkNumber: "208",
    name: "Green P Carpark 208 (Annex)",
    operator: "Green P",
    address: "184 Harbord St",
    city: "Toronto",
    latitude: 43.6608,
    longitude: -79.4082,
    capacity: 65,
    facilityType: "surface",
    rateSummary: "$2.50 / 30 mins",
    rateHalfHour: 2.5,
    dayMax: 12.0,
    nightMax: 6.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-180",
    carparkNumber: "180",
    name: "Green P Carpark 180 (Harbourfront)",
    operator: "Green P",
    address: "100 Cooper St",
    city: "Toronto",
    latitude: 43.6432,
    longitude: -79.3734,
    capacity: 320,
    facilityType: "surface",
    rateSummary: "$4.00 / 30 mins",
    rateHalfHour: 4.0,
    dayMax: 25.0,
    nightMax: 14.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-200",
    carparkNumber: "200",
    name: "Green P Carpark 200 (Queens Quay)",
    operator: "Green P",
    address: "200 Queens Quay W",
    city: "Toronto",
    latitude: 43.6391,
    longitude: -79.3831,
    capacity: 410,
    facilityType: "underground",
    rateSummary: "$4.00 / 30 mins",
    rateHalfHour: 4.0,
    dayMax: 25.0,
    nightMax: 14.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-230",
    carparkNumber: "230",
    name: "Green P Carpark 230 (High Park)",
    operator: "Green P",
    address: "2196 Bloor St W",
    city: "Toronto",
    latitude: 43.6511,
    longitude: -79.4751,
    capacity: 120,
    facilityType: "surface",
    rateSummary: "$2.25 / 30 mins",
    rateHalfHour: 2.25,
    dayMax: 11.0,
    nightMax: 5.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-28",
    carparkNumber: "28",
    name: "Green P Carpark 28 (Humber Bay)",
    operator: "Green P",
    address: "15 Marine Parade Dr",
    city: "Toronto",
    latitude: 43.6264,
    longitude: -79.4795,
    capacity: 180,
    facilityType: "surface",
    rateSummary: "$2.00 / 30 mins",
    rateHalfHour: 2.0,
    dayMax: 10.0,
    nightMax: 5.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-111",
    carparkNumber: "111",
    name: "Green P Carpark 111 (Midtown)",
    operator: "Green P",
    address: "30 Alvin Ave",
    city: "Toronto",
    latitude: 43.6888,
    longitude: -79.3934,
    capacity: 140,
    facilityType: "garage",
    rateSummary: "$3.00 / 30 mins",
    rateHalfHour: 3.0,
    dayMax: 15.0,
    nightMax: 7.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
  {
    id: "gp-227",
    carparkNumber: "227",
    name: "Green P Carpark 227 (Wychwood)",
    operator: "Green P",
    address: "125 Burnside Dr",
    city: "Toronto",
    latitude: 43.6795,
    longitude: -79.423,
    capacity: 60,
    facilityType: "surface",
    rateSummary: "$2.00 / 30 mins",
    rateHalfHour: 2.0,
    dayMax: 9.0,
    nightMax: 5.0,
    paymentMethods: ["Green P App", "Credit Card", "Mobile Pay"],
  },
];

export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000; // Earth radius in meters
  const toRad = (deg: number) => (deg * Math.PI) / 180;
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

export function walkingMinutes(distanceMeters: number): number {
  // Average human walking speed ~ 80 meters per minute (4.8 km/h)
  return Math.max(1, Math.round(distanceMeters / 80));
}

export function buildNavigationUrls(lat: number, lng: number): {
  googleMapsUrl: string;
  appleMapsUrl: string;
} {
  return {
    googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`,
    appleMapsUrl: `https://maps.apple.com/?daddr=${lat},${lng}`,
  };
}

export async function findNearbyParking(
  supabase: any,
  lat: number,
  lng: number,
  radiusMeters = 2000,
  limit = 4,
): Promise<ParkingFacility[]> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return [];
  }

  // 1. Attempt database RPC query first if available
  if (supabase && typeof supabase.rpc === "function") {
    try {
      const { data, error } = await supabase.rpc("get_nearby_parking", {
        p_lat: lat,
        p_lng: lng,
        p_radius_meters: radiusMeters,
        p_limit: limit,
      });

      if (!error && Array.isArray(data) && data.length > 0) {
        return data.map((item: any) => ({
          id: String(item.id || item.carpark_number),
          carparkNumber: item.carpark_number ? String(item.carpark_number) : undefined,
          name: String(item.name || "Green P Carpark"),
          operator: String(item.operator || "Green P"),
          address: String(item.address || ""),
          city: String(item.city || "Toronto"),
          latitude: Number(item.latitude),
          longitude: Number(item.longitude),
          distanceMeters: Number(item.distance_meters || 0),
          walkingMinutes: Number(item.walking_minutes || 1),
          capacity: item.capacity ? Number(item.capacity) : undefined,
          facilityType: item.facility_type || "surface",
          rateSummary: item.rate_summary || undefined,
          rateHalfHour: item.rate_half_hour ? Number(item.rate_half_hour) : undefined,
          dayMax: item.day_max ? Number(item.day_max) : undefined,
          nightMax: item.night_max ? Number(item.night_max) : undefined,
          paymentMethods: Array.isArray(item.payment_methods)
            ? item.payment_methods
            : ["Green P App", "Credit Card", "Mobile Pay"],
          googleMapsUrl:
            item.google_maps_url ||
            buildNavigationUrls(item.latitude, item.longitude).googleMapsUrl,
          appleMapsUrl:
            item.apple_maps_url ||
            buildNavigationUrls(item.latitude, item.longitude).appleMapsUrl,
        }));
      }
    } catch (_) {
      // Fallback silently to fast in-memory spatial resolution
    }
  }

  // 2. High-speed, guaranteed zero-downtime in-memory spatial fallback
  const results: ParkingFacility[] = [];
  for (const facility of TORONTO_GREEN_P_FACILITIES) {
    const dist = haversineDistanceMeters(
      lat,
      lng,
      facility.latitude,
      facility.longitude,
    );
    if (dist <= radiusMeters) {
      const nav = buildNavigationUrls(facility.latitude, facility.longitude);
      results.push({
        id: facility.id,
        carparkNumber: facility.carparkNumber,
        name: facility.name,
        operator: facility.operator,
        address: facility.address,
        city: facility.city,
        latitude: facility.latitude,
        longitude: facility.longitude,
        distanceMeters: dist,
        walkingMinutes: walkingMinutes(dist),
        capacity: facility.capacity,
        facilityType: facility.facilityType,
        rateSummary: facility.rateSummary,
        rateHalfHour: facility.rateHalfHour,
        dayMax: facility.dayMax,
        nightMax: facility.nightMax,
        paymentMethods: facility.paymentMethods,
        googleMapsUrl: nav.googleMapsUrl,
        appleMapsUrl: nav.appleMapsUrl,
      });
    }
  }

  results.sort((a, b) => a.distanceMeters - b.distanceMeters);
  return results.slice(0, limit);
}
