import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SessionExercise, WorkoutSession } from '@/lib/types';
import WorkoutScreen from '@/app/workout';

const NETWORK_MESSAGE = 'Not saved — no connection. Your set is kept; tap Retry.';

function ex(over: Partial<SessionExercise> = {}): SessionExercise {
  return {
    exerciseId: 'bicep_curl',
    name: 'Bicep Curl',
    planned: true,
    sets: 3,
    targetReps: { min: 8, max: 12 },
    targetLoadKg: 12,
    restSeconds: 90,
    note: null,
    cameraVerifiable: false,
    loadable: true,
    previous: null,
    loggedSets: [],
    ...over,
  };
}

function makeSession(): WorkoutSession {
  return {
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
    exercises: [ex(), ex({ exerciseId: 'push_up', name: 'Push-Up', loadable: false, targetLoadKg: null, targetReps: { min: 6, max: 15 }, restSeconds: 60 })],
  };
}

type Opts = { onSuccess?: (r: { session: WorkoutSession }) => void; onError?: (e: { kind: string; message: string }) => void };

let mockSession: WorkoutSession = makeSession();
const mockLogMutate = jest.fn();
const mockDeleteMutate = jest.fn();
const mockActionMutate = jest.fn();
const mockRestMutate = jest.fn();
const mockCompleteMutate = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a), push: jest.fn(), back: jest.fn(), canGoBack: () => false },
}));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(() => Promise.resolve()), deactivateKeepAwake: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/queries', () => ({
  useActiveSession: () => ({ isPending: false, isError: false, data: mockSession, error: null, refetch: jest.fn() }),
  useExercises: () => ({ data: { exercises: [] } }),
  useLogSet: () => ({ mutate: mockLogMutate, isPending: false }),
  useDeleteSet: () => ({ mutate: mockDeleteMutate }),
  useSessionAction: () => ({ mutate: mockActionMutate }),
  useStartRest: () => ({ mutate: mockRestMutate }),
  useCompleteSession: () => ({ mutate: mockCompleteMutate, isPending: false }),
  useCoachInsight: () => ({ data: undefined }),
  useCelebrations: () => ({ data: { celebrations: [] } }),
  useMarkCelebrationsSeen: () => ({ mutate: jest.fn() }),
}));

/** The body of the n-th log request. */
const logBody = (n: number) => mockLogMutate.mock.calls[n]![0] as Record<string, unknown>;
const succeed = () => mockLogMutate.mockImplementation((_body: unknown, opts: Opts) => opts.onSuccess?.({ session: mockSession }));
const failOffline = () => mockLogMutate.mockImplementation((_body: unknown, opts: Opts) => opts.onError?.({ kind: 'network', message: 'offline' }));

beforeEach(() => {
  mockSession = makeSession();
  jest.clearAllMocks();
  mockLogMutate.mockReset();
});

describe('WorkoutScreen logging', () => {
  it('logs the values typed into the focused row when its check is pressed', async () => {
    succeed();
    await render(<WorkoutScreen />);
    await fireEvent.changeText(screen.getByLabelText('Set 1 weight in kilograms'), '22,5');
    await fireEvent.changeText(screen.getAllByLabelText('Set 1 reps')[0]!, '9');
    await fireEvent.press(screen.getByRole('button', { name: 'Complete set 1' }));
    expect(mockLogMutate).toHaveBeenCalledTimes(1);
    expect(logBody(0)).toEqual({
      clientSetId: expect.any(String),
      exerciseId: 'bicep_curl',
      reps: 9,
      loadKg: 22.5,
      targetReps: 12,
      targetLoadKg: 12,
      restSeconds: 90,
    });
    // Same exercise stays focused after a focused log that doesn't finish it.
    expect(screen.getByRole('header', { name: 'Bicep Curl' })).toBeTruthy();
  });

  it('logs the current draft from the Log set button', async () => {
    succeed();
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1' }));
    expect(logBody(0)).toMatchObject({ exerciseId: 'bicep_curl', reps: 12, loadKg: 12, restSeconds: 90 });
    await fireEvent.press(screen.getByRole('button', { name: 'Increase Reps' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1' }));
    expect(logBody(1)).toMatchObject({ exerciseId: 'bicep_curl', reps: 13, loadKg: 12 });
  });

  it("logs another exercise from its row with that exercise's own data, then focuses it", async () => {
    succeed();
    await render(<WorkoutScreen />);
    expect(screen.getByRole('header', { name: 'Bicep Curl' })).toBeTruthy();
    await fireEvent.changeText(screen.getAllByLabelText('Set 1 reps')[1]!, '14');
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    expect(mockLogMutate).toHaveBeenCalledTimes(1);
    expect(logBody(0)).toEqual({
      clientSetId: expect.any(String),
      exerciseId: 'push_up',
      reps: 14,
      loadKg: 0,
      targetReps: 15,
      targetLoadKg: undefined,
      restSeconds: 60,
    });
    expect(screen.getByRole('header', { name: 'Push-Up' })).toBeTruthy();
    expect(screen.queryByRole('header', { name: 'Bicep Curl' })).toBeNull();
  });

  it("keeps each exercise's client id across failed saves and clears it on success", async () => {
    failOffline();
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    expect(logBody(1).clientSetId).toBe(logBody(0).clientSetId);
    // A different exercise gets its own id (and doesn't disturb Push-Up's pending one).
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1' }));
    expect(logBody(2).exerciseId).toBe('bicep_curl');
    expect(logBody(2).clientSetId).not.toBe(logBody(0).clientSetId);
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    expect(logBody(3).clientSetId).toBe(logBody(0).clientSetId);
    // Once a save lands the id is spent.
    succeed();
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    expect(logBody(4).clientSetId).toBe(logBody(0).clientSetId);
    // That success moved focus to Push-Up; its next attempt (same set number in this static fixture) is a fresh set.
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1' }));
    expect(logBody(5).exerciseId).toBe('push_up');
    expect(logBody(5).clientSetId).not.toBe(logBody(0).clientSetId);
  });

  it('shows the failed save under the exercise it belongs to', async () => {
    failOffline();
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    expect(screen.getAllByText(NETWORK_MESSAGE)).toHaveLength(1);
    // The focused exercise (Bicep Curl) is untouched: no retry button there, and focus didn't move.
    expect(screen.queryByRole('button', { name: 'Retry — save this set' })).toBeNull();
    expect(screen.getByRole('header', { name: 'Bicep Curl' })).toBeTruthy();
    // A failed save on the focused exercise puts the error and Retry there instead.
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1' }));
    expect(screen.getAllByText(NETWORK_MESSAGE)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Retry — save this set' })).toBeTruthy();
  });
});

describe('WorkoutScreen session actions', () => {
  it('pauses the session', async () => {
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pause workout' }));
    expect(mockActionMutate).toHaveBeenCalledWith('pause');
  });

  it('discards the workout from the finish screen', async () => {
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'End workout' }));
    expect(screen.getByText('Finish workout?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Discard workout' }));
    expect(mockActionMutate).toHaveBeenCalledWith('discard', expect.objectContaining({ onSuccess: expect.any(Function) }));
    mockActionMutate.mock.calls[0]![1].onSuccess();
    expect(mockReplace).toHaveBeenCalledWith('/train');
  });

  it('ends the workout with the chosen pain level', async () => {
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'End workout' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Finish & save' }));
    expect(mockCompleteMutate).toHaveBeenCalledWith('none', expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }));
  });
});
