import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createUnconfiguredProviders, developmentRecognitionProvider, fail } from "@form/domain";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../src/config";
import type { AppContext } from "../src/shared/context";
import { providerCallsToday, reserveProviderCall } from "../src/shared/providerBudget";
import { allow, makeApp, NOW, registerUser, testConfig } from "./helpers";

/** Bug-hunt S2: usage ledger, reserve-before-provider, coach caps, zero budget. */

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]).toString("base64");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A paid-looking food provider (development: false) that counts its calls. */
async function scanSetup(opts: { config?: Partial<AppConfig>; recognize?: "ok" | "fail" } = {}) {
  const dev = developmentRecognitionProvider();
  const state = { calls: 0 };
  const providers = createUnconfiguredProviders();
  providers.food = {
    ...dev,
    development: false,
    status: () => ({ state: "ready", provider: "fake" }),
    recognize: async (i, o) => {
      state.calls++;
      await sleep(25);
      return opts.recognize === "fail" ? fail("unavailable", "down") : dev.recognize(i, o);
    },
  };
  ({ app, ctx } = await makeApp({ providers, config: opts.config }));
  const u = await registerUser(app);
  await allow(app, u.auth, { foodScans: true });
  const scan = (id = randomUUID(), data = PNG) => app.inject({ method: "POST", url: "/nutrition/scans", headers: u.auth, payload: { clientScanId: id, image: { mimeType: "image/png", data } } });
  return { u, state, scan };
}
const globalCalls = () => providerCallsToday(ctx.db, "food_recognition", NOW);

describe("A1-03 scan quota ledger", () => {
  it("scanning then discarding does not refund the Free daily allowance", async () => {
    const { u, state, scan } = await scanSetup();
    let ok = 0;
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await scan();
      codes.push(r.statusCode);
      if (r.statusCode === 201) {
        ok++;
        expect((await app.inject({ method: "DELETE", url: `/nutrition/scans/${r.json().scan.id}`, headers: u.auth })).statusCode).toBe(204);
      }
    }
    expect(ok).toBe(3);
    expect(codes.slice(3)).toEqual([402, 402, 402]);
    expect(state.calls).toBe(3);
    const ent = await app.inject({ method: "GET", url: "/entitlements", headers: u.auth });
    expect(ent.json().usage.foodScansToday).toBe(3);
  });

  it("pruning expired scans does not touch the ledger", async () => {
    const { scan } = await scanSetup();
    await scan();
    ctx.db.prepare("DELETE FROM food_scans").run();
    const n = (ctx.db.prepare("SELECT COUNT(*) AS n FROM provider_usage_events WHERE kind = 'food_scan' AND state = 'used'").get() as { n: number }).n;
    expect(n).toBe(1);
  });

  it("the ledger is exported and deleted with the account", async () => {
    const { u, scan } = await scanSetup();
    await scan();
    const exp = await app.inject({ method: "POST", url: "/me/export", headers: u.auth, payload: { password: "correct-horse-battery" } });
    expect(exp.statusCode).toBe(200);
    expect(exp.json().data.provider_usage_events).toHaveLength(1);
    ctx.db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM provider_usage_events WHERE user_id = ?").get(u.id) as { n: number }).n).toBe(0);
  });
});

describe("A1-04 / A1-05 reserve before the provider", () => {
  it("15 parallel distinct-id scans: only the Free limit reaches the provider", async () => {
    const { state, scan } = await scanSetup();
    const rs = await Promise.all(Array.from({ length: 15 }, () => scan()));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(3);
    expect(rs.filter((r) => r.statusCode === 402)).toHaveLength(12);
    expect(state.calls).toBe(3);
    expect(globalCalls()).toBe(3);
  });

  it("the hourly limit holds under parallel scans too", async () => {
    const { state, scan } = await scanSetup({ config: { foodRecognition: { ...testConfig.foodRecognition, scansPerHour: 2 }, freeLimits: { ...testConfig.freeLimits, foodScansPerDay: 50 } } });
    const rs = await Promise.all(Array.from({ length: 8 }, () => scan()));
    expect(rs.filter((r) => r.statusCode === 201)).toHaveLength(2);
    expect(rs.filter((r) => r.statusCode === 429)).toHaveLength(6);
    expect(state.calls).toBe(2);
  });

  it("garbage images spend neither the global budget nor the user's allowance", async () => {
    const { u, state, scan } = await scanSetup();
    for (let i = 0; i < 5; i++) {
      const r = await scan(randomUUID(), "AAAA");
      expect(r.statusCode).toBeGreaterThanOrEqual(400);
      expect(r.statusCode).toBeLessThan(500);
    }
    expect(state.calls).toBe(0);
    expect(globalCalls()).toBe(0);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM provider_usage_events WHERE user_id = ?").get(u.id) as { n: number }).n).toBe(0);
    expect((await scan()).statusCode).toBe(201);
  });

  it("a user already over their limit does not spend the global budget", async () => {
    const { scan } = await scanSetup();
    for (let i = 0; i < 3; i++) await scan();
    expect(globalCalls()).toBe(3);
    expect((await scan()).statusCode).toBe(402);
    expect(globalCalls()).toBe(3);
  });

  it("a provider failure releases the user's place and the global call", async () => {
    const { state, scan } = await scanSetup({ recognize: "fail" });
    for (let i = 0; i < 5; i++) expect((await scan()).statusCode).toBeGreaterThanOrEqual(500);
    expect(state.calls).toBe(5);
    expect(globalCalls()).toBe(0);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM provider_usage_events WHERE state = 'released'").get() as { n: number }).n).toBe(5);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM provider_usage_events WHERE state IN ('reserved', 'used')").get() as { n: number }).n).toBe(0);
  });

  it("the same clientScanId in parallel is one provider call and one ledger row", async () => {
    const { state, scan } = await scanSetup();
    const id = randomUUID();
    const rs = await Promise.all([scan(id), scan(id), scan(id)]);
    expect(rs.every((r) => r.statusCode === 201 || r.statusCode === 200)).toBe(true);
    expect(new Set(rs.map((r) => r.json().scan.id)).size).toBe(1);
    expect(state.calls).toBe(1);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM provider_usage_events").get() as { n: number }).n).toBe(1);
    // A later retry replays the stored scan without a new reservation.
    expect((await scan(id)).statusCode).toBe(200);
    expect(state.calls).toBe(1);
  });

  it("a spent global budget releases the user's place", async () => {
    const { scan } = await scanSetup({ config: { foodRecognition: { ...testConfig.foodRecognition, globalPerDay: 1 } } });
    expect((await scan()).statusCode).toBe(201);
    expect((await scan()).statusCode).toBe(503);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM provider_usage_events WHERE state IN ('reserved', 'used')").get() as { n: number }).n).toBe(1);
  });
});

describe("A1-06 coach caps hold under parallel chats", () => {
  it("12 parallel chats make at most the cap's provider calls", async () => {
    let calls = 0;
    const providers = createUnconfiguredProviders();
    providers.ai = {
      kind: "ai",
      status: () => ({ state: "ready", provider: "fake" }),
      respond: async () => {
        calls++;
        await sleep(40);
        return fail("unavailable", "x");
      },
    } as never;
    ({ app, ctx } = await makeApp({ providers, config: { coach: { ...testConfig.coach, provider: "anthropic" } } }));
    const u = await registerUser(app);
    await allow(app, u.auth, { aiCoach: true });
    const rs = await Promise.all(Array.from({ length: 12 }, (_, i) => app.inject({ method: "POST", url: "/coach/messages", headers: u.auth, payload: { message: `hi ${i}`, clientMessageId: randomUUID() } })));
    // Free: 3 AI calls a day, 5 chats a day.
    expect(calls).toBeLessThanOrEqual(testConfig.freeLimits.aiCallsPerDay);
    expect(rs.filter((r) => r.statusCode === 200 || r.statusCode === 201).length).toBeLessThanOrEqual(testConfig.freeLimits.coachChatPerDay);
    const rows = ctx.db.prepare("SELECT outcome, provider_type FROM coach_calls WHERE kind = 'chat'").all() as { outcome: string; provider_type: string }[];
    expect(rows.length).toBeLessThanOrEqual(testConfig.freeLimits.coachChatPerDay);
    expect(rows.some((r) => r.outcome === "pending" || r.provider_type === "pending")).toBe(false);
  });
});

describe("A1-18 zero daily budget", () => {
  it("reserveProviderCall with a limit of 0 returns false and writes nothing", async () => {
    ({ app, ctx } = await makeApp());
    expect(reserveProviderCall(ctx.db, "ai_coach", NOW, 0)).toBe(false);
    expect(reserveProviderCall(ctx.db, "food_recognition", NOW, -1)).toBe(false);
    expect((ctx.db.prepare("SELECT COUNT(*) AS n FROM provider_usage").get() as { n: number }).n).toBe(0);
    expect(reserveProviderCall(ctx.db, "ai_coach", NOW, 1)).toBe(true);
    expect(reserveProviderCall(ctx.db, "ai_coach", NOW, 1)).toBe(false);
    expect(providerCallsToday(ctx.db, "ai_coach", NOW)).toBe(1);
  });
});
