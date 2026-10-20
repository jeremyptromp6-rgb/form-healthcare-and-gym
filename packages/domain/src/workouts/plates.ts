/**
 * Plate calculator. Which plates go on each side of a barbell for a target load. Pure and unit-free:
 * every number is in one unit (kg or lb), whichever the bar and plates are given in.
 */

/** Plates a gym usually has, heaviest first. */
export const KG_PLATES: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25];
export const LB_PLATES: readonly number[] = [45, 35, 25, 10, 5, 2.5];
/** Common bars: 20 / 15 kg, 45 / 35 lb. The first is the default. */
export const KG_BARS: readonly number[] = [20, 15];
export const LB_BARS: readonly number[] = [45, 35];

export interface PlateLoad {
  bar: number;
  /** Plates on each side, heaviest first (repeats for a pair of the same plate on the stack). */
  perSide: number[];
  /** The same, grouped: [{ plate: 20, count: 1 }, ...]. */
  stacks: { plate: number; count: number }[];
  /** Bar plus both sides, the load actually on the bar. */
  loaded: number;
  /** Target minus loaded when the plates can't make the target exactly (never negative). */
  remainder: number;
  /** The target is lighter than the empty bar; the bar alone is shown. */
  belowBar: boolean;
  exact: boolean;
}

/** Hundredths, so 1.25 plates add up without floating-point drift. */
const h = (n: number) => Math.round(n * 100);

/**
 * Plates per side for `target` on a bar of `bar`, taking the heaviest plate that still fits each time.
 * Exact when the plates allow it; otherwise the nearest load below the target, with `remainder` the gap.
 */
export function platesPerSide(target: number, bar: number, plates: readonly number[]): PlateLoad {
  const sorted = [...plates].filter((p) => p > 0).sort((a, b) => b - a);
  const targetH = h(target);
  const barH = h(bar);
  if (!(target > 0) || targetH <= barH) {
    return { bar, perSide: [], stacks: [], loaded: bar, remainder: 0, belowBar: targetH < barH, exact: targetH >= barH };
  }
  let left = Math.floor((targetH - barH) / 2);
  const perSide: number[] = [];
  for (const plate of sorted) {
    const ph = h(plate);
    while (left >= ph) {
      perSide.push(plate);
      left -= ph;
    }
  }
  const stacks: { plate: number; count: number }[] = [];
  for (const plate of perSide) {
    const top = stacks[stacks.length - 1];
    if (top && top.plate === plate) top.count += 1;
    else stacks.push({ plate, count: 1 });
  }
  const loadedH = barH + 2 * perSide.reduce((s, p) => s + h(p), 0);
  return { bar, perSide, stacks, loaded: loadedH / 100, remainder: (targetH - loadedH) / 100, belowBar: false, exact: loadedH === targetH };
}
