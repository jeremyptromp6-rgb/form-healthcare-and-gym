import Ionicons from '@expo/vector-icons/Ionicons';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ExerciseList, ExerciseRow, ExerciseThumbStrip, FilterChipRow, TabRow, TrendChart } from './index';

// @testing-library/react-native v14: render and events are async.
describe('ExerciseRow', () => {
  it('shows name, detail and meta and fires onPress', async () => {
    const onPress = jest.fn();
    await render(<ExerciseRow exerciseId="bicep_curl" name="Bicep Curl" detail="3 sets × 8–12 reps" meta="Last time 12 × 10" note="Slow on the way down" index={2} badge={{ label: 'Done', tone: 'primary' }} cameraVerifiable onPress={onPress} />);
    expect(screen.getByText('Bicep Curl')).toBeTruthy();
    expect(screen.getByText('3 sets × 8–12 reps')).toBeTruthy();
    expect(screen.getByText('Last time 12 × 10')).toBeTruthy();
    expect(screen.getByText('Slow on the way down')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Bicep Curl: 3 sets × 8–12 reps' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders as plain content, not a pressable, when there is no onPress', async () => {
    await render(<ExerciseRow exerciseId="push_up" name="Push-Up" detail="3 × 10" />);
    expect(screen.getByLabelText('Push-Up: 3 × 10')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    // The audit that runs after every test fails on a pressable with no role.
  });

  it('uses a custom accessibility label when given', async () => {
    await render(<ExerciseRow exerciseId="push_up" name="Push-Up" onPress={jest.fn()} accessibilityLabel="Open Push-Up" />);
    expect(screen.getByRole('button', { name: 'Open Push-Up' })).toBeTruthy();
  });

  // Icon glyphs render as a single private-use character, hidden from screen readers.
  const glyph = (name: string) => String.fromCodePoint(Ionicons.glyphMap[name as keyof typeof Ionicons.glyphMap] as number);
  const hasIcon = (name: string) => screen.queryAllByText(glyph(name), { includeHiddenElements: true }).length > 0;

  it('puts a clock before the meta line by default, and lets it be swapped or removed', async () => {
    const { rerender } = await render(<ExerciseRow exerciseId="a" name="One" meta="Last time 12 × 10" onPress={jest.fn()} />);
    expect(hasIcon('time-outline')).toBe(true);

    await rerender(<ExerciseRow exerciseId="a" name="One" meta="Beginner · Dumbbells" metaIcon="barbell-outline" onPress={jest.fn()} />);
    expect(hasIcon('barbell-outline')).toBe(true);
    expect(hasIcon('time-outline')).toBe(false);

    await rerender(<ExerciseRow exerciseId="a" name="One" meta="Beginner · Dumbbells" metaIcon={null} onPress={jest.fn()} />);
    expect(hasIcon('barbell-outline')).toBe(false);
    expect(hasIcon('time-outline')).toBe(false);
    expect(screen.getByText('Beginner · Dumbbells')).toBeTruthy();
  });
});

describe('ExerciseList', () => {
  it('puts one divider between each pair of rows', async () => {
    const { toJSON } = await render(
      <ExerciseList>
        <ExerciseRow exerciseId="a" name="One" onPress={jest.fn()} />
        <ExerciseRow exerciseId="b" name="Two" onPress={jest.fn()} />
        <ExerciseRow exerciseId="c" name="Three" onPress={jest.fn()} />
      </ExerciseList>,
    );
    // Divider is a hairline-high View with the hairline background and no children.
    const dividers = JSON.stringify(toJSON()).match(/"height":0\.?\d*,"backgroundColor":"[^"]+"/g) ?? [];
    expect(screen.getAllByRole('button')).toHaveLength(3);
    expect(dividers).toHaveLength(2);
  });
});

describe('ExerciseThumbStrip', () => {
  it('shows +N beyond max and is one labelled element', async () => {
    await render(<ExerciseThumbStrip exerciseIds={['a', 'b', 'c', 'd', 'e']} max={3} />);
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByLabelText('5 exercises')).toBeTruthy();
  });

  it('has no +N chip when everything fits, and takes a custom label', async () => {
    await render(<ExerciseThumbStrip exerciseIds={['a', 'b']} label="Today's plan" />);
    expect(screen.queryByText(/^\+/)).toBeNull();
    expect(screen.getByLabelText("Today's plan")).toBeTruthy();
  });
});

describe('FilterChipRow', () => {
  const options = [
    { value: 'chest', label: 'Chest', count: 4 },
    { value: 'legs', label: 'Legs', count: 6 },
  ];

  it('selects an option, clears on re-tap and on All', async () => {
    const onChange = jest.fn();
    const { rerender } = await render(<FilterChipRow label="Muscle" options={options} value={null} onChange={onChange} />);
    expect(screen.getByLabelText('Muscle').props.accessibilityRole).toBe('radiogroup');
    expect(screen.getByRole('radio', { name: 'All' }).props.accessibilityState).toMatchObject({ checked: true });
    await fireEvent.press(screen.getByRole('radio', { name: 'Chest' }));
    expect(onChange).toHaveBeenLastCalledWith('chest');

    await rerender(<FilterChipRow label="Muscle" options={options} value="chest" onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Chest' }).props.accessibilityState).toMatchObject({ checked: true });
    expect(screen.getByRole('radio', { name: 'All' }).props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(screen.getByRole('radio', { name: 'Chest' }));
    expect(onChange).toHaveBeenLastCalledWith(null);

    await fireEvent.press(screen.getByRole('radio', { name: 'All' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    await fireEvent.press(screen.getByRole('radio', { name: 'Legs' }));
    expect(onChange).toHaveBeenLastCalledWith('legs');
  });

  it('uses a custom label for the clear option', async () => {
    await render(<FilterChipRow label="Muscle" options={options} value={null} onChange={jest.fn()} allLabel="Every muscle" />);
    expect(screen.getByRole('radio', { name: 'Every muscle' })).toBeTruthy();
  });
});

describe('TabRow', () => {
  it('switches tab and marks the selected one', async () => {
    const onChange = jest.fn();
    const tabs = [
      { value: 'plan', label: 'Plan' },
      { value: 'history', label: 'History' },
    ];
    const { rerender } = await render(<TabRow label="Train sections" tabs={tabs} value="plan" onChange={onChange} />);
    expect(screen.getByLabelText('Train sections').props.accessibilityRole).toBe('tablist');
    expect(screen.getByRole('tab', { name: 'Plan' }).props.accessibilityState).toMatchObject({ selected: true });
    expect(screen.getByRole('tab', { name: 'History' }).props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(screen.getByRole('tab', { name: 'History' }));
    expect(onChange).toHaveBeenCalledWith('history');
    await rerender(<TabRow label="Train sections" tabs={tabs} value="history" onChange={onChange} />);
    expect(screen.getByRole('tab', { name: 'History' }).props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe('TrendChart', () => {
  const points = [
    { key: 'a', label: '1 Sep', value: 40 },
    { key: 'b', label: '8 Sep', value: 55.55 },
    { key: 'c', label: '15 Sep', value: 50 },
  ];

  it('summarises the real latest and best values and draws one bar per point', async () => {
    await render(<TrendChart title="Bench press" unit="kg" points={points} />);
    expect(screen.getByLabelText('Bench press: 3 sessions, latest 50 kg, best 55.6 kg')).toBeTruthy();
    expect(screen.getAllByTestId('trend-bar')).toHaveLength(3);
    expect(screen.getByText('15 Sep')).toBeTruthy();
  });

  it('draws nothing for no points rather than inventing values', async () => {
    await render(<TrendChart title="Bench press" unit="kg" points={[]} />);
    expect(screen.queryAllByTestId('trend-bar')).toHaveLength(0);
    expect(screen.queryByText('Bench press')).toBeNull();
  });
});
