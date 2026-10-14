import { computeMuscleRanks, RANK_WINDOW_DAYS, rankWindowStart, type MuscleRank, type RankSet } from "@form/domain";
import type { AppContext } from "../../shared/context";
import type { UserClock } from "../../shared/userClock";

export interface MuscleRanksView {
  windowDays: number;
  from: string;
  to: string;
  /** Weakest first. */
  ranks: MuscleRank[];
}

/**
 * Muscle ranks from the user's own workout sets over the last 28 local days. Same rules as the other
 * performance analytics: only sets with verified reps count, and a workout with serious pain never does.
 */
export function muscleRanks(ctx: AppContext, userId: string, clock: UserClock): MuscleRanksView {
  const from = rankWindowStart(clock.today);
  const rows = ctx.db
    .prepare(
      `SELECT s.exercise_id AS exerciseId, s.verified_reps AS verifiedReps
       FROM workout_sets s JOIN workouts w ON w.id = s.workout_id
       WHERE w.user_id = ? AND w.local_date BETWEEN ? AND ? AND s.verified_reps > 0 AND w.pain_level <> 'serious'`,
    )
    .all(userId, from, clock.today) as unknown as RankSet[];
  return { windowDays: RANK_WINDOW_DAYS, from, to: clock.today, ranks: computeMuscleRanks(rows) };
}
