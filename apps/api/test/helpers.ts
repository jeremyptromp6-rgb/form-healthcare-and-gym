import { randomUUID } from "node:crypto";
import type { ProviderRegistry } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import type { AppConfig } from "../src/config";

export const NOW = new Date("2026-09-27T12:00:00Z");
export const TODAY = "2026-09-27";
export const YESTERDAY = "2026-09-26";

export const testConfig: AppConfig = {
  env: "test",
  jwtSecret: "test-secret-that-is-definitely-longer-than-32-chars",
  databasePath: ":memory:",
  port: 0,
  corsOrigins: [],
  tokenTtl: "1h",
  logLevel: "silent",
  rateLimitPerMinute: 300,
  foodRecognition: { provider: "none", model: "claude-opus-5-5", effort: "medium", scansPerHour: 30, timeoutMs: 30_000, globalPerDay: 5_000 },
  legal: { termsUrl: null, privacyUrl: null },
  billing: {
    provider: "none",
    products: { monthly: "form_pro_monthly", annual: "form_pro_annual" },
    trialDays: 0,
    graceDays: 16,
    dev: { prices: { monthly: 9.99, annual: 59.99 }, currency: "USD", secret: "test-dev-billing-secret-at-least-32-characters" },
  },
  freeLimits: { foodScansPerDay: 3, coachChatPerDay: 5, aiCallsPerDay: 3 },
  coach: { provider: "rules", model: "claude-opus-5-5", timeoutMs: 20_000, dailyAiCalls: 30, chatPerHour: 20, globalDailyAiCalls: 10_000 },
};

/** A controllable clock so time-dependent rules (day settlement, target snapshots) can be tested. */
export class TestClock {
  constructor(public current: Date = NOW) {}
  now = () => this.current;
  set(iso: string) {
    this.current = new Date(iso);
  }
}

export async function makeApp(opts: { providers?: ProviderRegistry; clock?: TestClock; config?: Partial<AppConfig> } = {}) {
  const clock = opts.clock ?? new TestClock();
  return buildApp({ config: { ...testConfig, ...opts.config }, now: clock.now, providers: opts.providers });
}

/**
 * Gives a user FORM Pro the way support would (an admin grant), for tests whose subject is a Pro
 * feature. Purchases themselves are tested through the development store in proR.test.ts.
 */
export function grantPro(ctx: { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }, userId: string, until = "2099-01-01T00:00:00.000Z") {
  const now = new Date().toISOString();
  ctx.db
    .prepare(
      `INSERT INTO subscriptions (user_id, product_id, status, auto_renew, period_end, grace_end, source, environment, original_transaction_id, last_event_at, created_at, updated_at)
       VALUES (?, 'admin_grant', 'active', 0, ?, NULL, 'admin_grant', 'production', NULL, NULL, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET status = 'active', period_end = excluded.period_end, source = 'admin_grant'`,
    )
    .run(userId, until, now, now);
}

/** The user agrees to share data with an external AI coach and/or the food-photo recogniser. */
export async function allow(app: FastifyInstance, auth: Record<string, string>, what: { aiCoach?: boolean; foodScans?: boolean }) {
  const payload = { ...(what.aiCoach ? { aiCoachConsent: true } : {}), ...(what.foodScans ? { foodScanConsent: true } : {}) };
  const res = await app.inject({ method: "PATCH", url: "/me/settings", headers: auth, payload });
  if (res.statusCode !== 200) throw new Error(`consent failed: ${res.body}`);
}

export async function registerUser(app: FastifyInstance, email = `u-${randomUUID()}@example.com`) {
  const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email, password: "correct-horse-battery" } });
  if (res.statusCode !== 201) throw new Error(`register failed: ${res.body}`);
  const body = res.json() as { token: string; user: { id: string } };
  return { email, token: body.token, id: body.user.id, auth: { authorization: `Bearer ${body.token}` } };
}

/** Squat trace: full-depth reps (bottom 90°), 2 s each. */
export function squatTrace(reps: number, bottom = 90) {
  const samples: { tMs: number; angleDeg: number; confidence: number }[] = [];
  let t = 0;
  for (let r = 0; r < reps; r++) {
    for (let i = 0; i <= 10; i++) {
      const phase = i <= 5 ? i / 5 : (10 - i) / 5;
      samples.push({ tMs: t, angleDeg: 170 - (170 - bottom) * phase, confidence: 0.95 });
      t += 200;
    }
  }
  return { poseStatus: "ok" as const, samples };
}

export function workoutPayload(overrides: Record<string, unknown> = {}) {
  return {
    clientWorkoutId: randomUUID(),
    localDate: TODAY,
    durationMinutes: 40,
    painLevel: "none",
    sets: [{ exerciseId: "squat", reps: 5, loadKg: 60, trace: squatTrace(5) }],
    ...overrides,
  };
}

/** A complete profile. 3 training days → "moderate" activity; improve_health → maintenance energy. */
export const PROFILE = {
  primaryGoal: "improve_health",
  sex: "male",
  ageYears: 30,
  heightCm: 180,
  weightKg: 80,
  experience: "intermediate",
  trainingDaysPerWeek: 3,
  trainingLocation: "gym",
  equipment: ["barbell", "dumbbells", "bench"],
} as const;

export const PREFERENCES = {
  dietaryPreferences: ["vegetarian"],
  allergens: ["peanuts"],
  customAllergies: ["kiwi"],
  dislikedFoods: ["olives"],
  cookingTime: "15_30",
  foodBudget: "medium",
} as const;

/** Runs every onboarding step for a user and confirms it. */
export async function onboard(app: FastifyInstance, auth: Record<string, string>, localDate = TODAY) {
  await app.inject({ method: "PATCH", url: "/me/profile", headers: auth, payload: { ...PROFILE, localDate } });
  await app.inject({ method: "PATCH", url: "/me/preferences", headers: auth, payload: PREFERENCES });
  const res = await app.inject({ method: "POST", url: "/onboarding/complete", headers: auth });
  if (res.statusCode !== 200) throw new Error(`onboarding failed: ${res.body}`);
}
export const OATS = { name: "Oats", grams: 80, kcal: 300, proteinG: 10, carbsG: 54, fatG: 6 } as const;

type FoodLogOverrides = Partial<{ localDate: string; mealType: string; name: string; grams: number | null; kcal: number; proteinG: number; carbsG: number; fatG: number; amountMethod: string; clientLogId: string }>;

/** A manual food-log request (Stage G shape). Weighed by default; no grams → an estimate. */
export function foodLog(over: FoodLogOverrides = {}) {
  // Overriding only the calories scales the macros with them, so entries stay energy-consistent.
  const scale = over.kcal !== undefined && over.proteinG === undefined && over.carbsG === undefined && over.fatG === undefined ? over.kcal / OATS.kcal : 1;
  const v = { ...OATS, proteinG: OATS.proteinG * scale, carbsG: OATS.carbsG * scale, fatG: OATS.fatG * scale, ...over };
  const grams = v.grams ?? null;
  return {
    clientLogId: v.clientLogId ?? randomUUID(),
    ...(v.localDate ? { localDate: v.localDate } : {}),
    ...(v.mealType ? { mealType: v.mealType } : {}),
    amountMethod: v.amountMethod ?? (grams === null ? "estimated" : "measured"),
    manual: { name: v.name, kcal: v.kcal, proteinG: v.proteinG, carbsG: v.carbsG, fatG: v.fatG, ...(grams !== null ? { quantity: grams, unit: "g" } : {}) },
  };
}
