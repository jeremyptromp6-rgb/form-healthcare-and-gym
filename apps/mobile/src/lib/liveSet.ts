import type { WorkoutSession } from './types';

/**
 * Time between sets, for fair XP without any extra tapping: a set checked off claims "live" with the seconds
 * since the previous set was saved (or since the workout screen opened). The server keeps it live only when
 * that is plausible for the reps (1.5 s per rep), so ticking off a pile of sets at once falls back to manual.
 *
 * Everything here is on the device's own clock (Date.now). Server timestamps are never compared with it, so a
 * phone clock that disagrees with the server can't unfairly turn an honest set into a manual one; the only server
 * numbers used are the workout's total paused milliseconds, which are durations.
 */
export interface SetClock {
  /** Date.now() of the previous set's save, or of the screen opening before the first one. */
  anchorMs: number;
  /** The session's total paused time at that moment; later pauses are taken off the clock. */
  pausedMsAtAnchor: number;
}

/** The longest live set the server accepts, seconds. */
export const LIVE_SET_MAX_SECONDS = 3600;

export function startSetClock(session: Pick<WorkoutSession, 'pausedMs'>, nowMs: number): SetClock {
  return { anchorMs: nowMs, pausedMsAtAnchor: session.pausedMs };
}

/** Whole seconds since the anchor with pauses excluded, in the server's 1..3600 range. */
export function secondsSinceSet(clock: SetClock, session: Pick<WorkoutSession, 'pausedMs'>, nowMs: number): number {
  const paused = Math.max(0, session.pausedMs - clock.pausedMsAtAnchor);
  const seconds = Math.floor((nowMs - clock.anchorMs - paused) / 1000);
  return Math.min(LIVE_SET_MAX_SECONDS, Math.max(1, Number.isFinite(seconds) ? seconds : 1));
}
