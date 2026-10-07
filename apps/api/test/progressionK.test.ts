import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { progressFromXp, xpRequiredForLevel } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { correctXp } from "../src/modules/progression/service";
import type { AppContext } from "../src/shared/context";
import { makeApp, onboard, registerUser, TestClock } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const get = async (auth: Auth, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();
const post = (auth: Auth, url: string, payload: object) => app.inject({ method: "POST", url, headers: auth, payload });

/** A manual (self-logged) workout: recorded reps only, so XP is simple and predictable. */
const workout = (localDate: string, extra: Record<string, unknown> = {}) => ({
  clientWorkoutId: randomUUID(),
  localDate,
  durationMinutes: 30,
  painLevel: "none",
  sets: [{ exerciseId: "push_up", reps: 20 }],
  ...extra,
});

async function user(at: string) {
  const clock = new TestClock(new Date(at));
  ({ app, ctx } = await makeApp({ clock }));
  const u = await registerUser(app);
  await onboard(app, u.auth, at.slice(0, 10)); // 3 training days a week
  return { ...u, clock };
}

const ledger = (userId: string) => ctx.db.prepare("SELECT source, source_key AS ref, kind, xp, local_date AS date FROM xp_events WHERE user_id = ? ORDER BY id").all(userId) as { source: string; ref: string; kind: string; xp: number; date: string }[];

describe("workout XP through the ledger", () => {
  it("is computed server-side from the validated workout.completed event, once", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    const body = workout("2026-09-28");
    const res = await post(u.auth, "/workouts", body);
    expect(res.statusCode).toBe(201);
    // 20 recorded reps × 0.5 (cap 40) + 25 completion.
    expect(res.json().workout.xp).toBe(35);
    const row = ctx.db.prepare("SELECT e.kind, e.xp, e.idempotency_key AS key, d.type FROM xp_events e JOIN domain_events d ON d.id = e.domain_event_id WHERE e.user_id = ? AND e.source = 'workout'").get(u.id);
    expect(row).toEqual({ kind: "award", xp: 35, key: `workout:${res.json().workout.id}`, type: "workout.completed" });
    // Retries and a burst of duplicates award nothing more.
    await Promise.all([post(u.auth, "/workouts", body), post(u.auth, "/workouts", body), post(u.auth, "/workouts", body)]);
    expect(ledger(u.id).filter((e) => e.source === "workout")).toHaveLength(1);
  });

  it("levels up and records a level_up event; level and rank are shown as LEVEL n — into / span", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    for (let i = 0; i < 3; i++) await post(u.auth, "/workouts", workout("2026-09-28")); // 35 + 35 + 35 → past 100
    const p = await get(u.auth, "/progress");
    // 105 from workouts + 20 from the First Workout achievement.
    expect(p).toMatchObject({ level: 2, rank: "Rookie", totalXp: 125, xpIntoLevel: 25, xpForNextLevel: xpRequiredForLevel(3) - xpRequiredForLevel(2) });
    expect(p.recentLevelUp).toMatchObject({ level: 2, rank: "Rookie" });
    expect(p.rankLadder.map((r: { name: string }) => r.name)).toEqual(["Rookie", "Starter", "Athlete", "Iron", "Elite", "Master", "Champion"]);
  });

  it("ranks follow levels; corrections are compensating entries, never edits", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    await post(u.auth, "/workouts", workout("2026-09-28"));
    expect(correctXp(ctx.db, { userId: u.id, xp: xpRequiredForLevel(10), reason: "support: migrated history", reference: "ticket-1", correctionId: "c1", now: u.clock.now() })).toBe(true);
    expect(correctXp(ctx.db, { userId: u.id, xp: xpRequiredForLevel(10), reason: "duplicate", reference: "ticket-1", correctionId: "c1", now: u.clock.now() })).toBe(false); // idempotent
    const p = await get(u.auth, "/progress");
    expect(p).toMatchObject({ level: 10, rank: "Athlete" });
    expect(ledger(u.id).map((e) => [e.source, e.kind])).toEqual([["workout", "award"], ["achievement", "award"], ["correction", "correction"]]);
  });
});

describe("decay for a missed training day", () => {
  it("planned rest never decays; once the week can't be met, each missed day decays once", async () => {
    const u = await user("2026-09-28T12:00:00Z"); // Mon
    await post(u.auth, "/workouts", workout("2026-09-28"));
    u.clock.set("2026-10-03T12:00:00Z"); // Sat: Tue–Fri evaluated — all still plannable rest
    await get(u.auth, "/progress");
    expect(ledger(u.id).filter((e) => e.source === "decay")).toEqual([]);
    u.clock.set("2026-10-04T12:00:00Z"); // Sun: Sat evaluated — 2 sessions owed, 1 day left → missed
    await get(u.auth, "/progress");
    await get(u.auth, "/progress"); // at most once per day
    expect(ledger(u.id).filter((e) => e.source === "decay")).toEqual([{ source: "decay", ref: "2026-10-03", kind: "decay", xp: -10, date: "2026-10-03" }]);
    expect((await get(u.auth, "/progress")).totalXp).toBe(45); // 35 + 20 (First Workout) − 10
  });

  it("training on plan has no missed days", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    for (const [at, date] of [["2026-09-28T12:00:00Z", "2026-09-28"], ["2026-09-30T12:00:00Z", "2026-09-30"], ["2026-10-02T12:00:00Z", "2026-10-02"], ["2026-10-05T12:00:00Z", "2026-10-05"]] as const) {
      u.clock.set(at);
      await post(u.auth, "/workouts", workout(date));
    }
    u.clock.set("2026-10-06T12:00:00Z");
    await get(u.auth, "/progress");
    expect(ledger(u.id).filter((e) => e.source === "decay" || e.source === "reset")).toEqual([]);
  });

  it("recovery after reported serious pain is never punished", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    await post(u.auth, "/workouts", workout("2026-09-28"));
    u.clock.set("2026-09-29T12:00:00Z");
    const pain = await post(u.auth, "/workouts", workout("2026-09-29", { painLevel: "serious" }));
    expect(pain.json().workout.xp).toBe(0); // unsafe training earns nothing
    u.clock.set("2026-10-04T12:00:00Z");
    const p = await get(u.auth, "/progress");
    // Tue pain → Wed–Fri recovery; the week's target drops, so nothing is missed through Saturday.
    expect(ledger(u.id).filter((e) => e.source === "decay" || e.source === "reset")).toEqual([]);
    expect(p.consistency.recovering).toBe(false);
  });

  it("a workout logged late for a decayed day cancels that decay with a compensating entry", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    await post(u.auth, "/workouts", workout("2026-09-28"));
    u.clock.set("2026-10-04T08:00:00Z");
    await get(u.auth, "/progress"); // Sat decays
    await post(u.auth, "/workouts", workout("2026-10-03")); // …but they did train on Saturday
    const decay = ledger(u.id).filter((e) => e.source === "decay");
    expect(decay.map((e) => [e.kind, e.xp])).toEqual([["decay", -10], ["adjustment", 10]]);
  });
});

describe("hard reset after more than 5 days without training", () => {
  it("resets active progression to Level 1 / Rookie / 0 XP and keeps all history", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    for (let i = 0; i < 3; i++) await post(u.auth, "/workouts", workout("2026-09-28"));
    const before = await get(u.auth, "/progress");
    expect(before.level).toBe(2);
    u.clock.set("2026-10-05T12:00:00Z"); // Sun 10-04 is the 6th day without a workout
    const p = await get(u.auth, "/progress");
    expect(p).toMatchObject({ level: 1, rank: "Rookie", totalXp: 0 });
    expect(p.lifetimeXp).toBe(125); // 105 workouts + 20 First Workout
    // Saturday was already a missed day (−10), so the reset took 115 XP of active progress.
    expect(p.lastReset).toMatchObject({ date: "2026-10-04", previousActiveXp: 115, previousLevel: 2, previousRank: "Rookie", gapDays: 6 });
    // Exactly one PROGRESSION_RESET event, linked from the ledger.
    const events = ctx.db.prepare("SELECT type, key FROM domain_events WHERE user_id = ? AND type = 'progression.reset'").all(u.id);
    expect(events).toEqual([{ type: "progression.reset", key: "2026-10-04" }]);
    // History is untouched: workouts, PRs, XP entries, food.
    expect((await get(u.auth, "/workouts")).workouts).toHaveLength(3);
    expect(ledger(u.id).filter((e) => e.source === "workout").map((e) => e.xp)).toEqual([35, 35, 35]);
    expect(ledger(u.id).at(-1)).toMatchObject({ kind: "reset", xp: 0 });
    // Training again starts climbing from zero.
    await post(u.auth, "/workouts", workout("2026-10-05"));
    expect((await get(u.auth, "/progress")).totalXp).toBe(35);
  });

  it("concurrent reads apply each day exactly once", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    await post(u.auth, "/workouts", workout("2026-09-28"));
    u.clock.set("2026-10-10T12:00:00Z");
    await Promise.all(Array.from({ length: 6 }, () => get(u.auth, "/progress")));
    const resets = ledger(u.id).filter((e) => e.kind === "reset");
    expect(resets).toHaveLength(1);
    const decayDates = ledger(u.id).filter((e) => e.kind === "decay").map((e) => e.date);
    expect(new Set(decayDates).size).toBe(decayDates.length);
  });

  it("uses the user's own time zone for days", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    await post(u.auth, "/workouts", workout("2026-09-28"));
    await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { timezone: "Pacific/Auckland" } });
    u.clock.set("2026-10-04T12:00:00Z"); // Auckland: already Mon 10-05 → Sun 10-04 is finished
    expect((await get(u.auth, "/progress")).lastReset).toMatchObject({ date: "2026-10-04" });
  });
});

describe("anti-cheat and isolation", () => {
  it("clients can't grant XP, complete quests, set level or rewrite history", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    expect((await post(u.auth, "/workouts", { ...workout("2026-09-28"), xp: 9999 })).statusCode).toBe(400);
    expect((await post(u.auth, "/workouts", workout("2026-09-28", { sets: [{ exerciseId: "push_up", reps: 20, verifiedReps: 20 }] }))).statusCode).toBe(400);
    for (const [method, url] of [["POST", "/xp/events"], ["PATCH", "/progress"], ["POST", "/quests/daily_log_meals/complete"], ["POST", "/records"]] as const) {
      expect((await app.inject({ method, url, headers: u.auth, payload: {} })).statusCode).toBe(404);
    }
    await post(u.auth, "/workouts", workout("2026-09-28"));
    expect(() => ctx.db.prepare("UPDATE xp_events SET xp = 5000 WHERE user_id = ?").run(u.id)).toThrow(/append-only/);
    expect(() => ctx.db.prepare("DELETE FROM xp_events WHERE user_id = ?").run(u.id)).toThrow(/append-only/);
    expect(() =>
      ctx.db.prepare("INSERT INTO xp_events (user_id, source, source_key, kind, xp, idempotency_key, created_at) VALUES (?, 'workout', 'x', 'award', -5, 'k', 'n')").run(u.id),
    ).toThrow(/CHECK/);
  });

  it("quests complete only from real data; dropping below the target withdraws with a compensating entry", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await post(u.auth, "/nutrition/logs", { clientLogId: randomUUID(), localDate: "2026-09-28", amountMethod: "estimated", manual: { name: `Meal ${i}`, kcal: 500, proteinG: 30, carbsG: 50, fatG: 15 } });
      ids.push(r.json().log.id);
    }
    await get(u.auth, "/progress");
    await app.inject({ method: "DELETE", url: `/nutrition/logs/${ids[0]}`, headers: u.auth });
    await get(u.auth, "/progress");
    const quest = ledger(u.id).filter((e) => e.source === "quest" && e.ref === "daily_log_meals:2026-09-28");
    expect(quest.map((e) => [e.kind, e.xp])).toEqual([["award", 10], ["adjustment", -10]]);
    const kinds = ctx.db.prepare("SELECT type FROM domain_events WHERE user_id = ? AND type LIKE 'quest.%' ORDER BY id").all(u.id).map((r) => (r as { type: string }).type);
    expect(kinds).toEqual(["quest.completed", "quest.withdrawn"]);
    const labels = (await get(u.auth, "/xp/events")).events.filter((e: { source: string }) => e.source === "quest").map((e: { label: string; xp: number }) => [e.label, e.xp]);
    expect(labels).toEqual([["Quest no longer complete", -10], ["Quest complete", 10]]);
  });

  it("one user's progression never touches another's", async () => {
    const a = await user("2026-09-28T12:00:00Z");
    const b = await registerUser(app);
    await post(a.auth, "/workouts", workout("2026-09-28"));
    expect((await get(b.auth, "/progress")).totalXp).toBe(0);
    expect((await get(b.auth, "/xp/events")).events).toEqual([]);
    a.clock.set("2026-10-10T12:00:00Z");
    await get(a.auth, "/progress");
    expect(ledger(b.id)).toEqual([]);
  });

  it("the ledger history endpoint explains every entry", async () => {
    const u = await user("2026-09-28T12:00:00Z");
    await post(u.auth, "/workouts", workout("2026-09-28"));
    u.clock.set("2026-10-05T12:00:00Z");
    const events = (await get(u.auth, "/xp/events")).events as { label: string; xp: number; kind: string }[];
    expect(events.map((e) => e.label)).toEqual(["Progress reset", "Missed training day", "Achievement: First Workout", "Workout"]);
    expect(progressFromXp(0).level).toBe(1);
  });
});
