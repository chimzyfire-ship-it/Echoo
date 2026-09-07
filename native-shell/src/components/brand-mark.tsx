import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts } from '@/src/theme/tokens';

export function BrandMark({ style, size = 'default' }: { style?: StyleProp<ViewStyle>; size?: 'default' | 'large' | 'small' }) {
  const isLarge = size === 'large';
  const isSmall = size === 'small';

  return (
    <View style={[styles.wrap, style]} accessibilityRole="header" accessibilityLabel="echoo">
      <Text style={[styles.wordmark, isLarge && styles.wordmarkLarge, isSmall && styles.wordmarkSmall]}>
        echoo
      </Text>
      <Text style={[styles.trademark, isLarge && styles.trademarkLarge, isSmall && styles.trademarkSmall]}>
        ®
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  wordmark: {
    color: Colors.ink,
    fontFamily: Fonts.uiExtraBold,
    fontSize: 26,
    fontWeight: '800',
    letterSpacing: -1.2,
    lineHeight: 28,
  },
  wordmarkLarge: {
    fontSize: 32,
    lineHeight: 34,
    letterSpacing: -1.5,
  },
  wordmarkSmall: {
    fontSize: 20,
    lineHeight: 22,
    letterSpacing: -0.8,
  },
  trademark: {
    color: 'rgba(248, 245, 239, 0.55)',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 8,
    lineHeight: 10,
    marginLeft: 1.5,
    marginTop: 2,
  },
  trademarkLarge: {
    fontSize: 10,
    lineHeight: 12,
    marginLeft: 2,
    marginTop: 3,
  },
  trademarkSmall: {
    fontSize: 7,
    lineHeight: 8,
    marginLeft: 1,
    marginTop: 1,
  },
});
