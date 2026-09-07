import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeOut, useReducedMotion } from 'react-native-reanimated';

import { DieScene } from '@/src/components/surprise/die-scene';
import { useSurprise } from '@/src/providers/surprise-provider';
import { Colors, Fonts } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

export function SurpriseOverlay() {
  const { phase, city, timeLabel, cancel, handleRollStart, handleRollEnd } = useSurprise();
  const reducedMotion = useReducedMotion();
  const [fullMotion, setFullMotion] = useState(false);
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sceneSize = Math.min(320, width - 32, height * 0.46);

  useEffect(() => {
    if (phase === 'idle') setFullMotion(false);
  }, [phase]);

  // Android back during the roll cancels the surprise instead of leaving the app.
  useEffect(() => {
    if (phase === 'idle') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      cancel();
      return true;
    });
    return () => subscription.remove();
  }, [phase, cancel]);

  if (phase === 'idle') return null;

  const copy =
    phase === 'matching' || phase === 'settling' || phase === 'closing'
      ? `Matching ${city}, your preferences, and ${timeLabel}.`
      : `Checking ${city}, your taste, and ${timeLabel}.`;

  function handleScrimTap() {
    triggerHaptic.light();
    cancel();
  }

  return (
    <Animated.View style={styles.root} entering={FadeIn.duration(220)} exiting={FadeOut.duration(200)}>
      <Pressable
        style={styles.scrim}
        onPress={handleScrimTap}
        accessibilityLabel="Cancel surprise"
        accessibilityRole="button"
      />

      <View style={styles.stage} pointerEvents="none">
        <DieScene
          key={fullMotion ? 'full-roll' : 'system-motion'}
          size={sceneSize}
          settling={phase === 'settling' || phase === 'closing'}
          fullMotion={fullMotion}
          onRollStart={handleRollStart}
          onRollEnd={handleRollEnd}
        />
      </View>

      <View style={[styles.footer, { bottom: insets.bottom + 32 }]} pointerEvents="box-none">
        <Animated.View key={phase} entering={FadeIn.duration(180)} exiting={FadeOut.duration(140)}>
          <Text style={styles.copy}>{copy}</Text>
        </Animated.View>
        <Text style={styles.hint}>Tap anywhere to cancel</Text>
        {reducedMotion && !fullMotion && (phase === 'rolling' || phase === 'matching') ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reduce Motion is on. Play the full dice roll for this surprise."
            onPress={() => setFullMotion(true)}
            style={styles.motionButton}
          >
            <Text style={styles.motionLabel}>Reduce Motion is on. Play dice roll</Text>
          </Pressable>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    zIndex: 100,
    elevation: 100,
  },
  scrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stage: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  copy: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 22,
    textAlign: 'center',
  },
  hint: {
    marginTop: 10,
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 12,
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  motionButton: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginTop: 8,
  },
  motionLabel: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
    textAlign: 'center',
  },
});
