import { useState } from "react";
import { useRouter } from "expo-router";
import { ArrowUpRight, Coffee, MapPin, Trees, Utensils } from "lucide-react-native";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import type { CompanionPlace as Place } from "@/src/services/planning";
import { Colors, Fonts } from "@/src/theme/tokens";

// One identity for a place: an editorial image card when a real photo exists,
// a compact capsule when it doesn't. Never substitute a stock venue photo.
export function CompanionPlace({ place, index, detail, footer }: {
  place: Place; index?: number; detail?: string; footer?: React.ReactNode;
}) {
  const router = useRouter();
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const hasPhoto = Boolean(place.imageUrl && failedUrl !== place.imageUrl);
  const CategoryIcon = /cafe|coffee|tea/.test(place.category) ? Coffee : /park|trail/.test(place.category) ? Trees : /restaurant|food|bakery/.test(place.category) ? Utensils : MapPin;
  return (
    <View style={[styles.root, !hasPhoto && styles.capsule]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Explore ${place.name}${detail ? `, ${detail}` : ""}`}
        onPress={() => router.push({ pathname: "/place/[id]", params: { id: place.id } })}
        style={({ pressed }) => [pressed && styles.pressed]}>
        {hasPhoto ? (
          <View style={styles.imageWrap}>
            <Image source={{ uri: place.imageUrl }} style={styles.image} resizeMode="cover" accessibilityLabel={`Photo of ${place.name}`} onError={() => setFailedUrl(place.imageUrl)} />
          </View>
        ) : null}
        <View style={styles.copyRow}>
          {!hasPhoto ? <View style={styles.symbol}><CategoryIcon size={21} color={Colors.peach} /></View> : null}
          <View style={styles.copy}>
            <Text style={styles.category}>{index !== undefined ? `0${index + 1}  /  ` : ""}{place.category.replace(/[_-]+/g, " ")}</Text>
            <Text style={[styles.name, !hasPhoto && styles.compactName]}>{place.name}</Text>
            {place.address ? <Text numberOfLines={2} style={styles.address}>{place.address}</Text> : null}
            {detail ? <Text style={styles.detail}>{detail}</Text> : null}
          </View>
          <ArrowUpRight size={18} color={Colors.peach} />
        </View>
      </Pressable>
      {place.source === "google_places" ? <View style={styles.attribution}>
        <Text style={styles.credit}>Google Maps</Text>
        {hasPhoto && place.photoAuthors?.map((author) => author.uri && /^https:\/\//.test(author.uri) ?
          <Pressable key={author.displayName} accessibilityRole="link" accessibilityLabel={`Photo by ${author.displayName}`} style={styles.authorLink} onPress={() => void Linking.openURL(author.uri).catch(() => {})}>
            <Text style={styles.credit}>Photo: {author.displayName}</Text>
          </Pressable> : <Text key={author.displayName} style={styles.credit}>Photo: {author.displayName}</Text>)}
      </View> : null}
      {footer}
    </View>
  );
}
const styles = StyleSheet.create({
  root: { borderRadius: 22, borderCurve: "continuous", overflow: "hidden", backgroundColor: Colors.surfaceElevated, borderWidth: 1, borderColor: Colors.borderLight },
  capsule: { borderRadius: 24, backgroundColor: Colors.peachSubtle, borderColor: Colors.peachBorder },
  imageWrap: { height: 172, backgroundColor: Colors.surfaceElevated },
  image: { width: "100%", height: "100%" },
  copyRow: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  symbol: { width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.goldSubtle, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 6 },
  category: { fontFamily: Fonts.uiMedium, color: Colors.peach, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  name: { fontFamily: Fonts.display, color: Colors.ink, fontSize: 25, lineHeight: 31 },
  compactName: { fontSize: 21, lineHeight: 27 },
  address: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 13, lineHeight: 19 },
  detail: { fontFamily: Fonts.uiMedium, color: Colors.peach, fontSize: 13, lineHeight: 20 },
  attribution: { paddingHorizontal: 16, paddingBottom: 10, gap: 4 },
  credit: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
  authorLink: { minHeight: 44, justifyContent: "center" },
  pressed: { opacity: 0.75 },
});
