import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ArrowUpLeft, MapPin, Search, X } from 'lucide-react-native';
import { edgeRequest } from '@/src/services/api';
import { Colors, Fonts } from '@/src/theme/tokens';

type Suggestion = { label: string; value: string; subtitle?: string; entityId?: string; source?: string };
type Suggestions = { suggestions: Suggestion[]; supported: boolean; providerStatus?: string };

export function DiscoverSearch({ value, city, onSearch }: { value: string; city: string; onSearch: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [debounced, setDebounced] = useState('');
  const [focused, setFocused] = useState(false);
  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(draft.trim()), 300);
    return () => clearTimeout(timer);
  }, [draft]);
  const ready = focused && debounced.length >= 2 && debounced === draft.trim();
  const query = useQuery({
    queryKey: ['search-suggestions', city, debounced],
    enabled: ready,
    queryFn: ({ signal }) => edgeRequest<Suggestions>('search-suggestions', { body: { query: debounced, city, limit: 7 }, signal }),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const suggestions = ready ? query.data?.suggestions ?? [] : [];
  function submit(next: string) {
    setDraft(next);
    setFocused(false);
    Keyboard.dismiss();
    onSearch(next.trim());
  }
  const expanded = focused && draft.trim().length >= 2;
  return <View style={styles.root}>
    <View style={styles.inputRow}>
      <Search size={18} color={Colors.textSecondary} />
      <TextInput value={draft} onChangeText={(next) => { setDraft(next); if (!next.trim()) onSearch(''); }}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onSubmitEditing={() => submit(draft)}
        accessibilityLabel="Search places and activities" accessibilityHint="Type two or more letters for nearby place suggestions. Press Search for all results."
        placeholder="A café, a trail, something fun…" placeholderTextColor={Colors.textMuted}
        maxLength={240} returnKeyType="search" autoCorrect={false} style={styles.input} />
      {draft ? <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => { setDraft(''); setDebounced(''); onSearch(''); }} style={styles.clear}><X size={18} color={Colors.textSecondary} /></Pressable> : null}
    </View>
    {expanded ? <View style={styles.results}>
      {(!ready || query.isFetching) && !suggestions.length ? <View style={styles.status}><ActivityIndicator size="small" color={Colors.peach} /><Text style={styles.note}>Finding places nearby…</Text></View> : null}
      {(['google_places', 'echoo'] as const).map((source) => {
        const group = suggestions.filter((item) => (item.source || 'echoo') === source);
        return group.length ? <View key={source} style={styles.group}>
          {group.map((item) => <Pressable key={`${item.entityId || item.value}:${item.label}`} accessibilityRole="button" accessibilityLabel={`Search for ${item.label}${item.subtitle ? `, ${item.subtitle}` : ''}`}
            onPress={() => submit(item.value)} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
            <MapPin size={16} color={Colors.peach} />
            <View style={styles.copy}><Text style={styles.label}>{item.label}</Text>{item.subtitle ? <Text style={styles.note}>{item.subtitle}</Text> : null}</View>
            <ArrowUpLeft size={16} color={Colors.textSecondary} />
          </Pressable>)}
          {source === 'google_places' ? <Text style={styles.attribution}>Google Maps</Text> : null}
        </View> : null;
      })}
      {ready && !query.isFetching && !suggestions.length ? <Text style={[styles.note, styles.empty]}>{query.isError ? 'Suggestions unavailable. You can still search.' : 'No nearby suggestions. Try a full search.'}</Text> : null}
      <Pressable accessibilityRole="button" onPress={() => submit(draft)} style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}>
        <Search size={16} color={Colors.peach} /><Text style={[styles.label, styles.copy]}>Search for “{draft.trim()}”</Text>
      </Pressable>
    </View> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 6, minHeight: 54, borderRadius: 24, backgroundColor: Colors.glassPill, borderWidth: 1, borderColor: Colors.borderLight },
  input: { flex: 1, fontFamily: Fonts.ui, fontSize: 16, color: Colors.ink, paddingVertical: 14 },
  clear: { width: 44, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  results: { borderRadius: 20, borderCurve: 'continuous', overflow: 'hidden', borderWidth: 1, borderColor: Colors.borderLight, backgroundColor: Colors.cardSolid },
  group: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  suggestion: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13, minHeight: 52 },
  copy: { flex: 1, gap: 3 },
  label: { fontFamily: Fonts.uiMedium, color: Colors.ink, fontSize: 14, lineHeight: 20 },
  note: { fontFamily: Fonts.ui, color: Colors.textSecondary, fontSize: 12, lineHeight: 18 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16 },
  empty: { padding: 16 },
  attribution: { fontFamily: Fonts.ui, fontSize: 12, color: '#FFFFFF', paddingHorizontal: 16, paddingBottom: 12, textAlign: 'right' },
  pressed: { backgroundColor: Colors.peachSubtle },
});
