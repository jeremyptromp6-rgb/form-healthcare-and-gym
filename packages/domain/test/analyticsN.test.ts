import { describe, expect, it } from "vitest";
import { bucketsFor, chartForUnits, chartModel, computeTrend, dateRange, granularityFor, interpretTrend, METRICS, TREND, weightSpec, type Point } from "../src";

const series = (start: string, values: number[], stepDays = 1): Point[] =>
  values.map((value, i) => ({ date: new Date(Date.parse(`${start}T00:00:00Z`) + i * stepDays * 86_400_000).toISOString().slice(0, 10), value }));

describe("ranges and buckets", () => {
  it("covers whole local days ending today", () => {
    expect(dateRange("2026-09-30", 7)).toEqual({ days: 7, from: "2026-09-24", to: "2026-09-30" });
    expect(dateRange("2026-03-01", 30).from).toBe("2026-01-31"); // across a month and leap-year-free February
    expect(granularityFor(7)).toBe("day");
    expect(granularityFor(30)).toBe("day");
    expect(granularityFor(90)).toBe("week");
  });

  it("marks buckets the range cuts short, and today's, as partial", () => {
    const days = bucketsFor(dateRange("2026-09-30", 7), "day");
    expect(days).toHaveLength(7);
    expect(days.filter((b) => b.partial).map((b) => b.key)).toEqual(["2026-09-30"]); // only today is unfinished
    const weeks = bucketsFor(dateRange("2026-09-30", 30), "week"); // Wed 30 Sep; range starts Tue 1 Sep
    expect(weeks[0]).toMatchObject({ key: "2026-08-31", from: "2026-09-01", days: 6, partial: true });
    expect(weeks.at(-1)).toMatchObject({ key: "2026-09-28", to: "2026-09-30", partial: true });
    expect(weeks.slice(1, -1).every((b) => !b.partial && b.days === 7)).toBe(true);
    const months = bucketsFor(dateRange("2026-09-30", 90), "month");
    expect(months.map((m) => m.key)).toEqual(["2026-07-01", "2026-08-01", "2026-09-01"]);
  });
});

describe("trend engine", () => {
  const r = { from: "2026-09-01", to: "2026-09-30" };

  it("judges direction by metric, and calls small changes stable", () => {
    expect(computeTrend(series("2026-09-01", [60, 62.5, 65, 67.5], 3), METRICS.strength, r)).toMatchObject({ direction: TREND.IMPROVING, movement: "up" });
    expect(computeTrend(series("2026-09-01", [20, 15, 10, 5], 3), METRICS.kcal_deviation, r)).toMatchObject({ direction: TREND.IMPROVING, movement: "down" }); // lower is better
    expect(computeTrend(series("2026-09-01", [90, 85, 80, 75], 3), METRICS.form, r)).toMatchObject({ direction: TREND.DECLINING });
    expect(computeTrend(series("2026-09-01", [88, 89, 88, 89], 3), METRICS.form, r)).toMatchObject({ direction: TREND.STABLE, movement: "flat" });
  });

  it("refuses to call a trend from too few points or too short a span", () => {
    expect(computeTrend(series("2026-09-01", [60, 70]), METRICS.strength, r)).toMatchObject({ direction: TREND.INSUFFICIENT_DATA, reason: "too_few_points" });
    expect(computeTrend(series("2026-09-01", [60, 65, 70]), METRICS.strength, r)).toMatchObject({ direction: TREND.INSUFFICIENT_DATA, reason: "too_short_span" });
    expect(computeTrend(series("2026-08-01", [60, 65, 70, 75], 3), METRICS.strength, r).direction).toBe(TREND.INSUFFICIENT_DATA); // all outside the range
  });

  it("judges weight only against the user's own energy goal", () => {
    const down = series("2026-09-01", [82, 81.5, 81, 80.5, 80], 4);
    expect(computeTrend(down, weightSpec("lose"), r).direction).toBe(TREND.IMPROVING);
    expect(computeTrend(down, weightSpec("gain"), r).direction).toBe(TREND.DECLINING);
    expect(computeTrend(down, weightSpec("maintain"), r).direction).toBe(TREND.DECLINING); // drifting from where they want to stay
    expect(computeTrend(series("2026-09-01", [80, 80.1, 79.9, 80], 4), weightSpec("maintain"), r).direction).toBe(TREND.STABLE);
  });

  it("reports the fitted change in metric units", () => {
    const t = computeTrend(series("2026-09-01", [60, 62, 64, 66], 3), METRICS.strength, r);
    expect(t).toMatchObject({ from: 60, to: 66, change: 6, changePercent: 10, points: 4, spanDays: 9 });
  });
});

describe("chart models", () => {
  const range = dateRange("2026-09-30", 7);

  it("distinguishes no data, insufficient data, partial data and ok", () => {
    const make = (points: Point[]) => chartModel({ id: "f", title: "Form", spec: METRICS.form, kind: "line", range, granularity: "day", points, how: "mean" });
    expect(make([]).state).toBe("no_data");
    expect(make(series("2026-09-29", [80])).state).toBe("insufficient_data");
    expect(make(series("2026-09-24", [80, 82, 84, 86], 2)).state).toBe("partial");
    expect(make(series("2026-09-24", [80, 81, 82, 83, 84, 85, 86])).state).toBe("ok");
    const c = make([{ date: "2026-09-29", value: 1000, estimated: true }]);
    expect(c.points.find((p) => p.key === "2026-09-29")).toMatchObject({ value: 1000, estimated: true });
  });

  it("aggregates into weekly buckets and keeps a separate trend series", () => {
    const r90 = dateRange("2026-09-30", 90);
    const c = chartModel({ id: "c", title: "Days", spec: METRICS.consistency, kind: "bar", range: r90, granularity: "week", points: series("2026-09-21", [1, 1, 1], 2), how: "sum", target: { value: 3, label: "Plan" }, unit: "days", trendPoints: series("2026-09-07", [33, 66, 100], 7) });
    expect(c.points.find((p) => p.key === "2026-09-21")?.value).toBe(3);
    expect(c).toMatchObject({ unit: "days", trendUnit: "%", trend: { direction: TREND.IMPROVING } });
  });

  it("converts kilograms to pounds for display, leaving other units alone", () => {
    const c = chartModel({ id: "w", title: "Weight", spec: weightSpec("lose"), kind: "line", range: dateRange("2026-09-30", 30), granularity: "day", points: series("2026-09-01", [80, 79.5, 79, 78.5], 4), how: "last", target: { value: 75, label: "Goal" } });
    const lb = chartForUnits(c, "imperial");
    expect(lb.unit).toBe("lb");
    expect(lb.points.find((p) => p.key === "2026-09-01")?.value).toBeCloseTo(176.4, 1);
    expect(lb.target?.value).toBeCloseTo(165.3, 1);
    expect(lb.trend.change).toBeCloseTo(-3.3, 1);
    expect(lb.trend.direction).toBe(c.trend.direction);
    expect(chartForUnits(c, "metric")).toBe(c);
    const form = chartModel({ id: "f", title: "Form", spec: METRICS.form, kind: "line", range, granularity: "day", points: [], how: "mean" });
    expect(chartForUnits(form, "imperial")).toBe(form);
  });
});

describe("goal-aware reading", () => {
  it("describes trends plainly, flags goal-relevant ones, and never makes health claims", () => {
    const up = computeTrend(series("2026-09-01", [60, 62.5, 65, 67.5], 3), METRICS.strength, { from: "2026-09-01", to: "2026-09-30" });
    expect(interpretTrend("strength", up, "get_stronger")).toBe("Trending up over this range. This is one of the clearest signals for your goal.");
    expect(interpretTrend("strength", up, "improve_health")).toBe("Trending up over this range.");
    const none = computeTrend([], METRICS.form, { from: "2026-09-01", to: "2026-09-30" });
    expect(interpretTrend("form", none, null)).toMatch(/Not enough data/);
    const down = computeTrend(series("2026-09-01", [82, 81, 80, 79], 4), weightSpec("lose"), { from: "2026-09-01", to: "2026-09-30" });
    const text = [interpretTrend("weight", down, "lose_fat"), interpretTrend("weight", down, "build_muscle")].join(" ");
    expect(text).toMatch(/direction of your goal/);
    expect(text).not.toMatch(/healthy|unhealthy|body fat|fat loss|lean mass|percentile|than (most|others)/i);
  });
});
