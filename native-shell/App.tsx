import { StatusBar } from "expo-status-bar";
import { BlurView } from "expo-blur";
import * as Linking from "expo-linking";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { WebView } from "react-native-webview";
import Svg, { Circle, Path } from "react-native-svg";
type RouteDestination = {
  id?: string;
  googlePlaceId?: string;
  name: string;
  address?: string;
  latitude: number;
  longitude: number;
};

type RoutePlan = {
  stops: RouteDestination[];
};

/**
 * The native shell deliberately renders Echoo's existing mobile interface.
 * Keep the web UI in the project root; do not duplicate its styles here.
 */
// Expo Go needs a usable app destination even before a developer adds a local
// LAN override. The environment value still wins for local device testing.
const ECHOO_WEB_URL =
  process.env.EXPO_PUBLIC_ECHOO_WEB_URL?.trim() ||
  "https://echoocity.com/events.html";

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
    var reportDetailSheetState = function () {
      var eventSheet = document.getElementById('detail-sheet');
      var placeSheet = document.getElementById('card-detail-modal');
      var quickPlanSheet = document.getElementById('quick-plan-modal');
      var culturePicker = document.getElementById('culture-picker');
      var isOpen = Boolean(
        (eventSheet && eventSheet.classList.contains('open')) ||
        (placeSheet && placeSheet.classList.contains('open')) ||
        (quickPlanSheet && quickPlanSheet.getAttribute('aria-hidden') === 'false') ||
        (culturePicker && culturePicker.classList.contains('is-open'))
      );
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage('echoo:detail-sheet:' + isOpen);
      }
    };
    var reportAccessState = function () {
      var state = document.documentElement.getAttribute('data-echoo-access');
      if (state && window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage('echoo:access:' + JSON.stringify({ state: state, url: window.location.href }));
      }
    };
    if (!window.__echooDetailSheetObserver) {
      window.__echooDetailSheetObserver = new MutationObserver(function () {
        reportDetailSheetState();
        reportAccessState();
      });
      window.__echooDetailSheetObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'aria-hidden', 'data-echoo-access'],
      });
    }
    reportDetailSheetState();
    reportAccessState();
    true;
  })();
`;

type TabKey = "home" | "discover" | "linkup" | "profile";

const NAVIGATION_ITEMS: ReadonlyArray<{
  key: TabKey;
  label: string;
  target: string;
}> = [
  { key: "home", label: "Home", target: "index.html" },
  { key: "discover", label: "Discover", target: "events.html" },
  { key: "linkup", label: "Link Up", target: "linkup.html" },
  { key: "profile", label: "Profile", target: "auth.html" },
];

function pathnameFor(url: string) {
  try {
    return new URL(url).pathname.replace(/\/$/, "");
  } catch {
    return "";
  }
}

function activeTabFor(url: string): TabKey | null {
  const path = pathnameFor(url);

  if (path === "" || path === "/index" || path === "/index.html") return "home";
  if (
    [
      "/events",
      "/events.html",
      "/music.html",
      "/food.html",
      "/culture.html",
      "/films.html",
      "/dates.html",
    ].includes(path)
  ) {
    return "discover";
  }
  if (path === "/tickets" || path === "/tickets.html") return null;
  if (path === "/linkup" || path.startsWith("/linkup")) return "linkup";
  if (["/auth", "/auth.html"].includes(path)) {
    return "profile";
  }

  return null;
}

function NavigationIcon({ active, tab }: { active: boolean; tab: TabKey }) {
  const color = active ? "#f7d5b2" : "rgba(248, 245, 239, 0.62)";
  const fill = active ? color : "none";
  const strokeWidth = active ? 0 : 1.8;

  if (tab === "home") {
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

  if (tab === "discover") {
    return (
      <Svg width={27} height={27} viewBox="0 0 24 24" fill={fill}>
        <Circle
          cx="11"
          cy="11"
          r="7"
          stroke={color}
          strokeWidth={strokeWidth}
        />
        <Path
          d="m16 16 4 4"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      </Svg>
    );
  }

  if (tab === "linkup") {
    return (
      <Svg width={27} height={27} viewBox="0 0 24 24" fill={fill}>
        <Path
          d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
    const path = new URL(url).pathname.replace(/\/$/, "");
    return (
      path === "" ||
      path === "/index" ||
      path === "/index.html" ||
      path === "/events" ||
      path === "/events.html"
    );
  } catch {
    return true;
  }
}

function googleRouteUrlFor(destination: RouteDestination) {
  const target = `${destination.latitude},${destination.longitude}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(target)}&dir_action=navigate`;
}

function appleRouteUrlFor(destination: RouteDestination) {
  const target = `${destination.latitude},${destination.longitude}`;
  return `maps://?daddr=${encodeURIComponent(target)}&dirflg=d`;
}

function startNavigation(destination: RouteDestination) {
  // iOS gets the installed Apple Maps app directly; Android gets Google Maps
  // navigation. The HTTPS Google URL is retained as a safe fallback.
  const primary =
    Platform.OS === "ios"
      ? appleRouteUrlFor(destination)
      : googleRouteUrlFor(destination);
  return Linking.openURL(primary).catch(() =>
    Linking.openURL(googleRouteUrlFor(destination)),
  );
}

function parseRouteDestination(value: string): RouteDestination | null {
  try {
    const payload = JSON.parse(value) as Partial<RouteDestination>;
    const latitude = Number(payload.latitude);
    const longitude = Number(payload.longitude);
    if (
      !payload.name ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    )
      return null;
    return {
      id: typeof payload.id === "string" ? payload.id : undefined,
      googlePlaceId:
        typeof payload.googlePlaceId === "string"
          ? payload.googlePlaceId
          : undefined,
      name: String(payload.name).slice(0, 160),
      address:
        typeof payload.address === "string"
          ? payload.address.slice(0, 300)
          : undefined,
      latitude,
      longitude,
    };
  } catch {
    return null;
  }
}

function parseRoutePlan(value: string): RoutePlan | null {
  try {
    const payload = JSON.parse(value) as { stops?: unknown };
    if (!Array.isArray(payload.stops)) return null;
    const stops = payload.stops
      .map((stop) => parseRouteDestination(JSON.stringify(stop)))
      .filter((stop): stop is RouteDestination => stop !== null)
      .slice(0, 3);
    return stops.length >= 1 ? { stops } : null;
  } catch {
    return null;
  }
}

type LinkupMessage = { type: "badge"; count: number } | { type: "open-chat" };

function parseLinkupMessage(value: string): LinkupMessage | null {
  try {
    const payload = JSON.parse(value) as { type?: unknown };
    if (payload.type === "badge") {
      return {
        type: "badge",
        count: Number((payload as { count?: unknown }).count) || 0,
      };
    }
    if (payload.type === "open-chat") return { type: "open-chat" };
    return null;
  } catch {
    return null;
  }
}

function EchooShell() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [currentUrl, setCurrentUrl] = useState(ECHOO_WEB_URL ?? "");
  const [isDetailSheetOpen, setIsDetailSheetOpen] = useState(false);
  const [linkupBadge, setLinkupBadge] = useState(0);
  const [isAppAccessReady, setIsAppAccessReady] = useState(false);

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

  // Discover is the root of the app. A redirect or a prior browser session
  // must never make a Back control appear over its header.
  const showBackButton = isAppAccessReady && !isEchooHome(currentUrl);
  const activeTab = activeTabFor(currentUrl);

  useEffect(() => {
    if (Platform.OS !== "android") return undefined;

    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        if (!showBackButton) return false;
        goBack();
        return true;
      },
    );

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
        originWhitelist={["http://*", "https://*"]}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
        // The shell intentionally has no durable browser storage. Echoo's
        // auth token lives in sessionStorage, so closing the app requires a
        // new sign-in while a foreground session remains uninterrupted.
        incognito
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
          if (pathnameFor(navigation.url) !== pathnameFor(currentUrl)) {
            setIsAppAccessReady(false);
          }
          setCurrentUrl(navigation.url);
          setIsDetailSheetOpen(false);
        }}
        onMessage={(event) => {
          const message = event.nativeEvent.data;
          if (message.startsWith("echoo:access:")) {
            try {
              const access = JSON.parse(message.slice("echoo:access:".length));
              if (pathnameFor(access.url) !== pathnameFor(currentUrl)) return;
              setIsAppAccessReady(access.state === "ready");
            } catch {
              setIsAppAccessReady(false);
            }
            return;
          }
          if (message.startsWith("echoo:route-plan:")) {
            const plan = parseRoutePlan(
              message.slice("echoo:route-plan:".length),
            );
            if (!plan) return;
            // A route should begin immediately at the first planned stop.
            // Apple Maps does not support reliable multi-stop deep links, so
            // this deliberately starts turn-by-turn navigation at stop one.
            startNavigation(plan.stops[0]).catch(() => undefined);
            return;
          }
          if (message.startsWith("echoo:route:")) {
            const destination = parseRouteDestination(
              message.slice("echoo:route:".length),
            );
            if (!destination) return;
            startNavigation(destination).catch(() => undefined);
            return;
          }
          if (message.startsWith("echoo:linkup:")) {
            const payload = parseLinkupMessage(
              message.slice("echoo:linkup:".length),
            );
            if (!payload) return;
            if (payload.type === "badge") {
              setLinkupBadge(Math.max(0, Number(payload.count) || 0));
            }
            return;
          }
          if (message === "echoo:detail-sheet:true") {
            setIsDetailSheetOpen(true);
          }
          if (message === "echoo:detail-sheet:false") {
            setIsDetailSheetOpen(false);
          }
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
          <Text aria-hidden style={styles.backChevron}>
            ‹
          </Text>
          <Text style={styles.backLabel}>Back</Text>
        </Pressable>
      ) : null}
      {isAppAccessReady && activeTab && !isDetailSheetOpen ? (
        <BlurView intensity={30} tint="dark" style={styles.nativeBottomNav}>
          {NAVIGATION_ITEMS.map((item) => {
            const active = item.key === activeTab;
            const showBadge = item.key === "linkup" && linkupBadge > 0;
            return (
              <Pressable
                key={item.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                accessibilityLabel={item.label}
                onPress={() => navigateToTab(item.target)}
                style={styles.nativeNavItem}
              >
                <View style={styles.nativeNavIconWrap}>
                  <NavigationIcon active={active} tab={item.key} />
                  {showBadge ? <View style={styles.linkupBadgeDot} /> : null}
                </View>
                <Text
                  style={[
                    styles.nativeNavLabel,
                    active && styles.nativeNavLabelActive,
                  ]}
                >
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

export default function App() {
  return <EchooShell />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  webView: {
    flex: 1,
    backgroundColor: "#000",
  },
  loading: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  backButton: {
    position: "absolute",
    top: 92,
    left: 22,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
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
    color: "#f8f5ef",
    fontSize: 32,
    fontWeight: "300",
    lineHeight: 32,
  },
  backLabel: {
    color: "#f8f5ef",
    fontSize: 16,
    fontWeight: "600",
  },
  nativeBottomNav: {
    position: "absolute",
    right: 26,
    bottom: 12,
    left: 26,
    zIndex: 20,
    minHeight: 72,
    flexDirection: "row",
    alignItems: "stretch",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(248, 245, 239, 0.06)",
    borderRadius: 28,
    backgroundColor: "rgba(25, 25, 24, 0.82)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.42,
    shadowRadius: 22,
    elevation: 14,
  },
  nativeNavItem: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingTop: 10,
    paddingBottom: 8,
  },
  nativeNavLabel: {
    color: "rgba(248, 245, 239, 0.62)",
    fontSize: 12,
    fontWeight: "600",
  },
  nativeNavLabelActive: {
    color: "#f7d5b2",
  },
  nativeNavIconWrap: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  linkupBadgeDot: {
    position: "absolute",
    top: -1,
    right: -6,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#f7d5b2",
    borderWidth: 1.5,
    borderColor: "rgba(25, 25, 24, 0.92)",
  },
  configurationScreen: {
    flex: 1,
    padding: 32,
    justifyContent: "center",
    backgroundColor: "#000",
  },
  title: {
    color: "#f8f5ef",
    fontSize: 24,
    fontWeight: "700",
    marginBottom: 12,
  },
  copy: {
    color: "#aaa29a",
    fontSize: 16,
    lineHeight: 23,
  },
});
