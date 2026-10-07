import { EXERCISE_BY_ID, LivePoseSession } from '@form/domain';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LiveCameraView } from '@/components/camera/LiveCameraView';
import { PoseCameraFeed } from '@/components/camera/PoseCameraFeed';
import { StateView } from '@/components/ui';
import { cameraScreenModel, type CameraAction, type CameraStatus, type LiveReadout, type PoseStatus } from '@/lib/pose/status';
import { uuid } from '@/lib/dates';
import { useScreenAwake } from '@/lib/keepAwake';
import { useActiveSession, useLogSet, useSessionAction } from '@/lib/queries';
import { formatTarget, nextSetDefaults } from '@/lib/workoutSession';
import { colors } from '@/theme/tokens';

/**
 * Live camera for one exercise. Inside a workout it shows the current set, pauses the workout with
 * the camera and logs the set with its recorded trace — the server re-verifies reps, form and ROM
 * from that trace, and its count is the one that counts. Opened from the library it's practice
 * mode: the same live verification, nothing logged.
 */
export default function CameraScreen() {
  useScreenAwake();
  const { exerciseId = '' } = useLocalSearchParams<{ exerciseId: string }>();
  const exercise = EXERCISE_BY_ID.get(exerciseId);
  const [session] = useState(() => LivePoseSession.for(exerciseId));
  const active = useActiveSession();
  const workout = active.data ?? null;
  const action = useSessionAction(workout?.id ?? '');
  const logSet = useLogSet(workout?.id ?? '');
  const inWorkout = workout?.exercises.find((e) => e.exerciseId === exerciseId) ?? null;

  const [started, setStarted] = useState(false);
  const [localPaused, setLocalPaused] = useState(false);
  const [camera, setCamera] = useState<CameraStatus>({ kind: 'off' });
  const [pose, setPose] = useState<PoseStatus>({ kind: 'idle' });
  const [readout, setReadout] = useState<LiveReadout | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [logMessage, setLogMessage] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  // A failed save keeps its client id, so retrying can never create a second copy of the set.
  const [pendingSetId, setPendingSetId] = useState<string | null>(null);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/train' as Href));

  if (!exercise || !session) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}>
        <StateView
          kind="unavailable"
          title="No camera tracking for this move"
          message="Camera tracking supports squats, push-ups, lunges and bicep curls. Log this exercise manually."
          actionLabel="Go back"
          onAction={close}
        />
      </SafeAreaView>
    );
  }

  const paused = localPaused || (inWorkout !== null && workout?.status === 'paused');
  const model = cameraScreenModel(started ? camera : { kind: 'off' }, pose, readout, paused);

  const onAction = (a: CameraAction) => {
    if (a === 'start') {
      setStarted(true);
      setCamera({ kind: 'requesting' });
    } else if (a === 'settings' && Platform.OS !== 'web') Linking.openSettings();
    else {
      setCamera({ kind: 'requesting' });
      setPose({ kind: 'idle' });
      setRetryToken((n) => n + 1);
    }
  };
  // In a workout, pausing the camera pauses the workout clock too (server-side), and vice versa.
  const pause = () => (inWorkout ? action.mutate('pause') : setLocalPaused(true));
  const resume = () => {
    setLocalPaused(false);
    if (inWorkout && workout?.status === 'paused') action.mutate('resume');
  };

  const onLogSet = () => {
    if (!inWorkout) return;
    const clientSetId = pendingSetId ?? uuid();
    setPendingSetId(clientSetId);
    setLogMessage(null);
    const live = session.verifiedReps ?? 0;
    logSet.mutate(
      {
        clientSetId,
        exerciseId,
        // Recorded reps start at what the camera verified; they can be edited in the workout afterwards.
        reps: live,
        loadKg: inWorkout.loadable ? nextSetDefaults(inWorkout).loadKg : 0,
        targetReps: inWorkout.targetReps?.max,
        targetLoadKg: inWorkout.targetLoadKg ?? undefined,
        restSeconds: inWorkout.restSeconds,
        trace: session.trace(),
      },
      {
        onSuccess: ({ set }) => {
          setPendingSetId(null);
          session.startSet();
          setReadout(null);
          const form = set.formScore !== null ? `, form ${set.formScore}` : '';
          const differs = set.verifiedReps !== live ? " (the server's check is final)" : '';
          setLogMessage({ tone: 'success', text: `Set saved — ${set.verifiedReps} verified rep${set.verifiedReps === 1 ? '' : 's'}${form}${differs}.` });
        },
        onError: (e) =>
          setLogMessage({ tone: 'danger', text: e.kind === 'network' ? 'Not saved — no connection. Your reps are kept; try again.' : e.message }),
      },
    );
  };

  const setNumber = inWorkout ? inWorkout.loggedSets.length + 1 : null;
  return (
    <LiveCameraView
      exerciseName={exercise.name}
      setLabel={inWorkout ? `Set ${setNumber}${inWorkout.sets ? ` of ${inWorkout.sets}` : ''}` : null}
      targetLabel={inWorkout ? formatTarget(inWorkout) : `${exercise.targetReps.min}–${exercise.targetReps.max} reps`}
      setupText={exercise.camera?.setup ?? ''}
      model={model}
      readout={readout}
      paused={paused}
      feed={
        started ? (
          <PoseCameraFeed active={!paused} session={session} retryToken={retryToken} onCamera={setCamera} onPose={setPose} onReadout={setReadout} />
        ) : null
      }
      onLogSet={inWorkout ? onLogSet : undefined}
      logging={logSet.isPending}
      logMessage={logMessage}
      onResetCount={
        inWorkout
          ? undefined
          : () => {
              session.startSet();
              setReadout(null);
            }
      }
      onAction={onAction}
      onPause={pause}
      onResume={resume}
      onEnd={close}
    />
  );
}
