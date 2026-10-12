import { randomUUID } from "node:crypto";
import {
  hasFeature,
  nextPostWorkoutAdState,
  postWorkoutAdEligibility,
  POST_WORKOUT_PLACEMENT,
  sanitizeAnalyticsEvent,
  type PostWorkoutAdEvent,
  type PostWorkoutAdRecord,
  type PostWorkoutAdRecordState,
  type PostWorkoutIneligibleReason,
} from "@form/domain";
import { transaction } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { userClock } from "../../shared/userClock";
import { entitlementsFor } from "../billing/entitlements";
import { loadSettings } from "../users/repo";

/**
 * AdEligibilityService (server) for the post-workout ad. The client never decides whether an ad
 * may show or whether the day's ad is used: it asks here *after* the workout is committed, and
 * reports what the ad SDK did. Pro users are answered from the EntitlementService before anything
 * is stored, so a Pro user never gets a reservation and the app never loads an ad for them.
 */

export type PostWorkoutDecision =
  | { eligible: true; adId: string; placement: typeof POST_WORKOUT_PLACEMENT; personalized: boolean }
  | { eligible: false; reason: PostWorkoutIneligibleReason };

interface AdRow {
  id: string;
  user_id: string;
  workout_id: string | null;
  local_date: string;
  state: PostWorkoutAdRecordState;
  created_at: string;
}

const toRecord = (r: AdRow): PostWorkoutAdRecord => ({ workoutId: r.workout_id, state: r.state, createdAt: new Date(r.created_at) });

/** The user's local day. A stored time zone is authoritative; before one is saved, the workout's own date (validated) is used. */
function localDay(ctx: AppContext, userId: string, workoutDate: string): { date: string; timezone: string } {
  try {
    const clock = userClock(ctx, userId, workoutDate);
    return { date: clock.today, timezone: clock.timezone };
  } catch {
    const clock = userClock(ctx, userId);
    return { date: clock.today, timezone: clock.timezone };
  }
}

/** Product analytics: allowlisted event, only with the user's analytics consent, never health data. Fire and forget. */
function track(ctx: AppContext, userId: string, name: string, props: Record<string, unknown> = {}) {
  if (!loadSettings(ctx.db, userId).analyticsConsent) return;
  const event = sanitizeAnalyticsEvent(name, { placement: POST_WORKOUT_PLACEMENT, ...props });
  if (!event) return;
  void ctx.providers.analytics.track(event).catch(() => undefined);
}

export function decidePostWorkoutAd(ctx: AppContext, userId: string, workoutId: string): PostWorkoutDecision {
  const isPro = hasFeature(entitlementsFor(ctx, userId), "AD_FREE");
  if (isPro) return { eligible: false, reason: "pro_user" };

  const decision = transaction(ctx.db, (): PostWorkoutDecision => {
    const now = ctx.now();
    const workout = ctx.db.prepare("SELECT id, local_date, created_at FROM workouts WHERE id = ? AND user_id = ?").get(workoutId, userId) as
      | { id: string; local_date: string; created_at: string }
      | undefined;
    if (!workout) return { eligible: false, reason: "workout_not_found" };

    const day = localDay(ctx, userId, workout.local_date);
    const existing = ctx.db.prepare("SELECT * FROM post_workout_ads WHERE user_id = ? AND workout_id = ?").get(userId, workoutId) as AdRow | undefined;
    const today = ctx.db.prepare("SELECT * FROM post_workout_ads WHERE user_id = ? AND local_date = ?").all(userId, day.date) as unknown as AdRow[];

    const verdict = postWorkoutAdEligibility({
      isPro: false,
      workout: { completedAt: new Date(workout.created_at) },
      now,
      existingForWorkout: existing ? toRecord(existing) : null,
      today: today.map(toRecord),
    });
    if (!verdict.eligible) return verdict;

    const personalized = loadSettings(ctx.db, userId).personalizedAdsConsent;
    if (existing) return { eligible: true, adId: existing.id, placement: POST_WORKOUT_PLACEMENT, personalized };

    const id = randomUUID();
    const at = now.toISOString();
    ctx.db
      .prepare(
        `INSERT INTO post_workout_ads (id, user_id, workout_id, local_date, timezone, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)`,
      )
      .run(id, userId, workoutId, day.date, day.timezone, at, at);
    return { eligible: true, adId: id, placement: POST_WORKOUT_PLACEMENT, personalized };
  });

  if (decision.eligible) track(ctx, userId, "post_workout_ad_eligible");
  else if (decision.reason === "daily_cap") track(ctx, userId, "post_workout_ad_capped");
  return decision;
}

const EVENT_ANALYTICS: Record<PostWorkoutAdEvent, string> = {
  requested: "post_workout_ad_requested",
  loaded: "post_workout_ad_loaded",
  shown: "post_workout_ad_shown",
  dismissed: "post_workout_ad_dismissed",
  failed: "post_workout_ad_failed",
};

/** The client reports what the ad SDK did. Idempotent, owner-only, and transitions only move forward. */
export function recordPostWorkoutAdEvent(
  ctx: AppContext,
  userId: string,
  adId: string,
  event: PostWorkoutAdEvent,
  failureReason?: string,
): { state: PostWorkoutAdRecordState } {
  const result = transaction(ctx.db, () => {
    const row = ctx.db.prepare("SELECT * FROM post_workout_ads WHERE id = ? AND user_id = ?").get(adId, userId) as AdRow | undefined;
    if (!row) throw new HttpError(404, "not_found", "Ad not found");
    const next = nextPostWorkoutAdState(row.state, event);
    if (next !== row.state) {
      ctx.db
        .prepare("UPDATE post_workout_ads SET state = ?, failure_reason = ?, updated_at = ? WHERE id = ?")
        .run(next, next === "failed" ? (failureReason ?? "unknown").slice(0, 40) : null, ctx.now().toISOString(), adId);
    }
    return { state: next, changed: next !== row.state };
  });
  // Analytics follow real transitions (and the two informational events), never a replayed duplicate.
  if (result.changed || event === "requested" || event === "loaded") track(ctx, userId, EVENT_ANALYTICS[event], event === "failed" ? { reason: failureReason ?? "unknown" } : {});
  return { state: result.state };
}
