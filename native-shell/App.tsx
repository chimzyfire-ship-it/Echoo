import { StatusBar } from 'expo-status-bar';
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

/**
 * The native shell deliberately renders Echoo's existing mobile interface.
 * Keep the web UI in the project root; do not duplicate its styles here.
 */
const ECHOO_WEB_URL = process.env.EXPO_PUBLIC_ECHOO_WEB_URL;

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

  const showBackButton = canGoBack || !isEchooHome(currentUrl);

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
    top: 54,
    left: 18,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.18)',
    borderRadius: 20,
    backgroundColor: 'rgba(5, 5, 5, 0.78)',
  },
  backButtonPressed: {
    opacity: 0.72,
  },
  backChevron: {
    marginTop: -2,
    marginRight: 5,
    color: '#f8f5ef',
    fontSize: 28,
    fontWeight: '400',
    lineHeight: 28,
  },
  backLabel: {
    color: '#f8f5ef',
    fontSize: 14,
    fontWeight: '700',
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
