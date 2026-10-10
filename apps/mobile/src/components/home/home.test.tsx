import { fireEvent, render, screen } from '@testing-library/react-native';
import { accuracyLine, dailySummary, formatLitres, fuelLine, updatedAgo } from '@/lib/homeFormat';
import type { HomeViewModel } from '@/lib/types';
import { HomeView } from './HomeView';

const NOW = new Date('2026-09-27T12:00:00Z');

function vm(overrides: Partial<HomeViewModel> = {}): HomeViewModel {
  return {
    generatedAt: '2026-09-27T11:58:00Z',
    date: '2026-09-27',
    timezone: 'Europe/London',
    timezoneSource: 'stored',
    greeting: { period: 'morning', name: 'Jordan', primaryGoal: 'get_lean' },
    state: 'active',
    daysSinceLastActivity: 0,
    firstSteps: null,
    progression: {
      level: 2,
      rank: 'Rookie',
      totalXp: 150,
      xpIntoLevel: 50,
      xpForNextLevel: 182,
      fractionToNext: 0.27,
      provisionalXp: 5,
      nextRank: { name: 'Starter', minLevel: 5 },
      streak: { current: 3, longest: 5, activeToday: true, restDaysRemaining: 2 },
      trainWithinDays: 6,
      lastResetDate: null,
    },
    today: {
      suggestion: { kind: 'train', title: 'Train today', reason: '1 of 4 planned sessions done this week.' },
      plannedDaysPerWeek: 4,
      workoutsThisWeek: 1,
      trainedToday: false,
      lastWorkout: {
        localDate: '2026-09-25',
        durationMinutes: 40,
        xp: 35,
        exercises: [{ exerciseId: 'squat', name: 'Squat', sets: 3, totalReps: 24, verifiedReps: 0, bestLoadKg: 60 }],
      },
    },
    nutrition: { kcal: 640, proteinG: 48, carbsG: 70, fatG: 16, mealsLogged: 1, mealsWithFood: 1, remainingKcal: 1560, estimatedKcalShare: 0, measuredKcalShare: 1, targets: { kcal: 2200, proteinG: 130, carbsG: 250, fatG: 70, safeFloorKcal: 1400 } },
    water: { totalMl: 750, targetMl: 2450, targetBasis: 'body_weight', lastEntryId: 'w-1', entries: 2 },
    quests: {
      available: true,
      daily: [{ id: 'daily_log_meals', title: 'Log 3 meals', cadence: 'daily', periodKey: '2026-09-27', progress: 1, target: 3, xpReward: 10, completed: false }],
      weekly: [{ id: 'weekly_train', title: 'Train 4 days this week', cadence: 'weekly', periodKey: '2026-09-21', progress: 4, target: 4, xpReward: 50, completed: true }],
    },
    bodyQuest: { available: false },
    achievements: { available: false, recent: [] },
    streaks: null,
    coach: { mode: "unavailable", provider: "none" },
    errors: [],
    ...overrides,
  };
}

async function renderHome(v: HomeViewModel, props: Partial<Parameters<typeof HomeView>[0]> = {}) {
  const handlers = { onNavigate: jest.fn(), onAddWater: jest.fn(), onUndoWater: jest.fn() };
  await render(<HomeView vm={v} now={NOW} {...handlers} {...props} />);
  return handlers;
}

describe('Home formatting', () => {
  it('formats water and relative time', () => {
    expect(formatLitres(750)).toBe('750 ml');
    expect(formatLitres(2000)).toBe('2 L');
    expect(formatLitres(2450)).toBe('2.5 L');
    expect(updatedAgo('2026-09-27T11:58:00Z', NOW)).toBe('2 min ago');
    expect(updatedAgo('2026-09-27T12:00:10Z', NOW)).toBe('just now');
  });

  it('says how the day of food is going in one plain sentence, from reported values only', () => {
    const n = vm().nutrition!;
    expect(fuelLine(n)).toBe("You're 82 g short on protein, with 1,560 kcal left.");
    expect(fuelLine({ ...n, proteinG: 140 })).toBe('Protein target reached — 1,560 kcal left today.');
    expect(fuelLine({ ...n, kcal: 2500 })).toBe("You're 300 kcal over today's target.");
    expect(fuelLine({ ...n, mealsLogged: 0 })).toBe('Nothing logged yet today.');
    expect(fuelLine({ ...n, targets: null })).toBe('640 kcal so far today.');
    expect(accuracyLine(1, 0)).toBe('100% measured');
  });

  it('builds the daily summary only from reported values', () => {
    expect(dailySummary(vm())).toEqual(['640 of 2,200 kcal', '48 g protein', '750 ml water', 'no workout yet', '1/2 quests']);
    expect(dailySummary(vm({ nutrition: null, water: null, today: null, quests: null }))).toEqual([]);
  });
});

describe('HomeView', () => {
  it('shows a new user a useful first action with working CTAs', async () => {
    const { onNavigate, onAddWater } = await renderHome(
      vm({
        state: 'new',
        firstSteps: [
          { key: 'workout', done: false },
          { key: 'meal', done: false },
          { key: 'water', done: false },
        ],
      }),
    );
    expect(screen.getByText('Start here')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Log your first workout' }));
    expect(onNavigate).toHaveBeenLastCalledWith('train');
    await fireEvent.press(screen.getByRole('button', { name: 'Log a meal' }));
    expect(onNavigate).toHaveBeenLastCalledWith('eat');
    await fireEvent.press(screen.getByRole('button', { name: 'Drink a glass of water (250 ml)' }));
    expect(onAddWater).toHaveBeenCalledWith(250);
  });

  it('keeps the first-steps checklist after the first action, with done steps checked off (regression)', async () => {
    const { onNavigate } = await renderHome(
      vm({
        state: 'active',
        firstSteps: [
          { key: 'workout', done: false },
          { key: 'meal', done: false },
          { key: 'water', done: true },
        ],
      }),
    );
    expect(screen.getByText('Start here')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Drink a glass of water (250 ml)' }).props.accessibilityState).toMatchObject({ checked: true, disabled: true });
    await fireEvent.press(screen.getByRole('button', { name: 'Log a meal' }));
    expect(onNavigate).toHaveBeenLastCalledWith('eat');
  });

  it('welcomes back a returning user', async () => {
    await renderHome(vm({ state: 'returning', daysSinceLastActivity: 5 }));
    expect(screen.getByText(/Welcome back — it's been 5 days/)).toBeTruthy();
    expect(screen.queryByText('Start here')).toBeNull();
  });

  it('routes every CTA to a real tab', async () => {
    const { onNavigate } = await renderHome(vm());
    await fireEvent.press(screen.getByRole('button', { name: 'Start workout' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    await fireEvent.press(screen.getByRole('button', { name: 'View all' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Open profile' }));
    expect(onNavigate.mock.calls.map((c) => c[0])).toEqual(['train', 'eat', 'progress', 'profile']);
  });

  it('shows real numbers: greeting, level, macros, water, previous session, quests', async () => {
    await renderHome(vm());
    expect(screen.getByText('Good morning, Jordan')).toBeTruthy();
    expect(screen.getByText('Level 2 · Rookie')).toBeTruthy();
    expect(screen.getByText('640')).toBeTruthy();
    expect(screen.getByText('750 ml')).toBeTruthy();
    expect(screen.getByText(/Squat: 3 sets, 24 reps · top 60 kg/)).toBeTruthy();
    expect(screen.getByText('Log 3 meals')).toBeTruthy();
    expect(screen.getByLabelText('Train 4 days this week: 4 of 4, completed, 50 XP')).toBeTruthy();
    expect(screen.getByText('132 XP to level 3 · Starter at level 5')).toBeTruthy();
  });

  it('shows the level line and warns only when progress is at risk', async () => {
    await renderHome(vm());
    expect(screen.getByText('LEVEL 2 — 50 / 182 XP')).toBeTruthy();
    expect(screen.queryByText(/to keep Level 2/)).toBeNull();
  });

  it('warns when a workout is needed today to keep the level', async () => {
    await renderHome(vm({ progression: { ...vm().progression!, trainWithinDays: 1 } }));
    expect(screen.getByText('Train today to keep Level 2.')).toBeTruthy();
  });

  it('adds and undoes water', async () => {
    const { onAddWater, onUndoWater } = await renderHome(vm());
    await fireEvent.press(screen.getByRole('button', { name: '+500 ml' }));
    expect(onAddWater).toHaveBeenCalledWith(500);
    await fireEvent.press(screen.getByRole('button', { name: 'Undo last water entry' }));
    expect(onUndoWater).toHaveBeenCalledWith('w-1');
  });

  it('isolates a failed section and flags stale data', async () => {
    await renderHome(vm({ water: null, errors: ['water'] }), { refreshFailed: true });
    expect(screen.getByText("Couldn't load water")).toBeTruthy();
    expect(screen.getByText(/Couldn't refresh — showing data from 2 min ago/)).toBeTruthy();
    expect(screen.getByText('Level 2 · Rookie')).toBeTruthy(); // the rest still renders
  });

  it('never shows a coach surface or fake achievements when they are not available', async () => {
    await renderHome(vm());
    expect(screen.queryByText('AI Coach')).toBeNull();
    expect(screen.getByText(/Body Quest and Achievements aren't available yet/)).toBeTruthy();
  });

  it('shows milestones from real recognition data, and isolates a failure', async () => {
    const live = vm({
      bodyQuest: { available: true, stage: 'foundation', highestStage: 'foundation', overall: 46, statsWithData: 5, nextStage: 'builder' },
      achievements: { available: true, unlocked: 2, total: 7, recent: [{ id: 'first_workout', title: 'First Workout', unlockedAt: '2026-09-26T10:00:00Z' }], next: { id: 'form_master', title: 'Form Master', progress: 40, target: 100 } },
      streaks: { workout: { current: 3, longest: 5 }, nutrition: { current: 0, longest: 0, available: true }, quest: { current: 1, longest: 2 }, weekly: { current: 3, longest: 3, target: 4, metThisWeek: false } },
    });
    const { onNavigate } = await renderHome(live);
    expect(screen.getByText('Milestones')).toBeTruthy();
    expect(screen.getByLabelText('Stage 2 of 5: Foundation')).toBeTruthy();
    expect(screen.getByText('2 of 7 achievements')).toBeTruthy();
    expect(screen.getByText('Next up: Form Master · 40 of 100')).toBeTruthy();
    expect(screen.getByText('3 weeks on plan')).toBeTruthy();
    expect(screen.queryByText(/aren't available yet/)).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Body Quest: Foundation. Open details' }));
    expect(onNavigate).toHaveBeenLastCalledWith('progress');
  });

  it("says when milestones couldn't load instead of pretending they don't exist", async () => {
    await renderHome(vm({ errors: ['recognition'] }));
    expect(screen.getByText("Couldn't load your milestones")).toBeTruthy();
    expect(screen.queryByText(/aren't available yet/)).toBeNull();
  });

  it("shows today's coaching tip with its provider, and opens the coach", async () => {
    const onOpenCoach = jest.fn();
    const onOpenRoute = jest.fn();
    const tip = {
      topic: 'home' as const,
      message: 'You still have 82 g of protein to go today.',
      category: 'nutrition' as const,
      priority: 'normal' as const,
      evidence: [{ fact: 'nutrition.today.proteinRemainingG', claim: 'Protein left today (g)', value: '82' }],
      actions: [{ id: 'log_food', label: 'Log a meal', route: '/eat/add' }],
      confidence: 'high' as const,
      generatedAt: '2026-09-27T11:58:00Z',
      provider: { type: 'deterministic_fallback' as const, name: 'FORM rules' },
      degraded: null,
    };
    await renderHome(vm({ coach: { mode: 'deterministic_fallback', provider: 'FORM rules' } }), { coach: { response: tip, loading: false, failed: false }, onOpenCoach, onOpenRoute });
    expect(screen.getByText("Today's tip")).toBeTruthy();
    expect(screen.getByText('Rule-based tip')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Log a meal' }));
    expect(onOpenRoute).toHaveBeenCalledWith('/eat/add');
    await fireEvent.press(screen.getByRole('button', { name: 'Ask the coach' }));
    expect(onOpenCoach).toHaveBeenCalled();
  });

  it('shows no coach surface when the coach is switched off', async () => {
    await renderHome(vm(), { coach: { response: null, loading: false, failed: true } });
    expect(screen.queryByText('Coach')).toBeNull();
  });

  it("says so when the coach couldn't load, without blocking Home", async () => {
    await renderHome(vm({ coach: { mode: 'real_ai', provider: 'Claude' } }), { coach: { response: null, loading: false, failed: true } });
    expect(screen.getByText(/The coach couldn't load right now/)).toBeTruthy();
    expect(screen.getByText('Level 2 · Rookie')).toBeTruthy();
  });

  it('suggests recovery without a training CTA after serious pain', async () => {
    await renderHome(vm({ today: { ...vm().today!, suggestion: { kind: 'recover', title: 'Rest and recover', reason: 'You reported serious pain recently.' } } }));
    expect(screen.getByText('Rest and recover')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
  });
});

describe('Home hierarchy and header chips', () => {
  it('reaches every area from its own section, and the streak and level chips open progress', async () => {
    const { onNavigate } = await renderHome(vm());
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onNavigate).toHaveBeenLastCalledWith('eat');
    await fireEvent.press(screen.getByRole('button', { name: 'Start workout' }));
    expect(onNavigate).toHaveBeenLastCalledWith('train');
    await fireEvent.press(screen.getByRole('button', { name: '3 day streak. Open progress' }));
    expect(onNavigate).toHaveBeenLastCalledWith('progress');
    expect(screen.getByRole('button', { name: 'Level 2, Rookie. Open progress' })).toBeTruthy();
    // No shortcut tiles duplicating the tab bar.
    expect(screen.queryByRole('button', { name: 'Go to Train' })).toBeNull();
  });

  it('puts nutrition (with water) before goals, level and milestones', async () => {
    await renderHome(vm());
    const headers = screen.getAllByRole('header').map((h) => String(h.props.children));
    const at = (t: string) => headers.findIndex((h) => h.includes(t));
    expect(at("Today's fuel")).toBeGreaterThan(-1);
    expect(at("Today's fuel")).toBeLessThan(at("Today's goals"));
    expect(at("Today's goals")).toBeLessThan(at('Your level'));
    expect(screen.getByLabelText(/^Water: /)).toBeTruthy();
  });
});
