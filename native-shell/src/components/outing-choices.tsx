import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { OutingChoices as Choices } from '@/src/services/outing';
import { Colors, Fonts } from '@/src/theme/tokens';

export function OutingChoices({ value, onChange, disabled = false }: { value: Choices; onChange: (value: Choices) => void; disabled?: boolean }) {
  const groups = [
    { key: 'stopCount', title: 'How much of the city?', options: [[2, '2 places'], [3, '3 places']] },
    { key: 'budgetStyle', title: 'Spending preference', options: [['value', 'Low'], ['balanced', 'Regular'], ['elevated', 'High']] },
    { key: 'mood', title: 'Your mood', options: [['chill', 'Chill'], ['hype', 'Lively'], ['curious', 'Curious']] },
    { key: 'anchorPosition', title: 'Visit your chosen place', options: [[1, 'First'], [2, 'Second'], ...(value.stopCount === 3 ? [[3, 'Third']] : [])] },
  ];
  return <View style={styles.groups}>{groups.map((group) => <View key={group.key} style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={group.title}>
    <Text style={styles.label}>{group.title}</Text>
    <View style={styles.row}>{group.options.map(([option, label]) => {
      const selected = value[group.key as keyof Choices] === option;
      return <Pressable key={option} accessibilityRole="radio" accessibilityState={{ selected, disabled }} disabled={disabled}
        onPress={() => onChange({ ...value, [group.key]: option, ...(group.key === 'stopCount' ? { anchorPosition: Math.min(value.anchorPosition, Number(option)) } : {}) })}
        style={({ pressed }) => [styles.option, selected && styles.selected, (disabled || pressed) && { opacity: 0.5 }]}>
        <Text style={[styles.optionText, selected && { color: Colors.inkDark }]}>{label}</Text>
      </Pressable>;
    })}</View>
  </View>)}</View>;
}

const styles = StyleSheet.create({
  groups: { gap: 18 }, group: { gap: 8 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  label: { fontFamily: Fonts.uiMedium, color: Colors.textSecondary, fontSize: 13 },
  option: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 18, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: Colors.peachBorder },
  selected: { backgroundColor: Colors.peach }, optionText: { fontFamily: Fonts.uiMedium, fontSize: 14, color: Colors.ink },
});
