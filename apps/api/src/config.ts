import { randomBytes } from "node:crypto";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  JWT_SECRET: z.string().optional(),
  DATABASE_PATH: z.string().min(1).default("./form.db"),
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  CORS_ORIGINS: z.string().optional(),
  TOKEN_TTL: z.string().regex(/^\d+[smhd]$/, "e.g. 24h").default("24h"),
  // Per-client ceiling across all routes (auth routes have their own, much stricter limits).
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).max(100_000).default(300),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  // Food scanner: "anthropic" (Claude vision), "development" (labelled sample, never in production) or "none".
  FOOD_RECOGNITION_PROVIDER: z.enum(["none", "anthropic", "development"]).default("none"),
  FOOD_RECOGNITION_MODEL: z.string().min(1).default("claude-opus-5-5"),
  FOOD_RECOGNITION_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  FOOD_SCANS_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(30),
  FOOD_RECOGNITION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(30_000),
  // AI Coach: "anthropic" (Claude, with rule-based fallback), "rules" (deterministic coaching only, labelled as such) or "none".
  COACH_PROVIDER: z.enum(["none", "rules", "anthropic"]).default("rules"),
  COACH_MODEL: z.string().min(1).default("claude-opus-5-5"),
  COACH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
  // Cost control: real AI calls per user per day; chat messages per user per hour.
  COACH_DAILY_AI_CALLS: z.coerce.number().int().min(0).max(1000).default(30),
  COACH_CHAT_PER_HOUR: z.coerce.number().int().min(1).max(1000).default(20),
  // Service-wide daily ceilings on paid provider calls (all users together), so mass sign-ups can't run up the bill.
  COACH_GLOBAL_DAILY_AI_CALLS: z.coerce.number().int().min(0).max(10_000_000).default(10_000),
  FOOD_SCANS_GLOBAL_PER_DAY: z.coerce.number().int().min(0).max(10_000_000).default(5_000),
  // Billing: "none" (Pro can't be bought) or "development" (a labelled sandbox store; refused in production).
  // A real store provider (App Store / Google Play / a billing service) plugs into the same interface.
  BILLING_PROVIDER: z.enum(["none", "development"]).default("none"),
  BILLING_PRODUCT_MONTHLY: z.string().regex(/^[a-z0-9_.]{3,100}$/).default("form_pro_monthly"),
  BILLING_PRODUCT_ANNUAL: z.string().regex(/^[a-z0-9_.]{3,100}$/).default("form_pro_annual"),
  // Offer a free trial only when the store product has one (0 = no trial is offered).
  BILLING_TRIAL_DAYS: z.coerce.number().int().min(0).max(31).default(0),
  // Development store only: display prices for its sandbox products and its signing secret.
  BILLING_DEV_PRICE_MONTHLY: z.coerce.number().positive().max(1000).default(9.99),
  BILLING_DEV_PRICE_ANNUAL: z.coerce.number().positive().max(10000).default(59.99),
  BILLING_DEV_CURRENCY: z.string().regex(/^[A-Z]{3}$/).default("USD"),
  BILLING_DEV_SECRET: z.string().min(32).optional(),
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(30).default(16),
  // Free tier allowances (Pro lifts them).
  FREE_SCANS_PER_DAY: z.coerce.number().int().min(0).max(1000).default(3),
  FREE_COACH_CHAT_PER_DAY: z.coerce.number().int().min(0).max(1000).default(5),
  FREE_AI_CALLS_PER_DAY: z.coerce.number().int().min(0).max(1000).default(3),
  // Published legal documents. Unset means the app shows none — FORM never invents legal text.
  LEGAL_TERMS_URL: z.string().url().startsWith("https://").optional(),
  LEGAL_PRIVACY_URL: z.string().url().startsWith("https://").optional(),
});

export interface AppConfig {
  env: "development" | "test" | "production";
  jwtSecret: string;
  databasePath: string;
  port: number;
  corsOrigins: string[];
  tokenTtl: string;
  logLevel: "fatal" | "error" | "warn" | "info" | "debug" | "trace" | "silent";
  rateLimitPerMinute: number;
  foodRecognition: {
    provider: "none" | "anthropic" | "development";
    model: string;
    effort: "low" | "medium" | "high" | "xhigh" | "max";
    scansPerHour: number;
    timeoutMs: number;
    globalPerDay: number;
  };
  legal: { termsUrl: string | null; privacyUrl: string | null };
  billing: {
    provider: "none" | "development";
    products: { monthly: string; annual: string };
    trialDays: number;
    graceDays: number;
    dev: { prices: { monthly: number; annual: number }; currency: string; secret: string };
  };
  freeLimits: { foodScansPerDay: number; coachChatPerDay: number; aiCallsPerDay: number };
  coach: {
    provider: "none" | "rules" | "anthropic";
    model: string;
    timeoutMs: number;
    dailyAiCalls: number;
    chatPerHour: number;
    globalDailyAiCalls: number;
  };
}

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new ConfigError(`Invalid environment: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  }
  const e = parsed.data;
  const production = e.NODE_ENV === "production";

  let jwtSecret = e.JWT_SECRET ?? "";
  if (jwtSecret.length < 32) {
    if (production) throw new ConfigError("JWT_SECRET must be set to at least 32 characters in production");
    // Dev only: an ephemeral secret means tokens stop working on restart, which is
    // preferable to shipping a guessable default.
    jwtSecret = randomBytes(48).toString("base64url");
    if (e.NODE_ENV === "development") console.warn("[form-api] JWT_SECRET not set; using an ephemeral development secret");
  }

  const corsOrigins = (e.CORS_ORIGINS ?? (production ? "" : "http://localhost:8081"))
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (production && (corsOrigins.length === 0 || corsOrigins.includes("*"))) {
    throw new ConfigError("CORS_ORIGINS must list explicit origins in production");
  }

  // A development fallback returns a canned sample; it must never be mistaken for real AI in production.
  if (production && e.FOOD_RECOGNITION_PROVIDER === "development") {
    throw new ConfigError("FOOD_RECOGNITION_PROVIDER=development is not allowed in production");
  }
  // The development store grants Pro without payment: it must never run in production.
  if (production && e.BILLING_PROVIDER === "development") {
    throw new ConfigError("BILLING_PROVIDER=development is not allowed in production");
  }

  return {
    env: e.NODE_ENV,
    jwtSecret,
    databasePath: e.DATABASE_PATH,
    port: e.PORT,
    corsOrigins,
    tokenTtl: e.TOKEN_TTL,
    logLevel: e.LOG_LEVEL,
    rateLimitPerMinute: e.RATE_LIMIT_PER_MINUTE,
    foodRecognition: { provider: e.FOOD_RECOGNITION_PROVIDER, model: e.FOOD_RECOGNITION_MODEL, effort: e.FOOD_RECOGNITION_EFFORT, scansPerHour: e.FOOD_SCANS_PER_HOUR, timeoutMs: e.FOOD_RECOGNITION_TIMEOUT_MS, globalPerDay: e.FOOD_SCANS_GLOBAL_PER_DAY },
    legal: { termsUrl: e.LEGAL_TERMS_URL ?? null, privacyUrl: e.LEGAL_PRIVACY_URL ?? null },
    billing: {
      provider: e.BILLING_PROVIDER,
      products: { monthly: e.BILLING_PRODUCT_MONTHLY, annual: e.BILLING_PRODUCT_ANNUAL },
      trialDays: e.BILLING_TRIAL_DAYS,
      graceDays: e.BILLING_GRACE_DAYS,
      // An ephemeral secret when unset: dev receipts then stop verifying after a restart, by design.
      dev: { prices: { monthly: e.BILLING_DEV_PRICE_MONTHLY, annual: e.BILLING_DEV_PRICE_ANNUAL }, currency: e.BILLING_DEV_CURRENCY, secret: e.BILLING_DEV_SECRET ?? randomBytes(32).toString("base64url") },
    },
    freeLimits: { foodScansPerDay: e.FREE_SCANS_PER_DAY, coachChatPerDay: e.FREE_COACH_CHAT_PER_DAY, aiCallsPerDay: e.FREE_AI_CALLS_PER_DAY },
    coach: { provider: e.COACH_PROVIDER, model: e.COACH_MODEL, timeoutMs: e.COACH_TIMEOUT_MS, dailyAiCalls: e.COACH_DAILY_AI_CALLS, chatPerHour: e.COACH_CHAT_PER_HOUR, globalDailyAiCalls: e.COACH_GLOBAL_DAILY_AI_CALLS },
  };
}
