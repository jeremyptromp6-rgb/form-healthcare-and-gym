import { fireEvent, render, screen } from '@testing-library/react-native';
import { accuracyLine, dailySummary, formatLitres, fuelLine, updatedAgo } from '@/lib/homeFormat';
import type { HomeViewModel, PlannedExercise, WorkoutPlan } from '@/lib/types';
import type { StepsCardState } from '@/lib/useSteps';
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

const ex = (over: Partial<PlannedExercise> = {}): PlannedExercise => ({ exerciseId: 'squat', name: 'Squat', sets: 3, targetReps: { min: 8, max: 10 }, targetLoadKg: 60, restSeconds: 90, progression: 'repeat', note: null, cameraVerifiable: true, ...over });
const plan = (exercises: PlannedExercise[] = [ex(), ex({ exerciseId: 'row', name: 'Row' })]): WorkoutPlan => ({ generator: { id: 'g', version: 1 }, date: '2026-09-27', title: 'Lower body day', focus: 'lower', exercises, estimatedMinutes: 45, notes: [] });

/** Everything past the primary card and the insight lives behind "More from today"; most tests want it open. */
async function renderHome(v: HomeViewModel, props: Partial<Parameters<typeof HomeView>[0]> = {}, expand = true) {
  const handlers = { onNavigate: jest.fn(), onAddWater: jest.fn(), onUndoWater: jest.fn() };
  await render(<HomeView vm={v} now={NOW} {...handlers} {...props} />);
  if (expand) await fireEvent.press(screen.getByRole('button', { name: 'More from today' }));
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

  it("doesn't dwell on a coach that couldn't load: the insight falls back to one plain data line, and Home carries on", async () => {
    await renderHome(vm({ coach: { mode: 'real_ai', provider: 'Claude' } }), { coach: { response: null, loading: false, failed: true } });
    expect(screen.queryByText(/The coach couldn't load/)).toBeNull();
    expect(screen.getByText(/82 g of protein to go today/)).toBeTruthy();
    expect(screen.getByText('Level 2 · Rookie')).toBeTruthy();
  });

  it('suggests recovery without a training CTA after serious pain', async () => {
    await renderHome(vm({ today: { ...vm().today!, suggestion: { kind: 'recover', title: 'Rest and recover', reason: 'You reported serious pain recently.' } } }));
    expect(screen.getByText('Rest and recover')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
  });
});

describe('Home primary card: what should I do today?', () => {
  it('names the workout, its length and focus, a real reason, and offers Start workout', async () => {
    const { onNavigate } = await renderHome(vm(), { plan: plan([ex({ progression: 'increase_load' }), ex({ exerciseId: 'row', name: 'Row' })]) }, false);
    expect(screen.getByText('Lower body day')).toBeTruthy();
    expect(screen.getByText('~45 min · 2 exercises · Lower body')).toBeTruthy();
    expect(screen.getByText('For getting lean · session 2 of 4 this week · 1 lift is ready to progress.')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /Start workout|Resume workout/ })).toHaveLength(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Start workout' }));
    expect(onNavigate).toHaveBeenLastCalledWith('train');
  });

  it('becomes Resume workout while a session is open, and routes to the workout', async () => {
    const { onNavigate } = await renderHome(vm(), { plan: plan(), openSession: { status: 'active' } }, false);
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Resume workout' }));
    expect(onNavigate).toHaveBeenLastCalledWith('workout');
  });

  it('says a paused workout is paused', async () => {
    await renderHome(vm(), { plan: plan(), openSession: { status: 'paused' } }, false);
    expect(screen.getByText(/Your workout is paused/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Resume workout' })).toBeTruthy();
  });

  it('falls back to the server suggestion when the plan did not load', async () => {
    await renderHome(vm(), { plan: null }, false);
    expect(screen.getByText('Train today')).toBeTruthy();
    expect(screen.getByText('1 of 4 planned sessions done this week.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start workout' })).toBeTruthy();
  });

  it('rest day: states it plainly and keeps training optional', async () => {
    const { onNavigate } = await renderHome(vm({ today: { ...vm().today!, suggestion: { kind: 'rest_suggested', title: 'Rest day', reason: "You've trained 4 days this week." } } }), { plan: plan() }, false);
    expect(screen.getByText('Rest day')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start workout' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Train anyway' }));
    expect(onNavigate).toHaveBeenLastCalledWith('train');
  });

  it('recovery: no training button, and the reason is the one insight', async () => {
    await renderHome(vm({ today: { ...vm().today!, suggestion: { kind: 'recover', title: 'Rest and recover', reason: 'You reported serious pain recently.' } } }), { plan: plan() }, false);
    expect(screen.getByText('Rest and recover')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /workout|Train anyway/ })).toBeNull();
    expect(screen.getAllByText('You reported serious pain recently.')).toHaveLength(1);
  });

  it('done for today: celebrates without another button', async () => {
    await renderHome(vm({ today: { ...vm().today!, trainedToday: true, suggestion: { kind: 'done_today', title: 'Workout done', reason: 'Nicely done today.' } } }), { plan: plan() }, false);
    expect(screen.getByText('Workout done')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Start workout|Resume workout|Train anyway/ })).toBeNull();
  });

  it('a new user sees Start workout, then the first steps right under it, with the stats behind More', async () => {
    await renderHome(vm({ state: 'new', firstSteps: [{ key: 'workout', done: false }, { key: 'meal', done: false }, { key: 'water', done: false }] }), { plan: plan() }, false);
    const text = JSON.stringify(screen.toJSON());
    expect(text.indexOf('Lower body day')).toBeGreaterThan(-1);
    expect(text.indexOf('Lower body day')).toBeLessThan(text.indexOf('Start here'));
    expect(text.indexOf('Start here')).toBeLessThan(text.indexOf('More from today'));
    expect(screen.queryByText("Today's fuel")).toBeNull();
  });
});

describe('Home insight and the More disclosure', () => {
  const tip = {
    topic: 'home' as const,
    message: 'Sleep is where the gains land. Aim for a steady bedtime.',
    category: 'recovery' as const,
    priority: 'normal' as const,
    evidence: [],
    actions: [],
    confidence: 'high' as const,
    generatedAt: '2026-09-27T11:58:00Z',
    provider: { type: 'deterministic_fallback' as const, name: 'FORM rules' },
    degraded: null,
  };
  const coachOn = vm({ coach: { mode: 'deterministic_fallback', provider: 'FORM rules' } });

  it('shows exactly one insight: a held lift beats the coach tip, and names the exercise', async () => {
    await renderHome(coachOn, { plan: plan([ex({ progression: 'hold_for_form', note: null })]), coach: { response: tip, loading: false, failed: false } }, false);
    expect(screen.getByText(/Squat: keep the weight where it is and make every rep clean/)).toBeTruthy();
    expect(screen.queryByText("Today's tip")).toBeNull();
    expect(screen.queryByText(/protein to go/)).toBeNull();
  });

  it('shows the coach tip when nothing outranks it, and no data line next to it', async () => {
    await renderHome(coachOn, { plan: plan(), coach: { response: tip, loading: false, failed: false } }, false);
    expect(screen.getByText("Today's tip")).toBeTruthy();
    expect(screen.queryByText(/protein to go/)).toBeNull();
  });

  it('shows nothing extra while the coach tip is on its way', async () => {
    await renderHome(coachOn, { plan: plan(), coach: { response: null, loading: true, failed: false } }, false);
    expect(screen.queryByText(/protein to go/)).toBeNull();
    expect(screen.queryByText('Worth knowing')).toBeNull();
  });

  it('keeps the stats wall closed until More from today is opened, with a one-line summary', async () => {
    await renderHome(vm(), { plan: plan() }, false);
    const more = screen.getByRole('button', { name: 'More from today' });
    expect(more.props.accessibilityState).toMatchObject({ expanded: false });
    expect(screen.getByText(/640 of 2,200 kcal/)).toBeTruthy();
    expect(screen.queryByText("Today's fuel")).toBeNull();
    expect(screen.queryByLabelText(/^Protein today/)).toBeNull();
    await fireEvent.press(more);
    expect(screen.getByText("Today's fuel")).toBeTruthy();
    expect(screen.getByLabelText(/^Protein today/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More from today' }).props.accessibilityState).toMatchObject({ expanded: true });
  });

  it('keeps the refresh-failed banner and the returning welcome outside the disclosure', async () => {
    await renderHome(vm({ state: 'returning', daysSinceLastActivity: 6 }), { refreshFailed: true, plan: plan() }, false);
    expect(screen.getByText(/Couldn't refresh/)).toBeTruthy();
    expect(screen.getByText(/Welcome back — it's been 6 days/)).toBeTruthy();
  });
});

describe('Home hierarchy and header chips', () => {
  it('reaches every area from its own section, and the streak and level chips open progress', async () => {
    const { onNavigate } = await renderHome(vm());
    await fireEvent.press(screen.getByRole('button', { name: 'Log food' }));
    expect(onNavigate).toHaveBeenLastCalledWith('eat');
    await fireEvent.press(screen.getByRole('button', { name: 'Start workout' }));
    expect(onNavigate).toHaveBeenLastCalledWith('train');
    await fireEvent.press(screen.getByRole('button', { name: '3 day streak. Open streak and season' }));
    expect(onNavigate).toHaveBeenLastCalledWith('streak');
    expect(screen.getByRole('button', { name: 'Level 2, Rookie. Open progress' })).toBeTruthy();
    // No shortcut tiles duplicating the tab bar.
    expect(screen.queryByRole('button', { name: 'Go to Train' })).toBeNull();
  });

  it('opens on the home photo with compact Protein, Water and Streak tiles', async () => {
    await renderHome(vm());
    expect(JSON.stringify(screen.toJSON())).toContain('assets/hero/home.jpg');
    expect(screen.getByLabelText('Protein today: 48 grams of 130')).toBeTruthy();
    expect(screen.getByLabelText('Water today, 0.8 of 2.5 litres')).toBeTruthy();
    expect(screen.getAllByRole('button', { name: '3 day streak. Open streak and season' })).toHaveLength(1);
  });

  it('leaves out a tile whose data is missing', async () => {
    await renderHome(vm({ water: null, errors: ['water'] }));
    expect(screen.queryByLabelText(/^Water today/)).toBeNull();
    expect(screen.getByLabelText(/^Protein today/)).toBeTruthy();
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

describe('Home last session in display units', () => {
  it('keeps 60 kg as 60 kg for a metric user', async () => {
    await renderHome(vm(), { units: 'metric' });
    expect(screen.getByText(/Squat: 3 sets, 24 reps · top 60 kg/)).toBeTruthy();
  });

  it('shows the top load in pounds for an imperial user (60 kg is 132.3 lb)', async () => {
    await renderHome(vm(), { units: 'imperial' });
    expect(screen.getByText(/Squat: 3 sets, 24 reps · top 132.3 lb/)).toBeTruthy();
    expect(screen.queryByText(/ kg/)).toBeNull();
  });
});

describe('Steps card', () => {
  const steps = (over: Partial<StepsCardState> = {}): StepsCardState => ({
    status: 'ready',
    today: 6500,
    goal: 8000,
    xpToday: 6,
    weekAverage: 7100,
    busy: false,
    onConnect: jest.fn(),
    onInstall: jest.fn(),
    onOpenSettings: jest.fn(),
    ...over,
  });

  it('shows today against the goal, the XP it is worth and the week average', async () => {
    await renderHome(vm(), { steps: steps() });
    expect(screen.getByText('Steps')).toBeOnTheScreen();
    expect(screen.getByText('6,500')).toBeOnTheScreen();
    expect(screen.getByText('of 8,000 steps')).toBeOnTheScreen();
    expect(screen.getByText('+6 XP today (1 per 1,000, up to 10)')).toBeOnTheScreen();
    expect(screen.getByText('7-day average: 7,100 steps')).toBeOnTheScreen();
    expect(screen.getByLabelText('Steps of daily goal').props.accessibilityValue).toMatchObject({ now: 81 });
    expect(screen.queryByRole('button', { name: 'Connect steps' })).toBeNull();
  });

  it('offers one Connect steps button until steps are connected', async () => {
    const s = steps({ status: 'needs_permission', today: null });
    await renderHome(vm(), { steps: s });
    await fireEvent.press(screen.getByRole('button', { name: 'Connect steps' }));
    expect(s.onConnect).toHaveBeenCalledTimes(1);
  });

  it('links to Google Play when Health Connect is missing', async () => {
    const s = steps({ status: 'needs_install', today: null });
    await renderHome(vm(), { steps: s });
    await fireEvent.press(screen.getByRole('button', { name: 'Get Health Connect' }));
    expect(s.onInstall).toHaveBeenCalledTimes(1);
  });

  it('explains a refusal and points to Health Connect settings', async () => {
    const s = steps({ status: 'denied', today: null });
    await renderHome(vm(), { steps: s });
    expect(screen.getByText("FORM doesn't have access to your steps. You can switch it on in Health Connect.")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Open Health Connect' }));
    expect(s.onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it.each(['unavailable', 'checking'] as const)('is hidden while %s', async (status) => {
    await renderHome(vm(), { steps: steps({ status, today: null }) });
    expect(screen.queryByText('Steps')).toBeNull();
    await renderHome(vm());
    expect(screen.queryByText('Steps')).toBeNull();
  });
});
