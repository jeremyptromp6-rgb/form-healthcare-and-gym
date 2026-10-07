import type { HomeViewModel } from './types';

/** Presentation helpers for Home. No business rules here — only wording and formatting of server values. */

export const GREETING: Record<HomeViewModel['greeting']['period'], string> = {
  morning: 'Good morning',
  afternoon: 'Good afternoon',
  evening: 'Good evening',
  night: 'Late night',
};

export function formatLitres(ml: number): string {
  return ml < 1000 ? `${ml} ml` : `${(ml / 1000).toFixed(ml % 1000 === 0 ? 0 : 1)} L`;
}

/** How trustworthy today's calories are: the measured and estimated shares. */
export function accuracyLine(measuredShare: number, estimatedShare: number): string {
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (estimatedShare > 0 && measuredShare > 0) return `${pct(measuredShare)} measured · ${pct(estimatedShare)} estimated`;
  if (estimatedShare > 0) return `${pct(estimatedShare)} estimated — weigh food for accuracy`;
  if (measuredShare > 0) return `${pct(measuredShare)} measured`;
  return 'From labels and servings';
}

/**
 * Today's food in one plain sentence, from the server's numbers only: what's left, what's short.
 * Never shaming — being over is stated, not judged.
 */
export function fuelLine(n: NonNullable<HomeViewModel['nutrition']>): string {
  if (n.mealsLogged === 0) return 'Nothing logged yet today.';
  const t = n.targets;
  if (!t) return `${n.kcal.toLocaleString()} kcal so far today.`;
  const proteinLeft = Math.round(t.proteinG - n.proteinG);
  const kcalLeft = t.kcal - n.kcal;
  if (kcalLeft < 0) return `You're ${Math.abs(kcalLeft).toLocaleString()} kcal over today's target.`;
  if (proteinLeft <= 0) return `Protein target reached — ${kcalLeft.toLocaleString()} kcal left today.`;
  return `You're ${proteinLeft} g short on protein, with ${kcalLeft.toLocaleString()} kcal left.`;
}

/** One-line summary of the day so far, built only from values the server reported. */
export function dailySummary(vm: HomeViewModel): string[] {
  const parts: string[] = [];
  if (vm.nutrition) {
    parts.push(vm.nutrition.targets ? `${vm.nutrition.kcal.toLocaleString()} of ${vm.nutrition.targets.kcal.toLocaleString()} kcal` : `${vm.nutrition.kcal.toLocaleString()} kcal`);
    parts.push(`${Math.round(vm.nutrition.proteinG)} g protein`);
  }
  if (vm.water) parts.push(`${formatLitres(vm.water.totalMl)} water`);
  if (vm.today) parts.push(vm.today.trainedToday ? 'workout done' : 'no workout yet');
  const quests = vm.quests ? [...vm.quests.daily, ...vm.quests.weekly] : [];
  if (quests.length) parts.push(`${quests.filter((q) => q.completed).length}/${quests.length} quests`);
  return parts;
}

/** Friendly relative time for "last updated" labels. */
export function updatedAgo(iso: string, now: Date = new Date()): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  return `${hours} h ago`;
}

export function shortDate(localDate: string): string {
  return new Date(`${localDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
