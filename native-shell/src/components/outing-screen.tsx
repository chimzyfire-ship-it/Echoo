import { useEffect, useRef, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { DiscoveryCard } from '@/src/models';
import { QuickPlanCard } from '@/src/components/quick-plan-card';
import { OutingChoices } from '@/src/components/outing-choices';
import { defaultOutingChoices, generateOuting, loadActiveOuting, saveActiveOuting, verifyArrival, type ActiveOuting } from '@/src/services/outing';
import { Colors, Fonts } from '@/src/theme/tokens';
import { announce } from '@/src/services/notification-events';

export function OutingScreen({ initial, userId }: { initial?: string; userId?: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const [outing, setOuting] = useState<ActiveOuting | null>(null);
  const [choices, setChoices] = useState(defaultOutingChoices);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [editing, setEditing] = useState(false);
  const locked = useRef(false);
  const mounted = useRef(true);
  const scroll = useRef<ScrollView>(null);
  const cardTop = useRef(0);
  const placeTops = useRef<Record<string, number>>({});

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        let value = userId ? await loadActiveOuting(userId) : null;
        if (initial && initial !== 'resume') {
          const parsed = JSON.parse(initial) as ActiveOuting;
          if (parsed.ownerId === userId && parsed.id && parsed.choices && parsed.progress && Array.isArray(parsed.plan?.stops) && parsed.plan.stops.some((place) => place.id === parsed.plan.anchorId)) {
            // Resume saved progress for this outing, not a different saved route.
            if (value?.id !== parsed.id) value = parsed;
          }
        }
        if (mounted.current && value) { setOuting(value); setChoices(value.choices); }
      } catch { if (mounted.current) setMessage('Your saved outing could not be loaded. Try reopening it while signed in.'); }
      finally { if (mounted.current) setReady(true); }
    })();
    return () => { mounted.current = false; };
  }, [initial, userId]);

  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setMessage('');
    try { await action(); }
    catch (error) { if (mounted.current) setMessage(error instanceof Error ? error.message : 'Could not connect. Your progress has not changed.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }

  async function progress(placeId: string, action: 'arrive' | 'leave' | 'skip') {
    if (!outing) return;
    const current = outing.plan.stops.find((place) => !['completed', 'skipped'].includes(outing.progress[place.id]?.status || 'planned'));
    if (current?.id !== placeId || (action === 'leave' && outing.progress[placeId]?.status !== 'arrived')) return;
    let visitId = outing.progress[placeId]?.visitId;
    if (action === 'arrive') {
      if (!userId) throw new Error('Sign in to verify arrival and earn city points.');
      const result = await verifyArrival(userId, placeId);
      visitId = result.visitId;
      if (mounted.current) setMessage(result.awardedPoints ? `Arrival verified. 10 points added in ${result.city}.` : `Arrival verified. This place already earned points today in ${result.city}.`);
      void queryClient.invalidateQueries({ queryKey: ['city-scores', userId] });
    }
    const next: ActiveOuting = { ...outing, progress: { ...outing.progress, [placeId]: {
      status: action === 'arrive' ? 'arrived' : action === 'leave' ? 'completed' : 'skipped', visitId, at: new Date().toISOString(),
    } } };
    if (userId) await saveActiveOuting(userId, next);
    if (mounted.current) {
      setOuting(next);
      if (action === 'arrive') announce({ title: 'You’ve arrived', body: current.name, userId });
      if (action === 'leave') announce({ title: 'On to the next', body: `You’ve marked your stop at ${current.name} complete.`, userId });
      if (action !== 'arrive') {
        const following = next.plan.stops.find((place) => !['completed', 'skipped'].includes(next.progress[place.id]?.status || 'planned'));
        setMessage(following ? `Next place: ${following.name}. No points added for moving on.` : 'Outing finished. Your verified visits are saved.');
        if (following) scroll.current?.scrollTo({ y: cardTop.current + (placeTops.current[following.id] || 0), animated: false });
      }
    }
  }

  async function regenerate() {
    if (!outing) return;
    const place = outing.plan.stops.find((item) => item.id === outing.plan.anchorId);
    if (!place) throw new Error('The place you chose is missing. Open it again from Discover.');
    const anchor: DiscoveryCard = { id: place.id, canonicalId: place.id, title: place.name, category: place.category, latitude: place.latitude, longitude: place.longitude,
      city: outing.plan.city || '', address: place.address, source: 'echoo', type: 'place', description: '', distanceMeters: null, startsAt: null,
      image: place.imageUrl ? { url: place.imageUrl, alt: place.name } : null, features: [], community: null, placement: null };
    const next = await generateOuting({ anchor, stopCount: choices.stopCount, profile: outing.profile, recentPlaceIds: outing.recentPlaceIds || outing.plan.stops.filter((item) => !item.isAnchor).map((item) => item.id) }, choices, userId);
    if (mounted.current) { setOuting(next); setEditing(false); scroll.current?.scrollTo({ y: 0, animated: false }); }
  }

  const finished = outing && outing.plan.stops.every((place) => ['completed', 'skipped'].includes(outing.progress[place.id]?.status || 'planned'));
  const started = outing && Object.keys(outing.progress).length > 0;
  const currentIndex = outing?.plan.stops.findIndex((place) => !['completed', 'skipped'].includes(outing.progress[place.id]?.status || 'planned')) ?? -1;
  const changedChoices = outing && JSON.stringify(choices) !== JSON.stringify(outing.choices);
  return <ScrollView ref={scroll} style={styles.screen} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, 16), paddingBottom: Math.max(insets.bottom, 24) + 24 }]}>
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={({ pressed }) => [{ minHeight: 48, justifyContent: 'center', opacity: pressed ? 0.6 : 1 }]}><Text style={styles.status}>Close outing</Text></Pressable>
    {!ready ? <Text style={styles.body}>Opening your outing...</Text> : !outing ? <View style={styles.section}>
      <Text style={styles.title}>Your next outing starts with a place.</Text><Text style={styles.body}>No saved outing for this account. Choose a place in Discover, then make an outing of it.</Text>
      <Action label="Explore places" onPress={() => router.push('/(tabs)/discover')} />
    </View> : <>
      <View onLayout={(event) => { cardTop.current = event.nativeEvent.layout.y; }}><QuickPlanCard plan={outing.plan} onPlaceLayout={(id, y) => { placeTops.current[id] = y; }} renderProgress={(place, index) => {
        const state = outing.progress[place.id]?.status || 'planned';
        return <View style={styles.section}>
          <Text style={styles.status}>{state === 'arrived' ? 'Arrived / verified' : state === 'completed' ? 'Completed / verified visit' : state === 'skipped' ? 'Skipped / not a visit' : 'Planned / not yet visited'}</Text>
          {index === currentIndex && message ? <Text selectable accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
          <Action label="Directions" quiet disabled={busy} onPress={() => void run(async () => { await Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`); })} />
          {index === currentIndex && state === 'planned' && !place.id.toLowerCase().startsWith('google:') ? <>
            <Text style={styles.note}>By tapping "I'm here", you agree to send your current location for a one-time check within 150 metres of this place. No background tracking. 10 points once per place per local day.</Text>
            <Action label={busy ? 'Please wait...' : "I'm here"} disabled={busy} onPress={() => void run(() => progress(place.id, 'arrive'))} />
          </> : null}
          {index === currentIndex && state === 'planned' && place.id.toLowerCase().startsWith('google:') ? (
            <Text style={styles.note}>This place is not in Echoo's verified-visit inventory yet, so arrival checks and city points are unavailable here. Directions and progress still work.</Text>
          ) : null}
          {index === currentIndex && state === 'planned' ? <Action label={index === outing.plan.stopCount - 1 ? 'Skip this place. Finish outing' : 'Skip this place. Next place'} disabled={busy} quiet onPress={() => void run(() => progress(place.id, 'skip'))} /> : null}
          {index === currentIndex && state === 'arrived' ? <Action label={index === outing.plan.stopCount - 1 ? "I'm leaving. Finish outing" : "I'm leaving. Next place"} disabled={busy} onPress={() => void run(() => progress(place.id, 'leave'))} /> : null}
        </View>;
      }} /></View>
      <Text style={styles.note}>{finished ? 'Outing finished. ' : `Place ${currentIndex + 1} of ${outing.plan.stopCount}. `}{!userId ? 'Guest progress lasts only while this screen is open.' : 'This outing is saved on this device for your account.'} GPS checks proximity, not proof of attendance. Directions and moving to the next place never earn points.</Text>
      {!started && outing.source==='companion' ? <Text style={styles.note}>To refine this route, return to your Echoo conversation. Your original requests stay with that conversation.</Text> : null}
      {!started && outing.source!=='companion' ? <View style={styles.section}>
        <Action label={editing ? 'Hide preferences' : 'Change outing preferences'} quiet disabled={busy} onPress={() => setEditing(!editing)} />
        {editing ? <OutingChoices value={choices} onChange={setChoices} disabled={busy} /> : null}
        <Action label={busy ? 'Finding alternatives...' : 'Try another plan'} disabled={busy || (outing.plan.alternativesExhausted === true && !changedChoices)} onPress={() => void run(regenerate)} />
        <Text style={styles.note}>{outing.plan.alternativesExhausted && !changedChoices ? 'No further alternatives for these preferences in this inventory. Keep this outing or change your preferences.' : `Keeps ${outing.plan.anchorName} and your selected preferences. Other places change only when inventory allows.`}</Text>
      </View> : null}
      {finished ? <Action label="See city scores and badges" onPress={() => router.push('/(tabs)/profile')} /> : null}
    </>}
    {message ? <Text selectable accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
  </ScrollView>;
}

function Action({ label, onPress, disabled, quiet }: { label: string; onPress: () => void; disabled?: boolean; quiet?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.action, quiet && styles.quiet, (disabled || pressed) && { opacity: 0.45 }]}><Text style={[styles.actionText, quiet && { color: Colors.peach }]}>{label}</Text></Pressable>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background }, content: { padding: 22, paddingBottom: 48, gap: 28, maxWidth: 700, width: '100%', alignSelf: 'center' },
  section: { gap: 12 }, title: { fontFamily: Fonts.display, fontSize: 30, color: Colors.ink },
  body: { fontFamily: Fonts.ui, fontSize: 14, lineHeight: 21, color: Colors.textSecondary }, note: { fontFamily: Fonts.ui, fontSize: 12, lineHeight: 18, color: Colors.textMuted },
  status: { fontFamily: Fonts.uiSemiBold, color: Colors.peach, fontSize: 13, paddingTop: 12 },
  action: { minHeight: 48, justifyContent: 'center', alignItems: 'center', padding: 14, borderRadius: 14, backgroundColor: Colors.peach },
  quiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.peachBorder }, actionText: { fontFamily: Fonts.uiSemiBold, color: Colors.inkDark, fontSize: 14, textAlign: 'center' },
  message: { fontFamily: Fonts.uiMedium, fontSize: 14, lineHeight: 22, color: Colors.peach, padding: 16, borderWidth: 1, borderColor: Colors.peachBorder, borderRadius: 14 },
});
