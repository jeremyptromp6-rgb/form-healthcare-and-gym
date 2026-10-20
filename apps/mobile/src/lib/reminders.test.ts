import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';
import { DEFAULT_PREFS, formatTime, inQuietHours, loadReminderPrefs, onWorkoutCompleted, outOfQuietHours, planReminders, requestReminderPermission, resetReminderPrefsCache, routeForReminder, saveReminderPrefs, syncReminders, weekXpFrom, type ReminderContext, type ReminderPrefs } from './reminders';
import type { XpLedgerEntry } from './types';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn((k: string) => Promise.resolve(mockStore.get(k) ?? null)),
  setItemAsync: jest.fn((k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  }),
}));

const mocked = <T extends (...a: never[]) => unknown>(fn: T) => fn as unknown as jest.Mock;
const schedule = mocked(Notifications.scheduleNotificationAsync);
const cancel = mocked(Notifications.cancelScheduledNotificationAsync);
const listScheduled = mocked(Notifications.getAllScheduledNotificationsAsync);
const getPerms = mocked(Notifications.getPermissionsAsync);
const askPerms = mocked(Notifications.requestPermissionsAsync);

// Tuesday 20 Oct 2026, 09:00 (device-local).
const TUE = new Date(2026, 9, 20, 9, 0);
const SUN = new Date(2026, 9, 25, 9, 0);

const ctx = (over: Partial<ReminderContext> = {}): ReminderContext => ({ trainedToday: false, streak: 0, workoutsThisWeek: 1, plannedDaysPerWeek: 4, todayKind: 'train', weekXp: 0, ...over });
const prefs = (over: { [K in keyof ReminderPrefs]?: Partial<ReminderPrefs[K]> } = {}): ReminderPrefs => ({
  workout: { ...DEFAULT_PREFS.workout, ...over.workout },
  streak: { ...DEFAULT_PREFS.streak, ...over.streak },
  weekly: { ...DEFAULT_PREFS.weekly, ...over.weekly },
  rest: { ...DEFAULT_PREFS.rest, ...over.rest },
  photo: { ...DEFAULT_PREFS.photo, ...over.photo },
});
const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

beforeEach(() => {
  mockStore.clear();
  resetReminderPrefsCache();
  schedule.mockClear();
  cancel.mockClear();
  listScheduled.mockReset().mockResolvedValue([]);
  getPerms.mockReset().mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
  askPerms.mockReset().mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
});

describe('times and quiet hours', () => {
  it('knows the 22:00-08:00 window and moves times out of it', () => {
    expect(inQuietHours(22 * 60)).toBe(true);
    expect(inQuietHours(7 * 60 + 59)).toBe(true);
    expect(inQuietHours(8 * 60)).toBe(false);
    expect(inQuietHours(21 * 60 + 59)).toBe(false);
    expect(formatTime(outOfQuietHours(6 * 60))).toBe('08:00');
    expect(formatTime(outOfQuietHours(23 * 60))).toBe('21:59');
    expect(formatTime(outOfQuietHours(18 * 60))).toBe('18:00');
  });

  it('never plans a reminder inside quiet hours', () => {
    for (const time of ['00:30', '06:00', '22:00', '23:30']) {
      const plan = planReminders(prefs({ workout: { on: true, time } }), ctx(), TUE);
      expect(plan.length).toBeGreaterThan(0);
      for (const r of plan) expect(inQuietHours(r.at.getHours() * 60 + r.at.getMinutes())).toBe(false);
    }
  });
});

describe('workout reminder', () => {
  it('defaults to 18:00 every day for the coming week, with the planned copy and a stable id', () => {
    const plan = planReminders(prefs({ workout: { on: true } }), ctx(), TUE);
    expect(plan).toHaveLength(7);
    expect(plan.every((r) => hm(r.at) === '18:00')).toBe(true);
    expect(plan[0]).toMatchObject({ id: 'form.reminder.workout.2026-10-20', title: 'Time to train', body: "Today's plan is ready.", route: 'train' });
  });

  it('honours the chosen time and days (0 = Monday)', () => {
    const plan = planReminders(prefs({ workout: { on: true, time: '08:30', days: [0, 2] } }), ctx(), TUE);
    expect(plan.map((r) => `${r.id.slice(-10)} ${hm(r.at)}`)).toEqual(['2026-10-21 08:30', '2026-10-26 08:30']);
  });

  it('skips today once trained, on a rest day, or after the time has passed', () => {
    const on = prefs({ workout: { on: true } });
    expect(planReminders(on, ctx({ trainedToday: true }), TUE)).toHaveLength(6);
    expect(planReminders(on, ctx({ todayKind: 'rest_suggested' }), TUE)).toHaveLength(6);
    expect(planReminders(on, ctx(), new Date(2026, 9, 20, 19, 0))).toHaveLength(6);
  });

  it('stops for the rest of the week once the weekly goal is met, then resumes next week', () => {
    const plan = planReminders(prefs({ workout: { on: true } }), ctx({ workoutsThisWeek: 4, plannedDaysPerWeek: 4 }), TUE);
    expect(plan.map((r) => r.id.slice(-10))).toEqual(['2026-10-26']);
  });

  it('plans nothing when switched off or no day is picked', () => {
    expect(planReminders(prefs(), ctx(), TUE)).toEqual([]);
    expect(planReminders(prefs({ workout: { on: true, days: [] } }), ctx(), TUE)).toEqual([]);
  });
});

describe('streak at risk', () => {
  const on = prefs({ streak: { on: true } });

  it('nudges at 20:00 today only, with an active streak of 2+ and no workout yet', () => {
    const plan = planReminders(on, ctx({ streak: 5 }), TUE);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ id: 'form.reminder.streak.2026-10-20', kind: 'streak', route: 'streak' });
    expect(hm(plan[0].at)).toBe('20:00');
    expect(plan[0].title).toContain('5-day streak');
  });

  it.each([
    ['a streak of 1', { streak: 1 }],
    ['no streak', { streak: 0 }],
    ['already trained today', { streak: 5, trainedToday: true }],
    ['a rest day in the plan', { streak: 5, todayKind: 'rest_suggested' as const }],
  ])('stays quiet with %s', (_name, over) => {
    expect(planReminders(on, ctx(over), TUE)).toEqual([]);
  });

  it('is gone once the evening time has passed', () => {
    expect(planReminders(on, ctx({ streak: 5 }), new Date(2026, 9, 20, 20, 30))).toEqual([]);
  });
});

describe('weekly recap and rest day', () => {
  it('is Sunday 18:00 with the week computed at plan time', () => {
    const plan = planReminders(prefs({ weekly: { on: true } }), ctx({ workoutsThisWeek: 3, weekXp: 240 }), TUE);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ id: 'form.reminder.weekly.2026-10-25', route: 'progress', body: 'Your week: 3 workouts, 240 XP — see your progress' });
    expect(hm(plan[0].at)).toBe('18:00');
  });

  it('reads naturally for one workout and for none', () => {
    const weekly = prefs({ weekly: { on: true } });
    expect(planReminders(weekly, ctx({ workoutsThisWeek: 1, weekXp: 80 }), TUE)[0].body).toBe('Your week: 1 workout, 80 XP — see your progress');
    expect(planReminders(weekly, ctx({ workoutsThisWeek: 0 }), TUE)[0].body).toMatch(/fresh week/);
  });

  it('sums this week\'s XP from the ledger', () => {
    const e = (localDate: string | null, xp: number) => ({ localDate, xp }) as XpLedgerEntry;
    expect(weekXpFrom([e('2026-10-19', 50), e('2026-10-20', 30), e('2026-10-18', 999), e(null, 5), e('2026-10-21', -10)], TUE)).toBe(80);
  });

  it('rest-day message is off by default, and only sent on a rest day when asked for', () => {
    expect(planReminders(prefs(), ctx({ todayKind: 'rest_suggested' }), TUE)).toEqual([]);
    const plan = planReminders(prefs({ rest: { on: true } }), ctx({ todayKind: 'rest_suggested' }), TUE);
    expect(plan.map((r) => r.kind)).toEqual(['rest']);
    expect(planReminders(prefs({ rest: { on: true } }), ctx({ todayKind: 'train' }), TUE)).toEqual([]);
  });
});

describe('at most two a day', () => {
  it('keeps the most useful two and never two within an hour', () => {
    // Sunday 09:00: streak 20:00, recap 18:00, workout 17:30 (too close to the recap).
    const all = prefs({ workout: { on: true, time: '17:30', days: [6] }, streak: { on: true }, weekly: { on: true } });
    const plan = planReminders(all, ctx({ streak: 4 }), SUN);
    expect(plan.map((r) => r.kind)).toEqual(['weekly', 'streak']);
  });

  it('caps a crowded day at two even when spaced out', () => {
    const all = prefs({ workout: { on: true, time: '12:00', days: [6] }, streak: { on: true }, weekly: { on: true }, rest: { on: true } });
    const plan = planReminders(all, ctx({ streak: 4 }), SUN);
    expect(plan).toHaveLength(2);
    expect(plan.map((r) => r.kind)).toEqual(['weekly', 'streak']);
  });

  it('never exceeds two on any day across the window', () => {
    const all = prefs({ workout: { on: true }, streak: { on: true }, weekly: { on: true }, rest: { on: true } });
    const plan = planReminders(all, ctx({ streak: 9 }), SUN);
    const perDay = new Map<string, number>();
    for (const r of plan) perDay.set(r.id.slice(-10), (perDay.get(r.id.slice(-10)) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(2);
  });
});

describe('monthly progress photo', () => {
  // Wednesday 28 Oct 2026: the 1st of November (a Sunday) is inside the coming week.
  const WED = new Date(2026, 9, 28, 9, 0);
  const photos = (plan: ReturnType<typeof planReminders>) => plan.filter((r) => r.kind === 'photo');

  it('is off unless asked for', () => {
    expect(DEFAULT_PREFS.photo.on).toBe(false);
    expect(planReminders(prefs(), ctx(), WED)).toEqual([]);
  });

  it('is one reminder, on the 1st at 10:00, opening Body progress', () => {
    const plan = photos(planReminders(prefs({ photo: { on: true } }), ctx(), WED));
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ id: 'form.reminder.photo.2026-11-01', route: 'bodyProgress', title: 'Monthly progress photo' });
    expect(plan[0]!.at).toEqual(new Date(2026, 10, 1, 10, 0));
  });

  it('plans nothing in a week that has no 1st in it', () => {
    expect(planReminders(prefs({ photo: { on: true } }), ctx(), TUE)).toEqual([]);
  });

  it('stays inside the two-a-day cap: on a busy 1st the workout nudge gives way, never the cap', () => {
    // Sunday 1 Nov: weekly recap 18:00 + photo 10:00 + a daily workout reminder would be three.
    const plan = planReminders(prefs({ workout: { on: true, time: '12:00' }, weekly: { on: true }, photo: { on: true } }), ctx({ plannedDaysPerWeek: null }), WED);
    const sunday = plan.filter((r) => r.at.getDate() === 1);
    expect(sunday).toHaveLength(2);
    expect(sunday.map((r) => r.kind).sort()).toEqual(['photo', 'weekly']);
  });

  it('is scheduled on the device like the others, and cancelled when switched off', async () => {
    await syncReminders(prefs({ photo: { on: true } }), ctx(), WED);
    expect(schedule).toHaveBeenCalledWith(expect.objectContaining({ identifier: 'form.reminder.photo.2026-11-01', content: expect.objectContaining({ data: { route: 'bodyProgress' } }) }));
    listScheduled.mockResolvedValue([{ identifier: 'form.reminder.photo.2026-11-01' }]);
    await syncReminders(prefs(), ctx(), WED);
    expect(cancel).toHaveBeenCalledWith('form.reminder.photo.2026-11-01');
  });

  it('older saved choices without the photo reminder load as off', async () => {
    mockStore.set('form.reminders.v1', JSON.stringify({ workout: { on: true, time: '07:00', days: [0] } }));
    resetReminderPrefsCache();
    expect((await loadReminderPrefs()).photo).toEqual({ on: false });
  });
});

describe('deep links', () => {
  it('maps a reminder tap to its screen and ignores anything else', () => {
    expect(routeForReminder({ route: 'train' })).toBe('/train');
    expect(routeForReminder({ route: 'streak' })).toBe('/progress/streak');
    expect(routeForReminder({ route: 'progress' })).toBe('/progress');
    expect(routeForReminder({ route: 'bodyProgress' })).toBe('/progress/body-progress');
    expect(routeForReminder({ route: '/admin' })).toBeNull();
    expect(routeForReminder({ route: 'constructor' })).toBeNull();
    expect(routeForReminder(null)).toBeNull();
    expect(routeForReminder({})).toBeNull();
  });
});

describe('scheduling on the device', () => {
  it('schedules the plan with stable ids and cancels reminders no longer wanted', async () => {
    listScheduled.mockResolvedValue([{ identifier: 'form.reminder.workout.2026-10-20' }, { identifier: 'form.reminder.streak.2026-10-20' }, { identifier: 'someone.else' }]);
    const plan = await syncReminders(prefs({ workout: { on: true, days: [2] } }), ctx(), TUE);
    expect(plan.map((p) => p.id)).toEqual(['form.reminder.workout.2026-10-21']);
    expect(schedule).toHaveBeenCalledTimes(1);
    const req = schedule.mock.calls[0][0];
    expect(req).toMatchObject({ identifier: 'form.reminder.workout.2026-10-21', content: { title: 'Time to train', data: { route: 'train' } }, trigger: { type: 'date', channelId: 'reminders' } });
    expect(req.trigger.date).toEqual(new Date(2026, 9, 21, 18, 0));
    expect(cancel.mock.calls.map((c) => c[0]).sort()).toEqual(['form.reminder.streak.2026-10-20', 'form.reminder.workout.2026-10-20']);
  });

  it('schedules nothing, and clears ours, without permission or with everything off', async () => {
    getPerms.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
    listScheduled.mockResolvedValue([{ identifier: 'form.reminder.workout.2026-10-20' }]);
    expect(await syncReminders(prefs({ workout: { on: true } }), ctx(), TUE)).toEqual([]);
    expect(schedule).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledWith('form.reminder.workout.2026-10-20');
    getPerms.mockResolvedValue({ granted: true, canAskAgain: true, status: 'granted' });
    expect(await syncReminders(prefs(), ctx(), TUE)).toEqual([]);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("cancels today's workout, streak and rest reminders when a workout is completed", async () => {
    await onWorkoutCompleted(TUE);
    expect(cancel.mock.calls.map((c) => c[0]).sort()).toEqual(['form.reminder.rest.2026-10-20', 'form.reminder.streak.2026-10-20', 'form.reminder.workout.2026-10-20']);
  });

  it('asks the system for permission only when requested, and reports a blocked one without asking', async () => {
    expect(await requestReminderPermission()).toBe('granted');
    expect(askPerms).not.toHaveBeenCalled();
    getPerms.mockResolvedValue({ granted: false, canAskAgain: true, status: 'undetermined' });
    askPerms.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
    expect(await requestReminderPermission()).toBe('blocked');
    expect(askPerms).toHaveBeenCalledTimes(1);
    getPerms.mockResolvedValue({ granted: false, canAskAgain: false, status: 'denied' });
    expect(await requestReminderPermission()).toBe('blocked');
    expect(askPerms).toHaveBeenCalledTimes(1);
  });
});

describe('saved choices', () => {
  it('start off, persist locally, and survive a restart; junk in storage falls back to defaults', async () => {
    expect(await loadReminderPrefs()).toEqual(DEFAULT_PREFS);
    await saveReminderPrefs(prefs({ workout: { on: true, time: '07:00' }, weekly: { on: true } }));
    resetReminderPrefsCache();
    const again = await loadReminderPrefs();
    expect(again.workout).toMatchObject({ on: true, time: '07:00' });
    expect(again.weekly.on).toBe(true);
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith('form.reminders.v1', expect.any(String));

    mockStore.set('form.reminders.v1', JSON.stringify({ workout: { on: 'yes', time: '99:99', days: [9, 'x', 2] } }));
    resetReminderPrefsCache();
    const junk = await loadReminderPrefs();
    expect(junk.workout).toEqual({ on: false, time: '18:00', days: [2] });
  });
});
