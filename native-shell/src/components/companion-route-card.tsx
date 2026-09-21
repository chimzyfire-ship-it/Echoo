import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  Clock3,
  Route,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react-native";
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import type { QuickPlan } from "@/src/models";
import { recordPlanningFeedback } from "@/src/services/planning";
import { formatPlanBudget, formatStopCost } from "@/src/services/plan-format";
import { Colors, Fonts } from "@/src/theme/tokens";
import { CompanionPlace } from "@/src/components/companion-place";
import type { CompanionPlace as Place } from "@/src/services/planning";

export function CompanionRouteCard({
  plan,
  onStart,
  visibilitySignal = 0,
  places = [],
}: {
  plan: QuickPlan;
  onStart: () => void;
  visibilitySignal?: number;
  places?: Place[];
}) {
  const router = useRouter();
  const { height } = useWindowDimensions();
  const views = useRef<Record<string, View | null>>({});
  const shown = useRef(new Set<string>());
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!plan.planId) return;
    for (const stop of plan.stops)
      views.current[stop.id]?.measureInWindow((_x, y, _w, h) => {
        if (
          h <= 0 ||
          Math.min(y + h, height) - Math.max(y, 0) < Math.min(h * 0.6, 160) ||
          shown.current.has(stop.id)
        )
          return;
        shown.current.add(stop.id);
        void recordPlanningFeedback(plan.planId!, stop.id, "shown").catch(() =>
          shown.current.delete(stop.id),
        );
      });
  }, [visibilitySignal, height, plan]);
  async function react(placeId: string, action: "liked" | "disliked") {
    if (!plan.planId) {
      router.push("/planning-memory");
      return;
    }
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await recordPlanningFeedback(plan.planId, placeId, action);
      setFeedback((v) => ({ ...v, [placeId]: action }));
      setMessage(
        action === "liked"
          ? "Preference saved."
          : "Hidden from future plans. You can restore it in planning memory.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save feedback.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (!plan.planId) {
      router.push("/planning-memory");
      return;
    }
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await Promise.all(
        plan.stops.map((stop) =>
          recordPlanningFeedback(plan.planId!, stop.id, "saved"),
        ),
      );
      setSaved(true);
      setMessage("Saved to your planning memory.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save this route.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <View style={styles.root}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 8 }}>
          <Text style={styles.eyebrow}>
            {plan.stopCount === 1 ? "ONE GOOD PLACE" : `${plan.stopCount}-STOP FLOW`} · {plan.city?.toUpperCase()}
          </Text>
          <Text style={styles.title}>{plan.title || "A good way to go."}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={saved ? "Route saved" : "Save route"}
          disabled={busy || saved}
          onPress={() => void save()}
          style={({ pressed }) => [
            styles.iconButton,
            pressed && styles.pressed,
          ]}
        >
          {saved ? (
            <Check color={Colors.peach} size={20} />
          ) : (
            <Bookmark color={Colors.peach} size={20} />
          )}
        </Pressable>
      </View>
      <View style={styles.summary}>
        <Clock3 size={14} color={Colors.peach} />
        <Text style={styles.meta}>About {plan.totalDurationMinutes} min</Text>
        {plan.stopCount > 1 ? <Text style={styles.meta}>
          {plan.travelMode === "drive"
            ? "Drive"
            : plan.travelMode === "transit"
              ? "Transit"
              : "Walk"}
          {plan.travelVerified ? " · routes checked" : " · estimated"}
        </Text> : null}
      </View>
      {plan.startsAt && Number.isFinite(Date.parse(plan.startsAt)) ? (
        <Text style={styles.meta}>
          {new Intl.DateTimeFormat("en-CA", {
            timeZone: plan.timezone || "America/Toronto",
            weekday: "short",
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(plan.startsAt))}{" "}
          · local time
        </Text>
      ) : null}
      <Text style={styles.budget}>{formatPlanBudget(plan)}</Text>
      {plan.stops.map((stop, index) => (
        <View key={stop.id}>
          {index > 0 ? (
            <View style={styles.track}>
              <View style={styles.dash} />
              <Text style={styles.trackText}>
                {stop.travelMinutes} min{" "}
                {plan.travelMode === "drive"
                  ? "drive"
                  : plan.travelMode === "transit"
                    ? "by transit"
                    : "walk"}{" "}
                · {plan.travelVerified ? "route estimate" : "rough estimate"}
              </Text>
            </View>
          ) : null}
          <View
            ref={(node) => {
              views.current[stop.id] = node;
            }}
            collapsable={false}
            style={styles.stop}
          >
            <CompanionPlace
              place={places.find((p) => p.id === stop.id) || { id: stop.id, name: stop.name, category: stop.category, address: stop.address, imageUrl: stop.imageUrl, source: "echoo" }}
              index={index}
              detail={`${stop.time} · ${stop.durationMinutes} min · ${formatStopCost(stop)}`}
            />
            <View style={styles.detail}>
              <Text style={styles.evidence}>
                {stop.availability === "open"
                  ? "Full visit fits listed hours. Confirm before leaving."
                  : "Hours not confirmed. Check with the venue."}
              </Text>
              <View style={styles.reactions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Like ${stop.name}`}
                  accessibilityState={{
                    selected: feedback[stop.id] === "liked",
                  }}
                  disabled={busy}
                  onPress={() => void react(stop.id, "liked")}
                  style={[
                    styles.reaction,
                    feedback[stop.id] === "liked" && styles.selected,
                  ]}
                >
                  <ThumbsUp size={16} color={Colors.peach} />
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Hide ${stop.name} from future plans`}
                  accessibilityState={{
                    selected: feedback[stop.id] === "disliked",
                  }}
                  disabled={busy}
                  onPress={() => void react(stop.id, "disliked")}
                  style={[
                    styles.reaction,
                    feedback[stop.id] === "disliked" && styles.selected,
                  ]}
                >
                  <ThumbsDown size={16} color={Colors.peach} />
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      ))}
      <Text style={styles.note}>
        Price estimates per person in CAD. Tax, tips and transport are extra.
      </Text>
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        onPress={() =>
          router.push({
            pathname: "/plan-map",
            params: { plan: JSON.stringify(plan) },
          })
        }
        style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}
      >
        <Route size={20} color={Colors.inkDark} />
        <Text style={styles.mapLabel}>See Route on Map</Text>
        <ArrowUpRight size={18} color={Colors.inkDark} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        onPress={onStart}
        style={({ pressed }) => [styles.start, pressed && styles.pressed]}
      >
        <Text style={styles.startText}>Use this plan</Text>
        <ArrowUpRight size={16} color={Colors.peach} />
      </Pressable>
    </View>
  );
}
const styles = StyleSheet.create({
  root: {
    borderRadius: 24,
    padding: 0,
    gap: 14,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 12 },
  eyebrow: {
    fontFamily: Fonts.uiSemiBold,
    color: Colors.peach,
    fontSize: 10,
    letterSpacing: 1.7,
  },
  title: {
    fontFamily: Fonts.display,
    color: Colors.ink,
    fontSize: 29,
    lineHeight: 35,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    alignItems: "center",
    justifyContent: "center",
  },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
  },
  meta: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  budget: {
    fontFamily: Fonts.uiMedium,
    color: Colors.peach,
    fontSize: 15,
    lineHeight: 22,
  },
  stop: {
    borderRadius: 18,
    backgroundColor: Colors.surfaceSubtle,
    overflow: "hidden",
  },
  placeRow: {
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  photoWrap: { width: 80, height: 110 },
  photo: { width: "100%", height: "100%", borderRadius: 12 },
  photoFallback: {
    flex: 1,
    backgroundColor: Colors.peachSubtle,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  noPhoto: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 12 },
  number: {
    position: "absolute",
    top: 6,
    left: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.peach,
    alignItems: "center",
    justifyContent: "center",
  },
  numberText: { fontFamily: Fonts.uiBold, color: Colors.inkDark, fontSize: 12 },
  placeCopy: { flex: 1, gap: 5 },
  category: {
    fontFamily: Fonts.uiMedium,
    color: Colors.peach,
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  placeName: {
    fontFamily: Fonts.display,
    color: Colors.ink,
    fontSize: 21,
    lineHeight: 26,
  },
  cost: {
    fontFamily: Fonts.uiMedium,
    color: Colors.ink,
    fontSize: 13,
    lineHeight: 19,
  },
  detail: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingLeft: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  evidence: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    flex: 1,
  },
  reactions: { flexDirection: "row" },
  reaction: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  selected: { backgroundColor: Colors.peachSubtle },
  track: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingLeft: 28,
    minHeight: 46,
  },
  dash: {
    height: 38,
    borderLeftWidth: 1,
    borderColor: Colors.gold,
    opacity: 0.4,
    borderStyle: "dashed",
  },
  trackText: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 12,
  },
  note: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  message: {
    fontFamily: Fonts.uiMedium,
    color: Colors.peach,
    fontSize: 13,
    lineHeight: 20,
  },
  mapButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: Colors.peach,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  mapLabel: {
    fontFamily: Fonts.uiSemiBold,
    color: Colors.inkDark,
    fontSize: 15,
  },
  start: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  startText: {
    fontFamily: Fonts.uiSemiBold,
    color: Colors.peach,
    fontSize: 15,
  },
  pressed: { opacity: 0.7 },
});
