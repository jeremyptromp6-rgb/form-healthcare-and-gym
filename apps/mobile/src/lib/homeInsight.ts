import type { CoachResponse, HomeViewModel, PlannedExercise, WorkoutPlan } from './types';

/**
 * Home shows at most one insight. This picks it, in a fixed order of importance, from values the
 * server already reported: recovery first, then a form/range hold on a planned lift (naming it),
 * then the coach's tip, then one plain line about protein or the streak. Nothing true to say, or
 * nothing to say yet: nothing.
 */
export type HomeInsight =
  | { kind: 'recovery'; text: string }
  | { kind: 'form'; text: string; exerciseId: string }
  | { kind: 'coach'; response: CoachResponse }
  | { kind: 'data'; text: string; action: { label: string; route: 'eat' | 'streak' } };

export interface HomeInsightInput {
  today: HomeViewModel['today'];
  plan?: WorkoutPlan | null;
  nutrition: HomeViewModel['nutrition'];
  streak?: number | null;
  /** Today's coaching tip, once it has arrived. */
  coach?: CoachResponse | null;
  /** The tip is still on its way: say nothing rather than flash a line that is about to be replaced. */
  coachPending?: boolean;
}

const HOLD_TEXT: Record<'hold_for_form' | 'hold_for_rom', (name: string) => string> = {
  hold_for_form: (name) => `${name}: keep the weight where it is and make every rep clean before adding more.`,
  hold_for_rom: (name) => `${name}: keep the weight where it is and work on full range of motion before adding more.`,
};

/** The first planned lift being held back for form or range, with the plan's own note when it has one. */
export function heldExercise(plan: WorkoutPlan | null | undefined): { exercise: PlannedExercise; text: string } | null {
  const ex = plan?.exercises.find((e) => e.progression === 'hold_for_form' || e.progression === 'hold_for_rom');
  if (!ex || (ex.progression !== 'hold_for_form' && ex.progression !== 'hold_for_rom')) return null;
  const note = ex.note?.trim();
  return { exercise: ex, text: note ? (note.includes(ex.name) ? note : `${ex.name}: ${note}`) : HOLD_TEXT[ex.progression](ex.name) };
}

export function pickHomeInsight(input: HomeInsightInput): HomeInsight | null {
  const { today, plan, nutrition, streak, coach, coachPending } = input;

  // 1 · Pain or recovery: the one thing that should change what you do today.
  if (today?.suggestion.kind === 'recover') return { kind: 'recovery', text: today.suggestion.reason };

  // 2 · A lift held back for form or range, named.
  const held = heldExercise(plan);
  if (held) return { kind: 'form', text: held.text, exerciseId: held.exercise.exerciseId };

  // 3 · The coach's tip.
  if (coach) return { kind: 'coach', response: coach };
  if (coachPending) return null;

  // 4 · One data line.
  const t = nutrition?.targets;
  if (nutrition && t && nutrition.mealsLogged > 0) {
    const left = Math.round(t.proteinG - nutrition.proteinG);
    if (left > 0) return { kind: 'data', text: left <= 40 ? `${left} g of protein to go today. One good meal closes most of it.` : `${left} g of protein to go today.`, action: { label: 'Add a meal', route: 'eat' } };
  }
  // Never on a rest day: planned rest keeps the streak safe, and the Today card says to rest.
  if (streak != null && streak >= 2 && today && !today.trainedToday && today.suggestion.kind === 'train') {
    return { kind: 'data', text: `${streak}-day streak. A workout today keeps it going.`, action: { label: 'See your streak', route: 'streak' } };
  }
  return null;
}
