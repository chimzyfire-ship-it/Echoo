import { useEffect, useRef, useState } from "react";
import { useRouter } from "expo-router";
import * as Crypto from "expo-crypto";
import {
  ArrowLeft,
  ArrowUp,
  ArrowUpRight,
  Clock3,
  MapPin,
  MessageCircle,
} from "lucide-react-native";
import { SlidersHorizontalIcon } from 'phosphor-react-native/src/icons/SlidersHorizontal';
import { CoffeeIcon } from 'phosphor-react-native/src/icons/Coffee';
import { HeartIcon } from 'phosphor-react-native/src/icons/Heart';
import { CompassIcon } from 'phosphor-react-native/src/icons/Compass';
import { BrandMark } from '@/src/components/brand-mark';
import { nextEditorial, PLANNING_WELCOMES } from '@/src/content/editorial';
import { usePlanningReminder } from '@/src/providers/notification-provider';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useEchooLocation } from "@/src/providers/location-provider";
import { useAuth } from "@/src/providers/auth-provider";
import { LocationPicker } from "@/src/components/location-picker";
import { CompanionRouteCard } from "@/src/components/companion-route-card";
import { CompanionPlace } from "@/src/components/companion-place";
import {
  planWithEchoo,
  startPlannedOuting,
  resumeCompanion,
  clearCompanion,
  type CompanionTurn,
  type CompanionResponse,
} from "@/src/services/planning";
import { Colors, Fonts } from "@/src/theme/tokens";

type Turn = CompanionTurn;
const STARTERS = [
  {
    title: "A little date night",
    detail: "Dinner, then somewhere to wander",
    query: "A relaxed date night for two. Sushi, then somewhere to wander.",
    icon: HeartIcon,
  },
  {
    title: "Take it slow",
    detail: "Coffee. Fresh air. No big agenda.",
    query: "It’s been a long week. A warm drink and a little fresh air would be nice.",
    icon: CoffeeIcon,
  },
  {
    title: "A change of scene",
    detail: "Something to get me out of my routine",
    query: "I want to get out of my routine. An art gallery and somewhere for coffee?",
    icon: CompassIcon,
  },
];

export function CompanionScreen({
  initialPrompt = "",
}: {
  initialPrompt?: string;
}) {
  const router = useRouter(),
    insets = useSafeAreaInsets();
  const { user, profile } = useAuth();
  const { location } = useEchooLocation();
  const [welcome] = useState(() => nextEditorial('planning-welcome', PLANNING_WELCOMES));
  const setPlanningReminder = usePlanningReminder();
  const [input, setInput] = useState(""),
    [turns, setTurns] = useState<Turn[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [locationOpen, setLocationOpen] = useState(false),
    [visibility, setVisibility] = useState(0),
    [restoring, setRestoring] = useState(true),
    [waitSeconds, setWaitSeconds] = useState(0),
    [resumed, setResumed] = useState(false);
  const previous = useRef<CompanionResponse | null>(null),
    controller = useRef<AbortController | null>(null),
    locked = useRef(false),
    mounted = useRef(true),
    scroll = useRef<ScrollView>(null);
  const retry = useRef<{ query: string; requestId: string } | null>(null),
    initialized = useRef(false),
    lastCity = useRef(location.city),
    lastUser = useRef(user?.id);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (lastCity.current !== location.city || lastUser.current !== user?.id) {
      controller.current?.abort();
      controller.current = null;
      locked.current = false;
      setBusy(false);
      previous.current = null;
      retry.current = null;
      setTurns([]);
      setError("");
      setInput("");
      setResumed(false);
      lastCity.current = location.city;
      lastUser.current = user?.id;
    }
  }, [location.city, user?.id]);
  useEffect(() => {
    if (!busy) { setWaitSeconds(0); return; }
    const timer = setInterval(() => setWaitSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!user || initialPrompt) { setRestoring(false); return; }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 8000);
    setRestoring(true);
    void resumeCompanion(location.city, abort.signal).then((conversation) => {
      if (!abort.signal.aborted && mounted.current && !locked.current && conversation) {
        previous.current = conversation.response;
        setTurns(conversation.turns);
        setResumed(true);
      }
    }).catch(() => {}).finally(() => {
      clearTimeout(timer);
      if (mounted.current && !abort.signal.aborted) setRestoring(false);
    });
    // The timeout also releases the interface if a restore cannot complete.
    abort.signal.addEventListener("abort", () => { if (mounted.current) setRestoring(false); }, { once: true });
    return () => { clearTimeout(timer); abort.abort(); };
  }, [user?.id, location.city, initialPrompt]);
  async function reset() {
    if (locked.current || restoring) return;
    const sessionId = previous.current?.sessionId;
    const owner = lastUser.current;
    const city = lastCity.current;
    locked.current = true;
    setRestoring(true);
    setError("");
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 10000);
    try {
      if (sessionId) await clearCompanion(sessionId, abort.signal);
    } catch {
      if (mounted.current && controller.current === abort) {
        setError("I couldn’t clear this conversation. It’s still here — try Start fresh again.");
      }
      return;
    } finally {
      clearTimeout(timeout);
      if (mounted.current && controller.current === abort) {
        locked.current = false;
        setRestoring(false);
      }
    }
    if (!mounted.current || owner !== lastUser.current || city !== lastCity.current) return;
    controller.current?.abort();
    controller.current = null;
    locked.current = false;
    setBusy(false);
    previous.current = null;
    retry.current = null;
    setTurns([]);
    setInput("");
    setError("");
    setResumed(false);
  }
  async function ask(query: string, retryId?: string) {
    const value = query.trim();
    if (!value || locked.current) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setInput("");
    // Sending an unchanged failed draft is the same operation as Try again.
    const requestId = retryId || (retry.current?.query === value ? retry.current.requestId : Crypto.randomUUID());
    retry.current = { query: value, requestId };
    if (!turns.some((turn) => turn.id === requestId))
      setTurns((current) => [
        ...current.slice(-19),
        { id: requestId, query: value },
      ]);
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 60000);
    try {
      const response = await planWithEchoo(
        { query: value, location, previous: previous.current, requestId },
        abort.signal,
      );
      if (!mounted.current || abort.signal.aborted) return;
      previous.current = response;
      retry.current = null;
      setTurns((current) =>
        current.map((turn) =>
          turn.id === requestId ? { ...turn, response } : turn,
        ),
      );
    } catch (error) {
      if (mounted.current && controller.current === abort) {
        setInput((draft) => draft || value);
        setError(
          abort.signal.aborted
            ? "That request took too long. Try again; your last route is still here."
              : error instanceof Error
              ? error.message
              : "Could not reach Echoo. Try again.",
        );
      }
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) {
        locked.current = false;
        if (mounted.current) setBusy(false);
      }
    }
  }
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      if (initialPrompt) void ask(initialPrompt);
    }
  }, [initialPrompt]);
  const last = turns.at(-1)?.response;
  useEffect(() => {
    setPlanningReminder(!busy && turns.length > 0 && !last?.plan);
    return () => setPlanningReminder(false);
  }, [busy, turns.length, last?.plan, setPlanningReminder]);
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <LinearGradient
        colors={[Colors.surfaceElevated, Colors.background]}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View style={[styles.nav, { paddingTop: Math.max(insets.top, 44) + 6 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close planner"
          onPress={() =>
            router.canGoBack() ? router.back() : router.replace("/(tabs)")
          }
          style={styles.icon}
        >
          <ArrowLeft size={22} color={Colors.ink} />
        </Pressable>
        <View style={styles.navTitle}>
          <BrandMark size="small" />
          <Text style={styles.navSuffix}>with you</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Planning memory and preferences"
          onPress={() => router.push({ pathname: '/planning-memory', params: { from: 'planner' } })}
          style={({ pressed }) => [styles.icon, pressed && styles.pressed]}
        >
          <SlidersHorizontalIcon size={23} weight="light" color={Colors.peach} />
        </Pressable>
      </View>
      <ScrollView
        ref={scroll}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={styles.content}
        onScroll={() => setVisibility((value) => value + 1)}
        scrollEventThrottle={200}
        onContentSizeChange={() => {
          if (busy) scroll.current?.scrollToEnd({ animated: false });
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Planning in ${location.label}. Change city.`}
          onPress={() => setLocationOpen(true)}
          disabled={busy}
          style={styles.location}
        >
          <MapPin size={14} color={Colors.peach} />
          <Text style={styles.locationText}>{location.label}</Text>
          <ArrowUpRight size={14} color={Colors.peach} />
        </Pressable>
        {resumed && turns.length ? <View style={styles.resumeNote}><MessageCircle size={14} color={Colors.peach} /><Text style={styles.note}>Right where we left off.</Text></View> : null}
        {last?.context?.length ? <View style={styles.contextSection}>
          <Text style={styles.contextLabel}>KEEPING IN MIND</Text>
          <View style={styles.contextChips}>{last.context.map((item) => <View key={item} style={styles.contextChip}><Text style={styles.contextText}>{item}</Text></View>)}</View>
        </View> : null}
        {!turns.length ? (
          <>
            <View style={styles.hero}>
              <BrandMark size="large" />
              <Text style={styles.eyebrow}>GOOD COMPANY. BETTER PLANS.</Text>
              <Text style={styles.title}>
                {welcome.title}{"\n"}
                <Text style={styles.italic}>{welcome.accent}</Text>
              </Text>
              <Text style={styles.body}>
                {welcome.body}
              </Text>
            </View>
            <View style={styles.starters}>
              {STARTERS.map((starter) => (
                <Pressable
                  key={starter.title}
                  accessibilityRole="button"
                  disabled={restoring}
                  onPress={() => void ask(starter.query)}
                  style={({ pressed }) => [
                    styles.starter,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={styles.starterSymbol}><starter.icon size={22} weight="light" color={Colors.peach} /></View>
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={styles.starterTitle}>{starter.title}</Text>
                    <Text style={styles.starterDetail}>{starter.detail}</Text>
                  </View>
                  <ArrowUpRight size={18} color={Colors.peach} />
                </Pressable>
              ))}
            </View>
            <View style={styles.taste}>
              <Text style={styles.eyebrow}>A STARTING POINT, NOT A BOX</Text>
              <Text style={styles.tasteText}>
                {profile
                  ? `${profile.energy === "hype" ? "Lively" : profile.energy === "curious" ? "Curious" : "Chill"} energy · ${profile.budget} budget`
                  : "Your preferences, your pace"}
              </Text>
              <Text style={styles.note}>
                No need to get the request just right. We can change our minds as we go.
              </Text>
            </View>
          </>
        ) : null}
        {turns.map((turn) => (
          <View key={turn.id} style={styles.turn}>
            <View style={styles.userBubble}>
              <Text selectable style={styles.userText}>
                {turn.query}
              </Text>
            </View>
            {turn.response ? (
              <View style={styles.answer}>
                <View style={styles.answerByline}><BrandMark size="small" /></View>
                <Text selectable style={styles.answerText}>
                  {turn.response.message}
                </Text>
                {turn.response.callback ? (
                  <Text style={styles.callback}>{turn.response.callback}</Text>
                ) : null}
                {turn.response.plan ? (
                  <CompanionRouteCard
                    plan={turn.response.plan}
                    places={turn.response.places}
                    visibilitySignal={visibility}
                    onStart={() => {
                      void (async () => {
                        try {
                          if (!user) return;
                          await startPlannedOuting(
                            user.id,
                            turn.response!.plan!,
                          );
                          router.push({
                            pathname: "/planner",
                            params: { quickPlan: "resume" },
                          });
                        } catch (error) {
                          setError(
                            error instanceof Error
                              ? error.message
                              : "Could not open your outing.",
                          );
                        }
                      })();
                    }}
                  />
                ) : null}
                {!turn.response.plan && turn.response.places?.length ? <View style={styles.possibilities}>
                  <Text style={styles.eyebrow}>PLACES TO CONSIDER</Text>
                  <Text style={styles.note}>These are possibilities, not a checked route yet.</Text>
                  {turn.response.places.map((place) => <CompanionPlace key={place.id} place={place} />)}
                </View> : null}
                {turn.response.notices.map((notice) => (
                  <Text key={notice} style={styles.note}>
                    {notice}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ))}
        {busy || restoring ? (
          <View accessibilityLiveRegion="polite" style={styles.thinking}>
            <ActivityIndicator size="small" color={Colors.peach} />
            <Text style={styles.note}>
              {restoring ? "Picking up our conversation…" : waitSeconds < 5 ? "Let me think of something you’ll like…" : waitSeconds < 14 ? "Putting the details together…" : "Taking a little longer. I’m still with you…"}
            </Text>
          </View>
        ) : null}
        {error ? (
          <View style={styles.error}>
            <Text accessibilityRole="alert" style={styles.answerText}>
              {error}
            </Text>
            {retry.current ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => {
                  const value = retry.current;
                  if (value) void ask(value.query, value.requestId);
                }}
                style={styles.retry}
              >
                <Text style={styles.retryLabel}>Try again</Text>
              </Pressable>
            ) : null}
            {!busy ? <Pressable accessibilityRole="button" onPress={reset} style={styles.retry}><Text style={styles.note}>Start fresh</Text></Pressable> : null}
          </View>
        ) : null}
        {last && !busy ? (
          <View style={styles.suggestions}>
            {last.suggestions.map((suggestion) => (
              <Pressable
                key={suggestion}
                accessibilityRole="button"
                onPress={() => void ask(suggestion)}
                style={({ pressed }) => [
                  styles.pill,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.pillText}>{suggestion}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>
      <View
        style={[
          styles.composerArea,
          { paddingBottom: Math.max(insets.bottom, 12) },
        ]}
      >
        <View style={styles.composer}>
          <TextInput
            accessibilityLabel="Describe your plan"
            value={input}
            onChangeText={setInput}
            maxLength={1200}
            multiline
            placeholder={turns.length ? "What are you thinking?" : "A mood, a craving, a what-if…"}
            placeholderTextColor={Colors.textSecondary}
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Send planning request"
            accessibilityState={{ disabled: busy || restoring || !input.trim() }}
            disabled={busy || restoring || !input.trim()}
            onPress={() => void ask(input)}
            style={({ pressed }) => [
              styles.send,
              (busy || restoring || !input.trim()) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {busy ? (
              <ActivityIndicator color={Colors.inkDark} />
            ) : (
              <ArrowUp size={22} color={Colors.inkDark} />
            )}
          </Pressable>
        </View>
        <View style={styles.footnote}>
          <Clock3 size={12} color={Colors.textSecondary} />
          <Text style={styles.footnoteText}>
            Context stays for 24h. Long-term memory is your choice.
          </Text>
        </View>
      </View>
      <LocationPicker
        visible={locationOpen}
        onClose={() => setLocationOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  nav: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  icon: {
    width: 48,
    height: 48,
    justifyContent: "center",
    alignItems: "center",
  },
  navTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  navName: { fontFamily: Fonts.display, color: Colors.ink, fontSize: 26 },
  navSuffix: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 16,
  },
  content: {
    paddingHorizontal: 22,
    paddingBottom: 28,
    gap: 24,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  location: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    minHeight: 48,
  },
  locationText: {
    fontFamily: Fonts.uiMedium,
    color: Colors.peach,
    fontSize: 13,
  },
  hero: { gap: 18, paddingBottom: 8 },
  orbit: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: Colors.peachBorder,
    backgroundColor: Colors.peachSubtle,
    justifyContent: "center",
    alignItems: "center",
  },
  orbitLetter: { fontFamily: Fonts.displayItalic, color: Colors.peach, fontSize: 43, lineHeight: 52 },
  answerByline: { flexDirection: "row", alignItems: "center", gap: 10 },
  smallOrbit: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: Colors.peachSubtle },
  smallOrbitLetter: { fontFamily: Fonts.displayItalic, color: Colors.peach, fontSize: 23, lineHeight: 28 },
  answerName: { fontFamily: Fonts.display, fontSize: 18, color: Colors.peach },
  resumeNote: { flexDirection: "row", alignItems: "center", gap: 8 },
  contextSection: { gap: 10, paddingBottom: 8 },
  contextLabel: { fontFamily: Fonts.uiMedium, fontSize: 10, letterSpacing: 1.5, color: Colors.textSecondary },
  contextChips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  contextChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 14, backgroundColor: Colors.goldSubtle },
  contextText: { fontFamily: Fonts.ui, color: Colors.peach, fontSize: 12, lineHeight: 18 },
  starterSymbol: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.peachSubtle, alignItems: "center", justifyContent: "center" },
  possibilities: { gap: 12 },
  eyebrow: {
    fontFamily: Fonts.uiSemiBold,
    color: Colors.peach,
    fontSize: 10,
    letterSpacing: 1.7,
  },
  title: {
    fontFamily: Fonts.display,
    color: Colors.ink,
    fontSize: 40,
    lineHeight: 46,
    letterSpacing: -1.4,
  },
  italic: { fontFamily: Fonts.displayItalic, color: Colors.peach },
  body: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 16,
    lineHeight: 25,
    maxWidth: 440,
  },
  starters: { gap: 10 },
  starter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    padding: 16,
    minHeight: 84,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.borderLight,
    backgroundColor: Colors.surfaceSubtle,
  },
  starterNumber: { fontFamily: Fonts.ui, color: Colors.peach, fontSize: 12 },
  starterTitle: {
    fontFamily: Fonts.uiSemiBold,
    color: Colors.ink,
    fontSize: 16,
  },
  starterDetail: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  taste: {
    gap: 10,
    padding: 20,
    borderRadius: 20,
    backgroundColor: Colors.peachSubtle,
  },
  tasteText: { fontFamily: Fonts.uiMedium, color: Colors.ink, fontSize: 15 },
  note: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  turn: { gap: 24 },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "92%",
    backgroundColor: Colors.peachSubtle,
    padding: 16,
    borderRadius: 20,
    borderBottomRightRadius: 6,
    borderWidth: 1,
    borderColor: Colors.peachBorder,
  },
  userText: {
    fontFamily: Fonts.ui,
    color: Colors.ink,
    fontSize: 16,
    lineHeight: 24,
  },
  answer: { gap: 14 },
  answerText: {
    fontFamily: Fonts.ui,
    color: Colors.ink,
    fontSize: 16,
    lineHeight: 25,
  },
  callback: {
    fontFamily: Fonts.displayItalic,
    color: Colors.peach,
    fontSize: 18,
    lineHeight: 26,
  },
  thinking: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
  },
  error: {
    padding: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: Colors.peachBorder,
    gap: 10,
  },
  retry: { minHeight: 48, justifyContent: "center" },
  retryLabel: {
    fontFamily: Fonts.uiSemiBold,
    color: Colors.peach,
    fontSize: 15,
  },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  pill: {
    minHeight: 48,
    paddingHorizontal: 16,
    justifyContent: "center",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: Colors.peachBorder,
  },
  pillText: { fontFamily: Fonts.uiMedium, color: Colors.peach, fontSize: 14 },
  composerArea: {
    paddingTop: 12,
    paddingHorizontal: 18,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.background,
  },
  composer: {
    maxWidth: 680,
    width: "100%",
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 12,
    padding: 8,
    paddingLeft: 16,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: Colors.peachBorder,
    backgroundColor: Colors.cardSolid,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    fontFamily: Fonts.ui,
    color: Colors.ink,
    fontSize: 16,
    lineHeight: 23,
    paddingTop: 12,
    paddingBottom: 10,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.peach,
  },
  disabled: { opacity: 0.4 },
  footnote: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
    paddingTop: 10,
  },
  footnoteText: {
    fontFamily: Fonts.ui,
    color: Colors.textSecondary,
    fontSize: 10,
    lineHeight: 15,
    flexShrink: 1,
  },
  pressed: { opacity: 0.72 },
});
