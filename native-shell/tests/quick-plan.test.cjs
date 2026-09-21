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

const planner = load('../../supabase/functions/quick-plan/planner.ts');

// Monday 2026-06-15, 19:30 in America/Toronto (EDT, UTC-4).
const NOW = new Date('2026-06-15T23:30:00Z');
const TZ = 'America/Toronto';

const makePlace = (overrides = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'A Place',
  category: 'park',
  city: 'Toronto',
  address: '1 Street',
  latitude: 43.65,
  longitude: -79.38,
  timezone: TZ,
  ...overrides,
});

const makeCandidate = (overrides = {}) => ({ ...makePlace(overrides), distanceMeters: 500 });

test('stop count clamps to 1-3 and defaults to 3', () => {
  assert.equal(planner.clampStopCount(1), 1);
  assert.equal(planner.clampStopCount(2), 2);
  assert.equal(planner.clampStopCount(3), 3);
  assert.equal(planner.clampStopCount(undefined), 3);
  assert.equal(planner.clampStopCount(5), 3);
  assert.equal(planner.clampStopCount('2'), 3);
});

test('buildPlan keeps the anchor exactly once with unique real stops', () => {
  const anchor = makeCandidate({ id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Anchor Hall', category: 'gallery' });
  const stop = makeCandidate({ id: 'bbbbbbbb-2222-4222-9222-222222222222', name: 'Side Park', category: 'park', latitude: 43.66, longitude: -79.39 });
  const plan = planner.buildPlan({
    anchor,
    selected: [anchor, stop],
    hoursByPlace: new Map(),
    timezone: TZ,
    startAt: NOW,
    requestedBudget: 'balanced',
    requestedStopCount: 2,
  });
  assert.equal(plan.stopCount, 2);
  assert.equal(plan.stops.filter((s) => s.id === anchor.id).length, 1);
  assert.equal(new Set(plan.stops.map((s) => s.id)).size, 2);
  assert.ok(plan.stops.every((s) => s.name && Number.isFinite(s.latitude) && Number.isFinite(s.longitude)));
});

test('invariants reject a lost anchor, duplicates, empty stops, and capacity overflow', () => {
  const anchorId = 'aaaaaaaa-1111-4111-8111-111111111111';
  const base = {
    title: 't', subtitle: 's', stopCount: 1, requestedStopCount: 1,
    budgetStyle: 'balanced', anchorId, anchorName: 'Anchor',
    totalTravelMinutes: 0, availabilityNote: '', budgetEstimate: null, stops: [],
  };
  const stop = { id: anchorId, name: 'X', category: 'c', address: '', latitude: 1, longitude: 2, imageUrl: '', time: '7:00 p.m.', travelMinutes: 0, reason: '', priceLabel: '', priceBand: null, costEstimate: null, availability: 'unverified', isAnchor: true };
  assert.throws(() => planner.enforcePlanInvariants({ ...base, stops: [] }), /between 1 and 3/);
  assert.throws(() => planner.enforcePlanInvariants({ ...base, anchorId: 'missing', stops: [stop] }), /anchor/);
  assert.throws(() => planner.enforcePlanInvariants({ ...base, stopCount: 2, stops: [stop, stop] }), /duplicate/);
  assert.throws(
    () => planner.enforcePlanInvariants({ ...base, stops: [{ ...stop, name: '' }] }),
    /name or location/
  );
  assert.throws(() => planner.enforcePlanInvariants({ ...base, stopCount: 4, stops: [stop, stop, stop, stop] }), /between 1 and 3/);
});

test('ordering respects known hours even when that moves the anchor off position 1', () => {
  // Monday 19:30 Toronto. The culture stop closes at 20:45; the anchor is
  // open until 23:00. Visiting the anchor first arrives after close.
  const anchor = makeCandidate({ id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Late Kitchen', category: 'restaurant', latitude: 43.651, longitude: -79.381 });
  const culture = makeCandidate({ id: 'bbbbbbbb-2222-4222-9222-222222222222', name: 'Closing Gallery', category: 'gallery', latitude: 43.652, longitude: -79.382 });
  const hours = new Map([
    [culture.id, [{ place_id: culture.id, day_of_week: 1, opens_at: '10:00', closes_at: '20:45' }]],
    [anchor.id, [{ place_id: anchor.id, day_of_week: 1, opens_at: '11:00', closes_at: '23:00' }]],
  ]);
  const arrangement = planner.orderStops([anchor, culture], hours, TZ, NOW);
  assert.equal(arrangement.hourViolations, 0);
  assert.equal(arrangement.order[0].id, culture.id);
  assert.equal(arrangement.order[1].id, anchor.id);
});

test('ordering prefers an activity-first arc when hours are unknown', () => {
  const food = makeCandidate({ id: 'cccccccc-3333-4333-8333-333333333333', name: 'Food', category: 'restaurant' });
  const culture = makeCandidate({ id: 'dddddddd-4444-4444-9444-444444444444', name: 'Museum', category: 'museum' });
  const arrangement = planner.orderStops([food, culture], new Map(), TZ, NOW);
  assert.equal(arrangement.order[0].category, 'museum');
  assert.equal(arrangement.order[1].category, 'restaurant');
});

test('capacity 1 returns the anchor alone even with rich inventory', () => {
  const anchor = makeCandidate({ id: 'aaaaaaaa-1111-4111-8111-111111111111', category: 'gallery' });
  const candidates = [1, 2, 3].map((n) => makeCandidate({ id: `bbbbbbbb-000${n}-4222-9222-00000000000${n}`, category: 'park', latitude: 43.65 + n * 0.01 }));
  const selected = planner.selectStops({
    anchor, candidates, stopCount: 1, requestedBudget: 'balanced',
    recentPlaceIds: new Set(), rotationKey: 'k', profile: {},
  });
  assert.deepEqual([...selected.map((s) => s.id)], [anchor.id]);
});

test('capacity degrades gracefully instead of forcing filler stops', () => {
  const anchor = makeCandidate({ id: 'aaaaaaaa-1111-4111-8111-111111111111', category: 'gallery' });
  const only = makeCandidate({ id: 'bbbbbbbb-2222-4222-9222-222222222222', category: 'park', latitude: 43.66 });
  const selected = planner.selectStops({
    anchor, candidates: [only], stopCount: 3, requestedBudget: 'balanced',
    recentPlaceIds: new Set(), rotationKey: 'k', profile: {},
  });
  const plan = planner.buildPlan({
    anchor, selected, hoursByPlace: new Map(), timezone: TZ,
    startAt: NOW, requestedBudget: 'balanced', requestedStopCount: 3,
  });
  assert.equal(plan.stopCount, 2);
  assert.equal(plan.requestedStopCount, 3);
  assert.match(plan.availabilityNote, /shorter, never filler/);
  assert.equal(plan.stops.length, 2);
});

test('selection never duplicates the anchor and caps at requested stops', () => {
  const anchor = makeCandidate({ id: 'aaaaaaaa-1111-4111-8111-111111111111' });
  const candidates = [1, 2, 3, 4, 5].map((n) => makeCandidate({ id: `bbbbbbbb-000${n}-4222-9222-00000000000${n}`, latitude: 43.65 + n * 0.01 }));
  const selected = planner.selectStops({
    anchor, candidates, stopCount: 3, requestedBudget: 'balanced',
    recentPlaceIds: new Set(), rotationKey: 'k', profile: {},
  });
  assert.equal(selected.length, 3);
  assert.equal(new Set(selected.map((s) => s.id)).size, 3);
});

// Objects built inside the vm carry the realm's prototypes, so compare by JSON.
const plain = (value) => JSON.parse(JSON.stringify(value));

test('cost estimates distinguish free, priced, and unknown — never guessing zeros', () => {
  assert.deepEqual(plain(planner.costEstimateFor(makeCandidate({ price_band: 'free' }))), { min: 0, max: 0 });
  assert.deepEqual(plain(planner.costEstimateFor(makeCandidate({ price_band: '$' }))), { min: 8, max: 28 });
  assert.deepEqual(plain(planner.costEstimateFor(makeCandidate({ price_band: '$$$' }))), { min: 60, max: 140 });
  assert.equal(planner.costEstimateFor(makeCandidate({})), null);
  assert.equal(planner.costEstimateFor(makeCandidate({ price_band: 'mystery' })), null);
  // Profile band wins over the place band.
  assert.deepEqual(
    plain(planner.costEstimateFor(makeCandidate({ price_band: '$$$', profile: { price_band: 'free' } }))),
    { min: 0, max: 0 }
  );
});

test('plan budget sums priced stops and stays null when nothing is priced', () => {
  const anchor = makeCandidate({ id: 'aaaaaaaa-1111-4111-8111-111111111111', price_band: '$' });
  const priced = makeCandidate({ id: 'bbbbbbbb-2222-4222-9222-222222222222', price_band: '$$$', latitude: 43.66 });
  const unknown = makeCandidate({ id: 'cccccccc-3333-4333-8333-333333333333', latitude: 43.67 });
  const withUnknown = planner.buildPlan({
    anchor, selected: [anchor, priced, unknown], hoursByPlace: new Map(), timezone: TZ,
    startAt: NOW, requestedBudget: 'balanced', requestedStopCount: 3,
  });
  assert.deepEqual(plain(withUnknown.budgetEstimate), {
    min: 68, max: 168, currency: 'CAD', perPerson: true, knownCount: 2, unknownCount: 1,
  });
  const allUnknown = planner.buildPlan({
    anchor: makeCandidate({ id: 'aaaaaaaa-1111-4111-8111-111111111111' }),
    selected: [
      makeCandidate({ id: 'aaaaaaaa-1111-4111-8111-111111111111' }),
      unknown,
    ],
    hoursByPlace: new Map(), timezone: TZ,
    startAt: NOW, requestedBudget: 'balanced', requestedStopCount: 2,
  });
  assert.equal(allUnknown.budgetEstimate, null);
});

test('openAt handles overnight windows across midnight', () => {
  const hours = [{ place_id: 'p', day_of_week: 1, opens_at: '19:00', closes_at: '02:00' }];
  const mondayEvening = new Date('2026-06-16T00:00:00Z'); // 20:00 Mon
  const tuesdayEarly = new Date('2026-06-16T05:00:00Z'); // 01:00 Tue, inside Monday's overnight window
  const tuesdayLate = new Date('2026-06-16T07:00:00Z'); // 03:00 Tue, past close
  assert.deepEqual(plain(planner.openAt(hours, TZ, mondayEvening)), { known: true, open: true });
  assert.deepEqual(plain(planner.openAt(hours, TZ, tuesdayEarly)), { known: true, open: true });
  assert.deepEqual(plain(planner.openAt(hours, TZ, tuesdayLate)), { known: true, open: false });
});

test('planStartAt waits for a same-day reopening within the cap only', () => {
  const anchorId = 'aaaaaaaa-1111-4111-8111-111111111111';
  const soon = new Map([[anchorId, [{ place_id: anchorId, day_of_week: 1, opens_at: '20:00', closes_at: '23:00' }]]]);
  const shifted = planner.planStartAt(anchorId, soon, TZ, NOW);
  assert.equal(shifted.waitedForOpening, true);
  assert.equal(shifted.startAt.getTime() - NOW.getTime(), 30 * 60_000);

  const far = new Map([[anchorId, [{ place_id: anchorId, day_of_week: 1, opens_at: '23:59', closes_at: '23:59' }]]]);
  assert.equal(planner.planStartAt(anchorId, far, TZ, NOW).waitedForOpening, false);

  const open = new Map([[anchorId, [{ place_id: anchorId, day_of_week: 1, opens_at: '10:00', closes_at: '23:00' }]]]);
  assert.equal(planner.planStartAt(anchorId, open, TZ, NOW).waitedForOpening, false);

  const closedToday = new Map([[anchorId, [{ place_id: anchorId, day_of_week: 1, is_closed: true }]]]);
  assert.equal(planner.planStartAt(anchorId, closedToday, TZ, NOW).waitedForOpening, false);
});

test('getQuickPlan sends taste, stop count, and clock, and normalizes the response', async () => {
  let body;
  const { getQuickPlan } = load('../src/services/api.ts', {
    '@/src/services/supabase': {
      echooConfig: { supabaseUrl: 'https://example.invalid', supabaseAnonKey: 'test' },
      supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
    },
    '@/src/services/location': { manualMunicipalityLocation: () => null },
  }, {
    URL,
    fetch: async (_url, options) => {
      body = JSON.parse(options.body);
      return {
        ok: true,
        json: async () => ({
          plan: {
            title: '2-stop balanced plan', subtitle: 'Built around X', stopCount: 4, requestedStopCount: 2,
            budgetStyle: 'balanced', anchorId: 'aaaaaaaa-1111-4111-8111-111111111111', anchorName: 'X',
            totalTravelMinutes: 12, availabilityNote: '', budgetEstimate: null,
            stops: [
              { id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Anchor', category: 'c', address: '', latitude: 43.65, longitude: -79.38, imageUrl: '', time: '7:00 p.m.', travelMinutes: 0, reason: '', priceLabel: '', availability: 'unverified', isAnchor: true },
              { id: 'bbbbbbbb-2222-4222-9222-222222222222', name: 'Stop', category: 'c', address: '', latitude: 43.66, longitude: -79.39, imageUrl: '', time: '8:00 p.m.', travelMinutes: 9, reason: '', priceLabel: '', availability: 'open', isAnchor: false },
              // Duplicate id and an unnamed stop must be dropped.
              { id: 'bbbbbbbb-2222-4222-9222-222222222222', name: 'Dup', category: 'c', address: '', latitude: 43.66, longitude: -79.39, imageUrl: '', time: '8:00 p.m.', travelMinutes: 9, reason: '', priceLabel: '', availability: 'open', isAnchor: false },
              { id: 'cccccccc-3333-4333-8333-333333333333', name: '', category: 'c', address: '', latitude: 43.67, longitude: -79.40, imageUrl: '', time: '9:00 p.m.', travelMinutes: 9, reason: '', priceLabel: '', availability: 'open', isAnchor: false },
            ],
          },
        }),
      };
    },
  });
  const anchor = {
    id: 'live-1', canonicalId: 'aaaaaaaa-1111-4111-8111-111111111111', source: 'echoo', type: 'place',
    title: 'X', category: 'gallery', description: '', city: 'Toronto', address: null,
    latitude: 43.65, longitude: -79.38, distanceMeters: null, startsAt: null,
    image: null, features: [], community: null, placement: null,
  };
  const plan = await getQuickPlan({
    anchor,
    stopCount: 2,
    profile: { interests: ['art'], budget: '$$$', energy: 'chill', city: 'Toronto' },
  });
  assert.equal(body.stopCount, 2);
  assert.equal(body.budgetStyle, 'elevated');
  assert.equal(body.profile.budget, '$$$');
  assert.equal(body.profile.city, 'Toronto');
  assert.ok(typeof body.now === 'string');
  assert.equal(body.anchor.id, 'aaaaaaaa-1111-4111-8111-111111111111');
  assert.equal(plan.stops.length, 2);
  assert.equal(plan.stopCount, 2);
  assert.equal(new Set(plan.stops.map((s) => s.id)).size, 2);
});

test('budget formatting keeps null, zero, and estimates visually distinct', () => {
  const { formatCostEstimate, formatStopCost, formatPlanBudget } = load('../src/services/plan-format.ts');
  assert.equal(formatCostEstimate(null), null);
  assert.equal(formatCostEstimate(undefined), null);
  assert.equal(formatCostEstimate({ min: 0, max: 0 }), 'Free');
  assert.equal(formatCostEstimate({ min: 8, max: 28 }), '$8–$28');
  assert.equal(formatStopCost({ priceLabel: 'Price not listed', costEstimate: null }), 'Price not listed');
  assert.equal(formatStopCost({ priceLabel: 'Value pick', costEstimate: { min: 0, max: 0 } }), 'Free est. · Value pick');
  assert.equal(
    formatPlanBudget({ budgetEstimate: null, stops: [] }),
    'Outing cost unknown. Check menus and admission prices.'
  );
  assert.equal(
    formatPlanBudget({ budgetEstimate: { min: 68, max: 168, currency: 'CAD', perPerson: true, knownCount: 2, unknownCount: 1 }, stops: [] }),
    'Known costs only: $68–$168 per person; 1 place still unpriced'
  );
});

test('missing numeric evidence is not zero and invalid coordinates fail invariants', () => {
  for (const value of [null, undefined, '', false]) assert.ok(Number.isNaN(planner.number(value, NaN)));
  assert.equal(planner.number(0, NaN), 0);
  for (const latitude of [91, null, undefined, '', false]) {
    const anchor = makeCandidate({ latitude });
    assert.throws(() => planner.buildPlan({ anchor, selected: [anchor], hoursByPlace: new Map(), timezone: TZ, startAt: NOW, requestedBudget: 'value', requestedStopCount: 2 }), /location/);
  }
});

test('early morning cannot borrow tonight opening and an ongoing overnight visit does not wait', () => {
  const early = new Date('2026-06-16T05:00:00Z');
  const today = { place_id: 'p', day_of_week: 2, opens_at: '19:00', closes_at: '02:00' };
  assert.equal(planner.openAt([today], TZ, early).open, false);
  const yesterday = { ...today, day_of_week: 1 };
  assert.equal(planner.openAt([yesterday, today], TZ, early).open, true);
  assert.equal(planner.planStartAt('p', new Map([['p', [yesterday, { ...today, opens_at: '03:00' }]]]), TZ, early).waitedForOpening, false);
  assert.equal(planner.minuteOfDay('29:99'), null);
});

test('first-place hours count and fixed chosen-place positions stay exact for 2 and 3 places', () => {
  const anchor = makeCandidate({ id: 'a', category: 'restaurant' });
  const others = [makeCandidate({ id: 'b', category: 'park' }), makeCandidate({ id: 'c', category: 'gallery' })];
  const hours = new Map([['a', [{ place_id: 'a', day_of_week: 1, is_closed: true }]]]);
  assert.equal(planner.orderStops([anchor], hours, TZ, NOW).hourViolations, 1);
  for (const count of [2, 3]) for (let position = 1; position <= count; position++) {
    const plan = planner.buildPlan({ anchor, selected: [anchor, ...others.slice(0, count - 1)], hoursByPlace: hours, timezone: TZ, startAt: NOW, requestedBudget: 'value', requestedStopCount: count, anchorPosition: position });
    assert.equal(plan.stops[position - 1].id, 'a');
    assert.equal(plan.stops[position - 1].availability, 'check_hours');
    assert.equal(plan.stops.filter((p) => p.isAnchor).length, 1);
    assert.equal(plan.totalDurationMinutes, 65 + (count - 1) * 75 + plan.totalTravelMinutes);
    assert.ok(plan.stops.every((p) => Number.isFinite(Date.parse(p.arrivalAt))));
  }
});

test('regeneration excludes recent nonchosen places and never silently recycles exhausted supply', () => {
  const anchor = makeCandidate({ id: 'a' });
  const candidates = ['b', 'c', 'd', 'e'].map((id) => makeCandidate({ id }));
  const input = { anchor, candidates, stopCount: 3, requestedBudget: 'value', profile: {}, recentPlaceIds: new Set(), rotationKey: 'one' };
  const first = planner.selectStops(input);
  const recentPlaceIds = new Set(first.slice(1).map((p) => p.id));
  const second = planner.selectStops({ ...input, recentPlaceIds, rotationKey: 'two' });
  assert.equal(second[0].id, anchor.id);
  assert.ok(second.slice(1).every((p) => !recentPlaceIds.has(p.id)));
  second.slice(1).forEach((p) => recentPlaceIds.add(p.id));
  assert.deepEqual([...planner.selectStops({ ...input, recentPlaceIds }).map((p) => p.id)], ['a']);
});

test('quick-plan handler rejects fabricated live IDs rather than trusting client location or photos', async () => {
  let handler;
  handler = load('../../supabase/functions/quick-plan/service.ts', {
    './planner.ts': planner,
    '../_shared/location.ts': {
      CORS_HEADERS: {}, getSupabaseAdmin: () => ({}),
      jsonResponse: (body, status = 200) => ({ body, status }),
    },
  }, { Deno: { env: { get: () => undefined } }, console }).handleQuickPlan;
  const result = await handler({ method: 'POST', headers: { get: () => null }, json: async () => ({ anchor: { id: 'google:invented', name: 'Fake', latitude: 43.65, longitude: -79.38, imageUrl: 'https://fake.invalid/photo' } }) });
  assert.equal(result.status, 422);
  assert.match(result.body.error, /cannot verify/);
});

test('quick-plan handler preserves tailoring, canonical photos, and anchor position through regeneration and exhaustion', async () => {
  let handler;
  const anchor = makePlace({ id: 'aaaaaaaa-1111-4111-8111-111111111111', name: 'Anchor', price_band: '$$' });
  const nearby = [1, 2, 3, 4].map((n) => makePlace({ id: `bbbbbbbb-000${n}-4222-9222-00000000000${n}`, name: `Inventory ${n}`, latitude: 43.65 + n / 1000, price_band: '$$' }));
  const tables = {
    canonical_places: [anchor, ...nearby],
    place_profiles: [], place_hours: [],
    place_photos: [{ place_id: anchor.id, image_url: 'https://inventory.example/approved.jpg' }],
  };
  const database = {
    rpc: () => Promise.resolve({ data: nearby }),
    from: (table) => {
      let rows = tables[table];
      const query = {
        select: () => query,
        eq: (key, value) => { if (key === 'id') rows = rows.filter((row) => row.id === value); return query; },
        in: (key, values) => { rows = rows.filter((row) => values.includes(row[key])); return query; },
        order: () => query,
        maybeSingle: async () => ({ data: rows[0] || null }),
        then: (resolve, reject) => Promise.resolve({ data: rows }).then(resolve, reject),
      };
      return query;
    },
  };
  handler = load('../../supabase/functions/quick-plan/service.ts', {
    './planner.ts': planner,
    '../_shared/location.ts': { CORS_HEADERS: {}, getSupabaseAdmin: () => database, logLocationEvent: async () => {}, jsonResponse: (body, status = 200) => ({ body, status }) },
  }, { Deno: { env: { get: () => undefined } }, console }).handleQuickPlan;
  const request = (recentPlaceIds, rotationKey) => handler({ method: 'POST', headers: { get: () => null }, json: async () => ({
    anchor: { id: anchor.id, latitude: 0, longitude: 0, imageUrl: 'https://untrusted.example/fake.jpg' },
    stopCount: 3, budgetStyle: 'balanced', mood: 'curious', anchorPosition: 3, recentPlaceIds, rotationKey,
  }) });
  const first = await request([], 'first');
  assert.equal(first.status, 200);
  assert.equal(first.body.plan.stops[2].id, anchor.id);
  assert.equal(first.body.plan.stops[2].imageUrl, tables.place_photos[0].image_url);
  assert.equal(first.body.plan.stops[2].latitude, anchor.latitude);
  assert.equal(first.body.plan.mood, 'curious');
  assert.equal(first.body.plan.budgetStyle, 'balanced');
  assert.ok(first.body.plan.stops.every((place) => place.availability === 'unverified'));
  const history = first.body.plan.stops.filter((place) => !place.isAnchor).map((place) => place.id);
  const second = await request(history, 'second');
  assert.equal(second.status, 200);
  assert.equal(second.body.plan.stops[2].id, anchor.id);
  assert.ok(second.body.plan.stops.filter((place) => !place.isAnchor).every((place) => !history.includes(place.id)));
  assert.equal(second.body.plan.alternativesExhausted, true);
  const exhausted = await request([...history, ...second.body.plan.stops.filter((place) => !place.isAnchor).map((place) => place.id)], 'third');
  assert.equal(exhausted.status, 409);
  assert.equal(exhausted.body.code, 'ALTERNATIVES_EXHAUSTED');
  assert.equal(exhausted.body.plan, undefined);
});
