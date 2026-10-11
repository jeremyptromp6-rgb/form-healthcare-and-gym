import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';
import { useActiveLoop } from '@/lib/useActiveLoop';
import Svg, { Circle } from 'react-native-svg';
import { Buddy } from '@/components/art/Buddy';
import { StateArt, type StateArtKind } from '@/components/art/StateArt';
import type { ApiError } from '@/lib/api';
import { colors, glow, radius, space, type } from '@/theme/tokens';
import { Button, stateIcon, type IconName } from './controls';
import { Card, Row } from './layout';
import { useStaticArt } from './staticArt';
import { AppText, type TextVariant } from './text';

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
      <Text style={[type.label as TextStyle, { color: fg }]}>{label}</Text>
    </View>
  );
}

/** Eases a 0-1 value toward `target` (jumps there with reduced motion). It drives layout and SVG props, so it can't use the native driver. */
function useEased(target: number): Animated.Value {
  const reduceMotion = useReducedMotion();
  const [anim] = useState(() => new Animated.Value(reduceMotion ? target : 0));
  useEffect(() => {
    if (reduceMotion) anim.setValue(target);
    else Animated.timing(anim, { toValue: target, duration: 600, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [anim, target, reduceMotion]);
  return anim;
}

/** A progress fill that eases to its value (instantly with reduced motion). */
export function ProgressBar({ value, color = colors.primary, height = 8, label }: { value: number; color?: string; height?: number; label?: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  const anim = useEased(clamped);
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

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Rings at least this big (the Home and Eat calorie ring is 84) get the dark-mode glow. */
const HERO_RING = 64;

/** A ring that fills clockwise toward a target (easing like ProgressBar), with optional content (an icon, a number) in the middle. */
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
  const anim = useEased(v);
  const dashOffset = anim.interpolate({ inputRange: [0, 1], outputRange: [c, 0] });
  // A round cap would draw a dot at 0, so the fill fades in over the first percent instead of being unmounted.
  const fillOpacity = anim.interpolate({ inputRange: [0, 0.01], outputRange: [0, 1], extrapolate: 'clamp' });
  return (
    <View
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
      accessibilityRole={label ? 'progressbar' : undefined}
      accessibilityLabel={label}
      accessibilityValue={label ? { min: 0, max: 100, now: Math.round(v * 100) } : undefined}>
      {/* Hero rings (not the small ones in a strip) catch a little lamplight in dark mode. */}
      <View style={[StyleSheet.absoluteFill, size >= HERO_RING && v > 0 && glow(color)]} pointerEvents="none">
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.track} strokeWidth={stroke} fill="none" />
          {Platform.OS === 'web' ? (
            // Animated passes `collapsable` through to the DOM <circle> on web, so the web ring is drawn still.
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
              opacity={v > 0 ? 1 : 0}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          ) : (
            <AnimatedCircle
              cx={size / 2}
              cy={size / 2}
              r={r}
              stroke={color}
              strokeWidth={stroke}
              fill="none"
              strokeLinecap="round"
              strokeDasharray={`${c} ${c}`}
              strokeDashoffset={dashOffset}
              opacity={fillOpacity}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          )}
        </Svg>
      </View>
      {children}
    </View>
  );
}

/**
 * A number that counts once from its previous value (0 on first show) to `value`, then stops. Under
 * reduced motion, or with the app in the background, it shows the final value at once. Screen
 * readers always get the final formatted value, never an intermediate one. This is a setState
 * animation: use it for at most one figure per screen.
 */
export function CountUp({
  value,
  format = (n: number) => String(Math.round(n)),
  variant = 'stat',
  style,
  duration = 600,
}: {
  value: number;
  format?: (n: number) => string;
  variant?: TextVariant;
  style?: StyleProp<TextStyle>;
  duration?: number;
}) {
  const run = useActiveLoop(!useStaticArt());
  const [shown, setShown] = useState(run ? 0 : value);
  const from = useRef(run ? 0 : value);
  useEffect(() => {
    if (!run || from.current === value) {
      // Nothing to animate: keep the number a later run counts up from in step with what is on show.
      from.current = value;
      setShown(value);
      return;
    }
    const start = Date.now();
    const origin = from.current;
    let frame = 0;
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / Math.max(1, duration));
      const next = p >= 1 ? value : origin + (value - origin) * (1 - Math.pow(1 - p, 3));
      from.current = next;
      setShown(next);
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, run, duration]);
  return (
    <AppText variant={variant} style={style} accessibilityLabel={format(value)}>
      {format(run ? shown : value)}
    </AppText>
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
          <AppText variant="stat">{value}</AppText>
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

/** The pulse range of a loading skeleton, and where it rests when motion is off. */
const SKELETON = { low: 0.45, high: 1, rest: 0.7 } as const;

/**
 * One pulse for every skeleton on screen. Each skeleton asks for it while it is mounted and the
 * loop runs only while at least one does, so a screen of ten loading cards still has one loop.
 */
const skeletonPulse = new Animated.Value(SKELETON.rest);
let pulseUsers = 0;
let pulseLoop: Animated.CompositeAnimation | null = null;

function acquireSkeletonPulse() {
  pulseUsers += 1;
  if (pulseUsers > 1) return;
  const ease = { duration: 750, easing: Easing.inOut(Easing.quad), useNativeDriver: true } as const;
  pulseLoop = Animated.loop(Animated.sequence([Animated.timing(skeletonPulse, { toValue: SKELETON.high, ...ease }), Animated.timing(skeletonPulse, { toValue: SKELETON.low, ...ease })]));
  pulseLoop.start();
}

function releaseSkeletonPulse() {
  pulseUsers = Math.max(0, pulseUsers - 1);
  if (pulseUsers > 0) return;
  pulseLoop?.stop();
  pulseLoop = null;
  skeletonPulse.setValue(SKELETON.rest);
}

/** Three quiet bars that breathe on the shared pulse (gated by useActiveLoop); static at mid opacity otherwise. */
function Skeleton({ compact }: { compact?: boolean }) {
  const run = useActiveLoop();
  useEffect(() => {
    if (!run) return;
    acquireSkeletonPulse();
    return releaseSkeletonPulse;
  }, [run]);
  const bar = compact ? styles.barCompact : styles.bar;
  return (
    <Animated.View style={[compact ? styles.skeletonCompact : styles.skeleton, { opacity: run ? skeletonPulse : SKELETON.rest }]}>
      {(['72%', '100%', '46%'] as const).map((w) => (
        <View key={w} style={[bar, { width: w }]} />
      ))}
    </Animated.View>
  );
}

/**
 * Which art an empty, error or permission state gets. Matched on the title first (the call sites'
 * own wording), then on the kind. An explicit `art` wins.
 */
export function stateArtFor(kind: StateKind, title?: string, art?: StateArtKind): StateArtKind {
  if (art) return art;
  const t = title ?? '';
  if (/not found/i.test(t)) return 'notFound';
  if (/no workouts/i.test(t)) return 'noWorkouts';
  if (/no records/i.test(t)) return 'noRecords';
  if (/nothing to buy/i.test(t)) return 'groceryEmpty';
  if (/can.t reach|couldn.t reach|offline|connection/i.test(t)) return 'offline';
  if (kind === 'permission') return 'cameraPermission';
  if (kind === 'unavailable') return 'unavailable';
  if (kind === 'error') return 'serverError';
  return 'generic';
}

/** One component for every non-success state: loading, empty, error, unavailable, permission denied. */
export function StateView({
  kind,
  title,
  message,
  actionLabel,
  onAction,
  compact,
  art,
}: {
  kind: StateKind;
  title?: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
  compact?: boolean;
  /** Internal: overrides the art picked from the title and kind (ErrorState uses it). */
  art?: StateArtKind;
}) {
  if (kind === 'loading') {
    return (
      <View style={[styles.state, compact && styles.compact]} accessibilityRole="progressbar" accessibilityLabel="Loading">
        {compact ? null : <Buddy mood="sleepy" size={56} float={false} style={{ marginBottom: space.sm }} />}
        <Skeleton compact={compact} />
      </View>
    );
  }
  return (
    <View style={[styles.state, compact && styles.compact]} accessibilityLiveRegion={kind === 'error' ? 'polite' : undefined}>
      <StateArt kind={stateArtFor(kind, title, art)} size={compact ? 64 : 88} style={{ marginBottom: space.xs }} />
      {title ? (
        <AppText variant={compact ? 'heading' : 'sectionTitle'} style={{ textAlign: 'center' }} header>
          {title}
        </AppText>
      ) : null}
      {message ? (
        <AppText variant={compact ? 'caption' : 'body'} color={colors.textMuted} style={{ textAlign: 'center', maxWidth: 320 }}>
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
  return (
    <StateView
      {...s}
      art={error.kind === 'network' ? 'offline' : error.kind === 'unavailable' ? 'unavailable' : 'serverError'}
      compact={compact}
      actionLabel={error.retryable || error.kind === 'network' ? 'Try again' : undefined}
      onAction={onRetry}
    />
  );
}

/** A short notice with a tinted icon. `flat` drops the tinted panel so it can sit inside a card or on the page. */
export function InlineMessage({ tone, children, icon, flat }: { tone: 'warning' | 'danger' | 'info' | 'success'; children: ReactNode; icon?: IconName; flat?: boolean }) {
  const palette = {
    warning: [colors.warningSoft, colors.warning, stateIcon('warning', false)],
    danger: [colors.dangerSoft, colors.danger, stateIcon('alert-circle', false)],
    info: [colors.cardRaised, colors.textMuted, stateIcon('information-circle', false)],
    success: [colors.primarySoft, colors.primary, stateIcon('checkmark-circle', true)], // earned, so filled
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
  // type.label is 13/18, so the vertical padding drops by 1 to keep the pill at 22 high.
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 2, borderRadius: radius.pill, alignSelf: 'flex-start' },
  state: { alignItems: 'center', justifyContent: 'center', paddingVertical: space.xxl, gap: space.sm },
  compact: { paddingVertical: space.lg },
  skeleton: { width: '100%', maxWidth: 280, gap: space.md },
  skeletonCompact: { width: '100%', maxWidth: 220, gap: space.sm },
  bar: { height: 14, borderRadius: 7, backgroundColor: colors.cardRaised, borderWidth: 1, borderColor: colors.border },
  barCompact: { height: 10, borderRadius: 5, backgroundColor: colors.cardRaised, borderWidth: 1, borderColor: colors.border },
  inline: { flexDirection: 'row', gap: space.md, padding: space.md, borderRadius: radius.md },
  inlineFlat: { flexDirection: 'row', gap: space.sm },
});
