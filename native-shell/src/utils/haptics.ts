import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * High-performance tactile haptic feedback wrappers
 * Follows Apple HIG standards for responsive touch feedback
 */
export const triggerHaptic = {
  // Ultra-light tick for scrolling wheels or tiny micro-interactions
  selection: async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.selectionAsync();
      } catch {}
    }
  },

  // Light impact on button down / card tap
  light: async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      } catch {}
    }
  },

  // Medium impact on tab switch / toggle
  medium: async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      } catch {}
    }
  },

  // Heavy impact for major actions (e.g. check-in confirmed, radar matched)
  heavy: async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      } catch {}
    }
  },

  // Success notification
  success: async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } catch {}
    }
  },

  // Error / Warning notification
  error: async () => {
    if (Platform.OS !== 'web') {
      try {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      } catch {}
    }
  },
};
