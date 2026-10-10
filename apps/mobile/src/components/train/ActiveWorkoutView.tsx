import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExerciseArt } from '@/components/art/ExerciseArt';
import { AppText, Button, Divider, ExerciseRow, IconButton, InlineMessage, Row, StatStrip } from '@/components/ui';
import type { SessionExercise, WorkoutSession } from '@/lib/types';
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
} from '@/lib/workoutSession';
import { colors, MAX_CONTENT_WIDTH, radius, space } from '@/theme/tokens';
import { RestTimerPill } from './RestTimerPill';
import { SetRow, SetTableHeader } from './SetRow';
import { Stepper } from './Stepper';

type Draft = { reps: number; loadKg: number };

export interface ActiveWorkoutViewProps {
  session: WorkoutSession;
  index: number;
  onSelectExercise: (index: number) => void;
  draft: Draft;
  onChangeDraft: (draft: Draft) => void;
  loadStepKg: number;
  /**
   * Logs the focused exercise's next set. The set row's check passes the numbers it just committed
   * (the parent's draft can lag a keystroke in the same tick); the 'Log set N' button passes nothing
   * and logs `draft`.
   */
  onLogSet: (draft?: Draft) => void;
  logging?: boolean;
  /** Last log attempt failed; the set is kept and can be retried without duplicating. */
  logError?: string | null;
  /** Which exercise the log error belongs to; defaults to the focused one. */
  logErrorIndex?: number | null;
  onDeleteSet: (setId: string) => void;
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
  now: Date;
  /** The user's today, to say when a session left open was started. */
  today: string;
}

/** Room under the last row so the floating rest pill never covers it. */
const REST_PILL_ROOM = 170;

const draftKey = (e: SessionExercise) => `${e.exerciseId}:${e.loggedSets.length}`;

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
  const errorIndex = p.logErrorIndex === undefined ? index : p.logErrorIndex;
  // Drafts for the next set of exercises that aren't focused, keyed `${exerciseId}:${loggedCount}`.
  const [rowDrafts, setRowDrafts] = useState<Record<string, Draft>>({});

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
              { label: 'Volume', value: totals.volumeKg.toLocaleString(), unit: 'kg' },
              { label: 'Sets', value: String(totals.sets) },
            ]}
          />
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
                const rowDraft = rowDrafts[key] ?? nextSetDefaults(e);
                const patchRow = (patch: Partial<Draft>) => setRowDrafts((prev) => ({ ...prev, [key]: { ...(prev[key] ?? nextSetDefaults(e)), ...patch } }));
                return (
                  <View key={`${e.exerciseId}-${i}`}>
                    {i > 0 ? <Divider /> : null}
                    <View style={styles.section}>
                      {focused ? (
                        <FocusedHeader p={p} exercise={e} paused={paused} showError={!!p.logError && errorIndex === i} />
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
                        focused={focused}
                        draft={focused ? p.draft : rowDraft}
                        paused={paused}
                        busy={p.logging}
                        onChangeKg={(loadKg) => (focused ? p.onChangeDraft({ ...p.draft, loadKg }) : patchRow({ loadKg }))}
                        onChangeReps={(reps) => (focused ? p.onChangeDraft({ ...p.draft, reps }) : patchRow({ reps }))}
                        onComplete={
                          focused
                            ? (values) => {
                                const d: Draft = { reps: values.reps ?? p.draft.reps, loadKg: e.loadable ? (values.kg ?? p.draft.loadKg) : p.draft.loadKg };
                                // The row reports each edited field separately, so push the whole set last.
                                if (d.reps !== p.draft.reps || d.loadKg !== p.draft.loadKg) p.onChangeDraft(d);
                                p.onLogSet(d);
                              }
                            : p.onLogSetAt
                              ? (values) => p.onLogSetAt?.(i, { reps: values.reps ?? rowDraft.reps, loadKg: e.loadable ? (values.kg ?? rowDraft.loadKg) : 0 })
                              : undefined
                        }
                        completeLabel={(n) => (focused ? `Complete set ${n}` : `Log set ${n} of ${e.name}`)}
                        deleteLabelled={focused}
                        onDeleteSet={p.onDeleteSet}
                      />
                    </View>
                  </View>
                );
              })}
            </View>
          ) : (
            <InlineMessage tone="info">No exercises in this workout yet.</InlineMessage>
          )}

          <Button label="End workout" variant="secondary" icon="flag-outline" onPress={p.onEnd} />
        </ScrollView>

        {resting ? (
          <View style={styles.pill} pointerEvents="box-none">
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
          <Button label="Resume" icon="play" onPress={p.onResume} style={{ alignSelf: 'stretch' }} />
          <Button label="End workout" variant="ghost" onPress={p.onEnd} />
        </View>
      ) : null}
    </SafeAreaView>
  );
}

/** The focused exercise: moving art, name, where you are, notes, camera, steppers and the log button. */
function FocusedHeader({ p, exercise, paused, showError }: { p: ActiveWorkoutViewProps; exercise: SessionExercise; paused: boolean; showError: boolean }) {
  const setNumber = exercise.loggedSets.length + 1;
  const target = formatTarget(exercise);
  const previous = formatPrevious(exercise);
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
          Set {setNumber}
          {exercise.sets ? ` of ${exercise.sets}` : ''}
          {target ? ` · ${target}` : ''}
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
          {exercise.cameraVerifiable ? 'Reps you enter yourself are recorded. Use the camera to have them verified.' : 'Enter your reps as you go.'}
        </AppText>
      </View>

      <View style={styles.entry}>
        <Row gap={space.lg} style={{ alignItems: 'flex-start' }}>
          <Stepper label="Reps" value={p.draft.reps} onChange={(reps) => p.onChangeDraft({ ...p.draft, reps })} />
          {exercise.loadable ? (
            <Stepper label="Weight" unit="kg" value={p.draft.loadKg} step={p.loadStepKg} max={1000} onChange={(loadKg) => p.onChangeDraft({ ...p.draft, loadKg })} />
          ) : null}
        </Row>
        {showError ? <InlineMessage tone="danger">{p.logError}</InlineMessage> : null}
        <Button label={showError ? 'Retry — save this set' : `Log set ${setNumber}`} icon="checkmark" onPress={() => p.onLogSet()} loading={p.logging} disabled={paused} />
      </View>
    </>
  );
}

/**
 * One exercise's set table: SET · PREVIOUS · KG · REPS. Logged sets are done rows, the next set is
 * the one active row, the rest of the plan is queued (display-only: sets are appended in order).
 */
function SetTable({
  exercise,
  focused,
  draft,
  paused,
  busy,
  onChangeKg,
  onChangeReps,
  onComplete,
  completeLabel,
  deleteLabelled,
  onDeleteSet,
}: {
  exercise: SessionExercise;
  focused: boolean;
  draft: Draft;
  paused: boolean;
  busy?: boolean;
  onChangeKg: (v: number) => void;
  onChangeReps: (v: number) => void;
  onComplete?: (values: { kg: number | null; reps: number | null }) => void;
  completeLabel: (setNumber: number) => string;
  /** Only the focused exercise offers delete (its label is just "Delete set N"), keeping each label unique. */
  deleteLabelled: boolean;
  onDeleteSet: (id: string) => void;
}) {
  const logged = exercise.loggedSets.length;
  // The focused exercise always has a next set to log (even past the plan); others only while sets remain.
  const showActive = focused || !exerciseDone(exercise);
  const total = Math.max(exercise.sets ?? 0, logged + (showActive ? 1 : 0));
  if (total === 0) return null;
  const prev = exercise.previous?.sets ?? [];
  const prevText = (i: number) => (prev[i] ? `${prev[i]!.reps}${prev[i]!.loadKg > 0 ? ` × ${prev[i]!.loadKg}` : ''}` : '—');
  const targetReps = exercise.targetReps ? (exercise.targetReps.min === exercise.targetReps.max ? String(exercise.targetReps.min) : `${exercise.targetReps.min}–${exercise.targetReps.max}`) : null;
  const targetKg = exercise.targetLoadKg != null ? String(exercise.targetLoadKg) : null;
  return (
    <View style={{ gap: space.xs }}>
      <SetTableHeader loadable={exercise.loadable} />
      {Array.from({ length: total }, (_, i) => {
        const s = exercise.loggedSets[i];
        const n = i + 1;
        // One key per set number, whatever its state: logging set n turns the same SetRow from active to done
        // (not an unmount + mount), which is what lets it play its completion animation.
        const rowKey = `set-${exercise.exerciseId}-${n}`;
        if (s) {
          return (
            <SetRow
              key={rowKey}
              number={n}
              state="done"
              loadable={exercise.loadable}
              previous={prevText(i)}
              kg={String(s.loadKg)}
              reps={String(s.reps)}
              onDelete={deleteLabelled ? () => onDeleteSet(s.id) : undefined}
              verified={s.verifiedReps > 0 ? { label: `${s.verifiedReps} verified${s.formScore !== null ? ` · ${formWord(s.formScore)}` : ''}` } : null}
            />
          );
        }
        // Without a way to log it (another exercise, no onLogSetAt) the next set is shown, not editable.
        if (i === logged && showActive && onComplete) {
          return (
            <SetRow
              key={rowKey}
              number={n}
              state="active"
              loadable={exercise.loadable}
              previous={prevText(i)}
              kg={null}
              reps={null}
              kgValue={draft.loadKg}
              repsValue={draft.reps}
              onChangeKg={onChangeKg}
              onChangeReps={onChangeReps}
              onComplete={onComplete}
              completeLabel={completeLabel(n)}
              busy={busy}
              disabled={paused}
            />
          );
        }
        return <SetRow key={rowKey} number={n} state="queued" loadable={exercise.loadable} previous={prevText(i)} kg={targetKg} reps={targetReps} />;
      })}
    </View>
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
