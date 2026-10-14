import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Animated } from 'react-native';
import { RestTimerPill } from './RestTimerPill';
import { SetRow, SetTableHeader, type SetRowProps } from './SetRow';

// Tests run with reduced motion on (test/setup.ts); the animation test turns it off per test.
let mockReduce = true;
jest.mock('@/lib/a11y', () => ({ ...jest.requireActual('@/lib/a11y'), useReducedMotion: () => mockReduce }));

// The column captions are hidden from screen readers (each field has its own label).
const hid = { includeHiddenElements: true };
const base: SetRowProps = { number: 2, state: 'queued', loadable: true, previous: '12 × 10', kg: null, reps: null };

// @testing-library/react-native v14: render and events are async.
describe('SetRow', () => {
  beforeEach(() => {
    mockReduce = true;
  });

  it('edits weight and reps, reporting clamped numbers as they are typed and again on blur', async () => {
    const onChangeKg = jest.fn();
    const onChangeReps = jest.fn();
    await render(<SetRow {...base} state="active" kgValue={20} repsValue={8} onChangeKg={onChangeKg} onChangeReps={onChangeReps} />);
    const kg = screen.getByLabelText('Set 2 weight in kilograms');
    const reps = screen.getByLabelText('Set 2 reps');
    expect(kg.props.value).toBe('20');
    expect(reps.props.value).toBe('8');

    await fireEvent.changeText(kg, '5000');
    expect(onChangeKg).toHaveBeenLastCalledWith(1000); // reported per keystroke, already clamped
    expect(kg.props.value).toBe('5000'); // the field keeps what was typed until it is committed
    await fireEvent(kg, 'blur');
    expect(onChangeKg).toHaveBeenLastCalledWith(1000);
    expect(screen.getByLabelText('Set 2 weight in kilograms').props.value).toBe('1000');

    await fireEvent.changeText(reps, '9999');
    await fireEvent(reps, 'blur');
    expect(onChangeReps).toHaveBeenLastCalledWith(200);

    await fireEvent.changeText(kg, '22,5');
    await fireEvent(kg, 'submitEditing');
    expect(onChangeKg).toHaveBeenLastCalledWith(22.5);

    await fireEvent.changeText(reps, '-3');
    await fireEvent(reps, 'blur');
    expect(onChangeReps).toHaveBeenLastCalledWith(0);
  });

  it('reports each parseable keystroke at once and keeps the typed text while the parent echoes it back', async () => {
    const onChangeKg = jest.fn();
    function Parent() {
      const [kg, setKg] = useState(20);
      return <SetRow {...base} state="active" kgValue={kg} repsValue={8} onChangeKg={(v) => { onChangeKg(v); setKg(v); }} />;
    }
    await render(<Parent />);
    const input = () => screen.getByLabelText('Set 2 weight in kilograms');
    await fireEvent.changeText(input(), '22.');
    expect(onChangeKg).toHaveBeenLastCalledWith(22);
    expect(input().props.value).toBe('22.'); // not reformatted to "22" mid-typing
    await fireEvent.changeText(input(), '22.5');
    expect(onChangeKg).toHaveBeenLastCalledWith(22.5);
    expect(input().props.value).toBe('22.5');
    expect(onChangeKg.mock.calls.map((c) => c[0])).toEqual([22, 22.5]);
    await fireEvent.changeText(input(), '0');
    expect(onChangeKg).toHaveBeenLastCalledWith(0);
    expect(input().props.value).toBe('0');
    await fireEvent.changeText(input(), '');
    expect(onChangeKg).toHaveBeenCalledTimes(3); // an empty field is not a number: nothing reported
    expect(input().props.value).toBe('');
  });

  it('replaces the typed text when the number is changed from outside, such as a stepper', async () => {
    const { rerender } = await render(<SetRow {...base} state="active" kgValue={20} repsValue={8} />);
    await fireEvent.changeText(screen.getByLabelText('Set 2 weight in kilograms'), '22.');
    await rerender(<SetRow {...base} state="active" kgValue={23} repsValue={8} />);
    expect(screen.getByLabelText('Set 2 weight in kilograms').props.value).toBe('23');
  });

  it('puts back the last value when the text is not a number', async () => {
    const onChangeReps = jest.fn();
    await render(<SetRow {...base} state="active" repsValue={8} onChangeReps={onChangeReps} />);
    const reps = screen.getByLabelText('Set 2 reps');
    await fireEvent.changeText(reps, '');
    await fireEvent(reps, 'blur');
    expect(onChangeReps).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Set 2 reps').props.value).toBe('8');
  });

  it('completes the set from the check button, which is blocked while busy', async () => {
    const onComplete = jest.fn();
    await render(<SetRow {...base} state="active" kgValue={20} repsValue={8} onComplete={onComplete} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Complete set 2' }));
    expect(onComplete).toHaveBeenCalledTimes(1);

    await render(<SetRow {...base} state="active" kgValue={20} repsValue={8} onComplete={onComplete} busy completeLabel="Log set 2" />);
    const busyBtn = screen.getByRole('button', { name: 'Log set 2' });
    expect(busyBtn.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    await fireEvent.press(busyBtn);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('logs what was typed when the check is tapped without the fields ever blurring', async () => {
    const onComplete = jest.fn();
    const onChangeKg = jest.fn();
    const onChangeReps = jest.fn();
    await render(<SetRow {...base} state="active" kgValue={20} repsValue={8} onChangeKg={onChangeKg} onChangeReps={onChangeReps} onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByLabelText('Set 2 weight in kilograms'), '27,5');
    await fireEvent.changeText(screen.getByLabelText('Set 2 reps'), '12');
    await fireEvent.press(screen.getByRole('button', { name: 'Complete set 2' }));
    expect(onChangeKg).toHaveBeenCalledWith(27.5);
    expect(onChangeReps).toHaveBeenCalledWith(12);
    expect(onComplete).toHaveBeenCalledWith({ kg: 27.5, reps: 12 });
  });

  it('clamps typed values before completing', async () => {
    const onComplete = jest.fn();
    await render(<SetRow {...base} state="active" kgValue={20} repsValue={8} onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByLabelText('Set 2 weight in kilograms'), '5000');
    await fireEvent.changeText(screen.getByLabelText('Set 2 reps'), '999');
    await fireEvent.press(screen.getByRole('button', { name: 'Complete set 2' }));
    expect(onComplete).toHaveBeenCalledWith({ kg: 1000, reps: 200 });
  });

  it('falls back to the current values when the typed text is not a number', async () => {
    const onComplete = jest.fn();
    const onChangeKg = jest.fn();
    const onChangeReps = jest.fn();
    await render(<SetRow {...base} state="active" kgValue={20} repsValue={8} onChangeKg={onChangeKg} onChangeReps={onChangeReps} onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByLabelText('Set 2 weight in kilograms'), 'abc');
    await fireEvent.changeText(screen.getByLabelText('Set 2 reps'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Complete set 2' }));
    expect(onChangeKg).not.toHaveBeenCalled();
    expect(onChangeReps).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith({ kg: 20, reps: 8 });
  });

  it('reports kg as null when the exercise is not loadable', async () => {
    const onComplete = jest.fn();
    await render(<SetRow {...base} loadable={false} state="active" repsValue={8} onComplete={onComplete} />);
    await fireEvent.changeText(screen.getByLabelText('Set 2 reps'), '10');
    await fireEvent.press(screen.getByRole('button', { name: 'Complete set 2' }));
    expect(onComplete).toHaveBeenCalledWith({ kg: null, reps: 10 });
  });

  it('shows a done row with values, a verified badge and a working delete', async () => {
    const onDelete = jest.fn();
    await render(<SetRow {...base} state="done" kg="22.5" reps="10" onDelete={onDelete} verified={{ label: '10 reps verified' }} />);
    expect(screen.getByText('22.5')).toBeTruthy();
    expect(screen.getByText('10')).toBeTruthy();
    expect(screen.getByText('12 × 10')).toBeTruthy();
    expect(screen.getByText('10 reps verified')).toBeTruthy();
    expect(screen.getByLabelText('Set 2 done')).toBeTruthy();
    expect(screen.queryByLabelText('Set 2 reps')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete set 2' }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('shows a queued row as plain text with no inputs or buttons', async () => {
    await render(<SetRow {...base} kg="20" reps="8–12" />);
    expect(screen.getByText('8–12')).toBeTruthy();
    expect(screen.getByText('20')).toBeTruthy();
    expect(screen.queryByLabelText('Set 2 reps')).toBeNull();
    expect(screen.queryByLabelText('Set 2 weight in kilograms')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('leaves out the weight column when the exercise is not loadable', async () => {
    await render(
      <>
        <SetTableHeader loadable={false} />
        <SetRow {...base} loadable={false} state="active" repsValue={10} />
      </>,
    );
    expect(screen.queryByText('KG', hid)).toBeNull();
    expect(screen.getByText('REPS', hid)).toBeTruthy();
    expect(screen.queryByLabelText('Set 2 weight in kilograms')).toBeNull();
    expect(screen.getByLabelText('Set 2 reps')).toBeTruthy();
  });

  it('shows all four column captions when loadable', async () => {
    await render(<SetTableHeader loadable />);
    for (const t of ['SET', 'PREVIOUS', 'KG', 'REPS']) expect(screen.getByText(t, hid)).toBeTruthy();
  });

  describe('completion animation', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(async () => {
      // Flush leftover animation frames inside act so their state updates are not reported as stray.
      await act(async () => {
        jest.runOnlyPendingTimers();
      });
      jest.useRealTimers();
    });

    it('runs when motion is allowed and finishes cleanly', async () => {
      mockReduce = false;
      const { rerender } = await render(<SetRow {...base} state="active" kgValue={20} repsValue={8} />);
      const timing = jest.spyOn(Animated, 'timing');
      await rerender(<SetRow {...base} state="done" kg="20" reps="8" />);
      await act(async () => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.getByLabelText('Set 2 done')).toBeTruthy();
      expect(timing).toHaveBeenCalled();
      timing.mockRestore();
    });

    it('does not start any animation with reduced motion on', async () => {
      mockReduce = true;
      const timing = jest.spyOn(Animated, 'timing');
      const { rerender } = await render(<SetRow {...base} state="active" kgValue={20} repsValue={8} />);
      await rerender(<SetRow {...base} state="done" kg="20" reps="8" />);
      expect(timing).not.toHaveBeenCalled();
      timing.mockRestore();
    });

    it('animates only the active to done change, not a row that mounts done', async () => {
      mockReduce = false;
      const timing = jest.spyOn(Animated, 'timing');
      await render(<SetRow {...base} state="done" kg="20" reps="8" />);
      expect(timing).not.toHaveBeenCalled();
      timing.mockRestore();
    });
  });
});

describe('RestTimerPill', () => {
  // The SetRow animation tests above leave motion switched on. Reset it, or the pill's progress bar animates on real
  // timers and its frames land after the test, outside act().
  beforeEach(() => {
    mockReduce = true;
  });

  it('shows the time and wires +15, +30 and Skip', async () => {
    const onAdd = jest.fn();
    const onSkip = jest.fn();
    await render(<RestTimerPill remainingSeconds={75} totalSeconds={90} onAdd={onAdd} onSkip={onSkip} />);
    expect(screen.getByText('1:15')).toBeTruthy();
    expect(screen.getByLabelText('75 seconds of rest left')).toBeTruthy();
    expect(JSON.stringify(screen.toJSON())).toContain('progressbar');
    await fireEvent.press(screen.getByRole('button', { name: '+15 s' }));
    expect(onAdd).toHaveBeenLastCalledWith(15);
    await fireEvent.press(screen.getByRole('button', { name: '+30 s' }));
    expect(onAdd).toHaveBeenLastCalledWith(30);
    await fireEvent.press(screen.getByRole('button', { name: 'Skip rest' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('omits the progress bar when the total is unknown, and is not a live region', async () => {
    await render(<RestTimerPill remainingSeconds={30} onAdd={jest.fn()} onSkip={jest.fn()} />);
    expect(JSON.stringify(screen.toJSON())).not.toContain('progressbar');
    expect(screen.getByLabelText('30 seconds of rest left').props.accessibilityLiveRegion).toBeUndefined();
  });
});

describe('SetRow warm-ups and previous values', () => {
  it('shows a W instead of the number on a warm-up row and names it so it never shares a label with a working set', async () => {
    await render(<SetRow {...base} number={1} warmup state="done" kg="20" reps="10" kgValue={20} repsValue={10} onDelete={jest.fn()} />);
    expect(screen.getByText('W')).toBeTruthy();
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.getByLabelText('Set 1 (warm-up) done')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete set 1 (warm-up)' })).toBeTruthy();
  });

  it('turns the number into a switch on the active row when the owner handles it', async () => {
    const onToggleWarmup = jest.fn();
    await render(<SetRow {...base} number={1} state="active" kgValue={20} repsValue={8} onToggleWarmup={onToggleWarmup} />);
    const sw = screen.getByRole('switch', { name: 'Warm-up for set 1' });
    expect(sw.props.accessibilityState).toMatchObject({ checked: false });
    await fireEvent.press(sw);
    expect(onToggleWarmup).toHaveBeenCalledTimes(1);
  });

  it('has no switch on queued rows or without a handler', async () => {
    await render(<SetRow {...base} state="active" kgValue={20} repsValue={8} />);
    expect(screen.queryByRole('switch')).toBeNull();
  });

  it('fills the draft from the previous value when it is tapped on the active row', async () => {
    const onUsePrevious = jest.fn();
    await render(<SetRow {...base} state="active" previous="15 × 65" kgValue={20} repsValue={8} onUsePrevious={onUsePrevious} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Use previous: 15 × 65' }));
    expect(onUsePrevious).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous value plain text when there is none, or the row is blocked', async () => {
    const { rerender } = await render(<SetRow {...base} state="active" previous="—" kgValue={20} repsValue={8} onUsePrevious={jest.fn()} />);
    expect(screen.queryByRole('button', { name: /Use previous/ })).toBeNull();
    await rerender(<SetRow {...base} state="active" previous="15 × 65" kgValue={20} repsValue={8} onUsePrevious={jest.fn()} disabled />);
    expect(screen.queryByRole('button', { name: /Use previous/ })).toBeNull();
  });

  it('lets an edit flip a set to a warm-up, reporting warmup only when it changed', async () => {
    const onEdit = jest.fn((_v: unknown, done: (e?: string | null) => void) => done());
    await render(<SetRow {...base} number={2} state="done" kg="20" reps="10" kgValue={20} repsValue={10} onEdit={onEdit} />);
    await fireEvent.press(screen.getByRole('button', { name: /^Edit set 2/ }));
    await fireEvent.press(screen.getByRole('switch', { name: 'Warm-up for set 2' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save set 2' }));
    expect(onEdit).toHaveBeenCalledWith({ kg: 20, reps: 10, warmup: true }, expect.any(Function));
  });
});
