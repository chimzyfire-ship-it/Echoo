import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Crosshair, X } from 'lucide-react-native';

import { GTA_MUNICIPALITIES } from '@/src/services/location';
import { Colors, Fonts, Spacing } from '@/src/theme/tokens';
import { useEchooLocation } from '@/src/providers/location-provider';

export function LocationPicker({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const { location, chooseMunicipality, isResolving, useDeviceLocation, error } = useEchooLocation();

  async function handleDeviceLocation() {
    try {
      await useDeviceLocation();
      onClose();
    } catch {
      // The provider exposes a clear, actionable error in this sheet.
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.screen}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>WHERE ARE YOU?</Text>
            <Text style={styles.title}>Set your Echoo area</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Close location picker" onPress={onClose} style={styles.close}>
            <X size={20} color={Colors.ink} />
          </Pressable>
        </View>

        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={styles.content}>
          <Pressable
            accessibilityRole="button"
            onPress={handleDeviceLocation}
            disabled={isResolving}
            style={({ pressed }) => [styles.deviceRow, pressed && styles.pressed, isResolving && styles.disabled]}
          >
            {isResolving ? <ActivityIndicator color={Colors.peach} /> : <Crosshair size={20} color={Colors.peach} />}
            <View style={styles.deviceCopy}>
              <Text style={styles.deviceTitle}>Use my location</Text>
              <Text style={styles.deviceBody}>Precise location stays only in this app session.</Text>
            </View>
          </Pressable>
          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Text style={styles.sectionTitle}>25 GTA municipalities</Text>
          <View style={styles.cityList}>
            {GTA_MUNICIPALITIES.map((municipality) => {
              const selected = location.mode === 'manual' && location.city === municipality.name;
              return (
                <Pressable
                  key={municipality.name}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    chooseMunicipality(municipality.name);
                    onClose();
                  }}
                  style={({ pressed }) => [styles.city, selected && styles.citySelected, pressed && styles.pressed]}
                >
                  <Text style={[styles.cityName, selected && styles.cityNameSelected]}>{municipality.name}</Text>
                  <Text style={styles.region}>{municipality.region}</Text>
                </Pressable>
              );
            })}
          </View>
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
    paddingTop: Spacing['2xl'],
    paddingBottom: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(248, 245, 239, 0.08)',
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
    fontSize: 25,
    fontWeight: '600',
    letterSpacing: -0.7,
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
  content: {
    padding: Spacing.lg,
    paddingBottom: 48,
    gap: Spacing.md,
  },
  deviceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderRadius: 20,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: Colors.peachBorder,
    backgroundColor: Colors.peachSubtle,
    padding: Spacing.lg,
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
    gap: 8,
  },
  city: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 1,
    borderColor: 'rgba(248, 245, 239, 0.10)',
    backgroundColor: 'rgba(24, 22, 20, 0.82)',
    paddingHorizontal: Spacing.md,
    paddingVertical: 14,
  },
  citySelected: {
    borderColor: Colors.peachBorder,
    backgroundColor: Colors.peachSubtle,
  },
  cityName: {
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
