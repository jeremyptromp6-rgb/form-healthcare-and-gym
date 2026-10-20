import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import CameraScreen from '@/app/camera';
import { READY_HOLD_MS } from '@/lib/pose/useGetReady';
import type { SessionExercise, WorkoutSession } from '@/lib/types';

// The camera route: the set it logs uses the load from the workout screen (A2-04), practice mode never
// logs (A2-22), and a failed pause or resume is shown (A2-11). The feed is the only thing stubbed.

type Opts = { onSuccess?: (r: unknown) => void; onError?: (e: { kind: string; message: string }) => void };

let mockParams: Record<string, string> = {};
let mockSession: WorkoutSession | null = null;
let mockDiagnostics = false;
let mockNative = false;
let mockFeedProps: Record<string, unknown> = {};
const mockLogMutate = jest.fn();
const mockActionMutate = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => false },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(() => Promise.resolve()), deactivateKeepAwake: jest.fn(() => Promise.resolve()) }));
// Preview builds collect the feed numbers (never shown); the flag is read when the screen renders, so a test can turn it on.
jest.mock('@/lib/config', () => {
  const actual = jest.requireActual('@/lib/config');
  const config = { ...actual.config };
  Object.defineProperty(config, 'diagnostics', { get: () => mockDiagnostics });
  return { ...actual, config };
});
// Whether the native camera is in use decides how the video area is filled.
jest.mock('@/lib/pose/nativePose', () => ({ nativePoseAvailable: () => mockNative }));
// The feed stands in for the camera and pose model: once started it reports a live camera, a ready model and 5 verified reps.
jest.mock('@/components/camera/PoseCameraFeed', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    PoseCameraFeed: (props: { onCamera: (s: unknown) => void; onPose: (s: unknown) => void; onReadout: (r: unknown) => void; onDiag?: (d: unknown) => void }) => {
      const { onCamera, onPose, onReadout, onDiag } = props;
      mockFeedProps = props as unknown as Record<string, unknown>;
      useEffect(() => {
        onCamera({ kind: 'live' });
        onPose({ kind: 'ready', backend: 'CPU' });
        onDiag?.({ fps: 27, inferMs: 31, ageP50: 78, ageP95: 120, backend: 'GPU', variant: 'full', rung: 'mask', engine: 'native' });
        onReadout({ framing: { issue: null, message: 'ok', trackable: true, side: 'left', missing: [] }, trackable: true, angleDeg: null, people: 1, fps: 28, latencyMs: 19, rep: { verifiedReps: 5 }, traceFull: false });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    },
  };
});
jest.mock('@/lib/queries', () => ({
  useActiveSession: () => ({ data: mockSession }),
  useLogSet: () => ({ mutate: mockLogMutate, isPending: false }),
  useSessionAction: () => ({ mutate: mockActionMutate }),
}));

const curl = (over: Partial<SessionExercise> = {}): SessionExercise => ({
  exerciseId: 'bicep_curl',
  name: 'Bicep Curl',
  planned: true,
  sets: 3,
  targetReps: { min: 8, max: 12 },
  targetLoadKg: 12,
  restSeconds: 90,
  note: null,
  cameraVerifiable: true,
  loadable: true,
  previous: null,
  loggedSets: [],
  ...over,
});

const makeSession = (over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 'sess-1',
  clientSessionId: 'c-1',
  status: 'active',
  localDate: '2026-09-28',
  startedAt: '2026-09-28T10:00:00Z',
  pausedAt: null,
  pausedMs: 0,
  activeMinutes: 15,
  lastActivityAt: '2026-09-28T10:19:00Z',
  idleSince: null,
  leftOpen: false,
  rest: null,
  workoutId: null,
  completedAt: null,
  exercises: [curl()],
  ...over,
});

/** Opens the screen and turns the camera on, as the user does. */
async function renderCamera() {
  await render(<CameraScreen />);
  await fireEvent.press(screen.getByRole('button', { name: 'Turn on camera' }));
}

const body = () => mockLogMutate.mock.calls[0]![0] as Record<string, unknown>;
const logSetButton = () => screen.getByRole('button', { name: /^Log set/ });

beforeEach(() => {
  mockDiagnostics = false;
  mockNative = false;
  mockFeedProps = {};
  mockParams = { exerciseId: 'bicep_curl' };
  mockSession = makeSession();
  mockLogMutate.mockReset();
  mockActionMutate.mockReset();
});

// @testing-library/react-native v14: render and events are async.
describe('camera screen inside a workout', () => {
  it("logs the set at the load the workout screen was showing, not the plan's default", async () => {
    mockParams = { exerciseId: 'bicep_curl', loadKg: '22.5' };
    await renderCamera();
    expect(screen.getByText(/Set 1 of 3/)).toBeTruthy();
    await fireEvent.press(logSetButton());
    expect(body()).toMatchObject({ exerciseId: 'bicep_curl', loadKg: 22.5, targetLoadKg: 12, targetReps: 12, restSeconds: 90 });
  });

  it('logs a converted pound entry as the kg it was handed over as', async () => {
    mockParams = { exerciseId: 'bicep_curl', loadKg: '61.23' };
    await renderCamera();
    await fireEvent.press(logSetButton());
    expect(body().loadKg).toBe(61.23);
  });

  it('keeps an explicit zero load', async () => {
    mockParams = { exerciseId: 'bicep_curl', loadKg: '0' };
    await renderCamera();
    await fireEvent.press(logSetButton());
    expect(body().loadKg).toBe(0);
  });

  it.each([['none', undefined], ['not a number', 'abc'], ['negative', '-5'], ['over the API limit', '5000'], ['empty', '']])('falls back to the workout defaults when the load is %s', async (_n, loadKg) => {
    mockParams = loadKg === undefined ? { exerciseId: 'bicep_curl' } : { exerciseId: 'bicep_curl', loadKg };
    await renderCamera();
    await fireEvent.press(logSetButton());
    expect(body().loadKg).toBe(12);
  });

  it('logs 0 for a bodyweight move even if a load was passed', async () => {
    mockSession = makeSession({ exercises: [curl({ loadable: false, targetLoadKg: null })] });
    mockParams = { exerciseId: 'bicep_curl', loadKg: '20' };
    await renderCamera();
    await fireEvent.press(logSetButton());
    expect(body().loadKg).toBe(0);
  });

  it("tells the user honestly when the server didn't trust the camera time, and doesn't call it verified", async () => {
    mockLogMutate.mockImplementation((_b: unknown, o: Opts) =>
      o.onSuccess?.({ set: { verifiedReps: 0, formScore: null, verificationStatus: 'trace_exceeds_time' }, session: mockSession }),
    );
    await renderCamera();
    await fireEvent.press(logSetButton());
    expect(screen.getByText("Set saved — Not verified — camera time didn't match the workout. Your reps are kept as unverified.")).toBeTruthy();
    expect(screen.queryByText(/0 verified reps\./)).toBeNull();
  });

  it('still reports verified reps for a normal save', async () => {
    mockLogMutate.mockImplementation((_b: unknown, o: Opts) => o.onSuccess?.({ set: { verifiedReps: 0, formScore: null, verificationStatus: 'verified' }, session: mockSession }));
    await renderCamera();
    await fireEvent.press(logSetButton());
    expect(screen.getByText('Set saved — 0 verified reps.')).toBeTruthy();
  });

  it('shows why pausing the workout failed instead of doing nothing', async () => {
    await renderCamera();
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(mockActionMutate).toHaveBeenCalledWith('pause', expect.objectContaining({ onError: expect.any(Function) }));
    await act(async () => (mockActionMutate.mock.calls[0]![1] as Opts).onError?.({ kind: 'network', message: 'offline' }));
    expect(screen.getByText("Couldn't pause the workout — check your connection and try again.")).toBeTruthy();
  });

  it('shows why resuming the workout failed', async () => {
    mockSession = makeSession({ status: 'paused', pausedAt: '2026-09-28T10:10:00Z' });
    await renderCamera();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Resume' })[0]!);
    expect(mockActionMutate).toHaveBeenCalledWith('resume', expect.objectContaining({ onError: expect.any(Function) }));
    await act(async () => (mockActionMutate.mock.calls[0]![1] as Opts).onError?.({ kind: 'server', message: 'Session already ended' }));
    expect(screen.getByText('Session already ended')).toBeTruthy();
  });
});

describe('camera screen in practice mode (?practice=1)', () => {
  it('never offers to log, even when an open workout contains the exercise', async () => {
    mockParams = { exerciseId: 'bicep_curl', practice: '1', loadKg: '20' };
    await renderCamera();
    expect(screen.getByText('Practice — nothing is logged')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Log set/ })).toBeNull();
    expect(screen.queryByText(/Set 1 of 3/)).toBeNull();
    expect(mockLogMutate).not.toHaveBeenCalled();
  });

  it("pausing only pauses the camera: the workout's clock is not touched", async () => {
    mockParams = { exerciseId: 'bicep_curl', practice: '1' };
    await renderCamera();
    await fireEvent.press(screen.getByRole('button', { name: 'Pause' }));
    expect(mockActionMutate).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Resume' }).length).toBeGreaterThan(0);
  });

  it('is practice only for practice=1', async () => {
    mockParams = { exerciseId: 'bicep_curl', practice: '0' };
    await renderCamera();
    expect(screen.getByRole('button', { name: /^Log set/ })).toBeTruthy();
  });

  it('is practice without any workout open, as before', async () => {
    mockSession = null;
    await renderCamera();
    expect(screen.getByText('Practice — nothing is logged')).toBeTruthy();
  });
});

describe('camera screen get-ready countdown', () => {
  it('with reduce motion on there are no numbers: a brief "Ready", once, then the normal screen', async () => {
    jest.useFakeTimers();
    try {
      await renderCamera();
      expect(screen.getByTestId('get-ready')).toBeTruthy();
      expect(screen.getByText('Ready')).toBeTruthy();
      expect(screen.queryByText('Get into position')).toBeNull();
      await act(async () => jest.advanceTimersByTime(READY_HOLD_MS + 100));
      expect(screen.queryByTestId('get-ready')).toBeNull();
      await act(async () => jest.advanceTimersByTime(10_000));
      expect(screen.queryByTestId('get-ready')).toBeNull();
      expect(screen.getByRole('button', { name: /^Log set · 5 verified reps/ })).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('camera screen layout and diagnostics', () => {
  const layout = (w: number, h: number) => fireEvent(screen.getByTestId('camera-slot'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: w, height: h } } });
  const feedBox = () => StyleSheet.flatten(screen.getByTestId('camera-feed-box').props.style) as Record<string, unknown>;

  it('names what the exercise needs in view instead of claiming a full body', async () => {
    await renderCamera();
    expect(screen.getByText('Arm, shoulder and hip in view')).toBeTruthy();
    expect(screen.queryByText(/full body detected/i)).toBeNull();
  });

  it('boxes the WebView and web feeds to the video aspect so nothing is cropped', async () => {
    await renderCamera();
    await layout(360, 520);
    // The default aspect in a portrait window is 3:4, so a 360 x 520 slot holds a 360 x 480 box.
    expect(feedBox()).toMatchObject({ width: 360, height: 480, left: 0, top: 20 });
  });

  it('uses the reported video aspect once the feed knows it', async () => {
    await renderCamera();
    await layout(360, 520);
    await act(async () => (mockFeedProps.onReadout as (r: unknown) => void)({ framing: { issue: null, message: 'ok', trackable: true, side: 'left', missing: [] }, trackable: true, angleDeg: null, people: 1, fps: 28, latencyMs: 19, rep: { verifiedReps: 5 }, traceFull: false, frameAspect: 4 / 3 }));
    expect(feedBox()).toMatchObject({ width: 360, height: 270 });
  });

  it('lets the native camera fill the whole video area', async () => {
    mockNative = true;
    await renderCamera();
    await layout(360, 520);
    expect(feedBox().width).toBeUndefined();
    expect(feedBox()).toMatchObject({ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 });
  });

  it('shows no diagnostics and gives the feed nothing extra in a main build', async () => {
    await renderCamera();
    expect(screen.queryByTestId('pose-diagnostics')).toBeNull();
    expect(mockFeedProps.onDiag).toBeUndefined();
    expect(mockFeedProps.leadMs).toBeUndefined();
  });

  it('in a preview build collects the feed numbers in the background and shows nothing', async () => {
    mockDiagnostics = true;
    await renderCamera();
    expect(screen.queryByTestId('pose-diagnostics')).toBeNull();
    expect(screen.queryByText(/engine native|fps |latency|Overlay lead/)).toBeNull();
    expect(typeof mockFeedProps.onDiag).toBe('function');
    expect(mockFeedProps.leadMs).toBe(60);
  });

  it('keeps every control reachable: pause, end, the log button and the counters', async () => {
    await renderCamera();
    expect(screen.getByRole('button', { name: 'End camera' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Log set · 5 verified reps/ })).toBeTruthy();
    expect(screen.getByLabelText('5 verified reps')).toBeTruthy();
    expect(screen.getByLabelText(/^Range of motion/)).toBeTruthy();
  });
});
