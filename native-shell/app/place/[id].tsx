import { useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowUpRight, Clock, MapPin, Navigation, X } from 'lucide-react-native';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { NearbyStays } from '@/src/components/nearby-stays';
import { PrimaryButton } from '@/src/components/primary-button';
import { ScreenLoading, ScreenMessage } from '@/src/components/screen-state';
import { getPlaceDetail, type QuickPlanProfileInput } from '@/src/services/api';
import { OutingChoices } from '@/src/components/outing-choices';
import { defaultOutingChoices, generateOuting } from '@/src/services/outing';
import { getCachedPlace } from '@/src/services/place-cache';
import { placeSummary } from '@/src/services/place-summary';
import { checkIn } from '@/src/services/linkup';
import { useAuth } from '@/src/providers/auth-provider';
import { useEchooLocation } from '@/src/providers/location-provider';
import type { DiscoveryCard, ParkingFacility } from '@/src/models';
import { Colors, Fonts } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function openMaps(uri: string) {
  void Linking.openURL(uri).catch(() => {});
}

export default function PlaceDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, user } = useAuth();
  const { location } = useEchooLocation();
  const [selectedPhoto, setSelectedPhoto] = useState<string>();
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const [choices, setChoices] = useState(defaultOutingChoices);
  const [settingUpOuting, setSettingUpOuting] = useState(false);
  const { id: rawId, section } = useLocalSearchParams<{ id?: string | string[]; section?: string }>();
  const routeId = Array.isArray(rawId) ? rawId[0] ?? '' : rawId ?? '';
  const cached = getCachedPlace(routeId);
  const canonicalId = cached?.canonicalId || routeId;
  // Onboarding taste plus the active location — never invented spending
  // history, never a stale city.
  const quickPlanProfile: QuickPlanProfileInput = {
    interests: profile?.interests ?? [],
    eventStyles: profile?.eventStyles ?? [],
    audiences: profile?.audiences ?? [],
    motivations: profile?.motivations ?? [],
    budget: profile?.budget ?? '$',
    energy: profile?.energy ?? 'chill',
    city: location.city,
  };

  const detail = useQuery({
    queryKey: ['place-detail', canonicalId],
    enabled: Boolean(canonicalId),
    queryFn: ({ signal }) => getPlaceDetail(canonicalId, signal),
    retry: (failureCount, error) => {
      const status = (error as { status?: number }).status;
      if (status === 404 || status === 422) return false;
      return failureCount < 1;
    },
  });

  const quickPlan = useMutation({
    mutationFn: () => {
      // Tapped from Discover: the cached card carries the verified cover and
      // canonical id. Direct-linked: rebuild the anchor from the loaded
      // detail instead of demanding the user arrive via Discover.
      if (cached) return generateOuting({ anchor: cached, stopCount: choices.stopCount, profile: quickPlanProfile }, choices, user?.id);
      const place = (detail.data?.place as Record<string, unknown> | undefined) ?? {};
      const name = text(place.name);
       const remoteLatitude = Number(place.latitude ?? place.lat ?? NaN);
       const remoteLongitude = Number(place.longitude ?? place.lng ?? NaN);
      const photoUrl = (detail.data?.photos ?? [])
        .map((photo) => text(photo.image_url))
        .find(Boolean);
      if (
        !canonicalId ||
        !name ||
        !Number.isFinite(remoteLatitude) ||
        !Number.isFinite(remoteLongitude)
      ) {
        throw new Error('This place needs a name and location before Echoo can plan around it.');
      }
      const anchor: DiscoveryCard = {
        id: canonicalId,
        canonicalId: null,
        source: 'echoo',
        type: 'place',
        title: name,
        category: text(place.category) || 'place',
        description: '',
        city: text(place.city) || text(place.municipality) || location.city,
        address: text(place.formatted_address) || text(place.address) || null,
        latitude: remoteLatitude,
        longitude: remoteLongitude,
        distanceMeters: null,
        startsAt: null,
        image: photoUrl ? { url: photoUrl, alt: name } : null,
        features: [],
        community: null,
        placement: null,
      };
      return generateOuting({ anchor, stopCount: choices.stopCount, profile: quickPlanProfile }, choices, user?.id);
    },
    onSuccess: (plan) => {
      void triggerHaptic.success();
      router.push({
        pathname: '/planner',
        params: { quickPlan: JSON.stringify(plan) },
      });
    },
  });

  const linkUp = useMutation({
    mutationFn: () => checkIn(canonicalId),
    onSuccess: () => {
      void triggerHaptic.success();
      router.push('/(tabs)/link-up');
    },
  });

  if (settingUpOuting) return <ScrollView style={styles.root} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 24, paddingBottom: Math.max(insets.bottom, 24), gap: 24 }}>
    <Pressable accessibilityRole="button" onPress={() => setSettingUpOuting(false)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={styles.dockSubtitle}>Back to place</Text></Pressable>
    <Text style={styles.title}>Plan an outing</Text>
    <Text style={styles.dockSubtitle}>Keep {cached?.title || text((detail.data?.place as Record<string, unknown> | undefined)?.name) || 'this place'} in your day. Choose what comes with it.</Text>
    <OutingChoices value={choices} onChange={setChoices} disabled={quickPlan.isPending} />
    <Text style={styles.note}>Spending preferences guide nearby picks, not guaranteed prices. Your chosen place stays even if its price differs. Missing prices and hours are always marked.</Text>
    {quickPlan.isError ? <Text selectable style={styles.dockError}>{quickPlan.error instanceof Error ? quickPlan.error.message : 'Could not create an outing.'}</Text> : null}
    <PrimaryButton label={quickPlan.isPending ? 'Finding your outing...' : `Plan ${choices.stopCount} places`} onPress={() => quickPlan.mutate()} disabled={quickPlan.isPending} />
  </ScrollView>;

  if (detail.isLoading && !cached) {
    return (
      <View style={styles.screen}>
        <ScreenLoading label="Pulling the place together." />
      </View>
    );
  }

  if (detail.isError && !cached) {
    return (
      <View style={styles.screen}>
        <ScreenMessage
          title="This place is unavailable"
          body={detail.error instanceof Error ? detail.error.message : 'Try again in a moment.'}
          action={<PrimaryButton label="Close" variant="secondary" onPress={() => router.back()} />}
        />
      </View>
    );
  }

  const data = detail.data;
  const place = (data?.place as Record<string, unknown> | undefined) ?? {};
  const name = text(place.name) || cached?.title || 'This place';
  const address = text(place.formatted_address) || text(place.address) || cached?.address || cached?.city || '';
  const remoteLatitude = Number(place.latitude ?? place.lat ?? NaN);
  const remoteLongitude = Number(place.longitude ?? place.lng ?? NaN);
  const latitude = Number.isFinite(remoteLatitude)
    ? remoteLatitude
    : typeof cached?.latitude === 'number'
      ? cached.latitude
      : Number.NaN;
  const longitude = Number.isFinite(remoteLongitude)
    ? remoteLongitude
    : typeof cached?.longitude === 'number'
      ? cached.longitude
      : Number.NaN;
  const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude);
  const approvedPhotos = (data?.photos ?? [])
    .map((photo) => text(photo.image_url))
    .filter(Boolean)
    .slice(0, 4);
  const photos = approvedPhotos.length ? approvedPhotos : cached?.image?.url ? [cached.image.url] : [];
  const pulseItems = data?.pulse?.items.slice(0, 3) ?? [];
  const profileRow = (data?.profile as Record<string, unknown> | null | undefined) ?? null;
  const vibeTags = Array.isArray(profileRow?.vibe_tags)
    ? (profileRow!.vibe_tags as string[]).slice(0, 4)
    : [];
  const hoursToday = (data?.hours ?? []).find(
    (row) => Number(row.day_of_week) === new Date().getDay()
  );
  const description = placeSummary({
    ...cached,
    title: name,
    description: text(place.description) || cached?.description,
    category: text(place.category) || cached?.category,
    city: text(place.city) || cached?.city,
    address,
  }, data?.pulse?.items);
  const heroPhoto = selectedPhoto && photos.includes(selectedPhoto) ? selectedPhoto : photos[0];
  const parkingFacilities = (data?.parking as ParkingFacility[] | undefined) ?? [];

  return (
    <View style={styles.root}>
    <ScrollView
      style={styles.scroll}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={styles.screen}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.hero}>
        {heroPhoto && failedPhoto !== heroPhoto ? (
          <Image source={{ uri: heroPhoto }} style={styles.heroImage} resizeMode="cover" onError={() => setFailedPhoto(heroPhoto)} />
        ) : (
          <LinearGradient colors={['#655a49', '#282b25']} style={styles.heroFallback}><MapPin size={42} strokeWidth={1} color={Colors.peach} /></LinearGradient>
        )}
        <LinearGradient pointerEvents="none" colors={['rgba(15,17,14,0.22)', 'transparent', 'rgba(15,17,14,0.88)']} locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />
        <Pressable accessibilityRole="button" accessibilityLabel="Close place details" onPress={() => router.back()} style={styles.closeButton}><X size={21} color={Colors.ink} /></Pressable>
        <View style={styles.heroCaption}>
          <Text style={styles.kicker}>{(text(place.category) || cached?.category || 'PLACE').replace(/[_-]+/g, ' ').toUpperCase()}</Text>
          <Text style={styles.title}>{name}</Text>
          {photos.length > 1 ? <Text style={styles.photoCount}>{photos.indexOf(heroPhoto) + 1} / {photos.length} PHOTOS</Text> : null}
        </View>
      </View>
      {photos.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.photoRow}>
        {photos.map((uri, index) => <Pressable key={uri} accessibilityRole="button" accessibilityLabel={`View photo ${index + 1} of ${photos.length}`} accessibilityState={{ selected: uri === heroPhoto }} onPress={() => setSelectedPhoto(uri)} style={[styles.photoButton, uri === heroPhoto && styles.photoSelected]}><Image source={{ uri }} style={styles.photoThumb} resizeMode="cover" /></Pressable>)}
      </ScrollView> : null}

      <View style={styles.body}>
        {hasCoords && section === 'stays' ? <NearbyStays key={`${latitude}:${longitude}:open`} latitude={latitude} longitude={longitude} destinationName={name} initiallyOpen /> : null}
        <Text style={styles.sectionLabel}>THE ESSENTIALS</Text>
        <View style={styles.metaRow}>
          {address ? (
            <View style={styles.metaItem}>
              <MapPin size={14} color="#c4ad89" />
              <Text style={styles.metaText} selectable>
                {address}
              </Text>
            </View>
          ) : null}
          {hoursToday && !hoursToday.is_closed && text(hoursToday.opens_at) ? (
            <View style={styles.metaItem}>
              <Clock size={14} color="#c4ad89" />
              <Text style={styles.metaText}>
                {text(hoursToday.opens_at)} – {text(hoursToday.closes_at)}
              </Text>
            </View>
          ) : null}
        </View>

        {description ? <View style={styles.about}><Text style={styles.sectionTitle}>A closer look.</Text><Text style={styles.description}>{description}</Text></View> : null}

        {pulseItems.length ? (
          <View style={styles.pulseList}>
            {pulseItems.map((item) => (
              <View key={`${item.label}:${item.value}`} style={styles.pulseRow}>
                <Text style={styles.pulseLabel}>{item.label}</Text>
                <Text style={styles.pulseValue} selectable>
                  {item.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        {vibeTags.length ? (
          <View style={styles.tagRow}>
            {vibeTags.map((tag) => (
              <View key={tag} style={styles.tag}>
                <Text style={styles.tagText}>{tag}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {hasCoords && section !== 'stays' ? <NearbyStays key={`${latitude}:${longitude}`} latitude={latitude} longitude={longitude} destinationName={name} /> : null}

        <Text style={styles.sectionLabel}>GET THERE & CONNECT</Text>
        <View style={styles.actions}>
          {hasCoords ? (
            <View style={styles.actionCell}><PrimaryButton
              label="Directions"
              variant="secondary"
              onPress={() => {
                void triggerHaptic.light();
                openMaps(`https://maps.apple.com/?daddr=${latitude},${longitude}`);
              }}
              icon={<Navigation size={17} color={Colors.ink} />}
            /></View>
          ) : null}
          {hasCoords ? (
            <View style={styles.actionCell}><PrimaryButton
              label="Ride there"
              variant="secondary"
              onPress={() => {
                void triggerHaptic.light();
                openMaps(`https://m.uber.com/ul/?action=setPickup&dropoff[latitude]=${latitude}&dropoff[longitude]=${longitude}&dropoff[nickname]=${encodeURIComponent(name)}`);
              }}
              icon={<ArrowUpRight size={17} color={Colors.ink} />}
            /></View>
          ) : null}
          <PrimaryButton
            label="Check in for Link Up"
            variant="quiet"
            onPress={() => linkUp.mutate()}
            loading={linkUp.isPending}
            disabled={!canonicalId}
          />
        </View>

        {linkUp.isError ? (
          <Text style={styles.error}>{linkUp.error instanceof Error ? linkUp.error.message : 'Link Up check-in failed.'}</Text>
        ) : null}

        {parkingFacilities.length ? (
          <View style={styles.parkingSection}>
            <View style={styles.parkingHeader}>
              <View style={styles.parkingBadge}>
                <Text style={styles.parkingBadgeText}>P</Text>
              </View>
              <View style={styles.parkingHeaderText}>
                <Text style={styles.sectionLabel}>NEARBY PARKING</Text>
                <Text style={styles.parkingSubtext}>Toronto Green P</Text>
              </View>
              <View style={styles.parkingPill}>
                <Text style={styles.parkingPillText}>
                  {parkingFacilities[0].walkingMinutes} min walk
                </Text>
              </View>
            </View>

            <View style={styles.parkingCard}>
              <View style={styles.parkingMain}>
                <Text style={styles.parkingName}>{parkingFacilities[0].name}</Text>
                <Text style={styles.parkingAddress}>
                  {parkingFacilities[0].address} ·{' '}
                  <Text style={styles.parkingDist}>
                    {parkingFacilities[0].distanceMeters < 1000
                      ? `${parkingFacilities[0].distanceMeters} m`
                      : `${(parkingFacilities[0].distanceMeters / 1000).toFixed(1)} km`}{' '}
                    away
                  </Text>
                </Text>
              </View>

              {parkingFacilities[0].rateSummary ? (
                <View style={styles.parkingRateTag}>
                  <Text style={styles.parkingRateText}>
                    {parkingFacilities[0].rateSummary}
                  </Text>
                </View>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Directions to ${parkingFacilities[0].name}`}
                onPress={() => {
                  void triggerHaptic.light();
                  openMaps(
                    parkingFacilities[0].appleMapsUrl ||
                      `https://maps.apple.com/?daddr=${parkingFacilities[0].latitude},${parkingFacilities[0].longitude}`
                  );
                }}
                style={({ pressed }) => [
                  styles.parkingButton,
                  pressed && styles.parkingButtonPressed,
                ]}
              >
                <Navigation size={15} color="#ead2ae" />
                <Text style={styles.parkingButtonText}>Directions to Parking</Text>
              </Pressable>

              {parkingFacilities.length > 1 ? (
                <View style={styles.parkingAltList}>
                  <Text style={styles.parkingAltHeader}>MORE SPOTS NEARBY</Text>
                  {parkingFacilities.slice(1, 3).map((alt) => (
                    <View key={alt.id} style={styles.parkingAltRow}>
                      <View style={styles.parkingAltInfo}>
                        <Text style={styles.parkingAltName} numberOfLines={1}>
                          {alt.name}
                        </Text>
                        <Text style={styles.parkingAltMeta}>
                          {alt.distanceMeters < 1000
                            ? `${alt.distanceMeters}m`
                            : `${(alt.distanceMeters / 1000).toFixed(1)}km`}{' '}
                          · {alt.walkingMinutes}m walk
                          {alt.rateSummary ? ` · ${alt.rateSummary.split('·')[0].trim()}` : ''}
                        </Text>
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Map to ${alt.name}`}
                        onPress={() => {
                          void triggerHaptic.light();
                          openMaps(
                            alt.appleMapsUrl ||
                              `https://maps.apple.com/?daddr=${alt.latitude},${alt.longitude}`
                          );
                        }}
                        style={styles.parkingAltLink}
                      >
                        <Text style={styles.parkingAltLinkText}>Map ↗</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        <Text style={styles.note}>
          Place details and photos from Echoo. Check with the venue for the latest hours.
        </Text>
      </View>
    </ScrollView>
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      {quickPlan.isError ? (
        <Text style={styles.dockError}>{quickPlan.error instanceof Error ? quickPlan.error.message : 'Quick Plan failed.'}</Text>
      ) : null}
      <PrimaryButton label="Plan an outing" onPress={() => {
        setChoices({ ...defaultOutingChoices, budgetStyle: profile?.budget === '$$$' ? 'elevated' : profile?.budget === '$$' ? 'balanced' : 'value', mood: profile?.energy === 'hype' || profile?.energy === 'curious' ? profile.energy : 'chill' });
        setSettingUpOuting(true);
      }} />
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#1d1e1b' },
  scroll: { flex: 1, backgroundColor: '#1d1e1b' },
  screen: { paddingBottom: 24 },
  hero: { minHeight: 300, justifyContent: 'flex-end', backgroundColor: '#30342d', overflow: 'hidden' },
  heroImage: { ...StyleSheet.absoluteFill },
  heroFallback: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  closeButton: { position: 'absolute', top: 18, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(20,23,19,0.62)', alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  heroCaption: { paddingHorizontal: 26, paddingBottom: 30, paddingTop: 110, gap: 10 },
  kicker: { color: '#ead2ae', fontFamily: Fonts.uiSemiBold, fontSize: 10, letterSpacing: 1.8 },
  title: { color: '#fffaf2', fontFamily: Fonts.display, fontSize: 31, lineHeight: 36, letterSpacing: -0.9 },
  photoCount: { color: '#e0d8cb', fontFamily: Fonts.uiMedium, fontSize: 10, letterSpacing: 1.3, marginTop: 4 },
  photoRow: { paddingHorizontal: 24, paddingTop: 20, gap: 10 },
  photoButton: { width: 72, height: 60, borderRadius: 12, padding: 3, borderWidth: 1.5, borderColor: 'transparent' },
  photoSelected: { borderColor: '#7a6548' },
  photoThumb: { width: '100%', height: '100%', borderRadius: 8, backgroundColor: '#d6d0c5' },
  body: { padding: 24, gap: 18 },
  sectionLabel: { fontFamily: Fonts.uiSemiBold, color: '#b8a78d', fontSize: 10, letterSpacing: 1.8 },
  sectionTitle: { fontFamily: Fonts.display, color: '#f0ece3', fontSize: 26, letterSpacing: -0.5 },
  metaRow: { gap: 14, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: 'rgba(240,236,227,0.10)' },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  metaText: { flex: 1, color: '#c1c0b7', fontFamily: Fonts.ui, fontSize: 14, lineHeight: 21 },
  about: { gap: 12, paddingTop: 4 },
  description: { color: '#c1c0b7', fontFamily: Fonts.ui, fontSize: 15, lineHeight: 25 },
  pulseList: { padding: 20, backgroundColor: '#272923', borderRadius: 18, gap: 16 },
  pulseRow: { gap: 4 },
  pulseLabel: { color: '#b8a78d', fontFamily: Fonts.uiSemiBold, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  pulseValue: { color: '#f0ece3', fontFamily: Fonts.uiMedium, fontSize: 14, lineHeight: 20 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  tag: { borderRadius: 30, backgroundColor: '#30352b', paddingHorizontal: 13, paddingVertical: 8 },
  tagText: { color: '#c7d1b9', fontFamily: Fonts.uiMedium, fontSize: 12 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  actionCell: { flex: 1, minWidth: '44%' },
  error: { color: '#a1362b', fontFamily: Fonts.ui, fontSize: 13, lineHeight: 19, padding: 12, borderRadius: 12, backgroundColor: '#f6dcd5' },
  note: { color: '#a4a79b', fontFamily: Fonts.ui, fontSize: 11, lineHeight: 17 },
  parkingSection: { gap: 12, marginTop: 4 },
  parkingHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  parkingBadge: { width: 28, height: 28, borderRadius: 8, backgroundColor: 'rgba(231,201,142,0.15)', borderWidth: 1, borderColor: 'rgba(231,201,142,0.4)', alignItems: 'center', justifyContent: 'center' },
  parkingBadgeText: { color: '#ead2ae', fontFamily: Fonts.uiSemiBold, fontSize: 13 },
  parkingHeaderText: { flex: 1, marginLeft: 10, gap: 2 },
  parkingSubtext: { color: '#a4a79b', fontFamily: Fonts.ui, fontSize: 11 },
  parkingPill: { backgroundColor: 'rgba(231,201,142,0.1)', borderWidth: 1, borderColor: 'rgba(231,201,142,0.25)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
  parkingPillText: { color: '#ead2ae', fontFamily: Fonts.uiSemiBold, fontSize: 11 },
  parkingCard: { backgroundColor: 'rgba(243,209,161,0.035)', borderWidth: 1, borderColor: 'rgba(231,201,142,0.25)', borderRadius: 16, padding: 16, gap: 12 },
  parkingMain: { gap: 4 },
  parkingName: { color: '#fffaf2', fontFamily: Fonts.display, fontSize: 18, letterSpacing: -0.3 },
  parkingAddress: { color: '#c1c0b7', fontFamily: Fonts.ui, fontSize: 13, lineHeight: 18 },
  parkingDist: { color: '#ead2ae', fontFamily: Fonts.uiMedium },
  parkingRateTag: { alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  parkingRateText: { color: '#f0ece3', fontFamily: Fonts.uiMedium, fontSize: 11 },
  parkingButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 42, borderRadius: 10, backgroundColor: 'rgba(231,201,142,0.12)', borderWidth: 1, borderColor: 'rgba(231,201,142,0.4)' },
  parkingButtonPressed: { backgroundColor: 'rgba(231,201,142,0.22)' },
  parkingButtonText: { color: '#fffaf2', fontFamily: Fonts.uiSemiBold, fontSize: 13 },
  parkingAltList: { gap: 8, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(240,236,227,0.1)' },
  parkingAltHeader: { color: 'rgba(248,245,239,0.5)', fontFamily: Fonts.uiSemiBold, fontSize: 10, letterSpacing: 1 },
  parkingAltRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  parkingAltInfo: { flex: 1, gap: 2 },
  parkingAltName: { color: '#f0ece3', fontFamily: Fonts.uiMedium, fontSize: 13 },
  parkingAltMeta: { color: '#a4a79b', fontFamily: Fonts.ui, fontSize: 11 },
  parkingAltLink: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, backgroundColor: 'rgba(231,201,142,0.08)', borderWidth: 1, borderColor: 'rgba(231,201,142,0.2)' },
  parkingAltLinkText: { color: '#ead2ae', fontFamily: Fonts.uiSemiBold, fontSize: 11 },
  dock: { paddingTop: 15, paddingHorizontal: 24, backgroundColor: '#1d1e1b', borderTopWidth: 1, borderTopColor: 'rgba(240,236,227,0.10)', gap: 12 },
  stopPicker: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stopPickerLabel: { fontFamily: Fonts.uiSemiBold, color: '#b8a78d', fontSize: 10, letterSpacing: 1.6, marginRight: 2 },
  stopChip: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: 'rgba(240,236,227,0.16)', backgroundColor: 'rgba(240,236,227,0.05)' },
  stopChipActive: { borderColor: '#e5c79b', backgroundColor: 'rgba(229,199,155,0.14)' },
  stopChipPressed: { opacity: 0.75 },
  stopChipText: { fontFamily: Fonts.uiMedium, fontSize: 12, color: '#c1c0b7' },
  stopChipTextActive: { fontFamily: Fonts.uiSemiBold, color: '#ead2ae' },
  dockError: { color: '#e8a79a', fontFamily: Fonts.ui, fontSize: 12, lineHeight: 17 },
  dockCopy: { gap: 3 },
  dockTitle: { fontFamily: Fonts.display, fontSize: 18, color: '#f2e9d9' },
  dockSubtitle: { fontFamily: Fonts.ui, fontSize: 11, color: '#c1c2b5' },
});
