import {
  CORS_HEADERS,
  getSupabaseAdmin,
  jsonResponse,
} from "../_shared/location.ts";
import {
  assertIngestionAuthorized,
  fetchJsonRecords,
  finishIngestionRun,
  importPlaces,
  openDataRecordToPlace,
  type PlaceInput,
  startIngestionRun,
} from "../_shared/ontario-ingestion.ts";

type Payload = {
  preset?: string;
  sourceUrl?: string;
  ckanResourceId?: string;
  ckanBaseUrl?: string;
  arcgisServiceUrl?: string;
  arcgisLayerId?: number;
  records?: Record<string, unknown>[];
  sourceName?: string;
  sourceLicense?: string;
  category?: string;
  subcategory?: string;
  municipality?: string;
  fields?: Record<string, string>;
  offset?: number;
  maxRecords?: number;
};

const GTA_OPEN_DATA_PRESETS: Record<string, Partial<Payload>> = {
  markham_parks: {
    sourceName: "markham_open_data_parks",
    sourceUrl:
      "https://data-markham.opendata.arcgis.com/datasets/d6d3ca08120741798181e187650defc0_0/about",
    arcgisServiceUrl:
      "https://utility.arcgis.com/usrsvcs/servers/d6d3ca08120741798181e187650defc0/rest/services/OpenData/OD_PARKS/FeatureServer",
    arcgisLayerId: 0,
    sourceLicense: "City of Markham Open Data",
    category: "park",
    subcategory: "municipal_park",
    municipality: "Markham",
    fields: {
      sourceId: "GLOBALID",
      name: "PARK_NAME",
      description: "USE_TYPE",
      municipality: "municipality",
    },
  },
  markham_trails: {
    sourceName: "markham_open_data_trails",
    sourceUrl:
      "https://data-markham.opendata.arcgis.com/datasets/c445d4d0a22041d2a961e919a8df59ed_0/about",
    arcgisServiceUrl:
      "https://utility.arcgis.com/usrsvcs/servers/c445d4d0a22041d2a961e919a8df59ed/rest/services/OpenData/OD_TRAILS/FeatureServer",
    arcgisLayerId: 0,
    sourceLicense: "City of Markham Open Data",
    category: "trail",
    subcategory: "walking_trail",
    municipality: "Markham",
    fields: {
      sourceId: "GLOBALID",
      name: "TRAIL_NAME",
      description: "MATERIAL",
      municipality: "municipality",
    },
  },
  markham_city_facilities: {
    sourceName: "markham_open_data_city_facilities",
    sourceUrl:
      "https://data-markham.opendata.arcgis.com/datasets/d8cee9f1183f4d8f9c731e777782f3a3_0/about",
    arcgisServiceUrl:
      "https://utility.arcgis.com/usrsvcs/servers/d8cee9f1183f4d8f9c731e777782f3a3/rest/services/OpenData/OD_CITY_FACILITES/FeatureServer",
    arcgisLayerId: 0,
    sourceLicense: "City of Markham Open Data",
    municipality: "Markham",
    fields: {
      sourceId: "OBJECTID",
      name: "LABEL",
      category: "TYPE",
      subcategory: "DEPTRESP",
      latitude: "latitude",
      longitude: "longitude",
      address: "ADDRESS",
      description: "TYPE",
      municipality: "municipality",
    },
  },
  toronto_libraries: {
    sourceName: "toronto_open_data_library_branches",
    sourceUrl:
      "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/f5aa9b07-da35-45e6-b31f-d6790eb9bd9b/resource/5f4950b4-c727-4e54-8d0d-972e198268d6/download/tpl-branch-general-information-4326.geojson",
    sourceLicense: "City of Toronto Open Data",
    category: "library",
    subcategory: "public_library",
    municipality: "Toronto",
    fields: {
      sourceId: "BranchCode",
      name: "BranchName",
      latitude: "Lat",
      longitude: "Long",
      address: "Address",
      website: "Website",
      phone: "Telephone",
      description: "Hours",
      municipality: "municipality",
    },
  },
  toronto_cultural_hotspots: {
    sourceName: "toronto_open_data_cultural_hotspots",
    sourceUrl:
      "https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/c7be2ee7-d317-4a28-8cbe-bff1ce116b46/resource/a169dc01-c584-418e-9fa9-66d85ce437ca/download/points-of-interest-4326.geojson",
    sourceLicense: "City of Toronto Open Data",
    category: "cultural_space",
    subcategory: "point_of_interest",
    municipality: "Toronto",
    fields: {
      sourceId: "ObjectId",
      name: "SiteName",
      address: "Address",
      website: "ExternalLink",
      description: "Description",
      municipality: "municipality",
    },
  },
  toronto_dinesafe_food_premises: {
    sourceName: "toronto_open_data_dinesafe",
    sourceUrl:
      "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search?resource_id=ad342031-a0eb-4f5e-a2c6-61a499047993",
    ckanResourceId: "ad342031-a0eb-4f5e-a2c6-61a499047993",
    sourceLicense: "City of Toronto Open Data",
    category: "food_premise",
    subcategory: "inspected_food_premise",
    municipality: "Toronto",
    fields: {
      sourceId: "estId",
      name: "estName",
      latitude: "latitude",
      longitude: "longitude",
      address: "address",
      phone: "phone",
      description: "inspectionStatus",
      municipality: "municipality",
    },
  },
};

function limit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 5000;
  return Math.max(1, Math.min(Math.round(parsed), 25000));
}

function offset(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round(parsed));
}

function withPreset(payload: Payload): Payload {
  const preset = payload.preset
    ? GTA_OPEN_DATA_PRESETS[payload.preset]
    : undefined;
  return {
    ...(preset || {}),
    ...payload,
    fields: {
      ...(preset?.fields || {}),
      ...(payload.fields || {}),
    },
  };
}

function dedupePlaces(places: PlaceInput[]) {
  const bySourceId = new Map<string, PlaceInput>();
  for (const place of places) {
    bySourceId.set(`${place.sourceName}:${place.sourceId}`, place);
  }
  return [...bySourceId.values()];
}

async function fetchCkanDatastoreRecords(input: {
  baseUrl?: string;
  resourceId: string;
  offset: number;
  limit: number;
}) {
  const url = new URL(
    input.baseUrl ||
      "https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action/datastore_search",
  );
  url.searchParams.set("resource_id", input.resourceId);
  url.searchParams.set("offset", String(input.offset));
  url.searchParams.set("limit", String(input.limit));
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Could not fetch CKAN resource ${input.resourceId}: ${response.status}`,
    );
  }
  const json = await response.json();
  if (!json?.success) {
    throw new Error(`CKAN resource ${input.resourceId} returned success=false`);
  }
  return {
    records: json.result?.records || [],
    total: Number(json.result?.total || 0),
  };
}

async function fetchArcgisFeatureRecords(input: {
  serviceUrl: string;
  layerId?: number;
  offset: number;
  limit: number;
}) {
  const serviceUrl = input.serviceUrl.replace(/\/+$/, "");
  const layerId = Number.isFinite(input.layerId) ? input.layerId : 0;
  const url = new URL(`${serviceUrl}/${layerId}/query`);
  url.searchParams.set("where", "1=1");
  url.searchParams.set("outFields", "*");
  url.searchParams.set("f", "geojson");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("resultOffset", String(input.offset));
  url.searchParams.set("resultRecordCount", String(input.limit));

  const response = await fetch(url, {
    headers: { Accept: "application/geo+json, application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Could not fetch ArcGIS layer ${serviceUrl}/${layerId}: ${response.status}`,
    );
  }
  const json = await response.json();
  if (json.error) {
    throw new Error(
      `ArcGIS layer ${serviceUrl}/${layerId} returned ${json.error.message || "an error"}`,
    );
  }
  const records = Array.isArray(json.features)
    ? json.features.map((feature: any) => ({
        ...feature.properties,
        ...coordinatesFromGeometry(feature.geometry),
        raw_feature: feature,
      }))
    : [];
  return {
    records,
    total:
      input.offset +
      records.length +
      (json.exceededTransferLimit || json.properties?.exceededTransferLimit
        ? 1
        : 0),
  };
}

function coordinatesFromGeometry(geometry: any) {
  if (!geometry) return {};
  if (geometry.type === "Point" && Array.isArray(geometry.coordinates)) {
    return {
      longitude: geometry.coordinates[0],
      latitude: geometry.coordinates[1],
    };
  }

  const points: number[][] = [];
  const collect = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (
      value.length >= 2 &&
      typeof value[0] === "number" &&
      typeof value[1] === "number"
    ) {
      points.push(value as number[]);
      return;
    }
    for (const child of value) collect(child);
  };
  collect(geometry.coordinates);

  if (!points.length) return {};
  const totals = points.reduce(
    (acc, point) => ({
      lng: acc.lng + Number(point[0]),
      lat: acc.lat + Number(point[1]),
    }),
    { lng: 0, lat: 0 },
  );
  return {
    longitude: totals.lng / points.length,
    latitude: totals.lat / points.length,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const unauthorized = assertIngestionAuthorized(req);
  if (unauthorized) return unauthorized;

  const supabase = getSupabaseAdmin();
  let runId: string | null = null;

  try {
    const payload = withPreset((await req.json()) as Payload);
    const maxRecords = limit(payload.maxRecords);
    const startAt = offset(payload.offset);
    const fetched = payload.arcgisServiceUrl
      ? await fetchArcgisFeatureRecords({
          serviceUrl: payload.arcgisServiceUrl,
          layerId: payload.arcgisLayerId,
          offset: startAt,
          limit: maxRecords,
        })
      : payload.ckanResourceId
        ? await fetchCkanDatastoreRecords({
            baseUrl: payload.ckanBaseUrl,
            resourceId: payload.ckanResourceId,
            offset: startAt,
            limit: maxRecords,
          })
        : {
            records: Array.isArray(payload.records)
              ? payload.records
              : payload.sourceUrl
                ? await fetchJsonRecords(payload.sourceUrl)
                : [],
            total: undefined,
          };
    const rawRecords = fetched.records;
    const totalSourceRecords = fetched.total ?? rawRecords.length;
    const sourceName = payload.sourceName || "ontario_open_data";

    runId = await startIngestionRun(supabase, {
      sourceName,
      sourceType: "open_data",
      sourceUrl: payload.sourceUrl,
      metadata: {
        preset: payload.preset,
        category: payload.category,
        ckanResourceId: payload.ckanResourceId,
        arcgisServiceUrl: payload.arcgisServiceUrl,
        arcgisLayerId: payload.arcgisLayerId,
        municipality: payload.municipality,
        fields: payload.fields || {},
        offset: startAt,
        maxRecords,
      },
    });

    const config = {
      sourceName,
      sourceUrl: payload.sourceUrl,
      sourceLicense: payload.sourceLicense,
      category: payload.category,
      subcategory: payload.subcategory,
      municipality: payload.municipality,
      fields: payload.fields || {},
    };
    const windowedRecords = (
      payload.ckanResourceId || payload.arcgisServiceUrl
        ? rawRecords
        : rawRecords.slice(startAt, startAt + maxRecords)
    ).map((record) => ({
      municipality: payload.municipality || "Ontario",
      ...record,
    }));
    const places = dedupePlaces(
      windowedRecords
        .map((record) => openDataRecordToPlace(record, config))
        .filter((place): place is PlaceInput => Boolean(place)),
    );
    const summary = await importPlaces(supabase, places);
    const filteredOutInWindow =
      Math.min(maxRecords, Math.max(totalSourceRecords - startAt, 0)) -
      places.length;

    await finishIngestionRun(supabase, runId, {
      status: "completed",
      records_seen: totalSourceRecords,
      records_imported: summary.imported,
      records_skipped: summary.skipped + filteredOutInWindow,
      error_sample: summary.errors,
    });

    return jsonResponse({
      success: true,
      runId,
      summary: {
        ...summary,
        offset: startAt,
        windowSize: maxRecords,
        totalSourceRecords,
        filteredOutInWindow,
      },
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown open data import error";
    await finishIngestionRun(supabase, runId, {
      status: "failed",
      error_sample: [message],
    });
    return jsonResponse({ error: message, runId }, 500);
  }
});
