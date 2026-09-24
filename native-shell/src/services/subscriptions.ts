import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { PurchasesPackage } from 'react-native-purchases';
import { supabase } from './supabase';
import { edgeRequest } from './api';

export type SubscriptionPlan = 'city_pass' | 'city_all_access';
export type MobileAccess = {
  active: boolean;
  source: 'founder' | 'tester' | 'reviewer' | 'subscription';
  plan: SubscriptionPlan | null;
  expiresAt: string | null;
  routeLimit: number | null;
  routesUsed: number;
  store?: string;
};
export const isExpoGo = Constants.appOwnership === 'expo';
const apiKey = Platform.OS === 'ios' ? process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY : process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY;
export const purchasesAvailable = !isExpoGo && (Platform.OS === 'ios' || Platform.OS === 'android') && Boolean(apiKey);
let configured = false;
let queue: Promise<unknown> = Promise.resolve();

// Serialize identity changes and purchases. Never configure anonymous customers:
// the Supabase account ID is the same ID verified by our backend.
async function storeOperation<T>(operation: (sdk: typeof import('react-native-purchases').default) => Promise<T>, userId: string): Promise<T> {
  const next = queue.catch(() => {}).then(async () => {
    if (!purchasesAvailable) throw new Error(isExpoGo ? 'Expo Go previews this screen. Use a development build or TestFlight to test store purchases without real charges.' : 'Subscriptions are not configured for this build yet. Please contact support.');
    const { data } = await supabase.auth.getSession();
    if (data.session?.user.id !== userId) throw new Error('Your account changed. Please try again.');
    const sdk = (await import('react-native-purchases')).default;
    if (!configured) { sdk.configure({ apiKey: apiKey!, appUserID: userId }); configured = true; }
    else if (await sdk.getAppUserID() !== userId) await sdk.logIn(userId);
    return operation(sdk);
  });
  queue = next;
  return next;
}

export async function readMobileAccess(): Promise<MobileAccess> {
  const { data, error } = await supabase.rpc('my_mobile_access');
  if (error) throw new Error('Could not verify account access. Please retry.');
  if (!data || typeof data.active !== 'boolean') throw new Error('The access service returned an invalid response.');
  return data;
}
export const syncSubscription = () => edgeRequest<MobileAccess>('subscription-sync');

export async function loadSubscriptionPackages(userId: string): Promise<Partial<Record<SubscriptionPlan, PurchasesPackage>>> {
  return storeOperation(async sdk => {
    const offerings = await sdk.getOfferings();
    const packages = offerings.current?.availablePackages ?? [];
    return Object.fromEntries(packages.filter(p => ['city_pass', 'city_all_access'].includes(p.identifier) && p.product.subscriptionPeriod === 'P1M').map(p => [p.identifier, p]));
  }, userId);
}
export async function purchaseSubscription(userId: string, pkg: PurchasesPackage) {
  await storeOperation(sdk => sdk.purchasePackage(pkg), userId);
  await assertAccount(userId);
  return syncSubscription();
}
export async function restoreSubscriptions(userId: string) {
  await storeOperation(sdk => sdk.restorePurchases(), userId);
  await assertAccount(userId);
  return syncSubscription();
}
async function assertAccount(userId: string) {
  const { data } = await supabase.auth.getSession();
  if (data.session?.user.id !== userId) throw new Error('Your account changed during the purchase. Sign in to the purchasing account and restore purchases.');
}
