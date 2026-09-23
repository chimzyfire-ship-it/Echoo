import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Modal, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, FadeIn, FadeInDown, ReduceMotion } from 'react-native-reanimated';
import Svg, { Circle, Defs, Mask, Rect as SvgRect } from 'react-native-svg';
import { ArrowUpRight } from 'lucide-react-native';
import { PrimaryButton } from '@/src/components/primary-button';
import { useAuth } from '@/src/providers/auth-provider';
import { supabase } from '@/src/services/supabase';
import { Colors, Fonts } from '@/src/theme/tokens';

const steps = [
  { key: 'home', title: 'Start with a feeling.', body: 'Ask Echoo for a plan. Your interests, budget and pace help shape the suggestions.' },
  { key: 'discover', title: 'Find your kind of place.', body: 'Explore places and activities. Follow what catches your eye and make it part of your day.' },
  { key: 'link-up', title: 'Make room for connection.', body: 'Meet people with shared interests through Link Up. You choose when to connect.' },
  { key: 'profile', title: 'Your taste can change.', body: 'Visit your profile to update your preferences. Echoo can keep up with what feels like you.' },
] as const;
type Target = typeof steps[number]['key'];
type Rect = { x: number; y: number; width: number; height: number };
const Targets = createContext<React.MutableRefObject<Partial<Record<Target, View | null>>> | null>(null);
// Share in-flight requests across Strict Mode effects; consume only after a live
// instance receives the result. Remounts and token refreshes cannot replay it.
const claims = new Map<string, Promise<boolean>>();
function claim(id: string) {
  let result = claims.get(id);
  if (!result) {
    result = Promise.resolve(supabase.rpc('claim_first_use_walkthrough')).then(({ data, error }) => {
      if (error) { claims.delete(id); return false; }
      return data === true;
    });
    claims.set(id, result);
  }
  return result;
}
export function TourTarget({ name, children }: { name: Target; children: React.ReactNode }) {
  const targets = useContext(Targets);
  return <View collapsable={false} ref={(node) => { if (targets) targets.current[name] = node; }}>{children}</View>;
}
export function FirstUseWalkthrough({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const targets = useRef<Partial<Record<Target, View | null>>>({});
  const [owner, setOwner] = useState<string | null>(null);
  const [step, setStep] = useState(-1);
  const [rect, setRect] = useState<Rect | null>(null);
  const { width, height, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const visible = !!user && owner === user.id;
  const current = steps[step];
  const completed = Boolean(profile?.completedAt);

  useEffect(() => {
    let live = true;
    setOwner(null);
    if (user && completed) {
      void claim(user.id).then((show) => {
        if (!live || !show) return;
        claims.set(user.id, Promise.resolve(false));
        setStep(-1);
        setOwner(user.id);
      }).catch(() => { claims.delete(user.id); });
    }
    return () => { live = false; };
  }, [user?.id, completed]);

  useEffect(() => {
    setRect(null);
    if (!visible || !current) return;
    let live = true;
    const measure = () => targets.current[current.key]?.measureInWindow((x, y, w, h) => {
      if (live && w > 0 && h > 0) setRect({ x, y, width: w, height: h });
    });
    const timer = setTimeout(measure, 100);
    AccessibilityInfo.announceForAccessibility(`${step + 1} of ${steps.length}. ${current.title} ${current.body}`);
    return () => { live = false; clearTimeout(timer); };
  }, [visible, step, width, height, fontScale, current]);

  const dismiss = () => setOwner(null);
  const radius = rect ? Math.max(rect.width, rect.height) / 2 + 14 : 0;
  const cx = rect ? rect.x + rect.width / 2 : 0;
  const cy = rect ? rect.y + rect.height / 2 : 0;
  // The coach card scrolls independently on landscape and large text settings.
  const cardBottom = rect ? Math.max(insets.bottom + 16, height - (cy - radius) + 16) : insets.bottom + 24;
  const entrance = FadeInDown.duration(280).easing(Easing.bezier(0.23, 1, 0.32, 1)).reduceMotion(ReduceMotion.System);
  return <Targets.Provider value={targets}>
    <View style={styles.root} accessibilityElementsHidden={visible} importantForAccessibility={visible ? 'no-hide-descendants' : 'auto'}>{children}</View>
    <Modal visible={visible} transparent statusBarTranslucent navigationBarTranslucent animationType="none" onRequestClose={dismiss}>
      <View style={styles.root} accessibilityViewIsModal>
        {current && rect ? <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs><Mask id="spotlight"><SvgRect width={width} height={height} fill="white" /><Circle cx={cx} cy={cy} r={radius} fill="black" /></Mask></Defs>
          <SvgRect width={width} height={height} fill="rgba(0,0,0,0.78)" mask="url(#spotlight)" />
        </Svg> : <View style={[StyleSheet.absoluteFill, { backgroundColor: current ? 'rgba(0,0,0,0.78)' : Colors.background }]} />}
        {current && rect ? <View pointerEvents="none" style={[styles.ring, { left: cx - radius, top: cy - radius, width: radius * 2, height: radius * 2, borderRadius: radius }]} /> : null}
        {!current ? <ScrollView contentContainerStyle={[styles.completion, { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 24 }]}>
          <Animated.View entering={entrance} style={styles.success}><ArrowUpRight size={46} color={Colors.success} /></Animated.View>
          <Animated.View entering={FadeIn.duration(280).delay(100).reduceMotion(ReduceMotion.System)} style={styles.copy}>
            <Text style={styles.eyebrow}>ONBOARDING COMPLETE</Text>
            <Text accessibilityRole="header" style={styles.hero}>A little more you.{'\n'}A lot more possibility.</Text>
            <Text style={styles.body}>Your interests, your pace, your kind of plans. Echoo uses what you shared to personalise suggestions around {profile?.homeCity || 'your city'}.</Text>
            <View style={styles.signals}>{[profile?.interests[0], profile?.budget, profile?.energy === 'chill' ? 'Easygoing' : profile?.energy === 'hype' ? 'Social energy' : 'Room to explore'].filter(Boolean).map((label, i) => <Text key={i} style={styles.signal}>{label}</Text>)}</View>
            <Text style={styles.note}>Always yours to change in your profile.</Text>
            <PrimaryButton label="Show me around" onPress={() => setStep(0)} />
            <PrimaryButton label="Explore on my own" variant="quiet" onPress={dismiss} />
          </Animated.View>
        </ScrollView> : <View style={[styles.card, { bottom: cardBottom, maxHeight: Math.max(120, height - cardBottom - insets.top - 16) }]}>
          <ScrollView contentContainerStyle={styles.cardContent}>
            <Text style={styles.eyebrow}>YOUR ECHOO · {step + 1} / {steps.length}</Text>
            <Text accessibilityRole="header" style={styles.title}>{current.title}</Text>
            <Text style={styles.body}>{current.body}</Text>
            <PrimaryButton label={step === steps.length - 1 ? 'Make yourself at home' : 'Next'} onPress={() => { setRect(null); if (step === steps.length - 1) dismiss(); else setStep(step + 1); }} />
            <View style={styles.actions}>
              <PrimaryButton label="Back" variant="quiet" fullWidth={false} onPress={() => setStep(step - 1)} />
              <PrimaryButton label="Skip tour" variant="quiet" fullWidth={false} onPress={dismiss} />
            </View>
          </ScrollView>
        </View>}
      </View>
    </Modal>
  </Targets.Provider>;
}
const styles = StyleSheet.create({
  root: { flex: 1 },
  completion: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, gap: 28 },
  success: { width: 96, height: 96, borderRadius: 48, backgroundColor: '#10271F', borderWidth: 1, borderColor: Colors.success, alignItems: 'center', justifyContent: 'center' },
  copy: { width: '100%', maxWidth: 480, gap: 20 },
  eyebrow: { color: Colors.peach, fontFamily: Fonts.uiSemiBold, fontSize: 12, letterSpacing: 2 },
  hero: { color: Colors.ink, fontFamily: Fonts.displayMedium, fontSize: 38, lineHeight: 46, letterSpacing: -1 },
  body: { color: Colors.textSecondary, fontFamily: Fonts.ui, fontSize: 16, lineHeight: 25 },
  note: { color: Colors.textSecondary, fontFamily: Fonts.ui, fontSize: 13 },
  signals: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  signal: { color: Colors.peach, backgroundColor: Colors.peachSubtle, fontFamily: Fonts.uiMedium, padding: 10, borderRadius: 14 },
  ring: { position: 'absolute', borderWidth: 2, borderColor: Colors.peach, backgroundColor: 'rgba(247,213,178,0.08)' },
  card: { position: 'absolute', alignSelf: 'center', width: '92%', maxWidth: 440, backgroundColor: Colors.cardSolid, borderRadius: 24, borderWidth: 1, borderColor: Colors.borderAccent },
  cardContent: { padding: 24, gap: 16 },
  title: { color: Colors.ink, fontFamily: Fonts.displayMedium, fontSize: 28, lineHeight: 35 },
  actions: { flexDirection: 'row', justifyContent: 'space-between' },
});
