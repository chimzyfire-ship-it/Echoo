export type DiscoveryIntent =
  | 'discover'
  | 'food'
  | 'comedy'
  | 'music'
  | 'nightlife'
  | 'events'
  | 'tourism'
  | 'search';

export interface EchooLocation {
  mode: 'gta' | 'manual' | 'gps';
  city: string;
  label: string;
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
}

export interface DiscoveryImage {
  url: string;
  alt: string;
  source?: string;
}

export interface DiscoveryCard {
  id: string;
  canonicalId: string | null;
  source: string;
  type: 'place' | 'event';
  title: string;
  category: string;
  description: string;
  city: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  distanceMeters: number | null;
  startsAt: string | null;
  image: DiscoveryImage | null;
  features: string[];
  community: {
    ratingAverage: number | null;
    ratingCount: number;
    verifiedVisitCount: number;
    saveCount: number;
    hotScore: number;
    isHot: boolean;
  } | null;
  placement: {
    label: string;
    sponsored: boolean;
  } | null;
}

export interface DiscoveryLane {
  items: DiscoveryCard[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface DiscoveryFeed {
  supported: boolean;
  reason?: string;
  location: EchooLocation;
  intent: { id: string; label: string };
  nearby: DiscoveryLane;
  recommended: DiscoveryLane;
  all: DiscoveryLane;
}

export interface PlaceDetail {
  place: Record<string, unknown>;
  profile: Record<string, unknown> | null;
  hours: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  photos: Array<Record<string, unknown>>;
  relatedEvents: Array<Record<string, unknown>>;
  alternatives: Array<Record<string, unknown>>;
  pulse: { items: Array<{ label: string; value: string }> } | null;
}

export interface QuickPlanStop {
  id: string;
  name: string;
  category: string;
  address: string;
  latitude: number;
  longitude: number;
  imageUrl: string;
  time: string;
  travelMinutes: number;
  reason: string;
  priceLabel: string;
  availability: string;
  isAnchor: boolean;
}

export interface QuickPlan {
  title: string;
  subtitle: string;
  stopCount: number;
  requestedStopCount: number;
  budgetStyle: string;
  anchorId: string;
  anchorName: string;
  totalTravelMinutes: number;
  availabilityNote: string;
  stops: QuickPlanStop[];
}

export interface Ticket {
  id: string;
  ticketCode: string;
  status: string;
  eventTitle: string;
  venueName: string;
  city: string;
  startsAt: string | null;
  tierName: string;
  imageUrl: string | null;
}

export interface EchooProfile {
  userId: string;
  username: string;
  displayName: string;
  email: string;
  bio: string;
  photoUrl: string | null;
  homeCity: string;
  interests: string[];
  eventStyles: string[];
  audiences: string[];
  motivations: string[];
  budget: '$' | '$$' | '$$$';
  energy: 'chill' | 'hype' | 'curious';
  tone: 'direct' | 'detailed';
  gender: string;
  dob: string | null;
  nationalities: string[];
  completedAt: string | null;
  linkUpStatus: string | null;
}

export type ConsentChoice = 'yes' | 'no';

export interface OnboardingDraft {
  displayName: string;
  username: string;
  bio: string;
  city: string;
  interests: string[];
  eventStyles: string[];
  audiences: string[];
  motivations: string[];
  budget: '$' | '$$' | '$$$';
  energy: 'chill' | 'hype' | 'curious';
  tone: 'direct' | 'detailed';
  gender: string;
  dob: string;
  nationalities: string[];
  hasPipedaConsent: boolean;
  cityIntelConsent: ConsentChoice | null;
  caslPushConsent: ConsentChoice | null;
}
