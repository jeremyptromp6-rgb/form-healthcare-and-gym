import { EXERCISE_BY_ID, suggestWarmups } from '@form/domain';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExerciseArt } from '@/components/art/ExerciseArt';
import { AppText, Button, Divider, ExerciseRow, Field, IconButton, InlineMessage, Row, StatStrip } from '@/components/ui';
import { barKgOf, useBarWeight } from '@/lib/barWeight';
import type { SessionExercise, WorkoutSession } from '@/lib/types';
import { formatVolume, loadFromDisplay, loadStep, loadToDisplay, loadUnit, lbToKg, snapLoadKg, useUnits, type Units } from '@/lib/units';
import {
  sessionTotals,
  elapsedSeconds,
  exerciseDone,
  formatClock,
  formatPrevious,
  formatTarget,
  formWord,
  nextSetDefaults,
  restRemaining,
  verificationNote,
  workingSets,
} from '@/lib/workoutSession';
import { colors, MAX_CONTENT_WIDTH, radius, space } from '@/theme/tokens';
import { PlateCalculatorSheet } from './PlateCalculatorSheet';
import { RestTimerPill } from './RestTimerPill';
import { SetRow, SetTableHeader } from './SetRow';
import { Stepper } from './Stepper';

/** The next set being entered. `warmup` marks it a warm-up set (absent means a working set). */
export type Draft = { reps: number; loadKg: number; warmup?: boolean };

/** Longest workout note the server keeps. */
const NOTES_MAX = 500;

export interface ActiveWorkoutViewProps {
  session: WorkoutSession;
  index: number;
  onSelectExercise: (index: number) => void;
  draft: Draft;
  onChangeDraft: (draft: Draft) => void;
  loadStepKg: number;
  /**
   * Logs the focused exercise's next set. A set row's check passes the numbers it just committed
   * (the parent's draft can lag a keystroke in the same tick); the Retry button passes nothing
   * and logs `draft`.
   */
  onLogSet: (draft?: Draft) => void;
  logging?: boolean;
  /** Last log attempt failed; the set is kept and can be retried without duplicating. */
  logError?: string | null;
  /** Which exercise the log error belongs to; defaults to the focused one. */
  logErrorIndex?: number | null;
  onDeleteSet: (setId: string) => void;
  /**
   * Saves new reps and/or load (kg) for a logged set of the focused exercise. `done()` closes the row's editor,
   * `done('message')` keeps it open showing the message. Without it logged rows can't be edited.
   */
  onEditSet?: (setId: string, patch: { reps?: number; loadKg?: number; warmup?: boolean }, done: (error?: string | null) => void) => void;
  onPause: () => void;
  onResume: () => void;
  onSkipRest: () => void;
  onAddRest: (seconds: number) => void;
  onEnd: () => void;
  onClose: () => void;
  /** Opens live camera tracking for the current exercise; omitted when the move or build has no camera support. */
  onOpenCamera?: () => void;
  /** Logs the next set of another exercise straight from its row. Without it those rows are display-only. */
  onLogSetAt?: (exerciseIndex: number, draft: Draft) => void;
  /**
   * Saves the workout notes (null clears them). `done()` confirms, `done(message)` shows the message under the field.
   * Without it the notes field is not offered.
   */
  onSaveNotes?: (notes: string | null, done: (error?: string | null) => void) => void;
  /** A pause, resume, rest or delete that failed; shown at the top (and over the pause screen) until the next try. */
  actionError?: string | null;
  /** Display units for loads (loads are stored and passed around in kg). Defaults to the user's setting. */
  units?: Units;
  now: Date;
  /** The user's today, to say when a session left open was started. */
  today: string;
}

/** Room under the last row so the floating rest pill never covers it. */
const REST_PILL_ROOM = 170;

const draftKey = (e: SessionExercise) => `${e.exerciseId}:${e.loggedSets.length}`;

/** Its main way to do it is with a barbell (plates go on it); unknown exercises are not offered the calculator. */
const usesBarbell = (exerciseId: string) => !!EXERCISE_BY_ID.get(exerciseId)?.equipment[0]?.includes('barbell');

/** Warm-up sets queued to be logged one after another, oldest first. */
type WarmupQueue = { exerciseId: string; base: number; sets: Draft[]; resume: Draft };

/**
 * The live workout screen as one scroll: every exercise's set table, the focused one with its
 * art and big steppers. Pure view — every value comes from the server session; every action is a callback.
 */
export function ActiveWorkoutView(p: ActiveWorkoutViewProps) {
  const { session, index, now } = p;
  const paused = session.status === 'paused';
  const rest = restRemaining(session, now);
  const resting = rest !== null && rest > 0 && !paused;
  const totals = sessionTotals(session);
  const units = useUnits(p.units);
  const volume = formatVolume(totals.volumeKg, units);
  const errorIndex = p.logErrorIndex === undefined ? index : p.logErrorIndex;
  // Drafts for the next set of exercises that aren't focused, keyed `${exerciseId}:${loggedCount}`.
  const [rowDrafts, setRowDrafts] = useState<Record<string, Draft>>({});

  // Automatic warm-ups for the focused lift: suggested from today's working weight, logged one by one as warm-up sets.
  const { bar, setBar } = useBarWeight(units);
  const focusedEx = session.exercises[index];
  const barbell = !!focusedEx && focusedEx.loadable && usesBarbell(focusedEx.exerciseId);
  const [warmQueue, setWarmQueue] = useState<WarmupQueue | null>(null);
  // What the queue's effect already did, so a re-render never repeats it: a send, the resume or a failure.
  const handled = useRef<{ queue: WarmupQueue; step: string } | null>(null);
  const failedHere = !!p.logError && errorIndex === index;
  const warmups =
    focusedEx && focusedEx.loadable && focusedEx.loggedSets.length === 0 && !p.draft.warmup && !failedHere && p.onLogSetAt
      ? suggestWarmups({
          loadable: true,
          workingKg: p.draft.loadKg,
          workingReps: p.draft.reps,
          // Imperial users warm up in plate-friendly pounds.
          stepKg: units === 'imperial' ? lbToKg(loadStep(p.loadStepKg, units)) : p.loadStepKg,
          barbell,
          barKg: barKgOf(bar, units),
        }).map((w) => ({ reps: w.reps, loadKg: snapLoadKg(w.loadKg, units) }))
      : [];
  // Where the queue stands, from the session itself: sets logged since it started (all warm-ups) against the sets it holds.
  const warmIndex = warmQueue ? session.exercises.findIndex((e) => e.exerciseId === warmQueue.exerciseId) : -1;
  const warmEx = warmIndex >= 0 ? session.exercises[warmIndex] : undefined;
  const warmDone = warmQueue && warmEx ? warmEx.loggedSets.length - warmQueue.base : 0;
  const warmLive = !!warmQueue && !!warmEx && warmDone >= 0 && warmEx.loggedSets.slice(warmQueue.base).every((s) => s.warmup);
  const warmActive = warmLive && !!warmQueue && warmDone < warmQueue.sets.length;
  const warmFailed = warmActive && !!p.logError && errorIndex === warmIndex;
  const addWarmups = () => {
    if (!focusedEx || warmActive || warmups.length === 0) return;
    setWarmQueue({
      exerciseId: focusedEx.exerciseId,
      base: focusedEx.loggedSets.length,
      sets: warmups.map((w) => ({ ...w, warmup: true })),
      resume: { reps: p.draft.reps, loadKg: p.draft.loadKg },
    });
  };
  const { onLogSetAt, onChangeDraft, logging } = p;
  useEffect(() => {
    if (!warmQueue || !warmEx || !warmLive) return;
    const once = (step: string) => {
      if (handled.current?.queue === warmQueue && handled.current.step === step) return false;
      handled.current = { queue: warmQueue, step };
      return true;
    };
    if (warmDone >= warmQueue.sets.length) {
      // All in: the working set starts from what was on the steppers before.
      if (once('resume') && warmIndex === index) onChangeDraft(warmQueue.resume);
    } else if (warmFailed) {
      // One failed: it becomes the next set, so Retry saves that warm-up; adding goes on after it saves.
      if (once(`failed-${warmDone}`) && warmIndex === index) onChangeDraft(warmQueue.sets[warmDone]);
    } else if (!logging && !paused && onLogSetAt && once(`send-${warmDone}`)) {
      onLogSetAt(warmIndex, warmQueue.sets[warmDone]);
    }
  }, [warmQueue, warmEx, warmLive, warmDone, warmFailed, warmIndex, logging, paused, index, onLogSetAt, onChangeDraft]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.topBar}>
        <IconButton icon="chevron-down" label="Minimise workout" onPress={p.onClose} color={colors.text} />
        <View style={{ alignItems: 'center' }} accessible accessibilityLabel={`Workout time ${formatClock(elapsedSeconds(session, now))}`}>
          <AppText variant="label" color={colors.textMuted}>
            {paused ? 'Paused' : 'Workout'}
          </AppText>
          <AppText variant="heading" style={{ fontVariant: ['tabular-nums'] }}>
            {formatClock(elapsedSeconds(session, now))}
          </AppText>
        </View>
        <IconButton icon={paused ? 'play' : 'pause'} label={paused ? 'Resume workout' : 'Pause workout'} onPress={paused ? p.onResume : p.onPause} color={colors.text} />
      </View>

      <View style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={[styles.body, resting && { paddingBottom: REST_PILL_ROOM }]} keyboardShouldPersistTaps="handled">
          <StatStrip
            items={[
              { label: 'Duration', value: formatClock(elapsedSeconds(session, now)) },
              { label: 'Volume', value: volume.value, unit: volume.unit },
              { label: 'Sets', value: String(totals.sets) },
            ]}
          />
          {p.actionError ? <InlineMessage tone="danger">{p.actionError}</InlineMessage> : null}
          {session.leftOpen ? (
            <InlineMessage tone="warning" icon="time-outline">
              {`You left this workout open${session.localDate !== p.today ? ` on ${new Date(`${session.localDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}` : ''}. The time away doesn't count. Carry on, end it with the sets you logged, or discard it.`}
            </InlineMessage>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }} accessibilityRole="tablist">
            {session.exercises.map((e, i) => (
              <Pressable
                key={e.exerciseId}
                accessibilityRole="tab"
                accessibilityLabel={`${e.name}${exerciseDone(e) ? ', done' : ''}`}
                accessibilityState={{ selected: i === index }} aria-selected={i === index}
                // The chip is 36pt tall; this brings its touch target to 44pt without changing how it looks.
                hitSlop={{ top: 4, bottom: 4 }}
                onPress={() => p.onSelectExercise(i)}
                style={[styles.chip, i === index && styles.chipActive]}>
                {exerciseDone(e) ? <Ionicons name="checkmark" size={14} color={colors.primary} /> : null}
                <AppText variant="caption" color={i === index ? colors.text : colors.textMuted}>
                  {e.name}
                </AppText>
              </Pressable>
            ))}
          </ScrollView>

          {session.exercises.length > 0 ? (
            <View>
              {session.exercises.map((e, i) => {
                const focused = i === index;
                const key = draftKey(e);
                const rowDraft = rowDrafts[key] ?? nextSetDefaults(e, units);
                const patchRow = (patch: Partial<Draft>) => setRowDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] ?? nextSetDefaults(e, units)), ...patch } }));
                const patchDraft = (patch: Partial<Draft>) => (focused ? p.onChangeDraft({ ...p.draft, ...patch }) : patchRow(patch));
                return (
                  <View key={`${e.exerciseId}-${i}`}>
                    {i > 0 ? <Divider /> : null}
                    <View style={styles.section}>
                      {focused ? (
                        <FocusedHeader
                          p={p}
                          exercise={e}
                          paused={paused}
                          units={units}
                          showError={!!p.logError && errorIndex === i}
                          warmups={{ count: warmups.length, adding: warmActive && !warmFailed && warmQueue?.exerciseId === e.exerciseId, onAdd: addWarmups }}
                          plates={barbell ? { bar, onChangeBar: setBar } : null}
                        />
                      ) : (
                        <>
                          <ExerciseRow
                            exerciseId={e.exerciseId}
                            name={e.name}
                            detail={`${e.loggedSets.length}${e.sets ? `/${e.sets}` : ''} sets`}
                            thumbSize={40}
                            accessibilityLabel={`Show ${e.name}`}
                            onPress={() => p.onSelectExercise(i)}
                          />
                          {p.logError && errorIndex === i ? <InlineMessage tone="danger">{p.logError}</InlineMessage> : null}
                        </>
                      )}
                      <SetTable
                        exercise={e}
                        units={units}
                        focused={focused}
                        draft={focused ? p.draft : rowDraft}
                        paused={paused}
                        busy={p.logging}
                        onPatch={patchDraft}
                        onComplete={
                          focused
                            ? (values) => {
                                const d: Draft = { reps: values.reps ?? p.draft.reps, loadKg: e.loadable ? (values.kg ?? p.draft.loadKg) : p.draft.loadKg, ...(p.draft.warmup ? { warmup: true } : {}) };
                                // The row reports each edited field separately, so push the whole set last.
                                if (d.reps !== p.draft.reps || d.loadKg !== p.draft.loadKg) p.onChangeDraft(d);
                                p.onLogSet(d);
                              }
                            : p.onLogSetAt
                              ? (values) => p.onLogSetAt?.(i, { reps: values.reps ?? rowDraft.reps, loadKg: e.loadable ? (values.kg ?? rowDraft.loadKg) : 0 })
                              : undefined
                        }
                        later={
                          focused
                            ? {
                                // Rows after the next one start from the plan (a warm-up draft isn't a working weight).
                                draft: p.draft.warmup ? nextSetDefaults(e, units) : p.draft,
                                onComplete: (values) => {
                                  const base = p.draft.warmup ? nextSetDefaults(e, units) : p.draft;
                                  const d: Draft = { reps: values.reps ?? base.reps, loadKg: e.loadable ? (values.kg ?? base.loadKg) : p.draft.loadKg };
                                  // Kept as the draft too, so a failed save is retried as this same set.
                                  if (d.reps !== p.draft.reps || d.loadKg !== p.draft.loadKg || p.draft.warmup) p.onChangeDraft(d);
                                  p.onLogSet(d);
                                },
                              }
                            : undefined
                        }
                        canMarkWarmup={focused}
                        deleteLabelled={focused}
                        onDeleteSet={p.onDeleteSet}
                        onEditSet={p.onEditSet}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <InlineMessage tone="info">No exercises in this workout yet.</InlineMessage>
          )}

          {p.onSaveNotes ? <NotesField key={session.id} saved={session.notes ?? ''} onSave={p.onSaveNotes} /> : null}

          <Button label="End workout" variant="secondary" icon="flag-outline" onPress={p.onEnd} />
        </ScrollView>

        {resting ? (
          <View style={[styles.pill, { pointerEvents: 'box-none' }]}>
            <RestTimerPill
              remainingSeconds={rest}
              totalSeconds={session.rest?.seconds}
              onAdd={(delta) => p.onAddRest(rest + delta)}
              onSkip={p.onSkipRest}
            />
          </View>
        ) : null}
      </View>

      {paused ? (
        <View style={styles.overlay} accessibilityViewIsModal>
          <Ionicons name="pause-circle" size={72} color={colors.primary} />
          <AppText variant="title" header>
            Paused
          </AppText>
          <AppText variant="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
            Your workout is saved. Paused time doesn&apos;t count.
          </AppText>
          {p.actionError ? <InlineMessage tone="danger">{p.actionError}</InlineMessage> : null}
          <Button label="Resume" icon="play" onPress={p.onResume} style={{ alignSelf: 'stretch' }} />
          <Button label="End workout" variant="ghost" onPress={p.onEnd} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** The focused exercise: moving art, name, where you are, notes, camera, steppers and the log button. */
function FocusedHeader({
  p,
  exercise,
  paused,
  units,
  showError,
  warmups,
  plates,
}: {
  p: ActiveWorkoutViewProps;
  exercise: SessionExercise;
  paused: boolean;
  units: Units;
  showError: boolean;
  /** Suggested warm-ups for this lift (`count` 0 = none to offer); `adding` while they are being logged. */
  warmups: { count: number; adding: boolean; onAdd: () => void };
  /** Barbell lifts: the plate calculator and the saved bar weight. */
  plates: { bar: number; onChangeBar: (bar: number) => void } | null;
}) {
  const [platesOpen, setPlatesOpen] = useState(false);
  const setNumber = workingSets(exercise).length + 1;
  const target = formatTarget(exercise, units);
  const previous = formatPrevious(exercise, units);
  return (
    <>
      <View style={styles.art}>
        <ExerciseArt exerciseId={exercise.exerciseId} name={exercise.name} size="card" animated style={{ height: 130 }} />
      </View>
      <View style={{ gap: space.xs }}>
        <AppText variant="display" header numberOfLines={2}>
          {exercise.name}
        </AppText>
        <AppText variant="bodyStrong" color={colors.primary}>
          {p.draft.warmup ? 'Warm-up set' : `Set ${setNumber}${exercise.sets ? ` of ${exercise.sets}` : ''}${target ? ` · ${target}` : ''}`}
        </AppText>
        {previous ? (
          <AppText variant="caption" color={colors.textMuted}>
            Last time: {previous}
          </AppText>
        ) : null}
        {exercise.note ? (
          <AppText variant="caption" color={colors.textMuted}>
            {exercise.note}
          </AppText>
        ) : null}
        {p.onOpenCamera && exercise.cameraVerifiable ? (
          <Button label="Use camera coaching" icon="videocam-outline" variant="secondary" onPress={p.onOpenCamera} accessibilityHint="Opens the camera so FORM can count your reps and coach your form" />
        ) : null}
        <AppText variant="caption" color={colors.textFaint}>
          {exercise.cameraVerifiable
            ? 'Tick each set off when you finish it, or use the camera to have your reps verified. Ticking off sets far faster than you could have done them earns less XP.'
            : 'Tick each set off when you finish it. Ticking off sets far faster than you could have done them earns less XP.'}
        </AppText>
      </View>

      <View style={styles.entry}>
        <Row gap={space.lg} style={{ alignItems: 'flex-start' }}>
          <Stepper label="Reps" value={p.draft.reps} onChange={(reps) => p.onChangeDraft({ ...p.draft, reps })} />
          {exercise.loadable ? (
            <Stepper
              label="Weight"
              unit={loadUnit(units)}
              value={loadToDisplay(p.draft.loadKg, units)}
              step={loadStep(p.loadStepKg, units)}
              max={loadToDisplay(1000, units)}
              onChange={(v) => p.onChangeDraft({ ...p.draft, loadKg: loadFromDisplay(v, units) })}
            />
          ) : null}
        </Row>
        {plates || warmups.count > 0 || warmups.adding ? (
          <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
            {warmups.count > 0 || warmups.adding ? (
              <Button
                label={warmups.adding ? 'Adding warm-ups…' : `Add warm-ups (${warmups.count})`}
                icon="flame-outline"
                variant="secondary"
                onPress={warmups.onAdd}
                loading={warmups.adding}
                disabled={paused}
                accessibilityHint="Logs lighter warm-up sets before your working sets. They don't count towards XP or records"
              />
            ) : null}
            {plates ? <Button label="Plates" icon="barbell-outline" variant="ghost" onPress={() => setPlatesOpen(true)} accessibilityHint="Shows which plates to load on each side of the bar" /> : null}
          </Row>
        ) : null}
        {plates ? <PlateCalculatorSheet visible={platesOpen} onClose={() => setPlatesOpen(false)} loadKg={p.draft.loadKg} units={units} bar={plates.bar} onChangeBar={plates.onChangeBar} /> : null}
        {showError ? <InlineMessage tone="danger">{p.logError}</InlineMessage> : null}
        {showError ? <Button label="Retry — save this set" icon="checkmark" onPress={() => p.onLogSet()} loading={p.logging} disabled={paused} /> : null}
      </View>
    </>
  );
}

/**
 * One exercise's set table: SET · PREVIOUS · KG · REPS. Logged sets are done rows, the next set is
 * the one active row, the rest of the plan is queued (display-only: sets are appended in order).
 * Warm-up sets show a W and are not numbered: the working sets count 1, 2, 3, and PREVIOUS lines up with them.
 */
function SetTable({
  exercise,
  units,
  focused,
  draft,
  paused,
  busy,
  onPatch,
  onComplete,
  later,
  canMarkWarmup,
  deleteLabelled,
  onDeleteSet,
  onEditSet,
}: {
  exercise: SessionExercise;
  units: Units;
  focused: boolean;
  draft: Draft;
  paused: boolean;
  busy?: boolean;
  /** Changes the next set's draft (several fields at once when PREVIOUS is tapped). */
  onPatch: (patch: Partial<Draft>) => void;
  onComplete?: (values: { kg: number | null; reps: number | null }) => void;
  /**
   * The focused exercise only: the sets after the next one are checkable too, each starting from `draft`
   * (checking one logs it as the next set). Without it they are display-only targets. It also offers "Add set".
   */
  later?: { draft: { reps: number; loadKg: number }; onComplete: (values: { kg: number | null; reps: number | null }) => void };
  /** Only the focused exercise lets the next set be marked a warm-up (keeps each switch label unique). */
  canMarkWarmup: boolean;
  /** Only the focused exercise offers delete (its label is just "Delete set N"), keeping each label unique. */
  deleteLabelled: boolean;
  onDeleteSet: (id: string) => void;
  onEditSet?: ActiveWorkoutViewProps['onEditSet'];
}) {
  const logged = exercise.loggedSets.length;
  const loggedWarmups = exercise.loggedSets.filter((s) => s.warmup).length;
  // Extra rows the user added past the plan ("Add set").
  const [added, setAdded] = useState(0);
  // The focused exercise always has a next set to log (even past the plan); others only while sets remain.
  const showActive = focused || !exerciseDone(exercise);
  const activeIsWarmup = showActive && !!onComplete && !!draft.warmup;
  // Planned sets are working sets: warm-ups (logged, or the one being entered) come on top of them.
  const planned = (exercise.sets ?? 0) + loggedWarmups + (activeIsWarmup ? 1 : 0);
  const total = Math.max(planned + (later ? added : 0), logged + (showActive ? 1 : 0));
  if (total === 0) return null;
  const prev = exercise.previous?.sets ?? [];
  const prevText = (working: number | null) => {
    const p = working === null ? undefined : prev[working];
    return p ? `${p.reps}${p.loadKg > 0 ? ` × ${loadToDisplay(p.loadKg, units)}` : ''}` : '—';
  };
  const targetReps = exercise.targetReps ? (exercise.targetReps.min === exercise.targetReps.max ? String(exercise.targetReps.min) : `${exercise.targetReps.min}–${exercise.targetReps.max}`) : null;
  const targetKg = exercise.targetLoadKg != null ? String(loadToDisplay(snapLoadKg(exercise.targetLoadKg, units), units)) : null;
  const unit = loadUnit(units);
  const completeLabel = (n: number, d: { reps: number; loadKg: number }) =>
    focused ? `Complete set ${n}, ${d.reps} ${d.reps === 1 ? 'rep' : 'reps'}${exercise.loadable ? ` at ${loadToDisplay(d.loadKg, units)} ${unit}` : ''}` : `Log set ${n} of ${exercise.name}`;
  // Working and warm-up sets seen so far in the walk down the table.
  let work = 0;
  let warm = 0;
  return (
    <View style={{ gap: space.xs }}>
      <SetTableHeader loadable={exercise.loadable} unit={unit} />
      {Array.from({ length: total }, (_, i) => {
        const s = exercise.loggedSets[i];
        // One key per row position, whatever its state: logging set n turns the same SetRow from active to done
        // (not an unmount + mount), which is what lets it play its completion animation.
        const rowKey = `set-${exercise.exerciseId}-${i + 1}`;
        if (s) {
          const isWarmup = !!s.warmup;
          const n = isWarmup ? ++warm : ++work;
          return (
            <SetRow
              key={rowKey}
              number={n}
              warmup={isWarmup}
              state="done"
              loadable={exercise.loadable}
              previous={prevText(isWarmup ? null : n - 1)}
              unit={unit}
              kg={String(loadToDisplay(s.loadKg, units))}
              reps={String(s.reps)}
              kgValue={loadToDisplay(s.loadKg, units)}
              repsValue={s.reps}
              onEdit={
                deleteLabelled && onEditSet
                  ? (values, done) => {
                      // Send only what changed; nothing changed means nothing to save.
                      const patch: { reps?: number; loadKg?: number; warmup?: boolean } = {};
                      if (values.reps !== null && values.reps !== s.reps) patch.reps = values.reps;
                      if (exercise.loadable && values.kg !== null && values.kg !== loadToDisplay(s.loadKg, units)) patch.loadKg = loadFromDisplay(values.kg, units);
                      if (values.warmup !== undefined) patch.warmup = values.warmup;
                      if (patch.reps === undefined && patch.loadKg === undefined && patch.warmup === undefined) done();
                      else onEditSet(s.id, patch, done);
                    }
                  : undefined
              }
              onDelete={deleteLabelled ? () => onDeleteSet(s.id) : undefined}
              verifiedReps={s.verifiedReps}
              verified={
                s.verifiedReps > 0
                  ? { label: `${s.verifiedReps} verified${s.formScore !== null ? ` · ${formWord(s.formScore)}` : ''}` }
                  : verificationNote(s.verificationStatus)
                    ? { label: verificationNote(s.verificationStatus)!, tone: 'warning' }
                    : null
              }
            />
          );
        }
        // Without a way to log it (another exercise, no onLogSetAt) the next set is shown, not editable.
        if (i === logged && showActive && onComplete) {
          const isWarmup = activeIsWarmup;
          const n = isWarmup ? ++warm : ++work;
          const last = isWarmup ? undefined : prev[n - 1];
          return (
            <SetRow
              key={rowKey}
              number={n}
              warmup={isWarmup}
              onToggleWarmup={canMarkWarmup ? () => onPatch({ warmup: !draft.warmup }) : undefined}
              onUsePrevious={last ? () => onPatch({ reps: last.reps, ...(exercise.loadable ? { loadKg: last.loadKg } : {}) }) : undefined}
              state="active"
              loadable={exercise.loadable}
              previous={prevText(isWarmup ? null : n - 1)}
              kg={null}
              reps={null}
              unit={unit}
              kgValue={loadToDisplay(draft.loadKg, units)}
              repsValue={draft.reps}
              onChangeKg={(v) => onPatch({ loadKg: loadFromDisplay(v, units) })}
              onChangeReps={(reps) => onPatch({ reps })}
              onComplete={onComplete && ((values) => onComplete({ kg: values.kg === null ? null : loadFromDisplay(values.kg, units), reps: values.reps }))}
              completeLabel={isWarmup ? 'Complete warm-up set' : completeLabel(n, draft)}
              busy={busy}
              disabled={paused}
            />
          );
        }
        const n = ++work;
        if (later) {
          // A planned set still to do: prefilled, editable on the spot, and checkable.
          return (
            <SetRow
              key={rowKey}
              number={n}
              state="active"
              loadable={exercise.loadable}
              previous={prevText(n - 1)}
              kg={null}
              reps={null}
              unit={unit}
              kgValue={loadToDisplay(later.draft.loadKg, units)}
              repsValue={later.draft.reps}
              onComplete={(values) => later.onComplete({ kg: values.kg === null ? null : loadFromDisplay(values.kg, units), reps: values.reps })}
              completeLabel={completeLabel(n, later.draft)}
              busy={busy}
              disabled={paused}
            />
          );
        }
        return <SetRow key={rowKey} number={n} state="queued" loadable={exercise.loadable} unit={unit} previous={prevText(n - 1)} kg={targetKg} reps={targetReps} />;
      })}
      {later ? <Button label="Add set" icon="add" variant="ghost" onPress={() => setAdded((a) => Math.max(a + 1, logged + 2 - planned))} disabled={paused} accessibilityHint="Adds one more set to this exercise" /> : null}
      {canMarkWarmup && onComplete ? (
        <AppText variant="caption" color={colors.textFaint}>
          Tick a set when you finish it. Tap the set number to mark a warm-up, or the previous value to reuse it. Warm-ups don&apos;t count towards XP, records or totals.
        </AppText>
      ) : null}
    </View>
  );
}

/** Free-text notes on the workout. Saved when the field loses focus; the server trims and sanitizes. */
function NotesField({ saved, onSave }: { saved: string; onSave: NonNullable<ActiveWorkoutViewProps['onSaveNotes']> }) {
  const [text, setText] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState(saved);
  const commit = () => {
    const next = text.trim();
    if (next === lastSaved.trim()) return;
    setError(null);
    onSave(next === '' ? null : next, (message) => {
      if (message) setError(message);
      else setLastSaved(next);
    });
  };
  return (
    <Field
      label="Workout notes"
      placeholder="How did it feel? Anything to remember next time?"
      value={text}
      onChangeText={setText}
      onBlur={commit}
      multiline
      maxLength={NOTES_MAX}
      textAlignVertical="top"
      hint={`${text.length} / ${NOTES_MAX}`}
      error={error ?? undefined}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md, paddingVertical: space.xs },
  body: { padding: space.lg, gap: space.xl, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingBottom: space.xxl * 2 },
  section: { gap: space.md, paddingVertical: space.lg },
  art: { alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  // A soft wash, not a bordered card: the section is already one panel, so no card inside a card.
  entry: { gap: space.lg, padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.wash },
  pill: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.md },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
});
