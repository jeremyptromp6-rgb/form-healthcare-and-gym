import type { WorkoutSession } from './types';

/**
 * A live set: the user taps "Start set", counts reps with +1 taps and presses Done. The timer is timestamps,
 * never an interval counter, so it keeps its time while the app is in the background, and the workout's
 * pauses are taken out of it (the same pause data the workout clock uses).
 */
export interface LiveSet {
  exerciseId: string;
  /** Date.now() when the set started. */
  startedAtMs: number;
  /** The session's total paused time when the set started; later pauses are taken off the clock. */
  pausedMsAtStart: number;
  reps: number;
}

/** The longest live set the server accepts, seconds. */
export const LIVE_SET_MAX_SECONDS = 3600;

/** The most reps a set can hold (the server's limit). */
export const LIVE_SET_MAX_REPS = 200;

export function startLiveSet(exerciseId: string, session: Pick<WorkoutSession, 'pausedMs'>, nowMs: number): LiveSet {
  return { exerciseId, startedAtMs: nowMs, pausedMsAtStart: session.pausedMs, reps: 0 };
}

/** Seconds the set has really run: workout pauses excluded, frozen while the workout is paused. */
export function liveSetSeconds(live: LiveSet, session: Pick<WorkoutSession, 'pausedMs' | 'pausedAt'>, nowMs: number): number {
  const end = session.pausedAt ? new Date(session.pausedAt).getTime() : nowMs;
  const pausedSince = Math.max(0, session.pausedMs - live.pausedMsAtStart);
  return Math.max(0, Math.floor((end - live.startedAtMs - pausedSince) / 1000));
}

/** The seconds to send with a finished live set: whole seconds in the server's 1..3600 range. */
export function liveSecondsToSend(seconds: number): number {
  return Math.min(LIVE_SET_MAX_SECONDS, Math.max(1, Math.round(seconds)));
}
