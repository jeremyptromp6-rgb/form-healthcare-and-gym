import { estimateItem, type FoodItem, type ItemEstimate, type ScanOption, type ScanReviewItem } from '@form/domain';
import type { FoodScan } from './types';

/**
 * Scan review state and display logic. The estimates shown here use the same domain function as
 * the server, but the server recomputes everything from the stored scan when it's confirmed.
 */

export interface ItemChoice {
  /** An option key ("primary", "alt1"…), a food picked instead, or null = not chosen yet. */
  option: string | null;
  food: FoodItem | null;
  amount: number;
  removed: boolean;
}

export type ReviewState = Record<string, ItemChoice>;

/** Confident items start on their best guess; low-confidence items wait for the user's choice. */
export function initialReview(scan: Pick<FoodScan, 'items'>): ReviewState {
  return Object.fromEntries(scan.items.map((i) => [i.id, { option: i.needsChoice ? null : 'primary', food: null, amount: i.serving.amount, removed: false }]));
}

/** The nutrition source for a choice: the picked food, or one of the scan's options. */
export function chosenOption(item: ScanReviewItem, c: ItemChoice): Pick<ScanOption, 'per100' | 'nutritionSource'> & { label: string } | null {
  if (c.food) return { label: c.food.name, per100: c.food.per100, nutritionSource: 'verified_database' };
  const o = item.options.find((x) => x.key === c.option);
  return o ? { label: o.label, per100: o.per100, nutritionSource: o.nutritionSource } : null;
}

export function itemEstimate(item: ScanReviewItem, c: ItemChoice): ItemEstimate | null {
  const opt = chosenOption(item, c);
  if (!opt || !(c.amount > 0)) return null;
  return estimateItem(item, opt, c.amount);
}

export function reviewSummary(scan: Pick<FoodScan, 'items'>, state: ReviewState) {
  let kcal = 0;
  let low = 0;
  let high = 0;
  let kept = 0;
  const undecided: string[] = [];
  for (const item of scan.items) {
    const c = state[item.id]!;
    if (c.removed) continue;
    const est = itemEstimate(item, c);
    if (!est) {
      undecided.push(item.id);
      continue;
    }
    kept++;
    kcal += est.kcal;
    low += est.kcalLow;
    high += est.kcalHigh;
  }
  return { kcal, kcalLow: low, kcalHigh: high, kept, undecided, canConfirm: kept > 0 && undecided.length === 0 };
}

/** The confirm request: which option, which food, how much — never nutrition numbers. */
export function confirmItems(scan: Pick<FoodScan, 'items'>, state: ReviewState) {
  return scan.items.map((item) => {
    const c = state[item.id]!;
    if (c.removed) return { itemId: item.id, remove: true };
    if (c.food) return { itemId: item.id, foodId: c.food.id, amount: c.amount };
    return { itemId: item.id, optionKey: c.option ?? undefined, amount: c.amount };
  });
}

export const CONFIDENCE_LABEL = { high: 'Likely', medium: 'Probably', low: 'Not sure' } as const;
export const ACCURACY_LABEL = {
  reference: 'Nutrition: reference values',
  approximate: 'Nutrition: approximate',
  rough: 'Nutrition: rough — may include hidden oil, sauce or other ingredients',
} as const;

const QUALITY_ADVICE: Record<string, string> = {
  too_dark: 'The photo is too dark — find more light and try again.',
  blurry: 'The photo is blurry — hold steady and try again.',
  too_far: 'The food is too far away — move closer so it fills the frame.',
  obstructed: 'Something is covering the food — clear the view and try again.',
};

/** What to tell the user for a scan that has nothing reviewable. */
export function statusMessage(scan: Pick<FoodScan, 'status' | 'imageQuality'>): { title: string; message: string } | null {
  switch (scan.status) {
    case 'no_food':
      return { title: 'No food found', message: 'We couldn’t see any food in this photo. Retake it with the meal in view.' };
    case 'poor_image':
      return { title: 'We couldn’t read this photo', message: QUALITY_ADVICE[scan.imageQuality] ?? 'Try a clearer photo.' };
    case 'unknown_food':
      return { title: 'We couldn’t identify this', message: 'Search for the food instead, or retake the photo from above in good light.' };
    default:
      return null;
  }
}

export function qualityNote(scan: Pick<FoodScan, 'status' | 'imageQuality'>): string | null {
  return scan.status === 'ok' && scan.imageQuality !== 'ok' ? (QUALITY_ADVICE[scan.imageQuality] ?? null) : null;
}

/** Maps a failed scan request to what the user can do next. */
export function scanErrorMessage(e: { kind: string; code: string; message: string }): { message: string; retry: boolean; needsConsent?: boolean; pro?: boolean } {
  // The Free daily allowance is used up: say so (the server's words), keep manual logging one tap away.
  if (e.code === 'pro_required') return { message: e.message, retry: false, pro: true };
  if (e.code === 'scan_consent_required')
    return { message: 'Scanning sends this photo to an outside recognition service to identify the food. FORM doesn’t keep the photo; the service may use it to improve its products. Allow scanning to continue — you can turn it off any time in Settings.', retry: false, needsConsent: true };
  if (e.kind === 'network') return { message: 'No connection — your photo is kept. Try again.', retry: true };
  if (e.code === 'scan_timeout') return { message: 'Recognition took too long. Try again.', retry: true };
  if (e.code === 'food_scan_unavailable') return { message: 'Food scanning isn’t available right now. Search for your food instead.', retry: false };
  if (e.code === 'scan_limit') return { message: e.message, retry: false };
  if (e.code === 'invalid_image' || e.code === 'image_too_large') return { message: 'That photo couldn’t be used. Take another one.', retry: false };
  if (e.code === 'provider_rate_limited' || e.code === 'provider_network' || e.code === 'provider_unavailable') return { message: 'Recognition is busy. Try again in a moment.', retry: true };
  if (e.code === 'provider_invalid_input') return { message: 'This photo couldn’t be analysed. Try another photo, or search for the food.', retry: false };
  return { message: e.message, retry: false };
}
