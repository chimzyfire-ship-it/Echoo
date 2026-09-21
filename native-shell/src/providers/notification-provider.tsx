import { createContext, useCallback, useContext, useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, FadeIn, FadeInUp, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { FullWindowOverlay } from 'react-native-screens';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePathname, useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { XIcon } from 'phosphor-react-native/src/icons/X';
import { BrandMark } from '@/src/components/brand-mark';
import { useAuth } from './auth-provider';
import { Colors, Fonts } from '@/src/theme/tokens';
import { listenForNotices, type AppNotice } from '@/src/services/notification-events';
import { notificationPath } from '@/src/services/notification-policy';
import { clearLocalReminders, markActive, notificationPreferences, readNotification, scheduleInactivity } from '@/src/services/notifications';
import { enablePlanningNotifications } from '@/src/services/planning-notifications';
import { supabase } from '@/src/services/supabase';

const PlanningContext = createContext<(active: boolean) => void>(() => {});
export const usePlanningReminder = () => useContext(PlanningContext);

export function NotificationProvider({ children }: PropsWithChildren) {
  const { user, ready, profile } = useAuth();
  const router = useRouter(), path = usePathname(), insets = useSafeAreaInsets();
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const [reduced, setReduced] = useState(false), [screenReader, setScreenReader] = useState(false);
  const unfinished = useRef(false), seen = useRef(new Set<string>()), currentPath = useRef(path);
  currentPath.current = path;
  const setPlanning = useCallback((active: boolean) => { unfinished.current = active; }, []);
  const prefs = useQuery({ queryKey: ['notification-preferences', user?.id], queryFn: () => notificationPreferences(user!.id), enabled: !!user && !!profile?.completedAt, retry: false });
  const latestPrefs = useRef(prefs.data); latestPrefs.current = prefs.data;
  const show = useCallback((value: AppNotice) => {
    if (AppState.currentState !== 'active' || (value.userId && value.userId !== user?.id)) return;
    if (value.id && seen.current.has(value.id)) return;
    if (value.id) { seen.current.add(value.id); if (seen.current.size > 100) seen.current.delete(seen.current.values().next().value!); }
    setNotice(value);
    AccessibilityInfo.announceForAccessibility(`${value.title}. ${value.body}`);
  }, [user?.id]);
  useEffect(() => listenForNotices(show), [show]);
  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(setReduced);
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    const reader = AccessibilityInfo.addEventListener('screenReaderChanged', setScreenReader);
    return () => { motion.remove(); reader.remove(); };
  }, []);
  useEffect(() => {
    if (!notice || screenReader) return;
    const timer = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [notice, screenReader]);
  useEffect(() => {
    setNotice(null); seen.current.clear(); unfinished.current = false;
    void clearLocalReminders().catch(() => {});
    if (!ready || !user || !profile?.completedAt) return;
    void markActive().catch(() => {});
    const timer = setInterval(() => { if (AppState.currentState === 'active') void markActive().catch(() => {}); }, 45000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        setNotice(null);
        void clearLocalReminders().catch(() => {});
        void markActive().catch(() => {});
        void prefs.refetch();
      } else if (state === 'background' && latestPrefs.current) {
        void scheduleInactivity(user.id, latestPrefs.current, unfinished.current).catch(() => {});
      }
    });
    return () => { clearInterval(timer); subscription.remove(); void clearLocalReminders().catch(() => {}); };
  }, [ready, user?.id, profile?.completedAt]);
  useEffect(() => {
    if (prefs.data && Object.values(prefs.data).some(Boolean)) void enablePlanningNotifications(false).catch(() => {});
  }, [prefs.data, user?.id]);
  useEffect(() => {
    if (Platform.OS === 'web' || !ready || !user || !profile?.completedAt) return;
    // Foreground notifications use our banner. Background banners belong to iOS.
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false, shouldSetBadge: false }) });
    const received = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification.request.content, data = content.data || {};
      if (data.userId !== user.id) return;
      if (data.kind === 'invitation' || data.kind === 'plan-reminder') return;
      const target = notificationPath(data.path);
      if (target) show({ id: String(data.eventId || notification.request.identifier), userId: user.id, title: content.title || 'Echoo', body: content.body || '', path: target });
    });
    return () => received.remove();
  }, [ready, user?.id, profile?.completedAt, show]);
  useEffect(() => {
    if (!user || !profile?.completedAt) return;
    const channel = supabase.channel(`notifications:${user.id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notification_events', filter: `user_id=eq.${user.id}` }, ({ new: event }) => {
      if (AppState.currentState !== 'active' || new Date(event.expires_at).getTime() <= Date.now()) return;
      void readNotification(event.id).catch(() => {});
      if ((event.kind === 'plan_ready' && currentPath.current === '/planner') || (event.kind === 'message' && currentPath.current.endsWith('/link-up'))) return;
      const target = notificationPath(event.path);
      if (target) show({ id: event.id, title: event.title, body: event.body, path: target, userId: user.id });
    }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user?.id, profile?.completedAt, show]);
  const banner = notice ? <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { zIndex: 10000 }]}>
    <Animated.View entering={reduced ? FadeIn.duration(150) : FadeInUp.duration(240).easing(Easing.bezier(0.23, 1, 0.32, 1)).reduceMotion(ReduceMotion.System)} exiting={FadeOut.duration(150)} style={[styles.banner, { marginTop: insets.top + 8 }]}>
      <Pressable accessibilityRole={notice.path ? 'button' : 'text'} accessibilityLabel={`${notice.title}. ${notice.body}${notice.path ? '. Open' : ''}`} onPress={() => { const target = notificationPath(notice.path); setNotice(null); if (target) router.dismissTo(target as Href); }} disabled={!notice.path} style={({ pressed }) => [styles.main, pressed && { opacity: 0.75 }]}>
        <BrandMark size="small" /><View style={styles.copy}><Text style={styles.title}>{notice.title}</Text><Text style={styles.body}>{notice.body}</Text></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Dismiss notification" onPress={() => setNotice(null)} style={styles.close}><XIcon size={18} weight="light" color={Colors.textSecondary} /></Pressable>
    </Animated.View>
  </View> : null;
  return <PlanningContext.Provider value={setPlanning}>{children}{Platform.OS === 'ios' && banner ? <FullWindowOverlay>{banner}</FullWindowOverlay> : banner}</PlanningContext.Provider>;
}
const styles = StyleSheet.create({
  banner: { alignSelf: 'center', width: '94%', maxWidth: 540, flexDirection: 'row', alignItems: 'center', borderRadius: 22, borderCurve: 'continuous', backgroundColor: Colors.cardSolid, borderWidth: 1, borderColor: Colors.peachBorder, boxShadow: '0 8px 28px rgba(0,0,0,0.28)' },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, minHeight: 72 },
  copy: { flex: 1, gap: 4 }, title: { fontFamily: Fonts.uiMedium, color: Colors.ink, fontSize: 15, lineHeight: 20 },
  body: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  close: { minWidth: 48, minHeight: 48, justifyContent: 'center', alignItems: 'center' },
});
