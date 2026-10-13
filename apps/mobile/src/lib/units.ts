import { cmToFtIn, formatMeasure, fromDisplay, ftInToCm, kgToLb, lbToKg, toDisplay } from '@form/domain';
import { QueryClientContext } from '@tanstack/react-query';
import { useContext, useSyncExternalStore } from 'react';
import type { Me } from './types';

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

// ---- Lifting loads ------------------------------------------------------------------------
// Loads are stored in kg. Imperial users see and type pounds; conversion happens only here.

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/** "kg" or "lb": the unit lifting loads are shown and typed in. */
export const loadUnit = (units: Units): 'kg' | 'lb' => (units === 'imperial' ? 'lb' : 'kg');

/**
 * A stored load (kg) in display units. Metric is shown as stored (to 0.01); pounds to 0.1, which
 * round-trips exactly through loadFromDisplay (kg is kept to 0.01 = 0.022 lb), so 135 lb stays 135.
 */
export function loadToDisplay(kg: number, units: Units): number {
  return units === 'imperial' ? round(kgToLb(kg), 1) : round(kg, 2);
}

/** A load typed in display units → kg, kept to 0.01 (135 lb → 61.23 kg). */
export function loadFromDisplay(value: number, units: Units): number {
  return round(units === 'imperial' ? lbToKg(value) : value, 2);
}

/**
 * A suggested load (a plan target, last time's set) as a round number in the user's units: the
 * nearest 0.5 lb for imperial (a 20 kg plan reads 44 lb, not 44.1), unchanged for metric. Returns kg.
 */
export function snapLoadKg(kg: number, units: Units): number {
  return units === 'imperial' ? loadFromDisplay(Math.round(kgToLb(kg) * 2) / 2, units) : kg;
}

/** A stepper step in display units: the exercise's kg increment, or the nearest usual plate step in pounds. */
export function loadStep(stepKg: number, units: Units): number {
  if (units !== 'imperial') return stepKg;
  const lb = kgToLb(stepKg);
  return [1, 2.5, 5, 10, 15, 20, 25].reduce((best, c) => (Math.abs(c - lb) < Math.abs(best - lb) ? c : best));
}

/** A load as text: "22.5 kg", "135 lb". `target` rounds suggestions (plan targets, last time) to a round number. */
export function formatLoad(kg: number, units: Units, target = false): string {
  return `${loadToDisplay(target ? snapLoadKg(kg, units) : kg, units)} ${loadUnit(units)}`;
}

/** Total weight moved, whole units: "1,230 kg" / "2,712 lb". */
export function formatVolume(kg: number, units: Units): { value: string; unit: 'kg' | 'lb' } {
  return { value: Math.round(units === 'imperial' ? kgToLb(kg) : kg).toLocaleString(), unit: loadUnit(units) };
}

/**
 * The user's units for lifting screens, read from the cached profile (the app keeps it loaded from the
 * root layout). `override` wins, so pure views can be given units directly; without either: metric.
 */
export function useUnits(override?: Units): Units {
  const client = useContext(QueryClientContext);
  const cached = useSyncExternalStore(
    (notify) => (client ? client.getQueryCache().subscribe(notify) : () => {}),
    // The key is qk.me in queries.ts, repeated here so this module never imports the hooks.
    () => client?.getQueryData<Pick<Me, 'settings'>>(['me'])?.settings.units,
    () => undefined,
  );
  return override ?? cached ?? 'metric';
}
