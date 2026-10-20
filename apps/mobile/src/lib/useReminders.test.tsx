import { renderHook, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { resetReminderPrefsCache, saveReminderPrefs, DEFAULT_PREFS } from './reminders';
import { useReminders } from './useReminders';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  }),
}));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

let mockStatus = 'signedIn';
jest.mock('./auth', () => ({ useAuth: () => ({ status: mockStatus }) }));
let mockHome: unknown = null;
jest.mock('./queries', () => ({
  useHome: () => ({ data: mockHome }),
  useXpEvents: () => ({ data: { events: [] } }),
}));

const schedule = Notifications.scheduleNotificationAsync as jest.Mock;
const cancel = Notifications.cancelScheduledNotificationAsync as jest.Mock;
const listScheduled = Notifications.getAllScheduledNotificationsAsync as jest.Mock;
const lastResponse = Notifications.useLastNotificationResponse as jest.Mock;

const home = (today: Partial<{ trainedToday: boolean; workoutsThisWeek: number }> = {}) => ({
  date: '2026-10-20',
  progression: { streak: { current: 4, longest: 4, activeToday: false, restDaysRemaining: null } },
  today: { suggestion: { kind: 'train' }, plannedDaysPerWeek: 4, workoutsThisWeek: 1, trainedToday: false, lastWorkout: null, ...today },
});
const tap = (route: unknown, id = 'form.reminder.workout.2099-01-01') => ({
  actionIdentifier: Notifications.DEFAULT_ACTION_IDENTIFIER,
  notification: { date: 1, request: { identifier: id, content: { data: { route } } } },
});

beforeEach(() => {
  mockStore.clear();
  resetReminderPrefsCache();
  mockStatus = 'signedIn';
  mockHome = home();
  schedule.mockClear();
  cancel.mockClear();
  listScheduled.mockReset().mockResolvedValue([]);
  lastResponse.mockReset().mockReturnValue(null);
  (router.push as jest.Mock).mockClear();
});

describe('useReminders', () => {
  it('schedules when signed in, ready and a reminder is on; not before the navigator is ready', async () => {
    await saveReminderPrefs({ ...DEFAULT_PREFS, workout: { ...DEFAULT_PREFS.workout, on: true } });
    const { rerender } = await renderHook(({ ready }: { ready: boolean }) => useReminders(ready), { initialProps: { ready: false } });
    await new Promise((r) => setTimeout(r, 20));
    expect(schedule).not.toHaveBeenCalled();
    await rerender({ ready: true });
    await waitFor(() => expect(schedule).toHaveBeenCalled());
    expect(schedule.mock.calls[0][0].identifier).toMatch(/^form\.reminder\.workout\./);
  });

  it("waits for Home's numbers rather than guess", async () => {
    mockHome = undefined;
    await saveReminderPrefs({ ...DEFAULT_PREFS, workout: { ...DEFAULT_PREFS.workout, on: true } });
    await renderHook(() => useReminders(true));
    await new Promise((r) => setTimeout(r, 20));
    expect(schedule).not.toHaveBeenCalled();
  });

  it('clears every reminder on sign-out', async () => {
    mockStatus = 'signedOut';
    listScheduled.mockResolvedValue([{ identifier: 'form.reminder.workout.2026-10-21' }]);
    await renderHook(() => useReminders(false));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('form.reminder.workout.2026-10-21'));
  });

  it('opens the right screen when a reminder is tapped, once', async () => {
    jest.useFakeTimers();
    try {
      lastResponse.mockReturnValue(tap('streak', 'form.reminder.streak.2099-01-02'));
      const { rerender } = await renderHook(() => useReminders(true));
      await jest.advanceTimersByTimeAsync(5);
      expect(router.push).toHaveBeenCalledWith('/progress/streak');
      await rerender(undefined);
      await jest.advanceTimersByTimeAsync(5);
      expect(router.push).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores taps on anything that is not one of ours, and taps before the app is ready', async () => {
    jest.useFakeTimers();
    try {
      lastResponse.mockReturnValue(tap('/admin', 'other.1'));
      await renderHook(() => useReminders(true));
      lastResponse.mockReturnValue(tap('train', 'form.reminder.workout.2099-02-02'));
      await renderHook(() => useReminders(false));
      await jest.advanceTimersByTimeAsync(5);
      expect(router.push).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});
