import { act, renderHook } from '@testing-library/react-native';
import { useAfterDelay, useDebouncedValue } from './timing';

describe('useDebouncedValue', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('returns the first value at once and only follows later ones after a pause', async () => {
    const { result, rerender } = await renderHook(({ v }: { v: string }) => useDebouncedValue(v, 250), { initialProps: { v: 'a' } });
    expect(result.current).toBe('a');

    await rerender({ v: 'ab' });
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    await rerender({ v: 'abc' }); // typing on resets the wait
    await act(async () => {
      jest.advanceTimersByTime(200);
    });
    expect(result.current).toBe('a');

    await act(async () => {
      jest.advanceTimersByTime(60);
    });
    expect(result.current).toBe('abc');
  });
});

describe('useAfterDelay', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('turns true after the delay while active, and resets when no longer active', async () => {
    const { result, rerender } = await renderHook(({ on }: { on: boolean }) => useAfterDelay(on, 6000), { initialProps: { on: true } });
    expect(result.current).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(5999);
    });
    expect(result.current).toBe(false);
    await act(async () => {
      jest.advanceTimersByTime(2);
    });
    expect(result.current).toBe(true);

    await rerender({ on: false });
    expect(result.current).toBe(false);
  });
});
