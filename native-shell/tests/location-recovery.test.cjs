const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function load(file, imports = {}, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  vm.runInNewContext(js, { exports, require: name => { assert.ok(name in imports, name); return imports[name]; }, setTimeout, clearTimeout, AbortController, Error, ...globals });
  return exports;
}
const fresh = (accuracy = 20) => ({ timestamp: Date.now(), coords: { latitude: 43.65, longitude: -79.38, accuracy } });
function sensor(options = {}) {
  const calls = { prompts: 0, removed: 0, watches: 0 };
  const expo = {
    Accuracy: { Balanced: 3, High: 4 },
    getForegroundPermissionsAsync: async () => options.permission || { granted: true, canAskAgain: true },
    requestForegroundPermissionsAsync: async () => { calls.prompts++; return { granted: true }; },
    hasServicesEnabledAsync: async () => options.enabled !== false,
    watchPositionAsync: async (config, success) => {
      calls.watches++; calls.config = config;
      if (options.subscription) { calls.success = success; return options.subscription.promise; }
      success(options.fix || fresh());
      return { remove: () => calls.removed++ };
    },
  };
  return { ...load('src/services/device-location.ts', { 'expo-location': expo }, options.globals), calls };
}

test('discovery accepts approximate fixes; arrival requires current, precise coordinates', async () => {
  const s = sensor({ fix: fresh(2000) });
  assert.equal((await s.deviceLocation()).coords.accuracy, 2000);
  assert.equal(s.calls.removed, 1);
  await assert.rejects(s.deviceLocation({ precise: true }), /more accurate/);
  assert.equal(s.calls.removed, 2);
  for (const fix of [ { ...fresh(), timestamp: Date.now() - 180000 }, { ...fresh(), coords: { ...fresh().coords, latitude: NaN } }, fresh(-1), fresh(null)]) {
    await assert.rejects(sensor({ fix }).deviceLocation({ precise: true }));
  }
});

test('permission and services errors do not start sensors; silent resume never prompts', async () => {
  const blocked = sensor({ permission: { granted: false, canAskAgain: false } });
  await assert.rejects(blocked.deviceLocation(), /Settings/);
  assert.equal(blocked.calls.prompts, 0);
  assert.equal(blocked.calls.watches, 0);
  const prompt = sensor({ permission: { granted: false, canAskAgain: true } });
  await assert.rejects(prompt.deviceLocation({ prompt: false }), /permission/);
  assert.equal(prompt.calls.prompts, 0);
  await prompt.deviceLocation();
  assert.equal(prompt.calls.prompts, 1);
  const off = sensor({ enabled: false });
  await assert.rejects(off.deviceLocation(), /services are off/);
  assert.equal(off.calls.watches, 0);
  const silent = sensor();
  await silent.deviceLocation({ prompt: false });
  assert.equal(silent.calls.config.mayShowUserSettingsDialog, false);
});

test('cancel and timeout release even a subscription that registers late', async () => {
  for (const timeout of [false, true]) {
    const subscription = deferred();
    const s = sensor({ subscription, globals: timeout ? { setTimeout: callback => setTimeout(callback, 5) } : {} });
    const controller = new AbortController();
    const request = s.deviceLocation({ signal: controller.signal });
    await tick();
    if (!timeout) controller.abort();
    await assert.rejects(request, error => error.code === (timeout ? 'timeout' : 'cancelled'));
    subscription.resolve({ remove: () => s.calls.removed++ });
    await tick();
    assert.equal(s.calls.removed, 1);
    s.calls.success(fresh()); // A late native callback cannot revive the request.
  }
});

function provider({ savedCity = null, resolveContext = async () => ({ supported: true, municipality: 'Vaughan' }), storageRead } = {}) {
  const states = [], effects = [], calls = { requests: [], saved: [], reads: 0 };
  let listener, cleanup, interval;
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    createElement: (_type, props) => props.value,
    useState: initial => { const i = states.length; states.push(initial); return [initial, value => { states[i] = value; }]; },
    useRef: current => ({ current }),
    useEffect: callback => effects.push(callback),
  };
  const app = { currentState: 'active', addEventListener: (_name, cb) => { listener = cb; return { remove() {} }; } };
  const service = sensor();
  const mod = load('src/providers/location-provider.tsx', {
    react: { ...react, default: react }, 'react-native': { AppState: app },
    '@react-native-async-storage/async-storage': { __esModule: true, default: { getItem: async () => { calls.reads++; return storageRead ? storageRead.promise : savedCity; }, setItem: async (_key, city) => { calls.saved.push(city); } } },
    '@/src/services/location': load('src/services/location.ts'),
    '@/src/services/device-location': { ...service, deviceLocation: async options => { calls.requests.push(options); return fresh(); } },
    '@/src/services/api': { resolveLocationContext: resolveContext },
  }, { setInterval: cb => { interval = cb; return 1; }, clearInterval() {} });
  const context = mod.LocationProvider({ children: null });
  cleanup = effects[0]();
  return { context, states, calls, cleanup, interval, emit: state => { app.currentState = state; listener(state); } };
}

test('restart restores city without coordinates or a prompt; hydration cannot overwrite a newer choice', async () => {
  const p = provider({ savedCity: 'Ottawa' });
  await tick();
  assert.equal(p.states[0].city, 'Ottawa');
  assert.equal(p.states[0].latitude, undefined);
  assert.equal(p.calls.requests.length, 0);
  p.cleanup();
  const read = deferred();
  const q = provider({ storageRead: read });
  q.context.chooseMunicipality('Whitby');
  read.resolve('Ottawa');
  await tick();
  assert.equal(q.states[0].city, 'Whitby');
  assert.equal(q.calls.saved.at(-1), 'Whitby');
  q.cleanup();
});

test('background clears exact location and recovers through iOS inactive without another permission prompt', async () => {
  const p = provider();
  await p.context.useDeviceLocation();
  assert.equal(p.states[0].mode, 'gps');
  p.emit('inactive'); // Permission dialogs must not cancel the operation.
  assert.equal(p.states[0].mode, 'gps');
  p.emit('background');
  assert.equal(p.states[0].mode, 'manual');
  assert.equal(p.states[0].latitude, undefined);
  p.emit('inactive');
  p.emit('active');
  await tick();
  assert.equal(p.calls.requests.length, 2);
  assert.equal(p.calls.requests[1].prompt, false);
  assert.equal(p.states[0].mode, 'gps');
  p.context.chooseMunicipality('London');
  p.emit('background'); p.emit('active');
  await tick();
  assert.equal(p.calls.requests.length, 2);
  assert.ok(p.calls.saved.every(city => typeof city === 'string' && !city.includes('latitude')));
  p.cleanup();
});

test('manual choice and unmount beat late server responses; network failure preserves fallback and retry works', async () => {
  const response = deferred();
  const p = provider({ resolveContext: () => response.promise });
  const pending = p.context.useDeviceLocation();
  await tick();
  p.context.chooseMunicipality('Whitby');
  assert.equal(await pending, false);
  response.resolve({ supported: true, municipality: 'Vaughan' });
  await tick();
  assert.equal(p.states[0].city, 'Whitby');
  p.cleanup();
  let fail = true;
  const q = provider({ resolveContext: async () => { if (fail) throw new Error('offline'); return { supported: true, municipality: 'Ottawa' }; } });
  q.context.chooseMunicipality('London');
  assert.equal(await q.context.useDeviceLocation(), false);
  assert.equal(q.states[0].city, 'London');
  assert.equal(q.states[1], false);
  assert.equal(q.states[2], 'offline');
  fail = false;
  assert.equal(await q.context.useDeviceLocation(), true);
  assert.equal(q.states[0].city, 'Ottawa');
  assert.equal(q.states[2], null);
  q.cleanup();
});
