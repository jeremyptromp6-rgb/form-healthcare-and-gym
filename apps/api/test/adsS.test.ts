import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createUnconfiguredProviders, type ProviderRegistry } from "@form/domain";
import type { FastifyInstance } from "fastify";
import type { AppContext } from "../src/shared/context";
import { grantPro, makeApp, registerUser, TestClock } from "./helpers";

/** Prompt S: one post-workout ad per Free user per local day, decided only after the workout is committed. */

let app: FastifyInstance;
let ctx: AppContext;
const extra: FastifyInstance[] = [];
afterEach(async () => {
  await app?.close();
  for (const a of extra.splice(0)) await a.close();
});

type Auth = Record<string, string>;
const call = (a: FastifyInstance, auth: Auth, method: "GET" | "POST" | "PATCH", url: string, payload?: object) =>
  a.inject({ method, url, headers: auth, ...(payload ? { payload } : {}) });

async function boot(opts: { clock?: TestClock; providers?: ProviderRegistry; databasePath?: string } = {}) {
  const built = await makeApp({ clock: opts.clock, providers: opts.providers, config: opts.databasePath ? { databasePath: opts.databasePath } : {} });
  return built as unknown as { app: FastifyInstance; ctx: AppContext };
}

/** Runs a real workout through the Workout Engine and returns the committed workout id. */
async function completeWorkout(a: FastifyInstance, auth: Auth, clientSessionId = randomUUID()): Promise<{ workoutId: string; sessionId: string; xp: number }> {
  const s = (await call(a, auth, "POST", "/workouts/sessions", { clientSessionId, source: "empty" })).json().session;
  await call(a, auth, "POST", `/workouts/sessions/${s.id}/sets`, { clientSetId: randomUUID(), exerciseId: "push_up", reps: 10 });
  const done = await call(a, auth, "POST", `/workouts/sessions/${s.id}/complete`, { painLevel: "none" });
  expect(done.statusCode).toBe(201);
  const body = done.json();
  return { workoutId: body.workout.id, sessionId: s.id, xp: body.workout.xp };
}

const decide = (a: FastifyInstance, auth: Auth, workoutId: string) => call(a, auth, "POST", "/ads/post-workout", { workoutId });
const report = (a: FastifyInstance, auth: Auth, adId: string, event: string, reason?: string) =>
  call(a, auth, "POST", `/ads/post-workout/${adId}/events`, { event, ...(reason ? { reason } : {}) });

describe("free user", () => {
  it("gets one post-workout ad, and a second workout the same day is capped", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    const first = await completeWorkout(app, u.auth);
    const d1 = (await decide(app, u.auth, first.workoutId)).json();
    expect(d1).toMatchObject({ eligible: true, placement: "post_workout", personalized: false });
    expect((await report(app, u.auth, d1.adId, "shown")).json()).toEqual({ state: "shown" });
    expect((await report(app, u.auth, d1.adId, "dismissed")).json()).toEqual({ state: "dismissed" });

    const second = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, second.workoutId)).json()).toEqual({ eligible: false, reason: "daily_cap" });
  });

  it("a live reservation holds the day's ad, so two quick workouts can't both claim it", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    const a = await completeWorkout(app, u.auth);
    const b = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, a.workoutId)).json().eligible).toBe(true);
    expect((await decide(app, u.auth, b.workoutId)).json()).toEqual({ eligible: false, reason: "daily_cap" });
  });

  it("an ad that never reports shown stops holding the day after the reservation window", async () => {
    const clock = new TestClock();
    ({ app, ctx } = await boot({ clock }));
    const u = await registerUser(app);
    const a = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, a.workoutId)).json().eligible).toBe(true);
    clock.set("2026-09-27T12:20:00Z"); // 20 min later, same local day
    const b = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, b.workoutId)).json().eligible).toBe(true);
  });

  it("the same completion asked twice gets the same reservation, never a second ad", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    const w = await completeWorkout(app, u.auth);
    const d1 = (await decide(app, u.auth, w.workoutId)).json();
    const d2 = (await decide(app, u.auth, w.workoutId)).json();
    expect(d2.adId).toBe(d1.adId);
    await report(app, u.auth, d1.adId, "shown");
    expect((await decide(app, u.auth, w.workoutId)).json()).toEqual({ eligible: false, reason: "already_handled" });
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM post_workout_ads WHERE user_id = ?").get(u.id) as { n: number }).n).toBe(1);
  });

  it("follows the user's ad-personalization consent (off by default)", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    await call(app, u.auth, "PATCH", "/me/settings", { personalizedAdsConsent: true });
    const w = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, w.workoutId)).json().personalized).toBe(true);
  });

  it("only a recent, committed workout can open the ad", async () => {
    const clock = new TestClock();
    ({ app, ctx } = await boot({ clock }));
    const u = await registerUser(app);
    const w = await completeWorkout(app, u.auth);
    clock.set("2026-09-27T13:30:00Z"); // 90 minutes later
    expect((await decide(app, u.auth, w.workoutId)).json()).toEqual({ eligible: false, reason: "workout_not_recent" });
    expect((await decide(app, u.auth, randomUUID())).json()).toEqual({ eligible: false, reason: "workout_not_found" });
  });

  it("a discarded (abandoned) workout never becomes a workout, so it can never open an ad", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    const s = (await call(app, u.auth, "POST", "/workouts/sessions", { clientSessionId: randomUUID(), source: "empty" })).json().session;
    await call(app, u.auth, "POST", `/workouts/sessions/${s.id}/sets`, { clientSetId: randomUUID(), exerciseId: "push_up", reps: 10 });
    await call(app, u.auth, "POST", `/workouts/sessions/${s.id}/discard`);
    expect((await decide(app, u.auth, s.id)).json()).toEqual({ eligible: false, reason: "workout_not_found" });
  });
});

describe("ad failure never touches the workout", () => {
  it("a failed ad leaves XP, the workout and the day's ad intact", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    const w = await completeWorkout(app, u.auth);
    const xpBefore = (await call(app, u.auth, "GET", "/xp/events")).json();
    const d = (await decide(app, u.auth, w.workoutId)).json();
    expect((await report(app, u.auth, d.adId, "failed", "no_fill")).json()).toEqual({ state: "failed" });
    expect((await call(app, u.auth, "GET", "/xp/events")).json()).toEqual(xpBefore);
    expect((await call(app, u.auth, "GET", `/workouts/${w.workoutId}`)).statusCode).toBe(200);
    // The failed ad didn't use the day up: the next workout can still show one.
    const next = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, next.workoutId)).json().eligible).toBe(true);
  });

  it("transitions only move forward: a failed ad can't be revived, a shown ad can't be un-shown", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    const w = await completeWorkout(app, u.auth);
    const d = (await decide(app, u.auth, w.workoutId)).json();
    await report(app, u.auth, d.adId, "failed", "timeout");
    expect((await report(app, u.auth, d.adId, "shown")).json()).toEqual({ state: "failed" });

    const w2 = await completeWorkout(app, u.auth);
    const d2 = (await decide(app, u.auth, w2.workoutId)).json();
    await report(app, u.auth, d2.adId, "shown");
    expect((await report(app, u.auth, d2.adId, "failed")).json()).toEqual({ state: "shown" });
    expect((await report(app, u.auth, d2.adId, "shown")).json()).toEqual({ state: "shown" }); // replay is idempotent
  });

  it("rejects malformed events and reasons", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    const w = await completeWorkout(app, u.auth);
    const d = (await decide(app, u.auth, w.workoutId)).json();
    expect((await report(app, u.auth, d.adId, "grant_pro")).statusCode).toBe(400);
    expect((await report(app, u.auth, d.adId, "failed", "Weight 82kg")).statusCode).toBe(400);
  });
});

describe("duplicate completion", () => {
  it("retrying the completion creates no second workout, no extra XP and no second ad", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    const w = await completeWorkout(app, u.auth);
    const d = (await decide(app, u.auth, w.workoutId)).json();
    const retry = (await call(app, u.auth, "POST", `/workouts/sessions/${w.sessionId}/complete`, { painLevel: "none" })).json();
    expect(retry.workout.id).toBe(w.workoutId);
    expect(retry.workout.xp).toBe(w.xp);
    expect((await decide(app, u.auth, retry.workout.id)).json().adId).toBe(d.adId);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM workouts WHERE user_id = ?").get(u.id) as { n: number }).n).toBe(1);
  });
});

describe("Pro", () => {
  it("a Pro user is never eligible and nothing is stored or requested", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    grantPro(ctx, u.id);
    const w = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, w.workoutId)).json()).toEqual({ eligible: false, reason: "pro_user" });
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM post_workout_ads").get() as { n: number }).n).toBe(0);
  });

  it("Free → Pro during the session: ads stop at once", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    const w = await completeWorkout(app, u.auth);
    grantPro(ctx, u.id); // purchased while on the summary
    expect((await decide(app, u.auth, w.workoutId)).json()).toEqual({ eligible: false, reason: "pro_user" });
  });

  it("Pro → expired: the Free ad policy resumes", async () => {
    const clock = new TestClock();
    ({ app, ctx } = await boot({ clock }));
    const u = await registerUser(app);
    grantPro(ctx, u.id, "2026-09-28T00:00:00.000Z");
    const w = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, w.workoutId)).json().reason).toBe("pro_user");
    clock.set("2026-10-30T12:00:00Z"); // well past the period end and any grace window
    const later = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, later.workoutId)).json().eligible).toBe(true);
  });
});

describe("security and isolation", () => {
  it("user A's cap doesn't affect user B, and nobody can read or move another user's ad", async () => {
    ({ app, ctx } = await boot());
    const a = await registerUser(app);
    const b = await registerUser(app);
    const wa = await completeWorkout(app, a.auth);
    const da = (await decide(app, a.auth, wa.workoutId)).json();
    await report(app, a.auth, da.adId, "shown");

    const wb = await completeWorkout(app, b.auth);
    expect((await decide(app, b.auth, wb.workoutId)).json().eligible).toBe(true);
    // B can't use A's workout or touch A's ad (no existence leak: same answer as a random id).
    expect((await decide(app, b.auth, wa.workoutId)).json()).toEqual({ eligible: false, reason: "workout_not_found" });
    expect((await report(app, b.auth, da.adId, "failed")).statusCode).toBe(404);
    expect((ctx.db.prepare("SELECT state FROM post_workout_ads WHERE id = ?").get(da.adId) as { state: string }).state).toBe("shown");
  });

  it("there is no way for the client to reset the cap", async () => {
    ({ app, ctx } = await boot());
    const u = await registerUser(app);
    const w = await completeWorkout(app, u.auth);
    const d = (await decide(app, u.auth, w.workoutId)).json();
    await report(app, u.auth, d.adId, "shown");
    // Reporting "failed" afterwards, replaying, or asking about another workout doesn't free the day.
    await report(app, u.auth, d.adId, "failed");
    const w2 = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, w2.workoutId)).json().reason).toBe("daily_cap");
    expect((await call(app, u.auth, "POST", "/ads/post-workout/reset", {})).statusCode).toBe(404);
  });

  it("requires auth", async () => {
    ({ app, ctx } = await boot());
    expect((await app.inject({ method: "POST", url: "/ads/post-workout", payload: { workoutId: randomUUID() } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/ads/post-workout/${randomUUID()}/events`, payload: { event: "shown" } })).statusCode).toBe(401);
  });
});

describe("local day", () => {
  it("the cap follows the user's stored time zone, not UTC midnight", async () => {
    const clock = new TestClock(new Date("2026-09-27T10:00:00Z")); // Tokyo (UTC+9, no DST): 19:00 on the 27th
    ({ app, ctx } = await boot({ clock }));
    const u = await registerUser(app);
    await call(app, u.auth, "PATCH", "/me/settings", { timezone: "Asia/Tokyo" });
    const w = await completeWorkout(app, u.auth);
    const d = (await decide(app, u.auth, w.workoutId)).json();
    await report(app, u.auth, d.adId, "shown");
    expect((ctx.db.prepare("SELECT local_date FROM post_workout_ads WHERE id = ?").get(d.adId) as { local_date: string }).local_date).toBe("2026-09-27");

    clock.set("2026-09-27T14:30:00Z"); // 23:30 in Tokyo: still the same local day
    const late = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, late.workoutId)).json().reason).toBe("daily_cap");

    clock.set("2026-09-27T15:30:00Z"); // 00:30 on the 28th in Tokyo, but still the 27th in UTC
    const nextDay = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, nextDay.workoutId)).json().eligible).toBe(true);
  });

  it("handles a DST change (New York, fall back) on the local calendar day", async () => {
    const clock = new TestClock(new Date("2026-11-01T05:30:00Z")); // 01:30 EDT, Nov 1
    ({ app, ctx } = await boot({ clock }));
    const u = await registerUser(app);
    await call(app, u.auth, "PATCH", "/me/settings", { timezone: "America/New_York" });
    const w = await completeWorkout(app, u.auth);
    const d = (await decide(app, u.auth, w.workoutId)).json();
    await report(app, u.auth, d.adId, "shown");
    clock.set("2026-11-01T06:30:00Z"); // 01:30 EST — the repeated hour, still Nov 1
    const again = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, again.workoutId)).json().reason).toBe("daily_cap");
    clock.set("2026-11-02T05:30:00Z"); // 00:30 EST, Nov 2
    const tomorrow = await completeWorkout(app, u.auth);
    expect((await decide(app, u.auth, tomorrow.workoutId)).json().eligible).toBe(true);
  });
});

describe("app restart", () => {
  it("the daily cap survives a server restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "form-ads-"));
    const databasePath = join(dir, "form.db");
    try {
      ({ app, ctx } = await boot({ databasePath }));
      const u = await registerUser(app);
      const w = await completeWorkout(app, u.auth);
      const d = (await decide(app, u.auth, w.workoutId)).json();
      await report(app, u.auth, d.adId, "shown");
      await app.close();

      ({ app, ctx } = await boot({ databasePath }));
      const w2 = await completeWorkout(app, u.auth);
      expect((await decide(app, u.auth, w2.workoutId)).json().reason).toBe("daily_cap");
    } finally {
      await app.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("analytics", () => {
  it("sends the ad events only with analytics consent, and never health data", async () => {
    const sent: { name: string; props: Record<string, unknown> }[] = [];
    const providers: ProviderRegistry = {
      ...createUnconfiguredProviders(),
      analytics: { kind: "analytics", status: () => ({ state: "ready", provider: "test" }), track: async (e) => (sent.push(e), { ok: true, value: undefined }) },
    };
    ({ app, ctx } = await boot({ providers }));
    const u = await registerUser(app);
    const w0 = await completeWorkout(app, u.auth);
    const d0 = (await decide(app, u.auth, w0.workoutId)).json();
    await report(app, u.auth, d0.adId, "failed", "no_fill");
    expect(sent).toEqual([]); // no consent yet

    await call(app, u.auth, "PATCH", "/me/settings", { analyticsConsent: true });
    const w = await completeWorkout(app, u.auth);
    const d = (await decide(app, u.auth, w.workoutId)).json();
    for (const e of ["requested", "loaded", "shown", "dismissed"]) await report(app, u.auth, d.adId, e);
    const w2 = await completeWorkout(app, u.auth);
    await decide(app, u.auth, w2.workoutId);
    expect(sent.map((e) => e.name)).toEqual([
      "post_workout_ad_eligible",
      "post_workout_ad_requested",
      "post_workout_ad_loaded",
      "post_workout_ad_shown",
      "post_workout_ad_dismissed",
      "post_workout_ad_capped",
    ]);
    for (const e of sent) expect(Object.keys(e.props)).toEqual(["placement"]);
  });
});
