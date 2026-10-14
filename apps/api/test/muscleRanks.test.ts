import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp, onboard, registerUser, squatTrace, TestClock } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
type Rank = { muscle: string; tier: string; level: number; sets: number; nextTier: string | null; setsToNext: number | null };
const AT = "2026-09-30T12:00:00Z";

async function user() {
  const clock = new TestClock(new Date(AT));
  ({ app } = await makeApp({ clock }));
  const u = await registerUser(app);
  await onboard(app, u.auth, AT.slice(0, 10));
  return { ...u, clock };
}
const ranks = async (auth: Auth, q = "") => (await app.inject({ method: "GET", url: `/progress/muscle-ranks${q}`, headers: auth })).json() as { windowDays: number; from: string; to: string; ranks: Rank[] };
const squats = (localDate: string, nSets: number, painLevel = "none") => ({
  clientWorkoutId: randomUUID(),
  localDate,
  durationMinutes: 30,
  painLevel,
  sets: Array.from({ length: nSets }, () => ({ exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5, 90) })),
});
async function train(u: { auth: Auth; clock: TestClock }, date: string, body: object) {
  u.clock.set(`${date}T12:00:00Z`);
  expect((await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: body })).statusCode).toBe(201);
  u.clock.set(AT); // back to "today"
}

describe("GET /progress/muscle-ranks", () => {
  it("requires sign-in", async () => {
    ({ app } = await makeApp({ clock: new TestClock(new Date(AT)) }));
    expect((await app.inject({ method: "GET", url: "/progress/muscle-ranks" })).statusCode).toBe(401);
  });

  it("ranks every muscle as untrained for a brand-new user", async () => {
    const u = await user();
    const r = await ranks(u.auth);
    expect(r).toMatchObject({ windowDays: 28, from: "2026-09-03", to: "2026-09-30" });
    expect(r.ranks).toHaveLength(13);
    expect(r.ranks.every((m) => m.tier === "untrained" && m.sets === 0 && m.nextTier === "bronze" && m.setsToNext === 4)).toBe(true);
  });

  it("ranks from real verified sets, weakest muscles first", async () => {
    const u = await user();
    await train(u, "2026-09-28", squats("2026-09-28", 4));
    const r = await ranks(u.auth);
    const by = Object.fromEntries(r.ranks.map((m) => [m.muscle, m]));
    expect(by.quads).toMatchObject({ tier: "bronze", level: 1, sets: 4, nextTier: "silver", setsToNext: 12 });
    expect(by.glutes!.sets).toBe(4);
    expect(by.hamstrings).toMatchObject({ sets: 2, tier: "untrained" }); // secondary: half
    expect(by.chest).toMatchObject({ sets: 0, tier: "untrained" });
    expect(r.ranks[0]!.tier).toBe("untrained");
    expect(r.ranks.slice(-2).map((m) => m.muscle).sort()).toEqual(["glutes", "quads"]);
  });

  it("leaves out serious-pain workouts and sets older than 28 days", async () => {
    const u = await user();
    await train(u, "2026-09-02", squats("2026-09-02", 10)); // 29 days back
    await train(u, "2026-09-20", squats("2026-09-20", 10, "serious"));
    const r = await ranks(u.auth);
    expect(r.ranks.every((m) => m.tier === "untrained" && m.sets === 0)).toBe(true);
    await train(u, "2026-09-03", squats("2026-09-03", 4)); // first day of the window
    expect((await ranks(u.auth)).ranks.find((m) => m.muscle === "quads")).toMatchObject({ tier: "bronze", sets: 4 });
  });

  it("only counts the signed-in user's sets, and rejects unknown query keys", async () => {
    const a = await user();
    await train(a, "2026-09-28", squats("2026-09-28", 4));
    const b = await registerUser(app);
    await onboard(app, b.auth, AT.slice(0, 10));
    expect((await ranks(b.auth)).ranks.every((m) => m.sets === 0)).toBe(true);
    expect((await app.inject({ method: "GET", url: "/progress/muscle-ranks?bogus=1", headers: a.auth })).statusCode).toBe(400);
  });
});
