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
      return { ok: true, json: async () => ({ all: { items: [], pagination: { nextCursor: 'next', hasMore: true } } }) };
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
