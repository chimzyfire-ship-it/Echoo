const OPENINGS = [
  'Let’s give that idea somewhere to go.',
  'A starting point, with room to change your mind.',
  'This could be a good way to spend a little time.',
  'Let’s keep the plan easy to make your own.',
  'Here’s one way to get out and see where it takes you.',
  'A few possibilities to get you going.',
];
export function voiceVariant(seed: string, count: number) {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % count;
}
export function routeNarration(plan: { stops: { name: string }[] }, seed: string, recent: string[] = [], candidate = '') {
  let index = voiceVariant(seed, OPENINGS.length);
  for (let i = 0; i < OPENINGS.length && recent.some((text) => text.includes(OPENINGS[index])); i++) index = (index + 1) % OPENINGS.length;
  const repetitive = /sounds (?:lovely|good|great)|flow that might|i hear you|it sounds like/i.test(candidate);
  const reused = recent.some((text) => text.toLowerCase().includes(candidate.toLowerCase()));
  const opening = candidate && !repetitive && !reused ? candidate : OPENINGS[index];
  const names = plan.stops.map((stop) => stop.name);
  const route = names.length === 1 ? `${names[0]} is a place to start.` : `Start at ${names[0]}, then ${names.slice(1).join(' and ')}.`;
  const endings = ['We can change any stop.', 'Keep what you like; we can adjust the rest.', 'Want to keep it as it is, or change something?'];
  return `${opening}\n\n${route} ${endings[voiceVariant(seed + ':ending', endings.length)]}`;
}
