import { useEffect } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, ReduceMotion } from 'react-native-reanimated';
import { Check } from 'lucide-react-native';
import { PrimaryButton } from '@/src/components/primary-button';
import { Colors, Fonts } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

export function AuthOutcome({ title, body, label = 'Continue', onContinue }: {
  title: string; body: string; label?: string; onContinue: () => void;
}) {
  useEffect(() => { void triggerHaptic.success(); AccessibilityInfo.announceForAccessibility(`${title}. ${body}`); }, [title, body]);
  return <Animated.View entering={FadeIn.duration(220).reduceMotion(ReduceMotion.System)} style={styles.panel}>
    <View style={styles.check}><Check size={30} color={Colors.inkDark} strokeWidth={2} /></View>
    <Text accessibilityRole="header" style={styles.title}>{title}</Text>
    <Text style={styles.body}>{body}</Text>
    <PrimaryButton label={label} onPress={onContinue} />
  </Animated.View>;
}
const styles = StyleSheet.create({
  panel: { gap: 18, paddingVertical: 24, alignItems: 'center', width: '100%' },
  check: { width: 64, height: 64, borderRadius: 32, backgroundColor: Colors.peach, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: Fonts.display, fontSize: 30, color: Colors.ink, textAlign: 'center' },
  body: { fontFamily: Fonts.ui, fontSize: 15, lineHeight: 22, color: Colors.textSecondary, textAlign: 'center' },
});
