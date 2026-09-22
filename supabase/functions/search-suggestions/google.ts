import { providerFailure } from '../_shared/provider-status.ts';

export async function googleSuggestions(input: { query: string; city: { lat: number; lng: number; coverageLevel?: string }; apiKey?: string }) {
  if (!input.apiKey) return { suggestions: [], status: 'not_configured' };
  try {
    const response = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': input.apiKey,
        'X-Goog-FieldMask': 'suggestions.placePrediction.placeId,suggestions.placePrediction.text.text,suggestions.placePrediction.structuredFormat' },
      body: JSON.stringify({
        input: input.query,
        includedRegionCodes: ['ca'],
        languageCode: 'en',
        regionCode: 'ca',
        locationRestriction: { circle: { center: { latitude: input.city.lat, longitude: input.city.lng }, radius: input.city.coverageLevel === 'municipality' ? 25000 : 50000 } },
      }),
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) return { suggestions: [], status: await providerFailure(response) };
    const body = await response.json();
    const suggestions = (Array.isArray(body.suggestions) ? body.suggestions : []).flatMap((item: any) => {
      const place = item?.placePrediction;
      if (!place?.placeId || typeof place.text?.text !== 'string') return [];
      return [{ type: 'place', value: place.text.text, label: place.structuredFormat?.mainText?.text || place.text.text,
        subtitle: place.structuredFormat?.secondaryText?.text || '', entityId: `google:${place.placeId}`, source: 'google_places' }];
    }).slice(0, 5);
    return { suggestions, status: 'available' };
  } catch {
    return { suggestions: [], status: 'unavailable' };
  }
}
