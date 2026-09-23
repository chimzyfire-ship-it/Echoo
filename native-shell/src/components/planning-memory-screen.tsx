import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Host, Switch } from "@expo/ui";
import {
  ArrowLeft,
  ArrowUpRight,
  Bookmark,
  Check,
  RotateCcw,
  Trash2,
} from "lucide-react-native";
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/src/providers/auth-provider";
import { useCulture } from "@/src/providers/culture-provider";
import { useEchooLocation } from "@/src/providers/location-provider";
import {
  deletePlanningHistory,
  planningHistory,
  planningPreferences,
  restorePlanningPlace,
  startPlannedOuting,
  updatePlanningPreferences,
  type PlanningPreferences,
} from "@/src/services/planning";
import {
  enablePlanningNotifications,
} from "@/src/services/planning-notifications";
import { Colors, Fonts } from "@/src/theme/tokens";

export function PlanningMemoryScreen() {
  const { from } = useLocalSearchParams<{ from?: string }>();
  const router = useRouter(),
    insets = useSafeAreaInsets(),
    client = useQueryClient();
  const { user } = useAuth(),
    { active: culture } = useCulture(),
    { location } = useEchooLocation();
  const locked = useRef(false);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const preferences = useQuery({
    queryKey: ["planning-preferences", user?.id],
    enabled: !!user,
    queryFn: () => planningPreferences(user!.id),
  });
  const history = useQuery({
    queryKey: ["planning-history", user?.id],
    enabled: !!user,
    queryFn: () => planningHistory(user!.id),
  });
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save your change.",
      );
    } finally {
      await Promise.allSettled([
        client.invalidateQueries({
          queryKey: ["planning-preferences", user?.id],
        }),
        client.invalidateQueries({ queryKey: ["planning-history", user?.id] }),
      ]);
      locked.current = false;
      setBusy(false);
    }
  }
  async function change(patch: Partial<PlanningPreferences>) {
    if (!preferences.data) return;
    await updatePlanningPreferences({
      ...preferences.data,
      home_city: location.city,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...patch,
    });
  }
  const hidden = [
    ...new Set(
      history.data?.feedback
        .filter((row) => row.action === "disliked")
        .map((row) => row.place_id) || [],
    ),
  ];
  const nameFor = (id: string) =>
    history.data?.feedback.find((row) => row.place_id === id && row.place_name)
      ?.place_name ||
    history.data?.plans
      .flatMap((row) => row.plan.stops)
      .find((stop) => stop.id === id)?.name ||
    `Hidden place (${id.slice(-6)})`;
  return (
    <ScrollView
      style={styles.screen}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[
        styles.content,
        {
          paddingTop: Math.max(insets.top, 44) + 6,
          paddingBottom: Math.max(insets.bottom, 24) + 24,
        },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() =>
            router.canGoBack()
              ? router.back()
              : router.replace(from === 'planner' ? '/planner' : '/(tabs)/profile')
          }
          style={styles.icon}
        >
          <ArrowLeft color={Colors.ink} size={22} />
        </Pressable>
        <Text style={styles.headerText}>YOUR ECHOO</Text>
      </View>
      <View style={styles.hero}>
        <Text style={styles.title}>
          A little memory.{"\n"}
          <Text style={styles.italic}>All your choice.</Text>
        </Text>
        <Text style={styles.body}>
          Keep useful routes, teach Echoo what fits, and choose what it
          remembers.
        </Text>
      </View>
      {preferences.isPending ? (
        <Text style={styles.body}>Loading your preferences…</Text>
      ) : preferences.isError ? (
        <View style={styles.card}>
          <Text style={styles.body}>{preferences.error.message}</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void preferences.refetch()}
            style={styles.action}
          >
            <Text style={styles.actionLabel}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View style={styles.card}>
            <Host colorScheme="dark" matchContents>
              <Switch
                value={preferences.data?.memory_enabled || false}
                onValueChange={(value) =>
                  void run(async () => {
                    await change({ memory_enabled: value });
                    setMessage(
                      value
                        ? "Memory enabled. New plans can now be saved and personalized."
                        : "Personalization is off. Existing history is kept until you delete it.",
                    );
                  })
                }
                disabled={busy}
                label="Remember my planning preferences"
              />
            </Host>
            <Text style={styles.body}>
              Save generated routes and the places you like or hide. Echoo uses
              these actions to tailor future plans. It will never turn a tap
              into a claim that you visited.
            </Text>
            <Text style={styles.note}>
              Turning this off stops new history and personalization. Delete
              history below to remove what is already stored.
            </Text>
          </View>
          <View style={styles.card}>
            <Host colorScheme="dark" matchContents>
              <Switch
                value={preferences.data?.push_enabled || false}
                onValueChange={(value) =>
                  void run(async () => {
                    if (value) await enablePlanningNotifications();
                    await change({ push_enabled: value });
                    setMessage(
                      value
                        ? "Relevant reminders enabled."
                        : "Reminders are off.",
                    );
                  })
                }
                disabled={busy}
                label="Useful weekend reminders"
              />
            </Host>
            <Text style={styles.body}>
              Only when there is something to share in {location.label}. At most
              three reminders in seven days, between 4 and 8 pm in your
              timezone.
            </Text>
            {culture ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{
                  checked: preferences.data?.culture_slugs.includes(
                    culture.slug,
                  ),
                  disabled: busy,
                }}
                disabled={busy}
                onPress={() =>
                  void run(() =>
                    change({
                      culture_slugs: preferences.data?.culture_slugs.includes(
                        culture.slug,
                      )
                        ? preferences.data.culture_slugs.filter(
                            (slug) => slug !== culture.slug,
                          )
                        : [
                            ...preferences.data!.culture_slugs,
                            culture.slug,
                          ].slice(0, 8),
                    }),
                  )
                }
                style={styles.checkRow}
              >
                <View style={styles.check}>
                  {preferences.data?.culture_slugs.includes(culture.slug) ? (
                    <Check size={15} color={Colors.peach} />
                  ) : null}
                </View>
                <Text style={styles.body}>
                  Include new finds for my {culture.label} lens
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.note}>
                Choose a Culture Lens in Discover to opt into relevant new
                finds.
              </Text>
            )}
          </View>
        </>
      )}
      <View style={styles.section}>
        <View style={styles.row}>
          <Pressable accessibilityRole="button" onPress={() => router.push('/notifications')} style={styles.restore}>
            <Text style={styles.restoreLabel}>All notification preferences</Text>
            <ArrowUpRight size={17} color={Colors.peach} />
          </Pressable>
        </View>
        <View style={styles.row}>
          <Bookmark size={20} color={Colors.peach} />
          <Text style={styles.sectionTitle}>Your routes</Text>
        </View>
        <Text style={styles.note}>
          Your 30 most recent plans appear here when memory is on. Saved routes
          stay until you delete them.
        </Text>
        {history.isPending ? (
          <Text style={styles.body}>Loading routes…</Text>
        ) : history.isError ? (
          <Text style={styles.body}>{history.error.message}</Text>
        ) : history.data?.plans.length ? (
          history.data.plans.map((row) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              disabled={busy}
              onPress={() =>
                void run(async () => {
                  await startPlannedOuting(user!.id, {
                    ...row.plan,
                    planId: row.id,
                  });
                  router.push({
                    pathname: "/planner",
                    params: { quickPlan: "resume" },
                  });
                })
              }
              style={({ pressed }) => [
                styles.route,
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={{ flex: 1, gap: 7 }}>
                <Text style={styles.routeTitle}>
                  {row.plan.city} · {row.plan.stopCount} places
                </Text>
                <Text style={styles.body}>
                  {row.plan.stops.map((stop) => stop.name).join(" → ")}
                </Text>
                <Text style={styles.note}>
                  {new Date(row.created_at).toLocaleDateString()}{" "}
                  {row.saved_at ? "· Saved" : ""} · Recheck hours before going.
                </Text>
              </View>
              <ArrowUpRight size={19} color={Colors.peach} />
            </Pressable>
          ))
        ) : (
          <View style={styles.card}>
            <Text style={styles.routeTitle}>Room for a few good plans.</Text>
            <Text style={styles.body}>
              Enable memory, then make your next plan with Echoo.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => from === 'planner' && router.canGoBack() ? router.back() : router.replace('/planner')}
              style={styles.action}
            >
              <Text style={styles.actionLabel}>Plan something</Text>
              <ArrowUpRight size={17} color={Colors.inkDark} />
            </Pressable>
          </View>
        )}
      </View>
      {hidden.length ? (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Places you’ve hidden</Text>
          {hidden.map((id) => (
            <View key={id} style={styles.row}>
              <Text style={[styles.body, { flex: 1 }]}>{nameFor(id)}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Restore ${nameFor(id)}`}
                disabled={busy}
                onPress={() => void run(() => restorePlanningPlace(id))}
                style={styles.restore}
              >
                <RotateCcw size={16} color={Colors.peach} />
                <Text style={styles.restoreLabel}>Restore</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {message ? (
        <Text accessibilityLiveRegion="polite" style={styles.message}>
          {message}
        </Text>
      ) : null}
      <View style={styles.section}>
        <Text style={styles.note}>
          Conversations expire after 24 hours. Unused generated plans expire
          after 180 days; saved routes and explicit preferences stay until you
          remove them. City scores and verified visits are separate from
          planning memory.
        </Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() =>
            Alert.alert(
              "Delete planning history?",
              "This removes saved routes, planning feedback and companion memory, and turns personalization off. City scores are kept.",
              [
                { text: "Keep history", style: "cancel" },
                {
                  text: "Delete history",
                  style: "destructive",
                  onPress: () =>
                    void run(async () => {
                      await deletePlanningHistory();
                      setMessage("Planning history deleted. Memory is off.");
                    }),
                },
              ],
            )
          }
          style={styles.delete}
        >
          <Trash2 size={18} color={Colors.peach} />
          <Text style={styles.restoreLabel}>Delete planning history</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: {
    paddingHorizontal: 22,
    gap: 28,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
  },
  header: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  headerText: {
    fontFamily: Fonts.uiSemiBold,
    color: Colors.peach,
    fontSize: 11,
    letterSpacing: 2,
  },
  hero: { gap: 16 },
  title: {
    fontFamily: Fonts.display,
    color: Colors.ink,
    fontSize: 37,
    lineHeight: 44,
    letterSpacing: -1,
  },
  italic: { fontFamily: Fonts.displayItalic, color: Colors.peach },
  body: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 15,
    lineHeight: 23,
    flexShrink: 1,
  },
  note: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 19,
  },
  card: {
    gap: 16,
    padding: 20,
    borderRadius: 22,
    backgroundColor: Colors.cardSolid,
    borderWidth: 1,
    borderColor: Colors.borderLight,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 48,
    gap: 12,
  },
  check: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: Colors.peach,
    alignItems: "center",
    justifyContent: "center",
  },
  section: { gap: 16 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  sectionTitle: { fontFamily: Fonts.display, color: Colors.ink, fontSize: 26 },
  route: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
  },
  routeTitle: {
    fontFamily: Fonts.uiSemiBold,
    color: Colors.ink,
    fontSize: 17,
    lineHeight: 23,
  },
  action: {
    minHeight: 50,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Colors.peach,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  actionLabel: {
    fontFamily: Fonts.uiSemiBold,
    color: Colors.inkDark,
    fontSize: 15,
  },
  restore: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
  },
  restoreLabel: {
    fontFamily: Fonts.uiMedium,
    color: Colors.peach,
    fontSize: 14,
  },
  delete: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  message: {
    fontFamily: Fonts.uiMedium,
    color: Colors.peach,
    fontSize: 15,
    lineHeight: 22,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.peachBorder,
    borderRadius: 16,
  },
});
