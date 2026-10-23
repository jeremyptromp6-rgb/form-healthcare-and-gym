import { heldExercise, pickHomeInsight, type HomeInsightInput } from './homeInsight';
import type { CoachResponse, HomeViewModel, PlannedExercise, WorkoutPlan } from './types';

const ex = (over: Partial<PlannedExercise> = {}): PlannedExercise => ({ exerciseId: 'squat', name: 'Squat', sets: 3, targetReps: { min: 8, max: 10 }, targetLoadKg: 60, restSeconds: 90, progression: 'repeat', note: null, cameraVerifiable: true, ...over });
const plan = (...exercises: PlannedExercise[]): WorkoutPlan => ({ generator: { id: 'g', version: 1 }, date: '2026-09-27', title: 'Day', focus: 'full_body', exercises, estimatedMinutes: 40, notes: [] });

const today = (kind: 'train' | 'recover' = 'train', trainedToday = false): NonNullable<HomeViewModel['today']> => ({
  suggestion: { kind, title: 'T', reason: 'You reported serious pain recently.' },
  plannedDaysPerWeek: 3,
  workoutsThisWeek: 1,
  trainedToday,
  lastWorkout: null,
});
const nutrition = (proteinG: number, mealsLogged = 2): NonNullable<HomeViewModel['nutrition']> => ({
  kcal: 900, proteinG, carbsG: 90, fatG: 30, mealsLogged, mealsWithFood: mealsLogged, remainingKcal: 1000, estimatedKcalShare: 0, measuredKcalShare: 1,
  targets: { kcal: 2000, proteinG: 130, carbsG: 250, fatG: 70, safeFloorKcal: 1400 },
});
const tip = { message: 'Tip' } as CoachResponse;

const base: HomeInsightInput = { today: today(), plan: plan(ex()), nutrition: nutrition(48), streak: 3, coach: tip };

describe('pickHomeInsight precedence', () => {
  it('puts recovery above everything', () => {
    const r = pickHomeInsight({ ...base, today: today('recover'), plan: plan(ex({ progression: 'hold_for_form' })) });
    expect(r).toEqual({ kind: 'recovery', text: 'You reported serious pain recently.' });
  });

  it('then a form hold that names the exercise, using the plan note when there is one', () => {
    const noted = pickHomeInsight({ ...base, plan: plan(ex(), ex({ exerciseId: 'ohp', name: 'Overhead press', progression: 'hold_for_form', note: 'Your last sets lost depth.' })) });
    expect(noted).toEqual({ kind: 'form', text: 'Overhead press: Your last sets lost depth.', exerciseId: 'ohp' });
    const plain = pickHomeInsight({ ...base, plan: plan(ex({ progression: 'hold_for_rom' })) });
    expect(plain).toMatchObject({ kind: 'form', exerciseId: 'squat' });
    expect((plain as { text: string }).text).toMatch(/^Squat: .*range of motion/);
  });

  it('then the coach tip', () => {
    expect(pickHomeInsight(base)).toEqual({ kind: 'coach', response: tip });
  });

  it('then one data line: protein first, otherwise the streak', () => {
    const protein = pickHomeInsight({ ...base, coach: null });
    expect(protein).toMatchObject({ kind: 'data', action: { route: 'eat' } });
    expect((protein as { text: string }).text).toContain('82 g of protein');
    const streak = pickHomeInsight({ ...base, coach: null, nutrition: nutrition(140) });
    expect(streak).toMatchObject({ kind: 'data', action: { route: 'streak' } });
    expect((streak as { text: string }).text).toContain('3-day streak');
  });

  it('says nothing when there is nothing true to say', () => {
    expect(pickHomeInsight({ today: today('train', true), plan: null, nutrition: nutrition(140), streak: 1, coach: null })).toBeNull();
    expect(pickHomeInsight({ today: null, plan: null, nutrition: null })).toBeNull();
    // No protein line before anything has been logged.
    expect(pickHomeInsight({ ...base, coach: null, nutrition: nutrition(0, 0), streak: 0 })).toBeNull();
  });

  it('waits for a coach tip that is on its way instead of flashing a line it would replace', () => {
    expect(pickHomeInsight({ ...base, coach: null, coachPending: true })).toBeNull();
    expect(pickHomeInsight({ ...base, today: today('recover'), coach: null, coachPending: true })).toMatchObject({ kind: 'recovery' });
  });

  it('heldExercise ignores plans without a hold', () => {
    expect(heldExercise(plan(ex({ progression: 'increase_load' })))).toBeNull();
    expect(heldExercise(null)).toBeNull();
  });
});
