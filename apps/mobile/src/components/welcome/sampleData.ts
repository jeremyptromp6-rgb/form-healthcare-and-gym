import { summarizeNutritionDay, type DayEntry } from '@form/domain';
import type { FoodLog, HomeViewModel, NutritionDay, Progress } from '@/lib/types';

/**
 * Sample data for showing the app's real screens without an account: the welcome page's phone
 * previews and the development design preview. Clearly an example person ("Sam"), never a user.
 */

export const SAMPLE_NOW = new Date('2026-10-05T12:00:00Z');

export const SAMPLE_HOME: HomeViewModel = {
  generatedAt: '2026-10-05T11:58:00Z',
  date: '2026-10-05',
  timezone: 'Europe/London',
  timezoneSource: 'stored',
  greeting: { period: 'afternoon', name: 'Sam', primaryGoal: 'build_muscle' },
  state: 'active',
  daysSinceLastActivity: 0,
  firstSteps: null,
  progression: {
    level: 12,
    rank: 'Athlete',
    totalXp: 4200,
    xpIntoLevel: 260,
    xpForNextLevel: 420,
    fractionToNext: 0.62,
    provisionalXp: 0,
    nextRank: { name: 'Iron', minLevel: 20 },
    streak: { current: 6, longest: 11, activeToday: true, restDaysRemaining: 2 },
    trainWithinDays: 6,
    lastResetDate: null,
  },
  today: {
    suggestion: { kind: 'train', title: 'Upper body today', reason: '2 of 4 planned sessions done this week.' },
    plannedDaysPerWeek: 4,
    workoutsThisWeek: 2,
    trainedToday: false,
    lastWorkout: null,
  },
  nutrition: { kcal: 1250, proteinG: 92, carbsG: 138, fatG: 41, mealsLogged: 2, mealsWithFood: 2, remainingKcal: 1250, estimatedKcalShare: 0, measuredKcalShare: 1, targets: { kcal: 2500, proteinG: 160, carbsG: 280, fatG: 80, safeFloorKcal: 1600 } },
  water: { totalMl: 1250, targetMl: 2800, targetBasis: 'body_weight', lastEntryId: 'w-1', entries: 3 },
  quests: {
    available: true,
    daily: [{ id: 'daily_log_meals', title: 'Log 3 meals', cadence: 'daily', periodKey: '2026-10-05', progress: 2, target: 3, xpReward: 10, completed: false }],
    weekly: [{ id: 'weekly_train', title: 'Train 4 days this week', cadence: 'weekly', periodKey: '2026-09-29', progress: 2, target: 4, xpReward: 50, completed: false }],
  },
  bodyQuest: { available: false },
  achievements: { available: false, recent: [] },
  streaks: null,
  coach: { mode: 'unavailable', provider: 'none' },
  errors: [],
} as unknown as HomeViewModel;

export const SAMPLE_PROGRESS = {
  totalXp: 4200,
  level: 12,
  rank: 'Athlete',
  xpIntoLevel: 260,
  xpForNextLevel: 420,
  fractionToNext: 0.62,
  provisionalXp: 0,
  rankLadder: [
    { name: 'Rookie', minLevel: 1, xpRequired: 0 },
    { name: 'Starter', minLevel: 5, xpRequired: 1 },
    { name: 'Athlete', minLevel: 10, xpRequired: 2 },
    { name: 'Iron', minLevel: 20, xpRequired: 3 },
    { name: 'Elite', minLevel: 30, xpRequired: 4 },
    { name: 'Master', minLevel: 45, xpRequired: 5 },
    { name: 'Champion', minLevel: 60, xpRequired: 6 },
  ],
  lifetimeXp: 4600,
  xpSources: { workouts: 3400, nutrition: 400, quests: 400, achievements: 0, decay: 0, corrections: 0 },
  nutritionXpEnabled: true,
  streak: { current: 6, longest: 11, activeToday: true, restDaysRemaining: 2 },
  consistency: { trainingDaysPerWeek: 4, decayPerMissedDay: 10, resetAfterDays: 5, trainWithinDays: 6, recovering: false, missedThisWeek: 0 },
  lastReset: null,
  recentLevelUp: null,
} as unknown as Progress;

const food = (id: string, mealType: FoodLog['mealType'], name: string, kcal: number, proteinG: number, carbsG: number, fatG: number) =>
  ({ id, mealType, name, kcal, proteinG, carbsG, fatG, loggedAt: '2026-10-05T08:00:00Z', brand: null, foodId: null, source: 'verified_database', amountMethod: 'measured', isEstimate: false, quantity: 100, unit: 'g', servingId: null, servingLabel: null, amount: 100, amountUnit: 'g', measurement: null, basis: null, scanId: null, mealId: null, mealName: null, replacedLogId: null, replacedEstimate: null, createdAt: '', updatedAt: '' }) as unknown as FoodLog;

const LOGS = [food('b', 'breakfast', 'Greek yoghurt with berries', 320, 24, 38, 8), food('l', 'lunch', 'Chicken rice bowl', 640, 48, 72, 16), food('s', 'snack', 'Banana', 105, 1, 27, 0)];
const TARGETS = { targetKcal: 2500, proteinG: 160, carbsG: 280, fatG: 80, safeFloorKcal: 1600 };
const SUMMARY = summarizeNutritionDay(LOGS as unknown as DayEntry[], TARGETS, { totalMl: 1250, targetMl: 2800 });
export const SAMPLE_DAY = {
  date: '2026-10-05',
  isToday: true,
  logs: LOGS,
  totals: SUMMARY.totals,
  byMeal: SUMMARY.byMeal,
  progress: SUMMARY.progress,
  targets: { ...TARGETS, effectiveFrom: '2026-09-01', bmrKcal: 1750, tdeeKcal: 2700, appliedGoal: 'maintain', dietStyles: [] },
  water: { totalMl: 1250, targetMl: 2800, targetBasis: 'body_weight', progress: SUMMARY.water, lastEntryId: null },
  xp: null,
} as unknown as NutritionDay;
