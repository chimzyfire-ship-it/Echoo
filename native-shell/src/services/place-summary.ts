import type { DiscoveryCard } from '../models';

export function placeSummary(place: Partial<DiscoveryCard>, facts: Array<{ label: string; value: string }> = []): string {
  const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
  const normalize = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const description = clean(place.description);
  const redundant = [place.title, place.address, place.city, place.category]
    .some((value) => value && normalize(clean(value)) === normalize(description));
  if (description && !redundant) {
    if (description.length <= 220) return description;
    return `${description.slice(0, 217).replace(/\s+\S*$/, '').replace(/[ ,;:]+$/, '')}...`;
  }

  const category = clean(place.category).replace(/[_-]+/g, ' ') || (place.type === 'event' ? 'Event' : 'Place');
  const location = clean(place.city) || clean(place.address);
  const features = [...new Set((place.features ?? []).map((feature) => clean(feature).replace(/[_-]+/g, ' ')))]
    .filter((feature) => feature && normalize(feature) !== normalize(category))
    .slice(0, 2);
  const context = `${category[0].toUpperCase()}${category.slice(1)}${location ? ` in ${location}` : ''}`;
  const fact = facts.find((item) => ['Cuisine', 'Amenities', 'What to expect', 'Access', 'Good to know'].includes(item.label) && clean(item.value));
  if (fact) return `${context}. ${fact.label}: ${clean(fact.value)}`;
  return `${context}.${features.length ? ` Listed features: ${features.join(', ')}.` : !location ? ' More details are not available yet.' : ''}`;
}
