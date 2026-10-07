import { fireEvent, render, screen } from '@testing-library/react-native';
import { degradedNote } from '@/components/coach/CoachViews';
import { ActivitySummary } from '@/components/profile/ActivitySummary';
import { scanErrorMessage } from '@/lib/scan';
import type { NotificationPreferences } from '@/lib/types';
import { ChangePasswordView, NotificationsView, PrivacyCenterView } from './SettingsViews';

const prefs = (over: Partial<NotificationPreferences> = {}): NotificationPreferences => ({
  workoutReminders: false,
  workoutReminderTime: '18:00',
  mealReminders: false,
  weeklySummary: false,
  achievementAlerts: false,
  streakAlerts: false,
  coachTips: false,
  quietHours: { start: '22:00', end: '07:00' },
  ...over,
});
const apiError = (code: string, kind = 'forbidden', message = 'x') => Object.assign(new Error(message), { code, kind, message });

describe('NotificationsView', () => {
  it('reports the device permission separately and honestly', async () => {
    const { rerender } = await render(<NotificationsView prefs={prefs()} device="unsupported" onChange={jest.fn()} saving={false} error={null} />);
    expect(screen.getByText(/This build can't send notifications yet/)).toBeTruthy();
    await rerender(<NotificationsView prefs={prefs()} device="denied" onChange={jest.fn()} saving={false} error={null} />);
    expect(screen.getByText(/Blocked on this device/)).toBeTruthy();
  });

  it('changes preferences and validates times', async () => {
    const onChange = jest.fn();
    await render(<NotificationsView prefs={prefs({ workoutReminders: true })} device="granted" onChange={onChange} saving={false} error={null} />);
    await fireEvent(screen.getByRole('switch', { name: 'Weekly summary' }), 'valueChange', true);
    expect(onChange).toHaveBeenCalledWith({ weeklySummary: true });
    await fireEvent.changeText(screen.getByLabelText('Reminder time'), '25:00');
    expect(screen.getByText('Use 24-hour HH:MM, e.g. 07:30')).toBeTruthy();
    await fireEvent(screen.getByRole('switch', { name: 'Quiet hours' }), 'valueChange', false);
    expect(onChange).toHaveBeenLastCalledWith({ quietHours: null });
  });
});

describe('ChangePasswordView', () => {
  const fill = async (current: string, next: string, again: string) => {
    await fireEvent.changeText(screen.getByLabelText('Current password'), current);
    await fireEvent.changeText(screen.getByLabelText('New password'), next);
    await fireEvent.changeText(screen.getByLabelText('New password again'), again);
  };

  it('needs a long, matching new password, and reports success', async () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    await render(<ChangePasswordView onSubmit={onSubmit} />);
    await fill('old-password', 'a-new-password', 'a-new-passwerd');
    expect(screen.getByText('Doesn’t match')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Change password' }).props.accessibilityState).toMatchObject({ disabled: true });
    await fill('old-password', 'a-new-password', 'a-new-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Change password' }));
    expect(onSubmit).toHaveBeenCalledWith('old-password', 'a-new-password');
    expect(screen.getByText(/Other devices have been signed out/)).toBeTruthy();
  });

  it('says plainly when the current password is wrong', async () => {
    await render(<ChangePasswordView onSubmit={jest.fn().mockRejectedValue(apiError('password_incorrect'))} />);
    await fill('wrong-one', 'a-new-password', 'a-new-password');
    await fireEvent.press(screen.getByRole('button', { name: 'Change password' }));
    expect(screen.getByText('Your current password is incorrect.')).toBeTruthy();
  });
});

describe('PrivacyCenterView', () => {
  it('lists what is stored in plain words, hiding empty tables', async () => {
    await render(<PrivacyCenterView counts={{ workouts: 12, food_logs: 40, coach_messages: 0, body_measurements: 3 }} onExport={jest.fn()} onDelete={jest.fn()} />);
    expect(screen.getByText('Workouts')).toBeTruthy();
    expect(screen.getByText('Food log entries')).toBeTruthy();
    expect(screen.getByText('Weight entries')).toBeTruthy();
    expect(screen.queryByText('Coach chat')).toBeNull();
    expect(screen.getByText(/Camera video never leaves your phone/)).toBeTruthy();
  });

  it('exports behind the password, honestly reporting each outcome', async () => {
    const onExport = jest.fn().mockRejectedValueOnce(apiError('password_incorrect')).mockRejectedValueOnce(apiError('rate_limited', 'rate_limited')).mockResolvedValueOnce({ where: 'download' });
    await render(<PrivacyCenterView counts={{}} onExport={onExport} onDelete={jest.fn()} />);
    const pw = screen.getAllByLabelText('Confirm with your password')[0]!;
    for (const expected of ['Password is incorrect.', /Try again in an hour/, /downloaded as a JSON file/]) {
      await fireEvent.changeText(pw, 'secret');
      await fireEvent.press(screen.getByRole('button', { name: 'Export my data' }));
      expect(screen.getByText(expected)).toBeTruthy();
    }
    expect(onExport).toHaveBeenLastCalledWith('secret');
  });

  it('deletes only after the password and typing DELETE, and never claims success on failure', async () => {
    const onDelete = jest
      .fn()
      .mockRejectedValueOnce(apiError('subscription_active', 'conflict', 'You have an active subscription.'))
      .mockRejectedValueOnce(apiError('deletion_failed', 'server'))
      .mockResolvedValueOnce(undefined);
    await render(<PrivacyCenterView counts={{}} onExport={jest.fn()} onDelete={onDelete} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete my account' }));
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret');
    expect(screen.getByRole('button', { name: 'Delete forever' }).props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await fireEvent.press(screen.getByRole('button', { name: 'Delete forever' }));
    expect(screen.getByText(/won't cancel store billing/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete anyway' }));
    expect(onDelete).toHaveBeenLastCalledWith({ password: 'secret', confirm: 'DELETE', acknowledgeSubscription: true });
    expect(screen.getByText(/couldn’t be deleted, so nothing was deleted/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete anyway' }));
    expect(onDelete).toHaveBeenCalledTimes(3);
  });
});

describe('profile summary and consent messages', () => {
  it('summarises real training and food numbers', async () => {
    await render(
      <ActivitySummary
        s={{
          workouts: { rangeDays: 30, workouts: 9, trainingDays: 8, minutes: 360, verifiedReps: 140, adherencePercent: 67 },
          nutrition: { rangeDays: 7, daysLogged: 5, daysOnTarget: 3, daysMeetingProtein: 2, estimatedPercent: 30, hasTargets: true, averageKcal: 2210 },
          recordsBeaten: 4,
        }}
      />,
    );
    expect(screen.getByText(/8 training days · 67% of your plan · 4 records beaten all time/)).toBeTruthy();
    expect(screen.getByText('2,210')).toBeTruthy();
    expect(screen.getByText('30% of logged calories are estimates.')).toBeTruthy();
  });

  it('explains consent instead of failing', () => {
    expect(scanErrorMessage({ kind: 'forbidden', code: 'scan_consent_required', message: 'x' })).toMatchObject({ needsConsent: true, message: expect.stringMatching(/FORM doesn’t keep the photo/) });
    expect(degradedNote({ provider: { type: 'deterministic_fallback', name: 'FORM rules' }, degraded: 'no_consent' })).toMatch(/never left FORM/);
  });
});
