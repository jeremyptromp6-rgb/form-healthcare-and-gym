import type { ProfileOptions, Sex } from './types';
import { formatHeight, formatWeight, heightInputToCm, weightInputToKg, type Units } from './units';

/**
 * Client-side form checks for instant feedback. They mirror the server's limits (served in the
 * catalog) — the server validates again and is the authority.
 */

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

export interface BodyFormInput {
  sex: Sex | null;
  age: string;
  height: { cm?: string; ft?: string; inches?: string };
  weight: string;
}

export function validateBodyForm(input: BodyFormInput, units: Units, limits: ProfileOptions['limits']) {
  const errors: FieldErrors<'sex' | 'age' | 'height' | 'weight'> = {};
  const age = Number(input.age.trim());
  const heightCm = heightInputToCm(input.height, units);
  const weightKg = weightInputToKg(input.weight, units);

  if (!input.sex) errors.sex = 'Choose an option (or “Prefer not”).';
  if (!Number.isInteger(age) || input.age.trim() === '' || age < limits.ageYears.min || age > limits.ageYears.max) {
    errors.age = `Enter an age from ${limits.ageYears.min} to ${limits.ageYears.max}.`;
  }
  if (!(heightCm >= limits.heightCm.min && heightCm <= limits.heightCm.max)) {
    errors.height = `Enter a height from ${formatHeight(limits.heightCm.min, units)} to ${formatHeight(limits.heightCm.max, units)}.`;
  }
  if (!(weightKg >= limits.weightKg.min && weightKg <= limits.weightKg.max)) {
    errors.weight = `Enter a weight from ${formatWeight(limits.weightKg.min, units)} to ${formatWeight(limits.weightKg.max, units)}.`;
  }
  const ok = Object.keys(errors).length === 0;
  return { ok, errors, value: ok ? { sex: input.sex!, ageYears: age, heightCm, weightKg } : null };
}

export function validateTrainingForm(input: { experience: string | null; days: number | null; location: string | null; equipment: string[] }) {
  const errors: FieldErrors<'experience' | 'days' | 'location' | 'equipment'> = {};
  if (!input.experience) errors.experience = 'Choose your experience level.';
  if (input.days === null) errors.days = 'Choose how many days a week you can train.';
  if (!input.location) errors.location = 'Choose where you train.';
  if (input.equipment.length === 0) errors.equipment = 'Choose at least one option (“Bodyweight only” counts).';
  return { ok: Object.keys(errors).length === 0, errors };
}

/** Toggling a base diet (vegan/vegetarian/pescatarian) replaces any other base diet. */
export function toggleDiet(selected: readonly string[], key: string, exclusive: readonly string[]): string[] {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  const without = exclusive.includes(key) ? selected.filter((k) => !exclusive.includes(k)) : [...selected];
  return [...without, key];
}

export function toggle(selected: readonly string[], key: string): string[] {
  return selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
}

export function labelOf(options: readonly { key: string; label: string }[], key: string | null | undefined): string {
  return options.find((o) => o.key === key)?.label ?? '—';
}
