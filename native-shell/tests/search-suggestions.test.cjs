const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadGoogle(fetch) {
  function load(file) {
    const exports = {};
    const js = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(js, { exports, fetch, AbortSignal, require: (name) => load(path.resolve(path.dirname(file), name)) });
    return exports;
  }
  return load(path.resolve(__dirname, '../../supabase/functions/search-suggestions/google.ts')).googleSuggestions;
}

test('autocomplete uses the selected city, Canadian restriction and returns selectable full addresses', async () => {
  for (const city of [{ lat: 43.6532, lng: -79.3832 }, { lat: 43.589, lng: -79.6441 }]) {
    const lookup = loadGoogle(async (url, options) => {
      assert.equal(url, 'https://places.googleapis.com/v1/places:autocomplete');
      const body = JSON.parse(options.body);
      assert.deepEqual(body.locationRestriction.circle.center, { latitude: city.lat, longitude: city.lng });
      assert.deepEqual(body.includedRegionCodes, ['ca']);
      assert.equal(body.locationRestriction.circle.radius, 25000);
      assert.equal(body.input, 'bal');
      assert.ok(options.signal);
      return new Response(JSON.stringify({ suggestions: [{ placePrediction: { placeId: 'test', text: { text: 'Balzac’s, 1 Test St, Toronto, ON' }, structuredFormat: { mainText: { text: 'Balzac’s' }, secondaryText: { text: '1 Test St, Toronto, ON' } } } }, { queryPrediction: {} }] }));
    });
    const result = await lookup({ query: 'bal', city: { ...city, coverageLevel: 'municipality' }, apiKey: 'fixture' });
    assert.equal(result.status, 'available');
    assert.equal(result.suggestions.length, 1);
    assert.equal(result.suggestions[0].entityId, 'google:test');
    assert.equal(result.suggestions[0].value, 'Balzac’s, 1 Test St, Toronto, ON');
    assert.equal(result.suggestions[0].source, 'google_places');
  }
});

test('no key makes no paid request; provider failures leave local fallback usable without leaking errors', async () => {
  const city = { lat: 43.65, lng: -79.38 };
  const unconfigured = loadGoogle(() => { throw new Error('must not fetch'); });
  assert.equal((await unconfigured({ query: 'coffee', city })).status, 'not_configured');
  const denied = loadGoogle(async () => new Response(JSON.stringify({ error: { message: 'private project data', details: [{ reason: 'SERVICE_DISABLED' }] } }), { status: 403 }));
  const result = await denied({ query: 'coffee', city, apiKey: 'fixture' });
  assert.equal(result.status, 'api_disabled');
  assert.equal(result.suggestions.length, 0);
  assert.ok(!JSON.stringify(result).includes('private'));
  const timeout = loadGoogle(async () => { throw new Error('timeout'); });
  assert.equal((await timeout({ query: 'coffee', city, apiKey: 'fixture' })).status, 'unavailable');
});

test('an empty successful response stays distinct from unavailable predictions', async () => {
  const lookup = loadGoogle(async () => new Response(JSON.stringify({ suggestions: [] })));
  const result = await lookup({ query: 'unknown', city: { lat: 43, lng: -79 }, apiKey: 'fixture' });
  assert.equal(result.status, 'available');
  assert.equal(result.suggestions.length, 0);
});
