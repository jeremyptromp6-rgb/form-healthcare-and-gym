import type { ChartModel, XpLedgerEntry } from './types';

/**
 * "Rank over time": the user's XP after each day, rebuilt from the XP ledger they already have.
 * The ledger is walked newest to oldest from today's total, so the line always ends exactly at the
 * XP shown on the rank badge — and starts again from zero at a fresh start (reset).
 */

export type RankRange = '1M' | '3M' | 'All';

export const RANGE_DAYS: Record<RankRange, number | null> = { '1M': 30, '3M': 90, All: null };

export interface XpPoint {
  date: string;
  xp: number;
}

const DAY = 86_400_000;
const at = (date: string) => new Date(`${date}T12:00:00Z`).getTime();
export const addDays = (date: string, n: number) => new Date(at(date) + n * DAY).toISOString().slice(0, 10);

/**
 * End-of-day XP for each day with a change, oldest first, ending at `totalXp` today.
 * `events` is newest first (as the server sends them); `provisionalXp` is today's food XP, which
 * is in `totalXp` but not in the ledger yet. `complete` is false when the list ran out before the
 * start of the current run of XP, so the earliest history isn't shown.
 */
export function xpTimeline(events: readonly XpLedgerEntry[], totalXp: number, provisionalXp: number, today: string, limit = 100): { points: XpPoint[]; complete: boolean } {
  let running = Math.max(0, totalXp - provisionalXp);
  const byDay = new Map<string, number>();
  let complete = events.length < limit;
  for (const e of events) {
    const day = e.localDate ?? e.at.slice(0, 10);
    if (e.kind === 'reset') {
      if (!byDay.has(day)) byDay.set(day, 0);
      complete = true;
      break;
    }
    if (!byDay.has(day)) byDay.set(day, running);
    running = Math.max(0, running - e.xp);
  }
  byDay.set(today, Math.max(0, totalXp));
  const points = [...byDay.entries()].map(([date, xp]) => ({ date, xp })).sort((a, b) => a.date.localeCompare(b.date));
  return { points, complete };
}

const MAX_POINTS = 120;

/** The line chart for a range: a point for every day (carrying the last XP forward), thinned for long spans. */
export function rankChart(points: readonly XpPoint[], range: RankRange, today: string): ChartModel {
  const days = RANGE_DAYS[range];
  const first = points[0]?.date ?? today;
  const start = days === null ? first : addDays(today, -days) > first ? addDays(today, -days) : first;
  const span = Math.max(0, Math.round((at(today) - at(start)) / DAY));
  const step = Math.max(1, Math.ceil((span + 1) / MAX_POINTS));

  const dated: { key: string; value: number | null }[] = [];
  let i = 0;
  let carried: number | null = null;
  for (let d = 0; d <= span; d++) {
    const key = addDays(start, d);
    while (i < points.length && points[i]!.date <= key) carried = points[i++]!.xp;
    // Before the first known day there is nothing to draw; a window that starts inside the history carries the XP in.
    dated.push({ key, value: carried });
  }
  const thinned = dated.filter((_, idx) => idx % step === 0 || idx === dated.length - 1);
  const withData = thinned.filter((p) => p.value !== null).length;
  return {
    id: 'rank-over-time',
    title: 'XP over time',
    unit: 'XP',
    trendUnit: 'XP',
    kind: 'line',
    granularity: 'day',
    points: thinned.map((p) => ({ ...p, estimated: false, partial: false })),
    target: null,
    trend: { direction: 'insufficient_data', movement: null, from: null, to: null, change: null, changePercent: null, points: withData, spanDays: span, reason: withData < 2 ? 'too_few_points' : null },
    state: withData === 0 ? 'no_data' : withData < 2 ? 'insufficient_data' : 'ok',
  };
}

/** XP gained across a chart's window, for the caption under it. */
export function xpChange(chart: ChartModel): number | null {
  const vals = chart.points.map((p) => p.value).filter((v): v is number => v !== null);
  return vals.length < 2 ? null : vals[vals.length - 1]! - vals[0]!;
}
