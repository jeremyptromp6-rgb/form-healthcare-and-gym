import { act, renderHook } from '@testing-library/react-native';
import { COUNT_STEP_MS, READY_HOLD_MS, useGetReady } from './useGetReady';

const run = (ms: number) => act(async () => jest.advanceTimersByTime(ms));

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('get-ready countdown', () => {
  it('counts 3, 2, 1, shows a brief ready, then finishes once', async () => {
    const onDone = jest.fn();
    const { result, rerender } = await renderHook(({ ready }: { ready: boolean }) => useGetReady(ready, false, onDone), { initialProps: { ready: false } });
    expect(result.current).toBeNull(); // not ready yet: nothing to count down to
    await rerender({ ready: true });
    const seen: unknown[] = [result.current];
    for (let i = 0; i < 3; i++) {
      await run(COUNT_STEP_MS);
      seen.push(result.current);
    }
    expect(seen).toEqual([3, 2, 1, 'ready']);
    expect(onDone).not.toHaveBeenCalled();
    await run(READY_HOLD_MS);
    expect(result.current).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('with reduce motion there are no numbers: only a brief ready, then done', async () => {
    const onDone = jest.fn();
    const { result } = await renderHook(() => useGetReady(true, true, onDone));
    expect(result.current).toBe('ready');
    await run(READY_HOLD_MS - 100);
    expect(result.current).toBe('ready');
    expect(onDone).not.toHaveBeenCalled();
    await run(200);
    expect(result.current).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('runs once per visit: becoming ready again afterwards does not repeat it', async () => {
    const onDone = jest.fn();
    const { result, rerender } = await renderHook(({ ready }: { ready: boolean }) => useGetReady(ready, true, onDone), { initialProps: { ready: true } });
    await run(READY_HOLD_MS + 100);
    expect(onDone).toHaveBeenCalledTimes(1);
    await rerender({ ready: false });
    await rerender({ ready: true });
    expect(result.current).toBeNull();
    await run(READY_HOLD_MS * 3);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('losing ready mid-way cancels it and it starts over when ready again', async () => {
    const onDone = jest.fn();
    const { result, rerender } = await renderHook(({ ready }: { ready: boolean }) => useGetReady(ready, false, onDone), { initialProps: { ready: true } });
    await run(COUNT_STEP_MS * 2);
    expect(result.current).toBe(1);
    await rerender({ ready: false });
    expect(result.current).toBeNull();
    await run(COUNT_STEP_MS * 10);
    expect(onDone).not.toHaveBeenCalled();
    await rerender({ ready: true });
    expect(result.current).toBe(3);
  });

  it('leaving the screen mid-way never calls done', async () => {
    const onDone = jest.fn();
    const { unmount } = await renderHook(() => useGetReady(true, false, onDone));
    await run(COUNT_STEP_MS);
    await unmount();
    await run(COUNT_STEP_MS * 10);
    expect(onDone).not.toHaveBeenCalled();
  });
});
