import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import {
  useFonts,
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
  Fraunces_400Regular_Italic,
  Fraunces_500Medium_Italic,
  Fraunces_600SemiBold_Italic,
} from '@expo-google-fonts/fraunces';
import {
  Outfit_400Regular,
  Outfit_500Medium,
  Outfit_600SemiBold,
  Outfit_700Bold,
  Outfit_800ExtraBold,
} from '@expo-google-fonts/outfit';
import { ScreenLoading } from '@/src/components/screen-state';
import { AuthProvider, useAuth } from '@/src/providers/auth-provider';
import { CultureProvider } from '@/src/providers/culture-provider';
import { LocationProvider } from '@/src/providers/location-provider';
import { SurpriseProvider } from '@/src/providers/surprise-provider';
import { Colors } from '@/src/theme/tokens';

function AppNavigator() {
  const { ready, user, profile, profileError } = useAuth();
  const router = useRouter();
  const segments = useSegments();
  const rootSegment = segments[0] ?? '';
  const memberRoute =
    rootSegment === '(tabs)' ||
    rootSegment === 'place' ||
    rootSegment === 'planner' ||
    rootSegment === 'tickets' ||
    rootSegment === 'cinema';

  useEffect(() => {
    if (!ready) return;

    // When the user is already authenticated with completed onboarding:
    // If they are on the initial landing screen (index) or auth screen, route directly to the main app tabs.
    if (user && profile?.completedAt) {
      if (rootSegment === '' || rootSegment === 'index' || rootSegment === 'auth') {
        router.replace('/(tabs)');
      }
      return;
    }

    // If user is authenticated but hasn't finished onboarding:
    if (user && !profile?.completedAt && !profileError) {
      if (rootSegment !== 'onboarding') {
        router.replace('/onboarding');
      }
      return;
    }

    // If unauthenticated user tries to navigate into member routes:
    if (!user && memberRoute) {
      router.replace('/');
    }
  }, [memberRoute, profile?.completedAt, profileError, ready, rootSegment, router, user]);

  if (!ready) {
    return (
      <View style={styles.loading}>
        <ScreenLoading label="Opening Echoo." />
      </View>
    );
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        contentStyle: { backgroundColor: Colors.background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="auth" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="place/[id]" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="planner" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
      <Stack.Screen name="tickets" options={{ presentation: 'card', animation: 'slide_from_right' }} />
      <Stack.Screen name="cinema" options={{ presentation: 'card', animation: 'slide_from_right' }} />
    </Stack>
  );
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    Fraunces_400Regular_Italic,
    Fraunces_500Medium_Italic,
    Fraunces_600SemiBold_Italic,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
    Outfit_800ExtraBold,
  });

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 60_000,
            refetchOnReconnect: true,
          },
        },
      })
  );

  if (!fontsLoaded && !fontError) {
    return (
      <View style={styles.loading}>
        <ScreenLoading label="Opening Echoo." />
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <LocationProvider>
              <CultureProvider>
                <StatusBar style="light" />
                <SurpriseProvider>
                  <AppNavigator />
                </SurpriseProvider>
              </CultureProvider>
            </LocationProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loading: {
    flex: 1,
    backgroundColor: Colors.background,
  },
});
