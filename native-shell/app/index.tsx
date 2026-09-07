import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowRight } from 'lucide-react-native';
import React from 'react';
import { ImageBackground, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { BrandMark } from '@/src/components/brand-mark';
import { LandingAuth } from '@/src/components/landing-auth';
import { useAuth } from '@/src/providers/auth-provider';
import { useSurprise } from '@/src/providers/surprise-provider';
import { Colors, Fonts } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

type LandingActionProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
};

function LandingAction({ label, onPress, variant = 'primary' }: LandingActionProps) {
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void triggerHaptic.light();
        onPress();
      }}
      style={({ pressed }) => [
        styles.action,
        isPrimary ? styles.primaryAction : styles.secondaryAction,
        pressed && styles.actionPressed,
      ]}
    >
      <Text style={[styles.actionLabel, isPrimary ? styles.primaryActionLabel : styles.secondaryActionLabel]}>
        {label}
      </Text>
      <ArrowRight
        size={20}
        color={isPrimary ? Colors.inkDark : Colors.ink}
        style={styles.actionArrow}
      />
    </Pressable>
  );
}

export default function LandingScreen() {
  const router = useRouter();
  const { auth, mode } = useLocalSearchParams<{ auth?: string; mode?: string }>();
  const { height } = useWindowDimensions();
  const { user, profile, ready } = useAuth();
  const surprise = useSurprise();

  function handleSignInPress() {
    if (!ready) return;
    if (user) {
      router.replace(profile?.completedAt ? '/(tabs)' : '/onboarding');
      return;
    }
    router.setParams({ auth: 'open' });
  }

  return (
    <ImageBackground
      source={require('../assets/new-use1.png')}
      resizeMode="cover"
      style={styles.background}
    >
      <LinearGradient
        colors={[
          'rgba(4, 4, 6, 0.40)',
          'rgba(4, 4, 6, 0.52)',
          'rgba(4, 4, 6, 0.88)',
          'rgba(4, 4, 6, 0.98)',
        ]}
        locations={[0, 0.35, 0.72, 0.98]}
        style={styles.overlay}
      >
        <KeyboardAvoidingView style={styles.scroll} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={styles.scroll}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={[styles.content, { minHeight: Math.max(height, 700) }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          {/* Centered Brand Mark at Top */}
          <View style={styles.topBar}>
            <BrandMark size="large" />
          </View>

          {/* Hero Typography and CTA Buttons matching IMG_0562 */}
          <View style={styles.hero}>
            <View style={styles.heroCopy}>
              <Text style={styles.kicker}>THE GTA · TONIGHT</Text>
              <Text style={styles.headline}>
                {"Don't waste\nthe "}
                <Text style={styles.headlineAccent}>night.</Text>
              </Text>
              <Text style={styles.description}>
                Tables, sets, and spots the city actually loves — before the group chat decides.
              </Text>
            </View>

            <View style={styles.actions}>
              <LandingAction label="Surprise me" onPress={surprise.start} />
              {user ? (
                <LandingAction label="Open Echoo" onPress={handleSignInPress} variant="secondary" />
              ) : (
                <LandingAuth
                  open={auth === 'open'}
                  initialMode={mode === 'signup' ? 'signup' : 'signin'}
                  onOpen={handleSignInPress}
                  onClose={() => router.setParams({ auth: '', mode: '' })}
                />
              )}
            </View>
          </View>

          {/* Legal Footer matching IMG_0562 */}
          <View style={styles.footerWrap}>
            <View style={styles.legalLinks}>
              <Text style={styles.legalLink}>Privacy</Text>
              <Text style={styles.legalLink}>Terms</Text>
            </View>
            <Text style={styles.copyright}>
              Copyright © 2026 Idris Oyejobi. All rights reserved.
            </Text>
          </View>
        </ScrollView>
        </KeyboardAvoidingView>
      </LinearGradient>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  overlay: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 36,
    paddingBottom: 28,
    justifyContent: 'space-between',
  },
  topBar: {
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  hero: {
    flex: 1,
    justifyContent: 'center',
    paddingTop: 40,
    paddingBottom: 30,
    gap: 36,
  },
  heroCopy: {
    alignItems: 'center',
  },
  kicker: {
    color: 'rgba(248, 245, 239, 0.65)',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 2.2,
    textAlign: 'center',
    textTransform: 'uppercase',
  },
  headline: {
    marginTop: 18,
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 50,
    fontWeight: '600',
    letterSpacing: -2.0,
    lineHeight: 54,
    textAlign: 'center',
  },
  headlineAccent: {
    color: '#E7C98E',
    fontFamily: Fonts.displayItalic,
    fontStyle: 'italic',
  },
  description: {
    maxWidth: 320,
    marginTop: 20,
    color: 'rgba(248, 245, 239, 0.85)',
    fontFamily: Fonts.ui,
    fontSize: 16,
    lineHeight: 25,
    textAlign: 'center',
  },
  actions: {
    gap: 12,
    maxWidth: 340,
    width: '100%',
    alignSelf: 'center',
  },
  action: {
    minHeight: 56,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    paddingHorizontal: 28,
    position: 'relative',
  },
  primaryAction: {
    backgroundColor: '#E5C9A7',
    borderColor: '#E5C9A7',
  },
  secondaryAction: {
    backgroundColor: 'rgba(20, 19, 18, 0.72)',
    borderColor: 'rgba(248, 245, 239, 0.22)',
  },
  actionLabel: {
    fontFamily: Fonts.uiSemiBold,
    fontSize: 17,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  primaryActionLabel: {
    color: '#141311',
  },
  secondaryActionLabel: {
    color: '#F8F5EF',
  },
  actionArrow: {
    position: 'absolute',
    right: 22,
  },
  actionPressed: {
    opacity: 0.86,
    transform: [{ scale: 0.985 }],
  },
  footerWrap: {
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
  },
  legalLinks: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  legalLink: {
    color: 'rgba(248, 245, 239, 0.52)',
    fontFamily: Fonts.ui,
    fontSize: 12,
  },
  copyright: {
    color: 'rgba(248, 245, 239, 0.40)',
    fontFamily: Fonts.ui,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
  },
});
