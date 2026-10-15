import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../src/app";
import { grantPro, makeApp, onboard, registerUser, squatTrace, TestClock } from "./helpers";

/** FORM Pro "weak-muscle plans": the plan leans on the lowest-ranked muscles. */

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const AT = "2026-09-30T12:00:00Z";
const NOTE = /^Weak-muscle focus: /;

async function user(opts: { pro: boolean; trained: boolean; focus?: string[] }) {
  const clock = new TestClock(new Date(AT));
  const built = await makeApp({ clock });
  app = built.app;
  ctx = built.ctx;
  const u = await registerUser(app);
  await onboard(app, u.auth, AT.slice(0, 10));
  if (opts.focus) expect((await app.inject({ method: "PATCH", url: "/me/profile", headers: u.auth, payload: { focusAreas: opts.focus, localDate: AT.slice(0, 10) } })).statusCode).toBe(200);
  if (opts.trained) {
    // Squats on a past day: quads and glutes (and a little hamstring) are trained, everything else is not.
    clock.set("2026-09-28T12:00:00Z");
    const body = { clientWorkoutId: randomUUID(), localDate: "2026-09-28", durationMinutes: 30, painLevel: "none", sets: Array.from({ length: 4 }, () => ({ exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5, 90) })) };
    expect((await app.inject({ method: "POST", url: "/workouts", headers: u.auth, payload: body })).statusCode).toBe(201);
    clock.set(AT);
  }
  if (opts.pro) grantPro(ctx, u.id);
  return u;
}
const today = async (auth: Auth) => (await app.inject({ method: "GET", url: "/workouts/today", headers: auth })).json().plan as { title: string; notes: string[] };

describe("weak-muscle plans", () => {
  it("Pro: the plan leans on the lowest-ranked muscles and says so", async () => {
    const u = await user({ pro: true, trained: true });
    const plan = await today(u.auth);
    expect(plan.notes).toContain("Weak-muscle focus: Chest, Back, Lats.");
    expect(plan.title).toMatch(/Chest \+ Back focus/);
  });

  it("Free: the plan follows the user's own focus only", async () => {
    const u = await user({ pro: false, trained: true });
    const plan = await today(u.auth);
    expect(plan.notes.some((n) => NOTE.test(n))).toBe(false);
    expect(plan.title).not.toMatch(/focus/);
  });

  it("Pro with a focus of their own: theirs stays first and at most one weak area is added", async () => {
    const u = await user({ pro: true, trained: true, focus: ["legs"] });
    const plan = await today(u.auth);
    expect(plan.notes).toContain("Weak-muscle focus: Chest.");
    expect(plan.title).toMatch(/Legs \+ Chest focus/);
  });

  it("Pro with no training history keeps the usual plan", async () => {
    const u = await user({ pro: true, trained: false });
    const plan = await today(u.auth);
    expect(plan.notes.some((n) => NOTE.test(n))).toBe(false);
    expect(plan.title).not.toMatch(/focus/);
  });
});
