import { DEFAULT_BAR_KG, KG_BARS, LB_BARS } from '@form/domain';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useState } from 'react';
import { loadFromDisplay, loadUnit, type Units } from './units';

/**
 * The barbell's weight for the plate calculator and warm-up sets, remembered on this device (one value
 * per unit system, in that system's numbers: 20 or 15 kg, 45 or 35 lb). Where the secure store isn't
 * there (web, a failing keystore) it lives for the session only.
 */

type Unit = 'kg' | 'lb';

/** The bars offered in the user's units; the first is the default. */
export const barOptions = (units: Units): readonly number[] => (units === 'imperial' ? LB_BARS : KG_BARS);

const key = (unit: Unit) => `form.barWeight.${unit}`;
const memory = new Map<Unit, number>();

const valid = (units: Units, n: number) => barOptions(units).includes(n);

export async function readBarWeight(units: Units): Promise<number> {
  const unit = loadUnit(units);
  const cached = memory.get(unit);
  if (cached !== undefined) return cached;
  try {
    const n = Number(await SecureStore.getItemAsync(key(unit)));
    if (valid(units, n)) return n;
  } catch {
    // Fall through to the default.
  }
  return barOptions(units)[0];
}

export async function writeBarWeight(units: Units, bar: number): Promise<void> {
  if (!valid(units, bar)) return;
  const unit = loadUnit(units);
  memory.set(unit, bar);
  try {
    await SecureStore.setItemAsync(key(unit), String(bar));
  } catch {
    // Not persisted: the in-memory value above still holds for this session.
  }
}

/** Test hook: forget the in-session values. */
export function resetBarWeightMemory(): void {
  memory.clear();
}

/** The bar's kg weight for a bar given in display units. */
export const barKgOf = (bar: number, units: Units): number => loadFromDisplay(bar, units) || DEFAULT_BAR_KG;

/** The saved bar weight in display units (the default until it has been read) and a way to change it. */
export function useBarWeight(units: Units): { bar: number; setBar: (bar: number) => void } {
  // What was read or chosen this session, per unit system; before that, the in-session value or the default.
  const [saved, setSaved] = useState<Partial<Record<Unit, number>>>({});
  const unit = loadUnit(units);
  useEffect(() => {
    let live = true;
    readBarWeight(units).then((v) => live && setSaved((s) => ({ ...s, [unit]: v })));
    return () => {
      live = false;
    };
  }, [units, unit]);
  const setBar = useCallback(
    (next: number) => {
      setSaved((s) => ({ ...s, [unit]: next }));
      void writeBarWeight(units, next);
    },
    [units, unit],
  );
  return { bar: saved[unit] ?? memory.get(unit) ?? barOptions(units)[0], setBar };
}
