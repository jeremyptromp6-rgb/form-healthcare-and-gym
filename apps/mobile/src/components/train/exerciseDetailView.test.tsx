import { fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import type { Exercise, ExerciseDetail } from '@/lib/types';
import { ExerciseDetailView } from './ExerciseDetailView';

const goblet: Exercise = {
  id: 'goblet_squat',
  name: 'Goblet Squat',
  kind: 'weighted',
  cameraVerifiable: true,
  primaryMuscles: ['quads', 'glutes'],
  secondaryMuscles: ['core'],
  equipment: [['dumbbells'], ['kettlebell']],
  pattern: 'squat',
  difficulty: 'beginner',
  loadable: true,
  loadIncrementKg: 2,
  targetReps: { min: 8, max: 12 },
  perSide: false,
  instructions: ['Hold the weight at your chest.', 'Sit down between your heels.'],
  safety: ['Keep your heels down.'],
  camera: { joint: 'knee', view: 'side', setup: 'Place the phone side-on at hip height.' },
};

const pushUp: Exercise = {
  ...goblet,
  id: 'push_up',
  name: 'Push-up',
  kind: 'bodyweight',
  cameraVerifiable: false,
  loadable: false,
  equipment: [['bodyweight']],
  camera: null,
  instructions: ['Lower your chest to the floor.'],
  safety: ['Keep your core tight.'],
};

const set = (reps: number, loadKg: number, verifiedReps = 0) => ({ reps, verifiedReps, loadKg, romPercent: null });

// Newest first, as the server returns it.
const weightedHistory: ExerciseDetail['history'] = [
  { workoutId: 'w2', localDate: '2026-03-10', sets: [set(8, 22.5), set(6, 22.5, 5)] },
  { workoutId: 'w1', localDate: '2026-03-03', sets: [set(10, 20), set(10, 20)] },
];

const detail = (exercise: Exercise, history: ExerciseDetail['history'] = [], records: ExerciseDetail['records'] = []): ExerciseDetail => ({ exercise, history, records });

const open = async (name: string) => fireEvent.press(screen.getByRole('tab', { name }));

// @testing-library/react-native v14: render and events are async.
describe('ExerciseDetailView', () => {
  describe('About', () => {
    it('is the default tab and shows how to, safety, equipment and muscles', async () => {
      await render(<ExerciseDetailView detail={detail(goblet)} poseAvailable onPractise={jest.fn()} />);
      expect(screen.getByRole('tab', { name: 'About' }).props.accessibilityState).toMatchObject({ selected: true });
      expect(screen.getByLabelText('Exercise sections').props.accessibilityRole).toBe('tablist');
      expect(screen.getByText('Muscles worked')).toBeTruthy();
      expect(screen.getByText('Equipment')).toBeTruthy();
      expect(screen.getByText('dumbbells')).toBeTruthy();
      expect(screen.getByText('kettlebell')).toBeTruthy();
      expect(screen.getByText('How to')).toBeTruthy();
      expect(screen.getByText('Hold the weight at your chest.')).toBeTruthy();
      expect(screen.getByText('Sit down between your heels.')).toBeTruthy();
      expect(screen.getByText('Safety')).toBeTruthy();
      expect(screen.getByText('• Keep your heels down.')).toBeTruthy();
      expect(screen.getByLabelText('Level: Beginner')).toBeTruthy();
      expect(screen.getByLabelText('Reps: 8–12')).toBeTruthy();
      expect(screen.getByLabelText('Coaching: Camera')).toBeTruthy();
    });

    it('names the three legend keys from the art colours', async () => {
      await render(<ExerciseDetailView detail={detail(goblet)} poseAvailable onPractise={jest.fn()} />);
      expect(screen.getByText('Start')).toBeTruthy();
      expect(screen.getByText('Finish')).toBeTruthy();
      expect(screen.getByText('Muscles working')).toBeTruthy();
    });

    it('offers camera practice only when the exercise supports it and the device can run it, and calls onPractise with the id', async () => {
      const onPractise = jest.fn();
      const { rerender } = await render(<ExerciseDetailView detail={detail(goblet)} poseAvailable onPractise={onPractise} />);
      expect(screen.getByText('Camera setup')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Practise with camera coaching' }));
      expect(onPractise).toHaveBeenCalledTimes(1);
      expect(onPractise).toHaveBeenCalledWith('goblet_squat');

      await rerender(<ExerciseDetailView detail={detail(goblet)} poseAvailable={false} onPractise={onPractise} />);
      expect(screen.getByText('Camera setup')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Practise with camera coaching' })).toBeNull();

      await rerender(<ExerciseDetailView detail={detail({ ...goblet, cameraVerifiable: false })} poseAvailable onPractise={onPractise} />);
      expect(screen.queryByRole('button', { name: 'Practise with camera coaching' })).toBeNull();

      await rerender(<ExerciseDetailView detail={detail(pushUp)} poseAvailable onPractise={onPractise} />);
      expect(screen.queryByText('Camera setup')).toBeNull();
      expect(screen.getByText('bodyweight')).toBeTruthy();
    });
  });

  describe('History', () => {
    it('shows records and every session with its sets', async () => {
      const records = [
        { kind: 'max_load', value: 22.5 },
        { kind: 'estimated_1rm', value: 28 },
        { kind: 'max_reps', value: 10 },
      ];
      await render(<ExerciseDetailView detail={detail(goblet, weightedHistory, records)} poseAvailable onPractise={jest.fn()} />);
      await open('History');
      expect(screen.getByRole('tab', { name: 'History' }).props.accessibilityState).toMatchObject({ selected: true });
      expect(screen.getByText('Heaviest: 22.5 kg')).toBeTruthy();
      expect(screen.getByText('Est. 1RM: 28 kg')).toBeTruthy();
      expect(screen.getByText('Most reps: 10 reps')).toBeTruthy();
      expect(screen.getByText('8 × 22.5 kg · 6 × 22.5 kg (5✓)')).toBeTruthy();
      expect(screen.getByText('10 × 20 kg · 10 × 20 kg')).toBeTruthy();
      expect(screen.queryByText("You haven't done this one yet.")).toBeNull();
      // About content is no longer shown.
      expect(screen.queryByText('How to')).toBeNull();
    });

    it('says so when there is no history', async () => {
      await render(<ExerciseDetailView detail={detail(goblet)} poseAvailable onPractise={jest.fn()} />);
      await open('History');
      expect(screen.getByText("You haven't done this one yet.")).toBeTruthy();
    });
  });

  describe('Progress', () => {
    it('has an honest empty state with no sessions and draws no charts', async () => {
      await render(<ExerciseDetailView detail={detail(goblet)} poseAvailable onPractise={jest.fn()} />);
      await open('Progress');
      expect(screen.getByText('Log this exercise to see your progress here.')).toBeTruthy();
      expect(screen.queryAllByTestId('trend-bar')).toHaveLength(0);
    });

    it('shows the numbers but no trend after a single session', async () => {
      await render(<ExerciseDetailView detail={detail(goblet, [weightedHistory[0]!])} poseAvailable onPractise={jest.fn()} />);
      await open('Progress');
      expect(screen.getByText('Log it again to see a trend.')).toBeTruthy();
      expect(screen.queryAllByTestId('trend-bar')).toHaveLength(0);
      expect(screen.getByLabelText('Top weight: 22.5 kg')).toBeTruthy();
      // 8 × 22.5 + 6 × 22.5 = 315
      expect(screen.getByLabelText('Volume: 315 kg')).toBeTruthy();
      expect(screen.getByLabelText('Best reps: 8')).toBeTruthy();
    });

    it('charts top weight, volume and best reps from the real sets, oldest first', async () => {
      await render(<ExerciseDetailView detail={detail(goblet, weightedHistory)} poseAvailable onPractise={jest.fn()} />);
      await open('Progress');
      // Top weights 20 then 22.5.
      expect(screen.getByLabelText('Top weight: 2 sessions, latest 22.5 kg, best 22.5 kg')).toBeTruthy();
      // Volume: 10×20 + 10×20 = 400, then 8×22.5 + 6×22.5 = 315.
      expect(screen.getByLabelText('Volume: 2 sessions, latest 315 kg, best 400 kg')).toBeTruthy();
      // Best reps: 10 then 8.
      expect(screen.getByLabelText('Best reps: 2 sessions, latest 8 reps, best 10 reps')).toBeTruthy();
      expect(screen.getAllByTestId('trend-bar')).toHaveLength(6);
      expect(screen.queryByText('Total reps')).toBeNull();
      expect(screen.queryByText('Log it again to see a trend.')).toBeNull();
    });

    it('only counts sessions that used a weight in Top weight', async () => {
      const history: ExerciseDetail['history'] = [
        { workoutId: 'w3', localDate: '2026-03-17', sets: [set(8, 25)] },
        { workoutId: 'w2', localDate: '2026-03-10', sets: [set(12, 0)] },
        { workoutId: 'w1', localDate: '2026-03-03', sets: [set(10, 20)] },
      ];
      await render(<ExerciseDetailView detail={detail(goblet, history)} poseAvailable onPractise={jest.fn()} />);
      await open('Progress');
      expect(screen.getByLabelText('Top weight: 2 sessions, latest 25 kg, best 25 kg')).toBeTruthy();
      expect(screen.getByLabelText('Best reps: 3 sessions, latest 8 reps, best 12 reps')).toBeTruthy();
    });

    it('shows Total reps instead of weight charts for a bodyweight exercise', async () => {
      const history: ExerciseDetail['history'] = [
        { workoutId: 'w2', localDate: '2026-03-10', sets: [set(12, 0), set(10, 0)] },
        { workoutId: 'w1', localDate: '2026-03-03', sets: [set(8, 0), set(8, 0), set(6, 0)] },
      ];
      await render(<ExerciseDetailView detail={detail(pushUp, history)} poseAvailable onPractise={jest.fn()} />);
      await open('Progress');
      // 22 reps latest, 22 earlier.
      expect(screen.getByLabelText('Total reps: 2 sessions, latest 22 reps, best 22 reps')).toBeTruthy();
      expect(screen.getByLabelText('Best reps: 2 sessions, latest 12 reps, best 12 reps')).toBeTruthy();
      expect(screen.queryByText('Top weight')).toBeNull();
      expect(screen.queryByText('Volume')).toBeNull();
    });

    it('renders the form history slot at the end of Progress only', async () => {
      await render(<ExerciseDetailView detail={detail(goblet, weightedHistory)} poseAvailable onPractise={jest.fn()} formHistory={<Text>Form history slot</Text>} />);
      expect(screen.queryByText('Form history slot')).toBeNull();
      await open('Progress');
      expect(screen.getByText('Form history slot')).toBeTruthy();
      await open('About');
      expect(screen.queryByText('Form history slot')).toBeNull();
    });
  });
});
