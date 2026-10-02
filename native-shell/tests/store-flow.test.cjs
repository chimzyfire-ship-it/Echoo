const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, modules, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(path.join(__dirname, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, require: name => {
    assert.ok(name in modules, `Unexpected import: ${name}`); return modules[name];
  }, URL, URLSearchParams, AbortSignal, ...globals });
  return exports;
}

function billing(sdk, session) {
  let syncs = 0;
  const service = load('../src/services/subscriptions.ts', {
    'expo-constants': { default: { appOwnership: 'standalone' } },
    'react-native': { Platform: { OS: 'ios' } },
    'react-native-purchases': { __esModule: true, default: sdk },
    './supabase': { supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: session.id } } } }) } } },
    './api': { edgeRequest: async () => { syncs++; return { active: true }; } }, './request': {},
  }, { process: { env: { EXPO_PUBLIC_REVENUECAT_IOS_KEY: 'appl_test' } } });
  return { service, syncs: () => syncs };
}

test('successful store purchase and restore both verify access on the server', async () => {
  const operations = [];
  const { service, syncs } = billing({
    configure: config => operations.push(config.appUserID), getAppUserID: async () => 'a',
    purchasePackage: async () => operations.push('purchase'), restorePurchases: async () => operations.push('restore'),
  }, { id: 'a' });
  assert.equal((await service.purchaseSubscription('a', {})).active, true);
  await service.restoreSubscriptions('a');
  assert.deepEqual(operations, ['a', 'purchase', 'restore']); assert.equal(syncs(), 2);
});

test('account change during SDK login prevents charging the new account', async () => {
  const session = { id: 'a' };
  const { service, syncs } = billing({
    configure: () => {}, getAppUserID: async () => 'other', logIn: async () => { session.id = 'b'; },
    getOfferings: async () => ({}), purchasePackage: () => assert.fail('must not purchase'),
  }, session);
  await service.loadSubscriptionPackages('a');
  await assert.rejects(service.purchaseSubscription('a', {}), /account changed/);
  assert.equal(syncs(), 0);
});

test('cancelled and pending purchases never grant client access', async () => {
  let code = '1';
  const { service, syncs } = billing({
    configure: () => {}, getAppUserID: async () => 'a',
    purchasePackage: async () => { throw { code }; },
  }, { id: 'a' });
  await assert.rejects(service.purchaseSubscription('a', {}), error => error.code === '1');
  code = '20';
  await assert.rejects(service.purchaseSubscription('a', {}), error => error.code === '20');
  assert.equal(syncs(), 0);
});

function appleRevoke(subject, revokedOK = true) {
  const calls = [];
  class SignJWT {
    setProtectedHeader() { return this; } setIssuer() { return this; } setSubject() { return this; }
    setAudience() { return this; } setIssuedAt() { return this; } setExpirationTime() { return this; }
    async sign() { return 'secret'; }
  }
  const service = load('../../supabase/functions/_shared/apple-revoke.ts', {
    'https://esm.sh/jose@5.9.6': {
      createRemoteJWKSet: () => ({}), importPKCS8: async () => ({}), SignJWT,
      jwtVerify: async () => ({ payload: { sub: subject } }),
    },
  }, {
    Deno: { env: { get: () => 'configured' } },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return url.endsWith('/token') ? { ok: true, json: async () => ({ id_token: 'id', refresh_token: 'refresh' }) } : { ok: revokedOK };
    },
  });
  return { ...service, calls };
}

test('Apple deletion refuses authorization for a different Apple account', async () => {
  const service = appleRevoke('other-account');
  await assert.rejects(service.revokeAppleAccount('code', 'expected-account'), /does not match/);
  assert.equal(service.calls.length, 1);
});

test('Apple deletion revokes the verified token and propagates revocation failures', async () => {
  const service = appleRevoke('expected');
  await service.revokeAppleAccount('code', 'expected');
  assert.equal(service.calls[1].options.body.get('token'), 'refresh');
  await assert.rejects(appleRevoke('expected', false).revokeAppleAccount('code', 'expected'), /revocation failed/);
});
