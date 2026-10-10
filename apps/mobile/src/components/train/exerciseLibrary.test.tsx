import Ionicons from '@expo/vector-icons/Ionicons';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import type { Exercise } from '@/lib/types';
import { ExerciseLibrary } from './ExerciseLibrary';

const base: Omit<Exercise, 'id' | 'name' | 'primaryMuscles' | 'secondaryMuscles' | 'equipment' | 'difficulty' | 'cameraVerifiable'> = {
  kind: 'weighted',
  pattern: 'squat',
  loadable: true,
  loadIncrementKg: 2,
  targetReps: { min: 8, max: 12 },
  perSide: false,
  instructions: ['Do it.'],
  safety: ['Stay safe.'],
  camera: null,
};

const exercises: Exercise[] = [
  { ...base, id: 'goblet_squat', name: 'Goblet Squat', primaryMuscles: ['quads', 'glutes'], secondaryMuscles: ['core'], equipment: [['dumbbells'], ['kettlebell']], difficulty: 'beginner', cameraVerifiable: true },
  { ...base, id: 'push_up', name: 'Push-up', kind: 'bodyweight', loadable: false, primaryMuscles: ['chest'], secondaryMuscles: ['triceps', 'core'], equipment: [['bodyweight']], difficulty: 'beginner', cameraVerifiable: false },
  { ...base, id: 'bench_press', name: 'Bench Press', primaryMuscles: ['chest'], secondaryMuscles: ['triceps'], equipment: [['barbell', 'bench'], ['dumbbells', 'bench']], difficulty: 'intermediate', cameraVerifiable: false },
  { ...base, id: 'cable_row', name: 'Cable Row', primaryMuscles: ['back', 'lats'], secondaryMuscles: ['biceps'], equipment: [['cable_machine'], ['machines']], difficulty: 'advanced', cameraVerifiable: false },
  { ...base, id: 'plank', name: 'Plank', kind: 'bodyweight', loadable: false, primaryMuscles: ['core'], secondaryMuscles: [], equipment: [[]], difficulty: 'beginner', cameraVerifiable: false },
];

const rowNames = () => screen.queryAllByRole('button').map((b) => String(b.props.accessibilityLabel).split(',')[0]);
const count = (text: string) => screen.getByText(text);
const radios = (group: string) => within(screen.getByLabelText(group));

// @testing-library/react-native v14: render and events are async.
describe('ExerciseLibrary', () => {
  it('lists every exercise as a dense row with muscles, level and equipment', async () => {
    await render(<ExerciseLibrary exercises={exercises} onOpen={() => {}} />);
    expect(count('All exercises · 5 exercises')).toBeTruthy();
    expect(rowNames().filter((n) => exercises.some((e) => e.name === n))).toEqual(['Goblet Squat', 'Push-up', 'Bench Press', 'Cable Row', 'Plank']);
    expect(screen.getByRole('button', { name: 'Goblet Squat, Quads · Glutes, Beginner, Dumbbells, camera coaching' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bench Press, Chest, Intermediate, Barbell + Bench' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cable Row, Back · Lats, Advanced, Cable machine' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plank, Core, Beginner, Bodyweight' })).toBeTruthy();
  });

  it('narrows by search and says so when nothing matches', async () => {
    await render(<ExerciseLibrary exercises={exercises} onOpen={() => {}} />);
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'press');
    expect(rowNames().filter((n) => exercises.some((e) => e.name === n))).toEqual(['Bench Press']);
    expect(count('All exercises · 1 exercise')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'zzz');
    expect(screen.getByText('No matches')).toBeTruthy();
    expect(screen.getByText('Try other filters or a different word.')).toBeTruthy();
    expect(count('All exercises · 0 exercises')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Bench Press/ })).toBeNull();
  });

  it('filters by muscle and clears on a second tap or All', async () => {
    await render(<ExerciseLibrary exercises={exercises} onOpen={() => {}} />);
    await fireEvent.press(radios('Filter by muscle').getByRole('radio', { name: 'Chest' }));
    // Chest as a primary or secondary muscle: push-up and bench press.
    expect(count('Chest · 2 exercises')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Goblet Squat/ })).toBeNull();

    await fireEvent.press(radios('Filter by muscle').getByRole('radio', { name: 'Chest' }));
    expect(count('All exercises · 5 exercises')).toBeTruthy();

    await fireEvent.press(radios('Filter by muscle').getByRole('radio', { name: 'Core' }));
    expect(count('Core · 3 exercises')).toBeTruthy();
    await fireEvent.press(radios('Filter by muscle').getByRole('radio', { name: 'All' }));
    expect(count('All exercises · 5 exercises')).toBeTruthy();
  });

  it('offers equipment from the real data: tokens, human labels, and Bodyweight', async () => {
    await render(<ExerciseLibrary exercises={exercises} onOpen={() => {}} />);
    const names = radios('Filter by equipment')
      .getAllByRole('radio')
      .map((r) => r.props.accessibilityLabel);
    expect(names).toEqual(['All', 'Bodyweight', 'Barbell', 'Bench', 'Cable machine', 'Dumbbells', 'Kettlebell', 'Machines']);
  });

  it('filters by equipment when ANY alternative uses it', async () => {
    await render(<ExerciseLibrary exercises={exercises} onOpen={() => {}} />);
    const eq = radios('Filter by equipment');

    // Dumbbells is the 1st alternative of the goblet squat and the 2nd of the bench press.
    await fireEvent.press(eq.getByRole('radio', { name: 'Dumbbells' }));
    expect(rowNames().filter((n) => exercises.some((e) => e.name === n))).toEqual(['Goblet Squat', 'Bench Press']);

    await fireEvent.press(eq.getByRole('radio', { name: 'Machines' }));
    expect(rowNames().filter((n) => exercises.some((e) => e.name === n))).toEqual(['Cable Row']);

    // Bodyweight: an alternative that names it, or an empty one.
    await fireEvent.press(eq.getByRole('radio', { name: 'Bodyweight' }));
    expect(rowNames().filter((n) => exercises.some((e) => e.name === n))).toEqual(['Push-up', 'Plank']);
    expect(screen.getByRole('radio', { name: 'Bodyweight', checked: true })).toBeTruthy();
  });

  it('filters by level, listing only the levels that exist', async () => {
    await render(<ExerciseLibrary exercises={exercises} onOpen={() => {}} />);
    const lv = radios('Filter by level');
    expect(lv.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual(['All', 'Beginner', 'Intermediate', 'Advanced']);

    await fireEvent.press(lv.getByRole('radio', { name: 'Beginner' }));
    expect(rowNames().filter((n) => exercises.some((e) => e.name === n))).toEqual(['Goblet Squat', 'Push-up', 'Plank']);
    await fireEvent.press(lv.getByRole('radio', { name: 'Advanced' }));
    expect(rowNames().filter((n) => exercises.some((e) => e.name === n))).toEqual(['Cable Row']);
  });

  it('hides a level nobody has', async () => {
    await render(<ExerciseLibrary exercises={exercises.filter((e) => e.difficulty === 'beginner')} onOpen={() => {}} />);
    const lv = radios('Filter by level');
    expect(lv.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual(['All', 'Beginner']);
    expect(lv.queryByRole('radio', { name: 'Advanced' })).toBeNull();
  });

  it('combines search, muscle, equipment and level (AND) and each can be cleared', async () => {
    await render(<ExerciseLibrary exercises={exercises} onOpen={() => {}} />);
    await fireEvent.press(radios('Filter by muscle').getByRole('radio', { name: 'Chest' }));
    await fireEvent.press(radios('Filter by equipment').getByRole('radio', { name: 'Dumbbells' }));
    expect(rowNames().filter((n) => exercises.some((e) => e.name === n))).toEqual(['Bench Press']);

    await fireEvent.press(radios('Filter by level').getByRole('radio', { name: 'Beginner' }));
    expect(screen.getByText('No matches')).toBeTruthy();
    expect(count('Chest · 0 exercises')).toBeTruthy();

    // Re-tapping the level pill, then choosing All equipment, widens the list again.
    await fireEvent.press(radios('Filter by level').getByRole('radio', { name: 'Beginner' }));
    expect(count('Chest · 1 exercise')).toBeTruthy();
    await fireEvent.press(radios('Filter by equipment').getByRole('radio', { name: 'All' }));
    expect(count('Chest · 2 exercises')).toBeTruthy();

    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'push');
    expect(rowNames().filter((n) => exercises.some((e) => e.name === n))).toEqual(['Push-up']);
    await fireEvent.press(radios('Filter by level').getByRole('radio', { name: 'Advanced' }));
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('shows the equipment icon, never a clock, on the level and equipment line', async () => {
    await render(<ExerciseLibrary exercises={exercises} onOpen={() => {}} />);
    const glyph = (name: string) => String.fromCodePoint(Ionicons.glyphMap[name as keyof typeof Ionicons.glyphMap] as number);
    const opts = { includeHiddenElements: true };
    expect(screen.queryAllByText(glyph('time-outline'), opts)).toHaveLength(0);
    expect(screen.getAllByText(glyph('barbell-outline'), opts)).toHaveLength(exercises.length);
  });

  it('opens an exercise by id when its row is pressed', async () => {
    const onOpen = jest.fn();
    await render(<ExerciseLibrary exercises={exercises} onOpen={onOpen} />);
    await fireEvent.press(screen.getByRole('button', { name: /^Cable Row/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('cable_row');
  });

  it('skips the equipment and level rows for an empty library', async () => {
    await render(<ExerciseLibrary exercises={[]} onOpen={() => {}} />);
    expect(screen.queryByLabelText('Filter by equipment')).toBeNull();
    expect(screen.queryByLabelText('Filter by level')).toBeNull();
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('says Filtered, and which filters, once equipment or level narrows the list', async () => {
    await render(<ExerciseLibrary exercises={exercises} onOpen={() => {}} />);
    await fireEvent.press(radios('Filter by equipment').getByRole('radio', { name: 'Dumbbells' }));
    expect(count('Filtered · 2 exercises')).toBeTruthy();
    expect(screen.queryByText(/^All exercises/)).toBeNull();
    expect(count('Filters: Dumbbells')).toBeTruthy();

    await fireEvent.press(radios('Filter by level').getByRole('radio', { name: 'Beginner' }));
    expect(count('Filtered · 1 exercise')).toBeTruthy();
    expect(count('Filters: Dumbbells · Beginner')).toBeTruthy();

    await fireEvent.press(radios('Filter by equipment').getByRole('radio', { name: 'All' }));
    await fireEvent.press(radios('Filter by level').getByRole('radio', { name: 'All' }));
    expect(count('All exercises · 5 exercises')).toBeTruthy();
    expect(screen.queryByText(/^Filters:/)).toBeNull();
  });

  it('keeps the muscle in the heading and still names the equipment and level filters', async () => {
    await render(<ExerciseLibrary exercises={exercises} onOpen={() => {}} />);
    await fireEvent.press(radios('Filter by muscle').getByRole('radio', { name: 'Chest' }));
    await fireEvent.press(radios('Filter by level').getByRole('radio', { name: 'Intermediate' }));
    expect(count('Chest · 1 exercise')).toBeTruthy();
    expect(count('Filters: Intermediate')).toBeTruthy();
  });

  it('offers Clear filters in the empty state, which resets search and every filter', async () => {
    await render(<ExerciseLibrary exercises={exercises} onOpen={() => {}} />);
    await fireEvent.press(radios('Filter by muscle').getByRole('radio', { name: 'Chest' }));
    await fireEvent.press(radios('Filter by equipment').getByRole('radio', { name: 'Dumbbells' }));
    await fireEvent.press(radios('Filter by level').getByRole('radio', { name: 'Beginner' }));
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'zzz');
    expect(screen.getByText('No matches')).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Clear filters' }));
    expect(count('All exercises · 5 exercises')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
    expect(screen.getByLabelText('Search exercises').props.value).toBe('');
    expect(radios('Filter by muscle').getByRole('radio', { name: 'All', checked: true })).toBeTruthy();
    expect(radios('Filter by equipment').getByRole('radio', { name: 'All', checked: true })).toBeTruthy();
    expect(radios('Filter by level').getByRole('radio', { name: 'All', checked: true })).toBeTruthy();
  });

  it('offers no Clear filters when the library itself is empty', async () => {
    await render(<ExerciseLibrary exercises={[]} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Clear filters' })).toBeNull();
  });
});
