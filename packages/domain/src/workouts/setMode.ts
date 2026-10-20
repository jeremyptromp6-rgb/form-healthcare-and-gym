/**
 * How a set was recorded. "camera" sets are verified by the server from a pose trace; "live" sets were
 * counted on a running timer (tap per rep) in the app; "manual" sets were typed in afterwards. Camera and
 * live sets earn the full self-logged rate, manual sets earn MANUAL_XP_FACTOR of it (see workoutXp).
 */
export type SetMode = "live" | "manual" | "camera";

export const SET_MODES: readonly SetMode[] = ["live", "manual", "camera"];

export const LIVE_SET = {
  /** A live set is implausible when its timer ran less than this many seconds per rep: it is treated as manual. */
  minSecondsPerRep: 1.5,
  /** Longest live set the API accepts, seconds. */
  maxSeconds: 3600,
} as const;

/** Share of the normal self-logged rep XP a manual set earns. */
export const MANUAL_XP_FACTOR = 0.5;

/** A live timer is plausible when it ran at least minSecondsPerRep for every rep. */
export function isPlausibleLiveSet(reps: number, liveSeconds: number): boolean {
  return Number.isFinite(liveSeconds) && liveSeconds >= 1 && liveSeconds >= reps * LIVE_SET.minSecondsPerRep;
}

/**
 * The mode the server trusts, whatever the client claimed:
 * - any server-verified rep makes it a camera set (the server saw it);
 * - a claimed "live" set stays live only if its timer is plausible for the reps;
 * - everything else, including a missing mode (old clients) and an unbacked "camera" claim, is manual.
 */
export function resolveSetMode(input: { mode?: SetMode | null; liveSeconds?: number | null; reps: number; verifiedReps: number }): SetMode {
  if (input.verifiedReps > 0) return "camera";
  if (input.mode === "live" && input.liveSeconds != null && isPlausibleLiveSet(input.reps, input.liveSeconds)) return "live";
  return "manual";
}
