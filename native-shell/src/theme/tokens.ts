export const Fonts = {
  // Editorial Display Serif (from Google Fonts: Fraunces)
  display: 'Fraunces_600SemiBold',
  displayMedium: 'Fraunces_500Medium',
  displayRegular: 'Fraunces_400Regular',
  displayBold: 'Fraunces_700Bold',
  displayItalic: 'Fraunces_400Regular_Italic',
  displayMediumItalic: 'Fraunces_500Medium_Italic',
  displaySemiBoldItalic: 'Fraunces_600SemiBold_Italic',

  // Clean Modern UI Sans-Serif (from Google Fonts: Outfit)
  ui: 'Outfit_400Regular',
  uiMedium: 'Outfit_500Medium',
  uiSemiBold: 'Outfit_600SemiBold',
  uiBold: 'Outfit_700Bold',
  uiExtraBold: 'Outfit_800ExtraBold',
};

export const Colors = {
  background: '#080808',
  backgroundPure: '#000000',
  surface: 'rgba(26, 24, 23, 0.76)',
  surfaceSubtle: 'rgba(32, 29, 27, 0.65)',
  surfaceElevated: 'rgba(38, 35, 32, 0.85)',
  card: 'rgba(24, 22, 21, 0.88)',
  cardSolid: '#181614',
  cardAccent: '#EDE0D4', // Warm cream sand accent container from Inspi
  cardAccentBorder: '#F0E5D9',
  peach: '#F7D5B2',
  peachLight: '#FFE8D1',
  peachSubtle: 'rgba(247, 213, 178, 0.12)',
  peachBorder: 'rgba(247, 213, 178, 0.32)',
  gold: '#E7C98E',
  goldSubtle: 'rgba(231, 201, 142, 0.15)',
  ink: '#F8F5EF',
  inkDark: '#141311', // Dark text on cream accent cards
  inkDarkSecondary: 'rgba(20, 19, 17, 0.68)',
  textPrimary: '#F8F5EF',
  textSecondary: 'rgba(248, 245, 239, 0.72)',
  textMuted: 'rgba(248, 245, 239, 0.48)',
  textSubtle: 'rgba(248, 245, 239, 0.35)',
  border: 'rgba(248, 245, 239, 0.10)',
  borderLight: 'rgba(248, 245, 239, 0.18)',
  borderAccent: 'rgba(247, 213, 178, 0.35)',
  glassBackground: 'rgba(18, 17, 15, 0.82)',
  glassPill: 'rgba(248, 245, 239, 0.07)',
  glassPillBorder: 'rgba(248, 245, 239, 0.22)',
  success: '#10B981',
  error: '#EF4444',
  warning: '#F59E0B',
  info: '#3B82F6',
};

export const SpringConfigs = {
  // Apple Fluid Interface Spring Physics (WWDC 2018 standard)
  buttonPress: {
    damping: 15,
    mass: 0.8,
    stiffness: 250,
  },
  cardLift: {
    damping: 18,
    mass: 1,
    stiffness: 180,
  },
  sheetSnap: {
    damping: 24,
    mass: 1,
    stiffness: 220,
  },
  modalPop: {
    damping: 20,
    mass: 0.9,
    stiffness: 240,
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
};

export const BorderRadius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  card: 22,
  pill: 9999,
};
