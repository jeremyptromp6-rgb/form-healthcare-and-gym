import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { SessionExercise, WorkoutSession } from '@/lib/types';
import WorkoutScreen from '@/app/workout';

/** A pending row's check: "Complete set N, <reps> reps at <load>". */
const checkOf = (n: number) => new RegExp(`^Complete set ${n}, `);

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
const mockUpdateMutate = jest.fn();
const mockPush = jest.fn();
const mockActionMutate = jest.fn();
const mockRestMutate = jest.fn();
const mockNotesMutate = jest.fn();
const mockCompleteMutate = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a), push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), canGoBack: () => false },
}));
// Logging and session actions don't involve ads; the post-workout ad has its own tests (postWorkoutAd.test.tsx).
jest.mock('@/lib/ads/usePostWorkoutAd', () => ({ usePostWorkoutAd: () => ({ phase: 'IDLE', adReady: false, finish: (next: () => void) => next() }) }));
jest.mock('expo-keep-awake',() => ({ activateKeepAwakeAsync: jest.fn(() => Promise.resolve()), deactivateKeepAwake: jest.fn(() => Promise.resolve()) }));
jest.mock('@/lib/queries', () => ({
  useActiveSession: () => ({ isPending: false, isError: false, data: mockSession, error: null, refetch: jest.fn() }),
  useExercises: () => ({ data: { exercises: [] } }),
  useLogSet: () => ({ mutate: mockLogMutate, isPending: false }),
  useDeleteSet: () => ({ mutate: mockDeleteMutate }),
  useUpdateSet: () => ({ mutate: mockUpdateMutate, isPending: false }),
  useSessionAction: () => ({ mutate: mockActionMutate, isPending: false }),
  useStartRest: () => ({ mutate: mockRestMutate }),
  useSessionNotes: () => ({ mutate: mockNotesMutate, isPending: false }),
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
  mockUpdateMutate.mockReset();
});

describe('WorkoutScreen logging', () => {
  it('logs the values typed into the focused row when its check is pressed', async () => {
    succeed();
    await render(<WorkoutScreen />);
    await fireEvent.changeText(screen.getByLabelText('Set 1 weight in kilograms'), '22,5');
    await fireEvent.changeText(screen.getAllByLabelText('Set 1 reps')[0]!, '9');
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    expect(mockLogMutate).toHaveBeenCalledTimes(1);
    expect(logBody(0)).toEqual({
      clientSetId: expect.any(String),
      exerciseId: 'bicep_curl',
      reps: 9,
      loadKg: 22.5,
      mode: 'live',
      liveSeconds: expect.any(Number),
      targetReps: 12,
      targetLoadKg: 12,
      restSeconds: 90,
    });
    // Same exercise stays focused after a focused log that doesn't finish it.
    expect(screen.getByRole('header', { name: 'Bicep Curl' })).toBeTruthy();
  });

  it('logs the prefilled values when a set is ticked, and the stepped draft for the next one', async () => {
    succeed();
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Complete set 1, 12 reps at 12 kg' }));
    expect(logBody(0)).toMatchObject({ exerciseId: 'bicep_curl', reps: 12, loadKg: 12, restSeconds: 90 });
    await fireEvent.press(screen.getByRole('button', { name: 'Increase Reps' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Complete set 1, 13 reps at 12 kg' }));
    expect(logBody(1)).toMatchObject({ exerciseId: 'bicep_curl', reps: 13, loadKg: 12 });
  });

  it('logs a later pending set as the next set with its own numbers', async () => {
    succeed();
    await render(<WorkoutScreen />);
    await fireEvent.changeText(screen.getByLabelText('Set 3 reps'), '8');
    await fireEvent.press(screen.getByRole('button', { name: checkOf(3) }));
    expect(logBody(0)).toMatchObject({ exerciseId: 'bicep_curl', reps: 8, loadKg: 12, mode: 'live' });
    expect(logBody(0)).not.toHaveProperty('warmup');
  });

  it('logs a set marked as a warm-up with warmup: true, and a normal set without the field', async () => {
    succeed();
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('switch', { name: 'Warm-up for set 1' }));
    expect(screen.getByRole('button', { name: 'Complete warm-up set' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Complete warm-up set' }));
    expect(logBody(0)).toMatchObject({ exerciseId: 'bicep_curl', reps: 12, loadKg: 12, warmup: true });
    // The fixture session doesn't advance, so the draft is still a warm-up: switch it off. A working set carries no warmup field.
    await fireEvent.press(screen.getByRole('switch', { name: 'Warm-up for set 1' }));
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    expect(logBody(1)).not.toHaveProperty('warmup');
  });

  it('saves the workout notes when the field loses focus, and reports a failure under it', async () => {
    mockNotesMutate.mockImplementation((_n: unknown, opts: { onSuccess?: () => void }) => opts.onSuccess?.());
    await render(<WorkoutScreen />);
    const field = screen.getByLabelText('Workout notes');
    await fireEvent.changeText(field, '  Felt strong  ');
    await fireEvent(field, 'blur');
    expect(mockNotesMutate).toHaveBeenCalledWith('Felt strong', expect.any(Object));
    // Unchanged text is not saved again.
    await fireEvent(field, 'blur');
    expect(mockNotesMutate).toHaveBeenCalledTimes(1);
    mockNotesMutate.mockImplementation((_n: unknown, opts: { onError?: (e: { kind: string; message: string }) => void }) => opts.onError?.({ kind: 'network', message: 'offline' }));
    await fireEvent.changeText(field, '');
    await fireEvent(field, 'blur');
    expect(mockNotesMutate).toHaveBeenLastCalledWith(null, expect.any(Object));
    expect(screen.getByText("Couldn't save the notes — check your connection and try again.")).toBeTruthy();
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
      mode: 'live',
      liveSeconds: expect.any(Number),
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
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    expect(logBody(2).exerciseId).toBe('bicep_curl');
    expect(logBody(2).clientSetId).not.toBe(logBody(0).clientSetId);
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    expect(logBody(3).clientSetId).toBe(logBody(0).clientSetId);
    // Once a save lands the id is spent.
    succeed();
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    expect(logBody(4).clientSetId).toBe(logBody(0).clientSetId);
    // That success moved focus to Push-Up; its next attempt (same set number in this static fixture) is a fresh set.
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
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
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    expect(screen.getAllByText(NETWORK_MESSAGE)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Retry — save this set' })).toBeTruthy();
  });
});

describe('WorkoutScreen session actions', () => {
  it('pauses the session', async () => {
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pause workout' }));
    expect(mockActionMutate).toHaveBeenCalledWith('pause', expect.objectContaining({ onError: expect.any(Function) }));
  });

  it('discards the workout from the finish screen', async () => {
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'End workout' }));
    expect(screen.getByText('Finish workout?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Discard workout' }));
    // The first tap only asks: nothing is deleted yet.
    expect(mockActionMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Everything you logged is deleted/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, discard it' }));
    expect(mockActionMutate).toHaveBeenCalledWith('discard', expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }));
    mockActionMutate.mock.calls[0]![1].onSuccess();
    expect(mockReplace).toHaveBeenCalledWith('/train');
  });

  it('lets the user back out of a discard without deleting anything', async () => {
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'End workout' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Discard workout' }));
    await fireEvent.press(screen.getByRole('button', { name: 'No, keep it' }));
    expect(mockActionMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Discard workout' })).toBeTruthy();
  });

  it('shows why a discard failed instead of doing nothing', async () => {
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'End workout' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Discard workout' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, discard it' }));
    await act(async () => mockActionMutate.mock.calls[0]![1].onError({ kind: 'network', message: 'offline' }));
    expect(screen.getByText("Couldn't discard — check your connection and try again.")).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('ends the workout with the chosen pain level', async () => {
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'End workout' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Finish & save' }));
    expect(mockCompleteMutate).toHaveBeenCalledWith('none', expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }));
  });
});

/** Fails the n-th call of a mutate mock the way the API client would. */
const failCall = async (mock: jest.Mock, n = 0, error = { kind: 'network', message: 'offline' }) => {
  const opts = mock.mock.calls[n]!.at(-1) as Opts;
  await act(async () => opts.onError?.(error));
};

describe('WorkoutScreen failures are shown, never silent', () => {
  it('says so when pausing fails', async () => {
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pause workout' }));
    await failCall(mockActionMutate);
    expect(screen.getByText("Couldn't pause — check your connection and try again.")).toBeTruthy();
  });

  it('says so when resuming fails, on the pause screen', async () => {
    mockSession = { ...makeSession(), status: 'paused', pausedAt: '2026-09-28T10:10:00Z' };
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Resume' }));
    await failCall(mockActionMutate);
    expect(screen.getAllByText("Couldn't resume — check your connection and try again.").length).toBeGreaterThan(0);
  });

  it('says so when deleting a set fails, with the server message for a server error', async () => {
    mockSession = { ...makeSession(), exercises: [ex({ loggedSets: [loggedSet()] })] };
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete set 1' }));
    expect(mockDeleteMutate).toHaveBeenCalledWith('set-1', expect.objectContaining({ onError: expect.any(Function) }));
    await failCall(mockDeleteMutate, 0, { kind: 'server', message: 'Set not found' });
    expect(screen.getByText('Set not found')).toBeTruthy();
  });

  it('says so when skipping or adding rest fails', async () => {
    mockSession = { ...makeSession(), rest: { seconds: 90, remainingSeconds: 60, endsAt: new Date(Date.now() + 60_000).toISOString() } };
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /skip/i }));
    expect(mockActionMutate).toHaveBeenCalledWith('rest/skip', expect.objectContaining({ onError: expect.any(Function) }));
    await failCall(mockActionMutate);
    expect(screen.getByText("Couldn't skip the rest — check your connection and try again.")).toBeTruthy();
  });

  it('clears the message when the next try starts', async () => {
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Pause workout' }));
    await failCall(mockActionMutate);
    expect(screen.getByText(/Couldn't pause/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pause workout' }));
    expect(screen.queryByText(/Couldn't pause/)).toBeNull();
  });
});

function loggedSet(over: Record<string, unknown> = {}) {
  return {
    id: 'set-1',
    clientSetId: 'cs-1',
    exerciseId: 'bicep_curl',
    setIndex: 0,
    targetReps: 12,
    targetLoadKg: 12,
    reps: 10,
    loadKg: 12,
    verifiedReps: 0,
    verificationStatus: 'not_tracked',
    romPercent: null,
    formScore: null,
    quality: null,
    createdAt: '2026-09-28T10:05:00Z',
    ...over,
  } as WorkoutSession['exercises'][number]['loggedSets'][number];
}

describe('WorkoutScreen editing a logged set', () => {
  it('saves new reps and load for a done row, sending only what changed', async () => {
    mockSession = { ...makeSession(), exercises: [ex({ loggedSets: [loggedSet()] })] };
    mockUpdateMutate.mockImplementation((_v: unknown, opts: Opts) => opts.onSuccess?.({ session: mockSession }));
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /Edit set 1/ }));
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 reps'), '8');
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 weight in kilograms'), '14');
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 1' }));
    expect(mockUpdateMutate).toHaveBeenCalledWith({ setId: 'set-1', reps: 8, loadKg: 14 }, expect.any(Object));
    // The editor closes once the server accepts it.
    expect(screen.queryByLabelText('Edit set 1 reps')).toBeNull();
  });

  it('sends only the load when only the load changed (reps and their verification are untouched)', async () => {
    mockSession = { ...makeSession(), exercises: [ex({ loggedSets: [loggedSet({ verifiedReps: 10, verificationStatus: 'verified' })] })] };
    mockUpdateMutate.mockImplementation((_v: unknown, opts: Opts) => opts.onSuccess?.({ session: mockSession }));
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /Edit set 1/ }));
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 weight in kilograms'), '15');
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 1' }));
    expect(mockUpdateMutate).toHaveBeenCalledWith({ setId: 'set-1', loadKg: 15 }, expect.any(Object));
  });

  it('keeps the editor open with the message when the save fails', async () => {
    mockSession = { ...makeSession(), exercises: [ex({ loggedSets: [loggedSet()] })] };
    mockUpdateMutate.mockImplementation((_v: unknown, opts: Opts) => opts.onError?.({ kind: 'network', message: 'offline' }));
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /Edit set 1/ }));
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 reps'), '9');
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 1' }));
    expect(screen.getByText("Couldn't save the change — check your connection and try again.")).toBeTruthy();
    expect(screen.getByLabelText('Edit set 1 reps')).toBeTruthy();
  });

  it('does not call the API when nothing changed', async () => {
    mockSession = { ...makeSession(), exercises: [ex({ loggedSets: [loggedSet()] })] };
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /Edit set 1/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 1' }));
    expect(mockUpdateMutate).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Edit set 1 reps')).toBeNull();
  });

  it('warns when lowering the reps below the camera-verified count, and not for a load change', async () => {
    mockSession = { ...makeSession(), exercises: [ex({ cameraVerifiable: true, loggedSets: [loggedSet({ verifiedReps: 10, verificationStatus: 'verified' })] })] };
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /Edit set 1/ }));
    expect(screen.queryByText(/Camera-verified reps drop/)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 reps'), '7');
    expect(screen.getByText('Camera-verified reps drop to 7 to match. Changing the weight keeps them.')).toBeTruthy();
  });
});

describe('WorkoutScreen camera hand-off', () => {
  it('passes the current weight draft to the camera route', async () => {
    mockSession = { ...makeSession(), exercises: [ex({ cameraVerifiable: true })] };
    await render(<WorkoutScreen />);
    await fireEvent.changeText(screen.getByLabelText('Set 1 weight in kilograms'), '22,5');
    await fireEvent.press(screen.getByRole('button', { name: 'Use camera coaching' }));
    expect(mockPush).toHaveBeenCalledWith('/camera?exerciseId=bicep_curl&loadKg=22.5');
  });
});

describe('WorkoutScreen in pounds', () => {
  const renderImperial = async () => {
    const client = new QueryClient();
    client.setQueryData(['me'], { settings: { units: 'imperial' } });
    await render(
      <QueryClientProvider client={client}>
        <WorkoutScreen />
      </QueryClientProvider>,
    );
  };

  it('shows pounds, and logs a typed 135 lb as about 61.2 kg', async () => {
    succeed();
    await renderImperial();
    expect(screen.getByLabelText('Set 1 weight in pounds')).toBeTruthy();
    expect(screen.getByText('LB', { includeHiddenElements: true })).toBeTruthy(); // the column caption
    await fireEvent.changeText(screen.getByLabelText('Set 1 weight in pounds'), '135');
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    expect(logBody(0).loadKg).toBeCloseTo(61.2, 1);
    expect(logBody(0).loadKg).toBe(61.23);
  });

  it('starts the draft at the plan target in a round number of pounds (12 kg → 26.5 lb)', async () => {
    await renderImperial();
    expect(screen.getByLabelText('Set 1 weight in pounds').props.value).toBe('26.5');
  });

  it('steps the weight by plate-sized pounds and logs the stepped value in kg', async () => {
    succeed();
    await renderImperial();
    await fireEvent.changeText(screen.getByLabelText('Set 1 weight in pounds'), '135');
    await fireEvent.press(screen.getByRole('button', { name: 'Increase Weight' }));
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    expect(logBody(0).loadKg).toBe(63.5); // 140 lb
  });

  it('hands the camera the draft in kg, whatever the display unit', async () => {
    mockSession = { ...makeSession(), exercises: [ex({ cameraVerifiable: true })] };
    await renderImperial();
    await fireEvent.changeText(screen.getByLabelText('Set 1 weight in pounds'), '135');
    await fireEvent.press(screen.getByRole('button', { name: 'Use camera coaching' }));
    expect(mockPush).toHaveBeenCalledWith('/camera?exerciseId=bicep_curl&loadKg=61.23');
  });
});

describe('WorkoutScreen set timing for fair XP', () => {
  const T0 = new Date('2026-10-01T09:00:00Z').getTime(); // deliberately unrelated to the fixture's server timestamps
  let nowMs = T0;
  let dateNow: jest.SpyInstance;
  beforeEach(() => {
    nowMs = T0;
    dateNow = jest.spyOn(Date, 'now').mockImplementation(() => nowMs);
  });
  afterEach(() => dateNow.mockRestore());

  it('sends mode live with the seconds since the screen opened for the first set, and asks the server to start the rest', async () => {
    succeed();
    await render(<WorkoutScreen />);
    nowMs = T0 + 90_000;
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    expect(mockLogMutate).toHaveBeenCalledTimes(1);
    expect(logBody(0)).toMatchObject({ exerciseId: 'bicep_curl', reps: 12, loadKg: 12, mode: 'live', liveSeconds: 90, restSeconds: 90 });
  });

  it('counts from the previous set that saved, on any exercise, and never from server timestamps', async () => {
    succeed();
    // A logged set stamped by a server clock days away must not matter.
    mockSession = { ...makeSession(), startedAt: '2026-01-01T00:00:00Z' };
    await render(<WorkoutScreen />);
    nowMs = T0 + 30_000;
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    expect(logBody(0)).toMatchObject({ exerciseId: 'bicep_curl', liveSeconds: 30 });
    nowMs = T0 + 70_000;
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    expect(logBody(1)).toMatchObject({ mode: 'live', liveSeconds: 40 });
    nowMs = T0 + 75_000;
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    expect(logBody(2)).toMatchObject({ exerciseId: 'push_up', mode: 'live', liveSeconds: 5 });
  });

  it('does not restart the clock when a save fails', async () => {
    failOffline();
    await render(<WorkoutScreen />);
    nowMs = T0 + 20_000;
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    nowMs = T0 + 50_000;
    await fireEvent.press(screen.getByRole('button', { name: 'Retry — save this set' }));
    expect(logBody(0).liveSeconds).toBe(20);
    expect(logBody(1)).toMatchObject({ liveSeconds: 50, clientSetId: logBody(0).clientSetId });
  });

  it('is never below 1 s (ticking sets off back to back) and never above the 3600 s the server takes', async () => {
    succeed();
    await render(<WorkoutScreen />);
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    expect(logBody(0)).toMatchObject({ mode: 'live', liveSeconds: 1 });
    nowMs = T0 + 5 * 3600_000;
    await fireEvent.press(screen.getByRole('button', { name: checkOf(1) }));
    expect(logBody(1)).toMatchObject({ mode: 'live', liveSeconds: 3600 });
  });
});
