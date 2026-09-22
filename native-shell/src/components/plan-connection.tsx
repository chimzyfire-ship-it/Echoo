import { Car, Footprints, TrainFront } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '@/src/theme/tokens';

export function PlanConnection({ minutes, mode, verified = false }: {
  minutes: number; mode?: string; verified?: boolean;
}) {
  const Icon = mode === 'drive' ? Car : mode === 'transit' ? TrainFront : Footprints;
  const label = mode === 'drive' ? 'drive' : mode === 'transit' ? 'by transit' : mode === 'walk' ? 'walk' : 'to your next stop';
  return <View style={styles.root}>
    <View style={styles.rail} accessible={false}>
      <View style={styles.line} />
      <View style={styles.node}><Icon size={14} color={Colors.peach} /></View>
      <View style={styles.line} />
    </View>
    <Text style={styles.label}>{minutes} min {label}<Text style={styles.estimate}>{verified ? ' · route estimate' : ' · approx.'}</Text></Text>
  </View>;
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 22, minHeight: 68 },
  rail: { alignItems: 'center', alignSelf: 'stretch' },
  line: { flex: 1, width: 1, backgroundColor: Colors.peachBorder },
  node: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.peachBorder },
  label: { flex: 1, fontFamily: Fonts.uiMedium, color: Colors.peach, fontSize: 12, lineHeight: 18, paddingVertical: 14 },
  estimate: { fontFamily: Fonts.ui, color: Colors.textSecondary },
});
