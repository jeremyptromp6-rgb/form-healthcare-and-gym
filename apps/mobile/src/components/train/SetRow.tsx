import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';
import { a11y, colors, radius, space } from '@/theme/tokens';
import { AppText, Badge, IconButton } from '@/components/ui';

/** Fixed column widths (pt). PREVIOUS takes whatever is left, so the table fits a 360 px screen. */
const COL = { set: 30, input: 62, check: a11y.minTouch } as const;
const GAP = 6;

const KG_MAX = 1000;
const REPS_MAX = 200;

export interface SetRowProps {
  number: number;
  state: 'done' | 'active' | 'queued';
  loadable: boolean;
  /** Last time's set, e.g. "12 × 10", or "—". */
  previous: string;
  /** Done: the logged values. Queued: the target text. */
  kg: string | null;
  reps: string | null;
  /** Active: the editable values. */
  kgValue?: number;
  repsValue?: number;
  onChangeKg?: (v: number) => void;
  onChangeReps?: (v: number) => void;
  /** Receives the numbers committed from the typed text, so the logged set never lags a keystroke. */
  onComplete?: (values: { kg: number | null; reps: number | null }) => void;
  completeLabel?: string;
  onDelete?: () => void;
  verified?: { label: string } | null;
  busy?: boolean;
  disabled?: boolean;
}

/** Column captions for a table of SetRows. */
export function SetTableHeader({ loadable }: { loadable: boolean }) {
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Caption width={COL.set}>SET</Caption>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Caption>PREVIOUS</Caption>
      </View>
      {loadable ? <Caption width={COL.input} center>KG</Caption> : null}
      <Caption width={COL.input} center>REPS</Caption>
      <View style={{ width: COL.check }} />
    </View>
  );
}

function Caption({ children, width, center }: { children: string; width?: number; center?: boolean }) {
  return (
    <View style={width ? { width } : undefined}>
      <AppText variant="overline" color={colors.textFaint} numberOfLines={1} style={{ fontSize: 11, lineHeight: 14, letterSpacing: 0.8, textAlign: center ? 'center' : 'left' }}>
        {children}
      </AppText>
    </View>
  );
}

const fmt = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '' : String(n));

function parse(text: string, max: number, integer: boolean): number | null {
  const n = parseFloat(text.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const v = Math.min(max, Math.max(0, integer ? Math.round(n) : Math.round(n * 100) / 100));
  return v;
}

/**
 * The text a field shows while typing, re-synced when the parent's number changes. The user's raw
 * text is kept while it still parses to the parent's number (so "22." stays "22." and "0" stays "0"
 * after each keystroke is reported); it is replaced only when the number moved elsewhere (a stepper).
 */
function useNumberText(value: number | undefined, max: number, integer: boolean) {
  const [text, setText] = useState(fmt(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parse(text, max, integer) !== value) setText(fmt(value));
  }
  return [text, setText] as const;
}

/** A numeric text field; the owner keeps the text so a tap on the check can read what was typed. */
function NumberField({ label, text, onChangeText, integer, onCommit }: { label: string; text: string; onChangeText: (t: string) => void; integer: boolean; onCommit: () => void }) {
  return (
    <TextInput
      accessibilityLabel={label}
      value={text}
      onChangeText={onChangeText}
      onBlur={onCommit}
      onSubmitEditing={onCommit}
      keyboardType={integer ? 'number-pad' : 'decimal-pad'}
      inputMode={integer ? 'numeric' : 'decimal'}
      selectTextOnFocus
      returnKeyType="done"
      maxLength={7}
      placeholderTextColor={colors.textFaint}
      selectionColor={colors.primary}
      style={styles.input}
    />
  );
}

/** One set in the table: logged (done), being entered (active) or still to come (queued). */
export function SetRow({
  number,
  state,
  loadable,
  previous,
  kg,
  reps,
  kgValue,
  repsValue,
  onChangeKg,
  onChangeReps,
  onComplete,
  completeLabel,
  onDelete,
  verified,
  busy,
  disabled,
}: SetRowProps) {
  const reduce = useReducedMotion();
  const done = state === 'done';
  const active = state === 'active';
  const muted = state === 'queued';
  const textColor = muted ? colors.textFaint : colors.text;

  // Celebrate only the active → done transition. The previous state lives in state (not a ref) so
  // nothing mutable is read during render.
  const [prevState, setPrevState] = useState(state);
  const [pulse, setPulse] = useState(0);
  if (state !== prevState) {
    setPrevState(state);
    if (prevState === 'active' && state === 'done') setPulse((p) => p + 1);
  }
  const [scale] = useState(() => new Animated.Value(1));
  const [flash] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (pulse === 0 || reduce) return;
    flash.setValue(1);
    const anim = Animated.parallel([
      Animated.sequence([
        Animated.timing(scale, { toValue: 1.25, duration: 120, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 140, useNativeDriver: true }),
      ]),
      Animated.timing(flash, { toValue: 0, duration: 420, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [pulse, reduce, scale, flash]);

  const [kgText, setKgText] = useNumberText(kgValue, KG_MAX, false);
  const [repsText, setRepsText] = useNumberText(repsValue, REPS_MAX, true);
  /** Every keystroke that parses is reported (clamped) at once, so a tap on the big Log button never reads a stale draft. */
  const type = (text: string, value: number | undefined, max: number, integer: boolean, setText: (t: string) => void, onChange?: (v: number) => void) => {
    setText(text);
    const parsed = parse(text, max, integer);
    if (parsed !== null && parsed !== value) onChange?.(parsed);
  };
  const typeKg = (t: string) => type(t, kgValue, KG_MAX, false, setKgText, onChangeKg);
  const typeReps = (t: string) => type(t, repsValue, REPS_MAX, true, setRepsText, onChangeReps);
  /** Parse + clamp the typed text (falling back to the prop), tidy the field, report a change. */
  const commit = (text: string, value: number | undefined, max: number, integer: boolean, setText: (t: string) => void, onChange?: (v: number) => void) => {
    const parsed = parse(text, max, integer);
    const final = parsed ?? value;
    setText(fmt(final));
    if (final !== undefined && final !== value) onChange?.(final);
    return final;
  };
  const commitKg = () => commit(kgText, kgValue, KG_MAX, false, setKgText, onChangeKg);
  const commitReps = () => commit(repsText, repsValue, REPS_MAX, true, setRepsText, onChangeReps);
  const complete = () => {
    const k = loadable ? commitKg() : undefined;
    const r = commitReps();
    onComplete?.({ kg: k ?? null, reps: r ?? null });
  };

  const blocked = !!disabled || !!busy;
  const completeName = completeLabel ?? `Complete set ${number}`;

  return (
    <View style={[styles.wrap, done && styles.wrapDone]}>
      {done ? <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, { opacity: flash }]} /> : null}
      <View style={styles.row}>
        <View style={{ width: COL.set }}>
          <AppText variant="bodyStrong" color={textColor} style={styles.num}>
            {String(number)}
          </AppText>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <AppText variant="label" color={colors.textMuted} numberOfLines={1}>
            {previous}
          </AppText>
        </View>
        {active ? (
          <>
            {loadable ? <NumberField label={`Set ${number} weight in kilograms`} text={kgText} onChangeText={typeKg} integer={false} onCommit={commitKg} /> : null}
            <NumberField label={`Set ${number} reps`} text={repsText} onChangeText={typeReps} integer onCommit={commitReps} />
          </>
        ) : (
          <>
            {loadable ? <Value color={textColor}>{kg ?? '—'}</Value> : null}
            <Value color={textColor}>{reps ?? '—'}</Value>
          </>
        )}
        <View style={styles.checkCol}>
          {active ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={completeName}
              accessibilityState={{ disabled: blocked, busy: !!busy }} aria-disabled={blocked} aria-busy={!!busy}
              disabled={blocked}
              onPress={complete}
              style={[styles.check, blocked && { opacity: 0.45 }]}>
              <Ionicons name="checkmark" size={20} color={colors.primary} />
            </Pressable>
          ) : done ? (
            <Animated.View accessible accessibilityLabel={`Set ${number} done`} style={[styles.checkDone, { transform: [{ scale }] }]}>
              <Ionicons name="checkmark" size={18} color={colors.onPrimary} />
            </Animated.View>
          ) : (
            <View style={styles.checkQueued} />
          )}
        </View>
      </View>
      {done && (verified || onDelete) ? (
        <View style={styles.extra}>
          <View style={{ flex: 1, alignItems: 'flex-start' }}>{verified ? <Badge label={verified.label} tone="primary" icon="camera-outline" /> : null}</View>
          {onDelete ? <IconButton icon="trash-outline" label={`Delete set ${number}`} onPress={onDelete} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function Value({ children, color }: { children: string; color: string }) {
  return (
    <View style={{ width: COL.input, alignItems: 'center' }}>
      <AppText variant="bodyStrong" color={color} numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
        {children}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { borderRadius: radius.sm, paddingHorizontal: space.xs, overflow: 'hidden' },
  wrapDone: { backgroundColor: colors.successSoft },
  flash: { backgroundColor: colors.successSoft, borderRadius: radius.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: GAP, minHeight: a11y.minTouch + 4, paddingVertical: 2 },
  num: { fontVariant: ['tabular-nums'] },
  input: {
    width: COL.input,
    minHeight: a11y.minTouch,
    borderRadius: radius.sm - 4,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    color: colors.text,
    fontSize: 16,
    textAlign: 'center',
    paddingHorizontal: 4,
    paddingVertical: 0,
  },
  checkCol: { width: COL.check, alignItems: 'center', justifyContent: 'center' },
  check: {
    width: a11y.minTouch,
    height: a11y.minTouch,
    borderRadius: a11y.minTouch / 2,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  checkQueued: { width: 30, height: 30, borderRadius: 15, borderWidth: 1, borderColor: colors.border },
  extra: { flexDirection: 'row', alignItems: 'center', paddingLeft: COL.set + GAP, marginTop: -space.xs },
});
