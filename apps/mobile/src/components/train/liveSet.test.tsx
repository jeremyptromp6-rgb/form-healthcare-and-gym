import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { liveSecondsToSend, liveSetSeconds, startLiveSet } from '@/lib/liveSet';
import type { SessionExercise, WorkoutSession, WorkoutSummaryDetail } from '@/lib/types';
import { ActiveWorkoutView, type ActiveWorkoutViewProps, type Draft } from './ActiveWorkoutView';
import { WorkoutSummaryView } from './WorkoutSummaryView';

const T0 = new Date('2026-09-28T10:20:00Z').getTime();
let mockNow = T0;
let dateNow: jest.SpyInstance;
beforeEach(() => {
  mockNow = T0;
  dateNow = jest.spyOn(Date, 'now').mockImplementation(() => mockNow);
});
afterEach(() => dateNow.mockRestore());

const exercise = (over: Partial<SessionExercise> = {}): SessionExercise => ({
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
});

const session = (over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 'sess-1',
  clientSessionId: 'c-1',
  status: 'active',
  localDate: '2026-09-28',
  startedAt: '2026-09-28T10:00:00Z',
  pausedAt: null,
  pausedMs: 0,
  activeMinutes: 20,
  lastActivityAt: '2026-09-28T10:19:00Z',
  idleSince: null,
  leftOpen: false,
  rest: null,
  workoutId: null,
  completedAt: null,
  exercises: [exercise(), exercise({ exerciseId: 'push_up', name: 'Push-Up', loadable: false, targetLoadKg: null })],
  ...over,
});

const logs: Draft[] = [];
const props = (s: WorkoutSession, draft: Draft, over: Partial<ActiveWorkoutViewProps> = {}): ActiveWorkoutViewProps => ({
  session: s,
  index: 0,
  onSelectExercise: jest.fn(),
  draft,
  onChangeDraft: jest.fn(),
  loadStepKg: 1,
  onLogSet: jest.fn((d?: Draft) => {
    if (d) logs.push(d);
  }),
  onLogSetAt: jest.fn(),
  onDeleteSet: jest.fn(),
  onPause: jest.fn(),
  onResume: jest.fn(),
  onSkipRest: jest.fn(),
  onAddRest: jest.fn(),
  onEnd: jest.fn(),
  onClose: jest.fn(),
  now: new Date(T0),
  today: '2026-09-28',
  ...over,
});

const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));
const tap = async (n: number) => {
  for (let i = 0; i < n; i++) await press('+1 rep');
};

beforeEach(() => {
  logs.length = 0;
});

describe('live set mode', () => {
  it('counts a set: Start set, +1 rep taps, Done saves the tapped reps with the seconds the set ran', async () => {
    const p = props(session(), { reps: 10, loadKg: 12 });
    await render(<ActiveWorkoutView {...p} />);
    await press('Start set 1');
    expect(screen.getByText('0:00')).toBeTruthy();
    await tap(5);
    expect(screen.getByText('5')).toBeTruthy();
    await press('−1 rep');
    expect(screen.getByText('4')).toBeTruthy();
    await tap(1);
    mockNow = T0 + 42_000;
    await press('Done');
    expect(p.onLogSet).toHaveBeenCalledTimes(1);
    expect(logs[0]).toEqual({ reps: 5, loadKg: 12, mode: 'live', liveSeconds: 42 });
    // The draft keeps the live numbers so a failed save is retried as the same live set.
    expect(p.onChangeDraft).toHaveBeenLastCalledWith({ reps: 5, loadKg: 12, mode: 'live', liveSeconds: 42 });
    // The panel closes; the next set is offered again.
    expect(screen.queryByRole('button', { name: '+1 rep' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start set 1' })).toBeTruthy();
  });

  it('cannot finish an empty set, and Cancel throws the set away without saving', async () => {
    const p = props(session(), { reps: 10, loadKg: 12 });
    await render(<ActiveWorkoutView {...p} />);
    await press('Start set 1');
    expect(screen.getByRole('button', { name: 'Done' }).props.accessibilityState.disabled).toBe(true);
    await tap(2);
    await press('Cancel set');
    expect(p.onLogSet).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Start set 1' })).toBeTruthy();
  });

  it('keeps the manual path: Log without timer logs the typed draft, with no live fields', async () => {
    const p = props(session(), { reps: 10, loadKg: 12 });
    await render(<ActiveWorkoutView {...p} />);
    await press('Log without timer');
    expect(p.onLogSet).toHaveBeenCalledWith();
  });

  it('typing new reps drops a leftover live timer from the draft', async () => {
    const p = props(session(), { reps: 6, loadKg: 12, mode: 'live', liveSeconds: 30 });
    await render(<ActiveWorkoutView {...p} />);
    await press('Increase Reps');
    expect(p.onChangeDraft).toHaveBeenLastCalledWith({ reps: 7, loadKg: 12 });
  });

  it('times from timestamps: the app can sit in the background and the clock is still right', async () => {
    const p = props(session(), { reps: 10, loadKg: 12 });
    const view = await render(<ActiveWorkoutView {...p} />);
    await press('Start set 1');
    // No timer tick for five minutes (backgrounded), then the next paint.
    mockNow = T0 + 5 * 60_000 + 3_000;
    await view.rerender(<ActiveWorkoutView {...p} now={new Date(mockNow)} />);
    expect(screen.getByText('5:03')).toBeTruthy();
    await tap(8);
    await press('Done');
    expect(logs[0]).toMatchObject({ reps: 8, mode: 'live', liveSeconds: 303 });
  });

  it('pausing the workout stops the set timer, and resuming carries on without the pause', async () => {
    const p = props(session(), { reps: 10, loadKg: 12 });
    const view = await render(<ActiveWorkoutView {...p} />);
    await press('Start set 1');
    // Paused at +10 s; a minute later the clock still reads 0:10.
    const pausedAt = new Date(T0 + 10_000).toISOString();
    mockNow = T0 + 70_000;
    await view.rerender(<ActiveWorkoutView {...p} session={session({ status: 'paused', pausedAt })} now={new Date(mockNow)} />);
    expect(screen.getByText('0:10', { includeHiddenElements: true })).toBeTruthy();
    // Resumed at +70 s with 60 s of pause on the session, then 5 more seconds of lifting.
    mockNow = T0 + 75_000;
    await view.rerender(<ActiveWorkoutView {...p} session={session({ pausedMs: 60_000 })} now={new Date(mockNow)} />);
    expect(screen.getByText('0:15')).toBeTruthy();
    expect(liveSetSeconds(startLiveSet('x', { pausedMs: 0 }, T0), { pausedMs: 60_000, pausedAt: null }, T0 + 75_000)).toBe(15);
  });

  it('does not offer to start a set while the workout is paused', async () => {
    const p = props(session({ status: 'paused', pausedAt: '2026-09-28T10:19:00Z' }), { reps: 10, loadKg: 12 });
    await render(<ActiveWorkoutView {...p} />);
    expect(screen.getByRole('button', { name: 'Start set 1', includeHiddenElements: true }).props.accessibilityState.disabled).toBe(true);
  });

  it('works for a warm-up set and numbers the next working set after the logged ones', async () => {
    const warm = props(session(), { reps: 8, loadKg: 20, warmup: true });
    const view = await render(<ActiveWorkoutView {...warm} />);
    await press('Start warm-up set');
    await tap(3);
    mockNow = T0 + 9_000;
    await press('Done');
    expect(logs[0]).toEqual({ reps: 3, loadKg: 20, warmup: true, mode: 'live', liveSeconds: 9 });
    await view.unmount();
    const done = session({ exercises: [exercise({ loggedSets: [{ id: 's1', reps: 10, loadKg: 12 } as never] }), exercise({ exerciseId: 'push_up', name: 'Push-Up' })] });
    await render(<ActiveWorkoutView {...props(done, { reps: 10, loadKg: 12 })} />);
    expect(screen.getByRole('button', { name: 'Start set 2' })).toBeTruthy();
  });

  it('a live set on one exercise blocks starting another until it is finished', async () => {
    const p = props(session(), { reps: 10, loadKg: 12 });
    const view = await render(<ActiveWorkoutView {...p} />);
    await press('Start set 1');
    await view.rerender(<ActiveWorkoutView {...p} index={1} draft={{ reps: 10, loadKg: 0 }} />);
    expect(screen.getByText('Finish the live set on Bicep Curl first.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start set 1' }).props.accessibilityState.disabled).toBe(true);
  });

  it('keeps the weight adjustable during a live set', async () => {
    const Harness = () => {
      const [draft, setDraft] = useState<Draft>({ reps: 10, loadKg: 12 });
      return <ActiveWorkoutView {...props(session(), draft, { onChangeDraft: setDraft })} />;
    };
    await render(<Harness />);
    await press('Start set 1');
    await press('Increase Weight');
    await tap(2);
    await press('Done');
    expect(logs[0]).toMatchObject({ reps: 2, loadKg: 13, mode: 'live' });
  });
});

describe('live set helpers', () => {
  it('sends whole seconds within the server range', () => {
    expect(liveSecondsToSend(0)).toBe(1);
    expect(liveSecondsToSend(41.6)).toBe(42);
    expect(liveSecondsToSend(99999)).toBe(3600);
  });
});

describe('summary: how each set was recorded', () => {
  const summary: WorkoutSummaryDetail = {
    workout: { id: 'w1', localDate: '2026-09-28', durationMinutes: 42, painLevel: 'none', xp: 40, flags: [] },
    totals: { sets: 3, reps: 25, verifiedReps: 5, volumeKg: 120, perfectReps: 4, averageFormScore: 92 },
    sets: [
      { exerciseId: 'bicep_curl', name: 'Bicep Curl', setIndex: 0, targetReps: 12, reps: 10, verifiedReps: 0, loadKg: 12, romPercent: null, formScore: null, quality: null, mode: 'live', liveSeconds: 40 },
      { exerciseId: 'bicep_curl', name: 'Bicep Curl', setIndex: 1, targetReps: 12, reps: 10, verifiedReps: 0, loadKg: 12, romPercent: null, formScore: null, quality: null, mode: 'manual' },
      { exerciseId: 'bodyweight_squat', name: 'Bodyweight Squat', setIndex: 0, targetReps: null, reps: 5, verifiedReps: 5, loadKg: 0, romPercent: 100, formScore: 92, quality: null, mode: 'camera' },
    ],
    prs: [],
  };

  it('badges every working set and says manual sets earn less, right after the workout', async () => {
    await render(<WorkoutSummaryView summary={summary} onDone={jest.fn()} />);
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.getByText('Camera')).toBeTruthy();
    expect(screen.getByText('Manual sets earn less XP. Live and camera sets earn full XP.')).toBeTruthy();
  });

  it('shows no note when nothing was manual', async () => {
    const noManual = { ...summary, sets: summary.sets.filter((s) => s.mode !== 'manual') };
    await render(<WorkoutSummaryView summary={noManual} onDone={jest.fn()} />);
    expect(screen.queryByText(/Manual sets earn less XP/)).toBeNull();
  });

  it('shows the badges but not the note in history', async () => {
    await render(<WorkoutSummaryView summary={summary} title="Workout" />);
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.queryByText(/Manual sets earn less XP/)).toBeNull();
  });

  it('leaves the badge off older records without a mode', async () => {
    const old = { ...summary, sets: summary.sets.map(({ mode: _m, liveSeconds: _l, ...s }) => s) };
    await render(<WorkoutSummaryView summary={old} onDone={jest.fn()} />);
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.queryByText(/Manual sets earn less XP/)).toBeNull();
  });
});
