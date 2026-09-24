import React, { useState } from 'react';
import { Alert, Linking, Platform, ScrollView, StyleSheet, Text } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/src/providers/auth-provider';
import { useSubscription } from '@/src/providers/subscription-provider';
import { LegalLinks } from '@/src/components/legal-links';
import { PrimaryButton } from '@/src/components/primary-button';
import { edgeRequest } from '@/src/services/api';
import { Colors, Fonts } from '@/src/theme/tokens';

export default function AccountScreen() {
  const { user, signOut } = useAuth(), { access } = useSubscription();
  const router = useRouter(), insets = useSafeAreaInsets();
  const [busy, setBusy] = useState(false);
  const fail = (error: unknown) => Alert.alert('Could not complete action', error instanceof Error ? error.message : 'Please try again.');
  async function deleteAccount() {
    setBusy(true);
    try { await edgeRequest('mobile-account-delete'); await signOut(); router.replace('/'); }
    catch (error) { fail(error); }
    finally { setBusy(false); }
  }
  return <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }]} style={styles.root}>
    <Text style={styles.title}>Account & help</Text><Text style={styles.body}>{user?.email}</Text>
    <Text style={styles.body}>{access?.active ? access.source === 'founder' ? 'Permanent full access · No subscription required' : access.source === 'subscription' ? `${access.plan === 'city_all_access' ? 'City All-Access' : 'City Pass'} · ${access.routesUsed} of ${access.routeLimit} routes used this calendar month` : `Private ${access.source} access${access.expiresAt ? ` · Until ${new Date(access.expiresAt).toLocaleDateString()}` : ''}` : 'No active subscription'}</Text>
    <PrimaryButton label="Subscriptions & restore purchases" onPress={() => router.push('/subscription')} />
    <PrimaryButton label="Manage store subscription" variant="quiet" onPress={() => { void Linking.openURL(access?.store === 'play_store' || (!access?.store && Platform.OS === 'android') ? 'https://play.google.com/store/account/subscriptions' : 'https://apps.apple.com/account/subscriptions').catch(fail); }} />
    <LegalLinks support />
    <PrimaryButton label="Back" variant="quiet" onPress={() => router.canGoBack() ? router.back() : router.replace(access?.active ? '/(tabs)/profile' : '/subscription')} />
    <PrimaryButton label="Sign out" variant="quiet" disabled={busy} onPress={() => { void signOut().then(() => router.replace('/')).catch(fail); }} />
    <Text style={styles.body}>Deleting your account permanently removes your profile and linked app data. It does not cancel an Apple or Google subscription. Cancel in your store subscription settings to stop future renewals.</Text>
    <PrimaryButton label={busy ? 'Deleting account…' : 'Delete my account'} variant="quiet" disabled={busy} onPress={() => Alert.alert('Permanently delete your account?', 'This cannot be undone. Cancel any store subscription separately. Permanent founder/tester access is removed with your account.', [{ text: 'Keep account', style: 'cancel' }, { text: 'Delete account', style: 'destructive', onPress: () => { void deleteAccount(); } }])} />
  </ScrollView>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: Colors.background }, content: { padding: 24, gap: 20 }, title: { fontFamily: Fonts.uiSemiBold, color: Colors.ink, fontSize: 30 }, body: { fontFamily: Fonts.ui, fontSize: 15, color: Colors.textSecondary, lineHeight: 23 } });
