import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Colors, Fonts } from '@/src/theme/tokens';
export function LegalLinks({ support = false }: { support?: boolean }) {
  const router = useRouter();
  return <View style={styles.row}>{(['privacy', 'terms', ...(support ? ['support'] : [])]).map(key => <Pressable key={key} accessibilityRole="link" onPress={() => {
    if (key === 'support') void Linking.openURL('mailto:privacy@echoocity.com').catch(() => Alert.alert('Contact support', 'Email privacy@echoocity.com'));
    else router.push({ pathname: '/legal', params: { document: key } });
  }} style={styles.link}><Text style={styles.text}>{key === 'privacy' ? 'Privacy Policy' : key === 'terms' ? 'Terms of Service' : 'Contact support'}</Text></Pressable>)}</View>;
}
const styles = StyleSheet.create({ row: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 12 }, link: { minHeight: 44, justifyContent: 'center' }, text: { color: Colors.peachLight, fontFamily: Fonts.ui, fontSize: 12, textDecorationLine: 'underline' } });
