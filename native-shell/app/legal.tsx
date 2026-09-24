import { useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { mobileLegal } from '@/src/content/legal';
import { Colors, Fonts } from '@/src/theme/tokens';

export default function LegalScreen() {
  const { document } = useLocalSearchParams<{ document?: string }>();
  const doc = mobileLegal[document === 'terms' ? 'terms' : 'privacy'];
  const router = useRouter(), insets = useSafeAreaInsets();
  return <View style={styles.root}>
    <View style={[styles.header, { paddingTop: insets.top + 8 }]}><Text style={styles.brand}>echoocity</Text><Pressable accessibilityRole="button" accessibilityLabel="Close legal document" style={styles.close} onPress={() => router.canGoBack() ? router.back() : router.replace('/')}><Text style={styles.closeText}>Done</Text></Pressable></View>
    <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}><Text accessibilityRole="header" style={styles.title}>{doc.title}</Text><Text style={styles.body}>Mobile app · Updated September 24, 2026</Text>{doc.sections.map(([title, text]) => <View key={title} style={styles.section}><Text accessibilityRole="header" style={styles.heading}>{title}</Text><Text selectable style={styles.body}>{text}</Text></View>)}</ScrollView>
  </View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: Colors.background }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, borderBottomWidth: 1, borderColor: Colors.border }, brand: { fontFamily: Fonts.uiSemiBold, color: Colors.ink, fontSize: 22 }, close: { minHeight: 48, minWidth: 48, justifyContent: 'center' }, closeText: { fontFamily: Fonts.uiMedium, color: Colors.peach, fontSize: 16 }, content: { padding: 24, gap: 20, maxWidth: 720, alignSelf: 'center', width: '100%' }, title: { fontFamily: Fonts.uiSemiBold, color: Colors.ink, fontSize: 32 }, section: { gap: 8 }, heading: { fontFamily: Fonts.uiSemiBold, color: Colors.peach, fontSize: 19 }, body: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 16, lineHeight: 25 } });
