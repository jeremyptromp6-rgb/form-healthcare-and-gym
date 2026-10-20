import { EXERCISE_BY_ID, LivePoseSession } from '@form/domain';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LiveCameraView } from '@/components/camera/LiveCameraView';
import { PoseCameraFeed } from '@/components/camera/PoseCameraFeed';
import { StateView } from '@/components/ui';
import { useReducedMotion } from '@/lib/a11y';
import { config } from '@/lib/config';
import { nativePoseAvailable } from '@/lib/pose/nativePose';
import { cameraScreenModel, type CameraAction, type CameraStatus, type LiveReadout, type PoseDiag, type PoseStatus } from '@/lib/pose/status';
import { useGetReady } from '@/lib/pose/useGetReady';
import { uuid } from '@/lib/dates';
import { useScreenAwake } from '@/lib/keepAwake';
import { useActiveSession, useLogSet, useSessionAction } from '@/lib/queries';
import { useUnits } from '@/lib/units';
import { formatTarget, nextSetDefaults, verificationNote } from '@/lib/workoutSession';
import { colors } from '@/theme/tokens';

/** How far ahead (ms) the native body outline is drawn, in builds that collect feed numbers. */
const OVERLAY_LEAD_MS = 60;

/**
 * Live camera for one exercise. Inside a workout it shows the current set, pauses the workout with
 * the camera and logs the set with its recorded trace — the server re-verifies reps, form and ROM
 * from that trace, and its count is the one that counts. The set is logged at the load on the workout's
 * weight field (passed as `loadKg`, in kg). Opened for practice (`practice=1`, from an exercise's page)
 * it's the same live verification with nothing logged, even if a workout is open with that exercise.
 */
export default function CameraScreen() {
  useScreenAwake();
  const params = useLocalSearchParams<{ exerciseId: string; loadKg?: string; practice?: string }>();
  const { exerciseId = '' } = params;
  const practice = params.practice === '1';
  const units = useUnits();
  const exercise = EXERCISE_BY_ID.get(exerciseId);
  const [session] = useState(() => LivePoseSession.for(exerciseId));
  const active = useActiveSession();
  const workout = active.data ?? null;
  const action = useSessionAction(workout?.id ?? '');
  const logSet = useLogSet(workout?.id ?? '');
  // Practice mode never touches the workout: no logging, and pausing only pauses the camera.
  const inWorkout = practice ? null : (workout?.exercises.find((e) => e.exerciseId === exerciseId) ?? null);

  const [started, setStarted] = useState(false);
  const [localPaused, setLocalPaused] = useState(false);
  const [camera, setCamera] = useState<CameraStatus>({ kind: 'off' });
  const [pose, setPose] = useState<PoseStatus>({ kind: 'idle' });
  // A failed load is retried once on its own (a flaky download or a slow start) before the user ever sees it.
  const [autoRetried, setAutoRetried] = useState(false);
  const onPose = (p: PoseStatus) => {
    if (p.kind === 'failed' && p.retryable && !autoRetried) {
      setAutoRetried(true);
      setPose({ kind: 'loading' });
      setRetryToken((n) => n + 1);
      return;
    }
    setPose(p);
  };
  const [readout, setReadout] = useState<LiveReadout | null>(null);
  // Preview builds only, background only (never rendered): the feed's latest performance numbers.
  const diag = useRef<PoseDiag | null>(null);
  const onDiag = useCallback((d: PoseDiag) => {
    diag.current = d;
  }, []);
  // The engine the feed is actually running (it can fall back from native to the WebView mid-session).
  const [engine, setEngine] = useState<'native' | 'webview' | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [logMessage, setLogMessage] = useState<{ tone: 'success' | 'danger' | 'info'; text: string } | null>(null);
  // A failed save keeps its client id, so retrying can never create a second copy of the set.
  const [pendingSetId, setPendingSetId] = useState<string | null>(null);

  const paused = localPaused || (inWorkout !== null && workout?.status === 'paused');
  // The first time the coach is ready this visit: a short "get into position" countdown, then counting starts
  // from zero (whatever the camera saw while the numbers ran is dropped). A restart later does not repeat it.
  const reduceMotion = useReducedMotion();
  const getReady = useGetReady(started && camera.kind === 'live' && pose.kind === 'ready' && !paused, reduceMotion, () => session?.startSet());

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

  const model = cameraScreenModel(started ? camera : { kind: 'off' }, pose, readout, paused, getReady);

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
  const actionFailed = (what: string) => (e: { kind: string; message: string }) =>
    setLogMessage({ tone: 'danger', text: e.kind === 'network' ? `${what} — check your connection and try again.` : e.message });
  const pause = () => (inWorkout ? action.mutate('pause', { onError: actionFailed("Couldn't pause the workout") }) : setLocalPaused(true));
  const resume = () => {
    setLocalPaused(false);
    if (inWorkout && workout?.status === 'paused') action.mutate('resume', { onError: actionFailed("Couldn't resume the workout") });
  };

  const onLogSet = () => {
    if (!inWorkout) return;
    const clientSetId = pendingSetId ?? uuid();
    setPendingSetId(clientSetId);
    setLogMessage(null);
    const live = session.verifiedReps ?? 0;
    // The load the workout screen was showing when the camera opened; the plan's default only if none came with it.
    const given = params.loadKg === undefined || params.loadKg.trim() === '' ? NaN : Number(params.loadKg);
    const loadKg = Number.isFinite(given) && given >= 0 && given <= 1000 ? given : nextSetDefaults(inWorkout).loadKg;
    logSet.mutate(
      {
        clientSetId,
        exerciseId,
        // Recorded reps start at what the camera verified; they can be edited in the workout afterwards.
        reps: live,
        loadKg: inWorkout.loadable ? loadKg : 0,
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
          const untrusted = verificationNote(set.verificationStatus);
          setLogMessage(
            untrusted
              ? { tone: 'info', text: `Set saved — ${untrusted}. Your reps are kept as unverified.` }
              : { tone: 'success', text: `Set saved — ${set.verifiedReps} verified rep${set.verifiedReps === 1 ? '' : 's'}${form}${differs}.` },
          );
        },
        onError: (e) =>
          setLogMessage({ tone: 'danger', text: e.kind === 'network' ? 'Not saved — no connection. Your reps are kept; try again.' : e.message }),
      },
    );
  };

  // Main builds subscribe to nothing and pass nothing extra.
  const feedDiagnostics = config.diagnostics ? { onDiag, leadMs: OVERLAY_LEAD_MS } : {};
  const setNumber = inWorkout ? inWorkout.loggedSets.length + 1 : null;
  return (
    <LiveCameraView
      exerciseId={exerciseId}
      exerciseName={exercise.name}
      setLabel={inWorkout ? `Set ${setNumber}${inWorkout.sets ? ` of ${inWorkout.sets}` : ''}` : null}
      targetLabel={inWorkout ? formatTarget(inWorkout, units) : `${exercise.targetReps.min}–${exercise.targetReps.max} reps`}
      setupText={exercise.camera?.setup ?? ''}
      model={model}
      readout={readout}
      paused={paused}
      getReady={getReady}
      // The native camera fills the video area; the WebView and web feeds are boxed to the video's aspect.
      // Until the feed reports its engine, assume the one it will start with.
      feedFit={(engine ?? (nativePoseAvailable() ? 'native' : 'webview')) === 'native' ? 'fill' : 'aspect'}
      feed={
        started ? (
          <PoseCameraFeed active={!paused} session={session} retryToken={retryToken} onCamera={setCamera} onPose={onPose} onReadout={setReadout} onEngine={setEngine} {...feedDiagnostics} />
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
