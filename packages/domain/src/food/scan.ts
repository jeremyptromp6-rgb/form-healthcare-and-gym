import { nutrientsFor, presentMacros } from "../nutrition/calculation";
import { validateMacros, type Macros } from "../nutrition/nutritionCalculator";
import type { ProviderBase, ProviderResult } from "../providers/result";
import type { FoodItem } from "./food";
import { normalizeText } from "./search";

/**
 * Food scanner: photo → recognition → confidence → serving estimate → nutrition estimate →
 * review → confirm → log. Everything a scan produces is an ESTIMATE:
 *
 * - `confidence` is how sure the recogniser is about WHAT the food is;
 * - `accuracy` is how close the NUTRITION numbers are likely to be (portion guess, nutrition
 *   source, hidden oil/sauce). A confidently recognised curry can still have rough numbers.
 *
 * Nothing here pretends to measure. Confirmed items become `scan_estimate` food logs with the
 * `estimated` amount method — a weighed (or label) entry can later supersede them.
 */

// ---- Provider contract ------------------------------------------------------------------

export type ImageQuality = "ok" | "too_dark" | "blurry" | "too_far" | "obstructed";

export interface RecognizedFood {
  label: string;
  /** Identity confidence 0–1 for `label`. */
  confidence: number;
  alternatives: { label: string; confidence: number; per100g: Macros }[];
  /** Estimated portion in grams with an uncertainty range. */
  servingGrams: number;
  servingLowGrams: number;
  servingHighGrams: number;
  /** The recogniser's nutrition reference for `label`, per 100 g. */
  per100g: Macros;
  /** Ingredients likely present but not visible (oil, butter, dressing, sugar…). */
  hiddenIngredients: string[];
  /** A mixed dish (curry, salad, sandwich) rather than a single food. */
  composite: boolean;
}

export interface RecognitionResult {
  imageQuality: ImageQuality;
  containsFood: boolean;
  items: RecognizedFood[];
}

export interface RecognitionImage {
  mimeType: "image/jpeg" | "image/png";
  data: Uint8Array;
}

/**
 * Recognises foods in one photo. Implementations must not retain the image and must return
 * honest uncertainty. A development fallback must say so via `development: true`.
 */
export interface FoodRecognitionProvider extends ProviderBase {
  readonly kind: "food_recognition";
  /** True for a development/test fallback that doesn't actually look at the photo. */
  readonly development: boolean;
  recognize(image: RecognitionImage, opts?: { signal?: AbortSignal }): Promise<ProviderResult<RecognitionResult>>;
}

export const SCAN_LIMITS = {
  maxImageBytes: 5 * 1024 * 1024,
  maxItems: 8,
  maxAlternatives: 3,
  maxServingGrams: 2000,
  /** A scan must be confirmed within this long; after that it's discarded. */
  ttlMs: 24 * 60 * 60 * 1000,
  timeoutMs: 30_000,
} as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round1 = (n: number) => Math.round(n * 10) / 10;

function cleanMacros(m: Macros): Macros | null {
  const v = { kcal: round1(m.kcal), proteinG: round1(m.proteinG), carbsG: round1(m.carbsG), fatG: round1(m.fatG) };
  try {
    validateMacros(v);
  } catch {
    return null;
  }
  // Per-100 g values heavier than the food or denser than pure fat are nonsense.
  if (v.kcal > 950 || v.proteinG + v.carbsG + v.fatG > 105) return null;
  return v;
}

/**
 * Normalises whatever a provider returned into safe, bounded values: clamps confidences and
 * portions, orders the range, drops items without usable nutrition, and caps list sizes.
 * Providers (especially AI ones) are untrusted input.
 */
export function sanitizeRecognition(r: RecognitionResult): RecognitionResult {
  const items: RecognizedFood[] = [];
  for (const it of r.items.slice(0, SCAN_LIMITS.maxItems)) {
    const label = it.label?.trim().slice(0, 80);
    const per100g = cleanMacros(it.per100g);
    if (!label || !per100g) continue;
    const g = clamp(Number.isFinite(it.servingGrams) ? it.servingGrams : 0, 1, SCAN_LIMITS.maxServingGrams);
    const low = clamp(Math.min(it.servingLowGrams, g), 1, g);
    const high = clamp(Math.max(it.servingHighGrams, g), g, SCAN_LIMITS.maxServingGrams);
    items.push({
      label,
      confidence: clamp(Number.isFinite(it.confidence) ? it.confidence : 0, 0, 1),
      alternatives: it.alternatives
        .map((a) => ({ label: a.label?.trim().slice(0, 80), confidence: clamp(a.confidence || 0, 0, 1), per100g: cleanMacros(a.per100g) }))
        .filter((a): a is { label: string; confidence: number; per100g: Macros } => !!a.label && !!a.per100g && normalizeText(a.label) !== normalizeText(label))
        .slice(0, SCAN_LIMITS.maxAlternatives),
      servingGrams: Math.round(g),
      servingLowGrams: Math.round(low),
      servingHighGrams: Math.round(high),
      per100g,
      hiddenIngredients: (it.hiddenIngredients ?? []).map((h) => h.trim().slice(0, 40)).filter(Boolean).slice(0, 6),
      composite: !!it.composite,
    });
  }
  return { imageQuality: r.imageQuality, containsFood: r.containsFood && items.length > 0 ? true : r.containsFood, items };
}

// ---- Catalog matching ---------------------------------------------------------------------

const DESCRIPTORS = new Set([
  "a", "an", "the", "of", "with", "and", "fresh", "grilled", "baked", "roasted", "boiled", "steamed", "sliced", "chopped", "plain",
  "cooked", "raw", "fried", "pan", "homemade", "serving", "portion", "bowl", "plate", "cup", "piece", "pieces", "some", "small", "large", "medium",
]);

const singular = (w: string) => (w.length > 3 && w.endsWith("es") && !w.endsWith("ses") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);
const coreWords = (s: string) => normalizeText(s).split(" ").filter((w) => w && !DESCRIPTORS.has(w)).map(singular);

/**
 * The verified-database food a recognised label refers to, if the match is unambiguous: every
 * meaningful word of the label must appear in the food's name and the food may add at most one
 * other meaningful word. Mixed dishes are never mapped onto a single ingredient.
 */
export function matchCatalogFood<T extends FoodItem>(label: string, foods: readonly T[], opts: { composite?: boolean } = {}): T | null {
  if (opts.composite) return null;
  const want = coreWords(label);
  if (want.length === 0) return null;
  let best: { food: T; extra: number; cooked: boolean } | null = null;
  for (const food of foods) {
    const have = coreWords(food.name);
    if (!want.every((w) => have.includes(w))) continue;
    const extra = have.filter((w) => !want.includes(w)).length;
    if (extra > 1) continue;
    const cooked = /\b(cooked|baked|boiled)\b/i.test(food.name) && !/\braw\b/i.test(label);
    // Fewer extra words wins; a photo shows served food, so prefer cooked entries on ties.
    if (!best || extra < best.extra || (extra === best.extra && cooked && !best.cooked)) best = { food, extra, cooked };
  }
  return best?.food ?? null;
}

// ---- Review -------------------------------------------------------------------------------

export type ScanStatus = "ok" | "no_food" | "poor_image" | "unknown_food";
export type ConfidenceBand = "high" | "medium" | "low";
export type NutritionAccuracy = "reference" | "approximate" | "rough";

export const CONFIDENCE_BANDS = { high: 0.75, medium: 0.45 } as const;

export function confidenceBand(c: number): ConfidenceBand {
  return c >= CONFIDENCE_BANDS.high ? "high" : c >= CONFIDENCE_BANDS.medium ? "medium" : "low";
}

export interface ScanOption {
  key: string;
  label: string;
  confidence: number;
  /** Where the nutrition comes from: the verified database (matched), or the recogniser's estimate. */
  nutritionSource: "verified_database" | "recognizer_estimate";
  foodId: string | null;
  basis: "g" | "ml";
  per100: Macros;
}

export interface ScanReviewItem {
  id: string;
  label: string;
  confidence: number;
  band: ConfidenceBand;
  /** Low confidence: the user must pick an option before it can be logged. */
  needsChoice: boolean;
  options: ScanOption[];
  serving: { amount: number; low: number; high: number; unit: "g" };
  hiddenIngredients: string[];
  composite: boolean;
}

export interface ScanReview {
  status: ScanStatus;
  imageQuality: ImageQuality;
  items: ScanReviewItem[];
}

export function buildScanReview(raw: RecognitionResult, catalog: readonly FoodItem[]): ScanReview {
  const r = sanitizeRecognition(raw);
  if (!r.containsFood) return { status: "no_food", imageQuality: r.imageQuality, items: [] };
  const items: ScanReviewItem[] = r.items.map((it, i) => {
    const option = (key: string, label: string, confidence: number, per100: Macros): ScanOption => {
      const match = matchCatalogFood(label, catalog, { composite: it.composite });
      // Portions are estimated in grams; a drink (ml) match can't take a gram estimate, so keep the recogniser's numbers.
      const usable = match && match.basis === "g" ? match : null;
      return {
        key,
        label,
        confidence,
        nutritionSource: usable ? "verified_database" : "recognizer_estimate",
        foodId: usable?.id ?? null,
        basis: "g",
        per100: usable?.per100 ?? per100,
      };
    };
    const band = confidenceBand(it.confidence);
    return {
      id: `i${i + 1}`,
      label: it.label,
      confidence: it.confidence,
      band,
      needsChoice: band === "low",
      options: [option("primary", it.label, it.confidence, it.per100g), ...it.alternatives.map((a, j) => option(`alt${j + 1}`, a.label, a.confidence, a.per100g))],
      serving: { amount: it.servingGrams, low: it.servingLowGrams, high: it.servingHighGrams, unit: "g" },
      hiddenIngredients: it.hiddenIngredients,
      composite: it.composite,
    };
  });
  if (items.length === 0) return { status: "unknown_food", imageQuality: r.imageQuality, items };
  if (r.imageQuality !== "ok" && items.every((x) => x.band === "low")) return { status: "poor_image", imageQuality: r.imageQuality, items: [] };
  return { status: "ok", imageQuality: r.imageQuality, items };
}

// ---- Nutrition estimate (shared by the review screen and the server) -----------------------

export interface ItemEstimate extends Macros {
  kcalLow: number;
  kcalHigh: number;
  accuracy: NutritionAccuracy;
}

/**
 * Estimated nutrition for an amount, with a range that widens for guessed nutrition, mixed
 * dishes and hidden ingredients. The range is a statement of uncertainty, not precision.
 */
export function estimateItem(item: Pick<ScanReviewItem, "serving" | "hiddenIngredients" | "composite" | "band">, option: Pick<ScanOption, "per100" | "nutritionSource">, amount: number): ItemEstimate {
  const exact = nutrientsFor(option.per100, amount);
  const kcal = exact.kcal;
  // The portion is still a guess, so the range follows the chosen amount proportionally.
  const low = kcal * (item.serving.low / item.serving.amount);
  const high = kcal * (item.serving.high / item.serving.amount);
  const sourceMargin = option.nutritionSource === "verified_database" ? 0.05 : 0.15;
  const hidden = item.composite || item.hiddenIngredients.length > 0;
  const hiddenMargin = hidden ? 0.2 : 0;
  const accuracy: NutritionAccuracy =
    option.nutritionSource === "verified_database" && !hidden && item.band === "high" ? "reference" : hidden || item.band === "low" ? "rough" : "approximate";
  return {
    ...presentMacros(exact),
    kcalLow: Math.max(0, Math.round(low * (1 - sourceMargin))),
    kcalHigh: Math.round(high * (1 + sourceMargin + hiddenMargin)),
    accuracy,
  };
}

// ---- Confirmation -------------------------------------------------------------------------

export interface ScanSelection {
  itemId: string;
  remove?: boolean;
  /** One of the item's options. */
  optionKey?: string;
  /** Or a food the user picked instead (verified database / their own). */
  food?: FoodItem;
  /** Grams (or ml for a picked drink). Defaults to the estimate. */
  amount?: number;
}

export interface ScanLogEntry {
  itemId: string;
  name: string;
  foodId: string | null;
  basis: "g" | "ml";
  /** Full precision. */
  amount: number;
  per100: Macros;
  /** NutritionCalculator result at full precision (rounded only for display). */
  macros: Macros;
}

export class ScanSelectionError extends Error {
  constructor(
    message: string,
    readonly itemId?: string,
  ) {
    super(message);
  }
}

/**
 * Turns the user's review choices into log entries. Every item must be decided: kept with an
 * option (low-confidence items need an explicit choice) or a picked food, or removed. Nutrition
 * always comes from the stored scan or the catalog — never from the client.
 */
export function resolveScanSelections(review: ScanReview, selections: readonly ScanSelection[]): ScanLogEntry[] {
  const byId = new Map(selections.map((s) => [s.itemId, s]));
  for (const s of selections) if (!review.items.some((i) => i.id === s.itemId)) throw new ScanSelectionError("unknown item", s.itemId);
  const out: ScanLogEntry[] = [];
  for (const item of review.items) {
    const sel = byId.get(item.id);
    if (!sel) throw new ScanSelectionError("every detected item needs a decision", item.id);
    if (sel.remove) continue;
    let name: string;
    let foodId: string | null;
    let basis: "g" | "ml" = "g";
    let per100: Macros;
    if (sel.food) {
      ({ name, id: foodId, basis, per100 } = sel.food);
    } else {
      const opt = item.options.find((o) => o.key === (sel.optionKey ?? (item.needsChoice ? undefined : "primary")));
      if (!opt) throw new ScanSelectionError(item.needsChoice ? "we weren't sure what this is — choose the right food" : "unknown option", item.id);
      ({ label: name, foodId, per100 } = opt);
    }
    const amount = sel.amount ?? item.serving.amount;
    if (!Number.isFinite(amount) || amount <= 0 || amount > SCAN_LIMITS.maxServingGrams) throw new ScanSelectionError("that amount isn't plausible", item.id);
    out.push({ itemId: item.id, name, foodId, basis, amount, per100, macros: nutrientsFor(per100, amount) });
  }
  if (out.length === 0) throw new ScanSelectionError("nothing left to log — keep at least one item or discard the scan");
  return out;
}

// ---- Development fallback -------------------------------------------------------------------

/**
 * Development/test fallback. It does NOT look at the photo: it returns the same clearly labelled
 * sample meal every time so the scan → review → log flow can be exercised without a real
 * recogniser. It reports itself as development, and the app must say so on screen.
 */
export function developmentRecognitionProvider(): FoodRecognitionProvider {
  return {
    kind: "food_recognition",
    development: true,
    status: () => ({ state: "ready", provider: "Development sample (not real recognition)" }),
    recognize: async () => ({
      ok: true,
      value: {
        imageQuality: "ok",
        containsFood: true,
        items: [
          {
            label: "Chicken breast",
            confidence: 0.86,
            alternatives: [{ label: "Turkey breast", confidence: 0.1, per100g: { kcal: 147, proteinG: 30, carbsG: 0, fatG: 2 } }],
            servingGrams: 150,
            servingLowGrams: 110,
            servingHighGrams: 200,
            per100g: { kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6 },
            hiddenIngredients: ["cooking oil"],
            composite: false,
          },
          {
            label: "White rice",
            confidence: 0.64,
            alternatives: [{ label: "Brown rice", confidence: 0.2, per100g: { kcal: 123, proteinG: 2.7, carbsG: 25.6, fatG: 1 } }],
            servingGrams: 180,
            servingLowGrams: 130,
            servingHighGrams: 240,
            per100g: { kcal: 130, proteinG: 2.7, carbsG: 28.2, fatG: 0.3 },
            hiddenIngredients: [],
            composite: false,
          },
          {
            label: "Green vegetables",
            confidence: 0.35,
            alternatives: [
              { label: "Broccoli", confidence: 0.3, per100g: { kcal: 35, proteinG: 2.4, carbsG: 7.2, fatG: 0.4 } },
              { label: "Green beans", confidence: 0.2, per100g: { kcal: 35, proteinG: 1.9, carbsG: 7.9, fatG: 0.3 } },
            ],
            servingGrams: 80,
            servingLowGrams: 50,
            servingHighGrams: 120,
            per100g: { kcal: 35, proteinG: 2.4, carbsG: 7, fatG: 0.4 },
            hiddenIngredients: [],
            composite: false,
          },
        ],
      },
    }),
  };
}
