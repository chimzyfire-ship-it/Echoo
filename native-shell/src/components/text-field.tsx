import type { ComponentProps } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/src/theme/tokens';

type TextFieldProps = ComponentProps<typeof TextInput> & {
  label: string;
  hint?: string;
  error?: string;
};

export function TextField({ label, hint, error, style, multiline, ...props }: TextFieldProps) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...props}
        multiline={multiline}
        placeholderTextColor={Colors.textMuted}
        selectionColor={Colors.peach}
        style={[styles.input, multiline && styles.multiline, error && styles.inputError, style]}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 7,
  },
  label: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 13,
    fontWeight: '600',
  },
  input: {
    minHeight: 50,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.12)',
    backgroundColor: 'rgba(24, 22, 20, 0.82)',
    color: Colors.ink,
    fontFamily: Fonts.ui,
    fontSize: 15,
    paddingHorizontal: Spacing.md,
    paddingVertical: 12,
  },
  multiline: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  inputError: {
    borderColor: Colors.error,
  },
  hint: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  error: {
    color: '#FFAAA0',
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 17,
  },
});
