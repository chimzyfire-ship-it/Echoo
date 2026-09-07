import { useQuery } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { MapPin, Search, SlidersHorizontal, X } from 'lucide-react-native';
import {
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
import type { DiscoveryCard, DiscoveryIntent } from '@/src/models';
import { useCulture } from '@/src/providers/culture-provider';
import { useEchooLocation } from '@/src/providers/location-provider';
import { getDiscovery } from '@/src/services/api';
import { cultureQueryForIntent } from '@/src/services/culture';
import { cachePlace } from '@/src/services/place-cache';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';

const CATEGORIES: Array<{ key: DiscoveryIntent; label: string }> = [
  { key: 'discover', label: 'Discover' },
  { key: 'food', label: 'Food' },
  { key: 'comedy', label: 'Comedy' },
  { key: 'music', label: 'Live music' },
  { key: 'nightlife', label: 'Nightlife' },
  { key: 'events', label: 'Events' },
  { key: 'tourism', label: 'Tourism' },
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
    setIntent(incomingIntent as DiscoveryIntent);
  }, [incomingIntent]);
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

  function openPlace(place: DiscoveryCard) {
    cachePlace(place);
    router.push({ pathname: '/place/[id]', params: { id: place.canonicalId || place.id } });
  }

  const { width } = useWindowDimensions();
  const featureWidth = Math.min(width - 66, 440);
  const isSearch = Boolean(deferredSearch);
  const mainCards = discovery.data?.all.items ?? [];

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
          {CATEGORIES.map((category) => (
            <Pressable
              key={category.key}
              accessibilityRole="button"
              accessibilityState={{ selected: !isSearch && intent === category.key }}
              onPress={() => { setSearch(''); setIntent(category.key); }}
              style={[styles.categoryTab, !isSearch && intent === category.key && styles.categoryTabActive]}
            >
              <Text style={[styles.categoryLabel, !isSearch && intent === category.key && styles.categoryLabelActive]}>{category.label}</Text>
            </Pressable>
          ))}
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
                <View style={styles.featureHead}><View style={{ flex: 1, gap: 4 }}><Text style={styles.sectionTitle}>Worth going out for</Text><Text style={styles.sectionSub}>Around {discovery.data.location.label}</Text></View></View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} snapToInterval={featureWidth + 14} decelerationRate="fast" contentContainerStyle={styles.featureRail}>
                  {discovery.data.nearby.items.map((place) => <View key={place.id} style={{ width: featureWidth }}><EditorialPlaceCard place={place} featured onPress={() => openPlace(place)} /></View>)}
                </ScrollView>
              </View>
            ) : null}
            {!isSearch && discovery.data?.recommended.items.length ? (
              <DiscoverySection title="Picked for you" subtitle="Your next good find" cards={discovery.data.recommended.items} onOpen={openPlace} />
            ) : null}
            <DiscoverySection
              title={isSearch ? `Results for “${deferredSearch}”` : 'Keep wandering'}
              subtitle={isSearch ? location.label : 'More places. More possibilities.'}
              cards={mainCards}
              onOpen={openPlace}
              emptyBody={isSearch ? 'Try a clearer place, vibe, or neighborhood.' : 'Change your area or pull to refresh.'}
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
});
