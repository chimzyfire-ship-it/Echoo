import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import {
  ChevronRight,
  Film,
  MapPin,
  Play,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  Ticket as TicketIcon,
  X,
} from 'lucide-react-native';
import {
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { LinearGradient } from 'expo-linear-gradient';
import { CultureFab } from '@/src/components/culture-fab';
import { CulturePicker } from '@/src/components/culture-picker';
import { LocationPicker } from '@/src/components/location-picker';
import { EditorialPlaceCard } from '@/src/components/editorial-place-card';
import { PrimaryButton } from '@/src/components/primary-button';
import { ScreenLoading, ScreenMessage } from '@/src/components/screen-state';
import type { DiscoveryCard, DiscoveryIntent, MovieItem } from '@/src/models';
import { useCulture } from '@/src/providers/culture-provider';
import { useEchooLocation } from '@/src/providers/location-provider';
import { getDiscovery, getMoviesFeed, getTicketsForSale } from '@/src/services/api';
import { cultureQueryForIntent } from '@/src/services/culture';
import { cachePlace } from '@/src/services/place-cache';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

const CATEGORIES: Array<{
  key: string;
  label: string;
  isRoute?: boolean;
  route?: string;
  headline?: string;
  subhead?: string;
}> = [
  {
    key: 'discover',
    label: 'Discover',
    headline: 'Worth going out for',
    subhead: 'Curated spots around',
  },
  {
    key: 'tickets',
    label: 'Tickets',
    isRoute: true,
    route: '/tickets',
  },
  {
    key: 'cinema',
    label: 'Cinema',
    isRoute: true,
    route: '/cinema',
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
];

export default function DiscoverScreen() {
  const router = useRouter();
  const { intent: requestedIntent } = useLocalSearchParams<{ intent?: string | string[] }>();
  const { location } = useEchooLocation();
  const { active: culture } = useCulture();
  const [search, setSearch] = useState('');
  const [intent, setIntent] = useState<DiscoveryIntent>('discover');
  const [locationOpen, setLocationOpen] = useState(false);
  const [cultureOpen, setCultureOpen] = useState(false);
  const deferredSearch = useDeferredValue(search.trim());
  const activeIntent: DiscoveryIntent = deferredSearch ? 'search' : intent;
  const incomingIntent = Array.isArray(requestedIntent) ? requestedIntent[0] : requestedIntent;

  useEffect(() => {
    if (!CATEGORIES.some((category) => category.key === incomingIntent)) return;
    setSearch('');
    if (incomingIntent === 'tickets') {
      router.push('/tickets');
    } else if (incomingIntent === 'cinema') {
      router.push('/cinema');
    } else {
      setIntent(incomingIntent as DiscoveryIntent);
    }
  }, [incomingIntent, router]);

  const discovery = useQuery({
    queryKey: [
      'discover',
      activeIntent,
      deferredSearch,
      location.city,
      location.latitude,
      location.longitude,
      culture?.slug ?? '',
    ],
    queryFn: ({ signal }) =>
      getDiscovery(
        {
          intent: activeIntent,
          query: cultureQueryForIntent(intent, deferredSearch, culture),
          location,
          cultureSlug: culture?.slug,
        },
        signal
      ),
  });

  const ticketsQuery = useQuery({
    queryKey: ['discover-tickets-for-sale', location.city],
    queryFn: ({ signal }) => getTicketsForSale(location.city, signal),
    staleTime: 120_000,
  });

  const cinemaQuery = useQuery({
    queryKey: ['discover-cinema-feed'],
    queryFn: ({ signal }) => getMoviesFeed(signal),
    staleTime: 120_000,
  });

  const cinemaMovies: MovieItem[] = [
    ...(cinemaQuery.data?.now_playing?.movies ?? []),
    ...(cinemaQuery.data?.date_night?.movies ?? []),
    ...(cinemaQuery.data?.trending?.movies ?? []),
  ].filter((m) => Boolean(m.poster_url));

  function openPlace(place: DiscoveryCard) {
    cachePlace(place);
    router.push({ pathname: '/place/[id]', params: { id: place.canonicalId || place.id } });
  }

  const { width } = useWindowDimensions();
  const featureWidth = Math.min(width - 66, 440);
  const isSearch = Boolean(deferredSearch);
  const mainCards = discovery.data?.all.items ?? [];
  const currentCategory = CATEGORIES.find((c) => c.key === intent);
  const featureTitle = currentCategory?.headline || 'Worth going out for';
  const featureSub = currentCategory?.subhead
    ? `${currentCategory.subhead} ${discovery.data?.location.label || location.label}`
    : `Around ${discovery.data?.location.label || location.label}`;

  const mainTitle = isSearch
    ? `Results for “${deferredSearch}”`
    : intent === 'discover'
    ? 'Keep wandering'
    : `More in ${currentCategory?.label || 'this vibe'}`;
  const mainSub = isSearch
    ? location.label
    : intent === 'discover'
    ? 'More places. More possibilities.'
    : `Curated picks across ${location.label}`;

  return (
    <View style={styles.screen}>
      <LinearGradient pointerEvents="none" colors={['#302c25', '#1d1e1b', '#1d1e1b']} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFill} />
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={discovery.isRefetching} onRefresh={discovery.refetch} tintColor={Colors.peach} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.filterRow}>
          <Pressable accessibilityRole="button" onPress={() => setLocationOpen(true)} style={styles.locationButton}>
            <MapPin size={15} color={Colors.peach} />
            <Text style={styles.locationText} numberOfLines={1}>{location.label}</Text>
            <SlidersHorizontal size={14} color={Colors.textSecondary} />
          </Pressable>
          {culture ? (
            <Pressable accessibilityRole="button" accessibilityLabel={`Culture lens: ${culture.label}. Tap to change.`} onPress={() => setCultureOpen(true)} style={styles.cultureButton}>
              <Text style={styles.cultureText} numberOfLines={1}>{culture.label}</Text>
              <X size={13} color={Colors.peach} />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.topCopy}>
          <Text style={styles.kicker}>DISCOVER</Text>
          <Text style={styles.title}>{culture ? `${culture.label} culture, tonight.` : 'Your next good find.'}</Text>
        </View>

        <View style={styles.searchBox}>
          <Search size={18} color={Colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            accessibilityLabel="Search places, food, or music"
            placeholder="A place, a craving, a mood…"
            placeholderTextColor={Colors.textMuted}
            returnKeyType="search"
            style={styles.searchInput}
          />
          {search ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" style={styles.clearSearch} onPress={() => setSearch('')}>
              <X size={18} color={Colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {CATEGORIES.map((category) => {
            const isSelected = !isSearch && intent === category.key;
            return (
              <Pressable
                key={category.key}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                onPress={() => {
                  if (category.isRoute && category.route) {
                    void triggerHaptic.light();
                    router.push(category.route as any);
                    return;
                  }
                  setSearch('');
                  setIntent(category.key as DiscoveryIntent);
                }}
                style={[styles.categoryTab, isSelected && styles.categoryTabActive]}
              >
                <Text style={[styles.categoryLabel, isSelected && styles.categoryLabelActive]}>
                  {category.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {discovery.isLoading ? (
          <ScreenLoading label="Finding what is good nearby." />
        ) : discovery.isError ? (
          <ScreenMessage
            title="Discover could not load"
            body={discovery.error instanceof Error ? discovery.error.message : 'Try again in a moment.'}
            action={<PrimaryButton label="Try again" onPress={() => discovery.refetch()} />}
          />
        ) : discovery.data?.supported === false ? (
          <ScreenMessage
            title="Echoo is GTA-only right now"
            body="Choose a supported GTA municipality to see live discovery."
            action={<PrimaryButton label="Choose an area" onPress={() => setLocationOpen(true)} />}
          />
        ) : (
          <>
            {!isSearch && discovery.data?.nearby.items.length ? (
              <View style={styles.section}>
                <View style={styles.featureHead}><View style={{ flex: 1, gap: 4 }}><Text style={styles.sectionTitle}>{featureTitle}</Text><Text style={styles.sectionSub}>{featureSub}</Text></View></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={featureWidth + 14} decelerationRate="fast" contentContainerStyle={styles.featureRail}>
                  {discovery.data.nearby.items.map((place) => <View key={place.id} style={{ width: featureWidth }}><EditorialPlaceCard place={place} featured onPress={() => openPlace(place)} /></View>)}
                </ScrollView>
              </View>
            ) : null}

            {/* Live Show Drops & Tickets Rail - shown on main discover */}
            {!isSearch && intent === 'discover' && ticketsQuery.data?.length ? (
              <View style={styles.section}>
                <View style={styles.featureHead}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.sectionTitle}>Live show drops</Text>
                    <Text style={styles.sectionSub}>Priority booking around {location.label}</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/tickets')}
                    style={styles.seeAllLink}
                  >
                    <Text style={styles.seeAllText}>All tickets</Text>
                    <ChevronRight size={14} color={Colors.peach} />
                  </Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.featureRail}>
                  {ticketsQuery.data.slice(0, 6).map((ticket) => (
                    <Pressable
                      key={ticket.id}
                      accessibilityRole="button"
                      onPress={() => {
                        void triggerHaptic.light();
                        if (ticket.detailUrl) void Linking.openURL(ticket.detailUrl);
                        else router.push('/tickets');
                      }}
                      style={({ pressed }) => [styles.ticketDropCard, pressed && styles.pressed]}
                    >
                      <View style={styles.ticketDropArt}>
                        {ticket.imageUrl ? (
                          <Image source={{ uri: ticket.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        ) : (
                          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#282622' }]} />
                        )}
                        <LinearGradient
                          colors={['transparent', 'rgba(10,9,8,0.85)']}
                          locations={[0.2, 1]}
                          style={StyleSheet.absoluteFill}
                        />
                        <View style={styles.ticketDropBadge}>
                          <Text style={styles.ticketDropBadgeText}>{ticket.statusLabel || 'Selling now'}</Text>
                        </View>
                        <View style={styles.ticketPriceBadge}>
                          <Text style={styles.ticketPriceBadgeText}>{ticket.priceLabel}</Text>
                        </View>
                      </View>
                      <View style={styles.ticketDropCopy}>
                        <Text style={styles.ticketDropTitle} numberOfLines={1}>
                          {ticket.title}
                        </Text>
                        <Text style={styles.ticketDropMeta} numberOfLines={1}>
                          {ticket.subtitle || ticket.city}
                        </Text>
                      </View>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {/* Cinema Room & Movie Trailers Rail - shown on main discover */}
            {!isSearch && intent === 'discover' && cinemaMovies.length ? (
              <View style={styles.section}>
                <View style={styles.featureHead}>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={styles.sectionTitle}>Cinema room</Text>
                    <Text style={styles.sectionSub}>Trailers worth planning a night around</Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/cinema')}
                    style={styles.seeAllLink}
                  >
                    <Text style={styles.seeAllText}>Cinema room</Text>
                    <ChevronRight size={14} color={Colors.peach} />
                  </Pressable>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.featureRail}>
                  {cinemaMovies.slice(0, 6).map((movie) => (
                    <Pressable
                      key={movie.tmdb_id || movie.title}
                      accessibilityRole="button"
                      onPress={() => {
                        void triggerHaptic.light();
                        router.push('/cinema');
                      }}
                      style={({ pressed }) => [styles.cinemaCard, pressed && styles.pressed]}
                    >
                      <View style={styles.cinemaArt}>
                        {movie.poster_url ? (
                          <Image source={{ uri: movie.poster_url }} style={StyleSheet.absoluteFill} resizeMode="cover" />
                        ) : (
                          <View style={[StyleSheet.absoluteFill, { backgroundColor: '#262420' }]} />
                        )}
                        <View style={styles.cinemaPlayGlyph}>
                          <Play size={11} color={Colors.ink} fill={Colors.ink} />
                        </View>
                        {movie.vote_average ? (
                          <View style={styles.cinemaRatingBadge}>
                            <Star size={9} color="#f5cf7e" fill="#f5cf7e" />
                            <Text style={styles.cinemaRatingText}>{movie.vote_average.toFixed(1)}</Text>
                          </View>
                        ) : null}
                      </View>
                      <Text style={styles.cinemaTitle} numberOfLines={1}>
                        {movie.title}
                      </Text>
                      <Text style={styles.cinemaMeta} numberOfLines={1}>
                        {[movie.year, movie.genres?.[0]].filter(Boolean).join(' · ')}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}

            {!isSearch && discovery.data?.recommended.items.length ? (
              <DiscoverySection title="Picked for you" subtitle="Your next good find" cards={discovery.data.recommended.items} onOpen={openPlace} />
            ) : null}
            <DiscoverySection
              title={mainTitle}
              subtitle={mainSub}
              cards={mainCards}
              onOpen={openPlace}
              emptyBody={isSearch ? 'Try a clearer place, vibe, or neighborhood.' : `No places found for ${currentCategory?.label.toLowerCase() || 'this vibe'} in this area yet. Try changing municipality or clearing your culture lens.`}
            />
          </>
        )}
      </ScrollView>
      <LocationPicker visible={locationOpen} onClose={() => setLocationOpen(false)} />
      <CultureFab onOpenPicker={() => setCultureOpen(true)} />
      <CulturePicker visible={cultureOpen} onClose={() => setCultureOpen(false)} />
    </View>
  );
}

function DiscoverySection({
  title,
  subtitle,
  cards,
  onOpen,
  emptyBody,
  featured = false,
}: {
  title: string;
  subtitle: string;
  cards: DiscoveryCard[];
  onOpen: (place: DiscoveryCard) => void;
  emptyBody?: string;
  featured?: boolean;
}) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSub}>{subtitle}</Text>
      </View>
      {cards.length ? (
        <View style={styles.grid}>
          {featured && cards[0] ? <View style={styles.heroCell}><EditorialPlaceCard place={cards[0]} featured onPress={() => onOpen(cards[0])} /></View> : null}
          {(featured ? cards.slice(1) : cards).map((place) => (
            <View key={place.id} style={styles.gridCell}>
              <EditorialPlaceCard place={place} onPress={() => onOpen(place)} />
            </View>
          ))}
        </View>
      ) : (
        <Text style={styles.empty}>{emptyBody || 'No verified cards are available for this lane yet.'}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#1d1e1b',
  },
  featureHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  featureRail: { gap: 14, paddingRight: 2 },
  swipeHint: { fontFamily: Fonts.uiMedium, fontSize: 9, letterSpacing: 1.2, color: Colors.peach },
  content: {
    padding: 22,
    paddingBottom: 110,
    gap: 16,
  },
  topCopy: {
    gap: 10,
    marginTop: 0,
  },
  kicker: {
    color: 'rgba(248, 245, 239, 0.55)',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  title: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 31,
    fontWeight: '600',
    letterSpacing: -0.7,
    lineHeight: 37,
  },
  locationButton: {
    alignSelf: 'flex-start',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.14)',
    backgroundColor: 'rgba(248, 245, 239, 0.035)',
    paddingHorizontal: 12,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  cultureButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.14)',
    backgroundColor: 'rgba(248, 245, 239, 0.035)',
    paddingHorizontal: 11,
  },
  cultureText: {
    color: Colors.peachLight,
    fontFamily: Fonts.uiMedium,
    fontSize: 12,
    maxWidth: 110,
  },
  locationText: {
    color: Colors.peachLight,
    fontFamily: Fonts.uiMedium,
    fontSize: 13,
    maxWidth: 220,
  },
  searchBox: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.10)',
    backgroundColor: 'rgba(248, 245, 239, 0.06)',
    paddingHorizontal: 14,
  },
  searchInput: {
    flex: 1,
    color: Colors.ink,
    fontFamily: Fonts.ui,
    fontSize: 15,
    paddingVertical: 0,
  },
  clearSearch: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  heroCell: { width: '100%', marginBottom: 2 },
  filters: { gap: 22, paddingBottom: 2 },
  categoryTab: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 2, borderBottomColor: 'transparent' },
  categoryTabActive: { borderBottomColor: Colors.peach },
  categoryLabel: { fontFamily: Fonts.uiMedium, fontSize: 14, color: '#b9b3a9' },
  categoryLabelActive: { color: Colors.peachLight, fontFamily: Fonts.uiSemiBold },
  section: {
    marginTop: 6,
    gap: 18,
  },
  sectionHead: {
    gap: 2,
  },
  sectionTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 25,
    fontWeight: '600',
    letterSpacing: -0.4,
  },
  sectionSub: {
    color: 'rgba(248, 245, 239, 0.52)',
    fontFamily: Fonts.ui,
    fontSize: 12,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 14,
    rowGap: 24,
  },
  gridCell: {
    width: '47%',
    flexGrow: 1,
    maxWidth: '49%',
  },
  empty: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 14,
    lineHeight: 21,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.08)',
    backgroundColor: 'rgba(248, 245, 239, 0.035)',
    padding: Spacing.md,
  },
  seeAllLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 34,
    paddingHorizontal: 10,
    borderRadius: 17,
    backgroundColor: 'rgba(247, 213, 178, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(247, 213, 178, 0.2)',
  },
  seeAllText: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    color: Colors.peach,
  },
  ticketDropCard: {
    width: 220,
    borderRadius: 18,
    backgroundColor: 'rgba(248, 245, 239, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.09)',
    overflow: 'hidden',
  },
  ticketDropArt: {
    height: 125,
    position: 'relative',
    backgroundColor: '#262420',
  },
  ticketDropBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(10, 9, 8, 0.65)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  ticketDropBadgeText: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  ticketPriceBadge: {
    position: 'absolute',
    bottom: 10,
    right: 10,
    backgroundColor: 'rgba(247, 213, 178, 0.9)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  ticketPriceBadgeText: {
    color: Colors.inkDark,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    fontWeight: '700',
  },
  ticketDropCopy: {
    padding: 12,
    gap: 4,
  },
  ticketDropTitle: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 14,
  },
  ticketDropMeta: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 12,
  },
  cinemaCard: {
    width: 128,
    gap: 6,
  },
  cinemaArt: {
    height: 180,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#262420',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.08)',
    position: 'relative',
  },
  cinemaPlayGlyph: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(10, 9, 8, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cinemaRatingBadge: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(10, 9, 8, 0.72)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  cinemaRatingText: {
    color: '#f5cf7e',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 10,
    fontWeight: '700',
  },
  cinemaTitle: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
  },
  cinemaMeta: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 11,
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.985 }],
  },
});
