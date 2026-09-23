import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, ArrowUpRight, Navigation } from "lucide-react-native";
import {
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PlanMapView } from "@/src/components/plan-map-view";
import type { QuickPlan } from "@/src/models";
import { directionsUrl } from "@/src/services/planning";
import { normalizeQuickPlan } from "@/src/services/api";
import { Colors, Fonts } from "@/src/theme/tokens";

export default function PlanMapScreen() {
  const { plan: raw } = useLocalSearchParams<{ plan?: string }>(),
    router = useRouter(),
    insets = useSafeAreaInsets();
  const [error, setError] = useState("");
  let plan: QuickPlan | null = null;
  try {
    if (raw && raw.length < 30000) {
      const parsed = JSON.parse(raw);
      plan = normalizeQuickPlan(parsed, parsed.anchorId);
    }
  } catch {}
  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 44) + 12 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close map"
          onPress={() => router.back()}
          style={styles.icon}
        >
          <ArrowLeft size={22} color={Colors.ink} />
        </Pressable>
        <Text style={styles.title}>Your route, at a glance.</Text>
      </View>
      {plan ? (
        <>
          <View style={styles.map}>
            <PlanMapView plan={plan} />
          </View>
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: Math.max(insets.bottom, 20) + 16 },
            ]}
          >
            <Text style={styles.note}>
              The dotted line shows stop order. Open directions for the actual
              streets and live travel guidance.
            </Text>
            {plan.stops.map((stop, index) => (
              <View key={stop.id} style={styles.stop}>
                <View style={styles.number}>
                  <Text style={styles.numberText}>{index + 1}</Text>
                </View>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={styles.name}>{stop.name}</Text>
                  <Text style={styles.note}>{stop.address}</Text>
                </View>
              </View>
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                void Linking.openURL(directionsUrl(plan!)).catch(() =>
                  setError("Could not open Maps. Please try again."),
                )
              }
              style={({ pressed }) => [
                styles.button,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Navigation size={19} color={Colors.inkDark} />
              <Text style={styles.buttonText}>Open directions</Text>
              <ArrowUpRight size={18} color={Colors.inkDark} />
            </Pressable>
            {error ? (
              <Text accessibilityRole="alert" style={styles.note}>
                {error}
              </Text>
            ) : null}
          </ScrollView>
        </>
      ) : (
        <View style={styles.content}>
          <Text style={styles.note}>Open a plan to see its stops here.</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace("/planner")}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Plan with Echoo</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  icon: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    fontFamily: Fonts.display,
    color: Colors.ink,
    fontSize: 22,
    flex: 1,
  },
  map: { height: "43%", minHeight: 220 },
  content: {
    padding: 22,
    gap: 20,
    width: "100%",
    maxWidth: 700,
    alignSelf: "center",
  },
  note: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  stop: { flexDirection: "row", alignItems: "center", gap: 14 },
  number: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { fontFamily: Fonts.uiSemiBold, color: Colors.inkDark },
  name: { fontFamily: Fonts.uiSemiBold, color: Colors.ink, fontSize: 16 },
  button: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: Colors.peach,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: {
    fontFamily: Fonts.uiSemiBold,
    color: Colors.inkDark,
    fontSize: 15,
  },
});
