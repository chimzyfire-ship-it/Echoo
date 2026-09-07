import type {
  DiscoveryCard,
  DiscoveryFeed,
  DiscoveryLane,
  DiscoveryIntent,
  EchooLocation,
  PlaceDetail,
  QuickPlan,
  Ticket,
} from '@/src/models';
import { echooConfig, supabase } from '@/src/services/supabase';

export class EchooApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'EchooApiError';
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
const numberOrNull = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

async function edgeRequest<T>(
  name: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; query?: Record<string, string>; signal?: AbortSignal } = {}
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const url = new URL(`${echooConfig.supabaseUrl}/functions/v1/${name}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);

  const response = await fetch(url.toString(), {
    method: options.method ?? 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: echooConfig.supabaseAnonKey,
      Authorization: `Bearer ${data.session?.access_token ?? echooConfig.supabaseAnonKey}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || payload?.error) {
    throw new EchooApiError(
      text(payload?.error) || `Echoo could not complete that request (${response.status}).`,
      response.status,
      text(payload?.code) || undefined
    );
  }
  return payload as T;
}

function mapCard(value: Record<string, unknown>): DiscoveryCard | null {
  const id = text(value.id) || text(value.place_id) || text(value.google_place_id);
  const title = text(value.title) || text(value.name);
  if (!id || !title) return null;

  const rawImage = value.image;
  const imageUrl =
    rawImage && typeof rawImage === 'object' ? text((rawImage as Record<string, unknown>).url) : text(rawImage);
  const imageAlt =
    rawImage && typeof rawImage === 'object' ? text((rawImage as Record<string, unknown>).alt) : '';
  const rawCommunity = value.community;
  const rawPlacement = value.placement;

  return {
    id,
    canonicalId: text(value.canonicalId) || text(value.canonical_id) || null,
    source: text(value.source) || 'echoo',
    type: value.type === 'event' ? 'event' : 'place',
    title,
    category: text(value.category) || 'place',
    description: text(value.description),
    city: text(value.city) || 'Greater Toronto Area',
    address: text(value.address) || null,
    latitude: numberOrNull(value.latitude ?? value.lat),
    longitude: numberOrNull(value.longitude ?? value.lng),
    distanceMeters: numberOrNull(value.distanceMeters ?? value.distance_meters),
    startsAt: text(value.startsAt) || text(value.starts_at) || null,
    image: imageUrl
      ? {
          url: imageUrl,
          alt: imageAlt || title,
          source:
            rawImage && typeof rawImage === 'object'
              ? text((rawImage as Record<string, unknown>).source) || undefined
              : undefined,
        }
      : null,
    features: Array.isArray(value.features)
      ? value.features.filter((item): item is string => typeof item === 'string')
      : [],
    community:
      rawCommunity && typeof rawCommunity === 'object'
        ? {
            ratingAverage: numberOrNull((rawCommunity as Record<string, unknown>).ratingAverage),
            ratingCount: Number((rawCommunity as Record<string, unknown>).ratingCount ?? 0),
            verifiedVisitCount: Number((rawCommunity as Record<string, unknown>).verifiedVisitCount ?? 0),
            saveCount: Number((rawCommunity as Record<string, unknown>).saveCount ?? 0),
            hotScore: Number((rawCommunity as Record<string, unknown>).hotScore ?? 0),
            isHot: Boolean((rawCommunity as Record<string, unknown>).isHot),
          }
        : null,
    placement:
      rawPlacement && typeof rawPlacement === 'object'
        ? {
            label: text((rawPlacement as Record<string, unknown>).label),
            sponsored: Boolean((rawPlacement as Record<string, unknown>).sponsored),
          }
        : null,
  };
}

function mapLane(value: unknown): DiscoveryLane {
  const lane = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const pagination =
    lane.pagination && typeof lane.pagination === 'object'
      ? (lane.pagination as Record<string, unknown>)
      : {};
  return {
    items: Array.isArray(lane.items)
      ? lane.items
          .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
          .map(mapCard)
          .filter((item): item is DiscoveryCard => item !== null)
      : [],
    nextCursor: text(pagination.nextCursor) || null,
    hasMore: Boolean(pagination.hasMore),
  };
}

export async function getDiscovery(
  input: {
    intent: DiscoveryIntent;
    query: string;
    location: EchooLocation;
    cultureSlug?: string;
    preferenceFeatureSlugs?: string[];
  },
  signal?: AbortSignal
): Promise<DiscoveryFeed> {
  const payload = await edgeRequest<Record<string, unknown>>('explore-search', {
    body: {
      version: 2,
      intent: input.intent,
      query: input.query,
      cultureSlug: input.cultureSlug || undefined,
      city: input.location.city,
      lat: input.location.latitude,
      lng: input.location.longitude,
      radiusMeters:
        input.location.latitude !== undefined && input.location.longitude !== undefined ? 100000 : undefined,
      preferenceFeatureSlugs: input.preferenceFeatureSlugs ?? [],
      includeLiveFallback: true,
      limit: 20,
    },
    signal,
  });

  const rawLocation =
    payload.location && typeof payload.location === 'object'
      ? (payload.location as Record<string, unknown>)
      : {};
  const rawIntent =
    payload.intent && typeof payload.intent === 'object'
      ? (payload.intent as Record<string, unknown>)
      : {};

  return {
    supported: payload.supported !== false,
    reason: text(payload.reason) || undefined,
    location: {
      mode:
        rawLocation.mode === 'gps' || rawLocation.mode === 'municipality' ? 'gps' : input.location.mode,
      city: text(rawLocation.city) || input.location.city,
      label: text(rawLocation.label) || input.location.label,
      latitude: input.location.latitude,
      longitude: input.location.longitude,
      accuracyMeters: input.location.accuracyMeters,
    },
    intent: {
      id: text(rawIntent.id) || input.intent,
      label: text(rawIntent.label) || input.intent,
    },
    nearby: mapLane(payload.nearby),
    recommended: mapLane(payload.recommended),
    all: mapLane(payload.all),
  };
}

export async function resolveLocationContext(
  input: { city?: string; latitude?: number; longitude?: number; accuracyMeters?: number },
  signal?: AbortSignal
) {
  return edgeRequest<{
    supported: boolean;
    reason?: string;
    message?: string;
    municipality?: string | null;
    label?: string;
    accuracyMeters?: number | null;
  }>('location-context', {
    body: {
      city: input.city,
      lat: input.latitude,
      lng: input.longitude,
      accuracyMeters: input.accuracyMeters,
    },
    signal,
  });
}

export async function getPlaceDetail(id: string, signal?: AbortSignal): Promise<PlaceDetail> {
  const response = await edgeRequest<{ data: PlaceDetail }>('place-detail', {
    method: 'GET',
    query: { id },
    signal,
  });
  return response.data;
}

export async function getQuickPlan(
  input: { anchor: DiscoveryCard; stopCount: 2 | 3; budgetStyle: 'value' | 'balanced' | 'elevated' },
  signal?: AbortSignal
): Promise<QuickPlan> {
  const { anchor } = input;
  if (anchor.latitude === null || anchor.longitude === null) {
    throw new EchooApiError('This place needs precise location data before Echoo can plan around it.', 422);
  }
  const response = await edgeRequest<{ plan: QuickPlan }>('quick-plan', {
    body: {
      anchor: {
        id: anchor.canonicalId || anchor.id,
        name: anchor.title,
        category: anchor.category,
        city: anchor.city,
        address: anchor.address,
        latitude: anchor.latitude,
        longitude: anchor.longitude,
        imageUrl: anchor.image?.url,
      },
      stopCount: input.stopCount,
      budgetStyle: input.budgetStyle,
    },
    signal,
  });
  return response.plan;
}

export async function askCompanion(
  input: { query: string; location: EchooLocation; previousPlan?: Record<string, unknown> | null },
  signal?: AbortSignal
) {
  return edgeRequest<Record<string, unknown>>('plan-engine', {
    body: {
      query: input.query,
      city: input.location.city,
      lat: input.location.latitude,
      lng: input.location.longitude,
      previousPlan: input.previousPlan ?? null,
    },
    signal,
  });
}

export async function getMyTickets(email: string, signal?: AbortSignal): Promise<Ticket[]> {
  if (!email) return [];
  const payload = await edgeRequest<{ tickets: Array<Record<string, unknown>> }>('my-tickets', {
    method: 'GET',
    query: { email },
    signal,
  });
  return payload.tickets.map((ticket) => {
    const event =
      ticket.ticketed_events && typeof ticket.ticketed_events === 'object'
        ? (ticket.ticketed_events as Record<string, unknown>)
        : {};
    const tier =
      ticket.ticket_tiers && typeof ticket.ticket_tiers === 'object'
        ? (ticket.ticket_tiers as Record<string, unknown>)
        : {};
    return {
      id: text(ticket.id),
      ticketCode: text(ticket.ticket_code) || text(ticket.code),
      status: text(ticket.status) || 'confirmed',
      eventTitle: text(event.title),
      venueName: text(event.venue_name),
      city: text(event.city),
      startsAt: text(event.starts_at) || null,
      tierName: text(tier.name),
      imageUrl: text(event.image_url) || null,
    };
  });
}

export async function callLinkUp<T>(name: string, body: Record<string, unknown>, signal?: AbortSignal) {
  return edgeRequest<T>(name, { body, signal });
}
