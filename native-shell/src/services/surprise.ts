import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DiscoveryCard, EchooProfile } from '@/src/models';

const SURPRISE_HISTORY_KEY = 'echoo_surprise_history_v1';

export type SurpriseTimeContext = { label: string; query: string };

export function timeContext(): SurpriseTimeContext {
  const hour = new Date().getHours();
  if (hour < 6) return { label: 'late night', query: 'late night open now' };
  if (hour < 11) return { label: 'this morning', query: 'breakfast coffee brunch morning' };
  if (hour < 16) return { label: 'this afternoon', query: 'lunch cafes galleries afternoon' };
  if (hour < 21) return { label: 'this evening', query: 'dinner date night live music evening' };
  return { label: 'tonight', query: 'nightlife late dinner live music tonight' };
}

export function categoryGroupOf(card: DiscoveryCard): string {
  const category = String(card?.category || '').toLowerCase();
  if (/restaurant|cafe|coffee|bakery|food|bar|pub/.test(category)) return 'food';
  if (/music|concert|nightclub|venue/.test(category)) return 'music';
  if (/comedy|theatre|cinema|arts/.test(category)) return 'culture';
  if (/museum|gallery|tourism|attraction/.test(category)) return 'tourism';
  if (/park|nature|trail|outdoor/.test(category)) return 'nature';
  return 'local';
}

function placeKey(card: DiscoveryCard): string {
  return card.canonicalId || card.id;
}

function profileTerms(profile: EchooProfile): string[] {
  return [
    ...(profile.interests || []),
    ...(profile.eventStyles || []),
    ...(profile.audiences || []),
    ...(profile.motivations || []),
  ]
    .map((value) => String(value).toLowerCase().trim())
    .filter((value) => value.length > 2);
}

function cardText(card: DiscoveryCard): string {
  return `${card.title || ''} ${card.category || ''} ${card.description || ''} ${(card.features || []).join(
    ' '
  )}`.toLowerCase();
}

export function surpriseProfileAffinity(profile: EchooProfile, card: DiscoveryCard): number {
  const terms = profileTerms(profile);
  if (!terms.length) return 0.35;
  const text = cardText(card);
  return Math.min(1, terms.filter((term) => text.includes(term)).length / Math.min(terms.length, 3));
}

function hotScoreFor(card: DiscoveryCard): number {
  const raw = Number(card?.community?.hotScore ?? 0);
  return Number.isFinite(raw) ? raw : 0;
}

export function surpriseScore(card: DiscoveryCard, profile: EchooProfile): number {
  const distance = Number(card?.distanceMeters);
  const nearby = Number.isFinite(distance) ? Math.max(0, 1 - distance / 35_000) : 0.48;
  const profileMatch = surpriseProfileAffinity(profile, card);
  const time = timeContext().query;
  const text = `${card.title || ''} ${card.category || ''} ${card.description || ''}`.toLowerCase();
  const timeMatch =
    time
      .split(' ')
      .filter((word) => word.length > 3 && text.includes(word)).length * 0.08;
  return nearby * 0.45 + profileMatch * 0.32 + Math.min(timeMatch, 0.16) + hotScoreFor(card) * 0.07;
}

export type SurpriseHistoryEntry = { id: string; style: string; city: string; seenAt: number };

export async function surpriseHistory(): Promise<SurpriseHistoryEntry[]> {
  try {
    const saved = await AsyncStorage.getItem(SURPRISE_HISTORY_KEY);
    const parsed = saved ? JSON.parse(saved) : [];
    return Array.isArray(parsed)
      ? parsed
          .filter((entry) => entry && typeof entry.id === 'string' && typeof entry.style === 'string')
          .slice(0, 24)
      : [];
  } catch {
    return [];
  }
}

async function rememberSurprise(card: DiscoveryCard, city: string): Promise<void> {
  const entry: SurpriseHistoryEntry = {
    id: placeKey(card),
    style: categoryGroupOf(card),
    city,
    seenAt: Date.now(),
  };
  const previous = (await surpriseHistory()).filter((saved) => saved.id !== entry.id);
  try {
    await AsyncStorage.setItem(SURPRISE_HISTORY_KEY, JSON.stringify([entry, ...previous].slice(0, 24)));
  } catch {
    // Storage is best-effort; the pick still succeeds.
  }
}

function randomIndex(length: number): number {
  if (length <= 1) return 0;
  return Math.floor(Math.random() * length);
}

function dedupePool(cards: DiscoveryCard[]): DiscoveryCard[] {
  const seen = new Set<string>();
  const unique: DiscoveryCard[] = [];
  for (const card of cards) {
    const key = placeKey(card);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(card);
  }
  return unique;
}

/**
 * Picks one place for the Surprise reveal. Exact port of events.html revealSurprise:
 * rank by surpriseScore, prefer real hero images, avoid per-city history, vary the
 * category style from the previous roll, then choose randomly from the pool.
 */
export async function pickSurprise(
  profile: EchooProfile,
  discoveryPool: DiscoveryCard[],
  city: string
): Promise<DiscoveryCard | null> {
  const pool = dedupePool(discoveryPool ?? []);
  if (!pool.length) return null;

  const ranked = pool
    .map((card) => ({ card, score: surpriseScore(card, profile) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.min(30, pool.length));

  const withImage = ranked.filter(({ card }) => Boolean(card.image?.url));
  const candidates = withImage.length ? withImage : ranked;

  const cityKey = city.trim().toLowerCase();
  const cityHistory = (await surpriseHistory()).filter(
    (entry) => String(entry.city || '').toLowerCase() === cityKey
  );
  const seenIds = new Set(cityHistory.map((entry) => entry.id));
  const unseen = candidates.filter(({ card }) => !seenIds.has(placeKey(card)));
  const unseenPool = unseen.length ? unseen : candidates;

  const previousStyle = cityHistory[0]?.style;
  const varied =
    previousStyle === undefined
      ? unseenPool
      : unseenPool.filter(({ card }) => categoryGroupOf(card) !== previousStyle);
  const finalPool = varied.length ? varied : unseenPool;

  if (!finalPool.length) return null;

  const choice = finalPool[randomIndex(finalPool.length)].card;
  await rememberSurprise(choice, city);
  return choice;
}
