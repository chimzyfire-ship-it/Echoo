import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(new URL('../native-shell/package.json', import.meta.url));
const ts = require('typescript');
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Exercise the actual TS modules offline, using the app's existing compiler.
function load(path, imports = {}, globals = {}) {
  const exports = {};
  const { outputText } = ts.transpileModule(read(path), {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  });
  vm.runInNewContext(outputText, {
    exports,
    require: (name) => {
      assert.ok(name in imports, `Unexpected import: ${name}`);
      return imports[name];
    },
    ...globals,
  }, { filename: path });
  return exports;
}

const native = load('native-shell/src/services/location.ts');
const backend = load('supabase/functions/_shared/location.ts', {
  'https://esm.sh/@supabase/supabase-js@2': {},
});
const names = (items) => Array.from(items, (item) => item.name);

// Official sources and scope are documented in native-shell/ONTARIO-LOCATIONS.md.
const expected = {
  Toronto: ['Toronto'],
  Durham: ['Ajax', 'Brock', 'Clarington', 'Oshawa', 'Pickering', 'Scugog', 'Uxbridge', 'Whitby'],
  York: ['Aurora', 'East Gwillimbury', 'Georgina', 'King', 'Markham', 'Newmarket', 'Richmond Hill', 'Vaughan', 'Whitchurch-Stouffville'],
  Peel: ['Brampton', 'Caledon', 'Mississauga'],
  Halton: ['Burlington', 'Halton Hills', 'Milton', 'Oakville'],
};

test('exactly 25 unique municipalities, correctly grouped and backend-supported', () => {
  assert.equal(native.GTA_MUNICIPALITIES.length, 25);
  assert.equal(new Set(names(native.GTA_MUNICIPALITIES)).size, 25);
  assert.deepEqual(names(native.GTA_MUNICIPALITIES).sort(), names(backend.GTA_MUNICIPALITIES).sort());
  for (const group of native.GTA_MUNICIPALITY_GROUPS) {
    assert.deepEqual(names(group.municipalities), expected[group.region]);
  }
  for (const municipality of native.GTA_MUNICIPALITIES) {
    assert.equal(backend.normalizeCityName(municipality.name)?.name, municipality.name);
    assert.ok(Number.isFinite(municipality.latitude) && Number.isFinite(municipality.longitude));
  }
  const sql = read('supabase/migrations/202607270001_gta_location_context_and_nationalities.sql');
  const constraint = sql.match(/municipality in \(([\s\S]*?)\)/)[1];
  const boundaryNames = [...constraint.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(boundaryNames.sort(), names(native.GTA_MUNICIPALITIES).sort());
});

test('search handles regions, partial names, whitespace and hyphens without adding cities', () => {
  assert.equal(native.searchGtaMunicipalities('  ').length, 25);
  for (const [region, municipalities] of Object.entries(expected)) {
    assert.deepEqual(names(native.searchGtaMunicipalities(region === 'Toronto' ? region : `${region} Region`)), municipalities);
  }
  for (const query of ['stouff', ' WHITCHURCH   STOUFFVILLE ', 'Whitchurch-Stouffville']) {
    assert.deepEqual(names(native.searchGtaMunicipalities(query)), ['Whitchurch-Stouffville']);
  }
  assert.deepEqual(names(native.searchGtaMunicipalities('york richmond')), ['Richmond Hill']);
  for (const query of ['Concord', 'Woodbridge', 'not a municipality']) {
    assert.equal(native.searchGtaMunicipalities(query).length, 0);
    assert.equal(native.manualMunicipalityLocation(query), null);
  }
  assert.equal(native.manualMunicipalityLocation('  vAuGhAn  ').city, 'Vaughan');
  assert.deepEqual(Object.keys(native.manualMunicipalityLocation('Toronto')).sort(), ['city', 'label', 'mode']);
});

test('Discover keeps manual scopes coordinate-free and preserves Culture/query in both modes', async () => {
  let body;
  const api = load('native-shell/src/services/api.ts', {
    '@/src/services/location': native,
    '@/src/services/supabase': {
      echooConfig: { supabaseUrl: 'https://example.invalid', supabaseAnonKey: 'test' },
      supabase: { auth: { getSession: async () => ({ data: {} }) } },
    },
  }, {
    URL,
    fetch: async (_url, options) => {
      body = JSON.parse(options.body);
      return { ok: true, json: async () => ({ location: { mode: 'municipality' }, all: {}, nearby: {}, recommended: {} }) };
    },
  });
  for (const mode of ['manual', 'gps']) {
    const feed = await api.getDiscovery({
      intent: 'search', query: 'Korean cafes', cultureSlug: 'korean',
      location: { mode, city: 'Vaughan', label: 'Vaughan', latitude: 43.85, longitude: -79.5 },
    });
    assert.equal(body.city, 'Vaughan');
    assert.equal(body.query, 'Korean cafes');
    assert.equal(body.cultureSlug, 'korean');
    assert.equal(body.lat, mode === 'gps' ? 43.85 : undefined);
    assert.equal(body.lng, mode === 'gps' ? -79.5 : undefined);
    assert.equal(body.radiusMeters, mode === 'gps' ? 100000 : undefined);
    assert.equal(feed.location.mode, mode);
  }
});

test('region headings cannot become requests; city switches use fresh coordinate-free scopes', async () => {
  const bodies = [];
  let payload = { supported: false, reason: 'unsupported_city' };
  const api = load('native-shell/src/services/api.ts', {
    '@/src/services/location': native,
    '@/src/services/supabase': {
      echooConfig: { supabaseUrl: 'https://example.invalid', supabaseAnonKey: 'test' },
      supabase: { auth: { getSession: async () => ({ data: {} }) } },
    },
  }, { URL, fetch: async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => payload };
  } });
  for (const heading of ['Other Ontario cities', 'Durham', 'GTA', 'Ontario']) {
    assert.equal(native.manualMunicipalityLocation(heading), null);
    await assert.rejects(api.getDiscovery({ intent: 'discover', query: '', location: { mode: 'manual', city: heading } }), /not a region heading/);
  }
  assert.equal(bodies.length, 0);
  assert.equal(native.searchMunicipalities('Other Ontario cities').length, 11);
  for (const city of ['Ottawa', 'London', 'Toronto']) {
    const location = native.manualMunicipalityLocation(city);
    const feed = await api.getDiscovery({ intent: 'discover', query: '', location });
    assert.equal(bodies.at(-1).city, city);
    assert.equal(bodies.at(-1).lat, undefined);
    assert.equal(bodies.at(-1).lng, undefined);
    assert.equal(bodies.at(-1).cursor, undefined);
    assert.equal(feed.supported, false);
    assert.match(native.unsupportedLocationMessage(location, feed.reason), /service does not currently support/);
  }
  payload = { supported: true, all: { items: [] }, nearby: {}, recommended: {} };
  const input = { intent: 'discover', query: '', location: native.manualMunicipalityLocation('Ottawa') };
  const empty = await api.getDiscovery(input);
  assert.equal(empty.supported, true);
  assert.equal(empty.all.items.length, 0);
  payload = { results: [] };
  await assert.rejects(api.getDiscovery(input), /incompatible response/);
});

test('manual selection wins over late GPS success or failure; valid GPS still works', async () => {
  const state = [];
  let nextState = 0;
  let finish;
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    createElement: (_type, props) => props.value,
    useState: (initial) => {
      const index = nextState++;
      state[index] = initial;
      return [initial, (value) => { state[index] = value; }];
    },
    useRef: (current) => ({ current }),
  };
  const provider = load('native-shell/src/providers/location-provider.tsx', {
    react: { ...react, default: react },
    'expo-location': {
      getForegroundPermissionsAsync: async () => ({ granted: true }),
      getCurrentPositionAsync: async () => ({ coords: { latitude: 43.85, longitude: -79.5 } }),
      Accuracy: { Balanced: 3 },
    },
    '@/src/services/location': native,
    '@/src/services/api': { resolveLocationContext: () => new Promise((resolve, reject) => { finish = { resolve, reject }; }) },
  });
  const context = provider.LocationProvider({ children: null });
  for (const fail of [false, true]) {
    const pending = context.useDeviceLocation();
    await new Promise((resolve) => setImmediate(resolve));
    context.chooseMunicipality('Whitby');
    if (fail) finish.reject(new Error('stale GPS error'));
    else finish.resolve({ supported: true, municipality: 'Vaughan' });
    assert.equal(await pending, false);
    assert.equal(state[0].city, 'Whitby');
    assert.equal(state[0].mode, 'manual');
    assert.equal(state[1], false);
    assert.equal(state[2], null);
  }
  const pending = context.useDeviceLocation();
  await new Promise((resolve) => setImmediate(resolve));
  finish.resolve({ supported: true, municipality: null });
  assert.equal(await pending, true);
  assert.equal(state[0].mode, 'gps');
  assert.equal(state[0].city, 'Ontario');
  context.chooseMunicipality('Montreal');
  assert.equal(state[0].mode, 'gps');
  assert.ok(state[2]);
  assert.equal(context.chooseMunicipality('Ottawa'), true);
  assert.deepEqual(Object.keys(state[0]).sort(), ['city', 'label', 'mode']);
  assert.equal(state[0].city, 'Ottawa');
  assert.equal(context.chooseMunicipality('Other Ontario cities'), false);
  assert.equal(state[0].city, 'Ottawa');
});

test('picker renders headings without actions and city rows select then close', () => {
  let chosen;
  let closed = 0;
  const react = {
    useState: () => ['', () => {}],
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
  };
  const picker = load('native-shell/src/components/location-picker.tsx', {
    react,
    'react-native': {
      ...Object.fromEntries(['ActivityIndicator', 'Modal', 'Pressable', 'ScrollView', 'Text', 'TextInput', 'View'].map((name) => [name, name])),
      StyleSheet: { create: (styles) => styles, hairlineWidth: 1 },
    },
    'lucide-react-native': { Crosshair: 'Crosshair', X: 'X' },
    '@/src/services/location': native,
    '@/src/theme/tokens': { Colors: {}, Fonts: {}, Spacing: {} },
    '@/src/providers/location-provider': { useEchooLocation: () => ({
      location: native.manualMunicipalityLocation('Ottawa'),
      chooseMunicipality: (city) => { chosen = city; return Boolean(native.manualMunicipalityLocation(city)); },
      useDeviceLocation: async () => false,
    }) },
  }, { React: react });
  const tree = picker.LocationPicker({ visible: true, onClose: () => { closed++; } });
  const nodes = [];
  const walk = (node) => { if (!node || typeof node !== 'object') return; nodes.push(node); node.children.forEach(walk); };
  walk(tree);
  const heading = nodes.find((node) => node.children.includes('Other Ontario cities'));
  assert.equal(heading.type, 'Text');
  assert.equal(heading.props.accessibilityRole, 'header');
  assert.equal(heading.props.onPress, undefined);
  const rows = nodes.filter((node) => node.type === 'Pressable' && node.props.accessibilityState?.selected !== undefined);
  assert.equal(rows.length, 36);
  const ottawa = rows.find((row) => row.children.some((child) => child?.children?.includes('Ottawa')));
  assert.equal(ottawa.props.accessibilityState.selected, true);
  ottawa.props.onPress();
  assert.equal(chosen, 'Ottawa');
  assert.equal(closed, 1);
});

test('curated Ontario choices are unique, canonical and accepted by the backend', () => {
  assert.equal(native.SELECTABLE_MUNICIPALITIES.length, 36);
  assert.equal(new Set(names(native.SELECTABLE_MUNICIPALITIES)).size, 36);
  assert.deepEqual(names(native.SELECTABLE_MUNICIPALITIES).sort(), names(backend.ONTARIO_MUNICIPALITIES).sort());
  for (const name of ['Ottawa', 'London', 'Hamilton', 'Windsor', 'Kingston', 'Thunder Bay']) {
    assert.equal(native.manualMunicipalityLocation(` ${name.toUpperCase()} `).city, name);
    assert.equal(backend.normalizeCityName(name).name, name);
    assert.deepEqual(names(native.searchMunicipalities(name)), [name]);
  }
  assert.equal(native.searchGtaMunicipalities('Hamilton').length, 0);
  assert.equal(native.searchMunicipalities('GTA').length, 25);
  assert.equal(native.searchMunicipalities('Ontario').length, 36);
  assert.equal(backend.normalizeCityName(' whitchurch   stouffville ').name, 'Whitchurch-Stouffville');
  for (const name of ['Montreal', 'Detroit', 'Vancouver', 'Gatineau']) {
    assert.equal(backend.normalizeCityName(name), null);
    assert.equal(native.manualMunicipalityLocation(name), null);
  }
});

test('GPS checks the province, not just a rectangle, and fails closed without verification', async () => {
  let components = [];
  let key = 'test';
  const location = load('supabase/functions/_shared/location.ts', {
    'https://esm.sh/@supabase/supabase-js@2': {},
  }, {
    Deno: { env: { get: () => key } },
    AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ status: 'OK', results: [{ address_components: components }] }) }),
  });
  const db = { rpc: async () => ({ data: [], error: null }) };
  const address = (country, province, city) => [
    { types: ['country'], short_name: country },
    { types: ['administrative_area_level_1'], short_name: province },
    { types: ['locality'], long_name: city },
  ];
  for (const city of native.ONTARIO_CITIES) {
    components = address('CA', 'ON', city.name);
    assert.equal((await location.resolveOntarioGps(db, city.latitude, city.longitude)).municipality, city.name);
  }
  for (const [lat, lng, country, province, city] of [
    [45.4765, -75.7013, 'CA', 'QC', 'Gatineau'],
    [42.3314, -83.0458, 'US', 'MI', 'Detroit'],
    [43.0962, -79.0377, 'US', 'NY', 'Niagara Falls'],
  ]) {
    components = address(country, province, city);
    assert.equal(await location.resolveOntarioGps(db, lat, lng), null);
  }
  assert.equal(await location.resolveOntarioGps(db, 49.2827, -123.1207), null);
  assert.equal(await location.resolveOntarioGps(db, NaN, -79), null);
  key = undefined;
  await assert.rejects(location.resolveOntarioGps(db, 45.4215, -75.6972), /verification is unavailable/);
  assert.equal((await location.resolveOntarioGps({ rpc: async () => ({ data: [{ municipality: 'Toronto' }] }) }, 43.6532, -79.3832)).municipality, 'Toronto');
});

test('location-context and Explore V2 accept Ontario choices and return honest empty lanes', async () => {
  const calls = [];
  const db = {
    from: () => ({ select: () => ({ eq: async () => ({ data: [], error: null }) }) }),
    rpc: async (name, input) => { calls.push({ name, input }); return { data: [], error: null }; },
  };
  let verifiedGps = { municipality: 'Ottawa', regionalMunicipality: null };
  const shared = {
    ...backend,
    getSupabaseAdmin: () => db,
    jsonResponse: (value, status = 200) => new Response(JSON.stringify(value), { status }),
    resolveOntarioGps: async () => verifiedGps,
    sha256Hex: async () => 'test',
    readLocationCache: async () => null,
    writeLocationCache: async () => {},
  };
  const hybrid = load('supabase/functions/_shared/hybrid-discovery.ts');
  const handlers = {};
  for (const name of ['location-context', 'explore-search']) {
    load(`supabase/functions/${name}/index.ts`, {
      '../_shared/location.ts': shared,
      '../_shared/hybrid-discovery.ts': hybrid,
      '../_shared/planning-intent.ts': load('supabase/functions/_shared/planning-intent.ts'),
      '../_shared/provider-status.ts': load('supabase/functions/_shared/provider-status.ts'),
    }, { URL, Response, console, Deno: { env: { get: () => undefined }, serve: (handler) => { handlers[name] = handler; } } });
  }
  const request = (body) => new Request('https://example.invalid', { method: 'POST', body: JSON.stringify(body) });
  for (const { name } of native.SELECTABLE_MUNICIPALITIES) {
    const context = await (await handlers['location-context'](request({ city: name }))).json();
    assert.equal(context.supported, true);
    assert.equal(context.municipality, name);
    const result = await (await handlers['explore-search'](request({ version: 2, city: name, cultureSlug: 'korean', includeLiveFallback: false }))).json();
    assert.equal(result.supported, true);
    assert.equal(result.location.city, name);
    assert.equal(result.all.items.length, 0);
    assert.equal(result.nearby.items.length, 0);
    assert.equal(calls.at(-1).input.p_city, name);
    assert.equal(calls.at(-1).input.p_culture_slug, 'korean');
    assert.equal(calls.at(-1).input.p_lat, null);
  }
  const gps = await (await handlers['explore-search'](request({ version: 2, lat: 45.4215, lng: -75.6972, city: 'Toronto', includeLiveFallback: false }))).json();
  assert.equal(gps.location.city, 'Ottawa');
  assert.equal(calls.at(-1).input.p_lat, 45.4215);
  assert.equal(calls.at(-1).input.p_city, null);
  verifiedGps = null;
  for (const handler of Object.values(handlers)) {
    assert.equal((await handler(request({ version: 2, lat: 'invalid', lng: 'invalid' }))).status, 422);
    assert.equal((await (await handler(request({ version: 2, lat: 42.3314, lng: -83.0458 }))).json()).supported, false);
    assert.equal((await (await handler(request({ version: 2, city: 'Montreal' }))).json()).supported, false);
  }
});
