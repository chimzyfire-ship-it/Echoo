import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DiscoveryIntent } from '@/src/models';

export function flagEmoji(code: string): string {
  const upper = code.toUpperCase();
  if (upper.length !== 2) return '🌐';
  const first = upper.charCodeAt(0) - 65 + 0x1f1e6;
  const second = upper.charCodeAt(1) - 65 + 0x1f1e6;
  if (first < 0x1f1e6 || first > 0x1f1ff || second < 0x1f1e6 || second > 0x1f1ff) return '🌐';
  return String.fromCodePoint(first, second);
}

const COUNTRY_NAMES: Record<string, string> = {
  AD: 'Andorra',
  AE: 'United Arab Emirates',
  AF: 'Afghanistan',
  AG: 'Antigua & Barbuda',
  AI: 'Anguilla',
  AL: 'Albania',
  AM: 'Armenia',
  AO: 'Angola',
  AQ: 'Antarctica',
  AR: 'Argentina',
  AS: 'American Samoa',
  AT: 'Austria',
  AU: 'Australia',
  AW: 'Aruba',
  AX: 'Åland Islands',
  AZ: 'Azerbaijan',
  BA: 'Bosnia & Herzegovina',
  BB: 'Barbados',
  BD: 'Bangladesh',
  BE: 'Belgium',
  BF: 'Burkina Faso',
  BG: 'Bulgaria',
  BH: 'Bahrain',
  BI: 'Burundi',
  BJ: 'Benin',
  BL: 'Saint Barthélemy',
  BM: 'Bermuda',
  BN: 'Brunei',
  BO: 'Bolivia',
  BQ: 'Caribbean Netherlands',
  BR: 'Brazil',
  BS: 'Bahamas',
  BT: 'Bhutan',
  BV: 'Bouvet Island',
  BW: 'Botswana',
  BY: 'Belarus',
  BZ: 'Belize',
  CA: 'Canada',
  CC: 'Cocos (Keeling) Islands',
  CD: 'Democratic Republic of the Congo',
  CF: 'Central African Republic',
  CG: 'Republic of the Congo',
  CH: 'Switzerland',
  CI: 'Côte d’Ivoire',
  CK: 'Cook Islands',
  CL: 'Chile',
  CM: 'Cameroon',
  CN: 'China',
  CO: 'Colombia',
  CR: 'Costa Rica',
  CU: 'Cuba',
  CV: 'Cape Verde',
  CW: 'Curaçao',
  CX: 'Christmas Island',
  CY: 'Cyprus',
  CZ: 'Czech Republic',
  DE: 'Germany',
  DJ: 'Djibouti',
  DK: 'Denmark',
  DM: 'Dominica',
  DO: 'Dominican Republic',
  DZ: 'Algeria',
  EC: 'Ecuador',
  EE: 'Estonia',
  EG: 'Egypt',
  EH: 'Western Sahara',
  ER: 'Eritrea',
  ES: 'Spain',
  ET: 'Ethiopia',
  FI: 'Finland',
  FJ: 'Fiji',
  FK: 'Falkland Islands',
  FM: 'Micronesia',
  FO: 'Faroe Islands',
  FR: 'France',
  GA: 'Gabon',
  GB: 'United Kingdom',
  GD: 'Grenada',
  GE: 'Georgia',
  GF: 'French Guiana',
  GG: 'Guernsey',
  GH: 'Ghana',
  GI: 'Gibraltar',
  GL: 'Greenland',
  GM: 'Gambia',
  GN: 'Guinea',
  GP: 'Guadeloupe',
  GQ: 'Equatorial Guinea',
  GR: 'Greece',
  GS: 'South Georgia',
  GT: 'Guatemala',
  GU: 'Guam',
  GW: 'Guinea-Bissau',
  GY: 'Guyana',
  HK: 'Hong Kong',
  HM: 'Heard & McDonald Islands',
  HN: 'Honduras',
  HR: 'Croatia',
  HT: 'Haiti',
  HU: 'Hungary',
  ID: 'Indonesia',
  IE: 'Ireland',
  IL: 'Israel',
  IM: 'Isle of Man',
  IN: 'India',
  IO: 'British Indian Ocean Territory',
  IQ: 'Iraq',
  IR: 'Iran',
  IS: 'Iceland',
  IT: 'Italy',
  JE: 'Jersey',
  JM: 'Jamaica',
  JO: 'Jordan',
  JP: 'Japan',
  KE: 'Kenya',
  KG: 'Kyrgyzstan',
  KH: 'Cambodia',
  KI: 'Kiribati',
  KM: 'Comoros',
  KN: 'Saint Kitts & Nevis',
  KP: 'North Korea',
  KR: 'South Korea',
  KW: 'Kuwait',
  KY: 'Cayman Islands',
  KZ: 'Kazakhstan',
  LA: 'Laos',
  LB: 'Lebanon',
  LC: 'Saint Lucia',
  LI: 'Liechtenstein',
  LK: 'Sri Lanka',
  LR: 'Liberia',
  LS: 'Lesotho',
  LT: 'Lithuania',
  LU: 'Luxembourg',
  LV: 'Latvia',
  LY: 'Libya',
  MA: 'Morocco',
  MC: 'Monaco',
  MD: 'Moldova',
  ME: 'Montenegro',
  MF: 'Saint Martin',
  MG: 'Madagascar',
  MH: 'Marshall Islands',
  MK: 'North Macedonia',
  ML: 'Mali',
  MM: 'Myanmar',
  MN: 'Mongolia',
  MO: 'Macau',
  MP: 'Northern Mariana Islands',
  MQ: 'Martinique',
  MR: 'Mauritania',
  MS: 'Montserrat',
  MT: 'Malta',
  MU: 'Mauritius',
  MV: 'Maldives',
  MW: 'Malawi',
  MX: 'Mexico',
  MY: 'Malaysia',
  MZ: 'Mozambique',
  NA: 'Namibia',
  NC: 'New Caledonia',
  NE: 'Niger',
  NF: 'Norfolk Island',
  NG: 'Nigeria',
  NI: 'Nicaragua',
  NL: 'Netherlands',
  NO: 'Norway',
  NP: 'Nepal',
  NR: 'Nauru',
  NU: 'Niue',
  NZ: 'New Zealand',
  OM: 'Oman',
  PA: 'Panama',
  PE: 'Peru',
  PF: 'French Polynesia',
  PG: 'Papua New Guinea',
  PH: 'Philippines',
  PK: 'Pakistan',
  PL: 'Poland',
  PM: 'Saint Pierre & Miquelon',
  PN: 'Pitcairn Islands',
  PR: 'Puerto Rico',
  PS: 'Palestine',
  PT: 'Portugal',
  PW: 'Palau',
  PY: 'Paraguay',
  QA: 'Qatar',
  RE: 'Réunion',
  RO: 'Romania',
  RS: 'Serbia',
  RU: 'Russia',
  RW: 'Rwanda',
  SA: 'Saudi Arabia',
  SB: 'Solomon Islands',
  SC: 'Seychelles',
  SD: 'Sudan',
  SE: 'Sweden',
  SG: 'Singapore',
  SH: 'Saint Helena',
  SI: 'Slovenia',
  SJ: 'Svalbard & Jan Mayen',
  SK: 'Slovakia',
  SL: 'Sierra Leone',
  SM: 'San Marino',
  SN: 'Senegal',
  SO: 'Somalia',
  SR: 'Suriname',
  SS: 'South Sudan',
  ST: 'São Tomé & Príncipe',
  SV: 'El Salvador',
  SX: 'Sint Maarten',
  SY: 'Syria',
  SZ: 'Eswatini',
  TC: 'Turks & Caicos Islands',
  TD: 'Chad',
  TF: 'French Southern Territories',
  TG: 'Togo',
  TH: 'Thailand',
  TJ: 'Tajikistan',
  TK: 'Tokelau',
  TL: 'Timor-Leste',
  TM: 'Turkmenistan',
  TN: 'Tunisia',
  TO: 'Tonga',
  TR: 'Turkey',
  TT: 'Trinidad & Tobago',
  TV: 'Tuvalu',
  TW: 'Taiwan',
  TZ: 'Tanzania',
  UA: 'Ukraine',
  UG: 'Uganda',
  UM: 'U.S. Outlying Islands',
  US: 'United States',
  UY: 'Uruguay',
  UZ: 'Uzbekistan',
  VA: 'Vatican City',
  VC: 'Saint Vincent & the Grenadines',
  VE: 'Venezuela',
  VG: 'British Virgin Islands',
  VI: 'U.S. Virgin Islands',
  VN: 'Vietnam',
  VU: 'Vanuatu',
  WF: 'Wallis & Futuna',
  WS: 'Samoa',
  XK: 'Kosovo',
  YE: 'Yemen',
  YT: 'Mayotte',
  ZA: 'South Africa',
  ZM: 'Zambia',
  ZW: 'Zimbabwe',
};

const SEARCH_ALIASES: Record<string, string[]> = {
  CA: ['Canadian', 'Canada'],
  US: ['America', 'American', 'USA', 'United States of America'],
  GB: ['Britain', 'British', 'UK', 'Great Britain', 'England', 'Scotland', 'Wales'],
  NG: ['Nigerian', 'Naija'],
  GH: ['Ghanaian'],
  JM: ['Jamaican', 'Caribbean'],
  TT: ['Trinidadian', 'Tobagonian', 'Trini', 'Caribbean'],
  HT: ['Haitian', 'Caribbean'],
  BB: ['Barbadian', 'Bajan', 'Caribbean'],
  CI: ['Ivory Coast', 'Ivorian'],
  CD: ['Congo DR', 'DR Congo', 'Kinshasa'],
  CG: ['Congo Brazzaville'],
  CZ: ['Czechia'],
  DE: ['German'],
  FR: ['French'],
  IT: ['Italian'],
  ES: ['Spanish'],
  PT: ['Portuguese'],
  GR: ['Greek'],
  IE: ['Irish'],
  IN: ['Indian', 'Desi', 'Bharat'],
  PK: ['Pakistani', 'Desi'],
  BD: ['Bangladeshi', 'Desi'],
  CN: ['Chinese'],
  JP: ['Japanese'],
  KR: ['Korean', 'South Korea'],
  KP: ['North Korea'],
  VN: ['Vietnamese'],
  PH: ['Filipino', 'Pinoy'],
  MX: ['Mexican'],
  BR: ['Brazilian'],
  CO: ['Colombian'],
  ET: ['Ethiopian'],
  ER: ['Eritrean'],
  SO: ['Somali'],
  KE: ['Kenyan'],
  ZA: ['South African'],
  EG: ['Egyptian'],
  MA: ['Moroccan'],
  LB: ['Lebanese'],
  IR: ['Iranian', 'Persian', 'Persia'],
  TR: ['Turkish', 'Türkiye'],
  UA: ['Ukrainian'],
  PL: ['Polish'],
  NL: ['Dutch', 'Holland'],
  SZ: ['Swaziland'],
  TL: ['East Timor'],
  MM: ['Burma', 'Burmese'],
  PS: ['Palestinian'],
  RU: ['Russian'],
  AE: ['Emirates', 'Emirati', 'Dubai', 'Abu Dhabi'],
  SA: ['Saudi', 'Saudi Arabian'],
};

export type CultureCountry = {
  code: string;
  slug: string;
  label: string;
  flag: string;
  aliases: string[];
};

export const COUNTRIES: CultureCountry[] = Object.entries(COUNTRY_NAMES).map(([code, label]) => {
  return {
    code,
    slug: code.toLowerCase(),
    label,
    flag: flagEmoji(code),
    aliases: [...new Set([label, ...(SEARCH_ALIASES[code] ?? [])])],
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
    food: 'restaurants dining bistros supper clubs food',
    cocktails: 'craft cocktail bars speakeasies cocktail lounges rooftop bars mixology',
    music: 'live music concerts jazz clubs DJs listening bars performances',
    nightlife: 'nightlife clubs bars lounges late dancing DJ venues',
    comedy: 'comedy clubs stand up comedy improv comedy shows',
    sports: 'sports bars sports lounges game day watch parties arcade bars social gaming',
    art: 'art galleries immersive art exhibitions museum late nights creative exhibits',
    'late-night': 'late night restaurants after hours dining 24 hour food late bites',
    cafes: 'specialty coffee cafes matcha studios artisan bakeries espresso bars',
    markets: 'night markets artisan markets flea markets pop-ups food truck festivals',
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
