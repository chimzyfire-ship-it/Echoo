const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');

function load(file, modules, globals = {}) {
  const compiled = ts.transpileModule(readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (name) => modules[name] ?? {}, Error, URL, setTimeout, clearTimeout, ...globals });
  return exports;
}

test('secure sessions survive adapter recreation, chunk Unicode, serialize writes and remove credentials', async () => {
  const values = new Map();
  let fail = false;
  const store = {
    getItemAsync: async (key) => values.get(key) ?? null,
    setItemAsync: async (key, value) => {
      assert.ok(Buffer.byteLength(value) <= 1800);
      if (fail && key.endsWith('.1')) throw new Error('device locked');
      values.set(key, value);
    },
    deleteItemAsync: async (key) => { values.delete(key); },
  };
  const { createSessionStorage } = load('../src/services/session-storage.ts', {
    'expo-secure-store': store, 'expo-crypto': { randomUUID: crypto.randomUUID }, 'react-native': { Platform: { OS: 'ios' } },
  });
  const storage = createSessionStorage(store);
  const token = JSON.stringify({ refresh_token: 'secret'.repeat(1000), name: '\u{1f600}\u00e9'.repeat(1000) });
  await storage.setItem('session', token);
  assert.equal(await createSessionStorage(store).getItem('session'), token);
  fail = true;
  await assert.rejects(storage.setItem('session', 'new'.repeat(2000)), /device locked/);
  assert.equal(await storage.getItem('session'), token);
  fail = false;
  await Promise.all([storage.setItem('session', 'first'), storage.setItem('session', 'last')]);
  assert.equal(await storage.getItem('session'), 'last');
  await storage.removeItem('session');
  assert.equal(await storage.getItem('session'), null);
  assert.equal(values.size, 0);
});

function google(environment, browser, fetcher, setSession) {
  return load('../src/services/google-auth.ts', {
    'expo-constants': { __esModule: true, default: { executionEnvironment: environment }, ExecutionEnvironment: { StoreClient: 'go' } },
    'expo-crypto': {
      getRandomBytesAsync: async () => crypto.randomBytes(32),
      CryptoDigestAlgorithm: { SHA256: 'sha256' }, CryptoEncoding: { BASE64: 'base64' },
      digestStringAsync: async (algorithm, value) => crypto.createHash(algorithm).update(value).digest('base64'),
    },
    'expo-web-browser': { openAuthSessionAsync: browser },
    'react-native': { Platform: { OS: 'ios' } },
    '@/src/services/supabase': { echooConfig: { supabaseUrl: 'https://example.test', supabaseAnonKey: 'public' }, supabase: { auth: { setSession } } },
  }, { fetch: fetcher });
}

test('Google uses matching native S256 PKCE and persists only exchanged tokens', async () => {
  let challenge, saved;
  const auth = google('native', async (url, redirect) => {
    const request = new URL(url);
    assert.equal(redirect, 'echoo://auth');
    assert.equal(request.searchParams.get('code_challenge_method'), 's256');
    challenge = request.searchParams.get('code_challenge');
    return { type: 'success', url: 'echoo://auth?code=one-use-code' };
  }, async (url, options) => {
    assert.equal(url, 'https://example.test/auth/v1/token?grant_type=pkce');
    const body = JSON.parse(options.body);
    assert.equal(body.auth_code, 'one-use-code');
    assert.equal(crypto.createHash('sha256').update(body.code_verifier).digest('base64url'), challenge);
    return { ok: true, json: async () => ({ access_token: 'access', refresh_token: 'refresh' }) };
  }, async (tokens) => { saved = tokens; return { data: { session: {} }, error: null }; });
  assert.equal(await auth.signInWithGoogle(), 'signed-in');
  assert.equal(saved.refresh_token, 'refresh');
});

test('Google blocks Expo Go, handles cancellation and rejects unexpected redirects', async () => {
  const never = () => { throw new Error('must not be called'); };
  await assert.rejects(google('go', never, never, never).signInWithGoogle(), /Expo Go/);
  assert.equal(await google('native', async () => ({ type: 'cancel' }), never, never).signInWithGoogle(), 'cancelled');
  await assert.rejects(google('native', async () => ({ type: 'success', url: 'evil://auth?code=x' }), never, never).signInWithGoogle(), /Unexpected/);
});

test('Surprise waits for restoration and protects anonymous, incomplete and failed profiles', () => {
  let auth, context, discovery = 0;
  const routes = [];
  const { SurpriseProvider } = load('../src/providers/surprise-provider.tsx', {
    react: { createContext: () => ({ Provider: 'provider' }), useEffect: () => {}, useCallback: (fn) => fn, useRef: (current) => ({ current }), useState: (v) => [v, () => {}] },
    'react/jsx-runtime': { jsx: (type, props) => { if (type === 'provider') context = props.value; }, jsxs: (type, props) => { if (type === 'provider') context = props.value; } },
    'expo-router': { useRouter: () => ({ push: (route) => routes.push(route) }) },
    '@/src/providers/auth-provider': { useAuth: () => auth },
    '@/src/providers/culture-provider': { useCulture: () => ({ active: null }) },
    '@/src/providers/location-provider': { useEchooLocation: () => ({ location: { city: 'Toronto' } }) },
    '@/src/services/api': { getDiscovery: () => { discovery++; return new Promise(() => {}); } },
    '@/src/services/culture': { cultureQueryFor: () => '' },
    '@/src/services/surprise': { timeContext: () => ({ label: 'tonight' }) },
  }, { setTimeout: () => 0 });
  for (const state of [
    { ready: false, user: null },
    { ready: true, user: null },
    { ready: true, user: { id: 'member' }, profile: null },
    { ready: true, user: { id: 'member' }, profileError: 'offline' },
    { ready: true, user: { id: 'member' }, profile: { completedAt: 'today' } },
  ]) {
    auth = state;
    SurpriseProvider({ children: null });
    context.start();
  }
  assert.deepEqual(routes, ['/auth', '/onboarding']);
  assert.equal(discovery, 1);
});

test('auth restoration defers profile I/O, ignores stale loads and keeps token refresh ready', async () => {
  const hooks = [], effects = [], pending = [];
  let cursor = 0, context, listener, session;
  const { AuthProvider } = load('../src/providers/auth-provider.tsx', {
    react: {
      createContext: () => ({ Provider: 'auth' }),
      useState: (initial) => {
        const index = cursor++;
        if (!(index in hooks)) hooks[index] = initial;
        return [hooks[index], (value) => { hooks[index] = value; }];
      },
      useRef: (initial) => {
        const index = cursor++;
        return hooks[index] ??= { current: initial };
      },
      useEffect: (effect) => { const index = cursor++; if (!(index in hooks)) { hooks[index] = true; effects.push(effect); } },
    },
    'react/jsx-runtime': { jsx: (_type, props) => { context = props.value; } },
    'react-native': { AppState: { currentState: 'active', addEventListener: () => ({ remove() {} }) } },
    '@/src/services/auth': { loadProfile: (user) => new Promise((resolve, reject) => pending.push({ user, resolve, reject })) },
    '@/src/services/supabase': { supabase: { auth: {
      onAuthStateChange: (fn) => { listener = fn; return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session } }), startAutoRefresh() {}, stopAutoRefresh() {},
      signOut: async () => { listener('SIGNED_OUT', null); return { error: null }; },
    } } },
  });
  const render = () => { cursor = 0; AuthProvider({ children: null }); };
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
  render();
  const cleanups = effects.map((effect) => effect());
  assert.equal(context.ready, false);
  session = { user: { id: 'a' } };
  listener('INITIAL_SESSION', session);
  assert.equal(pending.length, 0, 'no Supabase I/O inside auth callback');
  await tick();
  listener('SIGNED_OUT', null);
  await tick();
  pending[0].resolve({ userId: 'a', completedAt: 'yesterday' });
  await tick();
  render();
  assert.equal(context.ready, true);
  assert.equal(context.user, null);
  assert.equal(context.profile, null);
  session = { user: { id: 'b' } };
  listener('SIGNED_IN', session);
  await tick();
  pending[1].resolve({ userId: 'b', completedAt: 'today' });
  await tick();
  render();
  assert.equal(context.ready, true);
  assert.equal(context.profile.userId, 'b');
  listener('TOKEN_REFRESHED', { ...session, access_token: 'new' });
  render();
  assert.equal(context.ready, true);
  assert.equal(context.session.access_token, 'new');
  assert.equal(pending.length, 2);
  const retry = context.refreshProfile();
  await tick();
  pending[2].reject(new Error('offline'));
  await assert.rejects(retry, /offline/);
  render();
  assert.equal(context.profile, null);
  assert.equal(context.profileError, 'offline');
  await context.signOut();
  await tick();
  render();
  assert.equal(context.ready, true);
  assert.equal(context.user, null);
  assert.equal(context.profileError, null);
  cleanups.forEach((cleanup) => cleanup?.());
});
