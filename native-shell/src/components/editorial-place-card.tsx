import { useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowUpRight, MapPin, Star } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { DiscoveryCard } from '@/src/models';
import { placeSummary } from '@/src/services/place-summary';
import { Colors, Fonts } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

/** Photo-led cards scoped to Home and Discover. */
export function EditorialPlaceCard({ place, onPress, featured = false }: {
  place: DiscoveryCard; onPress: () => void; featured?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string>();
  const url = place.image?.url;
  const category = place.category.replace(/[_-]+/g, ' ');
  const distance = place.distanceMeters;
  const location = distance == null ? place.city : distance < 1000
    ? `${Math.round(distance)} m away` : `${(distance / 1000).toFixed(1)} km away`;
  const rating = place.community?.ratingAverage;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${place.title}`}
      onPress={() => { void triggerHaptic.light(); onPress(); }}
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={[styles.media, featured && styles.hero]}>
        {url && failedUrl !== url ? (
          <Image source={{ uri: url }} resizeMode="cover" style={[StyleSheet.absoluteFill, { width: '100%', height: '100%' }]}
            onError={() => setFailedUrl(url)} />
        ) : (
          <LinearGradient colors={['#615447', '#302d29']} style={styles.fallback}>
            <MapPin size={32} strokeWidth={1} color={Colors.peach} />
            <Text style={styles.fallbackText}>{place.city}</Text>
          </LinearGradient>
        )}
        {featured ? (
          <>
            <LinearGradient colors={['transparent', 'rgba(16,15,13,0.25)', 'rgba(16,15,13,0.94)']}
              locations={[0, 0.35, 1]} style={StyleSheet.absoluteFill} />
            <View style={styles.heroCopy}>
              <Text style={styles.heroCategory}>{category}</Text>
              <Text style={styles.heroTitle} numberOfLines={3}>{place.title}</Text>
              <Text style={styles.heroMeta} numberOfLines={2}>{placeSummary(place)}</Text>
              <View style={styles.heroBottom}>
                <View style={styles.location}><MapPin size={13} color="#e4d8cb" /><Text style={styles.heroMeta}>{location}</Text></View>
                <View style={styles.arrow}><ArrowUpRight size={20} color="#211e19" /></View>
              </View>
            </View>
          </>
        ) : null}
        {rating != null && rating > 0 && Number.isFinite(rating) ? (
          <View style={styles.rating}><Star size={11} fill="#f5dfbc" color="#f5dfbc" /><Text style={styles.ratingText}>{rating.toFixed(1)}</Text></View>
        ) : null}
      </View>
      {!featured ? (
        <View style={styles.copy}>
          <Text style={styles.category} numberOfLines={1}>{category}</Text>
          <Text style={styles.title} numberOfLines={2}>{place.title}</Text>
          <Text style={styles.meta} numberOfLines={2}>{placeSummary(place)}</Text>
          <Text style={styles.meta} numberOfLines={1}>{location}{place.startsAt ? ' · Event' : ''}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}
const styles = StyleSheet.create({
  card: { flex: 1, minWidth: 0 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },
  media: { aspectRatio: 0.92, borderRadius: 19, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: '#34302b' },
  hero: { aspectRatio: 1.12, borderRadius: 25 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  fallbackText: { fontFamily: Fonts.display, fontSize: 19, color: '#e4d8cb' },
  copy: { paddingTop: 12, paddingHorizontal: 2, gap: 5 },
  category: { fontFamily: Fonts.uiMedium, fontSize: 10, letterSpacing: 1.2, textTransform: 'uppercase', color: '#cab292' },
  title: { fontFamily: Fonts.display, fontSize: 19, lineHeight: 24, letterSpacing: -0.4, color: Colors.ink },
  meta: { fontFamily: Fonts.ui, fontSize: 12, color: '#b9b3a9', marginTop: 2 },
  heroCopy: { position: 'absolute', bottom: 20, left: 22, right: 22, gap: 8 },
  heroCategory: { fontFamily: Fonts.uiSemiBold, fontSize: 10, letterSpacing: 1.7, textTransform: 'uppercase', color: '#f5dfbc' },
  heroTitle: { fontFamily: Fonts.display, fontSize: 29, lineHeight: 34, letterSpacing: -0.7, color: '#fffaf3' },
  heroBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  location: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  heroMeta: { fontFamily: Fonts.ui, fontSize: 13, color: '#e4d8cb', flexShrink: 1 },
  arrow: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#f1ddbf', alignItems: 'center', justifyContent: 'center' },
  rating: { position: 'absolute', top: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 20, paddingHorizontal: 9, paddingVertical: 6, backgroundColor: 'rgba(20,19,16,0.86)' },
  ratingText: { fontFamily: Fonts.uiSemiBold, fontSize: 11, color: '#fffaf3' },
});
