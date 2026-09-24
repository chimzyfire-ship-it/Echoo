import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check } from 'lucide-react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { LegalLinks } from '@/src/components/legal-links';
import { useAuth } from '@/src/providers/auth-provider';
import { useSubscription } from '@/src/providers/subscription-provider';
import { isExpoGo, loadSubscriptionPackages, purchaseSubscription, purchasesAvailable, restoreSubscriptions, syncSubscription, type SubscriptionPlan } from '@/src/services/subscriptions';
import { Fonts } from '@/src/theme/tokens';

const plans = [
  { id: 'city_pass' as const, title: 'City Pass', subtitle: 'Essential Subscription', preview: '$9', features: ['City events, dining & nightlife discovery', 'Cinema discovery & date-night planning', '10 AI Flow routes per calendar month', '100 concierge messages per calendar month', 'Link Up discovery'] },
  { id: 'city_all_access' as const, title: 'City All-Access', subtitle: 'Premium Subscription', preview: '$18', features: ['Everything in City Pass', '50 AI Flow routes per calendar month', '500 concierge messages per calendar month', 'More room to explore, plan & refine'] },
];

export default function SubscriptionScreen() {
  const router = useRouter(), insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { access, refresh } = useSubscription();
  const [packages, setPackages] = useState<Partial<Record<SubscriptionPlan, PurchasesPackage>>>({});
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState<string | null>(null), [message, setMessage] = useState('');
  const locked = useRef(false), currentUser = useRef(user?.id); currentUser.current = user?.id;
  const store = Platform.OS === 'android' ? 'Google Play' : 'App Store';
  async function load() {
    if (!user || !purchasesAvailable) return;
    const id = user.id;
    setLoading(true); setMessage('');
    try {
      const result = await loadSubscriptionPackages(id);
      if (currentUser.current !== id) return;
      setPackages(result);
      if (!result.city_pass || !result.city_all_access) setMessage('Some subscriptions are currently unavailable. Please retry or contact support.');
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not load subscriptions.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { setPackages({}); void load(); }, [user?.id]);

  async function run(action: 'restore' | 'refresh' | SubscriptionPlan) {
    if (!user || locked.current) return;
    const id = user.id;
    locked.current = true; setBusy(action); setMessage('');
    try {
      if (action === 'refresh') {
        if (purchasesAvailable && access?.source === 'subscription') await syncSubscription();
      } else if (action === 'restore') await restoreSubscriptions(id);
      else {
        if (access?.active) { Alert.alert('You already have access', 'Manage your existing subscription in store settings. Your account does not need another subscription.'); return; }
        if (!purchasesAvailable) throw new Error(isExpoGo ? 'This is the real paywall preview in Expo Go. Store purchases require a development build or TestFlight. Your account stays locked until a subscription or private tester access is verified.' : 'Store subscriptions are not available in this build yet. Please contact support.');
        const pkg = packages[action];
        if (!pkg) throw new Error('This subscription is unavailable. Please retry loading the store prices.');
        await purchaseSubscription(id, pkg);
      }
      if (currentUser.current !== id) return;
      const verified = await refresh();
      if (verified?.active) router.replace('/(tabs)');
      else setMessage(action === 'restore' ? 'No active subscription was found for this account. Check the Apple/Google account used for your purchase, or contact support.' : 'Access is not active yet. If you just purchased, wait a moment and tap Check access again. Pending purchases unlock only after store approval.');
    } catch (error) {
      if ((error as { userCancelled?: boolean })?.userCancelled) return;
      setMessage(error instanceof Error ? error.message : 'Could not complete that action. Please try again.');
    } finally { locked.current = false; setBusy(null); }
  }

  return <View style={styles.root}><ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24 }]}>
    <View style={styles.top}><Pressable accessibilityRole="button" disabled={!!busy} onPress={() => { void run('restore'); }} style={styles.link}><Text style={styles.restore}>Restore Purchases</Text></Pressable></View>
    <View style={styles.brand} accessibilityRole="image" accessibilityLabel="Echoocity">
      <Image source={require('@/assets/echoo-brand-symbol.png')} style={styles.symbol} resizeMode="contain" />
      <Text adjustsFontSizeToFit numberOfLines={1} style={styles.wordmark}>echoocity</Text>
    </View>
    <Text style={styles.intro}>{access?.active ? (access.source === 'founder' ? 'Your account has permanent full access. No subscription required.' : 'Your account already has full app access.') : 'A subscription is required to use Echoocity.'}</Text>
    {access?.active ? <Pressable accessibilityRole="button" onPress={() => router.replace('/(tabs)')} style={styles.continue}><Text style={styles.darkButton}>Continue to Echoocity</Text></Pressable> : null}
    {plans.map(plan => {
      const premium = plan.id === 'city_all_access', pkg = packages[plan.id];
      const price = pkg?.product.priceString ?? (isExpoGo ? plan.preview : '—');
      return <View key={plan.id} style={[styles.card, premium && styles.premium]}>
        {premium ? <View style={styles.badge}><Text style={styles.badgeText}>MORE EXPLORING</Text></View> : null}
        <LinearGradient colors={premium ? ['#302418', '#17120e'] : ['#292a28', '#161716']} style={styles.cardInner}>
          <View style={styles.planHeading}><Text style={styles.planTitle}>{plan.title}</Text><Text style={styles.price}>{price}<Text style={styles.period}> / month</Text></Text></View>
          <Text style={[styles.subtitle, premium && { color: '#f5d3af' }]}>{plan.subtitle}</Text>
          <View style={styles.features}>{plan.features.map(feature => <View key={feature} style={styles.feature}><View style={[styles.check, premium && { backgroundColor: '#f5cd9b' }]}><Check size={13} color="#24231f" strokeWidth={3} /></View><Text style={styles.featureText}>{feature}</Text></View>)}</View>
          <Pressable accessibilityRole="button" accessibilityLabel={`Subscribe to ${plan.title}${pkg ? ` for ${price} per month` : ''}`} disabled={!!busy || loading || !!access?.active || (purchasesAvailable && !pkg)} onPress={() => { void run(plan.id); }} style={({ pressed }) => [{ opacity: pressed || busy || loading || access?.active ? 0.6 : 1 }]}>
            <LinearGradient colors={premium ? ['#ffdbaf', '#f5c58f'] : ['#40413e', '#282927']} style={[styles.button, !premium && styles.secondaryButton]}><Text style={premium ? styles.darkButton : styles.lightButton}>{busy === plan.id ? 'Confirming…' : access?.active ? 'Access already included' : pkg || isExpoGo ? `Subscribe for ${price}/mo` : 'Store price unavailable'}</Text></LinearGradient>
          </Pressable>
        </LinearGradient>
      </View>;
    })}
    {loading || busy ? <ActivityIndicator color="#f7d5b2" accessibilityLabel="Checking subscription" /> : null}
    {message ? <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text> : null}
    {isExpoGo ? <Text style={styles.notice}>Expo Go preview · Illustrative prices. Actual local prices come from the store in a native build. Purchases cannot be completed in Expo Go.</Text> : null}
    {!isExpoGo && !purchasesAvailable ? <Text style={styles.notice}>Store purchases are not configured in this build yet.</Text> : null}
    {purchasesAvailable ? <Pressable accessibilityRole="button" disabled={loading || !!busy} onPress={() => { void load(); }} style={styles.link}><Text style={styles.footerLink}>Reload store prices</Text></Pressable> : null}
    <Text style={styles.footer}>Auto-renewable monthly subscription. Payment is charged to your store account at confirmation. Renews unless cancelled at least 24 hours before the current period ends. Manage or cancel in {store} settings.</Text>
    <Text style={styles.notice}>Route generation and edits use your route allowance. Allowances reset on the first of each calendar month (UTC); unused allowances do not roll over. Tickets and bookings are sold separately.</Text>
    <LegalLinks />
    <View style={styles.bottom}><Pressable accessibilityRole="button" disabled={!!busy} style={styles.link} onPress={() => { void run('refresh'); }}><Text style={styles.footerLink}>Check access again</Text></Pressable><Pressable accessibilityRole="button" style={styles.link} onPress={() => router.push('/account')}><Text style={styles.footerLink}>Account & help</Text></Pressable></View>
  </ScrollView></View>;
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#030403' }, content: { paddingHorizontal: 24, alignSelf: 'center', width: '100%', maxWidth: 600, gap: 24 },
  top: { alignItems: 'flex-end' }, link: { minHeight: 44, justifyContent: 'center' }, restore: { color: '#aaa9a3', fontFamily: Fonts.ui, fontSize: 15, textDecorationLine: 'underline' },
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginVertical: 4 }, symbol: { width: 85, height: 88 }, wordmark: { color: '#f8f5ef', fontFamily: Fonts.ui, fontSize: 52, flexShrink: 1, letterSpacing: -2 },
  intro: { color: '#b0aea5', fontFamily: Fonts.ui, fontSize: 17, textAlign: 'center', lineHeight: 24 },
  card: { borderRadius: 25, borderWidth: 1, borderColor: '#42443f', marginTop: 4 }, premium: { borderWidth: 2, borderColor: '#efc99e', marginTop: 12, boxShadow: '0 0 28px rgba(247, 194, 133, 0.20)' },
  cardInner: { borderRadius: 23, padding: 20, paddingTop: 24 }, badge: { position: 'absolute', top: -15, alignSelf: 'center', zIndex: 1, backgroundColor: '#f7d3a9', paddingHorizontal: 16, paddingVertical: 5, borderRadius: 30 }, badgeText: { color: '#352419', fontFamily: Fonts.uiSemiBold, fontSize: 12, letterSpacing: 0.5 },
  planHeading: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }, planTitle: { color: '#f8f5ef', fontFamily: Fonts.uiSemiBold, fontSize: 28, letterSpacing: -0.7 }, price: { color: '#f8f5ef', fontFamily: Fonts.uiSemiBold, fontSize: 28 }, period: { color: '#bbb8ad', fontSize: 15, fontFamily: Fonts.ui },
  subtitle: { color: '#c1c0b8', fontFamily: Fonts.ui, fontSize: 15, marginTop: 5 }, features: { gap: 10, marginVertical: 22 }, feature: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, check: { width: 19, height: 19, borderRadius: 10, backgroundColor: '#e3e1d9', justifyContent: 'center', alignItems: 'center', marginTop: 2 }, featureText: { flex: 1, color: '#e9e6dd', fontFamily: Fonts.ui, fontSize: 15, lineHeight: 22 },
  button: { minHeight: 54, padding: 12, borderRadius: 30, justifyContent: 'center', alignItems: 'center' }, secondaryButton: { borderWidth: 1, borderColor: '#595a54' }, darkButton: { color: '#18120a', fontFamily: Fonts.uiSemiBold, fontSize: 18, textAlign: 'center' }, lightButton: { color: '#f8f5ef', fontFamily: Fonts.uiSemiBold, fontSize: 18, textAlign: 'center' }, continue: { backgroundColor: '#f7d5b2', padding: 16, borderRadius: 30 },
  footer: { color: '#aaa89f', fontFamily: Fonts.ui, fontSize: 13, lineHeight: 19, textAlign: 'center' }, notice: { color: '#96968d', fontFamily: Fonts.ui, fontSize: 12, lineHeight: 18, textAlign: 'center' }, message: { color: '#f5d3af', fontFamily: Fonts.ui, fontSize: 14, lineHeight: 21, textAlign: 'center' }, footerLink: { color: '#e4c5a6', fontFamily: Fonts.ui, fontSize: 13, textDecorationLine: 'underline' }, bottom: { flexDirection: 'row', justifyContent: 'center', gap: 24, flexWrap: 'wrap' },
});
