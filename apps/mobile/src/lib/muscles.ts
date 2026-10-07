import { EXERCISES } from '@form/domain';
import type { Muscle } from '@/components/art/BodyMap';

/** Sets per muscle group (main movers only), most-trained first — from the exercise catalogue, never guessed. */
export function setsPerMuscle(sets: { exerciseId: string; count?: number }[]): { muscle: Muscle; value: number }[] {
  const counts = new Map<Muscle, number>();
  for (const s of sets) {
    const ex = EXERCISES.find((e) => e.id === s.exerciseId);
    for (const m of ex?.primaryMuscles ?? []) counts.set(m as Muscle, (counts.get(m as Muscle) ?? 0) + (s.count ?? 1));
  }
  return [...counts.entries()].map(([muscle, value]) => ({ muscle, value })).sort((a, b) => b.value - a.value);
}
