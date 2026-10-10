import Ionicons from '@expo/vector-icons/Ionicons';
import { Children, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { ExerciseThumb } from '@/components/art/ExerciseArt';
import { a11y, colors, radius, space } from '@/theme/tokens';
import { type IconName } from './controls';
import { Badge, type BadgeTone } from './feedback';
import { Divider, Row } from './layout';
import { AppText } from './text';

/**
 * Exercise building blocks shared by Train, the workout flow and Progress: a flat list row with
 * the drawing, a stack of thumbnails, filter chips, text tabs and a tiny bar trend.
 */

export interface ExerciseRowProps {
  exerciseId: string;
  name: string;
  /** The main facts under the name, e.g. "3 sets × 8–12 reps · 12 kg". */
  detail?: string;
  /** A quieter line, e.g. "Last time 12 × 10 · 3 days ago". */
  meta?: string | null;
  /** Icon before the meta line. Defaults to a clock; pass null for none. */
  metaIcon?: IconName | null;
  note?: string | null;
  /** Shows a small number on the thumbnail's corner (position in a plan). */
  index?: number;
  badge?: { label: string; tone?: BadgeTone };
  cameraVerifiable?: boolean;
  trailing?: ReactNode;
  onPress?: () => void;
  accessibilityLabel?: string;
  thumbSize?: number;
}

/** A flat exercise row: thumbnail, name, facts. Sits on the page; group rows with ExerciseList. */
export function ExerciseRow({
  exerciseId,
  name,
  detail,
  meta,
  metaIcon = 'time-outline',
  note,
  index,
  badge,
  cameraVerifiable,
  trailing,
  onPress,
  accessibilityLabel,
  thumbSize = 52,
}: ExerciseRowProps) {
  const content = (
    <>
      <View>
        <ExerciseThumb exerciseId={exerciseId} size={thumbSize} />
        {index !== undefined ? (
          <View style={styles.index}>
            <AppText variant="label" color={colors.onPrimary} style={{ fontSize: 11, lineHeight: 14 }}>
              {String(index)}
            </AppText>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          <AppText variant="bodyStrong" numberOfLines={2} style={{ flexShrink: 1 }}>
            {name}
          </AppText>
          {badge ? <Badge label={badge.label} tone={badge.tone} /> : null}
        </Row>
        {detail ? (
          <AppText variant="label" color={colors.text}>
            {detail}
          </AppText>
        ) : null}
        {meta ? (
          <Row gap={4}>
            {metaIcon ? <Ionicons name={metaIcon} size={13} color={colors.textMuted} /> : null}
            <AppText variant="label" color={colors.textMuted} style={{ flexShrink: 1 }}>
              {meta}
            </AppText>
          </Row>
        ) : null}
        {note ? (
          <AppText variant="caption" color={colors.textFaint}>
            {note}
          </AppText>
        ) : null}
      </View>
      {cameraVerifiable ? <Ionicons name="camera-outline" size={18} color={colors.textMuted} /> : null}
      {trailing}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null}
    </>
  );
  const label = accessibilityLabel ?? `${name}${detail ? `: ${detail}` : ''}`;
  // Without onPress the row is plain content: a pressable with no action has no role and would fail the audit.
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={styles.row}>
        {content}
      </View>
    );
  }
  return (
    <Pressable accessible accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.row}>
      {content}
    </Pressable>
  );
}

/** Rows separated by hairlines. No card, no border: the list sits directly on the page. */
export function ExerciseList({ children }: { children: ReactNode }) {
  const rows = Children.toArray(children);
  return (
    <View>
      {rows.map((child, i) => (
        <View key={i}>
          {i > 0 ? <Divider /> : null}
          {child}
        </View>
      ))}
    </View>
  );
}

/** A compact row of overlapping exercise drawings with a "+N" chip. One accessible element. */
export function ExerciseThumbStrip({ exerciseIds, max = 6, label }: { exerciseIds: string[]; max?: number; label?: string }) {
  const shown = exerciseIds.slice(0, Math.max(0, max));
  const extra = exerciseIds.length - shown.length;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label ?? `${exerciseIds.length} exercises`} style={styles.strip}>
      {shown.map((id, i) => (
        <View key={`${id}-${i}`} style={[styles.stripThumb, i > 0 && { marginLeft: -10 }]}>
          <ExerciseThumb exerciseId={id} size={28} />
        </View>
      ))}
      {extra > 0 ? (
        <View style={[styles.stripMore, shown.length > 0 && { marginLeft: -10 }]}>
          <AppText variant="label" color={colors.textMuted}>{`+${extra}`}</AppText>
        </View>
      ) : null}
    </View>
  );
}

export interface FilterOption<T extends string> {
  value: T;
  label: string;
  count?: number;
  icon?: IconName;
}

/** Single-choice filter pills in their own horizontal scroller. "All" (and re-tapping) clears. */
export function FilterChipRow<T extends string>({
  label,
  options,
  value,
  onChange,
  allLabel = 'All',
}: {
  label: string;
  options: FilterOption<T>[];
  value: T | null;
  onChange: (v: T | null) => void;
  allLabel?: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        <Pill label={allLabel} selected={value === null} onPress={() => onChange(null)} />
        {options.map((o) => (
          <Pill key={o.value} label={o.label} count={o.count} icon={o.icon} selected={o.value === value} onPress={() => onChange(o.value === value ? null : o.value)} />
        ))}
      </ScrollView>
    </View>
  );
}

function Pill({ label, count, icon, selected, onPress }: { label: string; count?: number; icon?: IconName; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ checked: selected }} aria-checked={selected}
      onPress={onPress}
      style={[styles.pill, selected && styles.pillOn]}>
      {icon ? <Ionicons name={icon} size={15} color={selected ? colors.primary : colors.textMuted} /> : null}
      <AppText variant="label" color={selected ? colors.text : colors.textMuted}>
        {label}
      </AppText>
      {count !== undefined ? (
        <AppText variant="label" color={colors.textFaint}>
          {String(count)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** Text tabs with an underline under the active one. */
export function TabRow<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={styles.tabs}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <Pressable
            key={t.value}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: active }} aria-selected={active}
            onPress={() => onChange(t.value)}
            style={styles.tab}>
            <AppText variant={active ? 'bodyStrong' : 'body'} color={active ? colors.text : colors.textMuted}>
              {t.label}
            </AppText>
            <View style={[styles.tabMark, { backgroundColor: active ? colors.primary : 'transparent' }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

export interface TrendPoint {
  key: string;
  label: string;
  value: number;
}

const roundValue = (v: number) => Math.round(v * 10) / 10;

/** A tiny bar chart: one bar per point, scaled to the best, the latest in the primary colour. */
export function TrendChart({ title, unit, points, height = 96 }: { title: string; unit: string; points: TrendPoint[]; height?: number }) {
  if (points.length === 0) return null;
  const max = Math.max(...points.map((p) => p.value));
  const latest = points[points.length - 1]!;
  const summary = `${title}: ${points.length} ${points.length === 1 ? 'session' : 'sessions'}, latest ${roundValue(latest.value)} ${unit}, best ${roundValue(max)} ${unit}`;
  // Each column stacks [value label][bar][x label]; the bar gets whatever height is left.
  const valueRoom = 16;
  const xRoom = 14;
  const barRoom = Math.max(8, height - valueRoom - xRoom);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ gap: space.sm }}>
      <Row gap={space.sm} style={{ justifyContent: 'space-between' }}>
        <AppText variant="label" color={colors.textMuted}>
          {title}
        </AppText>
        <AppText variant="label" color={colors.textFaint}>
          {unit}
        </AppText>
      </Row>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space.xs }}>
        {points.map((p, i) => {
          const isLatest = i === points.length - 1;
          const h = max > 0 ? Math.max(p.value > 0 ? 4 : 0, Math.round((p.value / max) * barRoom)) : 0;
          return (
            <View key={p.key} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height }}>
              <View style={{ height: valueRoom, justifyContent: 'flex-end' }}>
                {isLatest ? (
                  <AppText variant="label" color={colors.text} numberOfLines={1} style={{ fontSize: 12, lineHeight: 16 }}>
                    {String(roundValue(p.value))}
                  </AppText>
                ) : null}
              </View>
              <View testID="trend-bar" style={{ width: '70%', maxWidth: 28, height: h, borderRadius: 6, backgroundColor: isLatest ? colors.primary : colors.primarySoft }} />
              <AppText variant="label" color={colors.textFaint} numberOfLines={1} style={{ fontSize: 11, lineHeight: xRoom }}>
                {p.label}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 64, paddingVertical: space.sm },
  index: {
    position: 'absolute',
    top: -4,
    left: -4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: { flexDirection: 'row', alignItems: 'center' },
  stripThumb: { borderRadius: 12, borderWidth: 2, borderColor: colors.card, backgroundColor: colors.card, overflow: 'hidden' },
  stripMore: {
    minWidth: 32,
    height: 32,
    paddingHorizontal: space.sm,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.card,
    backgroundColor: colors.cardRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: a11y.minTouch,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pillOn: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  tabs: { flexDirection: 'row', gap: space.xl },
  tab: { minHeight: a11y.minTouch, justifyContent: 'center', alignItems: 'center' },
  tabMark: { height: 3, borderRadius: 2, alignSelf: 'stretch', marginTop: 2 },
});
