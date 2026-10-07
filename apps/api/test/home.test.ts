import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp, foodLog, onboard, registerUser, TestClock, TODAY, workoutPayload } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

const get = async (auth: Record<string, string>, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();
const setZone = (auth: Record<string, string>, timezone: string) => app.inject({ method: "PATCH", url: "/me/settings", headers: auth, payload: { timezone } });
const addWater = (auth: Record<string, string>, ml: number, clientLogId: string = randomUUID()) =>
  app.inject({ method: "POST", url: "/water", headers: auth, payload: { clientLogId, ml } });
const logFood = (auth: Record<string, string>, localDate: string, over: object = {}) =>
  app.inject({ method: "POST", url: "/nutrition/logs", headers: auth, payload: foodLog({ localDate, ...over }) });

describe("new user", () => {
  it("gets a useful first action instead of an empty dashboard", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app, "newbie@example.com");
    const home = await get(u.auth, "/home");
    expect(home.state).toBe("new");
    expect(home.firstSteps).toEqual([
      { key: "workout", done: false },
      { key: "meal", done: false },
      { key: "water", done: false },
    ]);
    expect(home.today.suggestion).toEqual({ kind: "train", title: "Train today", reason: "Log a workout to start building your streak." });
    expect(home.today.lastWorkout).toBeNull();
    expect(home.greeting.name).toBe("newbie");
    expect(home.progression).toMatchObject({ level: 1, totalXp: 0, rank: "Rookie", nextRank: { name: "Starter", minLevel: 5 } });
    expect(home.nutrition).toMatchObject({ kcal: 0, mealsLogged: 0, targets: null });
    expect(home.water).toMatchObject({ totalMl: 0, targetMl: 2000, targetBasis: "default" });
    expect(home.quests.daily.every((q: { progress: number }) => q.progress === 0)).toBe(true);
    expect(home.errors).toEqual([]);
  });

  it("never offers features that aren't real", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const home = await get(u.auth, "/home");
    expect(home.coach).toEqual({ mode: "deterministic_fallback", provider: "FORM rules" }); // never presented as AI
    // Body Quest and achievements are real now — and honest for a brand-new user.
    expect(home.bodyQuest).toMatchObject({ available: true, stage: "starter", overall: null, statsWithData: 0 });
    expect(home.achievements).toMatchObject({ available: true, unlocked: 0, recent: [] });
    expect(home.streaks.workout).toEqual({ current: 0, longest: 0 });
    // No nutrition targets yet → no protein quest; no camera → no verified-reps quest.
    const ids = [...home.quests.daily, ...home.quests.weekly].map((q: { id: string }) => q.id);
    expect(ids).not.toContain("daily_protein");
    expect(ids).not.toContain("weekly_verified_reps");
  });
});

describe("returning and active users", () => {
  it("recognises a user coming back after a break", async () => {
    const clock = new TestClock(new Date("2026-09-22T12:00:00Z"));
    ({ app } = await makeApp({ clock }));
    const u = await registerUser(app);
    await onboard(app, u.auth, "2026-09-22");
    await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: workoutPayload({ localDate: "2026-09-22" }) });
    clock.set(`${TODAY}T12:00:00Z`);

    const home = await get(u.auth, "/home");
    expect(home.state).toBe("returning");
    expect(home.daysSinceLastActivity).toBe(5);
    expect(home.progression.streak.current).toBe(0);
    expect(home.today.lastWorkout).toMatchObject({ localDate: "2026-09-22", xp: 38, exercises: [{ name: "Barbell Back Squat", sets: 1, totalReps: 5, verifiedReps: 5, bestLoadKg: 60 }] });
    expect(home.firstSteps).toEqual([
      { key: "workout", done: true },
      { key: "meal", done: false },
      { key: "water", done: false },
    ]);
  });

  it("aggregates the same numbers the underlying endpoints report", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await onboard(app, u.auth);
    await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: workoutPayload() });
    await logFood(u.auth, TODAY, { kcal: 640, proteinG: 48, carbsG: 70, fatG: 16 });
    await addWater(u.auth, 500);

    const home = await get(u.auth, "/home");
    const progress = await get(u.auth, `/progress?today=${TODAY}`);
    const day = await get(u.auth, `/nutrition/days/${TODAY}`);
    const water = await get(u.auth, `/water/days/${TODAY}`);

    expect(home.state).toBe("active");
    expect(home.progression.totalXp).toBe(progress.totalXp);
    expect(home.progression.streak).toEqual(progress.streak);
    expect(home.nutrition).toMatchObject({ kcal: day.totals.kcal, proteinG: day.totals.proteinG, mealsLogged: 1 });
    expect(home.nutrition.targets.kcal).toBe(day.targets.targetKcal);
    expect(home.water).toMatchObject({ totalMl: water.totalMl, targetMl: water.targetMl, targetBasis: "body_weight", entries: 1 });
    expect(home.today).toMatchObject({ trainedToday: true, workoutsThisWeek: 1, plannedDaysPerWeek: 3, suggestion: { kind: "done_today" } });
    expect(home.firstSteps).toBeNull();
  });
});

describe("time zones and date boundaries", () => {
  it("uses the stored time zone as the authoritative date", async () => {
    const clock = new TestClock(new Date("2026-09-27T18:29:00Z")); // 23:59 in Kolkata
    ({ app } = await makeApp({ clock }));
    const u = await registerUser(app);
    expect((await setZone(u.auth, "Asia/Kolkata")).statusCode).toBe(200);
    await addWater(u.auth, 750);
    let home = await get(u.auth, "/home");
    expect(home).toMatchObject({ date: "2026-09-27", timezone: "Asia/Kolkata", timezoneSource: "stored", greeting: { period: "evening" } });
    expect(home.water.totalMl).toBe(750);

    clock.set("2026-09-27T18:31:00Z"); // 00:01 the next day in Kolkata
    home = await get(u.auth, "/home");
    expect(home.date).toBe("2026-09-28");
    expect(home.greeting.period).toBe("night");
    expect(home.water.totalMl).toBe(0); // yesterday's water isn't today's
    expect((await get(u.auth, "/water/days/2026-09-27")).totalMl).toBe(750);
    expect(home.quests.daily[0].periodKey).toBe("2026-09-28");
  });

  it("ignores a client-supplied date once a time zone is stored", async () => {
    const clock = new TestClock(new Date("2026-09-27T10:30:00Z"));
    ({ app } = await makeApp({ clock }));
    const u = await registerUser(app);
    await setZone(u.auth, "Pacific/Kiritimati"); // UTC+14 → already Sep 28
    const home = await get(u.auth, "/home?today=2026-09-26");
    expect(home.date).toBe("2026-09-28");
  });

  it("falls back to a plausible client date before a zone is saved, and rejects implausible ones", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await get(u.auth, "/home?today=2026-09-26")).date).toBe("2026-09-26");
    expect((await get(u.auth, "/home")).timezoneSource).toBe("utc");
    expect((await app.inject({ method: "GET", url: "/home?today=2026-09-01", headers: u.auth })).statusCode).toBe(422);
  });

  it("rejects unknown time zones", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await setZone(u.auth, "Mars/Olympus_Mons")).statusCode).toBe(400);
    expect((await get(u.auth, "/me/settings")).timezone).toBeNull();
  });

  it("starts a new weekly quest period on Monday in the user's zone", async () => {
    const clock = new TestClock(new Date("2026-09-27T20:00:00Z")); // Sunday evening in London (BST, UTC+1)
    ({ app } = await makeApp({ clock }));
    const u = await registerUser(app);
    await setZone(u.auth, "Europe/London");
    expect((await get(u.auth, "/home")).quests.weekly[0].periodKey).toBe("2026-09-21");
    clock.set("2026-09-27T23:30:00Z"); // 00:30 Monday in London
    expect((await get(u.auth, "/home")).quests.weekly[0].periodKey).toBe("2026-09-28");
  });
});

describe("quests and duplicate events", () => {
  it("completes a quest from real activity and awards XP exactly once", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    for (let i = 0; i < 3; i++) await logFood(u.auth, TODAY);

    const first = await get(u.auth, "/home");
    expect(first.quests.daily.find((q: { id: string }) => q.id === "daily_log_meals")).toMatchObject({ progress: 3, completed: true });
    const xpAfterFirst = first.progression.totalXp;

    // Repeated and simultaneous loads must not award it again.
    await Promise.all(Array.from({ length: 5 }, () => app.inject({ method: "GET", url: "/home", headers: u.auth })));
    await get(u.auth, "/quests");
    await get(u.auth, `/progress?today=${TODAY}`);
    const events = (await get(u.auth, "/xp/events")).events.filter((e: { source: string }) => e.source === "quest");
    expect(events).toEqual([expect.objectContaining({ reference: `daily_log_meals:${TODAY}`, kind: "award", xp: 10 })]);
    expect((await get(u.auth, "/home")).progression.totalXp).toBe(xpAfterFirst);
  });

  it("withdraws quest XP if the logs that completed it are deleted the same day", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await logFood(u.auth, TODAY)).json().log.id);
    const before = (await get(u.auth, "/home")).progression.totalXp;
    await app.inject({ method: "DELETE", url: `/nutrition/logs/${ids[0]}`, headers: u.auth });
    const after = await get(u.auth, "/home");
    expect(after.quests.daily.find((q: { id: string }) => q.id === "daily_log_meals")).toMatchObject({ progress: 2, completed: false });
    expect(after.progression.totalXp).toBe(before - 10);
  });

  it("counts a retried water quick-add once", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const id = randomUUID();
    expect((await addWater(u.auth, 250, id)).statusCode).toBe(201);
    const retry = await addWater(u.auth, 250, id);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().duplicate).toBe(true);
    expect((await get(u.auth, "/home")).water.totalMl).toBe(250);
  });

  it("offers the protein quest once targets exist and scores it from logged protein", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await onboard(app, u.auth);
    await logFood(u.auth, TODAY, { proteinG: 150, kcal: 900 });
    const protein = (await get(u.auth, "/home")).quests.daily.find((q: { id: string }) => q.id === "daily_protein");
    expect(protein).toMatchObject({ completed: true, xpReward: 15 });
  });
});

describe("water safety", () => {
  it("refuses dangerous daily amounts and malformed entries", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    for (let i = 0; i < 4; i++) await addWater(u.auth, 2000);
    const over = await addWater(u.auth, 100);
    expect(over.statusCode).toBe(422);
    expect(over.json().error.code).toBe("water_daily_limit");
    expect((await addWater(u.auth, 10)).statusCode).toBe(400);
    expect((await addWater(u.auth, 2500)).statusCode).toBe(400);
  });

  it("undoes the most recent entry even when two land in the same millisecond (regression)", async () => {
    ({ app } = await makeApp()); // fixed test clock: every entry gets the same timestamp
    const u = await registerUser(app);
    for (let i = 0; i < 5; i++) {
      await addWater(u.auth, 250);
      const last = (await addWater(u.auth, 500)).json().entry.id;
      expect((await get(u.auth, "/home")).water.lastEntryId).toBe(last);
    }
  });

  it("keeps water logs private", async () => {
    ({ app } = await makeApp());
    const a = await registerUser(app);
    const b = await registerUser(app);
    const entry = (await addWater(a.auth, 300)).json().entry;
    expect((await get(b.auth, "/home")).water.totalMl).toBe(0);
    expect((await app.inject({ method: "DELETE", url: `/water/${entry.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/water/${entry.id}`, headers: a.auth })).statusCode).toBe(204);
  });
});

describe("persistence and errors", () => {
  it("keeps Home data across a server restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "form-home-"));
    try {
      ({ app } = await makeApp({ config: { databasePath: join(dir, "home.db") } }));
      const u = await registerUser(app);
      await setZone(u.auth, "Europe/London");
      await addWater(u.auth, 400);
      await logFood(u.auth, TODAY);
      await app.close();

      ({ app } = await makeApp({ config: { databasePath: join(dir, "home.db") } }));
      const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: u.email, password: "correct-horse-battery" } });
      const home = await get({ authorization: `Bearer ${login.json().token}` }, "/home");
      expect(home).toMatchObject({ timezone: "Europe/London", water: { totalMl: 400 }, nutrition: { mealsLogged: 1 } });
      await app.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("degrades one section at a time instead of failing the whole Home", async () => {
    let ctxRef: Awaited<ReturnType<typeof makeApp>>["ctx"];
    ({ app, ctx: ctxRef } = await makeApp());
    const u = await registerUser(app);
    await logFood(u.auth, TODAY);
    ctxRef.db.exec("DROP TABLE water_logs"); // simulate a broken subsystem
    const res = await app.inject({ method: "GET", url: "/home", headers: u.auth });
    expect(res.statusCode).toBe(200);
    const home = res.json();
    expect(home.errors).toEqual(expect.arrayContaining(["water"]));
    expect(home.water).toBeNull();
    expect(home.nutrition.mealsLogged).toBe(1);
    expect(home.progression).not.toBeNull();
  });

  it("requires authentication", async () => {
    ({ app } = await makeApp());
    for (const [method, url] of [
      ["GET", "/home"],
      ["GET", "/quests"],
      ["POST", "/water"],
      ["GET", `/water/days/${TODAY}`],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode, url).toBe(401);
    }
  });
});
