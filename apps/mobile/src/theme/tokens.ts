import { Appearance, Platform, type TextStyle, type ViewStyle } from 'react-native';
import { readThemePreference } from './appearance';

/**
 * FORM design tokens — warm and cosy, in two moods. Light is oat-cream paper with espresso type;
 * dark is a warm evening — espresso surfaces, cream type, the same terracotta, honey and sage
 * glowing a little brighter. A fixed colour per macro (protein coral, carbs honey, fat blue).
 * Rounded type, generous corners and soft shadows so the app feels like a friendly place to come
 * back to, not a dashboard. The mood is chosen once at launch (see `scheme`).
 */

export type Palette = Record<keyof typeof light, string>;

const light = {
  bg: '#FBF5EC',
  surface: '#F6EDE0',
  card: '#FFFCF7',
  cardRaised: '#F8F0E5',
  border: '#EEE2D2',
  borderStrong: '#DFCFBA',
  /** Hairline for quiet separators inside cards. */
  hairline: 'rgba(84,58,36,0.09)',
  /** Empty part of a bar or ring. */
  track: 'rgba(84,58,36,0.09)',
  /** A barely-there wash for nested panels. */
  wash: 'rgba(84,58,36,0.035)',
  /** Full-screen cover (e.g. a paused workout): the page colour, nearly opaque. */
  overlay: 'rgba(251,245,236,0.97)',
  /** Frosted glass for bars that float over content (tab bar, scrolled header). */
  glass: 'rgba(255,251,245,0.74)',
  /** The lit top edge of a card, as if light falls from above. */
  edge: 'rgba(255,255,255,0.95)',
  /** Behind a modal sheet or dialog: dims the page without turning it grey. */
  scrim: 'rgba(58,42,31,0.42)',
  text: '#3A2A1F',
  textMuted: '#6B5747',
  // Lightest text colour allowed for body-size text: ≥ 4.5:1 on card and raised surfaces (WCAG AA).
  textFaint: '#7A6351',
  primary: '#C24E2A',
  primaryDeep: '#A8401F',
  primarySoft: 'rgba(214, 104, 66, 0.14)',
  onPrimary: '#FFFFFF',
  /** Streaks, rewards, records. */
  accent: '#C9741A',
  accentSoft: 'rgba(232, 150, 46, 0.18)',
  /** Food on target, things done. */
  success: '#4E8A5C',
  successSoft: 'rgba(78, 138, 92, 0.15)',
  /** Used sparingly (a secondary series, "label" amounts). */
  purple: '#8A6BC4',
  purpleSoft: 'rgba(138, 107, 196, 0.14)',
  water: '#3E86B0',
  warning: '#B57A0E',
  warningSoft: 'rgba(214, 152, 30, 0.16)',
  danger: '#C8423B',
  dangerSoft: 'rgba(200, 66, 59, 0.12)',
  /** Macros — the same colour on every ring, bar and chip. */
  protein: '#D9574A',
  carbs: '#B9811A',
  fat: '#4F7FC4',
};

const dark: Palette = {
  bg: '#17110E',
  surface: '#1E1713',
  card: '#271E19',
  cardRaised: '#30251F',
  border: '#3A2E26',
  borderStrong: '#4D3E33',
  hairline: 'rgba(255,236,214,0.08)',
  track: 'rgba(255,236,214,0.11)',
  wash: 'rgba(255,236,214,0.04)',
  overlay: 'rgba(23,17,14,0.96)',
  glass: 'rgba(36,27,22,0.72)',
  edge: 'rgba(255,236,214,0.13)',
  scrim: 'rgba(0,0,0,0.62)',
  text: '#F8ECDF',
  textMuted: '#D2BDA9',
  textFaint: '#B39D89',
  primary: '#E5825A',
  primaryDeep: '#D06D45',
  primarySoft: 'rgba(229, 130, 90, 0.18)',
  onPrimary: '#2A1408',
  accent: '#F2A541',
  accentSoft: 'rgba(242, 165, 65, 0.18)',
  success: '#8CC08F',
  successSoft: 'rgba(140, 192, 143, 0.16)',
  purple: '#BBA6EE',
  purpleSoft: 'rgba(187, 166, 238, 0.16)',
  water: '#7DB9DD',
  warning: '#F2B544',
  warningSoft: 'rgba(242, 181, 68, 0.16)',
  danger: '#F07A6E',
  dangerSoft: 'rgba(240, 122, 110, 0.15)',
  protein: '#F08A7E',
  carbs: '#E8B04E',
  fat: '#86AEE6',
};

type Gradient = readonly [string, string, ...string[]];

const lightGradients = {
  /** Progress fills only — buttons are solid. */
  primary: ['#E07A52', '#C24E2A'] as Gradient,
  /** A quiet lift for feature surfaces. */
  hero: ['#FFF8EF', '#F8EBDB'] as Gradient,
  /** Behind hero art when there is no photo: a sunrise wash from peach to cream. */
  heroMedia: ['#FFE3CC', '#FCEBDC', '#FFF7EE'] as Gradient,
  /** Over imagery so type stays readable — the page colour fading in from below. */
  scrim: ['rgba(255,249,240,0)', 'rgba(255,249,240,0.55)', 'rgba(255,249,240,0.94)'] as Gradient,
  pro: ['#FBE6D6', '#F3DCEB'] as Gradient,
  /** Warm light falling across the top of every screen. */
  ambient: ['rgba(255,206,160,0.55)', 'rgba(255,226,196,0.18)', 'rgba(251,245,236,0)'] as Gradient,
};

const darkGradients: typeof lightGradients = {
  primary: ['#EE9670', '#D06D45'],
  hero: ['#2D221C', '#221A15'],
  /** An evening glow: warm ember fading to espresso. */
  heroMedia: ['#43291D', '#2E211A', '#241B16'],
  scrim: ['rgba(23,17,14,0)', 'rgba(23,17,14,0.55)', 'rgba(23,17,14,0.94)'],
  pro: ['#3A2620', '#2C1F2B'],
  /** An ember glow from the top of the screen, like lamplight in a dark room. */
  ambient: ['rgba(229,130,90,0.22)', 'rgba(242,165,65,0.06)', 'rgba(23,17,14,0)'],
};

/** The device's or the user's choice, decided once at launch. */
export const scheme: 'light' | 'dark' = (() => {
  const pref = readThemePreference();
  if (pref !== 'system') return pref;
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
})();

export const palettes = { light, dark };
export const colors: Palette = scheme === 'dark' ? dark : light;
export const gradients = scheme === 'dark' ? darkGradients : lightGradients;
export const allGradients = { light: lightGradients, dark: darkGradients };

export type ElevationName = 'flat' | 'card' | 'raised' | 'lifted' | 'modal';

/**
 * Depth, in five steps. Light mode uses warm, soft shadows (small opacity, bigger radius as the
 * level rises). Dark mode uses black, deeper shadows, and gets the rest of its depth from
 * `edgeLight` and the tonal surface steps. Android reads `elevation` instead of the shadow props.
 */
const makeElevation = (tone: 'light' | 'dark'): Record<ElevationName, ViewStyle> => {
  const lit = tone === 'light';
  const color = lit ? '#7A4A26' : '#000000';
  const level = (opacity: number, blur: number, y: number, android: number): ViewStyle => ({
    shadowColor: color,
    shadowOpacity: opacity,
    shadowRadius: blur,
    shadowOffset: { width: 0, height: y },
    elevation: android,
  });
  return {
    flat: level(0, 0, 0, 0),
    card: lit ? level(0.08, 16, 5, 2) : level(0.3, 14, 5, 3),
    raised: lit ? level(0.11, 20, 8, 4) : level(0.38, 20, 8, 5),
    lifted: lit ? level(0.14, 24, 11, 6) : level(0.46, 26, 12, 8),
    modal: lit ? level(0.2, 34, 18, 12) : level(0.6, 38, 20, 14),
  };
};

export const allElevations = { light: makeElevation('light'), dark: makeElevation('dark') };
export const elevation: Record<ElevationName, ViewStyle> = allElevations[scheme];

/** The lit top edge of a surface in dark mode (light falls from above). Nothing in light mode, where the shadow does the work. */
export const edgeLight: ViewStyle = scheme === 'dark' ? { borderTopWidth: 1, borderTopColor: colors.edge } : {};

/** A soft coloured halo for the one thing that should feel lit. Dark mode only: in light mode it would just look dirty. */
export const glow = (color: string): ViewStyle =>
  scheme === 'dark' ? { shadowColor: color, shadowOpacity: 0.45, shadowRadius: 18, shadowOffset: { width: 0, height: 0 } } : {};

/** Kept for existing importers: the two steps cards and hero surfaces used before `elevation`. */
export const shadow = { card: elevation.card, lifted: elevation.lifted };

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 12, md: 16, lg: 24, xl: 32, pill: 999 } as const;

/** Accessibility baselines. */
export const a11y = {
  /** Minimum touch target (iOS HIG 44pt, Material 48dp). */
  minTouch: 44,
  /** Cap on OS font scaling for large numeric displays so they don't overflow; body text scales freely. */
  maxNumberScale: 1.4,
} as const;

/** Layout breakpoints (dp). */
export const breakpoints = { wide: 900 } as const;
export const MAX_CONTENT_WIDTH = 640;

/** Nunito, loaded in the root layout (system font until it's ready). One step heavier than the
 * names suggest: Nunito's rounded strokes read best a little bolder. */
export const fonts = {
  regular: 'Nunito_500Medium',
  medium: 'Nunito_600SemiBold',
  semibold: 'Nunito_700Bold',
  bold: 'Nunito_800ExtraBold',
} as const;

// Android picks the weight from the font file; a fontWeight on top would synthesise a fake bold.
const face = (family: string, weight: TextStyle['fontWeight']): TextStyle => (Platform.OS === 'android' ? { fontFamily: family } : { fontFamily: family, fontWeight: weight });

export const type = {
  display: { ...face(fonts.bold, '800'), fontSize: 36, lineHeight: 42, letterSpacing: -0.6 },
  title: { ...face(fonts.bold, '800'), fontSize: 30, lineHeight: 36, letterSpacing: -0.4 },
  heading: { ...face(fonts.semibold, '700'), fontSize: 19, lineHeight: 25, letterSpacing: -0.2 },
  body: { ...face(fonts.regular, '500'), fontSize: 16, lineHeight: 23 },
  bodyStrong: { ...face(fonts.semibold, '700'), fontSize: 16, lineHeight: 23 },
  caption: { ...face(fonts.regular, '500'), fontSize: 14, lineHeight: 20 },
  /** Quiet sentence-case label ("Protein", "Last session"). */
  label: { ...face(fonts.medium, '600'), fontSize: 13, lineHeight: 18 },
  /** Rare uppercase eyebrow ("NEW PERSONAL RECORD"). */
  overline: { ...face(fonts.bold, '800'), fontSize: 12, lineHeight: 16, letterSpacing: 1.2, textTransform: 'uppercase' },
  number: { ...face(fonts.bold, '800'), fontSize: 32, lineHeight: 38, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  /** The big title at the top of a screen. */
  screenTitle: { ...face(fonts.bold, '800'), fontSize: 34, lineHeight: 40, letterSpacing: -0.4 },
  /** A section heading ("Today's fuel"). */
  sectionTitle: { ...face(fonts.semibold, '700'), fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  /** A card or sheet title, a step under `title`. */
  titleSm: { ...face(fonts.bold, '800'), fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  /** A figure inside a card (calories left, sets done). */
  stat: { ...face(fonts.bold, '800'), fontSize: 22, lineHeight: 28, letterSpacing: -0.2, fontVariant: ['tabular-nums'] },
  /** A large value on its own (a weight, a time). */
  valueLg: { ...face(fonts.bold, '800'), fontSize: 34, lineHeight: 40, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
} as const satisfies Record<string, TextStyle>;
