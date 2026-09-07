import { Pressable, StyleSheet, Text } from 'react-native';

import { Colors, Fonts } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

export function ChoiceChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => {
        void triggerHaptic.selection();
        onPress();
      }}
      style={({ pressed }) => [styles.chip, selected && styles.selected, pressed && styles.pressed]}
    >
      <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: 38,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.12)',
    backgroundColor: 'rgba(24, 22, 20, 0.72)',
    paddingHorizontal: 15,
  },
  selected: {
    borderColor: Colors.peach,
    backgroundColor: 'rgba(247, 213, 178, 0.15)',
  },
  label: {
    color: 'rgba(248, 245, 239, 0.75)',
    fontFamily: Fonts.uiMedium,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: -0.1,
  },
  selectedLabel: {
    color: Colors.peach,
    fontFamily: Fonts.uiSemiBold,
    fontWeight: '600',
  },
  pressed: {
    opacity: 0.72,
    transform: [{ scale: 0.97 }],
  },
});
