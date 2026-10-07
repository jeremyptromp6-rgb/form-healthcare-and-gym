import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createUnconfiguredProviders, fail, type AiCoachProvider, type CoachProviderRequest, type ProviderRegistry, type RawCoachOutput } from "@form/domain";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../src/config";
import type { AppContext } from "../src/shared/context";
import { allow, makeApp, onboard, registerUser, squatTrace, TestClock, testConfig, grantPro } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const get = async (auth: Auth, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();
const post = (auth: Auth, url: string, payload: object) => app.inject({ method: "POST", url, headers: auth, payload });
const chat = (auth: Auth, message: string, clientMessageId: string = randomUUID()) => post(auth, "/coach/messages", { message, clientMessageId });

const raw = (over: Partial<RawCoachOutput> = {}): RawCoachOutput => ({
  message: "You've done {{training.doneThisWeek}} of {{training.plannedThisWeek}} sessions this week. Keep it steady.",
  category: "consistency",
  priority: "normal",
  evidence: [{ fact: "training.doneThisWeek", claim: "Sessions this week" }],
  actions: [{ id: "open_train", label: "Plan a session", exerciseId: null, section: null }],
  confidence: "high",
  ...over,
});

/** A stand-in for the AI: records what it was sent and answers with `reply`. */
function fakeAi(reply: (r: CoachProviderRequest, signal?: AbortSignal) => Promise<ReturnType<AiCoachProvider["respond"]> extends Promise<infer T> ? T : never>) {
  const calls: CoachProviderRequest[] = [];
  const ai: AiCoachProvider = {
    kind: "ai",
    status: () => ({ state: "ready", provider: "Test AI" }),
    respond: async (r, opts) => {
      calls.push(r);
      return reply(r, opts?.signal);
    },
  };
  return { ai, calls };
}

async function setup(opts: { ai?: AiCoachProvider; coach?: Partial<AppConfig["coach"]>; at?: string; onboard?: boolean } = {}) {
  const clock = new TestClock(new Date(opts.at ?? "2026-09-30T12:00:00Z"));
  const providers: ProviderRegistry = { ...createUnconfiguredProviders(), ...(opts.ai ? { ai: opts.ai } : {}) };
  ({ app, ctx } = await makeApp({ clock, providers, config: { coach: { ...testConfig.coach, provider: opts.ai ? "anthropic" : "rules", ...opts.coach } } }));
  const u = await registerUser(app);
  // These tests are about the AI path itself: as Pro, the Free daily allowance doesn't cut them short.
  if (opts.ai) grantPro(ctx, u.id);
  if (opts.ai) await allow(app, u.auth, { aiCoach: true });
  if (opts.onboard !== false) await onboard(app, u.auth, "2026-09-30");
  return { ...u, clock };
}
const squatSession = (localDate: string, loadKg = 60, painLevel = "none") => ({
  clientWorkoutId: randomUUID(),
  localDate,
  durationMinutes: 40,
  painLevel,
  sets: [{ exerciseId: "squat", reps: 5, loadKg, trace: squatTrace(5) }],
});

describe("provider selection", () => {
  it("uses labelled rules by default, never claiming to be AI", async () => {
    const u = await setup();
    expect(await get(u.auth, "/coach/status")).toMatchObject({ mode: "deterministic_fallback", provider: "FORM rules", reason: "rules_only", retentionDays: 30 });
    const { insight } = await get(u.auth, "/coach/insight");
    expect(insight.provider).toEqual({ type: "deterministic_fallback", name: "FORM rules" });
    expect(insight.degraded).toBeNull();
  });

  it("falls back to rules, saying why, when the AI provider is selected but not configured", async () => {
    const clock = new TestClock(new Date("2026-09-30T12:00:00Z"));
    ({ app, ctx } = await makeApp({ clock, config: { coach: { ...testConfig.coach, provider: "anthropic" } } }));
    const u = await registerUser(app);
    expect(await get(u.auth, "/coach/status")).toMatchObject({ mode: "deterministic_fallback", reason: "unconfigured" });
    expect((await get(u.auth, "/coach/insight")).insight).toMatchObject({ provider: { type: "deterministic_fallback" }, degraded: "unconfigured" });
  });

  it("uses the real AI when it is ready, and is unavailable when switched off", async () => {
    const { ai } = fakeAi(async () => ({ ok: true, value: raw() }));
    const u = await setup({ ai });
    expect(await get(u.auth, "/coach/status")).toMatchObject({ mode: "real_ai", provider: "Test AI" });
    const { insight } = await get(u.auth, "/coach/insight");
    expect(insight).toMatchObject({ provider: { type: "real_ai", name: "Test AI" }, degraded: null, message: "You've done 0 of 3 sessions this week. Keep it steady." });
    expect(insight.actions).toEqual([{ id: "open_train", label: "Plan a session", route: "/train" }]);
    expect(insight.evidence).toEqual([{ fact: "training.doneThisWeek", claim: "Sessions this week", value: "0" }]);
    await app.close();
    const v = await setup({ coach: { provider: "none" } });
    expect((await get(v.auth, "/coach/status")).mode).toBe("unavailable");
    expect((await app.inject({ method: "GET", url: "/coach/insight", headers: v.auth })).statusCode).toBe(503);
  });
});

describe("context", () => {
  it("sends the minimal, authorized context — no identity, credentials or body measurements", async () => {
    const { ai, calls } = fakeAi(async () => ({ ok: true, value: raw() }));
    const u = await setup({ ai });
    await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { timezone: "Europe/London" } });
    await post(u.auth, "/workouts", squatSession("2026-09-30"));
    await chat(u.auth, "How did I do today?");
    const sent = JSON.stringify(calls[0]);
    expect(sent).not.toContain(u.email);
    expect(sent).not.toContain(u.token);
    expect(sent).not.toMatch(/password|weightKg|heightCm|ageYears|"80"|"180"/);
    expect(calls[0]!.message).toBe("How did I do today?");
    expect(calls[0]!.context.facts).toMatchObject({
      "now.localDate": "2026-09-30",
      "now.localTime": "13:00",
      "training.trainedToday": true,
      "workouts.0.exercises.0.name": "Barbell Back Squat",
      "workouts.0.exercises.0.verifiedReps": 5,
      "form.verifiedRepsLast28Days": 5,
      "achievements.unlocked": 2,
      "profile.goal": "improve_health",
    });
    expect(calls[0]!.context.facts["form.averageScore"]).toBeGreaterThan(0); // form and ROM from the server's verified reps
    expect(calls[0]!.context.facts["workouts.0.exercises.0.romPercent"]).toBeGreaterThan(0);
  });

  it("coaches an empty user honestly", async () => {
    const u = await setup({ onboard: false });
    const { insight } = await get(u.auth, "/coach/insight");
    expect(insight.message).toMatch(/no training logged yet/);
    expect(insight.actions[0]).toMatchObject({ route: "/train" });
  });
});

describe("validation of AI answers", () => {
  it("replaces an answer with an invented number by the rules answer, and records why", async () => {
    const { ai } = fakeAi(async () => ({ ok: true, value: raw({ message: "You've trained 5 times this week — amazing!" }) }));
    const u = await setup({ ai });
    const { insight } = await get(u.auth, "/coach/insight");
    expect(insight).toMatchObject({ provider: { type: "deterministic_fallback" }, degraded: "invalid_output" });
    expect(insight.message).not.toMatch(/5 times/);
    expect(ctx.db.prepare("SELECT outcome FROM coach_calls WHERE user_id = ?").all(u.id)).toEqual([{ outcome: "invalid_output" }]);
  });

  it("rejects malformed output, unsafe nutrition and allergen suggestions", async () => {
    const bad: RawCoachOutput[] = [
      { message: 42 } as unknown as RawCoachOutput,
      raw({ message: "Skip dinner tonight to speed up fat loss." }),
      raw({ message: "Have a peanut butter sandwich after training." }),
      raw({ message: "Next squat session, add 20 kg." }),
      raw({ message: "You might have a meniscus tear." }),
    ];
    let i = 0;
    const { ai } = fakeAi(async () => ({ ok: true, value: bad[i++]! }));
    const u = await setup({ ai });
    await app.inject({ method: "PATCH", url: "/me/preferences", headers: u.auth, payload: { allergens: ["peanuts"] } });
    for (let n = 0; n < bad.length; n++) {
      const r = (await chat(u.auth, `question ${n}`)).json().response;
      expect(r).toMatchObject({ provider: { type: "deterministic_fallback" }, degraded: "invalid_output" });
      expect(r.message).not.toMatch(/peanut|skip|20 kg|tear/i);
    }
  });

  it("puts rest first: no workout push after serious pain or a second workout today", async () => {
    const { ai } = fakeAi(async () => ({ ok: true, value: raw({ message: "Let's train today and hit squats again!", category: "workout" }) }));
    const u = await setup({ ai });
    await post(u.auth, "/workouts", squatSession("2026-09-30"));
    expect((await get(u.auth, "/coach/insight?topic=workout")).insight.degraded).toBe("invalid_output"); // already trained
    await app.close();
    const v = await setup({ ai });
    await post(v.auth, "/workouts", squatSession("2026-09-30", 60, "serious"));
    const { insight } = await get(v.auth, "/coach/insight?topic=workout");
    expect(insight).toMatchObject({ category: "recovery", priority: "high", degraded: "invalid_output" });
    expect(insight.actions.some((a: { route: string }) => a.route === "/train")).toBe(false);
  });

  it("coaches form and progression from verified reps", async () => {
    const u = await setup();
    await post(u.auth, "/workouts", squatSession("2026-09-30"));
    const form = (await get(u.auth, "/coach/insight?topic=form")).insight;
    expect(form.category).toBe("form");
    expect(form.evidence.map((e: { fact: string }) => e.fact)).toContain("form.averageScore");
    const workout = (await get(u.auth, "/coach/insight?topic=workout")).insight;
    expect(workout.message).toMatch(/Barbell Back Squat with a form score of \d+ across 5 verified reps/);
    expect(workout.message).toMatch(/add a little/);
    expect(workout.actions[0]).toMatchObject({ route: "/train/exercise/squat" });
  });
});

describe("reliability", () => {
  it("degrades to rules on provider failure, rate limiting, timeouts and exceptions", async () => {
    const outcomes = [fail<RawCoachOutput>("network", "timeout"), fail<RawCoachOutput>("rate_limited", "busy"), fail<RawCoachOutput>("unavailable", "down")];
    let i = 0;
    const { ai } = fakeAi(async () => {
      if (i === 3) throw new Error("boom");
      return outcomes[i++]!;
    });
    const u = await setup({ ai });
    const degraded: string[] = [];
    for (let n = 0; n < 4; n++) {
      const r = (await chat(u.auth, `q${n}`)).json().response;
      expect(r.provider.type).toBe("deterministic_fallback");
      degraded.push(r.degraded);
      if (n === 2) i = 3;
    }
    expect(degraded).toEqual(["timeout", "rate_limited", "provider_error", "provider_error"]);
  });

  it("never hangs on a provider that ignores its deadline", async () => {
    const { ai } = fakeAi(() => new Promise(() => undefined));
    const u = await setup({ ai, coach: { timeoutMs: 1000 } });
    const started = Date.now();
    const { insight } = await get(u.auth, "/coach/insight");
    expect(insight.degraded).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it("caches an insight until the context changes, and caps real AI calls per day", async () => {
    const { ai, calls } = fakeAi(async () => ({ ok: true, value: raw() }));
    const u = await setup({ ai, coach: { dailyAiCalls: 2 } });
    await get(u.auth, "/coach/insight");
    await get(u.auth, "/coach/insight");
    expect(calls).toHaveLength(1); // same day, same facts: served from cache
    await post(u.auth, "/workouts", squatSession("2026-09-30"));
    await get(u.auth, "/coach/insight");
    expect(calls).toHaveLength(2); // the context changed
    const third = (await get(u.auth, "/coach/insight?topic=nutrition")).insight;
    expect(calls).toHaveLength(2);
    expect(third).toMatchObject({ provider: { type: "deterministic_fallback" }, degraded: "daily_limit" });
  });

  it("rate limits chat per hour, and a retried message is answered once", async () => {
    const { ai, calls } = fakeAi(async () => ({ ok: true, value: raw() }));
    const u = await setup({ ai, coach: { chatPerHour: 2 } });
    const id = randomUUID();
    expect((await chat(u.auth, "hi", id)).statusCode).toBe(201);
    const again = await chat(u.auth, "hi", id);
    expect(again.statusCode).toBe(200);
    expect(again.json().duplicate).toBe(true);
    expect(calls).toHaveLength(1);
    expect((await chat(u.auth, "second")).statusCode).toBe(201);
    const limited = await chat(u.auth, "third");
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("coach_rate_limited");
    u.clock.set("2026-09-30T13:30:00Z");
    expect((await chat(u.auth, "later")).statusCode).toBe(201);
  });
});

describe("privacy and isolation", () => {
  it("keeps each user's chat to themselves, lets them clear it, and keeps it only 30 days", async () => {
    const u = await setup();
    const other = await registerUser(app);
    await chat(u.auth, "How's my week?");
    expect((await get(u.auth, "/coach/messages")).messages.map((m: { role: string }) => m.role)).toEqual(["user", "coach"]);
    expect((await get(other.auth, "/coach/messages")).messages).toEqual([]);
    await app.inject({ method: "DELETE", url: "/coach/messages", headers: other.auth });
    expect((await get(u.auth, "/coach/messages")).messages).toHaveLength(2); // someone else's delete touches nothing of mine
    u.clock.set("2026-11-05T12:00:00Z");
    expect((await get(u.auth, "/coach/messages")).messages).toEqual([]);
    await chat(u.auth, "Back again");
    expect((await app.inject({ method: "DELETE", url: "/coach/messages", headers: u.auth })).statusCode).toBe(204);
    expect((await get(u.auth, "/coach/messages")).messages).toEqual([]);
  });

  it("never mixes another user's data into the context", async () => {
    const { ai, calls } = fakeAi(async () => ({ ok: true, value: raw() }));
    const a = await setup({ ai });
    const b = await registerUser(app);
    await allow(app, b.auth, { aiCoach: true });
    await post(a.auth, "/workouts", squatSession("2026-09-30"));
    await chat(b.auth, "hi");
    expect(calls.at(-1)!.context.facts["training.workoutsLast28Days"]).toBe(0);
    expect(JSON.stringify(calls.at(-1))).not.toMatch(/Squat/);
  });

  it("rejects oversized or malformed chat requests", async () => {
    const u = await setup();
    expect((await post(u.auth, "/coach/messages", { message: "x".repeat(1001), clientMessageId: randomUUID() })).statusCode).toBe(400);
    expect((await post(u.auth, "/coach/messages", { message: "hi", clientMessageId: "nope" })).statusCode).toBe(400);
    expect((await post(u.auth, "/coach/messages", { message: "hi", clientMessageId: randomUUID(), context: { level: 99 } })).statusCode).toBe(400);
  });
});
