import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useCulture } from '@/src/providers/culture-provider';
import { Colors } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

function CultureGlyph({ stroke }: { stroke: string }) {
  return (
    <Svg width={23} height={23} viewBox="0 0 24 24" fill="none">
      <Circle cx={8.1} cy={12} r={4.15} stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={15.9} cy={12} r={4.15} stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M12.25 12h-.5M3.95 10.9 2.6 9.8M20.05 10.9l1.35-1.1" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6.35 12a1.75 1.75 0 0 0 3.5 0M14.15 12a1.75 1.75 0 0 0 3.5 0" stroke={stroke} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// Native port of the web Culture Lens FAB: tap when a lens is active turns it
// off, tap when inactive opens the picker, long-press always opens the picker.
export function CultureFab({ onOpenPicker }: { onOpenPicker: () => void }) {
  const { active, clear } = useCulture();
  const [pressing, setPressing] = useState(false);

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          active
            ? `Culture Lens on: ${active.label}. Tap to turn off.`
            : 'Culture Lens. Tap to choose a culture.'
        }
        onPressIn={() => {
          setPressing(true);
          void triggerHaptic.light();
        }}
        onPressOut={() => setPressing(false)}
        onPress={() => {
          if (active) clear();
          else onOpenPicker();
        }}
        onLongPress={onOpenPicker}
        style={[styles.fab, active && styles.fabActive, pressing && styles.fabPressing]}
      >
        <CultureGlyph stroke={active ? Colors.background : Colors.peach} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    right: 16,
    bottom: 88,
    zIndex: 45,
  },
  fab: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#211F1A',
    borderWidth: 1,
    borderColor: 'rgba(247,213,178,0.62)',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 8,
  },
  fabActive: {
    backgroundColor: Colors.peach,
    borderColor: Colors.peach,
  },
  fabPressing: {
    transform: [{ scale: 0.94 }],
    opacity: 0.9,
  },
});
