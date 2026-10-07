import { cmToFtIn, formatMeasure, fromDisplay, ftInToCm, kgToLb, lbToKg, toDisplay } from '@form/domain';

/**
 * Display units. The API stores metric only; the app converts at the edges (input and display),
 * using the domain's measurement module — the one place unit conversion lives.
 */

export type Units = 'metric' | 'imperial';
export { cmToFtIn, ftInToCm, kgToLb, lbToKg };

export function formatWeight(kg: number, units: Units): string {
  return formatMeasure(kg, 'body_weight', units);
}

export function formatHeight(cm: number, units: Units): string {
  return formatMeasure(cm, 'height', units);
}

/** Parses a user-typed number, accepting a comma decimal separator. NaN when not a number. */
export function parseNumber(text: string): number {
  const t = text.trim().replace(',', '.');
  return t === '' || !/^\d*\.?\d+$/.test(t) ? NaN : Number(t);
}

/** Weight input → kg (rounded to 0.01 so imperial entries round-trip). */
export function weightInputToKg(text: string, units: Units): number {
  const n = parseNumber(text);
  return Number.isNaN(n) ? NaN : fromDisplay(n, 'body_weight', units);
}

/** Height input → cm (rounded to 0.01). Imperial takes feet and inches separately. */
export function heightInputToCm(input: { cm?: string; ft?: string; inches?: string }, units: Units): number {
  if (units === 'metric') {
    const n = parseNumber(input.cm ?? '');
    return Number.isNaN(n) ? NaN : fromDisplay(n, 'height', 'metric');
  }
  const ft = parseNumber(input.ft ?? '');
  const inches = (input.inches ?? '').trim() === '' ? 0 : parseNumber(input.inches ?? '');
  if (!(inches >= 0 && inches < 12)) return NaN;
  return Math.round(ftInToCm(ft, inches) * 100) / 100;
}

/** Initial text for editing a stored value in the user's units. */
export function weightToInput(kg: number | null, units: Units): string {
  return kg === null ? '' : String(toDisplay(kg, 'body_weight', units).value);
}

export function heightToInput(cm: number | null, units: Units): { cm: string; ft: string; inches: string } {
  if (cm === null) return { cm: '', ft: '', inches: '' };
  const { ft, inches } = cmToFtIn(cm);
  return { cm: String(Math.round(cm * 10) / 10), ft: String(ft), inches: String(inches) };
}
