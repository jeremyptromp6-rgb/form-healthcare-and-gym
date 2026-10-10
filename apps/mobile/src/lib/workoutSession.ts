import type { SessionExercise, WorkoutSession } from './types';

/**
 * Presentation helpers for a live workout. The server owns the session; these only decide
 * what to show next and format time. No XP, verification or progression logic lives here.
 */

/** The exercise to show: the first planned one with sets left, else the last one. -1 when empty. */
export function currentExerciseIndex(s: Pick<WorkoutSession, 'exercises'>): number {
  if (s.exercises.length === 0) return -1;
  const i = s.exercises.findIndex((e) => e.sets !== null && e.loggedSets.length < e.sets);
  return i === -1 ? s.exercises.length - 1 : i;
}

/** A form score (0–100) in words — what a coach would say, not a number. */
export function formWord(score: number): string {
  if (score >= 90) return 'Great form';
  if (score >= 75) return 'Good form';
  if (score >= 60) return 'Decent form';
  return 'Form needs work';
}

export function exerciseDone(e: SessionExercise): boolean {
  return e.sets !== null && e.loggedSets.length >= e.sets;
}

export function allPlannedDone(s: Pick<WorkoutSession, 'exercises'>): boolean {
  const planned = s.exercises.filter((e) => e.planned);
  return planned.length > 0 && planned.every(exerciseDone);
}

/** Starting values for the next set: repeat the last set, else the plan, else last time, else sensible defaults. */
export function nextSetDefaults(e: SessionExercise): { reps: number; loadKg: number } {
  const last = e.loggedSets.at(-1);
  const prev = e.previous?.sets[e.loggedSets.length] ?? e.previous?.sets.at(-1);
  return {
    reps: last?.reps ?? e.targetReps?.max ?? prev?.reps ?? 10,
    loadKg: e.loadable ? (last?.loadKg ?? e.targetLoadKg ?? prev?.loadKg ?? 0) : 0,
  };
}

/** Active training time in seconds (pauses excluded), from server timestamps. */
/** Training time on the clock: pauses never count, and neither does time the session sat idle (the server's rule). */
export function elapsedSeconds(s: Pick<WorkoutSession, 'startedAt' | 'pausedMs' | 'pausedAt'> & { idleSince?: string | null }, now: Date): number {
  const end = s.pausedAt ? new Date(s.pausedAt).getTime() : s.idleSince ? new Date(s.idleSince).getTime() : now.getTime();
  return Math.max(0, Math.floor((end - new Date(s.startedAt).getTime() - s.pausedMs) / 1000));
}

export function restRemaining(s: Pick<WorkoutSession, 'rest'>, now: Date): number | null {
  if (!s.rest) return null;
  return Math.max(0, Math.ceil((new Date(s.rest.endsAt).getTime() - now.getTime()) / 1000));
}

export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export function formatTarget(e: Pick<SessionExercise, 'targetReps' | 'targetLoadKg'>): string | null {
  if (!e.targetReps) return null;
  const reps = e.targetReps.min === e.targetReps.max ? `${e.targetReps.min}` : `${e.targetReps.min}–${e.targetReps.max}`;
  return `${reps} reps${e.targetLoadKg ? ` @ ${e.targetLoadKg} kg` : ''}`;
}

export function formatPrevious(e: Pick<SessionExercise, 'previous'>): string | null {
  if (!e.previous || e.previous.sets.length === 0) return null;
  return e.previous.sets.map((s) => (s.loadKg > 0 ? `${s.reps} × ${s.loadKg} kg` : `${s.reps} reps`)).join(' · ');
}

export function sessionTotals(s: Pick<WorkoutSession, 'exercises'>) {
  const sets = s.exercises.flatMap((e) => e.loggedSets);
  return {
    sets: sets.length,
    reps: sets.reduce((a, x) => a + x.reps, 0),
    verifiedReps: sets.reduce((a, x) => a + x.verifiedReps, 0),
    /** Weight moved: reps × load, summed (bodyweight sets add nothing). */
    volumeKg: Math.round(sets.reduce((a, x) => a + x.reps * x.loadKg, 0)),
  };
}

/** Rest as people say it: "45 s", "1 min 30 s", "2 min". */
export function formatRest(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const r = seconds % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}
