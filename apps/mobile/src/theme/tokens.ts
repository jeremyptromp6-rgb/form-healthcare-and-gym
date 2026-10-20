import { Appearance, Platform, type TextStyle, type ViewStyle } from 'react-native';
import { readThemePreference } from './appearance';

/**
 * FORM design tokens — focused and premium, in two moods. Dark is the home mood: deep charcoal
 * with slightly lighter cards and hairline borders, soft cool-grey type. Light is a clean, airy
 * counterpart with deep teal so text and buttons still pass contrast. Teal green is the primary,
 * amber the accent (streaks, rewards, records). A fixed colour per macro (protein rose, carbs
 * gold, fat indigo, water sky). Inter type, generous corners and quiet shadows. The mood is
 * chosen once at launch (see `scheme`).
 */

export type Palette = Record<keyof typeof light, string>;

const light = {
  bg: '#F5F8F7',
  surface: '#ECF1EF',
  card: '#FFFFFF',
  cardRaised: '#F0F5F3',
  border: '#E1E8E5',
  borderStrong: '#CAD5D1',
  /** Hairline for quiet separators inside cards. */
  hairline: 'rgba(15,26,23,0.09)',
  /** Empty part of a bar or ring. */
  track: 'rgba(15,26,23,0.09)',
  /** A barely-there wash for nested panels. */
  wash: 'rgba(15,26,23,0.035)',
  /** Full-screen cover (e.g. a paused workout): the page colour, nearly opaque. */
  overlay: 'rgba(245,248,247,0.97)',
  /** Frosted glass for bars that float over content (tab bar, scrolled header). */
  glass: 'rgba(255,255,255,0.78)',
  /** The lit top edge of a card, as if light falls from above. */
  edge: 'rgba(255,255,255,0.95)',
  /** Behind a modal sheet or dialog: dims the page without turning it grey. */
  scrim: 'rgba(11,15,14,0.45)',
  text: '#0F1A17',
  textMuted: '#41504C',
  // Lightest text colour allowed for body-size text: ≥ 4.5:1 on card and raised surfaces (WCAG AA).
  textFaint: '#566561',
  primary: '#047857',
  primaryDeep: '#065F46',
  primarySoft: 'rgba(4, 120, 87, 0.12)',
  onPrimary: '#FFFFFF',
  /** Streaks, rewards, records. */
  accent: '#B45309',
  accentSoft: 'rgba(245, 158, 11, 0.18)',
  /** Food on target, things done: a lime green, clearly apart from the teal primary. */
  success: '#3F7D14',
  successSoft: 'rgba(101, 163, 13, 0.15)',
  /** Used sparingly (a secondary series, "label" amounts). */
  purple: '#7E3FD6',
  purpleSoft: 'rgba(126, 63, 214, 0.12)',
  water: '#0369A1',
  warning: '#C2410C',
  warningSoft: 'rgba(234, 88, 12, 0.13)',
  danger: '#DC2626',
  dangerSoft: 'rgba(220, 38, 38, 0.1)',
  /** Macros — the same colour on every ring, bar and chip. */
  protein: '#E11D48',
  carbs: '#A16207',
  fat: '#4F46E5',
};

const dark: Palette = {
  bg: '#0B0F0E',
  surface: '#111615',
  card: '#1A1F1E',
  cardRaised: '#222827',
  border: '#272E2C',
  borderStrong: '#363F3C',
  hairline: 'rgba(229,231,235,0.08)',
  track: 'rgba(229,231,235,0.10)',
  wash: 'rgba(229,231,235,0.04)',
  overlay: 'rgba(11,15,14,0.97)',
  glass: 'rgba(17,22,21,0.74)',
  edge: 'rgba(229,231,235,0.09)',
  scrim: 'rgba(0,0,0,0.62)',
  text: '#E5E7EB',
  textMuted: '#B6BEBC',
  textFaint: '#98A3A0',
  primary: '#10B981',
  primaryDeep: '#0E9F6E',
  primarySoft: 'rgba(16, 185, 129, 0.16)',
  onPrimary: '#03221A',
  accent: '#F59E0B',
  accentSoft: 'rgba(245, 158, 11, 0.16)',
  success: '#A3E635',
  successSoft: 'rgba(163, 230, 53, 0.14)',
  purple: '#C4B5FD',
  purpleSoft: 'rgba(196, 181, 253, 0.16)',
  water: '#38BDF8',
  warning: '#FB923C',
  warningSoft: 'rgba(251, 146, 60, 0.16)',
  danger: '#F87171',
  dangerSoft: 'rgba(248, 113, 113, 0.15)',
  protein: '#FB7185',
  carbs: '#FCD34D',
  fat: '#818CF8',
};

type Gradient = readonly [string, string, ...string[]];

const lightGradients = {
  /** Progress fills only — buttons are solid. */
  primary: ['#10B981', '#047857'] as Gradient,
  /** A quiet lift for feature surfaces. */
  hero: ['#FFFFFF', '#EAF3F0'] as Gradient,
  /** Behind hero art when there is no photo: a soft mint wash. */
  heroMedia: ['#D3F2E5', '#E5F6EF', '#F5FAF8'] as Gradient,
  /** Over imagery so type stays readable — the page colour fading in from below. */
  scrim: ['rgba(245,248,247,0)', 'rgba(245,248,247,0.55)', 'rgba(245,248,247,0.94)'] as Gradient,
  pro: ['#D3F2E5', '#FCE9C3'] as Gradient,
  /** Fresh light falling across the top of every screen. */
  ambient: ['rgba(16,185,129,0.16)', 'rgba(245,158,11,0.06)', 'rgba(245,248,247,0)'] as Gradient,
};

const darkGradients: typeof lightGradients = {
  primary: ['#34D399', '#0E9F6E'],
  hero: ['#1F2625', '#161C1B'],
  /** A deep-sea glow: teal fading to charcoal. */
  heroMedia: ['#0F3A2F', '#132723', '#101716'],
  scrim: ['rgba(11,15,14,0)', 'rgba(11,15,14,0.55)', 'rgba(11,15,14,0.94)'],
  pro: ['#123A30', '#3A2A0E'],
  /** A teal glow from the top of the screen, with a hint of amber. */
  ambient: ['rgba(16,185,129,0.20)', 'rgba(245,158,11,0.05)', 'rgba(11,15,14,0)'],
};

/** The device's or the user's choice, decided once at launch. */
export const scheme: 'light' | 'dark' = (() => {
  const pref = readThemePreference();
  if (pref !== 'system') return pref;
  // Dark is the home mood: only a device that says it is light gets the light palette.
  return Appearance.getColorScheme() === 'light' ? 'light' : 'dark';
})();

export const palettes = { light, dark };
export const colors: Palette = scheme === 'dark' ? dark : light;
export const gradients = scheme === 'dark' ? darkGradients : lightGradients;
export const allGradients = { light: lightGradients, dark: darkGradients };

export type ElevationName = 'flat' | 'card' | 'raised' | 'lifted' | 'modal';

/**
 * Depth, in five steps. Light mode uses soft, cool shadows (small opacity, bigger radius as the
 * level rises). Dark mode uses black, deeper shadows, and gets the rest of its depth from
 * `edgeLight` and the tonal surface steps. Android reads `elevation` instead of the shadow props.
 */
const makeElevation = (tone: 'light' | 'dark'): Record<ElevationName, ViewStyle> => {
  const lit = tone === 'light';
  const color = lit ? '#0B2A22' : '#000000';
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

/** Inter, loaded in the root layout (system font until it's ready): one clean family, with
 * weight doing the work — regular body, semibold labels, bold headings. */
export const fonts = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semibold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

// Android picks the weight from the font file; a fontWeight on top would synthesise a fake bold.
const face = (family: string, weight: TextStyle['fontWeight']): TextStyle => (Platform.OS === 'android' ? { fontFamily: family } : { fontFamily: family, fontWeight: weight });

/** Reference scale: headlines 32/40, subheadings 20/28, body 16/24, caption 14/20. Sizes scale with the OS font size. */
export const type = {
  display: { ...face(fonts.bold, '700'), fontSize: 36, lineHeight: 44, letterSpacing: -0.8 },
  title: { ...face(fonts.bold, '700'), fontSize: 32, lineHeight: 40, letterSpacing: -0.7 },
  heading: { ...face(fonts.semibold, '600'), fontSize: 20, lineHeight: 28, letterSpacing: -0.3 },
  body: { ...face(fonts.regular, '400'), fontSize: 16, lineHeight: 24 },
  bodyStrong: { ...face(fonts.semibold, '600'), fontSize: 16, lineHeight: 24 },
  caption: { ...face(fonts.regular, '400'), fontSize: 14, lineHeight: 20 },
  /** Quiet sentence-case label ("Protein", "Last session"). */
  label: { ...face(fonts.medium, '500'), fontSize: 13, lineHeight: 18 },
  /** Rare uppercase eyebrow ("NEW PERSONAL RECORD"). */
  overline: { ...face(fonts.semibold, '600'), fontSize: 12, lineHeight: 16, letterSpacing: 1.2, textTransform: 'uppercase' },
  number: { ...face(fonts.bold, '700'), fontSize: 32, lineHeight: 40, letterSpacing: -0.6, fontVariant: ['tabular-nums'] },
  /** The big title at the top of a screen. */
  screenTitle: { ...face(fonts.bold, '700'), fontSize: 32, lineHeight: 40, letterSpacing: -0.7 },
  /** A section heading ("Today's fuel"). */
  sectionTitle: { ...face(fonts.semibold, '600'), fontSize: 20, lineHeight: 28, letterSpacing: -0.3 },
  /** A card or sheet title, a step under `title`. */
  titleSm: { ...face(fonts.bold, '700'), fontSize: 24, lineHeight: 32, letterSpacing: -0.4 },
  /** A figure inside a card (calories left, sets done). */
  stat: { ...face(fonts.bold, '700'), fontSize: 22, lineHeight: 28, letterSpacing: -0.4, fontVariant: ['tabular-nums'] },
  /** A large value on its own (a weight, a time). */
  valueLg: { ...face(fonts.bold, '700'), fontSize: 34, lineHeight: 40, letterSpacing: -0.7, fontVariant: ['tabular-nums'] },
} as const satisfies Record<string, TextStyle>;
