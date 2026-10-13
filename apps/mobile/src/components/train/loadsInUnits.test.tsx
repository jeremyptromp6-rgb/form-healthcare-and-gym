import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { Exercise, ExerciseDetail, PlannedExercise, SessionExercise, WorkoutPlan, WorkoutSession, WorkoutSummaryDetail } from '@/lib/types';
import { ActiveWorkoutView, type ActiveWorkoutViewProps } from './ActiveWorkoutView';
import { ExerciseDetailView } from './ExerciseDetailView';
import { SetRow, SetTableHeader, type SetRowProps } from './SetRow';
import { TodayView, type TodayViewProps } from './TodayView';
import { prValue, WorkoutSummaryView } from './WorkoutSummaryView';

// Lifting loads are stored in kg and shown and typed in the user's units (A2-05); logged sets can be
// edited in place (A2-04); failures are shown (A2-11); the tabs are tappable (A2-19).
// @testing-library/react-native v14: render and events are async.

const hid = { includeHiddenElements: true };
const NOW = new Date('2026-09-28T10:20:00Z');

const ex = (over: Partial<SessionExercise> = {}): SessionExercise => ({
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

const logged = (reps: number, loadKg: number, id: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    clientSetId: `c-${id}`,
    exerciseId: 'bicep_curl',
    setIndex: 0,
    targetReps: 12,
    targetLoadKg: null,
    reps,
    loadKg,
    verifiedReps: 0,
    verificationStatus: 'not_tracked',
    romPercent: null,
    formScore: null,
    quality: null,
    createdAt: '',
    ...over,
  }) as SessionExercise['loggedSets'][number];

const session = (exercises: SessionExercise[] = [ex(), ex({ exerciseId: 'push_up', name: 'Push-Up', loadable: false, targetLoadKg: null })], over: Partial<WorkoutSession> = {}): WorkoutSession => ({
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
  exercises,
  ...over,
});

async function renderView(s: WorkoutSession, over: Partial<ActiveWorkoutViewProps> = {}) {
  const props: ActiveWorkoutViewProps = {
    session: s,
    index: 0,
    onSelectExercise: jest.fn(),
    draft: { reps: 12, loadKg: 12 },
    onChangeDraft: jest.fn(),
    loadStepKg: 2.5,
    onLogSet: jest.fn(),
    onLogSetAt: jest.fn(),
    onDeleteSet: jest.fn(),
    onPause: jest.fn(),
    onResume: jest.fn(),
    onSkipRest: jest.fn(),
    onAddRest: jest.fn(),
    onEnd: jest.fn(),
    onClose: jest.fn(),
    now: NOW,
    today: '2026-09-28',
    ...over,
  };
  await render(<ActiveWorkoutView {...props} />);
  return props;
}

describe('ActiveWorkoutView loads in display units', () => {
  it('shows kilograms for a metric user, as before', async () => {
    await renderView(session(), { units: 'metric' });
    expect(screen.getByLabelText('Set 1 weight in kilograms').props.value).toBe('12');
    expect(screen.getByText('KG', hid)).toBeTruthy();
    expect(screen.getAllByText('kg').length).toBeGreaterThan(0); // the stepper's unit and the volume
    expect(screen.queryByText('lb')).toBeNull();
    expect(screen.getByText('Set 1 of 3 · 8–12 reps @ 12 kg')).toBeTruthy();
  });

  it('shows pounds for an imperial user: caption, field label, stepper, target and the draft', async () => {
    await renderView(session(), { units: 'imperial', draft: { reps: 12, loadKg: 19.96 } });
    expect(screen.getByLabelText('Set 1 weight in pounds').props.value).toBe('44');
    expect(screen.queryByLabelText('Set 1 weight in kilograms')).toBeNull();
    expect(screen.getByText('LB', hid)).toBeTruthy();
    expect(screen.queryByText('KG', hid)).toBeNull();
    expect(screen.getAllByText('lb').length).toBeGreaterThan(0); // the stepper's unit and the volume
    expect(screen.queryByText('kg')).toBeNull();
    expect(screen.getByText('Set 1 of 3 · 8–12 reps @ 26.5 lb')).toBeTruthy();
  });

  it('turns typed pounds into kg for the draft and the logged set: 135 lb is 61.23 kg', async () => {
    const p = await renderView(session(), { units: 'imperial' });
    await fireEvent.changeText(screen.getByLabelText('Set 1 weight in pounds'), '135');
    expect(p.onChangeDraft).toHaveBeenLastCalledWith({ reps: 12, loadKg: 61.23 });
    await fireEvent.press(screen.getByRole('button', { name: 'Complete set 1' }));
    expect(p.onLogSet).toHaveBeenCalledWith({ reps: 12, loadKg: 61.23 });
  });

  it('steps the weight in pounds (5 lb for a 2.5 kg exercise) and reports kg', async () => {
    const p = await renderView(session(), { units: 'imperial', draft: { reps: 12, loadKg: 61.23 } });
    await fireEvent.press(screen.getByRole('button', { name: 'Increase Weight' }));
    expect(p.onChangeDraft).toHaveBeenLastCalledWith({ reps: 12, loadKg: 63.5 }); // 140 lb
    await fireEvent.press(screen.getByRole('button', { name: 'Decrease Weight' }));
    expect(p.onChangeDraft).toHaveBeenLastCalledWith({ reps: 12, loadKg: 58.97 }); // 130 lb
  });

  it('steps a metric user by the exercise increment, in kg', async () => {
    const p = await renderView(session(), { units: 'metric', draft: { reps: 12, loadKg: 60 } });
    await fireEvent.press(screen.getByRole('button', { name: 'Increase Weight' }));
    expect(p.onChangeDraft).toHaveBeenLastCalledWith({ reps: 12, loadKg: 62.5 });
  });

  it('shows logged sets, last time and volume in pounds', async () => {
    const s = session([
      ex({ loggedSets: [logged(10, 61.23, 'a')], previous: { localDate: '2026-09-26', sets: [{ reps: 8, loadKg: 45.36 }] } }),
    ]);
    await renderView(s, { units: 'imperial' });
    expect(screen.getByText('135')).toBeTruthy(); // the logged set
    expect(screen.getByText('8 × 100')).toBeTruthy(); // previous column
    // 10 × 61.23 kg = 612 kg moved = 1,349 lb
    expect(screen.getByText((1349).toLocaleString())).toBeTruthy();
  });

  it('logs another exercise from its row in kg too', async () => {
    const s = session([ex(), ex({ exerciseId: 'row', name: 'Row', targetLoadKg: 20 })]);
    const p = await renderView(s, { units: 'imperial' });
    await fireEvent.changeText(screen.getAllByLabelText('Set 1 weight in pounds')[1]!, '100');
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Row' }));
    expect(p.onLogSetAt).toHaveBeenCalledWith(1, { reps: 12, loadKg: 45.36 });
  });
});

describe('ActiveWorkoutView exercise tabs and errors', () => {
  it('gives every exercise tab a 44pt touch target (36pt chip plus hitSlop)', async () => {
    await renderView(session());
    for (const tab of screen.getAllByRole('tab')) {
      const hit = tab.props.hitSlop as { top: number; bottom: number };
      expect(36 + hit.top + hit.bottom).toBeGreaterThanOrEqual(44);
    }
  });

  it('shows a failed pause, resume, rest or delete at the top', async () => {
    await renderView(session(), { actionError: "Couldn't pause — check your connection and try again." });
    expect(screen.getByText("Couldn't pause — check your connection and try again.")).toBeTruthy();
  });

  it('shows a failed resume on the pause screen, where Resume is', async () => {
    await renderView(session(undefined, { status: 'paused', pausedAt: '2026-09-28T10:10:00Z' }), { actionError: "Couldn't resume — try again." });
    expect(screen.getAllByText("Couldn't resume — try again.").length).toBeGreaterThan(0);
  });

  it('shows nothing when there is no action error', async () => {
    await renderView(session());
    expect(screen.queryByText(/Couldn't/)).toBeNull();
  });
});

describe('ActiveWorkoutView editing a logged set', () => {
  const withSet = (over: Record<string, unknown> = {}, units: 'metric' | 'imperial' = 'metric') => {
    const onEditSet = jest.fn();
    return { onEditSet, units, s: session([ex({ loggedSets: [logged(10, units === 'metric' ? 12 : 61.23, 'set-a', over)] })]) };
  };

  it('opens a done row for editing with its logged values, and saves only what changed', async () => {
    const { s, onEditSet } = withSet();
    await renderView(s, { onEditSet });
    await fireEvent.press(screen.getByRole('button', { name: 'Edit set 1: 10 reps at 12 kg' }));
    expect(screen.getByLabelText('Edit set 1 reps').props.value).toBe('10');
    expect(screen.getByLabelText('Edit set 1 weight in kilograms').props.value).toBe('12');
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 reps'), '8');
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 1' }));
    expect(onEditSet).toHaveBeenCalledWith('set-a', { reps: 8 }, expect.any(Function));
  });

  it('edits the load in pounds and sends kg', async () => {
    const { s, onEditSet } = withSet({}, 'imperial');
    await renderView(s, { onEditSet, units: 'imperial' });
    await fireEvent.press(screen.getByRole('button', { name: 'Edit set 1: 10 reps at 135 lb' }));
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 weight in pounds'), '140');
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 1' }));
    expect(onEditSet).toHaveBeenCalledWith('set-a', { loadKg: 63.5 }, expect.any(Function));
  });

  it('closes the editor when the save lands, and keeps it open with the message when it fails', async () => {
    const { s, onEditSet } = withSet();
    await renderView(s, { onEditSet });
    await fireEvent.press(screen.getByRole('button', { name: /Edit set 1/ }));
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 reps'), '9');
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 1' }));
    await act(async () => onEditSet.mock.calls[0]![2]('Set not found'));
    expect(screen.getByText('Set not found')).toBeTruthy();
    expect(screen.getByLabelText('Edit set 1 reps').props.value).toBe('9'); // what was typed is kept
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 1' }));
    await act(async () => onEditSet.mock.calls[1]![2]());
    expect(screen.queryByLabelText('Edit set 1 reps')).toBeNull();
  });

  it('puts the logged values back when editing is cancelled', async () => {
    const { s, onEditSet } = withSet();
    await renderView(s, { onEditSet });
    await fireEvent.press(screen.getByRole('button', { name: /Edit set 1/ }));
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 reps'), '3');
    await fireEvent.press(screen.getByRole('button', { name: 'Cancel editing set 1' }));
    expect(onEditSet).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Edit set 1 reps')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: /Edit set 1/ }));
    expect(screen.getByLabelText('Edit set 1 reps').props.value).toBe('10');
  });

  it('does not call out when nothing changed', async () => {
    const { s, onEditSet } = withSet();
    await renderView(s, { onEditSet });
    await fireEvent.press(screen.getByRole('button', { name: /Edit set 1/ }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 1' }));
    expect(onEditSet).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Edit set 1 reps')).toBeNull();
  });

  it('warns that fewer reps than the camera verified lowers the verified count, but a load change does not', async () => {
    const { s, onEditSet } = withSet({ verifiedReps: 10, verificationStatus: 'verified' });
    await renderView(s, { onEditSet });
    await fireEvent.press(screen.getByRole('button', { name: /Edit set 1/ }));
    expect(screen.queryByText(/Camera-verified reps drop/)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 weight in kilograms'), '15');
    expect(screen.queryByText(/Camera-verified reps drop/)).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 reps'), '6');
    expect(screen.getByText('Camera-verified reps drop to 6 to match. Changing the weight keeps them.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Edit set 1 reps'), '10');
    expect(screen.queryByText(/Camera-verified reps drop/)).toBeNull();
  });

  it('leaves rows read-only without onEditSet', async () => {
    const { s } = withSet();
    await renderView(s);
    expect(screen.queryByRole('button', { name: /Edit set 1/ })).toBeNull();
    expect(screen.getByLabelText('Set 1 done')).toBeTruthy();
  });

  it("says a camera set the server didn't trust is not verified, never as a verified count", async () => {
    const { s } = withSet({ verificationStatus: 'trace_exceeds_time', verifiedReps: 0 });
    await renderView(s);
    expect(screen.getByText("Not verified — camera time didn't match the workout")).toBeTruthy();
    expect(screen.queryByText(/0 verified/)).toBeNull();
  });
});

describe('SetRow in pounds and its editor', () => {
  const base: SetRowProps = { number: 2, state: 'queued', loadable: true, previous: '12 × 10', kg: null, reps: null };

  it('labels the caption and the field in pounds and types to 0.1 lb', async () => {
    const onChangeKg = jest.fn();
    await render(
      <>
        <SetTableHeader loadable unit="lb" />
        <SetRow {...base} state="active" unit="lb" kgValue={135} repsValue={8} onChangeKg={onChangeKg} />
      </>,
    );
    expect(screen.getByText('LB', hid)).toBeTruthy();
    const field = screen.getByLabelText('Set 2 weight in pounds');
    await fireEvent.changeText(field, '137.34');
    expect(onChangeKg).toHaveBeenLastCalledWith(137.3);
    await fireEvent.changeText(field, '9999');
    expect(onChangeKg).toHaveBeenLastCalledWith(2204.6); // the API's 1000 kg ceiling
  });

  it('keeps kilograms to 0.01 as before', async () => {
    const onChangeKg = jest.fn();
    await render(<SetRow {...base} state="active" kgValue={20} repsValue={8} onChangeKg={onChangeKg} />);
    await fireEvent.changeText(screen.getByLabelText('Set 2 weight in kilograms'), '22.567');
    expect(onChangeKg).toHaveBeenLastCalledWith(22.57);
  });

  it('is not editable unless given onEdit', async () => {
    await render(<SetRow {...base} state="done" kg="20" reps="8" kgValue={20} repsValue={8} />);
    expect(screen.queryByRole('button', { name: /Edit set/ })).toBeNull();
  });

  it('is not editable while queued or active', async () => {
    await render(<SetRow {...base} state="queued" kg="20" reps="8" onEdit={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /Edit set/ })).toBeNull();
  });

  it('blocks a second save while one is in flight', async () => {
    const onEdit = jest.fn();
    await render(<SetRow {...base} state="done" kg="20" reps="8" kgValue={20} repsValue={8} onEdit={onEdit} />);
    await fireEvent.press(screen.getByRole('button', { name: /Edit set 2/ }));
    await fireEvent.changeText(screen.getByLabelText('Edit set 2 reps'), '9');
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 2' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 2' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith({ kg: 20, reps: 9 }, expect.any(Function));
  });
});

// ---- Summary, today, detail ---------------------------------------------------------------

const summary = (over: Partial<WorkoutSummaryDetail> = {}): WorkoutSummaryDetail => ({
  workout: { id: 'w1', localDate: '2026-09-28', durationMinutes: 42, painLevel: 'none', xp: 40, flags: [] },
  totals: { sets: 1, reps: 10, verifiedReps: 0, volumeKg: 612, perfectReps: 0, averageFormScore: null },
  sets: [{ exerciseId: 'bicep_curl', name: 'Bicep Curl', setIndex: 0, targetReps: 12, reps: 10, verifiedReps: 0, loadKg: 61.23, romPercent: null, formScore: null, quality: null }],
  prs: [{ exerciseId: 'bicep_curl', kind: 'max_load', value: 61.23, previous: 45.36, status: 'awarded' }],
  ...over,
});

describe('WorkoutSummaryView in display units', () => {
  it('shows kilograms for a metric user, as before', async () => {
    await render(<WorkoutSummaryView summary={summary()} units="metric" />);
    expect(screen.getByText('Set 1: 10 reps × 61.23 kg · target 12')).toBeTruthy();
    expect(screen.getByLabelText(/Heaviest load 61.2 kg/)).toBeTruthy();
    expect(screen.getByText('kg')).toBeTruthy();
  });

  it('shows pounds in the volume, each set and the records for an imperial user', async () => {
    await render(<WorkoutSummaryView summary={summary()} units="imperial" />);
    expect(screen.getByText('Set 1: 10 reps × 135 lb · target 12')).toBeTruthy();
    expect(screen.getByText((1349).toLocaleString())).toBeTruthy(); // 612 kg
    expect(screen.getByText('lb')).toBeTruthy();
    expect(screen.getByLabelText('New personal record: Bicep Curl, Heaviest load 135 lb')).toBeTruthy();
    expect(screen.getByText(/Heaviest load · up from 100 lb/)).toBeTruthy();
    expect(screen.queryByText(/kg/)).toBeNull();
  });

  it('formats record values by unit', () => {
    expect(prValue('max_load', 61.23)).toBe('61.2 kg');
    expect(prValue('max_load', 61.23, 'imperial')).toBe('135 lb');
    expect(prValue('estimated_1rm', 100, 'imperial')).toBe('220.5 lb');
    expect(prValue('max_reps', 12, 'imperial')).toBe('12 reps');
    expect(prValue('best_form', 92, 'imperial')).toBe('form 92');
  });

  it('explains the 3-workouts-a-day XP cap', async () => {
    await render(<WorkoutSummaryView summary={summary({ workout: { ...summary().workout, xp: 0, flags: ['daily_workout_cap_reached'] } })} units="metric" />);
    expect(screen.getByText("You've already earned XP for 3 workouts today — this one is saved but earns no XP.")).toBeTruthy();
  });

  it("says a set whose camera time didn't match the workout is not verified", async () => {
    const s = summary();
    const sets = [{ ...s.sets[0]!, verificationStatus: 'trace_exceeds_time' }];
    await render(<WorkoutSummaryView summary={{ ...s, sets }} units="metric" />);
    expect(screen.getByText(/Not verified — camera time didn't match the workout/)).toBeTruthy();
    expect(screen.queryByText(/ verified$/)).toBeNull();
  });

  it('adds no note for a normally verified set', async () => {
    const s = summary();
    const sets = [{ ...s.sets[0]!, verificationStatus: 'verified', verifiedReps: 10 }];
    await render(<WorkoutSummaryView summary={{ ...s, sets }} units="metric" />);
    expect(screen.queryByText(/Not verified/)).toBeNull();
  });
});

const planned = (over: Partial<PlannedExercise>): PlannedExercise => ({
  exerciseId: 'bicep_curl',
  name: 'Bicep Curl',
  sets: 3,
  targetReps: { min: 8, max: 12 },
  targetLoadKg: 20,
  restSeconds: 90,
  progression: 'repeat',
  note: null,
  cameraVerifiable: false,
  ...over,
});
const plan: WorkoutPlan = { generator: { id: 'rules', version: 1 }, date: '2026-10-10', title: 'Arms', focus: 'full_body', estimatedMinutes: 30, notes: [], exercises: [planned({})] };
const todayProps: TodayViewProps = {
  plan,
  completedToday: false,
  canStart: true,
  starting: false,
  startError: null,
  onStart: jest.fn(),
  onOpenExercise: jest.fn(),
  camera: { verifying: true, message: 'ok' },
};

describe('TodayView targets in display units', () => {
  it('shows kg for metric and pounds for imperial, in the row and its spoken label', async () => {
    await render(<TodayView {...todayProps} units="metric" />);
    expect(screen.getByText('3 sets · 8–12 reps · 20 kg')).toBeTruthy();
    expect(screen.getByLabelText('Bicep Curl: 3 sets of 8–12 reps at 20 kilograms')).toBeTruthy();
  });

  it('shows a round number of pounds for an imperial user', async () => {
    await render(<TodayView {...todayProps} units="imperial" />);
    expect(screen.getByText('3 sets · 8–12 reps · 44 lb')).toBeTruthy();
    expect(screen.getByLabelText('Bicep Curl: 3 sets of 8–12 reps at 44 pounds')).toBeTruthy();
  });
});

const goblet: Exercise = {
  id: 'goblet_squat',
  name: 'Goblet squat',
  pattern: 'squat',
  kind: 'strength',
  equipment: [['dumbbells']],
  primaryMuscles: ['quads'],
  secondaryMuscles: [],
  cameraVerifiable: false,
  loadable: true,
  loadIncrementKg: 2.5,
  targetReps: { min: 8, max: 12 },
  difficulty: 'beginner',
  instructions: ['Hold it.'],
  safety: ['Heels down.'],
  camera: null,
} as unknown as Exercise;
const set = (reps: number, loadKg: number) => ({ reps, verifiedReps: 0, loadKg, romPercent: null });
const history: ExerciseDetail['history'] = [
  { workoutId: 'w2', localDate: '2026-03-10', sets: [set(8, 61.23), set(6, 61.23)] },
  { workoutId: 'w1', localDate: '2026-03-03', sets: [set(10, 45.36)] },
];

describe('ExerciseDetailView in display units', () => {
  const detail: ExerciseDetail = { exercise: goblet, history, records: [{ kind: 'max_load', value: 61.23 }, { kind: 'max_reps', value: 10 }] };

  it('shows history and records in pounds for an imperial user', async () => {
    await render(<ExerciseDetailView detail={detail} poseAvailable={false} onPractise={jest.fn()} units="imperial" />);
    await fireEvent.press(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByText('Heaviest: 135 lb')).toBeTruthy();
    expect(screen.getByText('Most reps: 10 reps')).toBeTruthy();
    expect(screen.getByText('8 × 135 lb · 6 × 135 lb')).toBeTruthy();
    expect(screen.getByText('10 × 100 lb')).toBeTruthy();
    expect(screen.queryByText(/kg/)).toBeNull();
  });

  it('shows history and records in kg for a metric user, as before', async () => {
    await render(<ExerciseDetailView detail={detail} poseAvailable={false} onPractise={jest.fn()} units="metric" />);
    await fireEvent.press(screen.getByRole('tab', { name: 'History' }));
    expect(screen.getByText('Heaviest: 61.23 kg')).toBeTruthy();
    expect(screen.getByText('10 × 45.36 kg')).toBeTruthy();
  });

  it('charts progress in pounds', async () => {
    await render(<ExerciseDetailView detail={{ ...detail, history: [history[0]!] }} poseAvailable={false} onPractise={jest.fn()} units="imperial" />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Progress' }));
    expect(screen.getByText('135')).toBeTruthy(); // top weight
    expect(screen.getAllByText('lb').length).toBe(2); // top weight and volume
    expect(screen.queryByText('kg')).toBeNull();
  });
});
