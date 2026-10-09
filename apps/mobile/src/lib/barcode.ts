import { USER_FOOD_LIMITS } from '@form/domain';
import { Platform } from 'react-native';

/**
 * Barcode → food, via Open Food Facts (a free, open database of packaged-food labels). The phone
 * looks the code up itself — Open Food Facts limits reads per internet address, so each user's
 * own connection keeps the limit theirs. The result is a DRAFT of a "my food": the user checks
 * it against the pack and saves it through the normal New food form. Nothing is logged unseen.
 */

export interface BarcodeFoodDraft {
  code: string;
  name: string;
  brand: string | null;
  basis: 'g' | 'ml';
  servingLabel: string;
  servingAmount: number;
  perServing: { kcal: number; proteinG: number; carbsG: number; fatG: number };
}

export type BarcodeLookup =
  | { ok: true; draft: BarcodeFoodDraft }
  | { ok: false; kind: 'invalid' | 'not_found' | 'no_nutrition' | 'rate_limited' | 'network'; message: string };

export const BARCODE_TYPES = ['ean13', 'ean8', 'upc_a', 'upc_e'] as const;

const OFF_URL = 'https://world.openfoodfacts.org/api/v2/product';
const FIELDS = 'code,product_name,brands,quantity,product_quantity_unit,serving_size,serving_quantity,nutriments';
/** Open Food Facts asks every app to identify itself. (Browsers set their own User-Agent.) */
const USER_AGENT = 'FORM/0.1 (https://github.com/jeremyptromp6-rgb/form-healthcare-and-gym)';

const MESSAGES = {
  invalid: "That doesn't look like a product barcode. Try scanning again, or type the number.",
  not_found: "This product isn't in Open Food Facts yet. You can add it yourself from the label.",
  no_nutrition: 'This product has no nutrition information yet. You can add it yourself from the label.',
  rate_limited: 'Too many lookups in a minute. Wait a moment and try again.',
  network: "Couldn't reach the food database. Check your connection and try again.",
} as const;

/**
 * Digits only. A UPC-E code (the short 8-digit barcode on small US packs) is expanded to its
 * 12-digit UPC-A form — that's the number the database knows, and what its check digit covers.
 */
export function normaliseBarcode(raw: string, type?: string): string {
  const d = raw.replace(/\D/g, '');
  if (type !== 'upc_e' || d.length !== 8) return d;
  const [s, x1, x2, x3, x4, x5, x6, c] = d.split('');
  const body =
    x6 === '0' || x6 === '1' || x6 === '2'
      ? `${x1}${x2}${x6}0000${x3}${x4}${x5}`
      : x6 === '3'
        ? `${x1}${x2}${x3}00000${x4}${x5}`
        : x6 === '4'
          ? `${x1}${x2}${x3}${x4}00000${x5}`
          : `${x1}${x2}${x3}${x4}${x5}0000${x6}`;
  return `${s}${body}${c}`;
}

/** EAN-8, UPC-A (12), EAN-13 and GTIN-14 with a valid check digit. */
export function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

type OffProduct = {
  product_name?: string;
  brands?: string;
  quantity?: string;
  product_quantity_unit?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: Record<string, unknown>;
};

/** Turns an Open Food Facts product response into a food draft — or says why it can't. */
export function draftFromOpenFoodFacts(code: string, response: { status?: number; product?: OffProduct } | null): BarcodeLookup {
  const p = response?.status === 1 ? response.product : undefined;
  if (!p) return { ok: false, kind: 'not_found', message: MESSAGES.not_found };
  const n = p.nutriments ?? {};
  // Calories as listed; if only kilojoules are given (energy_100g is in kJ), convert them.
  const kj = num(n['energy-kj_100g']) ?? num(n['energy_100g']);
  const kcal = num(n['energy-kcal_100g']) ?? (kj !== null ? round1(kj / 4.184) : null);
  const protein = num(n['proteins_100g']);
  const carbs = num(n['carbohydrates_100g']);
  const fat = num(n['fat_100g']);
  if (kcal === null && protein === null && carbs === null && fat === null) return { ok: false, kind: 'no_nutrition', message: MESSAGES.no_nutrition };

  const isDrink = p.product_quantity_unit === 'ml' || /\b\d+(?:[.,]\d+)?\s?(?:ml|cl|l)\b/i.test(p.quantity ?? '');
  const basis: 'g' | 'ml' = isDrink ? 'ml' : 'g';
  const serving = num(p.serving_quantity);
  const servingAmount = serving !== null && serving >= 1 && serving <= USER_FOOD_LIMITS.maxServingAmount ? serving : 100;
  const servingLabel = (servingAmount === serving && p.serving_size?.trim() ? p.serving_size.trim() : `100 ${basis}`).slice(0, USER_FOOD_LIMITS.servingLabelLength);
  const scale = servingAmount / 100;
  const brand = p.brands?.split(',')[0]?.trim() || null;

  return {
    ok: true,
    draft: {
      code,
      name: (p.product_name?.trim() || `Product ${code}`).slice(0, USER_FOOD_LIMITS.nameLength),
      brand: brand ? brand.slice(0, USER_FOOD_LIMITS.brandLength) : null,
      basis,
      servingLabel,
      servingAmount,
      perServing: {
        kcal: round1((kcal ?? 0) * scale),
        proteinG: round1((protein ?? 0) * scale),
        carbsG: round1((carbs ?? 0) * scale),
        fatG: round1((fat ?? 0) * scale),
      },
    },
  };
}

/** Looks a scanned (or typed) barcode up in Open Food Facts. */
export async function lookupBarcode(raw: string, opts: { type?: string; fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<BarcodeLookup> {
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  let code = normaliseBarcode(raw, opts.type);
  // Some scanners report a UPC-E code without saying so: 8 digits that only check out once expanded.
  if (code.length === 8 && !isValidGtin(code) && isValidGtin(normaliseBarcode(code, 'upc_e'))) code = normaliseBarcode(code, 'upc_e');
  if (!isValidGtin(code)) return { ok: false, kind: 'invalid', message: MESSAGES.invalid };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const get = (c: string) =>
    doFetch(`${OFF_URL}/${c}.json?fields=${FIELDS}`, {
      headers: Platform.OS === 'web' ? {} : { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
  try {
    let res = await get(code);
    let found = res.ok ? ((await res.json().catch(() => null)) as { status?: number; product?: OffProduct } | null) : null;
    // A 12-digit UPC-A is often filed under its 13-digit form (a leading 0).
    if (code.length === 12 && (res.status === 404 || (res.ok && found?.status !== 1))) {
      const padded = await get(`0${code}`);
      if (padded.ok || padded.status === 404) {
        res = padded;
        found = padded.ok ? ((await padded.json().catch(() => null)) as typeof found) : null;
        if (found?.status === 1) code = `0${code}`;
      }
    }
    if (res.status === 429) return { ok: false, kind: 'rate_limited', message: MESSAGES.rate_limited };
    if (res.status === 404) return { ok: false, kind: 'not_found', message: MESSAGES.not_found };
    if (!res.ok) return { ok: false, kind: 'network', message: MESSAGES.network };
    return draftFromOpenFoodFacts(code, found);
  } catch {
    return { ok: false, kind: 'network', message: MESSAGES.network };
  } finally {
    clearTimeout(timer);
  }
}
