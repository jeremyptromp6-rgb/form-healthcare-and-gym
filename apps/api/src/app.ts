import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { createUnconfiguredProviders, featureAvailability, providerStatuses, type ProviderRegistry } from "@form/domain";
import { aiCoachFromConfig } from "./providers/aiCoach";
import { foodRecognitionFromConfig } from "./providers/foodRecognition";
import Fastify, { type FastifyInstance } from "fastify";
import type { AppConfig } from "./config";
import { openDb, schemaVersion } from "./db";
import { registerErrorHandler } from "./http/errors";
import { registerSecurityHeaders } from "./http/security";
import { adRoutes } from "./modules/ads/routes";
import { billingRoutes, billingWebhookRoutes } from "./modules/billing/routes";
import { reportRoutes } from "./modules/reports/routes";
import { DevBillingStore } from "./providers/devBilling";
import { analyticsRoutes } from "./modules/analytics/routes";
import { privacyRoutes } from "./modules/privacy/routes";
import { authenticate, authRoutes, sessionRoutes } from "./modules/auth/routes";
import { coachRoutes } from "./modules/coach/routes";
import { homeRoutes } from "./modules/home/routes";
import { nutritionRoutes } from "./modules/nutrition/routes";
import { mealRoutes } from "./modules/meals/routes";
import { scanRoutes } from "./modules/scan/routes";
import { progressionRoutes } from "./modules/progression/routes";
import { questRoutes } from "./modules/quests/routes";
import { recognitionRoutes } from "./modules/recognition/routes";
import { clientErrorRoutes } from "./modules/system/clientErrors";
import { systemRoutes } from "./modules/system/routes";
import { userRoutes } from "./modules/users/routes";
import { waterRoutes } from "./modules/water/routes";
import { trainingRoutes } from "./modules/workouts/trainingRoutes";
import { workoutRoutes } from "./modules/workouts/routes";
import type { AppContext } from "./shared/context";
import { LOG_REDACT_PATHS, logDomainEvent, observeDomainEvents } from "./shared/observability";
import { SingleFlight } from "./shared/singleFlight";

export type { AppContext };

export interface BuildOptions {
  config: AppConfig;
  providers?: ProviderRegistry;
  now?: () => Date;
  logger?: boolean;
  /** Where log lines go (default stdout). Tests pass a stream to inspect what is logged. */
  logStream?: { write(line: string): void };
}

export interface RouteInfo {
  method: string;
  url: string;
}

export async function buildApp(opts: BuildOptions): Promise<{ app: FastifyInstance; ctx: AppContext; routes: RouteInfo[] }> {
  // Structured JSON logs with a request id on every line; secrets and personal fields are redacted
  // (see shared/observability). Bodies are never logged.
  const app = Fastify({
    logger: opts.logger ? { level: opts.config.logLevel, redact: { paths: LOG_REDACT_PATHS, censor: "[redacted]" }, ...(opts.logStream ? { stream: opts.logStream } : {}) } : false,
    trustProxy: opts.config.env === "production",
    genReqId: () => randomUUID(),
  });
  const db = openDb(opts.config.databasePath);
  const now = opts.now ?? (() => new Date());
  const providers = opts.providers ?? { ...createUnconfiguredProviders(), ...foodRecognitionFromConfig(opts.config), ...aiCoachFromConfig(opts.config) };
  // The development store (a labelled sandbox; configuration refuses it in production).
  if (opts.config.billing.provider === "development") providers.billing = new DevBillingStore(db, opts.config.billing, now);
  const ctx: AppContext = {
    db,
    providers,
    now,
    config: opts.config,
    log: app.log,
    flights: new SingleFlight(),
  };
  observeDomainEvents(ctx.db, (e) => logDomainEvent(app.log, e));
  // Every route, for audits (the isolation sweep checks it covers each id-addressed route).
  const routes: RouteInfo[] = [];
  app.addHook("onRoute", (r) => {
    for (const method of [r.method].flat()) if (method !== "HEAD") routes.push({ method, url: r.url });
  });
  // The request id goes back to the client, so a support report can be matched to the logs.
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-request-id", req.id);
    return payload;
  });
  registerErrorHandler(app);
  registerSecurityHeaders(app);
  await app.register(cors, { origin: opts.config.corsOrigins, exposedHeaders: ["x-request-id"] });
  // Generous global ceiling; auth routes set a much stricter per-route limit.
  await app.register(rateLimit, { global: true, max: opts.config.rateLimitPerMinute, timeWindow: "1 minute" });
  await app.register(jwt, {
    secret: opts.config.jwtSecret,
    sign: { algorithm: "HS256", expiresIn: opts.config.tokenTtl },
    verify: { algorithms: ["HS256"] },
  });
  app.addHook("onClose", async () => ctx.db.close());

  // Liveness and readiness: the database answers and is fully migrated. No user data, no secrets.
  app.get("/health", async (_req, reply) => {
    try {
      return { ok: true, schemaVersion: schemaVersion(ctx.db) };
    } catch (err) {
      app.log.error({ error: err instanceof Error ? err.name : "unknown" }, "health check failed");
      return reply.status(503).send({ ok: false });
    }
  });
  // Public, for operators: which build is running and which features are live. No user data and
  // no secrets — only what the app already shows every signed-in user, plus provider names.
  app.get("/status", async () => {
    const statuses = providerStatuses(ctx.providers);
    const features = featureAvailability(statuses);
    const food = statuses.find((s) => s.kind === "food_recognition");
    return {
      version: (process.env.RENDER_GIT_COMMIT ?? process.env.GIT_COMMIT ?? "").slice(0, 7) || null,
      features: { foodScan: features.food_scan.available, aiCoach: features.ai_coach.available, cameraVerification: features.camera_verification.available },
      foodRecognition: food ? { state: food.state, provider: food.provider } : null,
    };
  });
  await app.register(async (pub) => authRoutes(pub, ctx));
  await app.register(async (pub) => clientErrorRoutes(pub, ctx));
  await app.register(async (hooks) => billingWebhookRoutes(hooks, ctx));

  // Every module below requires a valid, unrevoked token; every query is scoped to req.user.sub.
  await app.register(async (secured) => {
    secured.addHook("onRequest", authenticate(ctx));
    sessionRoutes(secured, ctx);
    userRoutes(secured, ctx);
    trainingRoutes(secured, ctx);
    workoutRoutes(secured, ctx);
    nutritionRoutes(secured, ctx);
    scanRoutes(secured, ctx);
    mealRoutes(secured, ctx);
    progressionRoutes(secured, ctx);
    questRoutes(secured, ctx);
    recognitionRoutes(secured, ctx);
    analyticsRoutes(secured, ctx);
    privacyRoutes(secured, ctx);
    waterRoutes(secured, ctx);
    homeRoutes(secured, ctx);
    coachRoutes(secured, ctx);
    billingRoutes(secured, ctx);
    reportRoutes(secured, ctx);
    adRoutes(secured, ctx);
    systemRoutes(secured, ctx);
  });

  return { app, ctx, routes };
}
