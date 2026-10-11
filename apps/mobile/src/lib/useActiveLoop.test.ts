import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { useActiveLoop } from './useActiveLoop';

// test/setup.ts mocks reduced motion on; this flag lets each test choose.
let mockReduce = false;
jest.mock('@/lib/a11y', () => ({ useReducedMotion: () => mockReduce }));

describe('useActiveLoop', () => {
  let emit: (s: AppStateStatus) => void;
  let remove: jest.Mock;
  let add: jest.SpyInstance;

  beforeEach(() => {
    mockReduce = false;
    emit = () => {};
    remove = jest.fn();
    add = jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
      emit = fn as (s: AppStateStatus) => void;
      return { remove } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('is true while the app is active and motion is allowed', async () => {
    const { result } = await renderHook(() => useActiveLoop());
    expect(result.current).toBe(true);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it('turns false in the background and true again when active', async () => {
    const { result } = await renderHook(() => useActiveLoop());
    await act(async () => emit('background'));
    expect(result.current).toBe(false);
    await act(async () => emit('active'));
    expect(result.current).toBe(true);
  });

  it('is false under reduced motion', async () => {
    mockReduce = true;
    const { result } = await renderHook(() => useActiveLoop());
    expect(result.current).toBe(false);
  });

  it('is false when disabled', async () => {
    const { result } = await renderHook(() => useActiveLoop(false));
    expect(result.current).toBe(false);
  });

  it('removes its listener exactly once on unmount', async () => {
    const { unmount } = await renderHook(() => useActiveLoop());
    expect(remove).not.toHaveBeenCalled();
    await unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it('counts an undefined currentState as active', async () => {
    const original = Object.getOwnPropertyDescriptor(AppState, 'currentState');
    Object.defineProperty(AppState, 'currentState', { value: undefined, configurable: true, writable: true });
    try {
      const { result } = await renderHook(() => useActiveLoop());
      expect(result.current).toBe(true);
    } finally {
      if (original) Object.defineProperty(AppState, 'currentState', original);
    }
  });
});
