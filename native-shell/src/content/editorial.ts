// Editorial language only. Venue facts, prices, hours and safety notices never rotate.
// A screen picks once on mount; typing, refetching and returning from settings keep it stable.
export const PLANNING_WELCOMES = [
  { title: 'A little more', accent: 'your kind of day.', body: 'A craving, a free afternoon, a reason to get out. Give me a starting point and we’ll take it from there.' },
  { title: 'Leave a little room', accent: 'for a good detour.', body: 'Start with the thing you feel like doing. We can find the next stop together.' },
  { title: 'Nothing planned?', accent: 'That’s a start.', body: 'Coffee with no rush? Dinner with someone you like? Tell me what sounds good.' },
  { title: 'A change of scene.', accent: 'At your pace.', body: 'You bring the mood. I’ll help find a few places to turn it into a plan.' },
  { title: 'A small plan.', accent: 'A day that’s yours.', body: 'One good stop can be enough. We can keep it simple or see where the idea takes us.' },
] as const;
export const STAY_TITLES = ['Make a night of it.', 'No need to rush home.', 'A little longer, perhaps.', 'Room for another day.'] as const;
export const HOME_INVITATIONS = ['What would make today yours?', 'A familiar favourite, or a new direction?', 'Start with a craving. See where it goes.', 'A little time out there can go a long way.'] as const;
export const PLAN_INVITATIONS = ['A good meal, a small detour, a plan that fits.', 'Start with one idea. We’ll find the next stop.', 'Somewhere to go. Something to look forward to.', 'A little less searching. A little more going.'] as const;
const last = new Map<string, number>();
export function nextEditorial<const T extends readonly [unknown, ...unknown[]]>(key: string, values: T): T[number] {
  const previous = last.get(key);
  const index = previous === undefined ? Math.floor(Math.random() * values.length) : (previous + 1) % values.length;
  last.set(key, index);
  return values[index];
}
