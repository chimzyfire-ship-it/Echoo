import { StatusBar } from 'expo-status-bar';
import { BlurView } from 'expo-blur';
import * as Linking from 'expo-linking';
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { WebView } from 'react-native-webview';
import Svg, { Circle, Path } from 'react-native-svg';

/**
 * The native shell deliberately renders Echoo's existing mobile interface.
 * Keep the web UI in the project root; do not duplicate its styles here.
 */
const ECHOO_WEB_URL = process.env.EXPO_PUBLIC_ECHOO_WEB_URL;

const MOBILE_CHROME_SCRIPT = `
  (function () {
    if (!document.getElementById('echoo-native-mobile-chrome')) {
      var style = document.createElement('style');
      style.id = 'echoo-native-mobile-chrome';
      style.textContent =
        '.profile-link { display: none !important; }' +
        '.bottom-nav { display: none !important; }';
      (document.head || document.documentElement).appendChild(style);
    }
    true;
  })();
`;

type TabKey = 'home' | 'discover' | 'tickets' | 'profile';

const NAVIGATION_ITEMS: ReadonlyArray<{
  key: TabKey;
  label: string;
  target: string;
}> = [
  { key: 'home', label: 'Home', target: 'index.html' },
  { key: 'discover', label: 'Discover', target: 'events.html' },
  { key: 'tickets', label: 'Tickets', target: 'tickets.html' },
  { key: 'profile', label: 'Profile', target: 'auth.html' },
];

function pathnameFor(url: string) {
  try {
    return new URL(url).pathname.replace(/\/$/, '');
  } catch {
    return '';
  }
}

function activeTabFor(url: string): TabKey | null {
  const path = pathnameFor(url);

  if (path === '' || path === '/index' || path === '/index.html') return 'home';
  if (
    [
      '/events',
      '/events.html',
      '/music.html',
      '/food.html',
      '/films.html',
      '/dates.html',
    ].includes(path)
  ) {
    return 'discover';
  }
  if (path === '/tickets' || path === '/tickets.html') return 'tickets';
  if (['/auth', '/auth.html'].includes(path)) {
    return 'profile';
  }

  return null;
}

function NavigationIcon({ active, tab }: { active: boolean; tab: TabKey }) {
  const color = active ? '#f7d5b2' : 'rgba(248, 245, 239, 0.62)';
  const fill = active ? color : 'none';
  const strokeWidth = active ? 0 : 1.8;

  if (tab === 'home') {
    return (
      <Svg width={27} height={27} viewBox="0 0 24 24" fill={fill}>
        <Path
          d="M3 11.5 12 4l9 7.5V21h-6v-6H9v6H3Z"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }

  if (tab === 'discover') {
    return (
      <Svg width={27} height={27} viewBox="0 0 24 24" fill={fill}>
        <Circle cx="11" cy="11" r="7" stroke={color} strokeWidth={strokeWidth} />
        <Path
          d="m16 16 4 4"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      </Svg>
    );
  }

  if (tab === 'tickets') {
    return (
      <Svg width={27} height={27} viewBox="0 0 24 24" fill={fill}>
        <Path
          d="M3 9a3 3 0 0 0 0 6v3h18v-3a3 3 0 0 0 0-6V6H3Z"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path d="M13 6v12" stroke={color} strokeWidth={strokeWidth} />
      </Svg>
    );
  }

  return (
    <Svg width={27} height={27} viewBox="0 0 24 24" fill={fill}>
      <Circle cx="12" cy="8" r="4" stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="M4 21a8 8 0 0 1 16 0"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function isInternalEchooLink(url: string) {
  if (!ECHOO_WEB_URL) return false;

  try {
    return new URL(url).origin === new URL(ECHOO_WEB_URL).origin;
  } catch {
    return false;
  }
}

function isEchooHome(url: string) {
  if (!ECHOO_WEB_URL) return true;

  try {
    const path = new URL(url).pathname.replace(/\/$/, '');
    return path === '' || path === '/index' || path === '/index.html';
  } catch {
    return true;
  }
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(ECHOO_WEB_URL ?? '');

  const returnToHome = useCallback(() => {
    if (!ECHOO_WEB_URL) return;

    webViewRef.current?.injectJavaScript(
      `window.location.replace(${JSON.stringify(ECHOO_WEB_URL)}); true;`,
    );
  }, []);

  const goBack = useCallback(() => {
    if (canGoBack) {
      webViewRef.current?.goBack();
      return;
    }

    // A direct link has no WebView history. In that case, the only correct
    // destination is Echoo home rather than a blank screen or external page.
    returnToHome();
  }, [canGoBack, returnToHome]);

  const navigateToTab = useCallback(
    (target: string) => {
      if (!ECHOO_WEB_URL) return;

      const destination = new URL(target, ECHOO_WEB_URL).toString();
      if (pathnameFor(destination) === pathnameFor(currentUrl)) return;

      webViewRef.current?.injectJavaScript(
        `window.location.assign(${JSON.stringify(destination)}); true;`,
      );
    },
    [currentUrl],
  );

  // Home is the root of the app. A redirect or a prior browser session must
  // never make a Back control appear over its header.
  const showBackButton = !isEchooHome(currentUrl);
  const activeTab = activeTabFor(currentUrl);

  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!showBackButton) return false;
      goBack();
      return true;
    });

    return () => subscription.remove();
  }, [goBack, showBackButton]);

  if (!ECHOO_WEB_URL) {
    return (
      <View style={styles.configurationScreen}>
        <Text style={styles.title}>Echoo mobile shell</Text>
        <Text style={styles.copy}>
          Set EXPO_PUBLIC_ECHOO_WEB_URL to the secure development address before
          opening this build on a device.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <WebView
        ref={webViewRef}
        source={{ uri: ECHOO_WEB_URL }}
        style={styles.webView}
        originWhitelist={['http://*', 'https://*']}
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        allowsBackForwardNavigationGestures
        setSupportMultipleWindows={false}
        injectedJavaScriptBeforeContentLoaded={MOBILE_CHROME_SCRIPT}
        injectedJavaScript={MOBILE_CHROME_SCRIPT}
        startInLoadingState
        renderLoading={() => (
          <View style={styles.loading}>
            <ActivityIndicator color="#f7d5b2" />
          </View>
        )}
        onShouldStartLoadWithRequest={(request) => {
          if (isInternalEchooLink(request.url)) return true;

          // Uber, Apple Maps, Google Maps, WhatsApp, and other outbound links
          // leave the app through the operating system rather than an in-app tab.
          Linking.openURL(request.url).catch(() => undefined);
          return false;
        }}
        onNavigationStateChange={(navigation) => {
          setCanGoBack(navigation.canGoBack);
          setCurrentUrl(navigation.url);
        }}
      />
      {showBackButton ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={8}
          onPress={goBack}
          style={({ pressed }) => [
            styles.backButton,
            pressed && styles.backButtonPressed,
          ]}
        >
          <Text aria-hidden style={styles.backChevron}>‹</Text>
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
      ) : null}
      {activeTab ? (
        <BlurView intensity={30} tint="dark" style={styles.nativeBottomNav}>
          {NAVIGATION_ITEMS.map((item) => {
            const active = item.key === activeTab;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={item.label}
                onPress={() => navigateToTab(item.target)}
                style={styles.nativeNavItem}
              >
                <NavigationIcon active={active} tab={item.key} />
                <Text style={[styles.nativeNavLabel, active && styles.nativeNavLabelActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </BlurView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
  },
  webView: {
    flex: 1,
    backgroundColor: '#000',
  },
  loading: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  backButton: {
    position: 'absolute',
    top: 92,
    left: 22,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 36,
    paddingVertical: 4,
    paddingRight: 8,
  },
  backButtonPressed: {
    opacity: 0.72,
  },
  backChevron: {
    marginTop: -3,
    marginRight: 4,
    color: '#f8f5ef',
    fontSize: 32,
    fontWeight: '300',
    lineHeight: 32,
  },
  backLabel: {
    color: '#f8f5ef',
    fontSize: 16,
    fontWeight: '600',
  },
  nativeBottomNav: {
    position: 'absolute',
    right: 26,
    bottom: 12,
    left: 26,
    zIndex: 20,
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'stretch',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.06)',
    borderRadius: 28,
    backgroundColor: 'rgba(25, 25, 24, 0.82)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.42,
    shadowRadius: 22,
    elevation: 14,
  },
  nativeNavItem: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingTop: 10,
    paddingBottom: 8,
  },
  nativeNavLabel: {
    color: 'rgba(248, 245, 239, 0.62)',
    fontSize: 12,
    fontWeight: '600',
  },
  nativeNavLabelActive: {
    color: '#f7d5b2',
  },
  configurationScreen: {
    flex: 1,
    padding: 32,
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  title: {
    color: '#f8f5ef',
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 12,
  },
  copy: {
    color: '#aaa29a',
    fontSize: 16,
    lineHeight: 23,
  },
});
