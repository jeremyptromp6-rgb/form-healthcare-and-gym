import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../src/shared/context";
import { makeApp, onboard, registerUser, squatTrace, TestClock } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const get = async (auth: Auth, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();
const post = (auth: Auth, url: string, payload: object) => app.inject({ method: "POST", url, headers: auth, payload });

/** A camera-verified squat session: the server verifies every rep from the pose trace. */
const squats = (localDate: string, loadKg = 60, reps = 5, painLevel = "none") => ({
  clientWorkoutId: randomUUID(),
  localDate,
  durationMinutes: 40,
  painLevel,
  sets: [{ exerciseId: "squat", reps, loadKg, trace: squatTrace(reps) }],
});
/** A self-logged session (no camera): counts for consistency, never for records. */
const pushUps = (localDate: string) => ({ clientWorkoutId: randomUUID(), localDate, durationMinutes: 30, painLevel: "none", sets: [{ exerciseId: "push_up", reps: 20 }] });

async function user(at: string) {
  const clock = new TestClock(new Date(at));
  ({ app, ctx } = await makeApp({ clock }));
  const u = await registerUser(app);
  await onboard(app, u.auth, at.slice(0, 10)); // 3 training days a week
  return { ...u, clock };
}
/** Trains on `date` at midday UTC (dates must be plausible for the server's clock). */
async function trainOn(u: { auth: Auth; clock: TestClock }, date: string, body: object) {
  u.clock.set(`${date}T12:00:00Z`);
  const r = await post(u.auth, "/workouts", body);
  expect(r.statusCode).toBe(201);
  return r.json();
}
const ledger = (userId: string, source: string) =>
  ctx.db.prepare("SELECT source_key AS ref, kind, xp, domain_event_id AS eventId FROM xp_events WHERE user_id = ? AND source = ? ORDER BY id").all(userId, source) as { ref: string; kind: string; xp: number; eventId: number | null }[];

describe("achievements", () => {
  it("unlock once from real data, reward XP through the progression ledger, and can't be edited", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    expect((await get(u.auth, "/achievements")).achievements.every((a: { state: string }) => a.state === "locked")).toBe(true);
    await trainOn(u, "2026-09-28", squats("2026-09-28"));
    // A burst of concurrent reads still unlocks each achievement exactly once.
    const all = await Promise.all(Array.from({ length: 5 }, () => get(u.auth, "/achievements")));
    const by = (id: string) => all[0].achievements.find((a: { id: string }) => a.id === id);
    expect(by("first_workout")).toMatchObject({ state: "unlocked", progress: 1, target: 1 });
    expect(by("first_rep")).toMatchObject({ state: "unlocked" });
    expect(by("hundred_club")).toMatchObject({ state: "in_progress", progress: 5, target: 100 });
    expect(by("consistent")).toMatchObject({ state: "locked", progress: 0 });

    const xp = ledger(u.id, "achievement");
    expect(xp.map((e) => [e.ref, e.kind, e.xp]).sort()).toEqual([["first_rep", "award", 10], ["first_workout", "award", 20]]);
    const rows = ctx.db.prepare("SELECT achievement_id AS id, xp_reward AS xp, domain_event_id AS eventId FROM user_achievements WHERE user_id = ? ORDER BY achievement_id").all(u.id) as { id: string; xp: number; eventId: number }[];
    expect(rows.map((r) => r.id)).toEqual(["first_rep", "first_workout"]);
    // Event integrity: each unlock, its domain event and its ledger entry point at each other.
    for (const r of rows) {
      const event = ctx.db.prepare("SELECT type, key FROM domain_events WHERE id = ?").get(r.eventId);
      expect(event).toEqual({ type: "achievement.unlocked", key: r.id });
      expect(xp.find((e) => e.ref === r.id)?.eventId).toBe(r.eventId);
    }
    expect(() => ctx.db.prepare("UPDATE user_achievements SET unlocked_at = 'x'").run()).toThrow(/permanent/);
    expect(() => ctx.db.prepare("DELETE FROM user_achievements").run()).toThrow(/permanent/);
    expect((await post(u.auth, "/achievements", { id: "consistent" })).statusCode).toBe(404); // nothing for a client to claim
  });

  it("sessions with serious pain never count toward an achievement", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    await trainOn(u, "2026-09-28", squats("2026-09-28", 60, 5, "serious"));
    const a = (await get(u.auth, "/achievements")).achievements;
    expect(a.find((x: { id: string }) => x.id === "first_workout").state).toBe("locked");
    expect(a.find((x: { id: string }) => x.id === "first_rep").state).toBe("locked");
  });
});

describe("personal records", () => {
  it("a first value is a baseline; beating it emits a PR event and XP; a big jump is held; the list compares by direction", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    const first = await trainOn(u, "2026-09-28", squats("2026-09-28", 60));
    expect(first.prs.filter((p: { exerciseId: string }) => p.exerciseId === "squat").every((p: { previous: null }) => p.previous === null)).toBe(true);
    expect(first.workout.breakdown.personalRecords).toBe(0);

    const second = await trainOn(u, "2026-10-05", squats("2026-10-05", 65));
    const beaten = second.prs.filter((p: { previous: number | null }) => p.previous !== null);
    expect(beaten).toEqual(expect.arrayContaining([expect.objectContaining({ exerciseId: "squat", kind: "max_load", value: 65, previous: 60, status: "awarded" })]));
    // Heavier load also beat the estimated 1RM — still one improved exercise, so one PR bonus and one celebration.
    expect(beaten.map((p: { kind: string }) => p.kind).sort()).toEqual(["estimated_1rm", "max_load"]);
    expect(second.workout.breakdown.personalRecords).toBe(1);
    const prCelebrations = (await get(u.auth, "/celebrations")).celebrations.filter((c: { kind: string }) => c.kind === "personal_record");
    expect(prCelebrations.map((c: { payload: { kind: string; display: string } }) => [c.payload.kind, c.payload.display])).toEqual([["max_load", "65 kg"]]);
    expect((await post(u.auth, "/celebrations/seen", { ids: [prCelebrations[0].id] })).json()).toEqual({ marked: 2 });
    const events = ctx.db.prepare("SELECT payload FROM domain_events WHERE user_id = ? AND type = 'personal_record.set'").all(u.id).map((r) => JSON.parse((r as { payload: string }).payload));
    expect(events).toEqual(expect.arrayContaining([expect.objectContaining({ exerciseId: "squat", kind: "max_load", value: 65, previous: 60, display: "65 kg", rewarded: true })]));
    // Every PR event points at a real, beaten record.
    for (const e of events) expect(ctx.db.prepare("SELECT previous FROM personal_records WHERE id = ?").get(e.recordId)).toEqual({ previous: e.previous });

    const third = await trainOn(u, "2026-10-07", squats("2026-10-07", 100));
    expect(third.prs.find((p: { kind: string }) => p.kind === "max_load")).toMatchObject({ value: 100, status: "needs_review" });
    const records = (await get(u.auth, "/records")).records;
    expect(records.find((r: { exerciseId: string; kind: string }) => r.exerciseId === "squat" && r.kind === "max_load")).toMatchObject({ value: 65, previous: 60, display: "65 kg", direction: "higher", recent: true });
    expect(records.find((r: { kind: string }) => r.kind === "longest_streak")).toMatchObject({ exerciseId: null, label: "Longest training streak" });
    expect((await get(u.auth, "/achievements")).achievements.find((a: { id: string }) => a.id === "pr_breaker").state).toBe("unlocked");
    expect(() => ctx.db.prepare("UPDATE personal_records SET value = 500").run()).toThrow(/append-only/);
  });

  it("self-logged sets never set exercise records", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    const r = await trainOn(u, "2026-09-28", pushUps("2026-09-28"));
    expect(r.prs.filter((p: { exerciseId: string }) => p.exerciseId !== "*")).toEqual([]);
  });
});

describe("streaks", () => {
  it("workout streaks respect planned rest; weekly consistency counts weeks on plan; milestones celebrate once, collapsed", async () => {
    const u = await user("2026-09-28T12:00:00Z"); // Mon, 3 days a week → up to 2 rest days in a row
    for (const d of ["2026-09-28", "2026-09-30", "2026-10-02", "2026-10-05", "2026-10-07", "2026-10-09"]) await trainOn(u, d, pushUps(d));
    const celebrations = (await get(u.auth, "/celebrations")).celebrations.filter((c: { kind: string }) => c.kind === "streak");
    expect(celebrations.map((c: { payload: { streak: string; length: number } }) => [c.payload.streak, c.payload.length]).sort()).toEqual([["weekly", 2], ["workout", 3]]);
    await post(u.auth, "/celebrations/seen", { ids: celebrations.map((c: { id: number }) => c.id) });
    expect((await get(u.auth, "/celebrations")).celebrations.filter((c: { kind: string }) => c.kind === "streak")).toEqual([]);

    u.clock.set("2026-10-11T12:00:00Z"); // Sun: Sat and Sun are planned rest
    let s = (await get(u.auth, "/streaks")).streaks;
    expect(s.workout).toMatchObject({ current: 6, longest: 6, plannedRestDays: 2 });
    expect(s.weekly).toMatchObject({ current: 2, metThisWeek: true, target: 3 });
    // Each milestone is one event per run, however often streaks are read.
    const milestones = ctx.db.prepare("SELECT key FROM domain_events WHERE user_id = ? AND type = 'streak.milestone' ORDER BY id").all(u.id).map((r) => (r as { key: string }).key);
    expect(milestones).toEqual(["workout:2026-09-28:3", "weekly:2026-09-28:2"]);

    u.clock.set("2026-10-13T12:00:00Z"); // Tue: Fri→Tue is 3 days without training → broken
    s = (await get(u.auth, "/streaks")).streaks;
    expect(s.workout).toMatchObject({ current: 0, longest: 6 });
    expect(s.weekly.current).toBe(2); // this week is still open
  });

  it("several milestones of one run collapse into the biggest celebration, and dismissing it covers them all", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    for (let i = 0; i < 7; i++) {
      const d = `2026-10-0${i + 1}`;
      await trainOn(u, d, pushUps(d));
    }
    const streak = (await get(u.auth, "/celebrations")).celebrations.filter((c: { kind: string; payload: { streak: string } }) => c.kind === "streak" && c.payload.streak === "workout");
    expect(streak.map((c: { payload: { length: number } }) => c.payload.length)).toEqual([7]);
    expect((await post(u.auth, "/celebrations/seen", { ids: [streak[0].id] })).json()).toEqual({ marked: 2 }); // 3 and 7
  });

  it("a once-a-week plan keeps a weekly-trainer's streak alive", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { trainingDaysPerWeek: 1, localDate: "2026-09-28" } });
    for (const d of ["2026-09-28", "2026-10-05", "2026-10-12"]) await trainOn(u, d, pushUps(d));
    expect((await get(u.auth, "/streaks")).streaks.workout).toMatchObject({ current: 3, plannedRestDays: 6 });
  });

  it("nutrition and quest streaks come from finished on-track days and completed daily quests", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    const { target_kcal: kcal } = ctx.db.prepare("SELECT target_kcal FROM nutrition_targets WHERE user_id = ?").get(u.id) as { target_kcal: number };
    for (const d of ["2026-09-28", "2026-09-29"]) {
      u.clock.set(`${d}T12:00:00Z`);
      for (let i = 0; i < 3; i++) {
        await post(u.auth, "/nutrition/logs", { clientLogId: randomUUID(), localDate: d, amountMethod: "estimated", manual: { name: `Meal ${i}`, kcal: Math.round(kcal / 3), proteinG: 40, carbsG: 60, fatG: 20 } });
      }
      await get(u.auth, "/streaks"); // the day's quests are evaluated as the user uses the app
    }
    u.clock.set("2026-09-30T12:00:00Z");
    const s = (await get(u.auth, "/streaks")).streaks;
    expect(s.nutrition).toMatchObject({ current: 2, available: true, activeToday: false }); // today is still open
    expect(s.quest).toMatchObject({ current: 2 });
  });

  it("uses the user's own time zone for today", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { timezone: "Pacific/Auckland" } });
    u.clock.set("2026-09-28T11:30:00Z"); // 00:30 on Tue 29 Sep in Auckland
    expect((await post(u.auth, "/workouts", pushUps("2026-09-29"))).statusCode).toBe(201);
    const r = await get(u.auth, "/streaks");
    expect(r.today).toBe("2026-09-29");
    expect(r.streaks.workout).toMatchObject({ current: 1, activeToday: true });
  });
});

describe("Body Quest", () => {
  it("is honest without data, computes from real training, and keeps immutable weekly snapshots", async () => {
    const u = await user("2026-09-07T12:00:00Z"); // Mon
    const empty = (await get(u.auth, "/body-quest")).bodyQuest;
    expect(empty).toMatchObject({ stage: "starter", overall: null, statsWithData: 0, snapshots: [] });
    expect(empty.stats.strength).toMatchObject({ value: null, status: "insufficient_data", needs: "verify_same_exercise_twice" });

    const days = ["2026-09-07", "2026-09-09", "2026-09-11", "2026-09-14", "2026-09-16", "2026-09-18", "2026-09-21", "2026-09-23", "2026-09-25"];
    for (const [i, d] of days.entries()) await trainOn(u, d, squats(d, 60 + i * 2.5));
    u.clock.set("2026-09-28T12:00:00Z");
    const bq = (await get(u.auth, "/body-quest")).bodyQuest;
    expect(bq.stats.strength.status).toBe("ok");
    expect(bq.stats.strength.value).toBeGreaterThan(0);
    expect(bq.stats.form.status).toBe("ok"); // 45 verified, scored reps in the window
    expect(bq.stats.consistency.value).toBe(100); // 3 a week, as planned
    expect(bq.statsWithData).toBeGreaterThanOrEqual(5);
    expect(bq.stage).not.toBe("starter");
    // One snapshot per finished week, evaluated as of that Sunday.
    expect(bq.snapshots.map((s: { weekStart: string; asOf: string }) => [s.weekStart, s.asOf])).toEqual([
      ["2026-09-07", "2026-09-13"],
      ["2026-09-14", "2026-09-20"],
      ["2026-09-21", "2026-09-27"],
    ]);
    expect(bq.snapshots[0].engineVersion).toBe(1);
    // Re-reading never rewrites history.
    const again = (await get(u.auth, "/body-quest")).bodyQuest;
    expect(again.snapshots).toEqual(bq.snapshots);
    expect(() => ctx.db.prepare("UPDATE body_quest_snapshots SET stage = 'elite'").run()).toThrow(/history/);
    // Each stage reached is one event, ever.
    const stages = ctx.db.prepare("SELECT key, COUNT(*) AS n FROM domain_events WHERE user_id = ? AND type = 'body_quest.stage_reached' GROUP BY key").all(u.id) as { key: string; n: number }[];
    expect(stages.length).toBeGreaterThan(0);
    expect(stages.every((s) => s.n === 1)).toBe(true);
    expect(stages.map((s) => s.key)).toContain(bq.stage);
  });
});

describe("celebrations and isolation", () => {
  it("celebrates real events once, privately, until seen", async () => {
    const a = await user("2026-09-28T12:00:00Z");
    const b = await registerUser(app);
    await trainOn(a, "2026-09-28", squats("2026-09-28"));
    const mine = (await get(a.auth, "/celebrations")).celebrations;
    expect(mine.filter((c: { kind: string }) => c.kind === "achievement").map((c: { payload: { achievementId: string } }) => c.payload.achievementId).sort()).toEqual(["first_rep", "first_workout"]);
    // Another user can neither see nor dismiss them.
    expect((await get(b.auth, "/celebrations")).celebrations).toEqual([]);
    expect((await post(b.auth, "/celebrations/seen", { ids: mine.map((c: { id: number }) => c.id) })).json()).toEqual({ marked: 0 });
    expect((await get(a.auth, "/celebrations")).celebrations).toHaveLength(mine.length);
    await post(a.auth, "/celebrations/seen", { ids: mine.map((c: { id: number }) => c.id) });
    expect((await get(a.auth, "/celebrations")).celebrations).toEqual([]);
    // B's recognition is untouched by A's training.
    expect((await get(b.auth, "/achievements")).achievements.every((x: { state: string }) => x.state === "locked")).toBe(true);
    expect((await get(b.auth, "/records")).records).toEqual([]);
    expect((await get(b.auth, "/streaks")).streaks.workout.current).toBe(0);
    expect((await get(b.auth, "/body-quest")).bodyQuest.statsWithData).toBe(0);
    // Old celebrations are history, not news.
    a.clock.set("2026-10-20T12:00:00Z");
    await trainOn(a, "2026-10-20", pushUps("2026-10-20"));
    expect((await get(a.auth, "/celebrations")).celebrations.every((c: { at: string }) => c.at >= "2026-10-13")).toBe(true);
  });

  it("deleting an account removes all recognition data (history is only append-only while the user exists)", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    await trainOn(u, "2026-09-28", squats("2026-09-28"));
    await get(u.auth, "/body-quest");
    ctx.db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    for (const t of ["personal_records", "user_achievements", "body_quest_snapshots", "celebration_seen", "domain_events", "xp_events"]) {
      expect(ctx.db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`).get(u.id)).toEqual({ n: 0 });
    }
  });
});
