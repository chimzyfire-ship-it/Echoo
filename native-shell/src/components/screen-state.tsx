import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing } from '@/src/theme/tokens';

export function ScreenLoading({ label = 'Finding what is on.' }: { label?: string }) {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator color={Colors.cardAccent} size="large" />
      <Text style={styles.title}>{label}</Text>
    </View>
  );
}

export function ScreenMessage({
  title,
  body,
  icon,
  action,
}: {
  title: string;
  body: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <View style={styles.wrap}>
      {icon ? <View style={styles.icon}>{icon}</View> : null}
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing['3xl'],
    paddingVertical: 54,
    gap: Spacing.sm,
  },
  icon: {
    marginBottom: Spacing.xs,
  },
  title: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 17,
    fontWeight: '600',
    textAlign: 'center',
  },
  body: {
    color: 'rgba(248, 245, 239, 0.72)',
    fontFamily: Fonts.ui,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  action: {
    alignSelf: 'stretch',
    marginTop: Spacing.md,
  },
});
