import { edgeRequest } from './api';

export interface NearbyStay {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  distanceMeters: number;
  rating: number | null;
  ratingCount: number | null;
  mapUrl: string;
  websiteUrl: string | null;
  imageUrl: string;
  photoCredit: string | null;
  photoCreditUrl: string | null;
}

export function secureStayUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export function stayDestination(stay: NearbyStay) {
  const website = secureStayUrl(stay.websiteUrl);
  if (website) return { url: website, label: 'Visit hotel website' };
  // A place ID points to a specific property, unlike a hotel-name search.
  const map = new URL('https://www.google.com/maps/search/');
  map.searchParams.set('api', '1');
  map.searchParams.set('query', `${stay.name} ${stay.address}`);
  map.searchParams.set('query_place_id', stay.id);
  return { url: map.href, label: 'View hotel on Maps' };
}

export function stayDistance(meters: number) {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m away` : `${(meters / 1000).toFixed(1)} km away`;
}

export async function getNearbyStays(input: { latitude: number; longitude: number; destinationName: string }, signal?: AbortSignal) {
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) || Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180) {
    throw new Error('This place needs a precise location to find nearby hotels.');
  }
  const lookup = async (radiusMeters: number) => {
    const response = await edgeRequest<{ stays: NearbyStay[] }>('live-stays', {
      body: { ...input, radiusMeters, limit: 3 }, signal,
    });
    if (!Array.isArray(response?.stays)) throw new Error('Nearby hotels could not load. Please try again.');
    const seen = new Set<string>();
    return response.stays.filter((stay) => {
      if (!stay || typeof stay.id !== 'string' || !stay.id || typeof stay.name !== 'string' || !stay.name.trim() ||
        !secureStayUrl(stay.imageUrl) || typeof stay.distanceMeters !== 'number' || !Number.isFinite(stay.distanceMeters) ||
        stay.distanceMeters < 0 || stay.distanceMeters > radiusMeters || seen.has(stay.id)) return false;
      seen.add(stay.id);
      return true;
    }).sort((a, b) => a.distanceMeters - b.distanceMeters).slice(0, 3);
  };
  const nearby = await lookup(2500);
  if (nearby.length) return { stays: nearby, radiusMeters: 2500 };
  if (signal?.aborted) throw new Error('Hotel search cancelled.');
  return { stays: await lookup(5000), radiusMeters: 5000 };
}
