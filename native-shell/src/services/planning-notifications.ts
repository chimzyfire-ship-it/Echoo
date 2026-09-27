import type { Session } from '@supabase/supabase-js';
import { runRequest, assertRequestActive } from './request';
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { echooConfig, supabase } from "@/src/services/supabase";
import { notificationPath } from './notification-policy';
import { clearLocalReminders } from './notifications';

const TOKEN_KEY = "echoo:planning-push-token:v1";
const CLEANUP_KEY = "echoo:push-cleanup:v1";
type Cleanup = { userId: string; token: string };
let generation = 0;
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(operation: () => Promise<T>) {
  const next = queue.catch(() => {}).then(operation);
  queue = next;
  return next;
}
async function pendingCleanup(): Promise<Cleanup[]> {
  try {
    const value: unknown = JSON.parse(await AsyncStorage.getItem(CLEANUP_KEY) || '[]');
    return Array.isArray(value) ? value.filter((row): row is Cleanup => typeof row?.userId === 'string' && typeof row?.token === 'string').slice(-10) : [];
  } catch { return []; }
}
async function pushRequest(action: 'register_planning_device' | 'unregister_planning_device', token: string, session: Session) {
  await runRequest(async signal => {
    const response = await fetch(`${echooConfig.supabaseUrl}/rest/v1/rpc/${action}`, {
      method: 'POST', signal,
      headers: { apikey: echooConfig.supabaseAnonKey, Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_token: token }),
    });
    await response.text();
    assertRequestActive(signal);
    if (!response.ok) throw new Error('Notification settings could not sync yet.');
  }, { timeoutMs: 3000 });
}
async function flushCleanup(session: Session) {
  const pending = await pendingCleanup();
  const remaining = [];
  for (const row of pending) {
    if (row.userId !== session.user.id) { remaining.push(row); continue; }
    try { await pushRequest('unregister_planning_device', row.token, session); }
    catch { remaining.push(row); }
  }
  await AsyncStorage.setItem(CLEANUP_KEY, JSON.stringify(remaining));
}
// Retry only with the owning account. Never persist credentials for cleanup.
export function retryPushCleanup(session: Session) {
  return serial(() => flushCleanup(session));
}
export function planningNotificationPath(value: unknown): string | null {
  return notificationPath(value);
}
export async function enablePlanningNotifications(requestPermission = true) {
  const request = generation;
  const { data } = await runRequest(() => supabase.auth.getSession());
  const session = data.session;
  if (!session) return;
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (
    !Device.isDevice ||
    Platform.OS === "web" ||
    !projectId ||
    Constants.appOwnership === "expo"
  )
    throw new Error(
      "Push notifications need the installed Echoo app. They aren’t available in Expo Go.",
    );
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("planning", {
      name: "Planning reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  let permission = await Notifications.getPermissionsAsync();
  if (requestPermission && permission.status !== "granted")
    permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Notifications are off. You can enable them in your device settings.",
    );
  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  await serial(async () => {
    if (request !== generation) return;
    const { data: current } = await runRequest(() => supabase.auth.getSession());
    if (current.session?.user.id !== session.user.id || request !== generation) return;
    await flushCleanup(session);
    if (request !== generation) return;
    await pushRequest('register_planning_device', token, session);
    await AsyncStorage.setItem(TOKEN_KEY, token);
    // Registration makes this token belong to the current account again.
    // A deferred cleanup must not revoke a deliberately re-enabled token.
    const pending = await pendingCleanup();
    await AsyncStorage.setItem(CLEANUP_KEY, JSON.stringify(pending.filter(row => row.token !== token)));
  });
}
export async function disablePlanningNotifications(session: Session | null) {
  generation++;
  const local = runRequest(async () => {
    await clearLocalReminders();
    if (Platform.OS !== 'web') await Notifications.dismissAllNotificationsAsync();
  }, { timeoutMs: 3000 }).catch(() => {});
  const remote = serial(async () => {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token && session) {
      const pending = await pendingCleanup();
      if (!pending.some(row => row.token === token && row.userId === session.user.id)) {
        pending.push({ token, userId: session.user.id });
        await AsyncStorage.setItem(CLEANUP_KEY, JSON.stringify(pending));
      }
      // Keep the owner/token cleanup record if offline; no credential is saved.
      await AsyncStorage.removeItem(TOKEN_KEY);
      await flushCleanup(session);
    }
  });
  await Promise.all([local, remote]);
}
