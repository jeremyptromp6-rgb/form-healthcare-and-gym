import { renderHook, act } from '@testing-library/react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { AppState } from 'react-native';
import { useScreenAwake } from './keepAwake';

jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(), deactivateKeepAwake: jest.fn() }));

const activate = activateKeepAwakeAsync as jest.Mock;
const deactivate = deactivateKeepAwake as jest.Mock;

describe('useScreenAwake', () => {
  let appStateListener: ((s: string) => void) | null = null;
  beforeEach(() => {
    activate.mockReset();
    deactivate.mockReset().mockResolvedValue(undefined);
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
      appStateListener = fn as (s: string) => void;
      return { remove: jest.fn() } as never;
    });
  });

  it('holds the lock while mounted and releases it on unmount', async () => {
    activate.mockResolvedValue(undefined);
    const { unmount } = await renderHook(() => useScreenAwake());
    await act(async () => {});
    expect(activate).toHaveBeenCalledTimes(1);
    await unmount();
    expect(deactivate).toHaveBeenCalledWith(activate.mock.calls[0]![0]);
  });

  it('a refused wake lock (hidden page, browser policy) never throws and is never "released"', async () => {
    activate.mockRejectedValue(new Error('NotAllowedError'));
    const { unmount } = await renderHook(() => useScreenAwake());
    await act(async () => {});
    await unmount();
    expect(deactivate).not.toHaveBeenCalled(); // releasing an unheld lock is what used to throw
  });

  it('leaving before the lock is granted releases it once granted (no leaked lock)', async () => {
    let grant!: () => void;
    activate.mockReturnValue(new Promise<void>((r) => (grant = r)));
    const { unmount } = await renderHook(() => useScreenAwake());
    await unmount();
    expect(deactivate).not.toHaveBeenCalled();
    await act(async () => grant());
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it('re-acquires the lock when the app becomes active again (browsers drop it when hidden)', async () => {
    activate.mockResolvedValue(undefined);
    await renderHook(() => useScreenAwake());
    await act(async () => {});
    await act(async () => appStateListener!('active'));
    expect(activate).toHaveBeenCalledTimes(2);
  });
});
