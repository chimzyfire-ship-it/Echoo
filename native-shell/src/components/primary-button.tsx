import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ColorValue,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { Colors, Fonts, Spacing } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

type PrimaryButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'outline' | 'quiet' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  pill?: boolean;
};

export function PrimaryButton({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  loading = false,
  disabled = false,
  fullWidth = true,
  pill = true,
}: PrimaryButtonProps) {
  const unavailable = disabled || loading;
  const stylesForVariant = variantStyles[variant];
  const sizeStyle = sizeStyles[size];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={() => {
        void triggerHaptic.light();
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        sizeStyle.button,
        stylesForVariant.button,
        pill && styles.pill,
        fullWidth && styles.fullWidth,
        unavailable && styles.disabled,
        pressed && !unavailable && styles.pressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={stylesForVariant.spinner} />
      ) : icon ? (
        <View style={styles.iconWrap}>{icon}</View>
      ) : null}
      <Text style={[styles.label, sizeStyle.label, stylesForVariant.label]}>{label}</Text>
    </Pressable>
  );
}

const sizeStyles = {
  sm: {
    button: { minHeight: 36, paddingHorizontal: 14, paddingVertical: 6, gap: 6 },
    label: { fontSize: 12, lineHeight: 16 },
  },
  md: {
    button: { minHeight: 48, paddingHorizontal: 20, paddingVertical: 10, gap: 8 },
    label: { fontSize: 14, lineHeight: 18 },
  },
  lg: {
    button: { minHeight: 56, paddingHorizontal: 26, paddingVertical: 14, gap: 10 },
    label: { fontSize: 16, lineHeight: 22 },
  },
};

const variantStyles: Record<NonNullable<PrimaryButtonProps['variant']>, {
  button: ViewStyle;
  label: TextStyle;
  spinner: ColorValue;
}> = {
  primary: {
    button: {
      backgroundColor: Colors.cardAccent,
      borderColor: Colors.cardAccentBorder,
    },
    label: {
      color: Colors.inkDark,
      fontFamily: Fonts.uiSemiBold,
      fontWeight: '700',
    },
    spinner: Colors.inkDark,
  },
  secondary: {
    button: {
      backgroundColor: 'rgba(28, 26, 24, 0.72)',
      borderColor: 'rgba(248, 245, 239, 0.16)',
    },
    label: {
      color: Colors.ink,
      fontFamily: Fonts.uiSemiBold,
      fontWeight: '600',
    },
    spinner: Colors.peach,
  },
  outline: {
    button: {
      backgroundColor: 'rgba(248, 245, 239, 0.06)',
      borderColor: 'rgba(248, 245, 239, 0.28)',
    },
    label: {
      color: Colors.ink,
      fontFamily: Fonts.uiMedium,
      fontWeight: '500',
    },
    spinner: Colors.ink,
  },
  quiet: {
    button: {
      backgroundColor: 'transparent',
      borderColor: 'transparent',
    },
    label: {
      color: Colors.peach,
      fontFamily: Fonts.uiSemiBold,
      fontWeight: '600',
    },
    spinner: Colors.peach,
  },
  danger: {
    button: {
      backgroundColor: 'rgba(239, 68, 68, 0.12)',
      borderColor: 'rgba(239, 68, 68, 0.4)',
    },
    label: {
      color: '#FFAAA0',
      fontFamily: Fonts.uiSemiBold,
      fontWeight: '600',
    },
    spinner: '#FFAAA0',
  },
};

const styles = StyleSheet.create({
  button: {
    borderWidth: 1,
    borderRadius: 20,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  pill: {
    borderRadius: 999,
  },
  fullWidth: {
    alignSelf: 'stretch',
  },
  iconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    letterSpacing: -0.15,
  },
  disabled: {
    opacity: 0.48,
  },
  pressed: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
});
