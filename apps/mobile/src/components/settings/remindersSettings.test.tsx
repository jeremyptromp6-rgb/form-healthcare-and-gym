import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';
import { resetReminderPrefsCache } from '@/lib/reminders';
import { RemindersSettings } from './RemindersSettings';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  }),
}));

const getPerms = Notifications.getPermissionsAsync as jest.Mock;
const askPerms = Notifications.requestPermissionsAsync as jest.Mock;
const schedule = Notifications.scheduleNotificationAsync as jest.Mock;

const grantedNow = { granted: true, canAskAgain: true, status: 'granted' };
const notAskedYet = { granted: false, canAskAgain: true, status: 'undetermined' };
const blocked = { granted: false, canAskAgain: false, status: 'denied' };
const saved = () => JSON.parse(mockStore.get('form.reminders.v1') ?? '{}');

beforeEach(() => {
  mockStore.clear();
  resetReminderPrefsCache();
  getPerms.mockReset().mockResolvedValue(grantedNow);
  askPerms.mockReset().mockResolvedValue(grantedNow);
  schedule.mockClear();
});

describe('RemindersSettings', () => {
  it('shows every reminder off, and asks for nothing just by being opened', async () => {
    getPerms.mockResolvedValue(notAskedYet);
    await render(<RemindersSettings />);
    expect(await screen.findByText('Reminders')).toBeTruthy();
    for (const name of ['Workout reminder', 'Streak at risk', 'Weekly recap', 'Rest-day message', 'Progress photo reminder']) {
      expect(screen.getByRole('switch', { name }).props.value).toBe(false);
    }
    expect(askPerms).not.toHaveBeenCalled();
    expect(screen.queryByText(/off in Android settings/)).toBeNull();
  });

  it('asks for permission when a reminder is turned on, then saves it and reveals the time and days', async () => {
    getPerms.mockResolvedValue(notAskedYet);
    askPerms.mockResolvedValue(grantedNow);
    await render(<RemindersSettings />);
    await screen.findByText('Reminders');
    await fireEvent(screen.getByRole('switch', { name: 'Workout reminder' }), 'valueChange', true);
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Workout reminder' }).props.value).toBe(true));
    expect(askPerms).toHaveBeenCalledTimes(1);
    expect(saved().workout.on).toBe(true);
    expect(screen.getByText('18:00')).toBeTruthy();
    expect(screen.getByRole('checkbox', { name: 'Mon' })).toBeTruthy();
  });

  it('does not ask when turning a reminder off', async () => {
    await render(<RemindersSettings />);
    await screen.findByText('Reminders');
    await fireEvent(screen.getByRole('switch', { name: 'Weekly recap' }), 'valueChange', true);
    await waitFor(() => expect(saved().weekly.on).toBe(true));
    askPerms.mockClear();
    getPerms.mockClear();
    await fireEvent(screen.getByRole('switch', { name: 'Weekly recap' }), 'valueChange', false);
    await waitFor(() => expect(saved().weekly.on).toBe(false));
    expect(askPerms).not.toHaveBeenCalled();
    expect(getPerms).not.toHaveBeenCalled();
  });

  it('keeps the reminder off and explains when the user says no', async () => {
    getPerms.mockResolvedValue(notAskedYet);
    askPerms.mockResolvedValue(notAskedYet);
    await render(<RemindersSettings />);
    await screen.findByText('Reminders');
    await fireEvent(screen.getByRole('switch', { name: 'Streak at risk' }), 'valueChange', true);
    expect(await screen.findByText(/Allow notifications to turn reminders on/)).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Streak at risk' }).props.value).toBe(false);
    expect(mockStore.has('form.reminders.v1')).toBe(false);
  });

  it('points to Android settings when permission is blocked', async () => {
    getPerms.mockResolvedValue(blocked);
    const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await render(<RemindersSettings />);
    expect(await screen.findByText(/Notifications are off in (Android settings|your device settings)/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Open settings' }));
    expect(open).toHaveBeenCalled();
    await fireEvent(screen.getByRole('switch', { name: 'Workout reminder' }), 'valueChange', true);
    expect(askPerms).not.toHaveBeenCalled();
    expect(screen.getByRole('switch', { name: 'Workout reminder' }).props.value).toBe(false);
    open.mockRestore();
  });

  it('moves the time in half-hour steps and toggles days', async () => {
    await render(<RemindersSettings />);
    await screen.findByText('Reminders');
    await fireEvent(screen.getByRole('switch', { name: 'Workout reminder' }), 'valueChange', true);
    await screen.findByText('18:00');
    await fireEvent.press(screen.getByRole('button', { name: 'Later workout reminder time' }));
    expect(await screen.findByText('18:30')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Earlier workout reminder time' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Earlier workout reminder time' }));
    expect(await screen.findByText('17:30')).toBeTruthy();
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Sun' }));
    await waitFor(() => expect(saved().workout.days).toEqual([0, 1, 2, 3, 4, 5]));
    expect(saved().workout.time).toBe('17:30');
  });

  it('warns when a chosen time falls in quiet hours', async () => {
    await render(<RemindersSettings />);
    await screen.findByText('Reminders');
    await fireEvent(screen.getByRole('switch', { name: 'Streak at risk' }), 'valueChange', true);
    await screen.findByText('20:00');
    for (let i = 0; i < 4; i++) await fireEvent.press(screen.getByRole('button', { name: 'Later streak reminder time' }));
    expect(await screen.findByText('22:00')).toBeTruthy();
    expect(screen.getByText(/in quiet hours/)).toBeTruthy();
  });
});
