import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMarkWorkoutRecordsSeen } from '@/components/recognition/Celebrations';
import { ActiveWorkoutView } from '@/components/train/ActiveWorkoutView';
import { WorkoutSummaryView } from '@/components/train/WorkoutSummaryView';
import { AppText, Button, Card, ErrorState, InlineMessage, Segmented, StateView } from '@/components/ui';
import { localDateKey, uuid } from '@/lib/dates';
import { useScreenAwake } from '@/lib/keepAwake';
import { livePoseSupport } from '@/lib/pose/support';
import { useActiveSession, useCoachInsight, useCompleteSession, useDeleteSet, useExercises, useLogSet, useSessionAction, useStartRest } from '@/lib/queries';
import type { CompletionResult, PainLevel, WorkoutSession } from '@/lib/types';
import { currentExerciseIndex, exerciseDone, nextSetDefaults } from '@/lib/workoutSession';
import { colors, MAX_CONTENT_WIDTH, space } from '@/theme/tokens';

/** Full-screen live workout. All state is on the server, so leaving and coming back resumes exactly here. */
export default function WorkoutScreen() {
  useScreenAwake();
  const active = useActiveSession();
  const [result, setResult] = useState<CompletionResult | null>(null);
  useMarkWorkoutRecordsSeen(result?.workout.id ?? null);
  const coachNote = useCoachInsight('workout', !!result);

  if (result) {
    return (
      <Shell>
        <WorkoutSummaryView summary={result} onDone={() => router.replace('/train' as Href)} coachNote={coachNote.data?.insight ?? null} onCoachAction={(route) => router.replace(route as Href)} />
      </Shell>
    );
  }
  if (active.isPending) return <Shell><StateView kind="loading" /></Shell>;
  if (active.isError && !active.data) return <Shell><ErrorState error={active.error} onRetry={active.refetch} /></Shell>;
  if (!active.data) {
    return (
      <Shell>
        <StateView kind="empty" title="No workout in progress" message="Start today's workout from Train." actionLabel="Go to Train" onAction={() => router.replace('/train' as Href)} />
      </Shell>
    );
  }
  return <LiveWorkout session={active.data} onCompleted={setResult} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView contentContainerStyle={{ padding: space.lg, gap: space.lg, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' }}>{children}</ScrollView>
    </SafeAreaView>
  );
}

function LiveWorkout({ session, onCompleted }: { session: WorkoutSession; onCompleted: (r: CompletionResult) => void }) {
  const library = useExercises();
  const logSet = useLogSet(session.id);
  const deleteSet = useDeleteSet(session.id);
  const action = useSessionAction(session.id);
  const rest = useStartRest(session.id);
  const complete = useCompleteSession(session.id);

  const [now, setNow] = useState(() => new Date());
  const [selected, setSelected] = useState<number | null>(null);
  const [override, setOverride] = useState<{ key: string; reps: number; loadKg: number } | null>(null);
  // A failed save keeps its client id, so "Retry" can never create a second copy of the set.
  // Keyed `${exerciseId}:${loggedCount}` so every exercise's pending set has its own id.
  const pending = useRef(new Map<string, string>());
  const [logError, setLogError] = useState<string | null>(null);
  const [logErrorIndex, setLogErrorIndex] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [pain, setPain] = useState<PainLevel>('none');
  const [finishError, setFinishError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const index = selected ?? currentExerciseIndex(session);
  const exercise = session.exercises[index];
  const draftKey = exercise ? `${exercise.exerciseId}:${exercise.loggedSets.length}` : '';
  const draft = override?.key === draftKey ? override : exercise ? nextSetDefaults(exercise) : { reps: 10, loadKg: 0 };
  const loadStepKg = library.data?.exercises.find((e) => e.id === exercise?.exerciseId)?.loadIncrementKg || 2.5;

  /** Logs the next set of exercise `i` with exactly `values` — the focused exercise or any other. */
  const logAt = (i: number, values: { reps: number; loadKg: number }) => {
    const target = session.exercises[i];
    if (!target || logSet.isPending) return;
    const key = `${target.exerciseId}:${target.loggedSets.length}`;
    const clientSetId = pending.current.get(key) ?? uuid();
    pending.current.set(key, clientSetId);
    setLogError(null);
    setLogErrorIndex(null);
    logSet.mutate(
      {
        clientSetId,
        exerciseId: target.exerciseId,
        reps: values.reps,
        loadKg: target.loadable ? values.loadKg : 0,
        targetReps: target.targetReps?.max,
        targetLoadKg: target.targetLoadKg ?? undefined,
        restSeconds: target.restSeconds,
      },
      {
        onSuccess: ({ session: next }) => {
          pending.current.delete(key);
          if (i !== index) {
            // Show what was just logged on another exercise.
            setSelected(i);
            return;
          }
          const updated = next.exercises[i];
          // Move on automatically once this exercise's planned sets are done.
          if (updated && exerciseDone(updated)) setSelected(null);
        },
        onError: (e) => {
          setLogError(e.kind === 'network' ? "Not saved — no connection. Your set is kept; tap Retry." : e.message);
          setLogErrorIndex(i);
        },
      },
    );
  };
  // The focused row's check passes the values it just typed; the Log button logs the current draft.
  const onLogSet = (typed?: { reps: number; loadKg: number }) => logAt(index, typed ?? draft);

  if (finishing) {
    return (
      <Shell>
        <AppText variant="title" header>
          Finish workout?
        </AppText>
        <Card style={{ gap: space.md }}>
          <Segmented
            label="Any pain during this workout?"
            options={[
              { value: 'none', label: 'None' },
              { value: 'mild', label: 'Mild' },
              { value: 'serious', label: 'Serious' },
            ]}
            value={pain}
            onChange={setPain}
          />
          {pain === 'serious' ? (
            <InlineMessage tone="danger">Sharp or serious pain means stop and rest. This workout will be saved, but it won&apos;t earn XP or PRs.</InlineMessage>
          ) : null}
          {finishError ? <InlineMessage tone="danger">{finishError}</InlineMessage> : null}
          <Button
            label="Finish & save"
            icon="checkmark"
            loading={complete.isPending}
            onPress={() => {
              setFinishError(null);
              // Retries are safe: completion is idempotent on the server.
              complete.mutate(pain, { onSuccess: onCompleted, onError: (e) => setFinishError(e.kind === 'network' ? "Couldn't save — check your connection and try again." : e.message) });
            }}
          />
        </Card>
        <Button label="Keep training" variant="secondary" onPress={() => setFinishing(false)} />
        <View style={{ height: space.xl }} />
        <Button
          label="Discard workout"
          variant="danger"
          onPress={() => action.mutate('discard', { onSuccess: () => router.replace('/train' as Href) })}
          accessibilityHint="Deletes this workout without saving it"
        />
      </Shell>
    );
  }

  return (
    <ActiveWorkoutView
      session={session}
      index={index}
      onSelectExercise={setSelected}
      draft={draft}
      onChangeDraft={(d) => setOverride({ key: draftKey, ...d })}
      loadStepKg={loadStepKg}
      onLogSet={onLogSet}
      onLogSetAt={logAt}
      logging={logSet.isPending}
      logError={logError}
      logErrorIndex={logErrorIndex}
      onDeleteSet={(setId) => deleteSet.mutate(setId)}
      onPause={() => action.mutate('pause')}
      onResume={() => action.mutate('resume')}
      onSkipRest={() => action.mutate('rest/skip')}
      onAddRest={(seconds) => rest.mutate(Math.min(600, seconds))}
      onEnd={() => setFinishing(true)}
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/train' as Href))}
      onOpenCamera={
        exercise?.cameraVerifiable && livePoseSupport().available ? () => router.push(`/camera?exerciseId=${exercise.exerciseId}` as Href) : undefined
      }
      now={now}
      today={localDateKey(now)}
    />
  );
}
