import { renderHook } from '@testing-library/react-native';
import { deviceTimeZone, useTimeZoneSync } from './timezone';

const mockMutate = jest.fn();
let mockMe: { data?: { settings: { timezone: string; timezoneAuto?: boolean } }; dataUpdatedAt: number };

jest.mock('./queries', () => ({
  useMe: () => mockMe,
  useUpdateSettings: () => ({ mutate: mockMutate }),
}));

describe('useTimeZoneSync', () => {
  const device = deviceTimeZone() ?? 'UTC';
  const other = device === 'Pacific/Auckland' ? 'Europe/London' : 'Pacific/Auckland';

  beforeEach(() => {
    mockMutate.mockReset();
    mockMe = { data: { settings: { timezone: other, timezoneAuto: true } }, dataUpdatedAt: 1 };
  });

  it('syncs the device time zone once, not on every render', async () => {
    const { rerender } = await renderHook(() => useTimeZoneSync());
    expect(mockMutate).toHaveBeenCalledTimes(1);
    expect(mockMutate.mock.calls[0]![0]).toEqual({ timezone: device });
    await rerender({});
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });

  it('retries a failed sync on the next /me refresh, but not in a tight loop', async () => {
    const { rerender } = await renderHook(() => useTimeZoneSync());
    expect(mockMutate).toHaveBeenCalledTimes(1);

    // The mutation fails.
    mockMutate.mock.calls[0]![1].onError(new Error('offline'));
    await rerender({});
    expect(mockMutate).toHaveBeenCalledTimes(1); // a plain re-render does not hammer the server

    // /me refreshes (app focus): the sync is tried again.
    mockMe = { ...mockMe, dataUpdatedAt: 2 };
    await rerender({});
    expect(mockMutate).toHaveBeenCalledTimes(2);
  });

  it('does not retry after a success (stored zone now matches)', async () => {
    const { rerender } = await renderHook(() => useTimeZoneSync());
    mockMe = { data: { settings: { timezone: device, timezoneAuto: true } }, dataUpdatedAt: 2 };
    await rerender({});
    expect(mockMutate).toHaveBeenCalledTimes(1);
  });
});
