export type DiscoveryFeature = {
  slug: string;
  label: string;
  synonyms: string[];
};

export function cleanDiscoveryText(value: unknown, max = 180) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function optionalDiscoveryNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function clampDiscoveryLimit(value: unknown, fallback = 20, max = 50) {
  const parsed = optionalDiscoveryNumber(value);
  if (parsed === undefined) return fallback;
  return Math.max(1, Math.min(Math.round(parsed), max));
}

export function matchedFeatureSlugs(
  query: string,
  features: DiscoveryFeature[],
) {
  const text = ` ${query.toLowerCase().replace(/[^a-z0-9+]+/g, " ")} `;
  return features
    .filter((feature) =>
      [feature.slug.replace(/_/g, " "), feature.label, ...feature.synonyms]
        .map((term) => term.toLowerCase().trim())
        .filter(Boolean)
        .some((term) => text.includes(` ${term} `)),
    )
    .map((feature) => feature.slug)
    .slice(0, 8);
}

export function encodeDiscoveryCursor(score: unknown, id: unknown) {
  const parsed = Number(score);
  const entityId = cleanDiscoveryText(id, 64);
  if (!Number.isFinite(parsed) || !entityId) return null;
  return btoa(JSON.stringify({ score: parsed, id: entityId }));
}

export function decodeDiscoveryCursor(value: unknown) {
  const cursor = cleanDiscoveryText(value, 512);
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(atob(cursor));
    const score = Number(parsed?.score);
    const id = cleanDiscoveryText(parsed?.id, 64);
    return Number.isFinite(score) && id ? { score, id } : null;
  } catch (_error) {
    return null;
  }
}
