import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, BedDouble, ChevronRight, MapPin, Star } from 'lucide-react-native';
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { getNearbyStays, secureStayUrl, stayDestination, stayDistance, type NearbyStay } from '@/src/services/stays';
import { Colors, Fonts } from '@/src/theme/tokens';
import { nextEditorial, STAY_TITLES } from '@/src/content/editorial';

export function NearbyStays({ latitude, longitude, destinationName, initiallyOpen = false }: {
  latitude: number; longitude: number; destinationName: string; initiallyOpen?: boolean;
}) {
  const [mapError, setMapError] = useState(false);
  const [title] = useState(() => nextEditorial('stay', STAY_TITLES));
  const openHotelMap = async () => {
    setMapError(false);
    const url = new URL('https://www.google.com/maps/search/');
    url.searchParams.set('api', '1');
    url.searchParams.set('query', `hotels near ${latitude},${longitude}`);
    try { await Linking.openURL(url.href); } catch { setMapError(true); }
  };
  const [opened, setOpened] = useState(initiallyOpen);
  const query = useQuery({
    queryKey: ['nearby-stays', latitude, longitude, destinationName],
    queryFn: ({ signal }) => getNearbyStays({ latitude, longitude, destinationName }, signal),
    enabled: opened,
    // Provider photos are signed for five minutes; keep client caching shorter.
    staleTime: 60_000,
    gcTime: 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  });
  return <View style={styles.section}>
    <View style={styles.heading}>
      <Text style={styles.eyebrow}>Stay a little longer</Text>
    </View>
    <Text style={styles.title}>{title}</Text>
    <Text style={styles.subtitle}>Thinking of staying over? Explore hotels near {destinationName}.</Text>
    {!opened ? <Pressable accessibilityRole="button" onPress={() => setOpened(true)} style={({ pressed }) => [styles.discover, pressed && styles.pressed]}>
      <Text style={styles.discoverText}>Explore nearby hotels</Text>
      <ChevronRight size={18} color={Colors.peach} />
    </Pressable> : query.isPending ? <View accessibilityRole="progressbar" accessibilityLabel="Finding nearby hotels" style={styles.loading}>
      <ActivityIndicator color={Colors.peach} /><Text style={styles.subtitle}>Finding a place to unwind…</Text>
    </View> : query.isError ? <View style={styles.status}>
      <Text style={styles.subtitle}>Nearby hotels couldn’t load just now.</Text>
      <Pressable accessibilityRole="button" onPress={() => void query.refetch()} style={styles.retry}><Text style={styles.link}>Try again</Text></Pressable>
    </View> : <>
      {query.data?.stays.length ? <View style={styles.hotels}>
        {query.data.stays.map((stay, index) => <StayCard key={stay.id} stay={stay} first={index === 0} />)}
      </View> : <Text style={styles.subtitle}>No matching hotels found within 5 km. Try another destination.</Text>}
      {query.data?.stays.length ? <Text style={styles.footnote}>Google Maps · Straight-line distances{query.data.radiusMeters === 5000 ? ' · Expanded to 5 km' : ''}. Check dates, rates and availability with the hotel.</Text> : null}
    </>}
    {opened && (query.isError || query.data?.stays.length === 0) ? <Pressable accessibilityRole="link" accessibilityLabel={`Search hotels near ${destinationName} on Google Maps`} onPress={() => void openHotelMap()} style={styles.discover}>
      <MapPin size={18} color={Colors.peach} /><Text style={styles.discoverText}>Search hotels on Maps</Text><ArrowUpRight size={17} color={Colors.peach} />
    </Pressable> : null}
    {mapError ? <Text accessibilityRole="alert" style={styles.subtitle}>Couldn’t open Maps. Please try again.</Text> : null}
  </View>;
}

function StayCard({ stay, first }: { stay: NearbyStay; first: boolean }) {
  const [failedImage, setFailedImage] = useState<string>();
  const [linkError, setLinkError] = useState(false);
  const target = stayDestination(stay);
  async function open(url: string) {
    setLinkError(false);
    try { await Linking.openURL(url); } catch { setLinkError(true); }
  }
  const creditUrl = secureStayUrl(stay.photoCreditUrl);
  return <View style={styles.card}>
    <View style={styles.media}>
      {stay.imageUrl !== failedImage ? <Image accessibilityLabel={stay.name} source={{ uri: stay.imageUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" onError={() => setFailedImage(stay.imageUrl)} /> : <LinearGradient colors={[Colors.surfaceElevated, Colors.cardSolid]} style={styles.fallback}><BedDouble size={38} color={Colors.peach} strokeWidth={1} /></LinearGradient>}
      <LinearGradient pointerEvents="none" colors={['transparent', 'rgba(0,0,0,0.65)']} style={StyleSheet.absoluteFill} />
      {first ? <View style={styles.badge}><Text style={styles.badgeText}>CLOSEST PICK</Text></View> : null}
      <View style={styles.distance}><MapPin size={13} color={Colors.ink} /><Text style={styles.distanceText}>{stayDistance(stay.distanceMeters)}</Text></View>
    </View>
    <View style={styles.copy}>
      <Text style={styles.hotelName}>{stay.name}</Text>
      {typeof stay.rating === 'number' && stay.rating > 0 && stay.rating <= 5 ? <View style={styles.review}>
        <Star size={13} color={Colors.gold} fill={Colors.gold} />
        <Text style={styles.rating}>{stay.rating.toFixed(1)}<Text style={styles.address}> / 5 on Google{typeof stay.ratingCount === 'number' && stay.ratingCount > 0 ? ` · ${stay.ratingCount.toLocaleString()} reviews` : ''}</Text></Text>
      </View> : null}
      <Text selectable style={styles.address}>{stay.address}</Text>
      <Pressable accessibilityRole="link" accessibilityLabel={`${target.label}: ${stay.name}, opens externally`} onPress={() => void open(target.url)} style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
        <Text style={styles.ctaText}>{target.label}</Text><ArrowUpRight size={17} color={Colors.inkDark} />
      </Pressable>
      {linkError ? <Text accessibilityRole="alert" style={styles.subtitle}>Couldn’t open this link. Please try again.</Text> : null}
      {creditUrl ? <Pressable accessibilityRole="link" accessibilityLabel={`Photo credit: ${stay.photoCredit || 'Google Maps'}`} onPress={() => void open(creditUrl)} style={styles.creditButton}><Text style={styles.credit}>{stay.photoCredit || 'Google Maps'}</Text></Pressable> : <Text style={styles.credit}>{stay.photoCredit || 'Google Maps'}</Text>}
    </View>
  </View>;
}

const styles = StyleSheet.create({
  section: { gap: 12, paddingVertical: 24, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  eyebrow: { fontFamily: Fonts.ui, fontSize: 13, color: Colors.peach, flexShrink: 1 },
  title: { fontFamily: Fonts.displayRegular, fontSize: 27, letterSpacing: -0.4, color: Colors.ink },
  subtitle: { fontFamily: Fonts.ui, fontSize: 14, lineHeight: 21, color: Colors.textSecondary },
  discover: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: Colors.peachBorder, backgroundColor: Colors.peachSubtle, marginTop: 4 },
  discoverText: { flex: 1, fontFamily: Fonts.uiMedium, fontSize: 15, color: Colors.peachLight },
  loading: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 24 },
  status: { gap: 8 },
  retry: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start', paddingHorizontal: 12 },
  link: { color: Colors.peach, fontFamily: Fonts.uiSemiBold, fontSize: 14 },
  hotels: { gap: 18, marginTop: 8 },
  card: { borderRadius: 22, borderCurve: 'continuous', overflow: 'hidden', borderWidth: 1, borderColor: Colors.borderLight, backgroundColor: Colors.cardSolid },
  media: { aspectRatio: 1.8, backgroundColor: Colors.surfaceElevated },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 14, left: 14, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7, backgroundColor: Colors.peach },
  badgeText: { fontFamily: Fonts.uiSemiBold, fontSize: 9, letterSpacing: 1.2, color: Colors.inkDark },
  distance: { position: 'absolute', bottom: 14, left: 16, flexDirection: 'row', gap: 6, alignItems: 'center' },
  distanceText: { fontFamily: Fonts.uiMedium, fontSize: 13, color: Colors.ink },
  copy: { padding: 18, gap: 10 },
  hotelName: { fontFamily: Fonts.display, fontSize: 23, color: Colors.ink, letterSpacing: -0.4 },
  review: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  rating: { flex: 1, fontFamily: Fonts.uiSemiBold, fontSize: 13, color: Colors.ink },
  address: { fontFamily: Fonts.ui, fontSize: 12, lineHeight: 18, color: Colors.textSecondary },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, backgroundColor: Colors.peach, marginTop: 4 },
  ctaText: { flex: 1, color: Colors.inkDark, fontFamily: Fonts.uiSemiBold, fontSize: 14 },
  creditButton: { minHeight: 44, justifyContent: 'center' },
  credit: { fontFamily: Fonts.ui, fontSize: 11, color: Colors.textSecondary },
  footnote: { fontFamily: Fonts.ui, fontSize: 11, lineHeight: 17, color: Colors.textSecondary },
  pressed: { opacity: 0.75 },
});
