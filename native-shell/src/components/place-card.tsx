import { CalendarDays, MapPin, Star } from 'lucide-react-native';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import type { DiscoveryCard } from '@/src/models';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

const categoryLabel = (value: string) =>
  value
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());

const distanceLabel = (meters: number | null) => {
  if (meters === null) return null;
  return meters < 1000 ? `${Math.round(meters)} m away` : `${(meters / 1000).toFixed(1)} km away`;
};

type PlaceCardProps = {
  place: DiscoveryCard;
  onPress: () => void;
  variant?: 'grid' | 'featured';
};

export function PlaceCard({ place, onPress, variant = 'grid' }: PlaceCardProps) {
  const distance = distanceLabel(place.distanceMeters);
  const rating = place.community?.ratingAverage;
  const isFeatured = variant === 'featured';

  if (isFeatured) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${place.title}`}
        onPress={() => {
          void triggerHaptic.light();
          onPress();
        }}
        style={({ pressed }) => [styles.featuredCard, pressed && styles.pressed]}
      >
        <View style={styles.featuredMediaWrap}>
          {place.image ? (
            <Image
              source={{ uri: place.image.url }}
              style={styles.featuredImage}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.featuredMediaFallback}>
              <MapPin size={24} color={Colors.peach} />
            </View>
          )}
          <View style={styles.mediaShade} />
        </View>

        <View style={styles.featuredCopy}>
          <Text style={styles.categoryKicker}>{categoryLabel(place.category).toUpperCase()}</Text>
          <Text style={styles.featuredTitle} numberOfLines={2}>
            {place.title}
          </Text>

          {place.description ? (
            <Text style={styles.featuredDescription} numberOfLines={2}>
              {place.description}
            </Text>
          ) : null}

          <View style={styles.locationRow}>
            <MapPin size={12} color="rgba(248, 245, 239, 0.55)" />
            <Text style={styles.locationText} numberOfLines={1}>
              {distance || place.city}
            </Text>
          </View>

          <View style={styles.viewDetailsPill}>
            <Text style={styles.viewDetailsText}>View details</Text>
          </View>
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${place.title}`}
      onPress={() => {
        void triggerHaptic.light();
        onPress();
      }}
      style={({ pressed }) => [styles.gridCard, pressed && styles.pressed]}
    >
      <View style={styles.gridMedia}>
        {place.image ? (
          <Image source={{ uri: place.image.url }} style={styles.fullImage} resizeMode="cover" />
        ) : (
          <View style={styles.gridMediaFallback}>
            <MapPin size={20} color={Colors.peach} />
            <Text style={styles.fallbackLabel}>{categoryLabel(place.category)}</Text>
          </View>
        )}
        <View style={styles.mediaShade} />
        <View style={styles.categoryBadge}>
          <Text style={styles.categoryBadgeText}>{categoryLabel(place.category)}</Text>
        </View>
      </View>

      <View style={styles.gridCopy}>
        <Text style={styles.categoryKickerSmall}>{categoryLabel(place.category).toUpperCase()}</Text>
        <Text style={styles.gridTitle} numberOfLines={2}>
          {place.title}
        </Text>

        <View style={styles.locationRow}>
          <MapPin size={11} color="rgba(248, 245, 239, 0.55)" />
          <Text style={styles.locationText} numberOfLines={1}>
            {distance || place.city}
          </Text>
        </View>

        {rating !== null && rating !== undefined ? (
          <View style={styles.metaRow}>
            <Star size={11} color={Colors.peach} fill={Colors.peach} />
            <Text style={styles.metaText}>{rating.toFixed(1)}</Text>
          </View>
        ) : place.startsAt ? (
          <View style={styles.metaRow}>
            <CalendarDays size={11} color={Colors.peach} />
            <Text style={styles.metaText}>Event</Text>
          </View>
        ) : null}

        <View style={styles.viewDetailsPillSmall}>
          <Text style={styles.viewDetailsTextSmall}>View details</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Featured Split Card Layout (Exact from Inspi)
  featuredCard: {
    height: 172,
    flexDirection: 'row',
    overflow: 'hidden',
    borderRadius: 22,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.12)',
    backgroundColor: 'rgba(22, 21, 20, 0.92)',
  },
  featuredMediaWrap: {
    width: '44%',
    height: '100%',
    backgroundColor: Colors.surfaceElevated,
    position: 'relative',
    overflow: 'hidden',
  },
  featuredImage: {
    width: '100%',
    height: '100%',
  },
  featuredMediaFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceElevated,
  },
  featuredCopy: {
    flex: 1,
    height: '100%',
    minWidth: 0,
    padding: 12,
    paddingHorizontal: 14,
    justifyContent: 'space-between',
  },
  featuredTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 17,
    lineHeight: 21,
    letterSpacing: -0.3,
  },
  featuredDescription: {
    color: 'rgba(248, 245, 239, 0.65)',
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 16,
  },

  // Grid Card Layout (for Discover 2-column view and lists)
  gridCard: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.10)',
    backgroundColor: 'rgba(22, 21, 20, 0.90)',
  },
  gridMedia: {
    height: 135,
    backgroundColor: Colors.surfaceElevated,
    position: 'relative',
    overflow: 'hidden',
  },
  fullImage: {
    width: '100%',
    height: '100%',
  },
  gridMediaFallback: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: Colors.surfaceElevated,
  },
  fallbackLabel: {
    color: Colors.textSecondary,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    textAlign: 'center',
  },
  mediaShade: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(8, 8, 8, 0.20)',
  },
  categoryBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    maxWidth: '85%',
    borderRadius: 999,
    backgroundColor: 'rgba(10, 10, 10, 0.76)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.10)',
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryBadgeText: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 9,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  gridCopy: {
    minHeight: 120,
    padding: 11,
    justifyContent: 'space-between',
    gap: 4,
  },
  categoryKicker: {
    color: 'rgba(248, 245, 239, 0.45)',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 10,
    letterSpacing: 1.1,
  },
  categoryKickerSmall: {
    color: 'rgba(248, 245, 239, 0.42)',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 9,
    letterSpacing: 0.9,
  },
  gridTitle: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: -0.2,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  locationText: {
    color: 'rgba(248, 245, 239, 0.65)',
    fontFamily: Fonts.ui,
    fontSize: 11,
    flex: 1,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
  },
  viewDetailsPill: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.24)',
    backgroundColor: 'rgba(248, 245, 239, 0.06)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    marginTop: 2,
  },
  viewDetailsText: {
    color: Colors.ink,
    fontFamily: Fonts.uiMedium,
    fontSize: 11,
    letterSpacing: -0.1,
  },
  viewDetailsPillSmall: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.20)',
    backgroundColor: 'rgba(248, 245, 239, 0.04)',
    paddingHorizontal: 9,
    paddingVertical: 3,
    marginTop: 2,
  },
  viewDetailsTextSmall: {
    color: Colors.ink,
    fontFamily: Fonts.uiMedium,
    fontSize: 10,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
});
