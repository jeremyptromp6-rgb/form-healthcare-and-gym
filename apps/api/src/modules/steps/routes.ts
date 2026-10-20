import { addDays, dayNumber } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { dateKey } from "../../shared/dates";
import { userClock } from "../../shared/userClock";
import { awardStepsXp } from "../progression/service";

/** The most a day of steps is believed to be (a marathon-plus walking day); anything above is a bad reading. */
export const MAX_DAILY_STEPS = 60_000;
/** Default goal shown on the card. */
export const DEFAULT_STEP_GOAL = 8_000;
/** 1 XP per full 1,000 steps, at most 10 XP a day. */
export const STEPS_PER_XP = 1_000;
export const MAX_STEPS_XP_PER_DAY = 10;

export const stepsXp = (steps: number) => Math.min(MAX_STEPS_XP_PER_DAY, Math.floor(steps / STEPS_PER_XP));

/**
 * Daily steps from the phone's Health Connect (phone and watch already merged there). The app reports a day's
 * total; the server keeps the highest value per day and tops up the XP to match, so a repeated or lower sync
 * changes nothing. Steps never count as a workout, a streak day or a quest training day.
 */
export function stepsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.post("/steps", async (req) => {
    const parsed = z
      .object({ localDate: dateKey, steps: z.number().int().min(0).max(MAX_DAILY_STEPS) })
      .strict()
      .safeParse(req.body);
    if (!parsed.success) throw new HttpError(422, "invalid_steps", "Steps must be a whole number from 0 to 60,000 for a valid date", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
    const body = parsed.data;
    // Today or yesterday in the user's own time zone (a sync queued just before midnight still lands). Before a
    // time zone is saved the server only knows UTC, so a day either side of it is let through.
    const clock = userClock(ctx, req.user.sub);
    const age = dayNumber(clock.today) - dayNumber(body.localDate);
    if (age < (clock.source === "stored" ? 0 : -1) || age > 1) throw new HttpError(422, "implausible_date", "Steps can only be recorded for today or yesterday", { localDate: body.localDate, today: clock.today });

    const now = ctx.now();
    const stored = transaction(ctx.db, () => {
      ctx.db
        .prepare(
          `INSERT INTO steps_daily (user_id, local_date, steps, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id, local_date) DO UPDATE SET steps = MAX(steps, excluded.steps), updated_at = CASE WHEN excluded.steps > steps THEN excluded.updated_at ELSE updated_at END`,
        )
        .run(req.user.sub, body.localDate, body.steps, now.toISOString());
      const { steps } = ctx.db.prepare("SELECT steps FROM steps_daily WHERE user_id = ? AND local_date = ?").get(req.user.sub, body.localDate) as { steps: number };
      awardStepsXp(ctx.db, { userId: req.user.sub, localDate: body.localDate, target: stepsXp(steps), steps, now });
      return steps;
    });
    return { localDate: body.localDate, steps: stored, xp: stepsXp(stored), goal: DEFAULT_STEP_GOAL };
  });

  /** Daily totals for the last `days` days (today included), oldest first, zero-filled. */
  app.get("/steps", async (req) => {
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(31).default(7) }).strict().parse(req.query);
    const today = userClock(ctx, req.user.sub).today;
    const from = addDays(today, -(days - 1));
    const rows = ctx.db.prepare("SELECT local_date AS d, steps FROM steps_daily WHERE user_id = ? AND local_date BETWEEN ? AND ?").all(req.user.sub, from, today) as { d: string; steps: number }[];
    const byDate = new Map(rows.map((r) => [r.d, r.steps]));
    return {
      goal: DEFAULT_STEP_GOAL,
      days: Array.from({ length: days }, (_, i) => {
        const date = addDays(from, i);
        const steps = byDate.get(date) ?? 0;
        return { date, steps, xp: stepsXp(steps) };
      }),
    };
  });
}
