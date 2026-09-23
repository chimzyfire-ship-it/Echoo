import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { Host, Switch } from '@expo/ui';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeftIcon } from 'phosphor-react-native/src/icons/ArrowLeft';
import { BrandMark } from '@/src/components/brand-mark';
import { useAuth } from '@/src/providers/auth-provider';
import { enablePlanningNotifications } from '@/src/services/planning-notifications';
import { clearLocalReminders, notificationPreferences, saveNotificationPreferences } from '@/src/services/notifications';
import type { NotificationPreferences } from '@/src/services/notification-policy';
import { announce } from '@/src/services/notification-events';
import { Colors, Fonts } from '@/src/theme/tokens';

const OPTIONS: { key: keyof NotificationPreferences; title: string; body: string }[] = [
  { key: 'linkup', title: 'Link Up moments', body: 'New introductions, mutual matches and messages. Message text stays off your lock screen.' },
  { key: 'plans', title: 'Pick up a plan', body: 'A heads-up when your plan is ready, or one gentle reminder if you step away mid-conversation. Only between 9 am and 9 pm.' },
  { key: 'invitations', title: 'A little nudge to go out', body: '“Going somewhere?” after at least two days away, around 5 pm. Up to three invitations, then we give you space. Tap to open Echoo Home.' },
];
export default function NotificationsScreen() {
  const { user } = useAuth(), router = useRouter(), insets = useSafeAreaInsets(), client = useQueryClient();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const prefs = useQuery({ queryKey: ['notification-preferences', user?.id], queryFn: () => notificationPreferences(user!.id), enabled: !!user, retry: false });
  async function change(key: keyof NotificationPreferences, value: boolean) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try {
      if (value) await enablePlanningNotifications();
      await saveNotificationPreferences({ [key]: value });
      await clearLocalReminders();
      await client.invalidateQueries({ queryKey: ['notification-preferences', user?.id] });
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this change.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 44) + 6, paddingBottom: insets.bottom + 32 }]}>
    <View style={styles.header}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/profile')} style={styles.back}><ArrowLeftIcon size={22} color={Colors.ink} weight="light" /></Pressable><BrandMark size="small" /></View>
    <View style={styles.intro}><Text style={styles.title}>A word, now{ '\n' }and then.</Text><Text style={styles.body}>The useful things, at the right moment. You choose what gets through.</Text></View>
    {prefs.isPending ? <Text style={styles.body}>Loading your preferences…</Text> : prefs.isError ? <View style={styles.card}><Text style={styles.body}>{prefs.error.message}</Text><Pressable accessibilityRole="button" onPress={() => void prefs.refetch()} style={styles.action}><Text style={styles.actionText}>Try again</Text></Pressable></View> : OPTIONS.map((option) => <View key={option.key} style={styles.card}>
      <Host colorScheme="dark" matchContents><Switch label={option.title} value={prefs.data?.[option.key] || false} disabled={busy} onValueChange={(value) => void change(option.key, value)} /></Host>
      <Text style={styles.body}>{option.body}</Text>
    </View>)}
    {error ? <Text accessibilityRole="alert" style={styles.body}>{error}</Text> : null}
    <Pressable accessibilityRole="button" onPress={() => announce({ title: 'A little hello from Echoo', body: 'This is how useful moments will appear while you’re here.' })} style={styles.action}><Text style={styles.actionText}>Preview an in-app notification</Text></Pressable>
    <Pressable accessibilityRole="button" onPress={() => void Linking.openSettings().catch(() => setError('Open your phone’s Settings to change notification permissions.'))} style={styles.action}><Text style={styles.actionText}>Open phone notification settings</Text></Pressable>
    <Text style={styles.note}>Check-ins and leaving confirmations appear inside Echoo. We never infer that you visited or left from your location. Weekend and Culture Lens reminders are separate choices in planning settings.</Text>
  </ScrollView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, content: { paddingHorizontal: 22, gap: 20, maxWidth: 640, width: '100%', alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16 }, back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  intro: { gap: 16, paddingVertical: 12 }, title: { fontFamily: Fonts.displayRegular, fontSize: 38, lineHeight: 45, color: Colors.ink },
  body: { fontFamily: Fonts.ui, fontSize: 15, lineHeight: 23, color: Colors.textSecondary }, card: { gap: 14, padding: 20, borderRadius: 22, borderWidth: 1, borderColor: Colors.borderLight, backgroundColor: Colors.cardSolid },
  action: { minHeight: 48, justifyContent: 'center', paddingVertical: 10 }, actionText: { fontFamily: Fonts.uiMedium, fontSize: 15, lineHeight: 22, color: Colors.peach },
  note: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 12, lineHeight: 19 },
});
