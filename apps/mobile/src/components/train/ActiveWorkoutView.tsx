import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExerciseArt } from '@/components/art/ExerciseArt';
import { AppText, Badge, Button, IconButton, InlineMessage, Row, StatStrip } from '@/components/ui';
import type { SessionExercise, WorkoutSession } from '@/lib/types';
import { sessionTotals, elapsedSeconds, exerciseDone, formatClock, formatPrevious, formatTarget, formWord, restRemaining } from '@/lib/workoutSession';
import { colors, MAX_CONTENT_WIDTH, radius, space } from '@/theme/tokens';
import { Stepper } from './Stepper';

export interface ActiveWorkoutViewProps {
  session: WorkoutSession;
  index: number;
  onSelectExercise: (index: number) => void;
  draft: { reps: number; loadKg: number };
  onChangeDraft: (draft: { reps: number; loadKg: number }) => void;
  loadStepKg: number;
  onLogSet: () => void;
  logging?: boolean;
  /** Last log attempt failed; the set is kept and can be retried without duplicating. */
  logError?: string | null;
  onDeleteSet: (setId: string) => void;
  onPause: () => void;
  onResume: () => void;
  onSkipRest: () => void;
  onAddRest: (seconds: number) => void;
  onEnd: () => void;
  onClose: () => void;
  /** Opens live camera tracking for the current exercise; omitted when the move or build has no camera support. */
  onOpenCamera?: () => void;
  now: Date;
  /** The user's today, to say when a session left open was started. */
  today: string;
}

/**
 * The live workout screen: one exercise, one set at a time, big controls, minimal distraction.
 * Pure view — every value comes from the server session; every action is a callback.
 */
export function ActiveWorkoutView(p: ActiveWorkoutViewProps) {
  const { session, index, now } = p;
  const exercise: SessionExercise | undefined = session.exercises[index];
  const paused = session.status === 'paused';
  const rest = restRemaining(session, now);
  const resting = rest !== null && rest > 0 && !paused;
  const setNumber = (exercise?.loggedSets.length ?? 0) + 1;
  const target = exercise ? formatTarget(exercise) : null;
  const previous = exercise ? formatPrevious(exercise) : null;
  const totals = sessionTotals(session);

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

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
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

        {exercise ? (
          <>
            <View style={styles.art}>
              <ExerciseArt exerciseId={exercise.exerciseId} name={exercise.name} size="card" style={{ height: resting ? 110 : 150 }} />
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

            {resting ? (
              <View style={styles.rest} accessibilityLiveRegion="polite">
                <AppText variant="bodyStrong" color={colors.textMuted}>
                  Rest — breathe, you’ve earned it
                </AppText>
                <AppText variant="display" style={{ fontSize: 72, lineHeight: 80, fontVariant: ['tabular-nums'] }} accessibilityLabel={`${rest} seconds of rest left`}>
                  {formatClock(rest!)}
                </AppText>
                <Row>
                  <Button label="+30 s" variant="secondary" onPress={() => p.onAddRest(rest! + 30)} style={{ flex: 1 }} />
                  <Button label="Skip rest" variant="secondary" onPress={p.onSkipRest} style={{ flex: 1 }} />
                </Row>
              </View>
            ) : (
              <View style={styles.entry}>
                <Row gap={space.lg} style={{ alignItems: 'flex-start' }}>
                  <Stepper label="Reps" value={p.draft.reps} onChange={(reps) => p.onChangeDraft({ ...p.draft, reps })} />
                  {exercise.loadable ? (
                    <Stepper label="Weight" unit="kg" value={p.draft.loadKg} step={p.loadStepKg} max={1000} onChange={(loadKg) => p.onChangeDraft({ ...p.draft, loadKg })} />
                  ) : null}
                </Row>
                {p.logError ? <InlineMessage tone="danger">{p.logError}</InlineMessage> : null}
                <Button label={p.logError ? 'Retry — save this set' : `Log set ${setNumber}`} icon="checkmark" onPress={p.onLogSet} loading={p.logging} disabled={paused} />
              </View>
            )}

            <SetTable exercise={exercise} onDeleteSet={p.onDeleteSet} />
          </>
        ) : (
          <InlineMessage tone="info">No exercises in this workout yet.</InlineMessage>
        )}

        <Button label="End workout" variant="secondary" icon="flag-outline" onPress={p.onEnd} />
      </ScrollView>

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

/**
 * The set table: SET · PREVIOUS · KG · REPS — logged sets in green with a way to remove them, then
 * the planned sets still to come, faint, with last time's numbers to beat.
 */
function SetTable({ exercise, onDeleteSet }: { exercise: SessionExercise; onDeleteSet: (id: string) => void }) {
  const planned = Math.max(exercise.sets ?? 0, exercise.loggedSets.length);
  const prev = exercise.previous?.sets ?? [];
  const prevText = (i: number) => (prev[i] ? `${prev[i]!.reps}${prev[i]!.loadKg > 0 ? ` × ${prev[i]!.loadKg}` : ''}` : '—');
  if (planned === 0) return null;
  return (
    <View style={styles.table}>
      <Row style={styles.tableHead} gap={0}>
        <AppText variant="label" color={colors.textFaint} style={[styles.colSet, styles.headText]}>
          SET
        </AppText>
        <AppText variant="label" color={colors.textFaint} style={[styles.colPrev, styles.headText]}>
          PREVIOUS
        </AppText>
        {exercise.loadable ? (
          <AppText variant="label" color={colors.textFaint} style={[styles.colNum, styles.headText]}>
            KG
          </AppText>
        ) : null}
        <AppText variant="label" color={colors.textFaint} style={[styles.colNum, styles.headText]}>
          REPS
        </AppText>
        <View style={styles.colAction} />
      </Row>
      {Array.from({ length: planned }, (_, i) => {
        const s = exercise.loggedSets[i];
        return (
          <Row key={s?.id ?? `next${i}`} gap={0} style={[styles.tableRow, s ? styles.rowDone : null]}>
            <View style={styles.colSet}>
              <View style={[styles.setNo, !s && styles.setNoNext]}>
                {s ? <Ionicons name="checkmark" size={14} color={colors.onPrimary} /> : <AppText variant="label" color={colors.textMuted}>{i + 1}</AppText>}
              </View>
            </View>
            <AppText variant="caption" color={colors.textFaint} style={styles.colPrev} numberOfLines={1}>
              {prevText(i)}
            </AppText>
            {exercise.loadable ? (
              <AppText variant="bodyStrong" color={s ? colors.text : colors.textFaint} style={styles.colNum}>
                {s ? String(s.loadKg) : exercise.targetLoadKg != null ? String(exercise.targetLoadKg) : '—'}
              </AppText>
            ) : null}
            <AppText variant="bodyStrong" color={s ? colors.text : colors.textFaint} style={styles.colNum}>
              {s ? String(s.reps) : exercise.targetReps ? `${exercise.targetReps.min}–${exercise.targetReps.max}` : '—'}
            </AppText>
            <View style={styles.colAction}>
              {s ? <IconButton icon="trash-outline" label={`Delete set ${i + 1}`} onPress={() => onDeleteSet(s.id)} /> : null}
            </View>
            {s && s.verifiedReps > 0 ? (
              <View style={styles.verified}>
                <Badge label={`${s.verifiedReps} verified${s.formScore !== null ? ` · ${formWord(s.formScore)}` : ''}`} tone="primary" icon="checkmark" />
              </View>
            ) : null}
          </Row>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  table: { borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, overflow: 'hidden' },
  tableHead: { paddingHorizontal: space.md, paddingVertical: space.sm, backgroundColor: colors.wash, borderBottomWidth: 1, borderBottomColor: colors.border },
  headText: { fontSize: 11, letterSpacing: 1 },
  tableRow: { paddingHorizontal: space.md, minHeight: 52, flexWrap: 'wrap', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hairline },
  rowDone: { backgroundColor: colors.successSoft },
  colSet: { width: 44 },
  colPrev: { flex: 1 },
  colNum: { width: 64, textAlign: 'center', fontVariant: ['tabular-nums'] },
  colAction: { width: 44, alignItems: 'flex-end' },
  setNoNext: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.borderStrong },
  verified: { width: '100%', paddingLeft: 44, paddingBottom: space.sm },
  art: { alignItems: 'center', backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, paddingVertical: space.sm },
  screen: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.md, paddingVertical: space.xs },
  body: { padding: space.lg, gap: space.xl, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingBottom: space.xxl * 2 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 36, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  entry: { gap: space.lg, padding: space.lg, borderRadius: radius.xl, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  rest: { gap: space.md, alignItems: 'center', padding: space.xl, borderRadius: radius.xl, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.accent },
  setNo: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center' },
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    padding: space.xl,
  },
});
