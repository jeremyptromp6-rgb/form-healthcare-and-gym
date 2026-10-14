import type { AppContext } from "../../shared/context";

/** Below this many people with XP, a percentile says nothing real (and could single someone out). */
export const MIN_STANDING_POPULATION = 20;

export interface Standing {
  /** "Top X%" of FORM users by active XP (1 = the very top), or null while too few people have XP. */
  percentile: number | null;
  /** How many people with XP the percentile is measured against. */
  rankedUsers: number;
}

/**
 * Pure math: where `mine` sits among `all` (everyone with XP, the caller included). Ties share the
 * better place, so nobody is placed lower than someone with the same XP. Returns the Top X% (1..100).
 */
export function topPercent(mine: number, all: readonly number[]): number {
  if (all.length === 0) return 100;
  const ahead = all.filter((x) => x > mine).length;
  return Math.min(100, Math.max(1, Math.ceil(((ahead + 1) * 100) / all.length)));
}

/**
 * The caller's anonymous standing from the XP distribution: active XP (since each user's last reset,
 * the same number that sets their level and rank). Only aggregates leave this function — never another
 * user's id, name or XP.
 */
export function standing(ctx: AppContext, userId: string): Standing {
  const rows = ctx.db
    .prepare(
      `SELECT e.user_id AS userId, SUM(e.xp) AS xp
       FROM xp_events e
       WHERE e.id > COALESCE((SELECT MAX(r.id) FROM xp_events r WHERE r.user_id = e.user_id AND r.kind = 'reset'), 0)
       GROUP BY e.user_id
       HAVING SUM(e.xp) > 0`,
    )
    .all() as unknown as { userId: string; xp: number }[];
  const rankedUsers = rows.length;
  const mine = rows.find((r) => r.userId === userId)?.xp ?? 0;
  // Not ranked yet (no XP) or too few people to compare against: say so rather than guess.
  if (mine <= 0 || rankedUsers < MIN_STANDING_POPULATION) return { percentile: null, rankedUsers };
  return { percentile: topPercent(mine, rows.map((r) => r.xp)), rankedUsers };
}
