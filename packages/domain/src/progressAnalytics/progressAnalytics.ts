import { addDays, dayNumber, weekStart } from "../shared/dates";
import { KG_PER_LB } from "../shared/measurement";
import type { Goal } from "../nutrition/nutritionCalculator";
import type { PrimaryGoal } from "../users/profileOptions";

/**
 * Progress analytics — pure building blocks for the ProgressAnalyticsService.
 *
 * Ranges are whole local days in the user's own time zone (the server passes "today" from the
 * user's stored zone; every record carries its local date). Trends come from a least-squares fit
 * over the actual points, judged in each metric's own direction, and are reported as
 * INSUFFICIENT_DATA rather than guessed when there are too few points or too short a span. Nothing
 * here estimates body composition or ranks the user against other people.
 */

export const ANALYTICS_RANGES = [7, 30, 90] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export const TREND = { IMPROVING: "improving", STABLE: "stable", DECLINING: "declining", INSUFFICIENT_DATA: "insufficient_data" } as const;
export type TrendDirection = (typeof TREND)[keyof typeof TREND];

export type AnalyticsUnit = "kg" | "reps" | "score" | "%" | "kcal" | "g" | "xp" | "days" | "workouts" | "count" | "minutes";
export type Granularity = "day" | "week" | "month";

export interface MetricSpec {
  id: string;
  label: string;
  unit: AnalyticsUnit;
  /** Which way is better: up, down, or staying near where it was (e.g. weight on a maintain goal). */
  direction: "higher" | "lower" | "steady";
  /** A change smaller than this is "stable": max(abs, rel × |mean|). */
  stableBand: { abs: number; rel: number };
  minPoints: number;
  /** Days between the first and last point needed before a trend is claimed. */
  minSpanDays: number;
}

export const METRICS = {
  strength: { id: "strength", label: "Strength", unit: "kg", direction: "higher", stableBand: { abs: 0.5, rel: 0.02 }, minPoints: 3, minSpanDays: 7 },
  strength_reps: { id: "strength_reps", label: "Verified reps per set", unit: "reps", direction: "higher", stableBand: { abs: 0.5, rel: 0.05 }, minPoints: 3, minSpanDays: 7 },
  form: { id: "form", label: "Form score", unit: "score", direction: "higher", stableBand: { abs: 2, rel: 0 }, minPoints: 3, minSpanDays: 5 },
  rom: { id: "rom", label: "Range of motion", unit: "%", direction: "higher", stableBand: { abs: 2, rel: 0 }, minPoints: 3, minSpanDays: 5 },
  verified_reps: { id: "verified_reps", label: "Verified reps", unit: "reps", direction: "higher", stableBand: { abs: 5, rel: 0.1 }, minPoints: 3, minSpanDays: 7 },
  consistency: { id: "consistency", label: "Training days vs plan", unit: "%", direction: "higher", stableBand: { abs: 5, rel: 0 }, minPoints: 2, minSpanDays: 7 },
  kcal_deviation: { id: "kcal_deviation", label: "Distance from calorie target", unit: "%", direction: "lower", stableBand: { abs: 3, rel: 0 }, minPoints: 4, minSpanDays: 5 },
  protein: { id: "protein", label: "Protein vs target", unit: "%", direction: "higher", stableBand: { abs: 5, rel: 0 }, minPoints: 4, minSpanDays: 5 },
  xp: { id: "xp", label: "XP earned", unit: "xp", direction: "higher", stableBand: { abs: 10, rel: 0.1 }, minPoints: 2, minSpanDays: 7 },
  body_quest: { id: "body_quest", label: "Body Quest overall", unit: "score", direction: "higher", stableBand: { abs: 3, rel: 0 }, minPoints: 2, minSpanDays: 7 },
} as const satisfies Record<string, MetricSpec>;

/** Weight is judged only against the user's own energy goal — never as "good" or "bad" in itself. */
export function weightSpec(energyGoal: Goal | null): MetricSpec {
  const direction = energyGoal === "lose" ? "lower" : energyGoal === "gain" ? "higher" : "steady";
  return { id: "weight", label: "Weight", unit: "kg", direction, stableBand: { abs: 0.3, rel: 0.005 }, minPoints: 3, minSpanDays: 7 };
}

// ---- Ranges and buckets --------------------------------------------------------------------------

export interface DateRange {
  days: AnalyticsRange;
  from: string;
  to: string;
}

export function dateRange(today: string, days: AnalyticsRange): DateRange {
  return { days, from: addDays(today, -(days - 1)), to: today };
}

export function granularityFor(days: AnalyticsRange): Granularity {
  return days === 90 ? "week" : "day";
}

export function bucketKey(date: string, g: Granularity): string {
  return g === "day" ? date : g === "week" ? weekStart(date) : `${date.slice(0, 7)}-01`;
}

export interface Bucket {
  key: string;
  /** First and last day of the bucket that fall inside the range. */
  from: string;
  to: string;
  /** Days of the bucket inside the range (a week cut by the range edge has fewer than 7). */
  days: number;
  /** The bucket isn't over yet (contains today), or the range start cuts it short. */
  partial: boolean;
}

export function bucketsFor(range: DateRange, g: Granularity): Bucket[] {
  const out: Bucket[] = [];
  for (let d = range.from; d <= range.to; d = addDays(d, 1)) {
    const key = bucketKey(d, g);
    const last = out[out.length - 1];
    if (last && last.key === key) {
      last.to = d;
      last.days++;
    } else out.push({ key, from: d, to: d, days: 1, partial: false });
  }
  const full = (b: Bucket) => (g === "day" ? 1 : g === "week" ? 7 : daysInMonth(b.key));
  for (const b of out) b.partial = b.days < full(b) || b.to === range.to;
  return out;
}

function daysInMonth(monthKey: string): number {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).getUTCDate();
}

// ---- Trends ---------------------------------------------------------------------------------------

export interface Point {
  date: string;
  value: number;
  /** The value rests on estimated data (e.g. estimated food portions). */
  estimated?: boolean;
}

export interface Trend {
  direction: TrendDirection;
  /** Which way the fitted line moved, regardless of whether that is good. */
  movement: "up" | "down" | "flat" | null;
  /** Fitted values at the first and last point, and the change between them (metric units). */
  from: number | null;
  to: number | null;
  change: number | null;
  changePercent: number | null;
  points: number;
  spanDays: number;
  /** Why no trend: too few points, or too short a span. */
  reason: "too_few_points" | "too_short_span" | null;
}

const round = (n: number, dp = 1) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Least-squares trend over the points in range, judged in the metric's direction. */
export function computeTrend(points: readonly Point[], spec: MetricSpec, range: Pick<DateRange, "from" | "to">): Trend {
  const ps = points.filter((p) => p.date >= range.from && p.date <= range.to && Number.isFinite(p.value)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const none = (reason: Trend["reason"]): Trend => ({ direction: TREND.INSUFFICIENT_DATA, movement: null, from: null, to: null, change: null, changePercent: null, points: ps.length, spanDays: ps.length ? dayNumber(ps[ps.length - 1]!.date) - dayNumber(ps[0]!.date) : 0, reason });
  if (ps.length < spec.minPoints) return none("too_few_points");
  const x0 = dayNumber(ps[0]!.date);
  const xs = ps.map((p) => dayNumber(p.date) - x0);
  const span = xs[xs.length - 1]!;
  if (span < spec.minSpanDays) return none("too_short_span");
  const n = ps.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ps.reduce((a, p) => a + p.value, 0) / n;
  const sxx = xs.reduce((a, x) => a + (x - mx) ** 2, 0);
  const slope = sxx === 0 ? 0 : xs.reduce((a, x, i) => a + (x - mx) * (ps[i]!.value - my), 0) / sxx;
  const from = my - slope * mx;
  const to = from + slope * span;
  const change = to - from;
  const band = Math.max(spec.stableBand.abs, spec.stableBand.rel * Math.abs(my));
  const movement = Math.abs(change) <= band ? "flat" : change > 0 ? "up" : "down";
  const direction: TrendDirection =
    movement === "flat"
      ? TREND.STABLE
      : spec.direction === "steady"
        ? TREND.DECLINING // moving away from where the user wants to stay
        : (movement === "up") === (spec.direction === "higher")
          ? TREND.IMPROVING
          : TREND.DECLINING;
  return { direction, movement, from: round(from), to: round(to), change: round(change), changePercent: Math.abs(from) > 1e-9 ? round((change / Math.abs(from)) * 100) : null, points: n, spanDays: span, reason: null };
}

// ---- Chart models ---------------------------------------------------------------------------------

export interface ChartPoint {
  key: string;
  value: number | null;
  /** Some of the data behind this value is estimated. */
  estimated: boolean;
  partial: boolean;
}

export interface ChartModel {
  id: string;
  title: string;
  unit: AnalyticsUnit | "lb";
  /** Unit of the trend numbers when it differs from the plotted values (e.g. calories plotted, % from target trended). */
  trendUnit: AnalyticsUnit | "lb";
  kind: "line" | "bar";
  granularity: Granularity;
  points: ChartPoint[];
  /** A reference line (e.g. the user's plan or target). */
  target: { value: number; label: string } | null;
  trend: Trend;
  /** no_data: nothing in range; insufficient_data: some data, too little for a trend; partial: gaps in range. */
  state: "ok" | "no_data" | "insufficient_data" | "partial";
}

export type Aggregate = "mean" | "sum" | "last" | "max";

export function aggregate(points: readonly Point[], buckets: readonly Bucket[], g: Granularity, how: Aggregate): ChartPoint[] {
  return buckets.map((b) => {
    const inB = points.filter((p) => p.date >= b.from && p.date <= b.to && bucketKey(p.date, g) === b.key);
    let value: number | null = null;
    if (inB.length) {
      const vals = inB.map((p) => p.value);
      value = how === "sum" ? vals.reduce((a, v) => a + v, 0) : how === "max" ? Math.max(...vals) : how === "last" ? inB.sort((a, c) => (a.date < c.date ? -1 : 1))[inB.length - 1]!.value : vals.reduce((a, v) => a + v, 0) / vals.length;
      value = round(value);
    }
    return { key: b.key, value, estimated: inB.some((p) => p.estimated), partial: b.partial };
  });
}

export function chartModel(opts: {
  id: string;
  title: string;
  spec: MetricSpec;
  kind: ChartModel["kind"];
  range: DateRange;
  granularity: Granularity;
  points: readonly Point[];
  how: Aggregate;
  target?: ChartModel["target"];
  /** Points for the trend, when they differ from the plotted ones (e.g. per-day values under weekly bars). */
  trendPoints?: readonly Point[];
  /** Plotted unit, when it differs from the trend metric's unit. */
  unit?: AnalyticsUnit;
  /** A series where a trend means nothing (e.g. records per week): state reflects the data only. */
  noTrend?: boolean;
}): ChartModel {
  const buckets = bucketsFor(opts.range, opts.granularity);
  const points = aggregate(opts.points, buckets, opts.granularity, opts.how);
  const trend = opts.noTrend ? computeTrend([], { ...opts.spec, minPoints: 1 }, opts.range) : computeTrend(opts.trendPoints ?? opts.points, opts.spec, opts.range);
  const filled = points.filter((p) => p.value !== null).length;
  const state: ChartModel["state"] = filled === 0 ? "no_data" : !opts.noTrend && trend.direction === TREND.INSUFFICIENT_DATA ? "insufficient_data" : filled < points.length ? "partial" : "ok";
  return { id: opts.id, title: opts.title, unit: opts.unit ?? opts.spec.unit, trendUnit: opts.spec.unit, kind: opts.kind, granularity: opts.granularity, points, target: opts.target ?? null, trend, state };
}

// ---- Units ----------------------------------------------------------------------------------------


/** Converts a chart for display. Trends were computed in metric units; only the numbers change. */
export function chartForUnits(chart: ChartModel, units: "metric" | "imperial"): ChartModel {
  if (units === "metric" || chart.unit !== "kg") return chart;
  const trendInKg = chart.trendUnit === "kg";
  const lb = (v: number | null) => (v === null ? null : round(v / KG_PER_LB));
  return {
    ...chart,
    unit: "lb",
    trendUnit: trendInKg ? "lb" : chart.trendUnit,
    points: chart.points.map((p) => ({ ...p, value: lb(p.value) })),
    target: chart.target ? { ...chart.target, value: lb(chart.target.value)! } : null,
    trend: trendInKg ? { ...chart.trend, from: lb(chart.trend.from), to: lb(chart.trend.to), change: lb(chart.trend.change) } : chart.trend,
  };
}

// ---- Goal awareness -------------------------------------------------------------------------------

export type AnalyticsSection = "strength" | "form" | "rom" | "verified_reps" | "consistency" | "nutrition" | "weight" | "xp" | "prs" | "body_quest" | "quests";

/** Which sections speak most directly to each goal (shown first, never hiding the rest). */
export const GOAL_FOCUS_SECTIONS: Record<PrimaryGoal, AnalyticsSection[]> = {
  build_muscle: ["strength", "nutrition", "verified_reps", "consistency"],
  get_stronger: ["strength", "form", "prs", "consistency"],
  lose_fat: ["consistency", "nutrition", "weight", "strength"],
  get_lean: ["nutrition", "consistency", "strength", "weight"],
  improve_fitness: ["consistency", "verified_reps", "form", "xp"],
  improve_health: ["consistency", "nutrition", "form", "body_quest"],
};

/**
 * A plain reading of a trend relative to the user's goal. Describes the data only — no health,
 * body-composition or medical claims, and nothing about other people.
 */
export function interpretTrend(section: AnalyticsSection, trend: Trend, goal: PrimaryGoal | null): string | null {
  if (trend.direction === TREND.INSUFFICIENT_DATA) return trend.reason === "too_short_span" ? "Not enough time covered yet to call a trend." : "Not enough data in this range to call a trend.";
  const focus = goal ? GOAL_FOCUS_SECTIONS[goal].includes(section) : false;
  const tail = focus ? " This is one of the clearest signals for your goal." : "";
  if (section === "weight") {
    if (trend.direction === TREND.STABLE) return `Weight has held steady over this range.${tail}`;
    return trend.direction === TREND.IMPROVING ? `Weight is moving in the direction of your goal.${tail}` : `Weight is moving away from your goal's direction over this range.${tail}`;
  }
  if (trend.direction === TREND.STABLE) return `Holding steady over this range.${tail}`;
  return trend.direction === TREND.IMPROVING ? `Trending up over this range.${tail}` : `Trending down over this range.${tail}`;
}
