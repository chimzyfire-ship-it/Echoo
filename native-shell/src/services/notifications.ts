import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { supabase } from '@/src/services/supabase';
import { defaultNotificationPreferences, invitationDates, INVITATIONS, type NotificationPreferences } from './notification-policy';

const PREFIX = 'echoo:notice:';
let queue: Promise<unknown> = Promise.resolve();
let generation = 0;
export async function notificationPreferences(userId: string): Promise<NotificationPreferences> {
  const { data, error } = await supabase.from('notification_preferences').select('linkup,plans,invitations').eq('user_id', userId).maybeSingle();
  if (error) throw new Error('Notification preferences could not load. Please try again.');
  return data || defaultNotificationPreferences;
}
export async function saveNotificationPreferences(patch: Partial<NotificationPreferences>) {
  const { error } = await supabase.rpc('set_notification_preferences', { p_patch: patch, p_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });
  if (error) throw new Error('Could not save notification preferences. Please try again.');
}
export async function markActive() { await supabase.rpc('notification_activity'); }
export async function readNotification(id: string) { await supabase.rpc('read_notification', { p_id: id }); }

// Serialize schedule/cancel calls so a late native schedule cannot survive a
// foreground transition or sign-out. Only cancel notifications owned by Echoo.
export function clearLocalReminders() {
  generation++;
  queue = queue.catch(() => {}).then(async () => {
    if (Platform.OS === 'web') return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.filter((item) => item.identifier.startsWith(PREFIX)).map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));
  });
  return queue;
}
export function scheduleInactivity(userId: string, prefs: NotificationPreferences, unfinishedPlan: boolean) {
  const current = ++generation;
  queue = queue.catch(() => {}).then(async () => {
    if (Platform.OS === 'web' || current !== generation) return;
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted && permission.ios?.status !== Notifications.IosAuthorizationStatus.PROVISIONAL) return;
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(scheduled.filter((item) => item.identifier.startsWith(PREFIX)).map((item) => Notifications.cancelScheduledNotificationAsync(item.identifier)));
    if (prefs.invitations) {
      for (const [index, date] of invitationDates().entries()) {
        if (current !== generation) return;
        await Notifications.scheduleNotificationAsync({
          identifier: `${PREFIX}${userId}:invite:${index}`,
          content: { ...INVITATIONS[index], data: { userId, path: '/(tabs)', kind: 'invitation' } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: 'planning' },
        });
      }
    }
    if (prefs.plans && unfinishedPlan && current === generation) {
      const date = new Date(Date.now() + 15 * 60000);
      // Never wake someone for an unfinished plan; don't resurrect it tomorrow.
      if (date.getHours() < 9 || date.getHours() >= 21) return;
      await Notifications.scheduleNotificationAsync({
        identifier: `${PREFIX}${userId}:plan`,
        content: { title: 'Shall we pick this up?', body: 'Come back to your conversation when you have a moment.', data: { userId, path: '/planner', kind: 'plan-reminder' } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date, channelId: 'planning' },
      });
    }
  });
  return queue;
}
