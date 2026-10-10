import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { colors, space } from '@/theme/tokens';
import { MacroTile, ProgressBar, ProgressRing } from './feedback';
import { Row } from './layout';
import { AppText } from './text';

/**
 * The shared "fuel" block for Home and Eat: the day's calories as one big number, an optional ring,
 * the macros and any notes. It draws no surface of its own — callers wrap it in a card (or not).
 */

export interface FuelMacro {
  label: string;
  value: number;
  /** Grams to aim for; `null` when there is no target yet (no bar is drawn). */
  target: number | null;
  color: string;
}

export function FuelSummary({
  title,
  numeral,
  unitLabel,
  caption,
  captionTone = 'muted',
  ring,
  macros,
  children,
}: {
  /** Heading above the numbers (announced as a header). */
  title?: string;
  numeral: string;
  /** Sits beside the numeral, e.g. "/ 2,200 kcal". */
  unitLabel?: string | null;
  caption?: string | null;
  captionTone?: 'muted' | 'warning';
  ring?: { value: number; color: string; label?: string } | null;
  macros?: FuelMacro[] | null;
  /** The caller's note lines, shown below the macros. */
  children?: ReactNode;
}) {
  return (
    <View style={{ gap: space.lg }}>
      {title ? (
        <AppText variant="heading" header>
          {title}
        </AppText>
      ) : null}
      <Row gap={space.lg}>
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={space.xs} style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
            <AppText variant="display" style={{ fontVariant: ['tabular-nums'] }}>
              {numeral}
            </AppText>
            {unitLabel ? (
              <AppText variant="bodyStrong" color={colors.textMuted}>
                {unitLabel}
              </AppText>
            ) : null}
          </Row>
          {caption ? (
            <AppText variant="label" color={captionTone === 'warning' ? colors.warning : colors.textMuted}>
              {caption}
            </AppText>
          ) : null}
        </View>
        {ring ? (
          <ProgressRing value={ring.value} size={84} stroke={8} color={ring.color} label={ring.label}>
            <Ionicons name="flame" size={24} color={ring.color} />
          </ProgressRing>
        ) : null}
      </Row>
      {macros && macros.length > 0 ? (
        <Row gap={space.lg} style={{ alignItems: 'flex-start' }}>
          {macros.map((m) => (
            <MacroTile key={m.label} label={m.label} value={m.value} target={m.target} color={m.color} />
          ))}
        </Row>
      ) : null}
      {children}
    </View>
  );
}

/** Today's water as one line: icon, name, litres so far over the guide, and a thin bar. One accessible element. */
export function WaterLine({
  totalText,
  targetText,
  fraction,
  accessibilityLabel,
  hint,
  barLabel = 'Water of daily guide',
}: {
  totalText: string;
  targetText: string;
  /** 0–1 of the daily guide. */
  fraction: number;
  accessibilityLabel: string;
  hint?: string;
  barLabel?: string;
}) {
  return (
    <View style={{ gap: space.sm }} accessible accessibilityLabel={accessibilityLabel}>
      <Row gap={space.sm}>
        <Ionicons name="water" size={18} color={colors.water} />
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          Water
        </AppText>
        <AppText variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
          {totalText}
        </AppText>
        <AppText variant="label" color={colors.textMuted}>
          / {targetText}
        </AppText>
      </Row>
      <ProgressBar value={fraction} height={6} color={colors.water} label={barLabel} />
      {hint ? (
        <AppText variant="caption" color={colors.textFaint}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}
