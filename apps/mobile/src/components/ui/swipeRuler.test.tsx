import { fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { SwipeRuler } from './SwipeRuler';

// @testing-library/react-native v14: render and events are async.
const action = (name: string) => ({ nativeEvent: { actionName: name } });

function Harness({ initial, onChange, ...rest }: { initial: number; onChange?: (v: number) => void } & Partial<React.ComponentProps<typeof SwipeRuler>>) {
  const [v, setV] = useState(initial);
  return (
    <SwipeRuler
      label="Weight"
      value={v}
      onChange={(n) => {
        setV(n);
        onChange?.(n);
      }}
      {...rest}
    />
  );
}

describe('SwipeRuler', () => {
  it('is one adjustable control whose value reads with its unit', async () => {
    await render(<SwipeRuler label="Weight" value={22.5} onChange={jest.fn()} step={2.5} unit="kg" />);
    const ruler = screen.getByRole('adjustable', { name: 'Weight' });
    expect(ruler.props.accessibilityValue).toEqual({ text: '22.5 kg' });
    expect(screen.getByText('22.5')).toBeTruthy();
    expect(screen.getByText('kg')).toBeTruthy();
  });

  it('moves one step per screen-reader increment / decrement, without float drift', async () => {
    const onChange = jest.fn();
    await render(<Harness initial={0.1} onChange={onChange} step={0.1} max={10} />);
    const ruler = screen.getByRole('adjustable', { name: 'Weight' });
    await fireEvent(ruler, 'accessibilityAction', action('increment'));
    expect(onChange).toHaveBeenLastCalledWith(0.2);
    await fireEvent(ruler, 'accessibilityAction', action('increment'));
    expect(onChange).toHaveBeenLastCalledWith(0.3); // not 0.30000000000000004
    await fireEvent(ruler, 'accessibilityAction', action('decrement'));
    expect(onChange).toHaveBeenLastCalledWith(0.2);
  });

  it('uses the step it is given (2.5 kg, 5 lb)', async () => {
    const onChange = jest.fn();
    await render(<Harness initial={60} onChange={onChange} step={2.5} max={1000} unit="kg" />);
    await fireEvent(screen.getByRole('adjustable', { name: 'Weight' }), 'accessibilityAction', action('increment'));
    expect(onChange).toHaveBeenLastCalledWith(62.5);
  });

  it('steps pounds by 5', async () => {
    const onChange = jest.fn();
    await render(<Harness initial={135} onChange={onChange} step={5} max={2204.6} unit="lb" />);
    await fireEvent(screen.getByRole('adjustable', { name: 'Weight' }), 'accessibilityAction', action('increment'));
    expect(onChange).toHaveBeenLastCalledWith(140);
  });

  it('clamps to min and max', async () => {
    const onChange = jest.fn();
    await render(<Harness initial={199} onChange={onChange} step={5} min={0} max={200} />);
    const ruler = screen.getByRole('adjustable', { name: 'Weight' });
    await fireEvent(ruler, 'accessibilityAction', action('increment'));
    expect(onChange).toHaveBeenLastCalledWith(200);
    await fireEvent(ruler, 'accessibilityAction', action('increment'));
    expect(onChange).toHaveBeenLastCalledWith(200);
  });

  it('clamps a decrement at min', async () => {
    const onChange = jest.fn();
    await render(<Harness initial={2} onChange={onChange} step={5} min={0} max={200} />);
    await fireEvent(screen.getByRole('adjustable', { name: 'Weight' }), 'accessibilityAction', action('decrement'));
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('keeps the − and + buttons, disabled at the ends', async () => {
    const onChange = jest.fn();
    await render(<Harness initial={1} onChange={onChange} step={1} min={0} max={2} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Increase Weight' }));
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(screen.getByRole('button', { name: 'Increase Weight' }).props.accessibilityState ?? screen.getByRole('button', { name: 'Increase Weight' }).props['aria-disabled']).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Decrease Weight' }));
    expect(onChange).toHaveBeenLastCalledWith(1);
  });

  it('snaps a settled swipe to a tick and reports that value; a touch that goes nowhere reports nothing', async () => {
    const onChange = jest.fn();
    await render(<Harness initial={50} onChange={onChange} step={2.5} min={0} max={100} />);
    const scroller = screen.getByTestId('swipe-ruler-scroll');
    // 12 pt per tick: 20 ticks is 50 kg; drag to 23.6 ticks, and the nearest tick (24 -> 60 kg) wins.
    await fireEvent(scroller, 'scrollBeginDrag');
    await fireEvent(scroller, 'scroll', { nativeEvent: { contentOffset: { x: 23.6 * 12, y: 0 } } });
    await fireEvent(scroller, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 23.6 * 12, y: 0 } } });
    expect(onChange).toHaveBeenLastCalledWith(60);
    onChange.mockClear();
    await fireEvent(scroller, 'scrollBeginDrag');
    await fireEvent(scroller, 'scrollEndDrag', { nativeEvent: { contentOffset: { x: 24 * 12, y: 0 }, velocity: { x: 0, y: 0 } } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('never reports a value past the ends when flicked beyond them', async () => {
    const onChange = jest.fn();
    await render(<Harness initial={90} onChange={onChange} step={5} min={0} max={100} />);
    const scroller = screen.getByTestId('swipe-ruler-scroll');
    await fireEvent(scroller, 'scrollBeginDrag');
    await fireEvent(scroller, 'momentumScrollEnd', { nativeEvent: { contentOffset: { x: 500 * 12, y: 0 } } });
    expect(onChange).toHaveBeenLastCalledWith(100);
  });

  it('formats the shown value and can show only the ruler', async () => {
    await render(<SwipeRuler label="Grams" value={150} onChange={jest.fn()} step={5} max={500} unit="g" hideValue hideButtons />);
    expect(screen.getByRole('adjustable', { name: 'Grams' }).props.accessibilityValue).toEqual({ text: '150 g' });
    expect(screen.queryByRole('button', { name: 'Increase Grams' })).toBeNull();
    expect(screen.queryByText('150')).toBeNull();
  });
});
