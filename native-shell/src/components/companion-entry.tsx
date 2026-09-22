import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '@/src/theme/tokens';
import { triggerHaptic } from '@/src/utils/haptics';

export function CompanionEntry({ compact = false, prompt = '' }: { compact?: boolean; prompt?: string }) {
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Make a plan with Echoo"
      onPress={() => {
        void triggerHaptic.light();
        router.push({ pathname: '/planner', params: prompt ? { prompt } : {} });
      }}
      style={({ pressed }) => [styles.root, compact && styles.compact, pressed && styles.pressed]}
    >
      <View style={styles.copy}>
        <Text style={styles.title}>{prompt ? 'Make a day of it.' : 'A day, your way.'}</Text>
        {!compact ? <Text style={styles.body}>Tell Echoo what you’re in the mood for.</Text> : null}
      </View>
      <Text style={styles.link}>Make a plan</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { paddingVertical: 22, paddingHorizontal: 4, gap: 16, borderTopWidth: 1, borderBottomWidth: 1, borderColor: Colors.borderLight },
  compact: { paddingVertical: 16 },
  copy: { gap: 7 },
  title: { fontFamily: Fonts.display, color: Colors.ink, fontSize: 28, lineHeight: 35, letterSpacing: -0.5 },
  body: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 14, lineHeight: 21 },
  link: { alignSelf: 'flex-start', fontFamily: Fonts.uiMedium, color: Colors.peach, fontSize: 14, lineHeight: 21, textDecorationLine: 'underline' },
  pressed: { opacity: 0.65 },
});
