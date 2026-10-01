const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const loadRequest = require('./load-request.cjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function load(file, modules, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(code, { exports, Error, URL, Request, Response, AbortController, setTimeout, clearTimeout,
    require: name => { assert.ok(name in modules, `Unexpected import ${name}`); return modules[name]; }, ...globals });
  return exports;
}
const shortTimers = { setTimeout: callback => setTimeout(callback, 8) };

test('deadline releases stalled work, aborts its transport and ignores late completion', async () => {
  const request = loadRequest();
  const pending = deferred();
  let signal;
  await assert.rejects(request.runRequest(s => { signal = s; return pending.promise; }, { timeoutMs: 5 }), { name: 'RequestTimeoutError' });
  assert.equal(signal.aborted, true);
  pending.resolve('late');
  let calls = 0;
  const controller = new AbortController(); controller.abort();
  await assert.rejects(request.runRequest(() => { calls++; }, { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
  assert.equal(request.retryRead(0, new request.RequestTimeoutError()), false);
  assert.equal(request.retryRead(0, { status: 401 }), false);
  assert.equal(request.retryRead(0, { status: 500 }), true);
});

test('Supabase transport covers hanging response bodies and preserves HTTP failures without retries', async () => {
  let calls = 0;
  const request = loadRequest({ ...shortTimers, fetch: async () => { calls++; return { arrayBuffer: () => new Promise(() => {}) }; } });
  await assert.rejects(request.fetchWithDeadline('https://example.test/rest/v1/example'), { name: 'RequestTimeoutError' });
  assert.equal(calls, 1);
  request.setRequestOnline(false);
  await assert.rejects(request.fetchWithDeadline('https://example.test/rest/v1/example'), { name: 'OfflineError' });
  assert.equal(calls, 1);
  const failing = loadRequest({ fetch: async () => new Response('{"error":"denied"}', { status: 403, headers: { 'x-request-id': 'test' } }) });
  const response = await failing.fetchWithDeadline('https://example.test');
  assert.equal(response.status, 403);
  assert.equal(response.headers.get('x-request-id'), 'test');
  assert.equal((await response.json()).error, 'denied');
});

test('a timed-out session lookup never sends a late API write; cancelling a body cannot trigger a paywall', async () => {
  const session = deferred(), body = deferred();
  let calls = 0, paywalls = 0;
  const request = loadRequest(shortTimers);
  const api = load('services/api.ts', {
    './request': request, './subscription-events': { subscriptionRequired: () => paywalls++ },
    '@/src/services/location': {},
    '@/src/services/supabase': { echooConfig: { supabaseUrl: 'https://example.test' }, supabase: { auth: { getSession: () => session.promise } } },
  }, { fetch: async () => { calls++; return { status: 402, ok: false, json: () => body.promise }; } });
  await assert.rejects(api.edgeRequest('write', { body: {} }), { name: 'RequestTimeoutError' });
  session.resolve({ data: { session: null } });
  await tick();
  assert.equal(calls, 0);
  const controller = new AbortController();
  const pending = api.edgeRequest('read', { signal: controller.signal });
  await tick();
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  body.resolve({ code: 'subscription_required' });
  await tick();
  assert.equal(paywalls, 0);
});

test('native reconnect and focus events recover queries; old connectivity snapshots and unmounted listeners cannot override them', async () => {
  const first = deferred(), second = deferred();
  let networkListener, appListener, snapshots = 0, removed = 0;
  const online = [], focused = [], transport = [];
  const lifecycle = load('services/query-lifecycle.ts', {
    'react-native': { AppState: { currentState: 'active', addEventListener: (_event, callback) => { appListener = callback; return { remove: () => removed++ }; } } },
    'expo-network': { addNetworkStateListener: callback => { networkListener = callback; return { remove: () => removed++ }; }, getNetworkStateAsync: () => ++snapshots === 1 ? first.promise : second.promise },
    '@tanstack/react-query': { onlineManager: { setOnline: value => online.push(value) }, focusManager: { setFocused: value => focused.push(value) } },
    './request': { setRequestOnline: value => transport.push(value) },
  });
  const cleanup = lifecycle.connectQueryLifecycle();
  networkListener({ isConnected: false });
  networkListener({ isConnected: true, isInternetReachable: true });
  first.resolve({ isConnected: false });
  await tick();
  assert.deepEqual(online, [false, true]);
  assert.deepEqual(transport, online);
  appListener('background'); appListener('active');
  assert.deepEqual(focused, [true, false, true]);
  cleanup();
  second.resolve({ isConnected: false }); networkListener({ isConnected: false });
  await tick();
  assert.deepEqual(online, [false, true]);
  assert.equal(removed, 2);
});

test('real Supabase SDK signs out offline even with an expired session and cannot restore it on reopen', async () => {
  const { processLock } = require('@supabase/supabase-js');
  const { GoTrueClient } = require('@supabase/auth-js');
  for (const expired of [false, true]) {
    const key = `echoo-test-${expired}`;
    const stored = new Map();
    const storage = { getItem: async key => stored.get(key) ?? null, setItem: async (key, value) => { stored.set(key, value); }, removeItem: async key => { stored.delete(key); } };
    let network = 0, signedOut = 0;
    const sdk = { auth: new GoTrueClient({ url: 'https://example.test/auth/v1',
      autoRefreshToken: false, persistSession: true, storageKey: key, storage, lock: processLock, detectSessionInUrl: false,
      fetch: async () => { network++; throw new Error('offline'); },
    }) };
    await sdk.auth.initialize();
    sdk.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') signedOut++; });
    await tick();
    stored.set(key, JSON.stringify({ access_token: 'old-token', refresh_token: 'old-refresh', expires_at: Date.now() / 1000 + (expired ? -100 : 3600), user: { id: 'old-user' } }));
    stored.set(`${key}-code-verifier`, 'secret');
    const service = load('services/local-signout.ts', {
      '@supabase/supabase-js': { processLock }, './session-storage': { sessionStorage: storage },
      './supabase': { supabase: sdk, SESSION_STORAGE_KEY: key, echooConfig: {} }, './request': loadRequest(),
    });
    const [a, b] = await Promise.all([service.signOutOnDevice(), service.signOutOnDevice()]);
    assert.equal(a.access_token, 'old-token'); assert.equal(b, a);
    assert.equal(network, 0);
    assert.equal(signedOut, 1);
    assert.equal(stored.size, 0);
    assert.equal((await sdk.auth.getSession()).data.session, null);
    await sdk.auth.stopAutoRefresh();
  }
});

function hooks() {
  const slots = [], effects = [];
  let cursor = 0, value;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => v === b[i]);
  const react = {
    createContext: () => ({ Provider: 'context' }),
    useState: initial => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef: initial => { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback: (fn, deps) => { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, fn }; return slots[index].fn; },
    useEffect: (fn, deps) => { const index = cursor++; if (!same(slots[index]?.deps, deps)) { slots[index]?.cleanup?.(); slots[index] = { deps }; effects.push(() => { slots[index].cleanup = fn(); }); } },
  };
  return { react, jsx: { jsx: (_type, props) => { value = props.value; } }, render: component => { cursor = 0; component({ children: null }); effects.splice(0).forEach(fn => fn()); return value; }, cleanup: () => slots.forEach(slot => slot?.cleanup?.()) };
}

test('access checks deduplicate; brief outages preserve valid access but explicit revocation and account switches do not', async () => {
  const h = hooks();
  let user = { id: 'a' }, response = deferred(), required, reconnect, calls = 0;
  const client = { clear() {} };
  const provider = load('providers/subscription-provider.tsx', {
    react: h.react, 'react/jsx-runtime': h.jsx,
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    '@tanstack/react-query': { useQueryClient: () => client, onlineManager: { subscribe: fn => { reconnect = fn; return () => {}; } } },
    './auth-provider': { useAuth: () => ({ user }) },
    '../services/subscriptions': { readMobileAccess: () => { calls++; return response.promise; } },
    '../services/subscription-events': { onSubscriptionRequired: fn => { required = fn; return () => {}; } },
  }, { setInterval: () => 1, clearInterval() {} });
  let context = h.render(provider.SubscriptionProvider);
  const first = context.refresh(); assert.equal(context.refresh(), first); assert.equal(calls, 1);
  response.resolve({ active: true, source: 'subscription', expiresAt: new Date(Date.now() + 60000).toISOString() });
  await first; await tick();
  context = h.render(provider.SubscriptionProvider);
  assert.equal(context.access.active, true);
  response = deferred(); const outage = context.refresh(); response.reject(new Error('offline')); await outage; await tick();
  context = h.render(provider.SubscriptionProvider);
  assert.equal(context.access.active, true); assert.equal(context.error, null);
  response = deferred(); required();
  context = h.render(provider.SubscriptionProvider); assert.equal(context.access, null);
  response.resolve({ active: false }); await tick();
  context = h.render(provider.SubscriptionProvider); assert.equal(context.access.active, false);
  user = { id: 'b' }; response = deferred();
  context = h.render(provider.SubscriptionProvider); assert.equal(context.access, null); assert.equal(context.ready, false);
  response.reject(new Error('offline')); await tick();
  context = h.render(provider.SubscriptionProvider); assert.equal(context.ready, true); assert.equal(context.error, 'offline');
  response = deferred(); reconnect(true); response.resolve({ active: true, expiresAt: null }); await tick();
  context = h.render(provider.SubscriptionProvider); assert.equal(context.access.active, true);
  h.cleanup();
});

test('notification cleanup keeps only owner/token records offline; a new registration is not revoked later', async () => {
  const values = new Map([['echoo:planning-push-token:v1', 'ExpoPushToken[old]']]);
  let session = { user: { id: 'a' }, access_token: 'private-a' }, offline = true, removed = 0;
  const requests = [];
  const service = load('services/planning-notifications.ts', {
    './request': loadRequest(), 'expo-device': { isDevice: true },
    'expo-notifications': { dismissAllNotificationsAsync: async () => removed++, getPermissionsAsync: async () => ({ status: 'granted' }), getExpoPushTokenAsync: async () => ({ data: 'ExpoPushToken[old]' }) },
    'expo-constants': { __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'test' } } } } },
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => values.set(key, value), removeItem: async key => values.delete(key) } },
    'react-native': { Platform: { OS: 'ios' } },
    '@/src/services/supabase': { echooConfig: { supabaseUrl: 'https://example.test' }, supabase: { auth: { getSession: async () => ({ data: { session } }) } } },
    './notification-policy': { notificationPath: value => value }, './notifications': { clearLocalReminders: async () => removed++ },
  }, { fetch: async (url, options) => { requests.push({ url, options }); if (offline) throw Error('offline'); return new Response(null, { status: 204 }); } });
  await service.disablePlanningNotifications(session);
  assert.equal(removed, 2);
  assert.equal(values.has('echoo:planning-push-token:v1'), false);
  assert.ok(values.get('echoo:push-cleanup:v1').includes('ExpoPushToken[old]'));
  assert.ok(!values.get('echoo:push-cleanup:v1').includes('private-a'));
  session = { user: { id: 'b' }, access_token: 'private-b' };
  offline = false;
  await service.retryPushCleanup(session);
  assert.equal(requests.length, 1, 'new account must not unregister old-account records');
  await service.enablePlanningNotifications(false);
  assert.equal(requests.at(-1).options.headers.Authorization, 'Bearer private-b');
  assert.equal(requests.at(-1).url.endsWith('/register_planning_device'), true);
  const count = requests.length;
  await service.retryPushCleanup(session);
  assert.equal(requests.length, count);
  assert.equal(values.get('echoo:push-cleanup:v1'), '[]');
});

test('sign-out interrupts a stuck SDK refresh and a late refresh response cannot restore the account', { timeout: 2000 }, async () => {
  const { processLock } = require('@supabase/supabase-js');
  const { GoTrueClient } = require('@supabase/auth-js');
  const key = 'echoo-refresh-signout-test';
  const values = new Map();
  const storage = { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => values.set(key, value), removeItem: async key => values.delete(key) };
  const response = deferred();
  let requested = false;
  const transport = loadRequest({ fetch: () => { requested = true; return response.promise; } });
  const sdk = { auth: new GoTrueClient({ url: 'https://example.test/auth/v1', storageKey: key, storage, lock: processLock,
    autoRefreshToken: false, persistSession: true, detectSessionInUrl: false, fetch: transport.fetchWithDeadline }) };
  await sdk.auth.initialize();
  values.set(key, JSON.stringify({ access_token: 'old', refresh_token: 'old-refresh', expires_at: Date.now() / 1000 - 1, user: { id: 'a' } }));
  const refresh = sdk.auth.getSession();
  await tick();
  assert.equal(requested, true);
  const service = load('services/local-signout.ts', {
    '@supabase/supabase-js': { processLock }, './session-storage': { sessionStorage: storage },
    './supabase': { supabase: sdk, SESSION_STORAGE_KEY: key }, './request': transport,
  });
  await service.signOutOnDevice();
  await refresh;
  assert.equal(values.size, 0);
  response.resolve(new Response(JSON.stringify({ access_token: 'late', refresh_token: 'late-refresh', expires_in: 3600, user: { id: 'a' } })));
  await tick();
  assert.equal((await sdk.auth.getSession()).data.session, null);
  await sdk.auth.stopAutoRefresh();
});

test('startup and profile stalls expose retry, recover on reconnect, and late data cannot overwrite a newer account', async () => {
  const h = hooks();
  let listener, reconnect, session = { user: { id: 'a' } };
  const profiles = [];
  const request = loadRequest({ setTimeout: (callback, ms) => setTimeout(callback, ms ? 10 : 0) });
  const provider = load('providers/auth-provider.tsx', {
    react: h.react, 'react/jsx-runtime': h.jsx,
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    '@tanstack/react-query': { onlineManager: { isOnline: () => true, subscribe: fn => { reconnect = fn; return () => {}; } }, focusManager: { subscribe: () => () => {} } },
    '@/src/services/request': request,
    '@/src/services/local-signout': { signOutOnDevice: async () => null },
    '@/src/services/planning-notifications': { retryPushCleanup: async () => {}, disablePlanningNotifications: async () => {} },
    '@/src/services/auth': { loadProfile: user => { const result = deferred(); profiles.push({ ...result, user }); return result.promise; } },
    '@/src/services/supabase': { supabase: { auth: { onAuthStateChange: fn => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; }, getSession: async () => ({ data: { session } }), startAutoRefresh() {}, stopAutoRefresh() {} } } },
  }, { setTimeout: (callback, ms) => setTimeout(callback, ms ? 10 : 0) });
  let context = h.render(provider.AuthProvider);
  assert.equal(context.ready, false);
  await new Promise(resolve => setTimeout(resolve, 20));
  context = h.render(provider.AuthProvider);
  assert.equal(context.ready, true);
  assert.match(context.profileError, /restore your session/);
  reconnect(true); await tick();
  assert.equal(profiles.length, 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  context = h.render(provider.AuthProvider);
  assert.match(context.profileError, /profile is taking longer/);
  reconnect(true); await tick();
  profiles[1].resolve({ userId: 'a', completedAt: 'today' }); await tick();
  context = h.render(provider.AuthProvider);
  assert.equal(context.profile.userId, 'a'); assert.equal(context.profileError, null);
  profiles[0].resolve({ userId: 'obsolete' }); await tick();
  context = h.render(provider.AuthProvider); assert.equal(context.profile.userId, 'a');
  session = { user: { id: 'b' } }; listener('SIGNED_IN', session);
  await new Promise(resolve => setTimeout(resolve, 2));
  profiles[2].resolve({ userId: 'b', completedAt: 'today' }); await tick();
  context = h.render(provider.AuthProvider); assert.equal(context.profile.userId, 'b');
  h.cleanup();
});
