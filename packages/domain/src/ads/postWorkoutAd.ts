/**
 * Post-workout ad policy — FORM's only Free-tier ad placement.
 *
 * "Let the user finish their workout first": the ad is decided only after the Workout Engine has
 * committed the workout (XP, PRs, streak and quests are already applied by then) and the summary has
 * been shown. It is never part of completion, so nothing about the workout can depend on it.
 *
 * At most one post-workout ad per Free user per *local* day. The server keeps one record per
 * (user, workout); the cap counts records that were shown, plus a live reservation (an ad that is
 * being loaded right now), so two quick workouts can't both claim the day's ad. A reservation that
 * fails, or is never reported shown, does not use the day's ad up.
 */

export const POST_WORKOUT_PLACEMENT = "post_workout" as const;
/** One post-workout ad per Free user per local day. */
export const POST_WORKOUT_DAILY_CAP = 1;
/** An eligible ad that is never reported shown stops holding the day's slot after this long. */
export const POST_WORKOUT_RESERVATION_MS = 15 * 60_000;
/** Only a workout completed this recently can open the ad (no ads for old history). */
export const POST_WORKOUT_FRESH_MS = 60 * 60_000;

/** Server-side record state. "reserved" = eligible and being loaded; "dismissed" implies it was shown. */
export type PostWorkoutAdRecordState = "reserved" | "shown" | "dismissed" | "failed";
/** What the client reports. "requested"/"loaded" are analytics only; the others move the record. */
export const POST_WORKOUT_AD_EVENTS = ["requested", "loaded", "shown", "dismissed", "failed"] as const;
export type PostWorkoutAdEvent = (typeof POST_WORKOUT_AD_EVENTS)[number];

export type PostWorkoutIneligibleReason =
  | "pro_user"
  | "workout_not_found"
  | "workout_not_recent"
  | "already_handled"
  | "daily_cap";

export type PostWorkoutEligibility = { eligible: true; resume: boolean } | { eligible: false; reason: PostWorkoutIneligibleReason };

export interface PostWorkoutAdRecord {
  workoutId: string | null;
  state: PostWorkoutAdRecordState;
  createdAt: Date;
}

const live = (r: PostWorkoutAdRecord, now: Date) => r.state === "reserved" && now.getTime() - r.createdAt.getTime() < POST_WORKOUT_RESERVATION_MS;
const usesTheDay = (r: PostWorkoutAdRecord, now: Date) => r.state === "shown" || r.state === "dismissed" || live(r, now);

/**
 * May this completed workout open the day's post-workout ad? Pure: the caller supplies the user's
 * entitlement, the workout (null if it doesn't exist or isn't the user's), the record for this
 * workout if one exists, and every record on the user's local today.
 */
export function postWorkoutAdEligibility(input: {
  isPro: boolean;
  workout: { completedAt: Date } | null;
  now: Date;
  existingForWorkout: PostWorkoutAdRecord | null;
  today: PostWorkoutAdRecord[];
}): PostWorkoutEligibility {
  if (input.isPro) return { eligible: false, reason: "pro_user" };
  if (!input.workout) return { eligible: false, reason: "workout_not_found" };
  const age = input.now.getTime() - input.workout.completedAt.getTime();
  if (age < 0 || age > POST_WORKOUT_FRESH_MS) return { eligible: false, reason: "workout_not_recent" };

  // The same completion asked twice (a retry, a replayed event, the screen re-mounting): the answer
  // is the same reservation, never a second ad.
  if (input.existingForWorkout) {
    return live(input.existingForWorkout, input.now) ? { eligible: true, resume: true } : { eligible: false, reason: "already_handled" };
  }
  const used = input.today.filter((r) => usesTheDay(r, input.now)).length;
  if (used >= POST_WORKOUT_DAILY_CAP) return { eligible: false, reason: "daily_cap" };
  return { eligible: true, resume: false };
}

/**
 * Record transitions. Terminal states never move back: a dismissed ad stays counted, and a failed
 * one can't be revived into "shown" to fake an impression after the fact. A "failed" report after
 * the ad was already shown is ignored (it was seen; the day's ad is used).
 */
export function nextPostWorkoutAdState(current: PostWorkoutAdRecordState, event: PostWorkoutAdEvent): PostWorkoutAdRecordState {
  switch (current) {
    case "reserved":
      if (event === "shown") return "shown";
      if (event === "dismissed") return "dismissed";
      if (event === "failed") return "failed";
      return "reserved";
    case "shown":
      return event === "dismissed" ? "dismissed" : "shown";
    case "dismissed":
    case "failed":
      return current;
  }
}

// ---------------------------------------------------------------------------------------------
// Client state machine (used by the app's AdService; pure so it can be tested without a device).

export type PostWorkoutAdPhase =
  | "IDLE"
  | "CHECKING"
  | "NOT_ELIGIBLE"
  | "NOT_CONFIGURED"
  | "LOADING"
  | "READY"
  | "SHOWING"
  | "DISMISSED"
  | "FAILED";

export type PostWorkoutAdAction =
  | { type: "check" }
  | { type: "not_eligible"; reason: string }
  | { type: "not_configured" }
  | { type: "eligible"; adId: string }
  | { type: "loaded" }
  | { type: "show" }
  | { type: "closed" }
  | { type: "failed"; reason: string };

export interface PostWorkoutAdMachine {
  phase: PostWorkoutAdPhase;
  adId: string | null;
  reason: string | null;
}

export const initialPostWorkoutAd: PostWorkoutAdMachine = { phase: "IDLE", adId: null, reason: null };

/** Phases from which the user can leave right away (nothing is on screen and nothing is pending). */
export const POST_WORKOUT_AD_SETTLED: readonly PostWorkoutAdPhase[] = ["NOT_ELIGIBLE", "NOT_CONFIGURED", "DISMISSED", "FAILED"];

export function postWorkoutAdReducer(s: PostWorkoutAdMachine, a: PostWorkoutAdAction): PostWorkoutAdMachine {
  switch (a.type) {
    case "check":
      return s.phase === "IDLE" ? { ...s, phase: "CHECKING" } : s;
    case "not_eligible":
      return s.phase === "CHECKING" ? { phase: "NOT_ELIGIBLE", adId: null, reason: a.reason } : s;
    case "not_configured":
      return s.phase === "CHECKING" || s.phase === "LOADING" ? { ...s, phase: "NOT_CONFIGURED", reason: "not_configured" } : s;
    case "eligible":
      return s.phase === "CHECKING" ? { phase: "LOADING", adId: a.adId, reason: null } : s;
    case "loaded":
      return s.phase === "LOADING" ? { ...s, phase: "READY" } : s;
    case "show":
      return s.phase === "READY" ? { ...s, phase: "SHOWING" } : s;
    case "closed":
      return s.phase === "SHOWING" ? { ...s, phase: "DISMISSED" } : s;
    case "failed":
      return POST_WORKOUT_AD_SETTLED.includes(s.phase) || s.phase === "IDLE" ? s : { ...s, phase: "FAILED", reason: a.reason };
  }
}
