import { photosOfPose, type PhotoPose, type ProgressPhoto } from '@/lib/progressPhotos';

/** The part of the slider's width that shows the "before" photo, always within 0..1. */
export const clampFraction = (f: number): number => (Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0.5);

/** A touch at `x` (from the slider's left edge) over a slider `width` wide. A zero-width slider rests in the middle. */
export const fractionFromX = (x: number, width: number): number => (width > 0 ? clampFraction(x / width) : 0.5);

/** Screen-reader steps: one notch is a tenth of the width. */
export const SLIDER_STEP = 0.1;
export const stepFraction = (f: number, direction: 1 | -1): number => clampFraction(Math.round((f + direction * SLIDER_STEP) * 100) / 100);

/** What a screen reader says about the slider position. */
export const sliderValueText = (f: number): string => `${Math.round(clampFraction(f) * 100)} percent before`;

/** Oldest and newest photo of a pose, or null while there are fewer than two to compare. */
export function defaultPair(photos: readonly ProgressPhoto[], pose: PhotoPose): { before: ProgressPhoto; after: ProgressPhoto } | null {
  const of = photosOfPose(photos, pose);
  return of.length >= 2 ? { before: of[0]!, after: of[of.length - 1]! } : null;
}
