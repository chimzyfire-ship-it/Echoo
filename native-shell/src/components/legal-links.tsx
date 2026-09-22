import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Colors, Fonts } from '@/src/theme/tokens';
export const LEGAL_URLS = { privacy: 'https://echoocity.com/privacy.html', terms: 'https://echoocity.com/terms.html', support: 'mailto:privacy@echoocity.com' };
export function LegalLinks({ support = false }: { support?: boolean }) {
  return <View style={styles.row}>{(['privacy', 'terms', ...(support ? ['support'] : [])] as Array<keyof typeof LEGAL_URLS>).map(key => <Pressable key={key} accessibilityRole="link" onPress={() => {
    void Linking.openURL(LEGAL_URLS[key]).catch(() => Alert.alert('Could not open link', LEGAL_URLS[key]));
  }} style={styles.link}><Text style={styles.text}>{key === 'privacy' ? 'Privacy Policy' : key === 'terms' ? 'Terms of Service' : 'Contact support'}</Text></Pressable>)}</View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }, link: { minHeight: 44, justifyContent: 'center' }, text: { color: Colors.peachLight, fontFamily: Fonts.ui, fontSize: 12, textDecorationLine: 'underline' } });
