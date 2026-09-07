import { useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Linking } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowUpRight, Clock, MapPin, Navigation, Sparkles, X } from 'lucide-react-native';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { PrimaryButton } from '@/src/components/primary-button';
import { ScreenLoading, ScreenMessage } from '@/src/components/screen-state';
import { getPlaceDetail, getQuickPlan } from '@/src/services/api';
import { getCachedPlace } from '@/src/services/place-cache';
import { placeSummary } from '@/src/services/place-summary';
import { checkIn } from '@/src/services/linkup';
import { Colors, Fonts } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function openMaps(uri: string) {
  void Linking.openURL(uri).catch(() => {});
}

export default function PlaceDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedPhoto, setSelectedPhoto] = useState<string>();
  const [failedPhoto, setFailedPhoto] = useState<string>();
  const { id: rawId } = useLocalSearchParams<{ id?: string | string[] }>();
  const routeId = Array.isArray(rawId) ? rawId[0] ?? '' : rawId ?? '';
  const cached = getCachedPlace(routeId);
  const canonicalId = cached?.canonicalId || routeId;

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
      if (!cached) throw new Error('Open this place from Discover to build a plan around it.');
      return getQuickPlan({
        anchor: cached,
        stopCount: 2,
        budgetStyle: 'balanced',
      });
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
  const remoteLatitude = Number(place.latitude ?? place.lat);
  const remoteLongitude = Number(place.longitude ?? place.lng);
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

        <Text style={styles.note}>
          Place details and photos from Echoo. Check with the venue for the latest hours.
        </Text>
      </View>
    </ScrollView>
    <View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, 14) }]}>
      
        {quickPlan.isError ? (
          <Text style={styles.error}>{quickPlan.error instanceof Error ? quickPlan.error.message : 'Quick Plan failed.'}</Text>
        ) : null}
      <PrimaryButton label="Plan around this place" onPress={() => quickPlan.mutate()} loading={quickPlan.isPending} icon={<Sparkles size={17} color={Colors.inkDark} />} />
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
  dock: { paddingTop: 15, paddingHorizontal: 24, backgroundColor: '#1d1e1b', borderTopWidth: 1, borderTopColor: 'rgba(240,236,227,0.10)', gap: 12 },
  dockCopy: { gap: 3 },
  dockTitle: { fontFamily: Fonts.display, fontSize: 18, color: '#f2e9d9' },
  dockSubtitle: { fontFamily: Fonts.ui, fontSize: 11, color: '#c1c2b5' },
});
