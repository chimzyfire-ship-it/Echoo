export type NotificationPreferences = { linkup: boolean; plans: boolean; invitations: boolean };
export const defaultNotificationPreferences: NotificationPreferences = { linkup: false, plans: false, invitations: false };
export const INVITATIONS = [
  { title: 'Going somewhere?', body: 'A favourite spot or a new direction. Find your next plan in Echoo.' },
  { title: 'A little change of scene?', body: 'Coffee, dinner, a small detour. Start with whatever sounds good.' },
  { title: 'What are you in the mood for?', body: 'When you feel like heading out, Echoo is here.' },
] as const;
export function notificationPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (['/(tabs)', '/(tabs)/link-up', '/planner', '/weekend'].includes(value)) return value;
  return /^\/place\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}
// Only three invitations after inactivity; returning to the app resets the series.
// Local calendar arithmetic preserves daytime delivery across daylight-saving changes.
export function invitationDates(now = new Date()) {
  return [2, 4, 6].map((days) => {
    const date = new Date(now);
    date.setDate(date.getDate() + days);
    date.setHours(17, 0, 0, 0);
    if (date.getTime() - now.getTime() < days * 86400000) date.setDate(date.getDate() + 1);
    return date;
  });
}
