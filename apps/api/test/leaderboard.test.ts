import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { publicNameProblem, safePublicName } from "../src/modules/leaderboard/nameFilter";
import { LEADERBOARD_SIZE } from "../src/modules/leaderboard/service";
import { appendXp } from "../src/modules/progression/service";
import type { AppContext } from "../src/shared/context";
import { makeApp, registerUser, TestClock } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

// Wednesday 2026-09-30; that week started on Monday 2026-09-28.
const AT = "2026-09-30T12:00:00Z";
const NOW = new Date(AT);
type Auth = Record<string, string>;
interface Entry { position: number; name: string; anonymous: boolean; isYou: boolean; points: number; level: number; rank: string; rankLabel: string }
interface Board { period: string; from: string | null; to: string | null; totalRanked: number; entries: Entry[]; you: Omit<Entry, "position" | "isYou"> & { position: number | null; optedIn: boolean } }

async function boot(clock = new TestClock(NOW)) {
  ({ app, ctx } = await makeApp({ clock }));
}
let seq = 0;
const give = (userId: string, xp: number, localDate = "2026-09-30", kind: "award" | "reset" = "award") =>
  appendXp(ctx.db, { userId, source: kind === "reset" ? "reset" : "workout", reference: `t${++seq}`, kind, xp, idempotencyKey: `t${seq}`, localDate, detail: {}, now: NOW });
const board = async (auth: Auth, period = "week", extra = ""): Promise<Board> => {
  const res = await app.inject({ method: "GET", url: `/leaderboard?period=${period}${extra}`, headers: auth });
  expect(res.statusCode).toBe(200);
  return res.json() as Board;
};
/** A user inserted directly (sign-up is rate limited), with an optional public name and opt-in. */
function person(name: string | null = null, optedIn = false): string {
  const id = `lb-${++seq}`;
  ctx.db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, 'x', ?)").run(id, `${id}@secret-mail.test`, AT);
  if (name) ctx.db.prepare("INSERT INTO profiles (user_id, display_name, updated_at) VALUES (?, ?, ?)").run(id, name, AT);
  if (optedIn) ctx.db.prepare("INSERT INTO user_settings (user_id, leaderboard_opt_in, updated_at) VALUES (?, 1, ?)").run(id, AT);
  return id;
}

describe("name filter", () => {
  it("accepts ordinary names and refuses profanity, evasions, contact details and impersonation", () => {
    for (const ok of ["Jeremy", "Sam K.", "Zoë Müller", "Essex Lifter", "Cucumber", "Nigel", "Pass the Bar", "Class of 99"]) expect(publicNameProblem(ok), ok).toBeNull();
    for (const bad of ["fuck", "F.u.c.k", "f u u u c k", "Sh1t head", "b!tch", "a$$", "Big Ass", "n1gg3r", "NAZI", "porn star", "kill bill", "http://x.io", "me@mail.com", "call 555 123 4567", "Admin", "Athlete #ABCDE", "Athlete", "  "]) {
      expect(publicNameProblem(bad), bad).not.toBeNull();
    }
    expect(publicNameProblem("x".repeat(41), 40)).toMatch(/40/);
    expect(publicNameProblem("a​dmin")).not.toBeNull();
  });
  it("masks an unsafe stored name at read time", () => {
    expect(safePublicName("  Sam   K ")).toBe("Sam K");
    expect(safePublicName("shit")).toBeNull();
    expect(safePublicName(null)).toBeNull();
  });
});

describe("GET /leaderboard", () => {
  it("requires sign-in and a strict query", async () => {
    await boot();
    expect((await app.inject({ method: "GET", url: "/leaderboard" })).statusCode).toBe(401);
    const u = await registerUser(app);
    for (const q of ["?period=year", "?extra=1", "?period=week&today=nope"]) {
      expect((await app.inject({ method: "GET", url: `/leaderboard${q}`, headers: u.auth })).statusCode, q).toBe(400);
    }
    const empty = await board(u.auth, "today");
    expect(empty).toMatchObject({ period: "today", from: "2026-09-30", to: "2026-09-30", totalRanked: 0, entries: [], you: { position: null, points: 0, optedIn: false } });
  });

  it("shows everyone anonymously by default, with a stable code that leaks no email or id", async () => {
    await boot();
    const u = await registerUser(app);
    const other = person("Real Name");
    give(u.id, 120);
    give(other, 300);
    const a = await board(u.auth);
    expect(a.entries.map((e) => [e.position, e.points, e.isYou])).toEqual([[1, 300, false], [2, 120, true]]);
    for (const e of a.entries) expect(e.name).toMatch(/^Athlete #[A-Z2-9]{5}$/);
    expect(a.entries.every((e) => e.anonymous)).toBe(true);
    expect(a.entries[0]!.name).not.toBe(a.entries[1]!.name);
    expect((await board(u.auth, "all")).entries[0]!.name).toBe(a.entries[0]!.name); // stable across periods and calls
    const text = JSON.stringify(a);
    for (const secret of [u.email, u.id, other, "secret-mail", "Real Name", "password", "userId"]) expect(text).not.toContain(secret);
    expect(Object.keys(a.entries[0]!).sort()).toEqual(["anonymous", "isYou", "level", "name", "points", "position", "prestige", "rank", "rankLabel"]);
  });

  it("shows the display name only after opting in, and refuses opting in or saving an unfit name", async () => {
    await boot();
    const u = await registerUser(app);
    give(u.id, 50);
    const named = await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { localDate: "2026-09-30", displayName: "Coach Sam" } });
    expect(named.statusCode).toBe(200);
    expect((await board(u.auth)).you).toMatchObject({ anonymous: true, optedIn: false });

    const on = await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { leaderboardOptIn: true } });
    expect(on.json()).toMatchObject({ leaderboardOptIn: true });
    expect((await board(u.auth)).entries[0]).toMatchObject({ name: "Coach Sam", anonymous: false, isYou: true });

    const rude = await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { localDate: "2026-09-30", displayName: "Big Sh1t" } });
    expect(rude.statusCode).toBe(422);
    expect(rude.json()).toMatchObject({ error: { code: "name_not_allowed" } });

    // A name stored before a word was banned is masked when read, and cannot be opted in with.
    ctx.db.prepare("UPDATE profiles SET display_name = 'f.u.c.k' WHERE user_id = ?").run(u.id);
    expect((await board(u.auth)).entries[0]).toMatchObject({ anonymous: true });
    ctx.db.prepare("UPDATE user_settings SET leaderboard_opt_in = 0 WHERE user_id = ?").run(u.id);
    expect((await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { leaderboardOptIn: true } })).statusCode).toBe(422);

    const off = await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { leaderboardOptIn: false } });
    expect(off.json()).toMatchObject({ leaderboardOptIn: false });
  });

  it("opted-in people with no (or an unusable) name still show as anonymous", async () => {
    await boot();
    const u = await registerUser(app);
    const a = person(null, true);
    const b = person("fuck", true);
    give(u.id, 10);
    give(a, 20);
    give(b, 30);
    const r = await board(u.auth);
    expect(r.entries.map((e) => e.anonymous)).toEqual([true, true, true]);
  });

  it("counts XP earned today, this week (Monday first) or since the last reset", async () => {
    await boot();
    const u = await registerUser(app);
    give(u.id, 10, "2026-09-27"); // last Sunday: before this week
    give(u.id, 20, "2026-09-28"); // Monday
    give(u.id, 40, "2026-09-29"); // Tuesday
    give(u.id, 80, "2026-09-30"); // today
    expect((await board(u.auth, "today")).you.points).toBe(80);
    expect((await board(u.auth, "week")).you).toMatchObject({ points: 140, position: 1 });
    expect((await board(u.auth, "week")).from).toBe("2026-09-28");
    expect((await board(u.auth, "all")).you.points).toBe(150);
    give(u.id, 0, "2026-09-30", "reset");
    give(u.id, 5, "2026-09-30");
    expect((await board(u.auth, "all")).you.points).toBe(5);
    expect((await board(u.auth, "week")).you.points).toBe(145); // a reset restarts the level, not the week
  });

  it("uses the user's own time zone for today and the week", async () => {
    await boot();
    const u = await registerUser(app);
    give(u.id, 30, "2026-09-30");
    give(u.id, 70, "2026-10-01");
    await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { timezone: "Pacific/Auckland" } }); // 01:00 on Thursday 1 Oct there
    const today = await board(u.auth, "today");
    expect(today).toMatchObject({ from: "2026-10-01", you: { points: 70 } });
    expect((await board(u.auth, "week")).you.points).toBe(100);
    await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { timezone: "America/Los_Angeles" } }); // 05:00 Wednesday 30 Sep
    expect((await board(u.auth, "today")).you.points).toBe(30);
  });

  it("orders by points, shares a place between ties and leaves out zero scores and deleted accounts", async () => {
    await boot();
    const u = await registerUser(app);
    const [a, b, c, gone, zero] = [person(), person(), person(), person(), person()] as [string, string, string, string, string];
    give(a, 100);
    give(b, 100);
    give(c, 300);
    give(u.id, 50);
    give(gone, 999);
    give(zero, 0, "2026-09-30", "reset");
    ctx.db.prepare("DELETE FROM users WHERE id = ?").run(gone);
    const r = await board(u.auth);
    expect(r.entries.map((e) => [e.position, e.points])).toEqual([[1, 300], [2, 100], [2, 100], [4, 50]]);
    expect(r.totalRanked).toBe(4);
    expect(r.you).toMatchObject({ position: 4, points: 50 });
    expect(r.entries.find((e) => e.isYou)!.position).toBe(4);
  });

  it("keeps the caller's own place when they are outside the top 50", async () => {
    await boot();
    const u = await registerUser(app);
    give(u.id, 10);
    for (let i = 0; i < LEADERBOARD_SIZE + 2; i++) give(person(), 100 + i);
    give(person(), 10); // ties with the caller
    const r = await board(u.auth);
    expect(r.entries).toHaveLength(LEADERBOARD_SIZE);
    expect(r.entries.some((e) => e.isYou)).toBe(false);
    expect(r.totalRanked).toBe(LEADERBOARD_SIZE + 4);
    expect(r.you).toMatchObject({ position: LEADERBOARD_SIZE + 3, points: 10, anonymous: true });
  });

  it("shows each athlete's rank from their level", async () => {
    await boot();
    const u = await registerUser(app);
    give(u.id, 2500, "2026-09-30");
    const r = await board(u.auth, "today");
    expect(r.entries[0]).toMatchObject({ isYou: true, rank: expect.any(String), level: expect.any(Number) });
    expect(r.entries[0]!.level).toBeGreaterThan(1);
    expect(r.you.rankLabel.length).toBeGreaterThan(0);
  });
});
