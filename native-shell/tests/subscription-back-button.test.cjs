const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function loadScreen(user, access, options = {}) {
  let signOutCalled = false;
  const routerCalls = [];
  const mockRouter = {
    back: () => routerCalls.push({ action: 'back' }),
    replace: (target) => routerCalls.push({ action: 'replace', target: JSON.parse(JSON.stringify(target)) }),
    push: (target) => routerCalls.push({ action: 'push', target }),
    canGoBack: () => options.canGoBack ?? false,
  };

  const compiled = ts.transpileModule(readFileSync(path.join(__dirname, '../app/subscription.tsx'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;

  const mockReact = {
    useEffect: (fn, deps) => {},
    useRef: (init) => ({ current: init }),
    useState: (init) => [init, () => {}],
  };

  const mockReactNative = {
    ActivityIndicator: () => null,
    Alert: { alert: () => {} },
    Image: () => null,
    Platform: { OS: 'ios' },
    Pressable: (props) => {
      if (props.accessibilityLabel === 'Back to homescreen and sign in' && !renderedElements.backButton) {
        renderedElements.backButton = props;
      }
      return null;
    },
    ScrollView: (props) => props.children,
    StyleSheet: { create: (s) => s },
    Text: (props) => {
      if (props.children === 'Back to homescreen & sign in') {
        renderedElements.bottomBackLink = true;
      }
      return null;
    },
    View: (props) => props.children,
  };

  const renderedElements = { backButton: null, bottomBackLink: false };

  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      if (name === 'react/jsx-runtime') {
        const h = (type, props) => {
          if (props?.accessibilityLabel === 'Back to homescreen and sign in' && !renderedElements.backButton) {
            renderedElements.backButton = props;
          }
          if (props?.accessibilityLabel === 'Back to homescreen and sign in (footer)' && !renderedElements.bottomBackPressable) {
            renderedElements.bottomBackPressable = props;
          }
          if (props?.children === 'Back to homescreen & sign in') {
            renderedElements.bottomBackLink = true;
          }
          if (typeof type === 'function') return type(props);
          return { type, props };
        };
        return { jsx: h, jsxs: h, Fragment: ({ children }) => children };
      }
      if (name === 'react') return mockReact;
      if (name === 'react-native') return mockReactNative;
      if (name === 'expo-linear-gradient') return { LinearGradient: (props) => props.children };
      if (name === 'expo-router') return { useRouter: () => mockRouter };
      if (name === 'react-native-safe-area-context') return { useSafeAreaInsets: () => ({ top: 44, bottom: 34 }) };
      if (name === 'lucide-react-native') return { ArrowLeft: () => null, Check: () => null };
      if (name === '@/src/components/legal-links') return { LegalLinks: () => null };
      if (name === '@/src/providers/auth-provider') return {
        useAuth: () => ({
          user,
          signOut: async () => { signOutCalled = true; },
        }),
      };
      if (name === '@/src/providers/subscription-provider') return {
        useSubscription: () => ({ access, refresh: async () => access }),
      };
      if (name === '@/src/services/subscriptions') return {
        isExpoGo: true,
        loadSubscriptionPackages: async () => ({}),
        purchaseSubscription: async () => {},
        purchasesAvailable: false,
        restoreSubscriptions: async () => {},
        syncSubscription: async () => {},
      };
      if (name === '@/src/theme/tokens') return { Fonts: { ui: 'ui', uiSemiBold: 'uiSemiBold' } };
      return {};
    },
    Error,
    console,
  });

  const SubscriptionScreen = exports.default;
  SubscriptionScreen();

  return {
    renderedElements,
    getSignOutCalled: () => signOutCalled,
    routerCalls,
  };
}

test('subscription page renders top back button and bottom back link', () => {
  const { renderedElements } = loadScreen({ id: 'user-1' }, { active: false });
  assert.ok(renderedElements.backButton, 'top back button should be rendered');
  assert.equal(renderedElements.bottomBackLink, true, 'bottom back link should be rendered');
});

test('unsubscribed user pressing back signs out and redirects to home with auth=open', async () => {
  const { renderedElements, getSignOutCalled, routerCalls } = loadScreen({ id: 'user-1' }, { active: false });
  assert.ok(renderedElements.backButton);
  await renderedElements.backButton.onPress();
  assert.equal(getSignOutCalled(), true, 'signOut should be called for unsubscribed user');
  assert.deepEqual(JSON.parse(JSON.stringify(routerCalls)), [
    { action: 'replace', target: { pathname: '/', params: { auth: 'open' } } },
  ]);
});

test('subscribed user pressing back navigates back without signing out', async () => {
  const { renderedElements, getSignOutCalled, routerCalls } = loadScreen({ id: 'user-1' }, { active: true }, { canGoBack: true });
  assert.ok(renderedElements.backButton);
  await renderedElements.backButton.onPress();
  assert.equal(getSignOutCalled(), false, 'signOut must NOT be called for subscribed user');
  assert.deepEqual(routerCalls, [{ action: 'back' }]);
});

test('subscribed user pressing back navigates to tabs if cannot go back', async () => {
  const { renderedElements, getSignOutCalled, routerCalls } = loadScreen({ id: 'user-1' }, { active: true }, { canGoBack: false });
  assert.ok(renderedElements.backButton);
  await renderedElements.backButton.onPress();
  assert.equal(getSignOutCalled(), false, 'signOut must NOT be called for subscribed user');
  assert.deepEqual(routerCalls, [{ action: 'replace', target: '/(tabs)' }]);
});

test('unsubscribed user pressing bottom back link signs out and redirects to home with auth=open', async () => {
  const { renderedElements, getSignOutCalled, routerCalls } = loadScreen({ id: 'user-1' }, { active: false });
  assert.ok(renderedElements.bottomBackPressable, 'bottom back pressable should be captured');
  await renderedElements.bottomBackPressable.onPress();
  assert.equal(getSignOutCalled(), true);
  assert.deepEqual(JSON.parse(JSON.stringify(routerCalls)), [
    { action: 'replace', target: { pathname: '/', params: { auth: 'open' } } },
  ]);
});
