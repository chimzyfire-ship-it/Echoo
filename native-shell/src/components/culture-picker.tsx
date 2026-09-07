import React, { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Check, Search, X } from 'lucide-react-native';

import { PrimaryButton } from '@/src/components/primary-button';
import { useCulture } from '@/src/providers/culture-provider';
import { COUNTRIES } from '@/src/services/culture';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

export function CulturePicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { active, setActive, clear } = useCulture();
  const [search, setSearch] = useState('');

  const results = useMemo(() => {
    const term = normalize(search.trim());
    if (!term) return COUNTRIES;
    return COUNTRIES.filter(
      (country) =>
        normalize(country.label).includes(term) ||
        country.code.toLowerCase().includes(term) ||
        country.aliases.some((alias) => normalize(alias).includes(term)),
    );
  }, [search]);

  function choose(slug: string) {
    setActive(slug);
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>CULTURE LENS</Text>
            <Text style={styles.title}>See the city through your culture</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close culture picker" onPress={onClose} style={styles.close}>
            <X size={20} color={Colors.ink} />
          </Pressable>
        </View>

        <View style={styles.searchBox}>
          <Search size={17} color={Colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search a country or culture"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={styles.searchInput}
          />
          {search ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch('')}>
              <X size={16} color={Colors.textSecondary} />
            </Pressable>
          ) : null}
        </View>

        {active ? (
          <View style={styles.activeRow}>
            <View style={styles.activeCopy}>
              <Text style={styles.activeLabel}>{active.flag} Lens on · {active.label}</Text>
              <Text style={styles.activeSub}>Discovery is shaped around {active.label} culture right now.</Text>
            </View>
            <PrimaryButton label="Turn off" variant="secondary" fullWidth={false} onPress={clear} />
          </View>
        ) : null}

        <FlatList
          data={results}
          keyExtractor={(country) => country.code}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const selected = active?.slug === item.slug;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => choose(item.slug)}
                style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
              >
                <Text style={styles.rowFlag}>{item.flag}</Text>
                <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>{item.label}</Text>
                <View style={styles.rowMeta}>
                  <Text style={styles.rowCode}>{item.code}</Text>
                  {selected ? <Check size={16} color={Colors.peach} /> : null}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={styles.empty}>No culture matches that search. Try a country name.</Text>
          }
          ListFooterComponent={<View style={styles.footer} />}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing['2xl'],
    paddingBottom: Spacing.md,
  },
  headerCopy: {
    flex: 1,
    marginRight: Spacing.md,
  },
  eyebrow: {
    color: 'rgba(248, 245, 239, 0.45)',
    fontFamily: Fonts.uiSemiBold,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 24,
    fontWeight: '600',
    letterSpacing: -0.6,
    marginTop: 4,
  },
  close: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: Colors.surfaceElevated,
  },
  searchBox: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.10)',
    backgroundColor: 'rgba(24, 22, 20, 0.82)',
    paddingHorizontal: 13,
  },
  searchInput: {
    flex: 1,
    color: Colors.ink,
    fontFamily: Fonts.ui,
    fontSize: 15,
    paddingVertical: 0,
  },
  activeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginHorizontal: Spacing.lg,
    marginBottom: Spacing.md,
    borderRadius: 18,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.peachBorder,
    backgroundColor: Colors.peachSubtle,
    padding: Spacing.md,
  },
  activeCopy: {
    flex: 1,
    gap: 2,
  },
  activeLabel: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 14,
    fontWeight: '600',
  },
  activeSub: {
    color: 'rgba(248, 245, 239, 0.72)',
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  list: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderRadius: 14,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'transparent',
    paddingHorizontal: Spacing.md,
    paddingVertical: 13,
  },
  rowSelected: {
    borderColor: Colors.peachBorder,
    backgroundColor: Colors.peachSubtle,
  },
  rowFlag: {
    fontSize: 20,
    lineHeight: 24,
    marginRight: 2,
  },
  rowLabel: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
  },
  rowLabelSelected: {
    color: Colors.peach,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rowCode: {
    color: Colors.textMuted,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    fontWeight: '600',
    backgroundColor: 'rgba(248, 245, 239, 0.05)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  empty: {
    color: Colors.textSecondary,
    fontFamily: Fonts.ui,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: Spacing.xl,
  },
  footer: {
    height: 24,
  },
  pressed: {
    opacity: 0.72,
  },
});
