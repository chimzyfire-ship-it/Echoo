import type { DiscoveryCard } from '@/src/models';

const places = new Map<string, DiscoveryCard>();

export function cachePlace(place: DiscoveryCard) {
  places.set(place.id, place);
  if (place.canonicalId) places.set(place.canonicalId, place);
}

export function getCachedPlace(id: string) {
  return places.get(id) ?? null;
}
