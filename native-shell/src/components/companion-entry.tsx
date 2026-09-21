import { ArrowUpRight, Route } from "lucide-react-native";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Colors, Fonts } from "@/src/theme/tokens";
import { useState } from "react";
import { nextEditorial, PLAN_INVITATIONS } from "@/src/content/editorial";

export function CompanionEntry({
  compact = false,
  prompt = "",
}: {
  compact?: boolean;
  prompt?: string;
}) {
  const router = useRouter();
  const [invitation] = useState(() => nextEditorial('plan-invitation', PLAN_INVITATIONS));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        prompt ? "Plan around this search with Echoo" : "Plan with Echoo"
      }
      onPress={() =>
        router.push({ pathname: "/planner", params: prompt ? { prompt } : {} })
      }
      style={({ pressed }) => [
        styles.root,
        compact && styles.compact,
        pressed && { opacity: 0.78 },
      ]}
    >
      <View style={styles.icon}>
        <Route size={23} color={Colors.inkDark} />
      </View>
      <View style={styles.copy}>
        {!compact ? (
          <Text style={styles.eyebrow}>A LITTLE HELP GOING OUT</Text>
        ) : null}
        <Text style={[styles.title, compact && styles.small]}>
          {prompt ? "Make a plan of it." : "Plan with Echoo."}
        </Text>
        {!compact ? (
          <Text style={styles.body}>
            {invitation}
          </Text>
        ) : (
          <Text style={styles.body}>Real places. Your kind of route.</Text>
        )}
      </View>
      <ArrowUpRight size={22} color={Colors.peach} />
    </Pressable>
  );
}
const styles = StyleSheet.create({
  root: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    padding: 22,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.peachBorder,
    backgroundColor: Colors.cardSolid,
    minHeight: 120,
  },
  compact: { padding: 16, minHeight: 84 },
  icon: {
    height: 48,
    width: 48,
    borderRadius: 16,
    backgroundColor: Colors.peach,
    alignItems: "center",
    justifyContent: "center",
  },
  copy: { flex: 1, gap: 6 },
  eyebrow: {
    fontFamily: Fonts.uiSemiBold,
    color: Colors.peach,
    fontSize: 10,
    letterSpacing: 1.6,
  },
  title: { fontFamily: Fonts.display, color: Colors.ink, fontSize: 26 },
  small: { fontSize: 22 },
  body: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
});
