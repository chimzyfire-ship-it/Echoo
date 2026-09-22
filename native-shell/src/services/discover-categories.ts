import type { DiscoveryCard, DiscoveryIntent } from '../models';

export interface DiscoverCategory {
  key: string;
  label: string;
  headline?: string;
  subhead?: string;
  query?: string;
  match?: RegExp;
}

export const DISCOVER_CATEGORIES: DiscoverCategory[] = [
  {
    key: 'discover',
    label: 'Discover',
    headline: 'Worth going out for',
    subhead: 'Curated spots around',
  },
  {
    key: 'food',
    label: 'Food',
    headline: 'Tables worth leaving for',
    subhead: 'Bistros, chef spots & dining in',
  },
  {
    key: 'cocktails',
    label: 'Cocktails',
    headline: 'Cocktails & Speakeasies',
    subhead: 'Mixology, hidden doors & lounges in',
  },
  {
    key: 'music',
    label: 'Live music',
    headline: 'Live Sound & Concerts',
    subhead: 'Jazz, stages & vinyl listening bars in',
  },
  {
    key: 'nightlife',
    label: 'Nightlife',
    headline: 'After-Dark & Clubs',
    subhead: 'DJ sets, dance floors & energy in',
  },
  {
    key: 'comedy',
    label: 'Comedy',
    headline: 'Stand-up & Laughs',
    subhead: 'Comedy clubs & showcases in',
  },
  {
    key: 'sports',
    label: 'Sports',
    headline: 'Game Day & Arcades',
    subhead: 'Sports lounges, big screens & gaming in',
  },
  {
    key: 'art',
    label: 'Art & Exhibits',
    headline: 'Creative Spaces & Galleries',
    subhead: 'Exhibits, immersive art & museums in',
  },
  {
    key: 'late-night',
    label: 'Late night',
    headline: 'Late-Night Bites',
    subhead: 'Open late, comfort food & 2 AM spots in',
  },
  {
    key: 'cafes',
    label: 'Cafes & Matcha',
    headline: 'Artisan Coffee & Day Vibes',
    subhead: 'Roasters, matcha studios & bakeries in',
  },
  {
    key: 'markets',
    label: 'Pop-ups',
    headline: 'Pop-ups & Markets',
    subhead: 'Night markets, artisan makers & drops in',
  },
  {
    key: 'events',
    label: 'Events',
    headline: 'Festivals & Gatherings',
    subhead: 'What is happening around',
  },
  {
    key: 'tourism',
    label: 'Tourism',
    headline: 'Landmarks & Attractions',
    subhead: 'Iconic city stops in',
  },
  { key: "brunch", label: "Brunch", query: "brunch restaurants", headline: "Slow mornings, good brunch", subhead: "Breakfast tables & weekend brunch in", match: /\b(?:brunch|breakfast)/i },
  { key: "desserts", label: "Sweet treats", query: "dessert shops", headline: "A little something sweet", subhead: "Ice cream, pastries & dessert stops in", match: /\b(?:dessert|ice cream|gelato|bakery|pastr|patisserie|chocolat|donut|doughnut|sweet)/i },
  { key: "hiking", label: "Hikes & trails", query: "hiking trails", headline: "Take the scenic route", subhead: "Trails & conservation areas around", match: /\b(?:hik|trail|conservation|nature reserve)/i },
  { key: "parks", label: "Parks & gardens", query: "parks and botanical gardens", headline: "Room to breathe", subhead: "Green spaces & gardens around", match: /\b(?:parks?\b|garden|arboretum)/i },
  { key: "skating", label: "Skating", query: "ice skating rinks", headline: "Meet you at the rink", subhead: "Indoor & seasonal outdoor skating in", match: /\b(?:skat|ice rink|arena)/i },
  { key: "skiing", label: "Ski & snowboard", query: "ski resorts", headline: "Make a snow day of it", subhead: "Ski hills & snowboard destinations near", match: /\b(?:ski\b|skiing\b|snowboard)/i },
  { key: "escape-rooms", label: "Escape rooms", query: "escape rooms", headline: "A puzzle worth teaming up for", subhead: "Escape rooms & puzzle adventures in", match: /\b(?:escape|puzzle)/i },
  { key: "board-games", label: "Board games", query: "board game cafes", headline: "Your next game night", subhead: "Board game caf\u00e9s & tabletop hangouts in", match: /\b(?:board game|tabletop|game caf)/i },
  { key: "bowling", label: "Bowling", query: "bowling alleys", headline: "A little friendly competition", subhead: "Bowling lanes & group hangouts in", match: /\b(?:bowling|bowl\b)/i },
  { key: "climbing", label: "Climbing", query: "indoor rock climbing gyms", headline: "Find your next challenge", subhead: "Bouldering & climbing gyms in", match: /\b(?:climb|boulder)/i },
  { key: "pottery", label: "Pottery & crafts", query: "pottery studios classes", headline: "Make something together", subhead: "Pottery studios & creative workshops in", match: /\b(?:pottery|ceramic|craft|paint|art studio)/i },
  { key: "wellness", label: "Spas & saunas", query: "day spas and saunas", headline: "Take a proper breather", subhead: "Spas, saunas & thermal experiences in", match: /\b(?:spas?\b|sauna|thermal|wellness)/i },
  { key: "breweries", label: "Breweries", query: "craft breweries taprooms", headline: "Find your next favourite pour", subhead: "Local breweries & tasting rooms in", match: /\b(?:brewer|taproom|brewpub)/i },
  { key: "water", label: "Paddle & kayak", query: "kayak canoe rentals", headline: "A day on the water", subhead: "Kayak, canoe & paddleboard outfitters near", match: /\b(?:kayak|canoe|paddle|boat rental|outfitter)/i },
];

// Specific activity pills use the existing search contract, so both owned
// inventory and live providers receive the activity instead of a broad feed.
export function discoveryCategoryRequest(key: string, search = ''): { intent: DiscoveryIntent; query: string } {
  if (search.trim()) return { intent: 'search', query: search.trim() };
  const category = DISCOVER_CATEGORIES.find((item) => item.key === key);
  if (category?.query) return { intent: 'search', query: category.query };
  return { intent: (category?.key ?? 'discover') as DiscoveryIntent, query: '' };
}

export function matchesDiscoveryCategory(card: DiscoveryCard, key: string): boolean {
  const category = DISCOVER_CATEGORIES.find((item) => item.key === key);
  if (!category?.match) return true;
  const evidence = [card.title, card.category, card.description, ...card.features].join(' ').replace(/[_-]/g, ' ');
  return category.match.test(evidence);
}
