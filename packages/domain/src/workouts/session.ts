/**
 * Live workout sessions. Timing is always computed on the server from recorded timestamps,
 * so the duration used for XP and the daily training cap can't be claimed by the client.
 */

export type SessionStatus = "active" | "paused" | "completed" | "discarded";

export const SESSION_LIMITS = {
  restSeconds: { min: 10, max: 600 },
  maxDurationMinutes: 600,
  maxSetsPerSession: 100,
  /**
   * A running session untouched for longer than this was left open (app closed, phone forgotten).
   * Rest is at most 10 minutes and a set takes a few, so 90 idle minutes isn't training.
   */
  idleMinutes: 90,
} as const;

/**
 * How much of the time since the session's last activity counts as idle: all of it once it
 * passes the idle limit, none before. Idle time is treated as a pause — it never counts as
 * training, whether the workout is then finished, resumed or abandoned. A paused session is
 * already not counting time, so it has no idle time.
 */
export function sessionIdleMs(input: { status: SessionStatus; lastActivityAt: Date; now: Date }): number {
  if (input.status !== "active") return 0;
  const gap = input.now.getTime() - input.lastActivityAt.getTime();
  return gap > SESSION_LIMITS.idleMinutes * 60_000 ? gap : 0;
}

/** Training time between start and end, excluding pauses (including a pause still open at `end`). Whole minutes, 1–600. */
export function activeDurationMinutes(input: { startedAt: Date; end: Date; pausedMs: number; pausedAt: Date | null }): number {
  const openPause = input.pausedAt ? Math.max(0, input.end.getTime() - input.pausedAt.getTime()) : 0;
  const activeMs = Math.max(0, input.end.getTime() - input.startedAt.getTime() - input.pausedMs - openPause);
  return Math.min(SESSION_LIMITS.maxDurationMinutes, Math.max(1, Math.round(activeMs / 60_000)));
}

/** Seconds of rest left at `now`, or null when no rest timer is running. */
export function restRemainingSeconds(restEndsAt: Date | null, now: Date): number | null {
  if (!restEndsAt) return null;
  return Math.max(0, Math.ceil((restEndsAt.getTime() - now.getTime()) / 1000));
}
