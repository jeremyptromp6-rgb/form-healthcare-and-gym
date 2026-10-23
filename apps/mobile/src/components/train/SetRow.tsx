import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Animated, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';
import { a11y, colors, radius, space } from '@/theme/tokens';
import { AppText, Badge, IconButton, InlineMessage } from '@/components/ui';

/** Fixed column widths (pt). PREVIOUS takes whatever is left, so the table fits a 360 px screen. */
const COL = { set: 36, input: 62, check: a11y.minTouch } as const;
const GAP = 6;

/** Largest load a field takes, in its unit (1000 kg, the API's limit). */
const LOAD_MAX = { kg: 1000, lb: 2204.6 } as const;
const REPS_MAX = 200;

export interface SetRowProps {
  number: number;
  /** A warm-up set: shows 'W' instead of its number. On the active row and while editing, the badge is a switch that marks it. */
  warmup?: boolean;
  /** Active row: flips whether the set being entered is a warm-up. Without it the badge is not a control. */
  onToggleWarmup?: () => void;
  /** Active row: tapping the PREVIOUS value fills the load and reps from it. Without it the value is plain text. */
  onUsePrevious?: () => void;
  state: 'done' | 'active' | 'queued';
  loadable: boolean;
  /** Last time's set, e.g. "12 × 10", or "—". */
  previous: string;
  /** Done: the logged values. Queued: the target text. */
  kg: string | null;
  reps: string | null;
  /** Unit of the load column and field; kg when omitted. Loads here are already in this unit. */
  unit?: 'kg' | 'lb';
  /** Active: the editable values. Done: the logged values, used when the row is edited. */
  kgValue?: number;
  repsValue?: number;
  onChangeKg?: (v: number) => void;
  onChangeReps?: (v: number) => void;
  /** Receives the numbers committed from the typed text, so the logged set never lags a keystroke. */
  onComplete?: (values: { kg: number | null; reps: number | null }) => void;
  completeLabel?: string;
  /**
   * Done rows only: when given, tapping the row opens its reps and load for editing. Save calls this with the
   * typed numbers and a `done` callback: `done()` closes the editor, `done('message')` keeps it open with the message.
   */
  onEdit?: (values: { kg: number | null; reps: number | null; warmup?: boolean }, done: (error?: string | null) => void) => void;
  onDelete?: () => void;
  /** What the camera verified ("8 verified · form Good · ROM 92%"), or "Not verified" with the reason in `note`. */
  verified?: { label: string; tone?: 'primary' | 'warning'; note?: string } | null;
  /** Camera-verified reps on this set: editing the reps below this lowers it (the server's rule), and the editor says so. */
  verifiedReps?: number;
  busy?: boolean;
  disabled?: boolean;
}

/** Column captions for a table of SetRows. */
export function SetTableHeader({ loadable, unit = 'kg' }: { loadable: boolean; unit?: 'kg' | 'lb' }) {
  return (
    <View style={styles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Caption width={COL.set}>SET</Caption>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Caption>PREVIOUS</Caption>
      </View>
      {loadable ? <Caption width={COL.input} center>{unit.toUpperCase()}</Caption> : null}
      <Caption width={COL.input} center>REPS</Caption>
      <View style={{ width: COL.check }} />
    </View>
  );
}

function Caption({ children, width, center }: { children: string; width?: number; center?: boolean }) {
  return (
    <View style={width ? { width } : undefined}>
      <AppText variant="overline" color={colors.textFaint} numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, letterSpacing: 0.6, textAlign: center ? 'center' : 'left' }}>
        {children}
      </AppText>
    </View>
  );
}

const fmt = (n: number | undefined) => (n === undefined || !Number.isFinite(n) ? '' : String(n));

function parse(text: string, max: number, integer: boolean, dp = 2): number | null {
  const n = parseFloat(text.replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const v = Math.min(max, Math.max(0, integer ? Math.round(n) : Math.round(n * 10 ** dp) / 10 ** dp));
  return v;
}

/**
 * The text a field shows while typing, re-synced when the parent's number changes. The user's raw
 * text is kept while it still parses to the parent's number (so "22." stays "22." and "0" stays "0"
 * after each keystroke is reported); it is replaced only when the number moved elsewhere (a stepper).
 */
function useNumberText(value: number | undefined, max: number, integer: boolean, dp = 2) {
  const [text, setText] = useState(fmt(value));
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (parse(text, max, integer, dp) !== value) setText(fmt(value));
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
  warmup = false,
  onToggleWarmup,
  onUsePrevious,
  state,
  loadable,
  previous,
  kg,
  reps,
  unit = 'kg',
  kgValue,
  repsValue,
  onChangeKg,
  onChangeReps,
  onComplete,
  completeLabel,
  onEdit,
  onDelete,
  verified,
  verifiedReps = 0,
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

  // Pounds are typed to 0.1 (the precision loads round-trip at); kilograms to 0.01.
  const loadDp = unit === 'lb' ? 1 : 2;
  const loadMax = LOAD_MAX[unit];
  const unitName = unit === 'lb' ? 'pounds' : 'kilograms';
  const [kgText, setKgText] = useNumberText(kgValue, loadMax, false, loadDp);
  const [repsText, setRepsText] = useNumberText(repsValue, REPS_MAX, true);
  /** Every keystroke that parses is reported (clamped) at once, so a tap on the big Log button never reads a stale draft. */
  const type = (text: string, value: number | undefined, max: number, integer: boolean, setText: (t: string) => void, onChange?: (v: number) => void) => {
    setText(text);
    const parsed = parse(text, max, integer, loadDp);
    if (parsed !== null && parsed !== value) onChange?.(parsed);
  };
  const typeKg = (t: string) => type(t, kgValue, loadMax, false, setKgText, onChangeKg);
  const typeReps = (t: string) => type(t, repsValue, REPS_MAX, true, setRepsText, onChangeReps);
  /** Parse + clamp the typed text (falling back to the prop), tidy the field, report a change. */
  const commit = (text: string, value: number | undefined, max: number, integer: boolean, setText: (t: string) => void, onChange?: (v: number) => void) => {
    const parsed = parse(text, max, integer, loadDp);
    const final = parsed ?? value;
    setText(fmt(final));
    if (final !== undefined && final !== value) onChange?.(final);
    return final;
  };
  const commitKg = () => commit(kgText, kgValue, loadMax, false, setKgText, onChangeKg);
  const commitReps = () => commit(repsText, repsValue, REPS_MAX, true, setRepsText, onChangeReps);
  const complete = () => {
    const k = loadable ? commitKg() : undefined;
    const r = commitReps();
    onComplete?.({ kg: k ?? null, reps: r ?? null });
  };

  // Editing a logged (done) row: the same fields, saved with the check; Cancel puts the logged values back.
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const editable = done && !!onEdit && !editing;
  const [editWarmup, setEditWarmup] = useState(false);
  const startEdit = () => {
    setEditWarmup(warmup);
    setKgText(fmt(kgValue));
    setRepsText(fmt(repsValue));
    setEditError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setEditError(null);
  };
  const save = () => {
    const k = loadable ? commitKg() : undefined;
    const r = commitReps();
    setSaving(true);
    setEditError(null);
    onEdit?.({ kg: k ?? null, reps: r ?? null, ...(editWarmup !== warmup ? { warmup: editWarmup } : {}) }, (error) => {
      setSaving(false);
      if (error) setEditError(error);
      else setEditing(false);
    });
  };
  const editedReps = editing ? parse(repsText, REPS_MAX, true) : null;
  const lowersVerified = verifiedReps > 0 && editedReps !== null && editedReps < verifiedReps;

  const blocked = !!disabled || !!busy;
  /** How the row is named to a screen reader: its number, plus '(warm-up)' so it never shares a label with a working set. */
  const rowId = warmup ? `${number} (warm-up)` : String(number);
  const completeName = completeLabel ?? `Complete set ${rowId}`;

  const fields = active || editing;
  const labelPrefix = editing ? 'Edit set' : 'Set';
  const isWarmup = editing ? editWarmup : warmup;
  const toggle = editing ? () => setEditWarmup((w) => !w) : active ? onToggleWarmup : undefined;
  const badge = (
    <View style={[styles.badge, !!toggle && styles.badgeButton, isWarmup && styles.badgeWarmup]}>
      <AppText variant="bodyStrong" color={isWarmup ? colors.warning : textColor} style={styles.num}>
        {isWarmup ? 'W' : String(number)}
      </AppText>
    </View>
  );
  const canUsePrevious = active && !!onUsePrevious && !blocked;
  const cells = (
    <>
      {toggle ? (
        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={`Warm-up for set ${number}`}
          accessibilityHint="Warm-up sets are logged but don't count towards XP, records or totals"
          accessibilityState={{ checked: isWarmup }}
          hitSlop={{ left: 4, right: 4 }}
          onPress={toggle}
          style={styles.badgeWrap}>
          {badge}
        </Pressable>
      ) : (
        <View style={styles.badgeWrap}>{badge}</View>
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        {canUsePrevious && previous !== '—' ? (
          <Pressable accessibilityRole="button" accessibilityLabel={`Use previous: ${previous}`} accessibilityHint="Fills in the weight and reps from last time" onPress={onUsePrevious} style={styles.prevButton}>
            <AppText variant="label" color={colors.primary} numberOfLines={1} style={{ textDecorationLine: 'underline' }}>
              {previous}
            </AppText>
          </Pressable>
        ) : (
          <AppText variant="label" color={colors.textMuted} numberOfLines={1}>
            {previous}
          </AppText>
        )}
      </View>
      {fields ? (
        <>
          {loadable ? <NumberField label={`${labelPrefix} ${rowId} weight in ${unitName}`} text={kgText} onChangeText={typeKg} integer={false} onCommit={commitKg} /> : null}
          <NumberField label={`${labelPrefix} ${rowId} reps`} text={repsText} onChangeText={typeReps} integer onCommit={commitReps} />
        </>
      ) : (
        <>
          {loadable ? <Value color={textColor}>{kg ?? '—'}</Value> : null}
          <Value color={textColor}>{reps ?? '—'}</Value>
        </>
      )}
    </>
  );

  return (
    <View style={[styles.wrap, done && styles.wrapDone]}>
      {done ? <Animated.View style={[StyleSheet.absoluteFill, styles.flash, { opacity: flash, pointerEvents: 'none' }]} /> : null}
      <View style={styles.row}>
        {editable ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit set ${rowId}: ${reps ?? 0} reps${loadable && kg ? ` at ${kg} ${unit}` : ''}`}
            accessibilityHint="Change the reps or weight of this set"
            onPress={startEdit}
            style={styles.cells}>
            {cells}
          </Pressable>
        ) : (
          <View style={styles.cells}>{cells}</View>
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
          ) : editing ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Save set ${rowId}`}
              accessibilityState={{ disabled: saving, busy: saving }} aria-disabled={saving} aria-busy={saving}
              disabled={saving}
              onPress={save}
              style={[styles.check, saving && { opacity: 0.45 }]}>
              <Ionicons name="checkmark" size={20} color={colors.primary} />
            </Pressable>
          ) : done ? (
            <Animated.View accessible accessibilityLabel={`Set ${rowId} done`} style={[styles.checkDone, { transform: [{ scale }] }]}>
              <Ionicons name="checkmark" size={18} color={colors.onPrimary} />
            </Animated.View>
          ) : (
            <View style={styles.checkQueued} />
          )}
        </View>
      </View>
      {done && (verified || onDelete || editing) ? (
        <View style={styles.extra}>
          <View style={{ flex: 1, alignItems: 'flex-start', gap: 2 }}>
            {verified ? <Badge label={verified.label} tone={verified.tone ?? 'primary'} icon="camera-outline" /> : null}
            {verified?.note ? (
              <AppText variant="label" color={colors.textMuted}>
                {verified.note}
              </AppText>
            ) : null}
          </View>
          {editing ? <IconButton icon="close" label={`Cancel editing set ${rowId}`} onPress={cancelEdit} /> : null}
          {onDelete ? <IconButton icon="trash-outline" label={`Delete set ${rowId}`} onPress={onDelete} /> : null}
        </View>
      ) : null}
      {editing && lowersVerified ? (
        <AppText variant="caption" color={colors.textMuted} style={styles.editNote}>
          {`Camera-verified reps drop to ${editedReps} to match. Changing the weight keeps them.`}
        </AppText>
      ) : null}
      {editing && editError ? (
        <View style={styles.editNote}>
          <InlineMessage tone="danger">{editError}</InlineMessage>
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
  cells: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: GAP, minHeight: a11y.minTouch },
  editNote: { paddingLeft: COL.set + GAP, paddingBottom: space.xs },
  num: { fontVariant: ['tabular-nums'] },
  badgeWrap: { width: COL.set, minHeight: a11y.minTouch, alignItems: 'center', justifyContent: 'center' },
  badge: { minWidth: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  badgeButton: { borderWidth: 1, borderColor: colors.borderStrong },
  badgeWarmup: { backgroundColor: colors.warningSoft, borderColor: colors.warning },
  prevButton: { minHeight: a11y.minTouch, justifyContent: 'center' },
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
