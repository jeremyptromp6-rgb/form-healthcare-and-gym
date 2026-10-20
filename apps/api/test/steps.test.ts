import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { migrate, openDb, schemaVersion } from "../src/db";
import { MIGRATIONS } from "../src/db/migrations";
import type { AppContext } from "../src/shared/context";
import { makeApp, onboard, registerUser, TestClock, TODAY, YESTERDAY } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;

async function user(timezone?: string) {
  const clock = new TestClock();
  ({ app, ctx } = await makeApp({ clock }));
  const u = await registerUser(app);
  await onboard(app, u.auth);
  if (timezone) await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { timezone } });
  return { ...u, clock };
}
const post = (auth: Auth, payload: unknown) => app.inject({ method: "POST", url: "/steps", headers: auth, payload: payload as object });
const stepsXpTotal = (userId: string) => (ctx.db.prepare("SELECT COALESCE(SUM(xp), 0) AS n FROM xp_events WHERE user_id = ? AND source = 'steps'").get(userId) as { n: number }).n;
const stepsRows = (userId: string) => ctx.db.prepare("SELECT local_date AS d, steps FROM steps_daily WHERE user_id = ? ORDER BY local_date").all(userId) as { d: string; steps: number }[];

describe("POST /steps", () => {
  it("requires authentication on both routes", async () => {
    ({ app, ctx } = await makeApp());
    expect((await app.inject({ method: "POST", url: "/steps", payload: { localDate: TODAY, steps: 1000 } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/steps" })).statusCode).toBe(401);
  });

  it("stores the day and awards 1 XP per full 1,000 steps", async () => {
    const u = await user();
    const res = await post(u.auth, { localDate: TODAY, steps: 4_999 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ localDate: TODAY, steps: 4_999, xp: 4 });
    expect(stepsXpTotal(u.id)).toBe(4);
    expect(stepsRows(u.id)).toEqual([{ d: TODAY, steps: 4_999 }]);
  });

  it("caps the reward at 10 XP a day", async () => {
    const u = await user();
    expect((await post(u.auth, { localDate: TODAY, steps: 60_000 })).json()).toMatchObject({ steps: 60_000, xp: 10 });
    expect(stepsXpTotal(u.id)).toBe(10);
    await post(u.auth, { localDate: TODAY, steps: 12_000 }); // lower than stored: nothing changes
    expect(stepsXpTotal(u.id)).toBe(10);
  });

  it("a repeated sync is idempotent, a bigger one awards only the difference, a smaller one is ignored", async () => {
    const u = await user();
    await post(u.auth, { localDate: TODAY, steps: 3_200 });
    await post(u.auth, { localDate: TODAY, steps: 3_200 });
    expect(stepsXpTotal(u.id)).toBe(3);
    const more = await post(u.auth, { localDate: TODAY, steps: 7_100 });
    expect(more.json()).toMatchObject({ steps: 7_100, xp: 7 });
    expect(stepsXpTotal(u.id)).toBe(7);
    const lower = await post(u.auth, { localDate: TODAY, steps: 1_000 });
    expect(lower.json()).toMatchObject({ steps: 7_100, xp: 7 }); // the day keeps its highest value
    expect(stepsXpTotal(u.id)).toBe(7);
    expect(stepsRows(u.id)).toEqual([{ d: TODAY, steps: 7_100 }]);
    const entries = ctx.db.prepare("SELECT kind, xp FROM xp_events WHERE user_id = ? AND source = 'steps' ORDER BY id").all(u.id);
    expect(entries).toEqual([
      { kind: "award", xp: 3 },
      { kind: "adjustment", xp: 4 },
    ]);
  });

  it("under 1,000 steps stores the day but awards nothing", async () => {
    const u = await user();
    expect((await post(u.auth, { localDate: TODAY, steps: 999 })).json()).toMatchObject({ steps: 999, xp: 0 });
    expect(stepsXpTotal(u.id)).toBe(0);
    expect(stepsRows(u.id)).toHaveLength(1);
  });

  it("accepts today and yesterday, rejects older days and the future (once a time zone is saved)", async () => {
    const u = await user("Europe/London");
    expect((await post(u.auth, { localDate: YESTERDAY, steps: 2_000 })).statusCode).toBe(200);
    expect((await post(u.auth, { localDate: "2026-09-25", steps: 2_000 })).statusCode).toBe(422);
    expect((await post(u.auth, { localDate: "2026-09-28", steps: 2_000 })).statusCode).toBe(422);
    expect(stepsRows(u.id)).toEqual([{ d: YESTERDAY, steps: 2_000 }]);
  });

  it("judges the date in the time zone of the user", async () => {
    const u = await user("Pacific/Auckland"); // 12:00 UTC on the 27th is already the 28th there
    expect((await post(u.auth, { localDate: "2026-09-28", steps: 1_500 })).statusCode).toBe(200);
    expect((await post(u.auth, { localDate: "2026-09-27", steps: 1_500 })).statusCode).toBe(200);
    expect((await post(u.auth, { localDate: "2026-09-26", steps: 1_500 })).statusCode).toBe(422);
  });

  it("validates strictly", async () => {
    const u = await user();
    const bad: unknown[] = [
      { localDate: TODAY, steps: -1 },
      { localDate: TODAY, steps: 60_001 },
      { localDate: TODAY, steps: 10.5 },
      { localDate: TODAY, steps: "5000" },
      { localDate: "27/09/2026", steps: 100 },
      { steps: 100 },
      { localDate: TODAY },
      { localDate: TODAY, steps: 100, xp: 99 },
    ];
    for (const payload of bad) expect((await post(u.auth, payload)).statusCode, JSON.stringify(payload)).toBe(422);
    expect(stepsRows(u.id)).toEqual([]);
    expect(stepsXpTotal(u.id)).toBe(0);
  });

  it("is per user", async () => {
    const a = await user();
    const b = await registerUser(app);
    await post(a.auth, { localDate: TODAY, steps: 5_000 });
    expect(stepsRows(b.id)).toEqual([]);
    expect((await app.inject({ method: "GET", url: "/steps", headers: b.auth })).json().days.at(-1)).toMatchObject({ date: TODAY, steps: 0 });
  });

  it("is not a workout, a streak day or a quest day", async () => {
    const u = await user();
    const streakBefore = (await app.inject({ method: "GET", url: "/streaks", headers: u.auth })).json().streaks.workout;
    const questsBefore = (await app.inject({ method: "GET", url: "/quests", headers: u.auth })).json();
    await post(u.auth, { localDate: TODAY, steps: 20_000 });
    await post(u.auth, { localDate: YESTERDAY, steps: 20_000 });
    const streakAfter = (await app.inject({ method: "GET", url: "/streaks", headers: u.auth })).json().streaks.workout;
    expect(streakAfter).toEqual(streakBefore);
    expect(streakAfter.current).toBe(0);
    expect((await app.inject({ method: "GET", url: "/quests", headers: u.auth })).json()).toEqual(questsBefore);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM workouts WHERE user_id = ?").get(u.id) as { n: number }).n).toBe(0);
    expect(stepsXpTotal(u.id)).toBe(20);
  });
});

describe("GET /steps", () => {
  it("returns a zero-filled, oldest-first window with the goal", async () => {
    const u = await user();
    await post(u.auth, { localDate: YESTERDAY, steps: 2_500 });
    await post(u.auth, { localDate: TODAY, steps: 9_000 });
    const res = await app.inject({ method: "GET", url: "/steps?days=3", headers: u.auth });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      goal: 8_000,
      days: [
        { date: "2026-09-25", steps: 0, xp: 0 },
        { date: YESTERDAY, steps: 2_500, xp: 2 },
        { date: TODAY, steps: 9_000, xp: 9 },
      ],
    });
    expect((await app.inject({ method: "GET", url: "/steps", headers: u.auth })).json().days).toHaveLength(7);
    expect((await app.inject({ method: "GET", url: "/steps?days=0", headers: u.auth })).statusCode).toBe(400);
  });
});

describe("migration 27", () => {
  it("keeps existing ledger rows and the append-only triggers while allowing the steps source", () => {
    const db = openDb(":memory:", MIGRATIONS.filter((m) => m.version <= 26));
    expect(schemaVersion(db)).toBe(26);
    db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'a@b.c', 'x', 'now')").run();
    db.prepare(
      "INSERT INTO xp_events (user_id, source, source_key, kind, xp, idempotency_key, local_date, created_at) VALUES ('u1', 'quest', 'q:2026-09-27', 'award', 5, 'quest:q:2026-09-27', '2026-09-27', 'now')",
    ).run();
    migrate(db);
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    expect(db.prepare("SELECT source, xp FROM xp_events").all()).toEqual([{ source: "quest", xp: 5 }]);
    db.prepare("INSERT INTO xp_events (user_id, source, source_key, kind, xp, idempotency_key, local_date, created_at) VALUES ('u1', 'steps', '2026-09-27', 'award', 3, 'steps:2026-09-27:0', '2026-09-27', 'now')").run();
    expect(() => db.prepare("UPDATE xp_events SET xp = 99").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM xp_events").run()).toThrow(/append-only/);
    db.close();
  });
});
