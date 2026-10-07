import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { AppText, Row, type IconName } from '@/components/ui';
import type { ChartModel, Trend, TrendDirection } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

const HEIGHT = 120;

const TREND_STYLE: Record<TrendDirection, { label: string; icon: IconName; color: string }> = {
  improving: { label: 'Improving', icon: 'trending-up', color: colors.primary },
  stable: { label: 'Stable', icon: 'remove', color: colors.textMuted },
  declining: { label: 'Declining', icon: 'trending-down', color: colors.warning },
  insufficient_data: { label: 'Not enough data', icon: 'ellipsis-horizontal', color: colors.textFaint },
};

const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString() : String(Math.round(v * 10) / 10));

/** "+6 kg (+10%)" — the fitted change, in the trend's own unit. */
export function trendChange(t: Trend, unit: string): string | null {
  if (t.change === null || t.movement === 'flat') return null;
  const sign = t.change > 0 ? '+' : '−';
  const u = unit === '%' ? ' pts' : unit === 'score' ? ' pts' : ` ${unit}`;
  return `${sign}${fmt(Math.abs(t.change))}${u}${t.changePercent !== null && unit !== '%' && unit !== 'score' ? ` (${sign}${fmt(Math.abs(t.changePercent))}%)` : ''}`;
}

export function TrendBadge({ trend, unit }: { trend: Trend; unit: string }) {
  const s = TREND_STYLE[trend.direction];
  const change = trendChange(trend, unit);
  return (
    <View style={[styles.badge, { borderColor: `${s.color}55` }]} accessible accessibilityLabel={`Trend: ${s.label}${change ? `, ${change}` : ''}`}>
      <Ionicons name={s.icon} size={14} color={s.color} />
      <AppText variant="label" color={s.color}>
        {s.label}
        {change ? ` · ${change}` : ''}
      </AppText>
    </View>
  );
}

const keyLabel = (key: string, g: ChartModel['granularity']) =>
  new Date(`${key}T12:00:00`).toLocaleDateString(undefined, g === 'month' ? { month: 'short' } : { month: 'short', day: 'numeric' });

/** A text summary of a chart for screen readers. */
export function chartSummary(c: ChartModel): string {
  const vals = c.points.filter((p) => p.value !== null);
  if (vals.length === 0) return `${c.title}: nothing logged in this range.`;
  const unit = c.unit === 'score' ? '' : ` ${c.unit}`;
  const first = vals[0]!;
  const last = vals[vals.length - 1]!;
  return `${c.title}: ${vals.length} of ${c.points.length} ${c.granularity === 'day' ? 'days' : c.granularity === 'week' ? 'weeks' : 'months'} with data, from ${fmt(first.value!)}${unit} on ${keyLabel(first.key, c.granularity)} to ${fmt(last.value!)}${unit} on ${keyLabel(last.key, c.granularity)}. Trend: ${TREND_STYLE[c.trend.direction].label}.`;
}

/**
 * Draws a ChartModel: bars (from zero) or a line through the points that exist (gaps stay gaps),
 * a dashed reference line for a plan/target, hollow marks for estimated data and faded marks for
 * an unfinished period. No data and too-little data get their own plain message.
 */
export function Chart({ chart, height = HEIGHT }: { chart: ChartModel; height?: number }) {
  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const vals = chart.points.map((p) => p.value).filter((v): v is number => v !== null);

  if (chart.state === 'no_data') {
    return (
      <View style={[styles.empty, { height: height * 0.6 }]}>
        <AppText variant="caption" color={colors.textFaint}>
          Nothing logged in this range yet.
        </AppText>
      </View>
    );
  }

  const all = chart.target ? [...vals, chart.target.value] : vals;
  const lo = chart.kind === 'bar' ? 0 : Math.min(...all);
  const hi = Math.max(...all);
  const pad = chart.kind === 'bar' ? 0 : Math.max((hi - lo) * 0.15, hi === lo ? Math.max(1, Math.abs(hi) * 0.05) : 0);
  const min = lo - pad;
  const max = hi + pad || 1;
  const y = (v: number) => height - ((v - min) / (max - min || 1)) * height;
  const n = chart.points.length;
  const slot = width / Math.max(1, n);
  const x = (i: number) => slot * i + slot / 2;
  const coords = chart.points.map((p, i) => (p.value === null ? null : { x: x(i), y: y(p.value), p }));

  return (
    <View style={{ gap: space.xs }}>
      <View style={{ height }} onLayout={onLayout} accessible accessibilityRole="image" accessibilityLabel={chartSummary(chart)}>
        {width > 0 && chart.target ? (
          <View style={[styles.target, { top: y(chart.target.value) }]}>
            <AppText variant="caption" color={colors.textFaint} style={styles.targetLabel}>
              {chart.target.label} {fmt(chart.target.value)}
            </AppText>
          </View>
        ) : null}
        {width > 0 && chart.kind === 'bar'
          ? coords.map((c, i) =>
              c ? (
                <View
                  key={chart.points[i]!.key}
                  style={[
                    styles.bar,
                    {
                      left: x(i) - Math.max(2, slot * 0.32),
                      width: Math.max(4, slot * 0.64),
                      top: c.y,
                      height: Math.max(2, height - c.y),
                      opacity: c.p.partial ? 0.5 : 1,
                    },
                    c.p.estimated && styles.estimated,
                  ]}
                />
              ) : null,
            )
          : null}
        {width > 0 && chart.kind === 'line'
          ? coords.map((c, i) => {
              if (!c) return null;
              const next = coords.slice(i + 1).find((q) => q !== null);
              const gap = next ? coords.indexOf(next) - i > 1 : false;
              return (
                <View key={chart.points[i]!.key}>
                  {next ? <Segment from={c} to={next} dashed={gap} /> : null}
                  <View style={[styles.dot, { left: c.x - 4, top: c.y - 4, opacity: c.p.partial ? 0.5 : 1 }, c.p.estimated && styles.dotEstimated]} />
                </View>
              );
            })
          : null}
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText variant="caption" color={colors.textFaint}>
          {keyLabel(chart.points[0]!.key, chart.granularity)}
        </AppText>
        {chart.points.some((p) => p.estimated) ? (
          <AppText variant="caption" color={colors.textFaint}>
            Hollow = includes estimates
          </AppText>
        ) : null}
        <AppText variant="caption" color={colors.textFaint}>
          {keyLabel(chart.points[n - 1]!.key, chart.granularity)}
        </AppText>
      </Row>
      {chart.state === 'insufficient_data' ? (
        <AppText variant="caption" color={colors.textMuted}>
          {chart.trend.reason === 'too_short_span' ? 'Not enough time covered yet to show a trend.' : 'A few more data points and a trend will show here.'}
        </AppText>
      ) : null}
    </View>
  );
}

function Segment({ from, to, dashed }: { from: { x: number; y: number }; to: { x: number; y: number }; dashed: boolean }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);
  return (
    <View
      style={[
        styles.segment,
        { width: length, left: (from.x + to.x) / 2 - length / 2, top: (from.y + to.y) / 2 - 1, transform: [{ rotate: `${angle}rad` }] },
        dashed && { opacity: 0.35 },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  empty: { borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2, alignSelf: 'flex-start' },
  target: { position: 'absolute', left: 0, right: 0, borderTopWidth: 1, borderStyle: 'dashed', borderColor: colors.textFaint },
  targetLabel: { position: 'absolute', right: 0, top: -18, fontSize: 11 },
  bar: { position: 'absolute', backgroundColor: colors.primary, borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  estimated: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.primary },
  dot: { position: 'absolute', width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary },
  dotEstimated: { backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.primary },
  segment: { position: 'absolute', height: 2, backgroundColor: colors.primary, borderRadius: 1 },
});
