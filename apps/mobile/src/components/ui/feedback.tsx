import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, Easing, StyleSheet, Text, View, type TextStyle } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';
import Svg, { Circle } from 'react-native-svg';
import { Buddy } from '@/components/art/Buddy';
import type { ApiError } from '@/lib/api';
import { colors, radius, space, type } from '@/theme/tokens';
import { Button, type IconName } from './controls';
import { Card, Row } from './layout';
import { AppText } from './text';

export type BadgeTone = 'neutral' | 'primary' | 'purple' | 'warning' | 'danger' | 'accent';

/** A small status pill. Words, not codes: "Measured", "Paused", "Goal met". */
export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: BadgeTone; icon?: IconName }) {
  const map = {
    neutral: [colors.cardRaised, colors.textMuted],
    primary: [colors.primarySoft, colors.primary],
    purple: [colors.purpleSoft, colors.purple],
    warning: [colors.warningSoft, colors.warning],
    accent: [colors.accentSoft, colors.accent],
    danger: [colors.dangerSoft, colors.danger],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={fg} /> : null}
      <Text style={[type.label as TextStyle, { color: fg, fontSize: 12, lineHeight: 16 }]}>{label}</Text>
    </View>
  );
}

/** A progress fill that eases to its value (instantly with reduced motion). */
export function ProgressBar({ value, color = colors.primary, height = 8, label }: { value: number; color?: string; height?: number; label?: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  const reduceMotion = useReducedMotion();
  const [anim] = useState(() => new Animated.Value(reduceMotion ? clamped : 0));
  useEffect(() => {
    if (reduceMotion) anim.setValue(clamped);
    else Animated.timing(anim, { toValue: clamped, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [anim, clamped, reduceMotion]);
  const width = anim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={{ height, borderRadius: height, backgroundColor: colors.track, overflow: 'hidden' }}>
      <Animated.View style={{ width, height: '100%', backgroundColor: color, borderRadius: height }} />
    </View>
  );
}

/** A ring that fills clockwise toward a target, with optional content (an icon, a number) in the middle. */
export function ProgressRing({
  value,
  size = 56,
  stroke = 6,
  color = colors.primary,
  children,
  label,
}: {
  value: number;
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
  label?: string;
}) {
  const v = Math.max(0, Math.min(1, value));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole={label ? 'progressbar' : undefined}
      accessibilityLabel={label}
      accessibilityValue={label ? { min: 0, max: 100, now: Math.round(v * 100) } : undefined}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.track} strokeWidth={stroke} fill="none" />
        {v > 0 ? (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${c} ${c}`}
            strokeDashoffset={c * (1 - v)}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        ) : null}
      </Svg>
      {children}
    </View>
  );
}

/** One number with its label — quiet label, strong number, optional progress toward a target. */
export function Stat({
  label,
  value,
  unit,
  icon,
  tint = colors.primary,
  progress,
  accessibilityLabel,
}: {
  label: string;
  value: string;
  unit?: string;
  icon?: IconName;
  tint?: string;
  /** 0–1 toward a target; shows a thin bar in `tint`. */
  progress?: number;
  accessibilityLabel?: string;
}) {
  return (
    <Card style={{ flex: 1, gap: space.sm, padding: space.md, backgroundColor: `${tint}14`, borderColor: `${tint}30` }}>
      <View accessible accessibilityLabel={accessibilityLabel ?? `${label}: ${value}${unit ? ` ${unit}` : ''}`} style={{ gap: 4 }}>
        <Row gap={6}>
          {icon && progress === undefined ? <Ionicons name={icon} size={14} color={tint} /> : null}
          <AppText variant="label" color={colors.textMuted} numberOfLines={1}>
            {label}
          </AppText>
        </Row>
        <Row gap={3} style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
          <AppText variant="heading" style={{ fontSize: 22, lineHeight: 28, fontVariant: ['tabular-nums'] }}>
            {value}
          </AppText>
          {unit ? (
            <AppText variant="caption" color={colors.textMuted}>
              {unit}
            </AppText>
          ) : null}
        </Row>
      </View>
      {progress !== undefined ? (
        <ProgressRing value={progress} size={46} stroke={5} color={tint}>
          {icon ? <Ionicons name={icon} size={16} color={tint} /> : null}
        </ProgressRing>
      ) : null}
    </Card>
  );
}

/** One macro, flat: a coloured dot and name, grams so far over the target, and a thin bar. With no target there is no bar. */
export function MacroTile({ label, value, target, color }: { label: string; value: number; target: number | null; color: string }) {
  const grams = Math.round(value);
  return (
    <View style={styles.macro} accessible accessibilityLabel={target === null ? `${label}: ${grams} grams` : `${label}: ${grams} of ${target} grams`}>
      <Row gap={6}>
        <View style={[styles.macroDot, { backgroundColor: color }]} />
        <AppText variant="label" color={colors.textMuted} numberOfLines={1}>
          {label}
        </AppText>
      </Row>
      <Row gap={3} style={{ alignItems: 'baseline' }}>
        <AppText variant="heading" style={{ fontVariant: ['tabular-nums'] }} numberOfLines={1}>
          {grams}
        </AppText>
        <AppText variant="caption" color={colors.textFaint} numberOfLines={1} style={{ flexShrink: 1 }}>
          {target === null ? 'g' : `/ ${target} g`}
        </AppText>
      </Row>
      {target === null ? null : <ProgressBar value={target > 0 ? value / target : 0} color={color} height={5} />}
    </View>
  );
}

export type StateKind = 'loading' | 'empty' | 'error' | 'unavailable' | 'permission';

const STATE_ICON: Record<Exclude<StateKind, 'loading'>, IconName> = {
  empty: 'leaf-outline',
  error: 'cloud-offline-outline',
  unavailable: 'time-outline',
  permission: 'lock-closed-outline',
};

/** One component for every non-success state: loading, empty, error, unavailable, permission denied. */
export function StateView({
  kind,
  title,
  message,
  actionLabel,
  onAction,
  compact,
}: {
  kind: StateKind;
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
}) {
  if (kind === 'loading') {
    return (
      <View style={[styles.state, compact && styles.compact]} accessibilityRole="progressbar" accessibilityLabel="Loading">
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }
  const tint = kind === 'error' ? colors.danger : kind === 'unavailable' || kind === 'permission' ? colors.warning : colors.primary;
  return (
    <View style={[styles.state, compact && styles.compact]} accessibilityLiveRegion={kind === 'error' ? 'polite' : undefined}>
      {kind === 'empty' ? (
        <Buddy mood="happy" size={compact ? 64 : 88} />
      ) : (
        <View style={[styles.stateIcon, { backgroundColor: `${tint}1F` }]}>
          <Ionicons name={STATE_ICON[kind]} size={22} color={tint} />
        </View>
      )}
      {title ? (
        <AppText variant="heading" style={{ textAlign: 'center' }} header>
          {title}
        </AppText>
      ) : null}
      {message ? (
        <AppText variant="caption" color={colors.textMuted} style={{ textAlign: 'center', maxWidth: 320 }}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} variant="secondary" onPress={onAction} style={{ marginTop: space.sm }} /> : null}
    </View>
  );
}

/** Maps an API failure to the matching state, offering a retry where one can help. */
export function ErrorState({ error, onRetry, compact }: { error: ApiError; onRetry?: () => void; compact?: boolean }) {
  const byKind: Partial<Record<ApiError['kind'], { kind: StateKind; title: string; message: string }>> = {
    network: { kind: 'error', title: "Can't reach FORM", message: 'Check your connection and try again.' },
    unavailable: { kind: 'unavailable', title: 'Temporarily unavailable', message: error.message },
    rate_limited: { kind: 'error', title: 'Slow down a little', message: 'Too many requests. Try again in a minute.' },
    forbidden: { kind: 'permission', title: 'Not allowed', message: error.message },
    server: { kind: 'error', title: 'Something went wrong', message: "That didn't work. It's not you — try again." },
  };
  const s = byKind[error.kind] ?? { kind: 'error' as const, title: 'Something went wrong', message: error.message };
  return <StateView {...s} compact={compact} actionLabel={error.retryable || error.kind === 'network' ? 'Try again' : undefined} onAction={onRetry} />;
}

/** A short notice with a tinted icon. `flat` drops the tinted panel so it can sit inside a card or on the page. */
export function InlineMessage({ tone, children, icon, flat }: { tone: 'warning' | 'danger' | 'info' | 'success'; children: ReactNode; icon?: IconName; flat?: boolean }) {
  const palette = {
    warning: [colors.warningSoft, colors.warning, 'warning-outline'],
    danger: [colors.dangerSoft, colors.danger, 'alert-circle-outline'],
    info: [colors.cardRaised, colors.textMuted, 'information-circle-outline'],
    success: [colors.primarySoft, colors.primary, 'checkmark-circle-outline'],
  } as const;
  const [bg, fg, defaultIcon] = palette[tone];
  // Flat messages have no panel to carry the tone, so only the icon does; the text stays readable
  // (the warning tone is too light for body text on the page). Info stays quiet.
  const textColor = flat && tone === 'info' ? colors.textMuted : colors.text;
  return (
    <View style={flat ? styles.inlineFlat : [styles.inline, { backgroundColor: bg }]} accessibilityRole={tone === 'danger' ? 'alert' : undefined}>
      <Ionicons name={icon ?? defaultIcon} size={18} color={fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1 }}>
        {typeof children === 'string' ? (
          <AppText variant="caption" color={textColor}>
            {children}
          </AppText>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  macro: { flex: 1, gap: 6 },
  macroDot: { width: 8, height: 8, borderRadius: 4 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill, alignSelf: 'flex-start' },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxl, gap: space.sm },
  compact: { paddingVertical: space.lg },
  stateIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginBottom: space.xs },
  inline: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md },
  inlineFlat: { flexDirection: 'row', gap: space.sm },
});
