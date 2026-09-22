export type DiscoveryIntent =
  | 'discover'
  | 'food'
  | 'cocktails'
  | 'music'
  | 'nightlife'
  | 'comedy'
  | 'sports'
  | 'art'
  | 'late-night'
  | 'cafes'
  | 'markets'
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
  liveSearch?: { status: string; reason?: string };
  understanding?: { searchTerm: string; notices: string[]; canPlan: boolean };
  supported: boolean;
  reason?: string;
  location: EchooLocation;
  intent: { id: string; label: string };
  nearby: DiscoveryLane;
  recommended: DiscoveryLane;
  all: DiscoveryLane;
}

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
  facilityType: string;
  rateSummary?: string;
  rateHalfHour?: number;
  dayMax?: number;
  nightMax?: number;
  paymentMethods: string[];
  googleMapsUrl: string;
  appleMapsUrl: string;
}

export interface PlaceDetail {
  place: Record<string, unknown>;
  profile: Record<string, unknown> | null;
  hours: Array<Record<string, unknown>>;
  sources: Array<Record<string, unknown>>;
  photos: Array<Record<string, unknown>>;
  relatedEvents: Array<Record<string, unknown>>;
  alternatives: Array<Record<string, unknown>>;
  parking?: ParkingFacility[];
  pulse: { items: Array<{ label: string; value: string }> } | null;
}

export interface QuickPlanCostEstimate {
  min: number;
  max: number;
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
  arrivalAt?: string;
  durationMinutes?: number;
  travelMinutes: number;
  reason: string;
  priceLabel: string;
  availability: string;
  isAnchor: boolean;
  /** Evidence-tiered per-person cost window. null = no price evidence; zero = genuinely free. */
  costEstimate?: QuickPlanCostEstimate | null;
  /** Raw price band from the place record, when one exists. */
  priceBand?: string | null;
}

export interface QuickPlanBudgetEstimate {
  min: number;
  max: number;
  currency: string;
  perPerson: boolean;
  knownCount: number;
  unknownCount: number;
}

export interface QuickPlan {
  planId?: string;
  travelMode?: string;
  travelVerified?: boolean;
  startsAt?: string;
  timezone?: string;
  generatedAt?: string;
  city?: string;
  mood?: string;
  totalDurationMinutes?: number;
  alternativesExhausted?: boolean;
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
  /** Summed per-person estimate across priced stops. null = nothing priced. */
  budgetEstimate?: QuickPlanBudgetEstimate | null;
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

export interface TicketSaleItem {
  id: string;
  type: string;
  title: string;
  subtitle: string;
  city: string;
  imageUrl: string;
  statusLabel: string;
  actionLabel: string;
  detailUrl: string;
  source: string;
  startsAt: string | null;
  priceLabel: string;
  category: string;
}

export interface MovieItem {
  tmdb_id: number;
  title: string;
  overview: string;
  curated_copy?: string | null;
  curated_mood?: string | null;
  poster_url?: string | null;
  backdrop_url?: string | null;
  trailer_youtube_id?: string | null;
  has_trailer?: boolean;
  release_date?: string | null;
  year?: string | null;
  vote_average?: number | null;
  vote_count?: number;
  genres?: string[];
  runtime_minutes?: number | null;
  certification?: string | null;
  status?: string;
  is_date_night_pick?: boolean;
}

export interface CinemaRail {
  label: string;
  eyebrow: string;
  movies: MovieItem[];
}

export interface CinemaRails {
  now_playing?: CinemaRail;
  upcoming?: CinemaRail;
  trending?: CinemaRail;
  date_night?: CinemaRail;
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
