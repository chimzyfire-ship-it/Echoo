const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(request) {
  const code = ts.transpileModule(readFileSync(require('node:path').join(__dirname, '../src/services/stays.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, URL, require: () => ({ edgeRequest: request }) });
  return exports;
}
const hotel = { id: 'hotel-id', name: 'Hotel & Spa', address: '10 King St, Toronto', imageUrl: 'https://example.com/photo', distanceMeters: 200, websiteUrl: 'https://hotel.example/reservations' };

test('hotel links use the official property website or an exact Maps place ID', () => {
  const { stayDestination, secureStayUrl } = load();
  assert.equal(stayDestination(hotel).url, hotel.websiteUrl);
  const fallback = new URL(stayDestination({ ...hotel, websiteUrl: 'javascript:alert(1)' }).url);
  assert.equal(fallback.hostname, 'www.google.com');
  assert.equal(fallback.searchParams.get('query_place_id'), hotel.id);
  assert.equal(fallback.searchParams.get('query'), 'Hotel & Spa 10 King St, Toronto');
  for (const bad of ['javascript:alert(1)', 'http://example.com', 'https://user:pass@example.com', null, 'not a url']) assert.equal(secureStayUrl(bad), null);
});

test('stays forward the venue coordinates and signal, deduplicate and sort without extra lookups', async () => {
  const calls = [];
  const signal = new AbortController().signal;
  const { getNearbyStays } = load(async (name, options) => {
    calls.push({ name, options });
    return { stays: [{ ...hotel, id: 'further', distanceMeters: 900 }, hotel, hotel, { ...hotel, id: 'outside', distanceMeters: 2700 }, { ...hotel, id: 'invalid', distanceMeters: NaN }] };
  });
  const result = await getNearbyStays({ latitude: 43.65, longitude: -79.38, destinationName: 'Venue' }, signal);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'live-stays');
  assert.equal(calls[0].options.body.latitude, 43.65);
  assert.equal(calls[0].options.body.radiusMeters, 2500);
  assert.equal(calls[0].options.signal, signal);
  assert.equal(result.stays.map((stay) => stay.id).join(','), 'hotel-id,further');
});

test('an empty search widens once to five kilometres and remains honestly empty', async () => {
  const radii = [];
  const { getNearbyStays } = load(async (_, { body }) => { radii.push(body.radiusMeters); return { stays: [] }; });
  const result = await getNearbyStays({ latitude: 43.65, longitude: -79.38, destinationName: 'Venue' });
  assert.deepEqual(radii, [2500, 5000]);
  assert.equal(result.stays.length, 0);
  assert.equal(result.radiusMeters, 5000);
});

test('invalid coordinates, broken responses, and provider errors do not trigger broader searches', async () => {
  let calls = 0;
  const { getNearbyStays } = load(async () => { calls++; throw new Error('Rate limited'); });
  await assert.rejects(getNearbyStays({ latitude: NaN, longitude: 0 }), /precise location/);
  assert.equal(calls, 0);
  await assert.rejects(getNearbyStays({ latitude: 43, longitude: -79 }), /Rate limited/);
  assert.equal(calls, 1);
  const broken = load(async () => ({}));
  await assert.rejects(broken.getNearbyStays({ latitude: 43, longitude: -79 }), /could not load/);
});
