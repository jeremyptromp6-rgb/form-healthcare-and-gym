import type { Palette } from '@/theme/tokens';

/**
 * The single source of truth for "what colour means what" on the camera screen (round 4, D1).
 * The feedback strip under the camera and the skeleton drawn over it must agree, so both read
 * their colours from here:
 *   ready  = on track (primary)     adjust = needs a change (warning)     info = neutral (textMuted)
 */
export type HudTone = 'ready' | 'adjust' | 'info';

/** The palette key behind each HUD tone. */
export const HUD_TONE_KEY: Record<HudTone, keyof Palette> = {
  ready: 'primary',
  adjust: 'warning',
  info: 'textMuted',
};

/** The HUD colour for a tone, from the given palette. */
export function hudToneColor(palette: Palette, tone: HudTone): string {
  return palette[HUD_TONE_KEY[tone]];
}

/** The coach's cue tone (good / fix / warn) and "can't track you" mapped onto the HUD tones. */
export const SKELETON_HUD_TONE = {
  good: 'ready',
  fix: 'adjust',
  warn: 'adjust',
  untrackable: 'info',
} as const satisfies Record<string, HudTone>;

/**
 * The palette's colour for each skeleton tone. The strip reads the theme palette and the skeleton
 * reads Evening (it is drawn over video), with the same palette keys per tone, so the two use the
 * same colours in dark mode and only the shades differ in light mode.
 */
export function skeletonToneColors(palette: Palette): { good: string; fix: string; warn: string; untrackable: string } {
  return {
    good: hudToneColor(palette, SKELETON_HUD_TONE.good),
    fix: hudToneColor(palette, SKELETON_HUD_TONE.fix),
    warn: hudToneColor(palette, SKELETON_HUD_TONE.warn),
    untrackable: hudToneColor(palette, SKELETON_HUD_TONE.untrackable),
  };
}
