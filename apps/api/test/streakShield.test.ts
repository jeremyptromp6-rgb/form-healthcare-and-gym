import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../src/shared/context";
import { grantPro, makeApp, onboard, registerUser, TestClock } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const get = async (auth: Auth, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();
const pushUps = (localDate: string) => ({ clientWorkoutId: randomUUID(), localDate, durationMinutes: 30, painLevel: "none", sets: [{ exerciseId: "push_up", reps: 20 }] });

/** A user onboarded on `at` (3 training days a week → up to 2 rest days in a row); Pro since `proSince` when given. */
async function user(at: string, proSince?: string) {
  const clock = new TestClock(new Date(`${at}T12:00:00Z`));
  ({ app, ctx } = await makeApp({ clock }));
  const u = await registerUser(app);
  await onboard(app, u.auth, at);
  if (proSince) {
    grantPro(ctx, u.id);
    ctx.db.prepare("UPDATE subscriptions SET created_at = ? WHERE user_id = ?").run(`${proSince}T08:00:00.000Z`, u.id);
  }
  return { ...u, clock };
}
async function trainOn(u: { auth: Auth; clock: TestClock }, date: string) {
  u.clock.set(`${date}T12:00:00Z`);
  const r = await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: pushUps(date) });
  expect(r.statusCode, r.body).toBe(201);
}
const workoutStreak = async (u: { auth: Auth }) => (await get(u.auth, "/streaks")).streaks.workout;
const frozenRows = (userId: string) => (ctx.db.prepare("SELECT local_date AS d FROM streak_freezes WHERE user_id = ? ORDER BY local_date").all(userId) as { d: string }[]).map((r) => r.d);

describe("Streak Shield", () => {
  it("a Pro user's missed day is frozen so the streak is kept; a frozen day is not a training day", async () => {
    const u = await user("2026-09-28", "2026-09-01");
    await trainOn(u, "2026-10-01");
    await trainOn(u, "2026-10-05"); // 02, 03, 04 missed: one more than the plan's two rest days
    const w = await workoutStreak(u);
    expect(w).toMatchObject({ current: 2, longest: 2, activeToday: true });
    expect(w.freezes).toMatchObject({ enabled: true, perMonth: 2, usedThisMonth: 1, freezesLeft: 1, frozenDates: ["2026-10-02"] });
    expect(frozenRows(u.id)).toEqual(["2026-10-02"]);
    // Never a training day: no workout, no XP for the frozen day.
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM workouts WHERE user_id = ?").get(u.id) as { n: number }).n).toBe(2);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM xp_events WHERE user_id = ? AND source_key LIKE '%2026-10-02%'").get(u.id) as { n: number }).n).toBe(0);

    // Reading again changes nothing; letting Pro lapse keeps the freeze already used but gives no more.
    expect((await workoutStreak(u)).freezes.frozenDates).toEqual(["2026-10-02"]);
    ctx.db.prepare("UPDATE subscriptions SET status = 'expired' WHERE user_id = ?").run(u.id);
    const lapsed = await workoutStreak(u);
    expect(lapsed).toMatchObject({ current: 2 });
    expect(lapsed.freezes).toMatchObject({ enabled: false, freezesLeft: 0, frozenDates: ["2026-10-02"] });
  });

  it("the third miss in a month breaks the streak", async () => {
    const u = await user("2026-09-28", "2026-09-01");
    for (const d of ["2026-10-01", "2026-10-05", "2026-10-09", "2026-10-13"]) await trainOn(u, d);
    const w = await workoutStreak(u);
    expect(w).toMatchObject({ current: 1, longest: 3 }); // 02 and 06 frozen; 10, 11, 12 had no freeze left
    expect(w.freezes).toMatchObject({ usedThisMonth: 2, freezesLeft: 0, frozenDates: ["2026-10-02", "2026-10-06"] });
    expect(frozenRows(u.id)).toEqual(["2026-10-02", "2026-10-06"]);
  });

  it("a free user's streak is unchanged and nothing is frozen", async () => {
    const u = await user("2026-09-28");
    await trainOn(u, "2026-10-01");
    await trainOn(u, "2026-10-05");
    const w = await workoutStreak(u);
    expect(w).toMatchObject({ current: 1, longest: 1 });
    expect(w.freezes).toMatchObject({ enabled: false, freezesLeft: 0, usedThisMonth: 0, frozenDates: [] });
    expect(frozenRows(u.id)).toEqual([]);
  });

  it("never freezes days before the user was Pro", async () => {
    const u = await user("2026-09-28", "2026-10-05");
    await trainOn(u, "2026-10-01");
    await trainOn(u, "2026-10-05");
    expect((await workoutStreak(u)).current).toBe(1);
    expect(frozenRows(u.id)).toEqual([]);
  });

  it("freezes reset each calendar month", async () => {
    const u = await user("2026-09-08", "2026-09-01");
    for (const d of ["2026-09-10", "2026-09-14", "2026-09-18"]) await trainOn(u, d); // two September freezes used
    expect((await workoutStreak(u)).freezes).toMatchObject({ usedThisMonth: 2, freezesLeft: 0, frozenDates: ["2026-09-11", "2026-09-15"] });
    await trainOn(u, "2026-10-01");
    await trainOn(u, "2026-10-05");
    const w = await workoutStreak(u);
    expect(w.freezes).toMatchObject({ usedThisMonth: 1, freezesLeft: 1 });
    expect(w.freezes.frozenDates).toEqual(["2026-09-11", "2026-09-15", "2026-10-02"]);
    expect(w.current).toBe(2);
  });
});
