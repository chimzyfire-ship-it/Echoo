import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import {
  CalendarDays,
  ChevronRight,
  Film,
  MapPin,
  Sparkles,
  Ticket as TicketIcon,
} from 'lucide-react-native';
import type { ImageSourcePropType } from 'react-native';
import { Image, ImageBackground, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandMark } from '@/src/components/brand-mark';
import { EditorialPlaceCard } from '@/src/components/editorial-place-card';
import type { DiscoveryCard, DiscoveryFeed, EchooProfile, Ticket } from '@/src/models';
import { useAuth } from '@/src/providers/auth-provider';
import { useCulture } from '@/src/providers/culture-provider';
import { useEchooLocation } from '@/src/providers/location-provider';
import { useSurprise } from '@/src/providers/surprise-provider';
import { getDiscovery, getMyTickets } from '@/src/services/api';
import { cachePlace } from '@/src/services/place-cache';
import { surpriseScore, timeContext } from '@/src/services/surprise';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

type BrowseIntent = 'nightlife' | 'events' | 'food';

const ENERGY_QUERIES: Record<EchooProfile['energy'], string> = {
  chill: 'cozy dinner cafes cinemas galleries',
  hype: 'live music nightlife social events',
  curious: 'galleries food events neighbourhood discoveries',
};

const BUDGET_QUERIES: Record<EchooProfile['budget'], string> = {
  $: 'good value casual',
  $$: 'well reviewed dinner',
  $$$: 'special occasion',
};

function greetingForNow() {
  const hour = new Date().getHours();
  if (hour < 5) return 'Good night';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function homeQuery(profile: EchooProfile | null, cultureLabel?: string) {
  const taste = [
    ...(profile?.interests ?? []),
    ...(profile?.eventStyles ?? []),
    ...(profile?.motivations ?? []),
  ]
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' ');
  const context = [
    timeContext().query,
    profile ? ENERGY_QUERIES[profile.energy] : '',
    profile ? BUDGET_QUERIES[profile.budget] : '',
    taste,
  ]
    .filter(Boolean)
    .join(' ');
  return cultureLabel ? `${cultureLabel} culture ${context}` : context;
}

function pickRecommendation(feed: DiscoveryFeed | undefined, profile: EchooProfile | null) {
  if (!feed) return null;

  const seen = new Set<string>();
  const recommended = new Set(feed.recommended.items.map((item) => item.canonicalId || item.id));
  const candidates = [...feed.recommended.items, ...feed.nearby.items, ...feed.all.items].filter((place) => {
    const key = place.canonicalId || place.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!candidates.length) return null;
  if (!profile) return candidates[0];

  return candidates.sort((left, right) => {
    const leftScore = surpriseScore(left, profile) + (recommended.has(left.canonicalId || left.id) ? 0.14 : 0);
    const rightScore = surpriseScore(right, profile) + (recommended.has(right.canonicalId || right.id) ? 0.14 : 0);
    return rightScore - leftScore;
  })[0];
}

function ticketTimeLabel(ticket: Ticket) {
  if (!ticket.startsAt) return ticket.city || 'Date to be confirmed';
  const date = new Date(ticket.startsAt);
  if (!Number.isFinite(date.getTime())) return ticket.city || 'Date to be confirmed';
  return new Intl.DateTimeFormat('en-CA', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function upcomingTicket(tickets: Ticket[] | undefined) {
  if (!tickets?.length) return null;
  const now = Date.now();
  return (
    tickets
      .filter((ticket) => ticket.status.toLowerCase() !== 'cancelled')
      .sort((left, right) => {
        const leftTime = left.startsAt ? new Date(left.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
        const rightTime = right.startsAt ? new Date(right.startsAt).getTime() : Number.MAX_SAFE_INTEGER;
        return leftTime - rightTime;
      })
      .find((ticket) => !ticket.startsAt || new Date(ticket.startsAt).getTime() >= now) ?? null
  );
}

export default function HomeScreen() {
  const router = useRouter();
  const { user, profile } = useAuth();
  const { location } = useEchooLocation();
  const { active: culture } = useCulture();
  const surprise = useSurprise();
  const profileKey = [
    profile?.energy,
    profile?.budget,
    profile?.tone,
    ...(profile?.interests ?? []),
    ...(profile?.eventStyles ?? []),
    ...(profile?.motivations ?? []),
  ].join('|');
  const recommendationQuery = homeQuery(profile, culture?.label);
  const ticketEmail = profile?.email || user?.email || '';

  const discovery = useQuery({
    queryKey: [
      'home-recommendation',
      recommendationQuery,
      profileKey,
      location.city,
      location.latitude,
      location.longitude,
      culture?.slug ?? '',
    ],
    queryFn: ({ signal }) =>
      getDiscovery(
        {
          intent: 'discover',
          query: recommendationQuery,
          location,
          cultureSlug: culture?.slug,
        },
        signal,
      ),
  });

  const tickets = useQuery({
    queryKey: ['my-tickets', ticketEmail],
    enabled: Boolean(ticketEmail),
    queryFn: ({ signal }) => getMyTickets(ticketEmail, signal),
    staleTime: 60_000,
  });

  const recommendation = pickRecommendation(discovery.data, profile);
  const nextTicket = upcomingTicket(tickets.data);
  const displayName = profile?.displayName?.trim().split(/\s+/)[0] || '';

  function openDiscover(intent: BrowseIntent) {
    router.push({ pathname: '/(tabs)/discover', params: { intent } });
  }

  function openRecommendation(place: DiscoveryCard) {
    void triggerHaptic.light();
    cachePlace(place);
    router.push({ pathname: '/place/[id]', params: { id: place.canonicalId || place.id } });
  }

  return (
    <ImageBackground
      source={require('@/assets/new-use1.png')}
      resizeMode="cover"
      style={styles.backgroundImage}
    >
      <LinearGradient
        colors={[
          'rgba(29, 30, 27, 0.55)',
          'rgba(29, 30, 27, 0.82)',
          'rgba(29, 30, 27, 0.97)',
          '#1d1e1b',
        ]}
        locations={[0, 0.28, 0.62, 0.95]}
        style={styles.gradientOverlay}
      >
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Brand & Greeting Area matching Inspi */}
          <View style={styles.topSection}>
            <View style={styles.brandRow}><BrandMark size="small" /><View style={styles.homeLocation}><MapPin size={12} color={Colors.peach} /><Text style={styles.homeLocationText} numberOfLines={1}>{location.city}</Text></View></View>

            <View style={styles.greetingWrap}>
              <Text style={styles.greeting}>
                {greetingForNow()}
                {displayName ? `,\n${displayName}.` : '.'}
              </Text>
            </View>
          </View>

          {/* 4 Mood Action Buttons matching Inspi */}
          <View style={styles.moods}>
            <MoodAction
              label="Go out"
              imageSource={require('@/assets/moods/go-out.jpg')}
              onPress={() => openDiscover('nightlife')}
            />
            <MoodAction
              label="See a show"
              imageSource={require('@/assets/moods/watch.png')}
              onPress={() => openDiscover('events')}
            />
            <MoodAction
              label="Eat"
              imageSource={require('@/assets/moods/eat.png')}
              onPress={() => openDiscover('food')}
            />
            <MoodAction
              label="Surprise me"
              imageSource={require('@/assets/moods/surprise.jpg')}
              accent
              onPress={surprise.start}
            />
          </View>

          {/* Quick Hub Row for Tickets & Cinema */}
          <View style={styles.quickAccessRow}>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void triggerHaptic.light();
                router.push('/tickets');
              }}
              style={({ pressed }) => [styles.quickAccessCard, pressed && styles.pressed]}
            >
              <TicketIcon size={15} color={Colors.peach} />
              <Text style={styles.quickAccessCardText}>Tickets & Passes</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                void triggerHaptic.light();
                router.push('/cinema');
              }}
              style={({ pressed }) => [styles.quickAccessCard, pressed && styles.pressed]}
            >
              <Film size={15} color={Colors.peach} />
              <Text style={styles.quickAccessCardText}>Cinema Room</Text>
            </Pressable>
          </View>

          {/* Featured Place Section matching Inspi */}
          <View style={styles.recommendationSection}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionTitle}>
                {timeContext().label === 'tonight' ? 'Tonight, made personal.' : 'One place to start.'}
              </Text>
            </View>

            {discovery.isLoading ? (
              <View style={styles.loadingCard}>
                <Text style={styles.loadingTitle}>Finding a good move nearby.</Text>
                <Text style={styles.loadingBody}>Using your location and the taste you set during onboarding.</Text>
              </View>
            ) : recommendation ? (
              <EditorialPlaceCard
                place={recommendation}
                featured
                onPress={() => openRecommendation(recommendation)}
              />
            ) : (
              <View style={styles.loadingCard}>
                <Text style={styles.loadingTitle}>
                  {discovery.data?.supported === false
                    ? 'Choose a GTA area to get a recommendation.'
                    : 'Nothing clear has surfaced yet.'}
                </Text>
                <Text style={styles.loadingBody}>
                  Browse the live catalogue and Echoo will keep your active location and culture lens.
                </Text>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/(tabs)/discover')}
                  style={styles.browseButton}
                >
                  <Text style={styles.browseButtonText}>Open Discover</Text>
                  <ChevronRight size={16} color={Colors.background} />
                </Pressable>
              </View>
            )}
          </View>

          {/* Upcoming Event Pass or Ticket Hub */}
          <View style={styles.eveningSection}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionEyebrow}>YOUR EVENING & PASSES</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void triggerHaptic.light();
                  router.push('/tickets');
                }}
                style={styles.quickHubLink}
              >
                <Text style={styles.quickHubText}>Tickets Hub</Text>
                <ChevronRight size={13} color={Colors.peach} />
              </Pressable>
            </View>

            {nextTicket ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open your pass for ${nextTicket.eventTitle || 'your Echoo event'}`}
                onPress={() => {
                  void triggerHaptic.light();
                  router.push('/tickets');
                }}
                style={({ pressed }) => [styles.ticketRow, pressed && styles.ticketPressed]}
              >
                <View style={styles.ticketIcon}>
                  <CalendarDays size={18} color={Colors.peach} />
                </View>
                <View style={styles.ticketCopy}>
                  <Text style={styles.ticketTitle} numberOfLines={1}>
                    {nextTicket.eventTitle || 'Echoo event'}
                  </Text>
                  <Text style={styles.ticketMeta} numberOfLines={1}>
                    {ticketTimeLabel(nextTicket)}
                    {nextTicket.venueName ? ` · ${nextTicket.venueName}` : ''}
                  </Text>
                </View>
                <ChevronRight size={18} color={Colors.textMuted} />
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void triggerHaptic.light();
                  router.push('/tickets');
                }}
                style={({ pressed }) => [styles.ticketRow, pressed && styles.ticketPressed]}
              >
                <View style={styles.ticketIcon}>
                  <TicketIcon size={18} color={Colors.peach} />
                </View>
                <View style={styles.ticketCopy}>
                  <Text style={styles.ticketTitle} numberOfLines={1}>
                    Live Show Drops & Passes
                  </Text>
                  <Text style={styles.ticketMeta} numberOfLines={1}>
                    Priority event allocations & your order passes
                  </Text>
                </View>
                <ChevronRight size={18} color={Colors.textMuted} />
              </Pressable>
            )}
          </View>
        </ScrollView>
      </LinearGradient>
    </ImageBackground>
  );
}

function MoodAction({
  label,
  imageSource,
  accent = false,
  onPress,
}: {
  label: string;
  imageSource: ImageSourcePropType;
  accent?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        void triggerHaptic.light();
        onPress();
      }}
      style={({ pressed }) => [
        styles.moodAction,
        accent && styles.moodActionAccent,
        pressed && styles.moodActionPressed,
      ]}
    >
      <Image source={imageSource} style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]} resizeMode="cover" />
      <LinearGradient colors={['rgba(15,14,12,0.04)', 'rgba(15,14,12,0.9)']} locations={[0.12, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.moodCopy}>
        <Text style={[styles.moodLabel, accent && styles.moodLabelAccent]}>{label}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  gradientOverlay: {
    flex: 1,
  },
  content: {
    padding: 22,
    paddingTop: 16,
    paddingBottom: 48,
    gap: 22,
  },
  topSection: {
    gap: 22,
    marginTop: 4,
  },
  greetingWrap: {
    gap: 8,
  },
  greeting: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 31,
    fontWeight: '600',
    letterSpacing: -0.8,
    lineHeight: 37,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 20 },
  homeLocation: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  homeLocationText: { fontFamily: Fonts.uiMedium, color: Colors.peachLight, fontSize: 12, flexShrink: 1 },
  moods: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  moodAction: { width: '47%', flexGrow: 1, minHeight: 140, overflow: 'hidden', borderRadius: 22, borderCurve: 'continuous', justifyContent: 'flex-end', backgroundColor: '#34302b' },
  moodActionAccent: { borderWidth: 1, borderColor: '#c5a77d' },
  moodActionPressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  moodCopy: { padding: 16 },
  moodLabel: { fontFamily: Fonts.display, color: Colors.ink, fontSize: 23, lineHeight: 27, letterSpacing: -0.5 },
  moodLabelAccent: { color: Colors.peachLight },
  recommendationSection: {
    gap: 14,
  },
  sectionHead: {
    gap: 4,
  },
  sectionEyebrow: {
    color: 'rgba(248, 245, 239, 0.55)',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
  },
  sectionTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 25,
    fontWeight: '600',
    letterSpacing: -0.6,
    lineHeight: 30,
  },
  loadingCard: {
    minHeight: 158,
    justifyContent: 'center',
    gap: 7,
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: 'rgba(24, 22, 21, 0.85)',
    padding: Spacing.lg,
  },
  loadingTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 18,
    letterSpacing: -0.3,
  },
  loadingBody: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 14,
    lineHeight: 20,
  },
  browseButton: {
    minHeight: 40,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: Colors.cardAccent,
    marginTop: 8,
    paddingHorizontal: 16,
  },
  browseButtonText: {
    color: Colors.inkDark,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
    fontWeight: '700',
  },
  eveningSection: {
    gap: 12,
  },
  ticketRow: {
    minHeight: 74,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.10)',
    backgroundColor: 'rgba(24, 22, 21, 0.85)',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  ticketPressed: {
    opacity: 0.72,
  },
  ticketIcon: {
    width: 42,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: Colors.peachSubtle,
  },
  ticketCopy: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  ticketTitle: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 15,
    fontWeight: '600',
  },
  ticketMeta: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 12,
  },
  quickAccessRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: -4,
  },
  quickAccessCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 46,
    borderRadius: 16,
    backgroundColor: 'rgba(248, 245, 239, 0.04)',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.09)',
    paddingHorizontal: 14,
  },
  quickAccessCardText: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    color: Colors.ink,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  quickHubLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: 'rgba(247, 213, 178, 0.08)',
  },
  quickHubText: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    color: Colors.peach,
  },
  pressed: {
    opacity: 0.75,
  },
});
