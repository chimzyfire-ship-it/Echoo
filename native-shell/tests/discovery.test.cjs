const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(relativePath, modules, globals = {}) {
  const filename = path.join(__dirname, relativePath);
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => modules[name] ?? {}, ...globals });
  return exports;
}

test('discovery API forwards cursor and filters and maps lane pagination', async () => {
  let body;
  const { getDiscovery } = load('../src/services/api.ts', {
    '@/src/services/supabase': {
      echooConfig: { supabaseUrl: 'https://example.invalid', supabaseAnonKey: 'test' },
      supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
    },
  }, {
    URL,
    fetch: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ all: { items: [], pagination: { nextCursor: 'next', hasMore: true } }, nearby: { items: [], pagination: { nextCursor: null, hasMore: false } }, recommended: { items: [], pagination: { nextCursor: null, hasMore: false } } }) };
    },
  });
  const feed = await getDiscovery({ intent: 'cafes', query: 'coffee', cultureSlug: 'culture', cursor: 'current', location: { city: 'Toronto', label: 'Toronto', mode: 'gps', latitude: 43, longitude: -79 } });
  assert.equal(body.cursor, 'current');
  assert.equal(body.intent, 'cafes');
  assert.equal(body.query, 'coffee');
  assert.equal(body.cultureSlug, 'culture');
  assert.equal(body.city, 'Toronto');
  assert.equal(body.lat, 43);
  assert.equal(body.lng, -79);
  assert.equal(feed.all.nextCursor, 'next');
  assert.equal(feed.all.hasMore, true);
});

test('Discover forwards page cursors and stops on exhausted or repeated cursors', async () => {
  let options, request;
  const stop = new Error('capture query options');
  const screen = load('../app/(tabs)/discover.tsx', {
    react: { useState: (value) => [value, () => {}], useDeferredValue: (value) => value, useEffect: () => {} },
    'expo-router': { useRouter: () => ({}), useLocalSearchParams: () => ({}) },
    'react-native': { StyleSheet: { create: (value) => value } },
    '@tanstack/react-query': { useInfiniteQuery: (value) => { options = value; throw stop; } },
    '@/src/providers/location-provider': { useEchooLocation: () => ({ location: { city: 'Toronto' } }) },
    '@/src/providers/culture-provider': { useCulture: () => ({ active: { slug: 'culture' } }) },
    '@/src/services/discover-categories': load('../src/services/discover-categories.ts', {}),
    '@/src/services/culture': { cultureQueryForIntent: () => 'culture query' },
    '@/src/services/api': { getDiscovery: async (value) => { request = value; } },
    '@/src/theme/tokens': { Colors: {}, Fonts: {}, Spacing: {} },
  });
  assert.throws(() => screen.default(), (error) => error === stop);
  await options.queryFn({ pageParam: 'cursor', signal: undefined });
  assert.equal(request.cursor, 'cursor');
  assert.equal(request.cultureSlug, 'culture');
  assert.equal(request.query, 'culture query');
  assert.equal(options.getNextPageParam({ all: { hasMore: true, nextCursor: 'next' } }, [], undefined, [undefined]), 'next');
  assert.equal(options.getNextPageParam({ all: { hasMore: true, nextCursor: 'next' } }, [], 'next', [undefined, 'next']), undefined);
  assert.equal(options.getNextPageParam({ all: { hasMore: false, nextCursor: null } }, [], undefined, [undefined]), undefined);
});

test('activity pills use specific search requests and typed searches take priority', () => {
  const { DISCOVER_CATEGORIES, discoveryCategoryRequest } = load('../src/services/discover-categories.ts', {});
  const activities = DISCOVER_CATEGORIES.filter((category) => category.query);
  assert.equal(activities.length, 14);
  assert.equal(new Set(DISCOVER_CATEGORIES.map((category) => category.key)).size, DISCOVER_CATEGORIES.length);
  for (const category of activities) {
    const request = discoveryCategoryRequest(category.key);
    assert.equal(request.intent, 'search');
    assert.equal(request.query, category.query);
    assert.equal(discoveryCategoryRequest(category.key, '  sushi  ').query, 'sushi');
  }
  assert.equal(discoveryCategoryRequest('food').intent, 'food');
  assert.equal(discoveryCategoryRequest('unknown').intent, 'discover');
});

test('activity matching rejects unrelated cards and accepts provider category evidence', () => {
  const { DISCOVER_CATEGORIES, matchesDiscoveryCategory } = load('../src/services/discover-categories.ts', {});
  const card = { title: 'Local spot', category: 'restaurant', description: 'Dinner downtown', features: [] };
  for (const category of DISCOVER_CATEGORIES.filter((item) => item.query)) {
    assert.equal(matchesDiscoveryCategory(card, category.key), false, category.key);
    assert.equal(matchesDiscoveryCategory({ ...card, category: category.query.replaceAll(' ', '_') }, category.key), true, category.key);
  }
  assert.equal(matchesDiscoveryCategory({ ...card, title: 'Boulder House' }, 'climbing'), true);
  assert.equal(matchesDiscoveryCategory({ ...card, features: ['ice_skating'] }, 'skating'), true);
});


test('activity matching does not confuse similar words with activities', () => {
  const { matchesDiscoveryCategory } = load('../src/services/discover-categories.ts', {});
  const card = { title: 'Local spot', category: 'restaurant', description: '', features: [] };
  assert.equal(matchesDiscoveryCategory({ ...card, title: 'Spacious dining' }, 'wellness'), false);
  assert.equal(matchesDiscoveryCategory({ ...card, title: 'Skin care' }, 'skiing'), false);
  assert.equal(matchesDiscoveryCategory({ ...card, title: 'Parking garage' }, 'parks'), false);
});
