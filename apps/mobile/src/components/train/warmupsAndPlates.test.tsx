import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { resetBarWeightMemory } from '@/lib/barWeight';
import type { SessionExercise, SessionSet, WorkoutSession } from '@/lib/types';
import { ActiveWorkoutView } from './ActiveWorkoutView';
import { PlateCalculatorSheet } from './PlateCalculatorSheet';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  }),
}));

const NOW = new Date('2026-09-28T10:20:00Z');

const exercise = (over: Partial<SessionExercise> = {}): SessionExercise => ({
  exerciseId: 'barbell_curl',
  name: 'Barbell Curl',
  planned: true,
  sets: 3,
  targetReps: { min: 5, max: 5 },
  targetLoadKg: 100,
  restSeconds: 90,
  note: null,
  cameraVerifiable: false,
  loadable: true,
  previous: null,
  loggedSets: [],
  ...over,
});

const baseSession = (exercises: SessionExercise[]): WorkoutSession => ({
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
  exercises,
});

const calls: { index: number; draft: { reps: number; loadKg: number; warmup?: boolean } }[] = [];

/** Holds the session like the real screen: logging a set appends it to the exercise. */
function Harness({ exercises, fail = false }: { exercises: SessionExercise[]; fail?: boolean }) {
  const [session, setSession] = useState(baseSession(exercises));
  const [draft, setDraft] = useState({ reps: 5, loadKg: 100 });
  const [logError, setLogError] = useState<string | null>(null);
  return (
    <ActiveWorkoutView
      session={session}
      index={0}
      onSelectExercise={jest.fn()}
      draft={draft}
      onChangeDraft={setDraft}
      loadStepKg={2.5}
      onLogSet={jest.fn()}
      onLogSetAt={(index, d) => {
        calls.push({ index, draft: d });
        if (fail) {
          setLogError('Not saved');
          return;
        }
        setSession((s) => ({
          ...s,
          exercises: s.exercises.map((e, i) =>
            i === index ? { ...e, loggedSets: [...e.loggedSets, { id: `s${e.loggedSets.length}`, reps: d.reps, loadKg: d.loadKg, warmup: !!d.warmup } as unknown as SessionSet] } : e,
          ),
        }));
      }}
      logError={logError}
      onDeleteSet={jest.fn()}
      onPause={jest.fn()}
      onResume={jest.fn()}
      onSkipRest={jest.fn()}
      onAddRest={jest.fn()}
      onEnd={jest.fn()}
      onClose={jest.fn()}
      now={NOW}
      today="2026-09-28"
    />
  );
}

beforeEach(() => {
  calls.length = 0;
  mockStore.clear();
  resetBarWeightMemory();
});

describe('automatic warm-up sets', () => {
  it('adds the suggested warm-ups as warm-up sets, once, lightest first', async () => {
    await render(<Harness exercises={[exercise()]} />);
    const add = screen.getByRole('button', { name: 'Add warm-ups (4)' });
    await fireEvent.press(add);
    await fireEvent.press(add); // a second tap must not add a second batch
    expect(calls.map((c) => [c.draft.loadKg, c.draft.reps, c.draft.warmup])).toEqual([
      [20, 10, true],
      [40, 8, true],
      [60, 5, true],
      [80, 3, true],
    ]);
    // They show as W rows, and the offer is gone once there are logged sets.
    expect(screen.getAllByText('W')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /Add warm-ups/ })).toBeNull();
    expect(screen.queryByText('Adding warm-ups…')).toBeNull();
  });

  it('is not offered for bodyweight moves', async () => {
    await render(<Harness exercises={[exercise({ loadable: false, exerciseId: 'push_up', name: 'Push-Up', targetLoadKg: null })]} />);
    expect(screen.queryByRole('button', { name: /Add warm-ups/ })).toBeNull();
  });

  it('stops and keeps the failed warm-up for retry when logging fails', async () => {
    await render(<Harness exercises={[exercise()]} fail />);
    await fireEvent.press(screen.getByRole('button', { name: 'Add warm-ups (4)' }));
    expect(calls).toHaveLength(1);
    expect(screen.getByText('Not saved')).toBeTruthy();
    // The failed warm-up is the next set on the steppers, so Retry saves that one.
    expect(screen.getByText('Warm-up set')).toBeTruthy();
  });
});

describe('plate calculator', () => {
  const sheet = (loadKg: number, units: 'metric' | 'imperial', bar: number, onChangeBar = jest.fn()) =>
    render(<PlateCalculatorSheet visible onClose={jest.fn()} loadKg={loadKg} units={units} bar={bar} onChangeBar={onChangeBar} />);

  it('says which plates go on each side', async () => {
    await sheet(65, 'metric', 20);
    expect(screen.getByText('Each side: 20 + 2.5')).toBeTruthy();
    expect(screen.getByText('65 kg on the bar')).toBeTruthy();
    expect(screen.getAllByTestId('plate', { includeHiddenElements: true })).toHaveLength(2);
  });

  it('works in pounds and names the remainder when plates cannot make the load', async () => {
    await sheet(61.23, 'imperial', 45); // 135 lb
    expect(screen.getByText('Each side: 45')).toBeTruthy();
    await screen.unmount();
    await sheet(60.5, 'metric', 20);
    expect(screen.getByText('Each side: 20')).toBeTruthy();
    expect(screen.getByText(/0\.5 kg short of 60\.5 kg/)).toBeTruthy();
  });

  it('shows just the bar for a load lighter than the bar', async () => {
    await sheet(15, 'metric', 20);
    expect(screen.getByText('15 kg is lighter than the 20 kg bar. Just the bar.')).toBeTruthy();
  });

  it('changes the bar weight', async () => {
    const onChangeBar = jest.fn();
    await sheet(65, 'metric', 20, onChangeBar);
    await fireEvent.press(screen.getByRole('radio', { name: '15 kg' }));
    expect(onChangeBar).toHaveBeenCalledWith(15);
  });

  it('opens from the Plates button on a barbell lift and remembers the bar', async () => {
    await render(<Harness exercises={[exercise()]} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Plates' }));
    expect(screen.getByText('Each side: 25 + 15')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: '15 kg' }));
    await act(async () => {});
    expect(mockStore.get('form.barWeight.kg')).toBe('15');
    // 100 on a 15 kg bar: 42.5 per side = 25 + 15 + 2.5
    expect(screen.getByText('Each side: 25 + 15 + 2.5')).toBeTruthy();
  });

  it('is not offered on a dumbbell lift', async () => {
    await render(<Harness exercises={[exercise({ exerciseId: 'bicep_curl', name: 'Bicep Curl' })]} />);
    expect(screen.queryByRole('button', { name: 'Plates' })).toBeNull();
  });
});
