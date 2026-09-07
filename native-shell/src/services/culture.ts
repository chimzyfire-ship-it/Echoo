import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DiscoveryIntent } from '@/src/models';

// Native port of assets/culture-context.js. Country labels come from
// Intl.DisplayNames where Hermes provides it, with the same overrides the web
// ships; unknown locales fall back to the ISO code.
const COUNTRY_CODES =
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'.split(
    ' ',
  );

const NAME_OVERRIDES: Record<string, string> = {
  US: 'United States',
  CA: 'Canada',
  GB: 'United Kingdom',
  CD: 'Democratic Republic of the Congo',
  CG: 'Republic of the Congo',
  CI: 'Côte d\u2019Ivoire',
  KR: 'South Korea',
  KP: 'North Korea',
  LA: 'Laos',
  MM: 'Myanmar',
  PS: 'Palestine',
  RU: 'Russia',
  SY: 'Syria',
  TW: 'Taiwan',
  TZ: 'Tanzania',
  VA: 'Vatican City',
  VE: 'Venezuela',
  VN: 'Vietnam',
  XK: 'Kosovo',
};

const SEARCH_ALIASES: Record<string, string[]> = {
  CA: ['Canadian'],
  US: ['America', 'American', 'USA', 'US', 'United States of America'],
  GB: ['Britain', 'British', 'UK', 'Great Britain'],
  CI: ['Ivory Coast'],
  CZ: ['Czech Republic'],
  KR: ['Korea'],
  MM: ['Burma'],
  NL: ['Holland'],
  PS: ['Palestinian'],
  RU: ['Russian Federation'],
  SZ: ['Swaziland'],
  TL: ['East Timor'],
  TR: ['Turkey', 'Türkiye'],
};

const displayNames = (() => {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' });
  } catch {
    return null;
  }
})();

export type CultureCountry = {
  code: string;
  slug: string;
  label: string;
  aliases: string[];
};

export const COUNTRIES: CultureCountry[] = COUNTRY_CODES.map((code) => {
  const label = NAME_OVERRIDES[code] || displayNames?.of(code) || code;
  return {
    code,
    slug: code.toLowerCase(),
    label,
    aliases: [...new Set(SEARCH_ALIASES[code] ?? [])],
  };
}).sort((a, b) => a.label.localeCompare(b.label));

export function countryFor(value: string): CultureCountry | null {
  const key = value.trim().toLowerCase();
  if (!key) return null;
  return (
    COUNTRIES.find(
      (country) =>
        country.slug === key ||
        country.code.toLowerCase() === key ||
        country.label.toLowerCase() === key ||
        country.aliases.some((alias) => alias.toLowerCase() === key),
    ) ?? null
  );
}

// Mirrors EchooCultureContext.queryFor: with a lens active the provider query
// becomes "<Country> culture <topics>" and preference slugs are dropped so the
// culture signal stays unambiguous.
export function cultureQueryFor(
  base: string,
  country: CultureCountry | null,
): string {
  const query = base.trim().toLowerCase() || 'discover';
  const topics: Record<string, string> = {
    discover: 'restaurants food music events markets community spots',
    trending: 'restaurants food music events markets community spots',
    events: 'events festivals performances community gatherings',
    'upcoming drop': 'upcoming events pop-ups festivals performances',
    food: 'restaurants bakeries cafes markets tastings',
    music: 'live music concerts DJs record stores performances',
    nightlife: 'nightlife bars lounges late music events',
    tourism: 'museums galleries landmarks tours cultural attractions',
    nature: 'parks walks outdoor community activities',
  };
  const topic = topics[query] ?? query;
  if (!country) {
    return query === 'trending' || query === 'discover' ? 'popular places things to do' : topic;
  }
  return `${country.label} culture ${topic}`;
}

export function cultureQueryForIntent(
  intent: DiscoveryIntent,
  search: string,
  country: CultureCountry | null,
): string {
  const base = search || intent;
  return cultureQueryFor(base, country);
}

const STORAGE_KEY = 'echoo_culture_lens_v1';

export async function readStoredCulture(): Promise<CultureCountry | null> {
  try {
    const raw = JSON.parse((await AsyncStorage.getItem(STORAGE_KEY)) || '{}');
    const slug = String(raw?.active || raw?.current || raw?.selected?.[0] || '')
      .trim()
      .toLowerCase();
    return countryFor(slug);
  } catch {
    return null;
  }
}

export async function writeStoredCulture(country: CultureCountry | null) {
  try {
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 5,
        active: country?.slug ?? '',
        selected: country ? [country.slug] : [],
        current: country?.slug ?? '',
        updatedAt: new Date().toISOString(),
      }),
    );
  } catch {
    // Storage is best-effort; the lens still works in-memory for this session.
  }
}
