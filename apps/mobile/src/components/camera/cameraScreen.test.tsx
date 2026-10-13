import { act, fireEvent, render, screen } from '@testing-library/react-native';
import CameraScreen from '@/app/camera';
import type { SessionExercise, WorkoutSession } from '@/lib/types';

// The camera route: the set it logs uses the load from the workout screen (A2-04), practice mode never
// logs (A2-22), and a failed pause or resume is shown (A2-11). The feed is the only thing stubbed.

type Opts = { onSuccess?: (r: unknown) => void; onError?: (e: { kind: string; message: string }) => void };

let mockParams: Record<string, string> = {};
let mockSession: WorkoutSession | null = null;
const mockLogMutate = jest.fn();
const mockActionMutate = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), back: jest.fn(), canGoBack: () => false },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(() => Promise.resolve()), deactivateKeepAwake: jest.fn(() => Promise.resolve()) }));
// The feed stands in for the camera and pose model: once started it reports a live camera, a ready model and 5 verified reps.
jest.mock('@/components/camera/PoseCameraFeed', () => {
  const { useEffect } = jest.requireActual('react');
  return {
    PoseCameraFeed: ({ onCamera, onPose, onReadout }: { onCamera: (s: unknown) => void; onPose: (s: unknown) => void; onReadout: (r: unknown) => void }) => {
      useEffect(() => {
        onCamera({ kind: 'live' });
        onPose({ kind: 'ready', backend: 'CPU' });
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
