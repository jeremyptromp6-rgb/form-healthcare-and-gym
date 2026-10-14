import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { appendXp } from "../src/modules/progression/service";
import { MIN_STANDING_POPULATION, topPercent } from "../src/modules/analytics/standing";
import type { AppContext } from "../src/shared/context";
import { makeApp, registerUser, TestClock } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

const AT = "2026-09-30T12:00:00Z";
const NOW = new Date(AT);
type Auth = Record<string, string>;

async function boot() {
  ({ app, ctx } = await makeApp({ clock: new TestClock(NOW) }));
}
let seq = 0;
const give = (userId: string, xp: number, kind: "award" | "reset" = "award") =>
  appendXp(ctx.db, { userId, source: kind === "reset" ? "reset" : "workout", reference: `t${++seq}`, kind, xp, idempotencyKey: `t${seq}`, localDate: "2026-09-30", detail: {}, now: NOW });
const standing = async (auth: Auth, q = "") => app.inject({ method: "GET", url: `/progress/standing${q}`, headers: auth });
/** One user per entry, inserted directly (sign-up is rate limited), each with that much XP. Returns their ids. */
async function crowd(xps: number[]) {
  const ids: string[] = [];
  for (const xp of xps) {
    const id = `crowd-${++seq}`;
    ctx.db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', ?)").run(id, `${id}@example.com`, AT);
    give(id, xp);
    ids.push(id);
  }
  return ids;
}

describe("topPercent", () => {
  it("is the share of people at or ahead of you, rounded up, between 1 and 100", () => {
    const all = Array.from({ length: 20 }, (_, i) => (i + 1) * 100); // 100..2000
    expect(topPercent(2000, all)).toBe(5); // 1 of 20
    expect(topPercent(1000, all)).toBe(55); // 11 of 20
    expect(topPercent(100, all)).toBe(100);
    expect(topPercent(5, [5])).toBe(100);
  });
  it("gives tied people the same, better place", () => {
    expect(topPercent(50, [50, 50, 50, 50, 10])).toBe(20);
  });
});

describe("GET /progress/standing", () => {
  it("requires sign-in", async () => {
    await boot();
    expect((await app.inject({ method: "GET", url: "/progress/standing" })).statusCode).toBe(401);
  });

  it("returns no percentile while fewer than 20 people have XP", async () => {
    await boot();
    const me = await registerUser(app);
    give(me.id, 500);
    await crowd(Array.from({ length: MIN_STANDING_POPULATION - 2 }, () => 100)); // 19 people in total
    const res = await standing(me.auth);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ percentile: null, rankedUsers: MIN_STANDING_POPULATION - 1 });
  });

  it("computes Top X% from the XP distribution", async () => {
    await boot();
    const me = await registerUser(app);
    give(me.id, 1000);
    await crowd([...Array.from({ length: 4 }, () => 2000), ...Array.from({ length: 15 }, () => 100)]); // 4 ahead, 15 behind, 20 in all
    expect((await standing(me.auth)).json()).toEqual({ percentile: 25, rankedUsers: 20 }); // place 5 of 20
    const top = await registerUser(app);
    give(top.id, 99_999);
    expect((await standing(top.auth)).json()).toEqual({ percentile: 5, rankedUsers: 21 }); // place 1 of 21 -> 4.76% -> 5
  });

  it("uses active XP: a reset starts the count again", async () => {
    await boot();
    const me = await registerUser(app);
    give(me.id, 5000);
    give(me.id, 0, "reset");
    give(me.id, 10);
    await crowd(Array.from({ length: 19 }, () => 100));
    expect((await standing(me.auth)).json()).toEqual({ percentile: 100, rankedUsers: 20 });
  });

  it("gives someone with no XP no percentile, and never counts them in the population", async () => {
    await boot();
    await crowd(Array.from({ length: 25 }, () => 300));
    const newcomer = await registerUser(app);
    expect((await standing(newcomer.auth)).json()).toEqual({ percentile: null, rankedUsers: 25 });
  });

  it("leaks nothing about other people: only the caller's percentile and a head count", async () => {
    await boot();
    const me = await registerUser(app);
    give(me.id, 700);
    const others = await crowd(Array.from({ length: 24 }, (_, i) => 100 + i));
    const res = await standing(me.auth);
    expect(Object.keys(res.json()).sort()).toEqual(["percentile", "rankedUsers"]);
    const body = res.body;
    for (const id of others) expect(body).not.toContain(id);
    expect(body).not.toContain("example.com");
  });

  it("rejects unknown query keys", async () => {
    await boot();
    const me = await registerUser(app);
    expect((await standing(me.auth, "?bogus=1")).statusCode).toBe(400);
  });
});
