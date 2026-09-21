import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Crosshair, X } from 'lucide-react-native';

import { MUNICIPALITY_GROUPS, searchMunicipalities } from '@/src/services/location';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';
import { useEchooLocation } from '@/src/providers/location-provider';

export function LocationPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { location, chooseMunicipality, isResolving, useDeviceLocation, error } = useEchooLocation();
  const [search, setSearch] = useState('');
  const matches = new Set(searchMunicipalities(search));

  async function handleDeviceLocation() {
    try {
      if (await useDeviceLocation()) onClose();
    } catch {
      // The provider exposes a clear, actionable error in this sheet.
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} onShow={() => setSearch('')}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Location</Text>
            <Text style={styles.deviceBody}>Current: {location.label}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close location picker" onPress={onClose} style={styles.close}>
            <X size={20} color={Colors.ink} />
          </Pressable>
        </View>

        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
          <View style={styles.searchRow}>
            <TextInput
              value={search}
              onChangeText={setSearch}
              accessibilityLabel="Search Ontario cities, GTA municipalities or regions"
              placeholder="Search city or region"
              placeholderTextColor={Colors.textMuted}
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="search"
              style={styles.searchInput}
            />
            {search ? <Pressable accessibilityRole="button" accessibilityLabel="Clear municipality search" onPress={() => setSearch('')} style={styles.close}><X size={18} color={Colors.ink} /></Pressable> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: isResolving, busy: isResolving }}
            accessibilityHint="Shares your coordinates with location providers for this session."
            onPress={handleDeviceLocation}
            disabled={isResolving}
            style={({ pressed }) => [styles.deviceRow, pressed && styles.pressed, isResolving && styles.disabled]}
          >
            {isResolving ? <ActivityIndicator color={Colors.peach} /> : <Crosshair size={20} color={Colors.peach} />}
            <View style={styles.deviceCopy}>
              <Text style={styles.deviceTitle}>{isResolving ? 'Finding your location...' : 'Use my location'}</Text>
            </View>
          </Pressable>
          <Text style={styles.deviceBody}>GPS is shared with location providers for this session.</Text>
          {error ? <Text selectable accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}

          {!matches.size ? <Text style={styles.deviceBody}>No matching selections. Try a city or region name, or use your location in Ontario.</Text> : null}
          {MUNICIPALITY_GROUPS.map(({ region, municipalities }) => {
            const visibleMunicipalities = municipalities.filter((municipality) => matches.has(municipality));
            if (!visibleMunicipalities.length) return null;
            return <View key={region} style={styles.cityList}>
              <Text accessibilityRole="header" style={styles.sectionTitle}>{region === 'Other Ontario cities' ? region : `GTA / ${region}`}</Text>
            {visibleMunicipalities.map((municipality) => {
              const selected = location.mode === 'manual' && location.city === municipality.name;
              return (
                <Pressable
                  key={municipality.name}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    if (chooseMunicipality(municipality.name)) onClose();
                  }}
                  style={({ pressed }) => [styles.city, selected && styles.citySelected, pressed && styles.pressed]}
                >
                  <Text style={[styles.cityName, selected && styles.cityNameSelected]}>{municipality.name}</Text>
                  {selected ? <Text style={styles.region}>Selected</Text> : null}
                </Pressable>
              );
            })}
          </View>;
          })}
        </ScrollView>
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
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(248, 245, 239, 0.08)',
  },
  title: {
    color: Colors.ink,
    fontFamily: Fonts.display,
    fontSize: 22,
    fontWeight: '600',
    letterSpacing: -0.7,
    marginTop: 4,
  },
  close: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: 48,
    gap: Spacing.sm,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    minHeight: 48,
    paddingVertical: Spacing.sm,
  },
  deviceCopy: {
    flex: 1,
    gap: 3,
  },
  deviceTitle: {
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 15,
    fontWeight: '600',
  },
  deviceBody: {
    color: 'rgba(248, 245, 239, 0.65)',
    fontFamily: Fonts.ui,
    fontSize: 12,
    lineHeight: 17,
  },
  error: {
    color: '#FFAAA0',
    fontFamily: Fonts.ui,
    fontSize: 13,
    lineHeight: 18,
  },
  sectionTitle: {
    color: Colors.textMuted,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 12,
    letterSpacing: 0.8,
    marginTop: Spacing.sm,
    textTransform: 'uppercase',
  },
  cityList: {
    gap: 0,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: Spacing.md,
    borderRadius: 16,
    backgroundColor: Colors.surfaceElevated,
    color: Colors.ink,
    fontFamily: Fonts.ui,
    fontSize: 15,
  },
  city: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(248, 245, 239, 0.10)',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 10,
  },
  citySelected: {
    backgroundColor: Colors.peachSubtle,
  },
  cityName: {
    flex: 1,
    marginRight: Spacing.sm,
    color: Colors.ink,
    fontFamily: Fonts.uiSemiBold,
    fontSize: 15,
    fontWeight: '600',
  },
  cityNameSelected: {
    color: Colors.peach,
  },
  region: {
    color: Colors.textMuted,
    fontFamily: Fonts.ui,
    fontSize: 12,
  },
  pressed: {
    opacity: 0.74,
  },
  disabled: {
    opacity: 0.55,
  },
});
