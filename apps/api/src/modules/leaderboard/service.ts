import { createHmac } from "node:crypto";
import { PROFILE_LIMITS, progressFromXp, rankLabel, type RankName } from "@form/domain";
import type { AppContext } from "../../shared/context";
import type { UserClock } from "../../shared/userClock";
import { settleProgression } from "../progression/service";
import { safePublicName } from "./nameFilter";

export const LEADERBOARD_PERIODS = ["today", "week", "all"] as const;
export type LeaderboardPeriod = (typeof LEADERBOARD_PERIODS)[number];

/** How many places are listed. The caller's own row is added when it falls outside. */
export const LEADERBOARD_SIZE = 50;

export interface LeaderboardEntry {
  /** 1-based place; ties share the better place. */
  position: number;
  /** The opted-in display name, or "Athlete #CODE". Never an email or id. */
  name: string;
  /** True when the name is the anonymous one. */
  anonymous: boolean;
  isYou: boolean;
  points: number;
  level: number;
  rank: RankName;
  /** "Champion 3" past the top rank, otherwise the rank name. */
  rankLabel: string;
  prestige: number | null;
}

export interface LeaderboardYou extends Omit<LeaderboardEntry, "position" | "isYou"> {
  /** Null while the caller has no points in the period (not listed). */
  position: number | null;
  /** The caller has chosen to be shown by name. */
  optedIn: boolean;
}

export interface Leaderboard {
  period: LeaderboardPeriod;
  /** The local dates counted (inclusive); null for all time. */
  from: string | null;
  to: string | null;
  /** Everyone with points in the period. */
  totalRanked: number;
  entries: LeaderboardEntry[];
  you: LeaderboardYou;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * A stable anonymous label for a user: a keyed hash of the id (the server secret is the key), so the code
 * can't be turned back into an id or email, and can't be recomputed or matched without the secret.
 */
export function anonymousName(ctx: AppContext, userId: string): string {
  const digest = createHmac("sha256", ctx.config.jwtSecret).update(`form-leaderboard-code:${userId}`).digest();
  let code = "";
  for (let i = 0; i < 5; i++) code += CODE_ALPHABET[digest[i]! & 31];
  return `Athlete #${code}`;
}

interface Row {
  userId: string;
  points: number;
  name: string | null;
  optedIn: number;
}

// The ledger's anti-cheat rules (daily caps, verified work, one award per event) already bound what a
// user can earn, so points are just the sum of what was earned. Today/week count awards and corrections
// by their local date; all time is the active XP since the last reset (the number that sets the level).
const EARNED = "e.kind IN ('award', 'adjustment', 'correction')";
const SINCE_RESET = "e.id > COALESCE((SELECT MAX(r.id) FROM xp_events r WHERE r.user_id = e.user_id AND r.kind = 'reset'), 0)";

function periodFilter(period: LeaderboardPeriod, clock: UserClock): { where: string; args: string[]; from: string | null; to: string | null } {
  if (period === "today") return { where: `${EARNED} AND e.local_date = ?`, args: [clock.today], from: clock.today, to: clock.today };
  if (period === "week") return { where: `${EARNED} AND e.local_date BETWEEN ? AND ?`, args: [clock.weekStart, clock.today], from: clock.weekStart, to: clock.today };
  return { where: SINCE_RESET, args: [], from: null, to: null };
}

export function leaderboard(ctx: AppContext, userId: string, period: LeaderboardPeriod, clock: UserClock): Leaderboard {
  // Bring the caller's own ledger up to date (finished nutrition days, decay) so their row is current.
  settleProgression(ctx.db, userId, clock.today, ctx.now());

  const f = periodFilter(period, clock);
  const agg = `SELECT e.user_id AS userId, SUM(e.xp) AS points, MAX(e.id) AS lastId
               FROM xp_events e WHERE ${f.where} GROUP BY e.user_id HAVING SUM(e.xp) > 0`;

  // Earliest to reach a score wins a tie for list order (their newest entry is the oldest); equal scores share a place.
  const top = ctx.db
    .prepare(
      `WITH agg AS (${agg})
       SELECT a.userId AS userId, a.points AS points, p.display_name AS name, COALESCE(s.leaderboard_opt_in, 0) AS optedIn
       FROM agg a
       JOIN users u ON u.id = a.userId
       LEFT JOIN profiles p ON p.user_id = a.userId
       LEFT JOIN user_settings s ON s.user_id = a.userId
       ORDER BY a.points DESC, a.lastId ASC, a.userId ASC
       LIMIT ${LEADERBOARD_SIZE}`,
    )
    .all(...f.args) as unknown as Row[];

  const mineRow = ctx.db
    .prepare(
      `WITH agg AS (${agg})
       SELECT (SELECT points FROM agg WHERE userId = ?) AS points,
              (SELECT COUNT(*) FROM agg WHERE points > COALESCE((SELECT points FROM agg WHERE userId = ?), 0)) AS ahead,
              (SELECT COUNT(*) FROM agg a JOIN users u ON u.id = a.userId) AS total`,
    )
    .get(...f.args, userId, userId) as { points: number | null; ahead: number; total: number };
  const myPoints = mineRow.points ?? 0;

  const me = ctx.db
    .prepare(
      `SELECT p.display_name AS name, COALESCE(s.leaderboard_opt_in, 0) AS optedIn
       FROM users u LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN user_settings s ON s.user_id = u.id WHERE u.id = ?`,
    )
    .get(userId) as { name: string | null; optedIn: number } | undefined;

  // Level and rank come from each person's active XP (not the period's points), for the listed people only.
  const ids = [...new Set([...top.map((r) => r.userId), userId])];
  const xpRows = ctx.db
    .prepare(
      `SELECT e.user_id AS userId, SUM(e.xp) AS xp FROM xp_events e
       WHERE e.user_id IN (${ids.map(() => "?").join(",")}) AND ${SINCE_RESET} GROUP BY e.user_id`,
    )
    .all(...ids) as unknown as { userId: string; xp: number }[];
  const activeXp = new Map(xpRows.map((r) => [r.userId, Math.max(0, r.xp)]));
  const standingOf = (id: string) => {
    const p = progressFromXp(activeXp.get(id) ?? 0);
    return { level: p.level, rank: p.rank, prestige: p.prestige ?? null, rankLabel: rankLabel(p.rank, p.prestige) };
  };
  const shownName = (id: string, name: string | null, optedIn: number) => {
    const named = optedIn === 1 ? safePublicName(name, PROFILE_LIMITS.displayNameLength) : null;
    return named ? { name: named, anonymous: false } : { name: anonymousName(ctx, id), anonymous: true };
  };

  let position = 0;
  let previous = Number.NaN;
  const entries: LeaderboardEntry[] = top.map((r, i) => {
    if (r.points !== previous) position = i + 1;
    previous = r.points;
    return { position, ...shownName(r.userId, r.name, r.optedIn), isYou: r.userId === userId, points: r.points, ...standingOf(r.userId) };
  });

  const mine = entries.find((e) => e.isYou);
  const you: LeaderboardYou = {
    position: myPoints > 0 ? (mine?.position ?? mineRow.ahead + 1) : null,
    ...shownName(userId, me?.name ?? null, me?.optedIn ?? 0),
    points: myPoints,
    ...standingOf(userId),
    optedIn: (me?.optedIn ?? 0) === 1,
  };

  return { period, from: f.from, to: f.to, totalRanked: mineRow.total, entries, you };
}
