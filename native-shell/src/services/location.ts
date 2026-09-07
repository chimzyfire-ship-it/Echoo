import type { EchooLocation } from '@/src/models';

export type GtaMunicipality = {
  name: string;
  latitude: number;
  longitude: number;
  region: string;
};

const municipalitySeeds: Array<[string, number, number, string]> = [
  ['Toronto', 43.6532, -79.3832, 'Toronto'],
  ['Ajax', 43.8509, -79.0204, 'Durham'],
  ['Brock', 44.3045, -78.7276, 'Durham'],
  ['Clarington', 43.9353, -78.608, 'Durham'],
  ['Oshawa', 43.8971, -78.8658, 'Durham'],
  ['Pickering', 43.8384, -79.0868, 'Durham'],
  ['Scugog', 44.1116, -78.9445, 'Durham'],
  ['Uxbridge', 44.1086, -79.1224, 'Durham'],
  ['Whitby', 43.8975, -78.9429, 'Durham'],
  ['Aurora', 44.0065, -79.4504, 'York'],
  ['East Gwillimbury', 44.103, -79.447, 'York'],
  ['Georgina', 44.303, -79.366, 'York'],
  ['King', 43.997, -79.63, 'York'],
  ['Markham', 43.8561, -79.337, 'York'],
  ['Newmarket', 44.0592, -79.4613, 'York'],
  ['Richmond Hill', 43.8828, -79.4403, 'York'],
  ['Vaughan', 43.8563, -79.5085, 'York'],
  ['Whitchurch-Stouffville', 43.9708, -79.2444, 'York'],
  ['Brampton', 43.7315, -79.7624, 'Peel'],
  ['Caledon', 43.8769, -79.8654, 'Peel'],
  ['Mississauga', 43.589, -79.6441, 'Peel'],
  ['Burlington', 43.3255, -79.799, 'Halton'],
  ['Halton Hills', 43.63, -79.95, 'Halton'],
  ['Milton', 43.5183, -79.8774, 'Halton'],
  ['Oakville', 43.4675, -79.6877, 'Halton'],
];

export const GTA_MUNICIPALITIES: GtaMunicipality[] = municipalitySeeds.map(([name, latitude, longitude, region]) => ({
  name,
  latitude,
  longitude,
  region,
}));

export const DEFAULT_LOCATION: EchooLocation = {
  mode: 'manual',
  city: 'Toronto',
  label: 'Toronto',
};
