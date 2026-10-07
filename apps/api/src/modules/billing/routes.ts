import { PREMIUM_FEATURES, type BillingPlatform } from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { HttpError } from "../../http/errors";
import { DevBillingStore, type DevSimulation } from "../../providers/devBilling";
import type { AppContext } from "../../shared/context";
import { providerFailure } from "../../shared/providers";
import { userClock } from "../../shared/userClock";
import { entitlementsFor, loadSubscription } from "./entitlements";
import { applyEvent, applyTransaction, coachChatsToday, linkOrFail, scansToday } from "./service";

const platform = z.enum(["ios", "android", "web"]);
/** Store account pages for managing or cancelling — the stores' own, public pages. */
const STORE_MANAGE_URL: Record<BillingPlatform, string | null> = {
  ios: "https://apps.apple.com/account/subscriptions",
  android: "https://play.google.com/store/account/subscriptions",
  web: null,
};

const sourceOf = (ctx: AppContext) => (ctx.providers.billing.environment === "development" ? ("development" as const) : ("store" as const));

/** Signed-in billing routes: entitlements, products, verify, restore, manage, and the development store. */
export function billingRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/entitlements", async (req) => {
    const e = entitlementsFor(ctx, req.user.sub);
    const clock = userClock(ctx, req.user.sub);
    const free = ctx.config.freeLimits;
    return {
      ...e,
      // Free allowances and today's use, so the app can say "2 of 3 scans left" honestly.
      limits: e.tier === "pro" ? null : { foodScansPerDay: free.foodScansPerDay, coachChatPerDay: free.coachChatPerDay, aiCallsPerDay: free.aiCallsPerDay, mealPlanDays: 1, analyticsRangeDays: 30 },
      usage: { foodScansToday: scansToday(ctx, req.user.sub, clock.timezone, clock.today), coachChatsToday: coachChatsToday(ctx.db, req.user.sub, clock.today) },
    };
  });

  app.get("/billing/products", async (req) => {
    const q = z.object({ platform: platform.default("web") }).strict().parse(req.query);
    const p = ctx.providers.billing;
    const status = p.status();
    const products = status.state === "ready" ? await p.products() : null;
    return {
      provider: { configured: status.state === "ready", name: status.provider, environment: p.environment },
      products: products?.ok ? products.value.filter((x) => x.price !== null) : [],
      features: PREMIUM_FEATURES,
      manageUrl: p.environment === "development" ? null : (p.manageUrl(q.platform) ?? STORE_MANAGE_URL[q.platform]),
      legal: ctx.config.legal,
    };
  });

  app.post("/billing/verify", async (req) => {
    const body = z.object({ platform, productId: z.string().min(1).max(100), receipt: z.string().min(1).max(20_000) }).strict().parse(req.body);
    const result = await ctx.providers.billing.verifyPurchase(body);
    if (!result.ok) throw providerFailure(result);
    linkOrFail(ctx, req.user.sub, result.value, sourceOf(ctx));
    return entitlementsFor(ctx, req.user.sub);
  });

  app.post("/billing/restore", async (req) => {
    const body = z.object({ platform, receipts: z.array(z.string().min(1).max(20_000)).max(20) }).strict().parse(req.body);
    const result = await ctx.providers.billing.restore(body);
    if (!result.ok) throw providerFailure(result);
    const outcomes = result.value.map((t) => ({ productId: t.productId, ...applyTransaction(ctx, req.user.sub, t, sourceOf(ctx)) }));
    return { restored: outcomes.filter((o) => o.applied).length, linkedElsewhere: outcomes.filter((o) => !o.applied && o.reason === "other_account").length, entitlements: entitlementsFor(ctx, req.user.sub) };
  });

  // ---- Development store (only when BILLING_PROVIDER=development; refused in production) ----------
  const dev = ctx.providers.billing instanceof DevBillingStore ? ctx.providers.billing : null;
  if (!dev) return;

  /** The sandbox store's checkout: a signed receipt for the device's store account. No money moves. */
  app.post("/billing/dev/checkout", async (req) => {
    const body = z.object({ productId: z.string().min(1).max(100), storeAccount: z.string().uuid() }).strict().parse(req.body);
    const r = dev.checkout(body.storeAccount, body.productId);
    if (!r.ok) throw providerFailure(r);
    return { receipt: r.value.receipt, environment: "development" };
  });

  /** What the device's store would hand back for "restore purchases". */
  app.post("/billing/dev/receipts", async (req) => {
    const body = z.object({ storeAccount: z.string().uuid() }).strict().parse(req.body);
    return { receipts: dev.receiptsFor(body.storeAccount) };
  });

  /** Simulates what time, the user or the bank does to the caller's own subscription, delivered as a signed store notification. */
  app.post("/billing/dev/simulate", async (req) => {
    const body = z.object({ event: z.enum(["renew", "cancel", "resume", "billing_issue", "grace_expired", "recover", "expire", "refund"]) }).strict().parse(req.body);
    const sub = loadSubscription(ctx.db, req.user.sub);
    if (!sub?.originalTransactionId || sub.environment !== "development") throw new HttpError(404, "not_found", "No development subscription to change");
    const signed = dev.simulate(sub.originalTransactionId, body.event as DevSimulation);
    if (!signed.ok) throw providerFailure(signed);
    // Delivered through the real webhook endpoint, signature checks and all.
    const res = await app.inject({ method: "POST", url: "/billing/webhooks/development", headers: signed.value.headers, payload: signed.value.body });
    if (res.statusCode !== 200) throw new HttpError(502, "notification_failed", "The store notification wasn't accepted");
    return { notification: res.json(), entitlements: entitlementsFor(ctx, req.user.sub) };
  });
}

/**
 * Provider server notifications (public — authenticated by the provider's signature, not a user
 * token). The raw body is verified before anything is parsed; each event applies at most once.
 */
export function billingWebhookRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.addContentTypeParser("application/json", { parseAs: "string", bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));
  app.post("/billing/webhooks/:provider", { config: { rateLimit: { max: 600, timeWindow: "1 minute" } } }, async (req, reply) => {
    const { provider } = z.object({ provider: z.enum(["development"]) }).parse(req.params);
    const p = ctx.providers.billing;
    if (p.environment !== provider) throw new HttpError(404, "not_found", "Not found");
    const parsed = p.parseWebhook({ rawBody: String(req.body ?? ""), headers: req.headers as Record<string, string | undefined>, now: ctx.now() });
    if (!parsed.ok) {
      req.log.warn({ provider, reason: parsed.message }, "billing notification rejected");
      return reply.status(parsed.code === "permission_denied" ? 401 : 400).send({ error: { code: "invalid_notification", message: "Notification rejected" } });
    }
    const outcome = applyEvent(ctx, provider, parsed.value);
    req.log.info({ provider, billingEvent: parsed.value.type, outcome }, "billing notification");
    return { received: true, outcome };
  });
}
