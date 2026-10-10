import { fireEvent, render, screen } from '@testing-library/react-native';
import type { PlannedExercise, WorkoutPlan } from '@/lib/types';
import { CameraCoachingRow, TodayView, type TodayViewProps } from './TodayView';

const ex = (over: Partial<PlannedExercise> & Pick<PlannedExercise, 'exerciseId' | 'name'>): PlannedExercise => ({
  sets: 3,
  targetReps: { min: 8, max: 12 },
  targetLoadKg: null,
  restSeconds: 90,
  progression: 'repeat',
  note: null,
  cameraVerifiable: false,
  ...over,
});

const plan: WorkoutPlan = {
  generator: { id: 'rules', version: 1 },
  date: '2026-10-10',
  title: 'Full body A',
  focus: 'full_body',
  estimatedMinutes: 35,
  notes: [],
  exercises: [
    ex({ exerciseId: 'bodyweight_squat', name: 'Bodyweight Squat', sets: 3, targetReps: { min: 10, max: 15 }, progression: 'increase_reps', cameraVerifiable: true, note: 'Sit back and down' }),
    ex({ exerciseId: 'push_up', name: 'Push-Up', sets: 2, targetReps: { min: 10, max: 10 }, restSeconds: 60 }),
    ex({ exerciseId: 'bicep_curl', name: 'Bicep Curl', sets: 3, targetLoadKg: 12, restSeconds: 45, progression: 'increase_load' }),
  ],
};

const base: TodayViewProps = {
  plan,
  completedToday: false,
  canStart: true,
  starting: false,
  startError: null,
  onStart: jest.fn(),
  onOpenExercise: jest.fn(),
  camera: { verifying: true, message: 'Counts every full-range rep on this device.' },
};

// @testing-library/react-native v14: render and events are async.
describe('TodayView', () => {
  it('has exactly one Start workout button in the hero and starts on press', async () => {
    const onStart = jest.fn();
    await render(<TodayView {...base} onStart={onStart} />);
    const start = screen.getAllByRole('button', { name: /workout|train again/i });
    expect(start).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Start workout' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Start workout' }));
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Today's workout")).toBeTruthy();
    expect(screen.getByText('Full body A')).toBeTruthy();
  });

  it('flips to Train again when already trained today, with the done message', async () => {
    await render(<TodayView {...base} completedToday />);
    expect(screen.getByRole('button', { name: 'Train again' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
    expect(screen.getByText('Done for today. Refuel and recover — you can still train again if you planned to.')).toBeTruthy();
  });

  it('shows no Start button while a session is open', async () => {
    await render(<TodayView {...base} canStart={false} />);
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Train again' })).toBeNull();
    // The exercise rows are still there.
    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('shows the thumbnail strip and the headline numbers', async () => {
    await render(<TodayView {...base} />);
    expect(screen.getByRole('image', { name: "3 exercises in today's workout" })).toBeTruthy();
    expect(screen.getByLabelText('Time: ~35 min')).toBeTruthy();
    expect(screen.getByLabelText('Exercises: 3')).toBeTruthy();
    expect(screen.getByLabelText('Sets: 8')).toBeTruthy();
  });

  it('lists the exercises with details, badges and hairlines between them', async () => {
    const { toJSON } = await render(<TodayView {...base} />);
    expect(screen.getByRole('button', { name: 'Bodyweight Squat: 3 sets of 10–15 reps' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Push-Up: 2 sets of 10 reps' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bicep Curl: 3 sets of 8–12 reps at 12 kilograms' })).toBeTruthy();
    expect(screen.getByText('3 sets · 10–15 reps')).toBeTruthy();
    expect(screen.getByText('2 sets · 10 reps')).toBeTruthy();
    expect(screen.getByText('3 sets · 8–12 reps · 12 kg')).toBeTruthy();
    expect(screen.getByText('1 min 30 s rest')).toBeTruthy();
    expect(screen.getByText('1 min rest')).toBeTruthy();
    expect(screen.getByText('45 s rest')).toBeTruthy();
    expect(screen.getByText('Sit back and down')).toBeTruthy();
    expect(screen.getByText('Add reps')).toBeTruthy();
    expect(screen.getByText('Add weight')).toBeTruthy();
    const dividers = JSON.stringify(toJSON()).match(/"height":0\.?\d*,"backgroundColor":"[^"]+"/g) ?? [];
    expect(dividers).toHaveLength(plan.exercises.length - 1);
  });

  it('opens an exercise when its row is pressed', async () => {
    const onOpenExercise = jest.fn();
    await render(<TodayView {...base} onOpenExercise={onOpenExercise} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Push-Up: 2 sets of 10 reps' }));
    expect(onOpenExercise).toHaveBeenCalledWith('push_up');
  });

  it('shows the muscles hit, from the catalogue, most-trained first', async () => {
    await render(<TodayView {...base} plan={{ ...plan, exercises: [plan.exercises[0]!] }} />);
    expect(screen.getByText('Muscles hit')).toBeTruthy();
    // bodyweight_squat: quads and glutes are the main movers; 3 sets each.
    expect(screen.getByLabelText('Quads: 3 sets')).toBeTruthy();
    expect(screen.getByLabelText('Glutes: 3 sets')).toBeTruthy();
    expect(screen.queryByLabelText(/^Chest/)).toBeNull();
  });

  it('shows camera coaching as Ready with its message, or Not available', async () => {
    const { rerender } = await render(<TodayView {...base} />);
    expect(screen.getByText('Camera coaching')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('Counts every full-range rep on this device.')).toBeTruthy();
    expect(screen.getByText('Reps the camera counts earn full XP. Reps you enter yourself earn a little less.')).toBeTruthy();
    await rerender(<TodayView {...base} camera={{ verifying: false, message: 'This browser cannot track you yet.' }} />);
    expect(screen.getByText('Not available')).toBeTruthy();
    expect(screen.queryByText('Ready')).toBeNull();
    expect(screen.getByText('This browser cannot track you yet.')).toBeTruthy();
  });

  it('shows the adaptive caption and badge, plan notes and a start error', async () => {
    await render(<TodayView {...base} plan={{ ...plan, generator: { id: 'adaptive', version: 1 }, notes: ['No barbell found, using dumbbells.'] }} startError="Couldn't start — check your connection." />);
    expect(screen.getByText('Adapted to your reps, form, range of motion and consistency.')).toBeTruthy();
    expect(screen.getByText('Adaptive · Pro')).toBeTruthy();
    expect(screen.getByText('No barbell found, using dumbbells.')).toBeTruthy();
    expect(screen.getByText("Couldn't start — check your connection.")).toBeTruthy();
  });

  it('uses the standard caption and no badge for a rules plan', async () => {
    await render(<TodayView {...base} />);
    expect(screen.getByText('Built from your goal, equipment and recent sessions.')).toBeTruthy();
    expect(screen.queryByText('Adaptive · Pro')).toBeNull();
  });

  it('explains an empty plan and offers no Start button', async () => {
    await render(<TodayView {...base} plan={{ ...plan, exercises: [] }} />);
    expect(screen.getByText('No exercises match your equipment yet. Update your training setup in Profile.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
    expect(screen.queryByText('Muscles hit')).toBeNull();
  });

  it('renders the camera coaching row standalone, for the Today tab while the plan loads or fails', async () => {
    const { rerender } = await render(<CameraCoachingRow camera={{ verifying: true, message: 'Counts every full-range rep on this device.' }} />);
    expect(screen.getByText('Camera coaching')).toBeTruthy();
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('Counts every full-range rep on this device.')).toBeTruthy();
    await rerender(<CameraCoachingRow camera={{ verifying: false, message: "Camera coaching isn't available right now." }} />);
    expect(screen.getByText('Not available')).toBeTruthy();
    expect(screen.queryByText('Start workout')).toBeNull();
  });
});
