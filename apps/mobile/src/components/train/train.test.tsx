import { fireEvent, render, screen } from '@testing-library/react-native';
import type { SessionExercise, WorkoutSession, WorkoutSummaryDetail } from '@/lib/types';
import { allPlannedDone, currentExerciseIndex, elapsedSeconds, formatClock, formatPrevious, formatTarget, nextSetDefaults, restRemaining } from '@/lib/workoutSession';
import { ActiveWorkoutView } from './ActiveWorkoutView';
import { setsPerMuscle, WorkoutSummaryView } from './WorkoutSummaryView';

const NOW = new Date('2026-09-28T10:20:00Z');

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
    cameraVerifiable: true,
    loadable: true,
    previous: { localDate: '2026-09-26', sets: [{ reps: 12, loadKg: 10 }, { reps: 11, loadKg: 10 }] },
    loggedSets: [],
    ...over,
  };
}

const logged = (reps: number, loadKg = 0, id = `s-${reps}-${loadKg}`) => ({
  id,
  clientSetId: `c-${id}`,
  exerciseId: 'x',
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
});

function session(over: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'sess-1',
    clientSessionId: 'c-1',
    status: 'active',
    localDate: '2026-09-28',
    startedAt: '2026-09-28T10:00:00Z',
    pausedAt: null,
    pausedMs: 5 * 60_000,
    activeMinutes: 15,
    lastActivityAt: '2026-09-28T10:19:00Z',
    idleSince: null,
    leftOpen: false,
    rest: null,
    workoutId: null,
    completedAt: null,
    exercises: [ex(), ex({ exerciseId: 'push_up', name: 'Push-Up', loadable: false, targetLoadKg: null, targetReps: { min: 6, max: 15 }, previous: null })],
    ...over,
  };
}

describe('session helpers', () => {
  it('picks the first exercise with sets left, then stays on the last', () => {
    expect(currentExerciseIndex(session())).toBe(0);
    const firstDone = session({ exercises: [ex({ loggedSets: [logged(12), logged(12), logged(12)] }), ex({ exerciseId: 'push_up' })] });
    expect(currentExerciseIndex(firstDone)).toBe(1);
    expect(allPlannedDone(firstDone)).toBe(false);
    expect(currentExerciseIndex(session({ exercises: [] }))).toBe(-1);
  });

  it('suggests the next set from the last set, then the plan, then last time', () => {
    expect(nextSetDefaults(ex())).toEqual({ reps: 12, loadKg: 12 });
    expect(nextSetDefaults(ex({ loggedSets: [logged(10, 14)] }))).toEqual({ reps: 10, loadKg: 14 });
    expect(nextSetDefaults(ex({ targetReps: null, targetLoadKg: null }))).toEqual({ reps: 12, loadKg: 10 });
    expect(nextSetDefaults(ex({ loadable: false }))).toEqual({ reps: 12, loadKg: 0 });
  });

  it('computes elapsed time without paused time, and rest from the server deadline', () => {
    expect(elapsedSeconds(session(), NOW)).toBe(15 * 60);
    expect(elapsedSeconds(session({ pausedAt: '2026-09-28T10:10:00Z' }), NOW)).toBe(5 * 60); // clock frozen while paused
    // Left open: the clock stopped at the last activity; idle time never counts.
    expect(elapsedSeconds(session({ idleSince: '2026-09-28T10:12:00Z', leftOpen: true }), NOW)).toBe(7 * 60);
    expect(restRemaining(session({ rest: { endsAt: '2026-09-28T10:21:30Z', seconds: 90, remainingSeconds: 90 } }), NOW)).toBe(90);
    expect(restRemaining(session(), NOW)).toBeNull();
  });

  it('formats clocks, targets and previous performance', () => {
    expect(formatClock(65)).toBe('1:05');
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatTarget(ex())).toBe('8–12 reps @ 12 kg');
    expect(formatPrevious(ex())).toBe('12 × 10 kg · 11 × 10 kg');
    expect(formatPrevious(ex({ previous: null }))).toBeNull();
    expect(formatPrevious(ex({ previous: { localDate: '2026-09-20', sets: [{ reps: 4, loadKg: 0 }] } as never }))).toBe('4 reps');
  });
});

async function renderActive(s: WorkoutSession, over: Partial<Parameters<typeof ActiveWorkoutView>[0]> = {}) {
  const props = {
    session: s,
    index: 0,
    onSelectExercise: jest.fn(),
    draft: { reps: 12, loadKg: 12 },
    onChangeDraft: jest.fn(),
    loadStepKg: 1,
    onLogSet: jest.fn(),
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

describe('ActiveWorkoutView', () => {
  it('shows the current set, target, previous performance and honest verification status', async () => {
    await renderActive(session());
    expect(screen.getByRole('header', { name: 'Bicep Curl' })).toBeTruthy();
    expect(screen.getByText('Set 1 of 3 · 8–12 reps @ 12 kg')).toBeTruthy();
    expect(screen.getByText('Last time: 12 × 10 kg · 11 × 10 kg')).toBeTruthy();
    expect(screen.getByText('Reps you enter yourself are recorded. Use the camera to have them verified.')).toBeTruthy();
    expect(screen.getByLabelText('Workout time 15:00')).toBeTruthy();
  });

  it('adjusts reps and weight with large steppers and logs the set', async () => {
    const p = await renderActive(session());
    await fireEvent.press(screen.getByRole('button', { name: 'Increase Reps' }));
    expect(p.onChangeDraft).toHaveBeenLastCalledWith({ reps: 13, loadKg: 12 });
    await fireEvent.press(screen.getByRole('button', { name: 'Decrease Weight' }));
    expect(p.onChangeDraft).toHaveBeenLastCalledWith({ reps: 12, loadKg: 11 });
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1' }));
    expect(p.onLogSet).toHaveBeenCalledTimes(1);
  });

  it('hides the weight control for bodyweight moves', async () => {
    await renderActive(session(), { index: 1, draft: { reps: 10, loadKg: 0 } });
    expect(screen.queryByRole('button', { name: 'Increase Weight' })).toBeNull();
    expect(screen.getByText(/Reps you enter yourself are recorded/)).toBeTruthy();
  });

  it('offers camera tracking only when the build supports it', async () => {
    await renderActive(session());
    expect(screen.queryByRole('button', { name: 'Track on camera' })).toBeNull();
    const onOpenCamera = jest.fn();
    await renderActive(session(), { onOpenCamera });
    await fireEvent.press(screen.getByRole('button', { name: 'Use camera coaching' }));
    expect(onOpenCamera).toHaveBeenCalled();
  });

  it('offers a retry that keeps the unsaved set after a failure', async () => {
    const p = await renderActive(session(), { logError: 'Not saved — no connection. Your set is kept; tap Retry.' });
    expect(screen.getByText(/Not saved — no connection/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Retry — save this set' }));
    expect(p.onLogSet).toHaveBeenCalledTimes(1);
  });

  it('shows the rest timer with skip and +30 s', async () => {
    const p = await renderActive(session({ rest: { endsAt: '2026-09-28T10:21:30Z', seconds: 90, remainingSeconds: 90 } }));
    expect(screen.getByLabelText('90 seconds of rest left')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Log set/ })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: '+30 s' }));
    expect(p.onAddRest).toHaveBeenCalledWith(120);
    await fireEvent.press(screen.getByRole('button', { name: 'Skip rest' }));
    expect(p.onSkipRest).toHaveBeenCalled();
  });

  it('pauses and resumes; logging is disabled while paused', async () => {
    const p = await renderActive(session({ status: 'paused', pausedAt: '2026-09-28T10:15:00Z' }));
    expect(screen.getByText('Paused', { exact: true })).toBeTruthy();
    const resumeButtons = screen.getAllByRole('button', { name: 'Resume' });
    await fireEvent.press(resumeButtons[0]!);
    expect(p.onResume).toHaveBeenCalled();
    // The pause overlay is modal: assistive tech can't reach the set controls behind it.
    expect(screen.queryByRole('button', { name: 'Log set 1' })).toBeNull();
  });

  it('navigates between exercises, deletes sets and ends the workout', async () => {
    const s = session({ exercises: [ex({ loggedSets: [logged(12, 12, 'set-a')] }), ex({ exerciseId: 'push_up', name: 'Push-Up' })] });
    const p = await renderActive(s);
    expect(screen.getByText('Set 2 of 3 · 8–12 reps @ 12 kg')).toBeTruthy();
    await fireEvent.press(screen.getByRole('tab', { name: 'Push-Up' }));
    expect(p.onSelectExercise).toHaveBeenCalledWith(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete set 1' }));
    expect(p.onDeleteSet).toHaveBeenCalledWith('set-a');
    await fireEvent.press(screen.getByRole('button', { name: 'End workout' }));
    expect(p.onEnd).toHaveBeenCalled();
  });
});

describe('WorkoutSummaryView', () => {
  const summary: WorkoutSummaryDetail = {
    workout: { id: 'w1', localDate: '2026-09-28', durationMinutes: 42, painLevel: 'none', xp: 40, flags: [] },
    totals: { sets: 2, reps: 15, verifiedReps: 5, volumeKg: 120, perfectReps: 4, averageFormScore: 92 },
    sets: [
      { exerciseId: 'bicep_curl', name: 'Bicep Curl', setIndex: 0, targetReps: 12, reps: 10, verifiedReps: 0, loadKg: 12, romPercent: null, formScore: null, quality: null },
      { exerciseId: 'bodyweight_squat', name: 'Bodyweight Squat', setIndex: 0, targetReps: null, reps: 5, verifiedReps: 5, loadKg: 0, romPercent: 100, formScore: 92, quality: null },
    ],
    prs: [
      { exerciseId: 'bicep_curl', kind: 'max_load', value: 12, previous: 10, status: 'awarded' },
      { exerciseId: 'bodyweight_squat', kind: 'max_reps', value: 5, previous: null, status: 'awarded' },
      { exerciseId: '*', kind: 'longest_streak', value: 1, previous: null, status: 'awarded' },
    ],
  };

  it("adds the coach's note on the session, with where to go next", async () => {
    const onCoachAction = jest.fn();
    const coachNote = {
      topic: 'workout' as const,
      message: 'Your last session: Bicep Curl with a form score of 92. Next time, add one more rep per set.',
      category: 'workout' as const,
      priority: 'normal' as const,
      evidence: [{ fact: 'workouts.0.exercises.0.formScore', claim: 'Form score, last session', value: '92' }],
      actions: [{ id: 'view_exercise', label: 'Exercise tips', route: '/train/exercise/bicep_curl' }],
      confidence: 'high' as const,
      generatedAt: '2026-09-27T12:00:00Z',
      provider: { type: 'real_ai' as const, name: 'Claude' },
      degraded: null,
    };
    await render(<WorkoutSummaryView summary={summary} onDone={jest.fn()} coachNote={coachNote} onCoachAction={onCoachAction} />);
    expect(screen.getByText('Coach on this session')).toBeTruthy();
    expect(screen.getByText('AI coach')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Exercise tips' }));
    expect(onCoachAction).toHaveBeenCalledWith('/train/exercise/bicep_curl');
  });

  it('summarises XP, totals, PRs and each set with target, verified and ROM', async () => {
    const onDone = jest.fn();
    await render(<WorkoutSummaryView summary={summary} onDone={onDone} />);
    expect(screen.getByText('+40')).toBeTruthy();
    expect(screen.getByLabelText('New personal record: Bicep Curl, Heaviest load 12 kg')).toBeTruthy();
    expect(screen.getByText(/Heaviest load · up from 10 kg/)).toBeTruthy();
    // A first value is a baseline, not a PR; workout-wide baselines aren't listed at all.
    expect(screen.getByText('First records set')).toBeTruthy();
    expect(screen.getByText('Bodyweight Squat: most verified reps 5 reps')).toBeTruthy();
    expect(screen.queryByText(/training streak/i)).toBeNull();
    expect(screen.getAllByText('New personal record')).toHaveLength(1);
    expect(screen.getByText('Set 1: 10 reps × 12 kg · target 12')).toBeTruthy();
    expect(screen.getByText('Set 1: 5 reps · 5 verified · form 92 · ROM 100%')).toBeTruthy();
    expect(screen.getByText('Average form')).toBeTruthy();
    expect(screen.getByText('Perfect reps')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
    expect(onDone).toHaveBeenCalled();
  });
});

describe('a workout left open', () => {
  it('says so, dates it, and offers to carry on or end it', async () => {
    await renderActive(session({ leftOpen: true, idleSince: '2026-09-27T19:00:00Z', localDate: '2026-09-27' }));
    expect(screen.getByText(/You left this workout open on Sunday/)).toBeTruthy();
    expect(screen.getByText(/The time away doesn't count/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'End workout' })).toBeTruthy();
  });

  it('stays quiet for a normal session', async () => {
    await renderActive(session());
    expect(screen.queryByText(/left this workout open/)).toBeNull();
  });
});

describe('setsPerMuscle', () => {
  it('counts sets for each exercise’s main muscles from the catalogue, most-trained first', () => {
    const rows = setsPerMuscle([{ exerciseId: 'push_up' }, { exerciseId: 'push_up' }, { exerciseId: 'bicep_curl' }, { exerciseId: 'not_a_real_exercise' }]);
    expect(rows).toEqual([
      { muscle: 'chest', value: 2 },
      { muscle: 'triceps', value: 2 },
      { muscle: 'biceps', value: 1 },
    ]);
  });
});
