const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function service({ user = 'u1', rpcError = null, accuracy = 12, permission = 'granted', generationError = null } = {}) {
  const storage = new Map();
  const calls = { permissions: 0, rpc: [], generation: [] };
  let activeUser = user;
  let uuid = 0;
  const modules = {
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async (k) => storage.get(k) || null, setItem: async (k, v) => storage.set(k, v) } },
    'expo-crypto': { randomUUID: () => `outing-${++uuid}` },
    'expo-location': { Accuracy: { High: 4 }, requestForegroundPermissionsAsync: async () => { calls.permissions++; return { status: permission }; }, getCurrentPositionAsync: async () => ({ coords: { latitude: 43.65, longitude: -79.38, accuracy }, timestamp: Date.now() }) },
    '@/src/services/supabase': { supabase: {
      auth: { getSession: async () => ({ data: { session: activeUser ? { user: { id: activeUser } } : null } }) },
      rpc: async (name, input) => { calls.rpc.push({ name, input }); return { data: { visitId: 'visit', awardedPoints: 10, city: 'Toronto' }, error: rpcError }; },
    } },
    '@/src/services/api': { getQuickPlan: async (input) => { calls.generation.push(input); if (generationError) throw generationError; return { generatedAt: new Date().toISOString(), anchorId: 'a', stops: [{ id: 'a' }, { id: `other-${uuid}` }] }; } },
  };
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '../src/services/outing.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(compiled, { exports, require: (id) => modules[id] || {} });
  return { ...exports, storage, calls, setUser: (id) => { activeUser = id; } };
}

test('generation persists per-account route, bounded nonchosen history, and a changing rotation key', async () => {
  const s = service();
  const input = { anchor: { id: 'a', canonicalId: null }, stopCount: 2 };
  const first = await s.generateOuting(input, s.defaultOutingChoices, 'u1');
  assert.equal(s.calls.permissions, 0);
  const second = await s.generateOuting(input, s.defaultOutingChoices, 'u1');
  assert.notEqual(s.calls.generation[0].rotationKey, s.calls.generation[1].rotationKey);
  assert.deepEqual([...s.calls.generation[1].recentPlaceIds], ['other-1']);
  assert.equal((await s.loadActiveOuting('u1')).id, second.id);
  assert.equal(first.ownerId, 'u1');
  for (let n = 0; n < 35; n++) await s.generateOuting(input, s.defaultOutingChoices, 'u1');
  assert.equal(JSON.parse(s.storage.get('echoo:outing-history:v1:u1:a')).length, 30);
  s.setUser('u2');
  assert.equal(await s.loadActiveOuting('u2'), null);
  await assert.rejects(s.saveActiveOuting('u1', first), /Sign in again/);
});

test('arrival alone asks for foreground location; server receives neither city nor points', async () => {
  const s = service();
  const result = await s.verifyArrival('u1', 'aaaaaaaa-1111-4111-8111-111111111111');
  assert.equal(s.calls.permissions, 1);
  assert.equal(result.visitId, 'visit');
  assert.equal(s.calls.rpc[0].name, 'verify_outing_arrival');
  assert.deepEqual(Object.keys(s.calls.rpc[0].input).sort(), ['p_accuracy', 'p_latitude', 'p_longitude', 'p_observed_at', 'p_place_id']);
  assert.equal(s.storage.size, 0);
});

test('auth and noncanonical arrival fail before asking location; offline claims never mutate local scores', async () => {
  const s = service({ rpcError: { message: 'offline' } });
  await assert.rejects(s.verifyArrival('u2', 'aaaaaaaa-1111-4111-8111-111111111111'), /Sign in/);
  await assert.rejects(s.verifyArrival('u1', 'google:fake'), /cannot be verified/);
  assert.equal(s.calls.permissions, 0);
  await assert.rejects(s.claimCityBadge('u1', { city_key: 'CA:ON:toronto', badge_count: 2 }), /offline/);
  assert.equal(s.calls.rpc[0].input.p_milestone, 3);
  assert.equal(s.storage.size, 0);
});

test('migration has server-owned identity, proximity, RLS, atomic daily awards, and milestone idempotency', () => {
  const sql = readFileSync(path.join(__dirname, '../../supabase/migrations/202609080001_outing_city_scores.sql'), 'utf8');
  assert.equal((sql.match(/enable row level security/g) || []).length, 3);
  assert.match(sql, /unique \(user_id, place_id, local_day\)/);
  assert.match(sql, /unique \(user_id, city_key, milestone\)/);
  assert.match(sql, /v_user uuid := auth.uid\(\)/);
  assert.match(sql, /for update/);
  assert.match(sql, /if v_added then[\s\S]*points = points \+ 10/);
  assert.match(sql, /if found then return to_jsonb\(v_badge\)/);
  assert.match(sql, /points = points - 100, badge_count = badge_count \+ 1/);
  assert.match(sql, /extensions.st_dwithin/);
  assert.match(sql, /v_place.location is null or not coalesce\(extensions.st_dwithin/);
  assert.match(sql, /p_accuracy between 0 and 75/);
  assert.match(sql, /interval '2 minutes'/);
  assert.match(sql, /location_status = 'published' and is_supported_region/);
  assert.match(sql, /revoke all on public.outing_city_scores/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all) .* to authenticated/);
});

test('guest rotation retains earlier history and onboarding taste without storing guest rewards', async () => {
  const s = service({ user: null });
  const profile = { interests: ['art'], budget: '$$', energy: 'curious' };
  const choices = { ...s.defaultOutingChoices, budgetStyle: 'balanced', mood: 'curious', anchorPosition: 2 };
  const first = await s.generateOuting({ anchor: { id: 'a' }, stopCount: 2, profile }, choices);
  const second = await s.generateOuting({ anchor: { id: 'a' }, stopCount: 2, profile: first.profile, recentPlaceIds: first.recentPlaceIds }, choices);
  await s.generateOuting({ anchor: { id: 'a' }, stopCount: 2, profile: second.profile, recentPlaceIds: second.recentPlaceIds }, choices);
  assert.deepEqual([...s.calls.generation[2].recentPlaceIds], ['other-1', 'other-2']);
  assert.equal(s.calls.generation[2].profile, profile);
  assert.equal(s.calls.generation[2].budgetStyle, 'balanced');
  assert.equal(s.calls.generation[2].anchorPosition, 2);
  assert.equal(s.storage.size, 0);
});

test('denied permission and unavailable setup never create an arrival or award locally', async () => {
  const denied = service({ permission: 'denied' });
  await assert.rejects(denied.verifyArrival('u1', 'aaaaaaaa-1111-4111-8111-111111111111'), /not granted/);
  assert.equal(denied.calls.rpc.length, 0);
  const unavailable = service({ rpcError: { code: 'PGRST202', message: 'missing' } });
  await assert.rejects(unavailable.verifyArrival('u1', 'aaaaaaaa-1111-4111-8111-111111111111'), /not available on this server/);
  await assert.rejects(unavailable.claimCityBadge('u1', { city_key: 'CA:ON:toronto', badge_count: 0 }), /Server setup is required/);
  assert.equal(unavailable.storage.size, 0);
});

test('exhausted generation leaves active outing and history untouched', async () => {
  const s = service({ generationError: new Error('No further alternatives') });
  s.storage.set('echoo:outing:v1:u1', 'existing');
  s.storage.set('echoo:outing-history:v1:u1:a', '["earlier"]');
  await assert.rejects(s.generateOuting({ anchor: { id: 'a' }, stopCount: 2 }, s.defaultOutingChoices, 'u1'), /No further alternatives/);
  assert.equal(s.storage.get('echoo:outing:v1:u1'), 'existing');
  assert.equal(s.storage.get('echoo:outing-history:v1:u1:a'), '["earlier"]');
});

test('account ownership is checked on save and persisted progress survives unavailable visit recovery', async () => {
  const s = service();
  const outing = await s.generateOuting({ anchor: { id: 'a' }, stopCount: 2 }, s.defaultOutingChoices, 'u1');
  outing.progress.a = { status: 'skipped', at: new Date().toISOString() };
  await s.saveActiveOuting('u1', outing);
  assert.equal((await s.loadActiveOuting('u1')).progress.a.status, 'skipped');
  await assert.rejects(s.saveActiveOuting('u1', { ...outing, ownerId: 'u2' }), /another account/);
  assert.equal(s.calls.rpc.length, 0);
});

test('outing route bypasses companion and presents only plain planning controls', () => {
  const screen = readFileSync(path.join(__dirname, '../src/components/outing-screen.tsx'), 'utf8');
  const route = readFileSync(path.join(__dirname, '../app/planner.tsx'), 'utf8');
  const choices = readFileSync(path.join(__dirname, '../src/components/outing-choices.tsx'), 'utf8');
  assert.match(route, /if \(params.quickPlan\)\s+return\s*\(?\s*<OutingScreen/);
  assert.doesNotMatch(screen, /TextInput|askCompanion|Sparkles|assistant|chat/i);
  assert.match(screen, /Try another plan/);
  for (const label of ['Low', 'Regular', 'High', 'Chill', 'Lively', 'Curious']) assert.ok(choices.includes(`'${label}'`));
});
