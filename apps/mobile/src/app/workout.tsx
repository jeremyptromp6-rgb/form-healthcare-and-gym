import { router, type Href } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMarkWorkoutRecordsSeen } from '@/components/recognition/Celebrations';
import { ActiveWorkoutView, type Draft } from '@/components/train/ActiveWorkoutView';
import { WorkoutSummaryView } from '@/components/train/WorkoutSummaryView';
import { AppText, Button, Card, ErrorState, InlineMessage, Segmented, StateView } from '@/components/ui';
import { localDateKey, uuid } from '@/lib/dates';
import { usePostWorkoutAd } from '@/lib/ads/usePostWorkoutAd';
import type { ApiError } from '@/lib/api';
import { useScreenAwake } from '@/lib/keepAwake';
import { usePrefetchPoseModels } from '@/lib/pose/prefetch';
import { livePoseSupport } from '@/lib/pose/support';
import { useActiveSession, useCoachInsight, useCompleteSession, useDeleteSet, useExercises, useLogSet, useSessionAction, useSessionNotes, useStartRest, useUpdateSet } from '@/lib/queries';
import { secondsSinceSet, startSetClock, type SetClock } from '@/lib/liveSet';
import { onWorkoutCompleted } from '@/lib/reminders';
import type { CompletionResult, PainLevel, WorkoutSession } from '@/lib/types';
import { useUnits } from '@/lib/units';
import { currentExerciseIndex, exerciseDone, nextSetDefaults } from '@/lib/workoutSession';
import { colors, MAX_CONTENT_WIDTH, space } from '@/theme/tokens';

/** Full-screen live workout. All state is on the server, so leaving and coming back resumes exactly here. */
export default function WorkoutScreen() {
  useScreenAwake();
  // Get the camera coach's model onto the phone while the workout is under way, so the camera opens fast.
  usePrefetchPoseModels();
  const active = useActiveSession();
  const [result, setResult] = useState<CompletionResult | null>(null);
  useMarkWorkoutRecordsSeen(result?.workout.id ?? null);
  const coachNote = useCoachInsight('workout', !!result);
  // The one post-workout ad (Free tier) is decided only now — the workout is already committed.
  const ad = usePostWorkoutAd(result?.workout.id ?? null);

  if (result) {
    return (
      <Shell>
        <WorkoutSummaryView
          summary={result}
          onDone={() => ad.finish(() => router.replace('/' as Href))}
          adNext={ad.adReady}
          coachNote={coachNote.data?.insight ?? null}
          onCoachAction={(route) => router.replace(route as Href)}
        />
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
  return (
    <LiveWorkout
      session={active.data}
      onCompleted={(r) => {
        // Trained today: no "time to train" or streak nudge tonight.
        void onWorkoutCompleted();
        setResult(r);
      }}
    />
  );
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
  const updateSet = useUpdateSet(session.id);
  const units = useUnits();
  const action = useSessionAction(session.id);
  const rest = useStartRest(session.id);
  const complete = useCompleteSession(session.id);
  const saveNotes = useSessionNotes(session.id);

  const [now, setNow] = useState(() => new Date());
  const [selected, setSelected] = useState<number | null>(null);
  const [override, setOverride] = useState<({ key: string } & Draft) | null>(null);
  // A failed save keeps its client id, so "Retry" can never create a second copy of the set.
  // Keyed `${exerciseId}:${loggedCount}` so every exercise's pending set has its own id.
  const pending = useRef(new Map<string, string>());
  // Device-clock time of the previous set (or of this screen opening): checking a set off sends the time since then (pauses excluded),
  // so the server can tell a real set from a pile ticked at once. Never compared with server timestamps, so clock skew can't hurt.
  const setClock = useRef<SetClock | null>(null);
  const [logError, setLogError] = useState<string | null>(null);
  const [logErrorIndex, setLogErrorIndex] = useState<number | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [pain, setPain] = useState<PainLevel>('none');
  const [finishError, setFinishError] = useState<string | null>(null);
  // Discarding deletes the whole workout, so it takes two taps: the first asks, the second does it.
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  // The last pause / resume / rest / delete that failed, shown on the workout until the next try.
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    setClock.current ??= startSetClock(session, Date.now());
    // Only the screen opening starts the clock; later sets restart it when they save.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const index = selected ?? currentExerciseIndex(session);
  const exercise = session.exercises[index];
  const draftKey = exercise ? `${exercise.exerciseId}:${exercise.loggedSets.length}` : '';
  const draft = override?.key === draftKey ? override : exercise ? nextSetDefaults(exercise, units) : { reps: 10, loadKg: 0 };
  const loadStepKg = library.data?.exercises.find((e) => e.id === exercise?.exerciseId)?.loadIncrementKg || 2.5;

  /** Logs the next set of exercise `i` with exactly `values` — the focused exercise or any other. */
  const logAt = (i: number, values: Draft) => {
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
        ...(values.warmup ? { warmup: true } : {}),
        // Checked off after the time since the last set; the server keeps it live only if that is plausible for the reps, else it counts as manual.
        mode: 'live',
        liveSeconds: secondsSinceSet((setClock.current ??= startSetClock(session, Date.now())), session, Date.now()),
      },
      {
        onSuccess: ({ session: next }) => {
          pending.current.delete(key);
          setClock.current = startSetClock(next, Date.now());
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
  /** The onError for a session action: says what failed, and keeps the workout as it was. */
  const failed = (what: string) => (e: ApiError) => setActionError(e.kind === 'network' ? `${what} — check your connection and try again.` : e.message);
  const act = (what: string, mutate: (onError: (e: ApiError) => void) => void) => {
    setActionError(null);
    mutate(failed(what));
  };
  // A set row's check passes the values it just typed; Retry logs the current draft.
  const onLogSet = (typed?: Draft) => logAt(index, typed ?? draft);

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
        {confirmDiscard ? (
          <Card style={{ gap: space.md }}>
            <InlineMessage tone="danger">Discard this workout? Everything you logged is deleted and can&apos;t be brought back.</InlineMessage>
            {discardError ? <InlineMessage tone="danger">{discardError}</InlineMessage> : null}
            <Button
              label="Yes, discard it"
              variant="danger"
              loading={action.isPending}
              onPress={() => {
                setDiscardError(null);
                action.mutate('discard', {
                  onSuccess: () => router.replace('/train' as Href),
                  onError: (e) => setDiscardError(e.kind === 'network' ? "Couldn't discard — check your connection and try again." : e.message),
                });
              }}
            />
            <Button label="No, keep it" variant="secondary" onPress={() => setConfirmDiscard(false)} />
          </Card>
        ) : (
          <Button
            label="Discard workout"
            variant="danger"
            onPress={() => {
              setDiscardError(null);
              setConfirmDiscard(true);
            }}
            accessibilityHint="Deletes this workout without saving it"
          />
        )}
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
      onDeleteSet={(setId) => act("Couldn't delete the set", (onError) => deleteSet.mutate(setId, { onError }))}
      onEditSet={(setId, patch, done) =>
        updateSet.mutate(
          { setId, ...patch },
          { onSuccess: () => done(), onError: (e) => done(e.kind === 'network' ? "Couldn't save the change — check your connection and try again." : e.message) },
        )
      }
      onSaveNotes={(notes, done) =>
        saveNotes.mutate(notes, {
          onSuccess: () => done(),
          onError: (e) => done(e.kind === 'network' ? "Couldn't save the notes — check your connection and try again." : e.message),
        })
      }
      onPause={() => act("Couldn't pause", (onError) => action.mutate('pause', { onError }))}
      onResume={() => act("Couldn't resume", (onError) => action.mutate('resume', { onError }))}
      onSkipRest={() => act("Couldn't skip the rest", (onError) => action.mutate('rest/skip', { onError }))}
      onAddRest={(seconds) => act("Couldn't change the rest", (onError) => rest.mutate(Math.min(600, seconds), { onError }))}
      actionError={actionError}
      onEnd={() => setFinishing(true)}
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/train' as Href))}
      onOpenCamera={
        exercise?.cameraVerifiable && livePoseSupport().available ? () => router.push(`/camera?exerciseId=${exercise.exerciseId}${exercise.loadable ? `&loadKg=${draft.loadKg}` : ''}` as Href) : undefined
      }
      now={now}
      today={localDateKey(now)}
    />
  );
}
