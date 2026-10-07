import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createUnconfiguredProviders, fail, type FoodRecognitionProvider, type ProviderResult, type RecognitionResult, type RecognizedFood } from "@form/domain";
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "../src/config";
import type { AppContext } from "../src/shared/context";
import { makeApp, allow, registerUser, TestClock, testConfig, TODAY } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

type Auth = Record<string, string>;
const post = (auth: Auth, url: string, payload: object) => app.inject({ method: "POST", url, headers: auth, payload });
const get = (auth: Auth, url: string) => app.inject({ method: "GET", url, headers: auth });

/** A tiny JPEG whose APP1 segment carries EXIF with fake GPS data (must be stripped before recognition). */
function jpegWithExif(): Buffer {
  const exifPayload = Buffer.from("Exif\0\0GPS:51.5007,-0.1246;DEVICE:PhoneX");
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), Buffer.from([0, exifPayload.length + 2]), exifPayload]);
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6, 0x12, 0x34, 0x56]);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sos, Buffer.from([0xff, 0xd9])]);
}
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);
const jpegB64 = jpegWithExif().toString("base64");

const food = (over: Partial<RecognizedFood> = {}): RecognizedFood => ({
  label: "Grilled chicken breast",
  confidence: 0.9,
  alternatives: [],
  servingGrams: 150,
  servingLowGrams: 110,
  servingHighGrams: 200,
  per100g: { kcal: 170, proteinG: 30, carbsG: 0, fatG: 5 },
  hiddenIngredients: ["cooking oil"],
  composite: false,
  ...over,
});
const MEAL: RecognitionResult = {
  imageQuality: "ok",
  containsFood: true,
  items: [
    food(),
    food({ label: "White rice", confidence: 0.6, servingGrams: 180, servingLowGrams: 130, servingHighGrams: 240, per100g: { kcal: 130, proteinG: 2.7, carbsG: 28, fatG: 0.3 }, hiddenIngredients: [] }),
    food({
      label: "Greens",
      confidence: 0.3,
      servingGrams: 80,
      servingLowGrams: 50,
      servingHighGrams: 120,
      per100g: { kcal: 35, proteinG: 2.4, carbsG: 7, fatG: 0.4 },
      hiddenIngredients: [],
      alternatives: [{ label: "Broccoli", confidence: 0.3, per100g: { kcal: 34, proteinG: 2.8, carbsG: 6.6, fatG: 0.4 } }],
    }),
  ],
};

interface Fake {
  provider: FoodRecognitionProvider;
  calls: { mimeType: string; data: Uint8Array }[];
}
function fakeFood(respond: (signal?: AbortSignal) => Promise<ProviderResult<RecognitionResult>>, development = false): Fake {
  const calls: Fake["calls"] = [];
  return {
    calls,
    provider: {
      kind: "food_recognition",
      development,
      status: () => ({ state: "ready", provider: "Test recogniser" }),
      recognize: async (image, opts) => {
        calls.push(image);
        return respond(opts?.signal);
      },
    },
  };
}
const returning = (r: RecognitionResult) => fakeFood(async () => ({ ok: true, value: r }));

async function setup(fake?: Fake, config: Partial<AppConfig> = {}, clock?: TestClock) {
  ({ app, ctx } = await makeApp({ providers: fake ? { ...createUnconfiguredProviders(), food: fake.provider } : undefined, config, clock }));
  const u = await registerUser(app);
  if (fake) await allow(app, u.auth, { foodScans: true });
  return u;
}
const scanBody = (clientScanId = randomUUID(), data = jpegB64, mimeType = "image/jpeg") => ({ clientScanId, image: { mimeType, data } });
const confirmBody = (items: object[], over: object = {}) => ({ confirmKey: randomUUID(), mealType: "lunch", localDate: TODAY, items, ...over });

describe("scanning", () => {
  it("is honestly unavailable when no recogniser is configured", async () => {
    const u = await setup();
    const res = await post(u.auth, "/nutrition/scans", scanBody());
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe("food_scan_unavailable");
  });

  it("recognises multiple foods into a reviewable estimate — privacy-first", async () => {
    const fake = returning(MEAL);
    const u = await setup(fake);
    const clientScanId = randomUUID();
    const res = await post(u.auth, "/nutrition/scans", scanBody(clientScanId));
    expect(res.statusCode).toBe(201);
    const scan = res.json().scan;
    expect(scan).toMatchObject({ status: "ok", provider: { name: "Test recogniser", development: false }, confirmedAt: null, logs: [] });
    expect(scan.items.map((i: { id: string; band: string; needsChoice: boolean }) => [i.id, i.band, i.needsChoice])).toEqual([
      ["i1", "high", false],
      ["i2", "medium", false],
      ["i3", "low", true],
    ]);
    expect(scan.items[0].options[0]).toMatchObject({ nutritionSource: "verified_database", foodId: "fdb:chicken_breast_cooked" });
    expect(scan.items[2].options.map((o: { label: string }) => o.label)).toEqual(["Greens", "Broccoli"]);

    // Privacy: the provider got the photo without its EXIF/GPS block, and nothing image-like is stored.
    expect(Buffer.from(fake.calls[0]!.data).includes("GPS")).toBe(false);
    expect(Buffer.from(fake.calls[0]!.data).includes("Exif")).toBe(false);
    const row = ctx.db.prepare("SELECT * FROM food_scans WHERE id = ?").get(scan.id) as Record<string, unknown>;
    expect(Object.keys(row)).not.toEqual(expect.arrayContaining(["image"]));
    expect(JSON.stringify(row)).not.toContain(jpegB64.slice(0, 20));
    expect(String(row.review).length).toBeLessThan(10_000);

    // A retried upload returns the same scan without calling the provider again.
    const again = await post(u.auth, "/nutrition/scans", scanBody(clientScanId));
    expect(again.statusCode).toBe(200);
    expect(again.json().scan.id).toBe(scan.id);
    expect(fake.calls).toHaveLength(1);
  });

  it("no food, unknown food and poor images come back as clear statuses", async () => {
    const results: RecognitionResult[] = [
      { imageQuality: "ok", containsFood: false, items: [] },
      { imageQuality: "ok", containsFood: true, items: [] },
      { imageQuality: "blurry", containsFood: true, items: [food({ confidence: 0.2 })] },
    ];
    let i = 0;
    const u = await setup(fakeFood(async () => ({ ok: true, value: results[i++]! })));
    const statuses = [];
    for (let n = 0; n < 3; n++) statuses.push((await post(u.auth, "/nutrition/scans", scanBody())).json().scan);
    expect(statuses.map((s) => [s.status, s.imageQuality, s.items.length])).toEqual([
      ["no_food", "ok", 0],
      ["unknown_food", "ok", 0],
      ["poor_image", "blurry", 0],
    ]);
    const confirm = await post(u.auth, `/nutrition/scans/${statuses[0].id}/confirm`, confirmBody([{ itemId: "i1" }]));
    expect(confirm.statusCode).toBe(422);
    expect(confirm.json().error.code).toBe("nothing_to_log");
  });

  it("validates the image: type must match the bytes, base64 only, size-capped", async () => {
    const u = await setup(returning(MEAL));
    expect((await post(u.auth, "/nutrition/scans", scanBody(randomUUID(), PNG.toString("base64"), "image/jpeg"))).statusCode).toBe(422);
    expect((await post(u.auth, "/nutrition/scans", scanBody(randomUUID(), "not base64!!"))).statusCode).toBe(422);
    expect((await post(u.auth, "/nutrition/scans", scanBody(randomUUID(), jpegB64, "image/gif"))).statusCode).toBe(400);
    const big = Buffer.concat([jpegWithExif().subarray(0, 2), Buffer.alloc(5.5 * 1024 * 1024, 1)]).toString("base64");
    expect((await post(u.auth, "/nutrition/scans", scanBody(randomUUID(), big))).statusCode).toBe(413);
  });
});

describe("provider failures", () => {
  it.each([
    ["network", 502, true],
    ["unavailable", 503, true],
    ["rate_limited", 429, true],
    ["invalid_input", 502, false],
  ] as const)("%s → %i", async (code, status, retryable) => {
    const u = await setup(fakeFood(async () => fail(code, "nope")));
    const res = await post(u.auth, "/nutrition/scans", scanBody());
    expect(res.statusCode).toBe(status);
    expect(res.json().error.details.retryable).toBe(retryable);
    expect(ctx.db.prepare("SELECT COUNT(*) AS n FROM food_scans").get()).toEqual({ n: 0 });
  });

  it("times out, aborting the provider request", async () => {
    let aborted = false;
    const slow = fakeFood(
      (signal) =>
        new Promise((resolve) => {
          signal?.addEventListener("abort", () => {
            aborted = true;
            resolve(fail("network", "aborted"));
          });
        }),
    );
    const u = await setup(slow, { foodRecognition: { ...testConfig.foodRecognition, timeoutMs: 50 } });
    const res = await post(u.auth, "/nutrition/scans", scanBody());
    expect(res.statusCode).toBe(504);
    expect(res.json().error).toMatchObject({ code: "scan_timeout", details: { retryable: true } });
    expect(aborted).toBe(true);
  });

  it("limits scans per hour", async () => {
    const u = await setup(returning(MEAL), { foodRecognition: { ...testConfig.foodRecognition, scansPerHour: 2 } });
    expect((await post(u.auth, "/nutrition/scans", scanBody())).statusCode).toBe(201);
    expect((await post(u.auth, "/nutrition/scans", scanBody())).statusCode).toBe(201);
    expect((await post(u.auth, "/nutrition/scans", scanBody())).statusCode).toBe(429);
  });
});

describe("review → confirm → log", () => {
  async function scanned(fake = returning(MEAL)) {
    const u = await setup(fake);
    const scan = (await post(u.auth, "/nutrition/scans", scanBody())).json().scan;
    return { u, scan };
  }

  it("logs the edited review as estimates: alternative, other food, new amount, removal", async () => {
    const { u, scan } = await scanned();
    const res = await post(
      u.auth,
      `/nutrition/scans/${scan.id}/confirm`,
      confirmBody(
        [
          { itemId: "i1", amount: 120 },
          { itemId: "i2", foodId: "fdb:rice_brown_cooked", amount: 150 },
          { itemId: "i3", optionKey: "alt1" },
        ],
        { mealName: "Chicken rice bowl" },
      ),
    );
    expect(res.statusCode).toBe(201);
    const logs = res.json().scan.logs;
    expect(logs.map((l: { name: string; amount: number; kcal: number }) => [l.name, l.amount, l.kcal])).toEqual([
      ["Grilled chicken breast", 120, 198], // verified-database nutrition (165/100 g), not the recogniser's 170
      ["Rice, brown, cooked", 150, 185],
      ["Broccoli", 80, 28],
    ]);
    for (const l of logs) expect(l).toMatchObject({ source: "scan_estimate", amountMethod: "estimated", isEstimate: true, scanId: scan.id, mealName: "Chicken rice bowl", mealType: "lunch" });
    const day = (await get(u.auth, `/nutrition/days/${TODAY}`)).json();
    expect(day.totals).toMatchObject({ kcal: 411, scanKcalShare: 1, estimatedKcalShare: 1 });

    const removed = await scanned();
    const r2 = await post(removed.u.auth, `/nutrition/scans/${removed.scan.id}/confirm`, confirmBody([{ itemId: "i1" }, { itemId: "i2", remove: true }, { itemId: "i3", remove: true }]));
    expect(r2.json().scan.logs).toHaveLength(1);
  });

  it("low-confidence items need an explicit choice; every item needs a decision", async () => {
    const { u, scan } = await scanned();
    const noChoice = await post(u.auth, `/nutrition/scans/${scan.id}/confirm`, confirmBody([{ itemId: "i1" }, { itemId: "i2" }, { itemId: "i3" }]));
    expect(noChoice.statusCode).toBe(422);
    expect(noChoice.json().error).toMatchObject({ code: "invalid_selection", details: { itemId: "i3" } });
    const missing = await post(u.auth, `/nutrition/scans/${scan.id}/confirm`, confirmBody([{ itemId: "i1" }]));
    expect(missing.statusCode).toBe(422);
    const allRemoved = await post(u.auth, `/nutrition/scans/${scan.id}/confirm`, confirmBody(["i1", "i2", "i3"].map((itemId) => ({ itemId, remove: true }))));
    expect(allRemoved.statusCode).toBe(422);
  });

  it("clients can't send nutrition numbers, measured claims or unknown foods", async () => {
    const { u, scan } = await scanned();
    const url = `/nutrition/scans/${scan.id}/confirm`;
    expect((await post(u.auth, url, confirmBody([{ itemId: "i1", kcal: 5 }, { itemId: "i2" }, { itemId: "i3", optionKey: "alt1" }]))).statusCode).toBe(400);
    expect((await post(u.auth, url, confirmBody([{ itemId: "i1" }, { itemId: "i2" }, { itemId: "i3", optionKey: "alt1" }], { amountMethod: "measured" }))).statusCode).toBe(400);
    expect((await post(u.auth, url, confirmBody([{ itemId: "i1", foodId: "fdb:nope" }, { itemId: "i2" }, { itemId: "i3", optionKey: "alt1" }]))).statusCode).toBe(404);
  });

  it("confirming twice never logs twice — retries, concurrency and a second attempt", async () => {
    const { u, scan } = await scanned();
    const body = confirmBody([{ itemId: "i1" }, { itemId: "i2" }, { itemId: "i3", optionKey: "alt1" }]);
    const url = `/nutrition/scans/${scan.id}/confirm`;
    const results = await Promise.all([1, 2, 3].map(() => post(u.auth, url, body)));
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 200, 201]);
    const ids = new Set(results.flatMap((r) => r.json().scan.logs.map((l: { id: string }) => l.id)));
    expect(ids.size).toBe(3);
    expect(((await get(u.auth, `/nutrition/days/${TODAY}`)).json().logs as unknown[]).length).toBe(3);
    const other = await post(u.auth, url, { ...body, confirmKey: randomUUID() });
    expect(other.statusCode).toBe(409);
    expect((await get(u.auth, `/nutrition/scans/${scan.id}`)).json().scan.logs).toHaveLength(3);
  });

  it("scans expire after a day", async () => {
    const clock = new TestClock();
    const u = await setup(returning(MEAL), {}, clock);
    const scan = (await post(u.auth, "/nutrition/scans", scanBody())).json().scan;
    clock.set(new Date(clock.now().getTime() + 25 * 3_600_000).toISOString());
    const res = await post(u.auth, `/nutrition/scans/${scan.id}/confirm`, confirmBody([{ itemId: "i1" }, { itemId: "i2" }, { itemId: "i3", optionKey: "alt1" }], { localDate: undefined }));
    expect(res.statusCode).toBe(410);
  });

  it("a scan estimate can later be replaced by a measured entry", async () => {
    const { u, scan } = await scanned();
    const logs = (await post(u.auth, `/nutrition/scans/${scan.id}/confirm`, confirmBody([{ itemId: "i1" }, { itemId: "i2", remove: true }, { itemId: "i3", remove: true }]))).json().scan.logs;
    const weighed = await post(u.auth, "/nutrition/logs", {
      clientLogId: randomUUID(),
      localDate: TODAY,
      amountMethod: "measured",
      food: { foodId: "fdb:chicken_breast_cooked", quantity: 142, unit: "g" },
      replacesLogId: logs[0].id,
    });
    expect(weighed.statusCode).toBe(201);
    expect(weighed.json().log).toMatchObject({ amountMethod: "measured", replacedLogId: logs[0].id, mealType: "lunch", isEstimate: false });
    const day = (await get(u.auth, `/nutrition/days/${TODAY}`)).json();
    expect(day.logs.map((l: { amountMethod: string }) => l.amountMethod)).toEqual(["measured"]);
    // Only scan estimates can be replaced this way.
    const again = await post(u.auth, "/nutrition/logs", { clientLogId: randomUUID(), localDate: TODAY, amountMethod: "measured", food: { foodId: "fdb:banana", quantity: 100, unit: "g" }, replacesLogId: weighed.json().log.id });
    expect(again.statusCode).toBe(422);
  });
});

describe("authorization and development fallback", () => {
  it("another user's scan is not found; unauthenticated requests are rejected", async () => {
    const fake = returning(MEAL);
    const a = await setup(fake);
    const b = await registerUser(app);
    const scan = (await post(a.auth, "/nutrition/scans", scanBody())).json().scan;
    expect((await get(b.auth, `/nutrition/scans/${scan.id}`)).statusCode).toBe(404);
    expect((await post(b.auth, `/nutrition/scans/${scan.id}/confirm`, confirmBody([{ itemId: "i1" }]))).statusCode).toBe(404);
    expect((await app.inject({ method: "DELETE", url: `/nutrition/scans/${scan.id}`, headers: b.auth })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/nutrition/scans", payload: scanBody() })).statusCode).toBe(401);
    expect((await app.inject({ method: "DELETE", url: `/nutrition/scans/${scan.id}`, headers: a.auth })).statusCode).toBe(204);
  });

  it("the development fallback works end to end and says it's development", async () => {
    const u = await setup(undefined, { foodRecognition: { ...testConfig.foodRecognition, provider: "development" } });
    const res = await post(u.auth, "/nutrition/scans", scanBody());
    expect(res.statusCode).toBe(201);
    expect(res.json().scan.provider).toEqual({ name: "Development sample (not real recognition)", development: true });
    const features = (await get(u.auth, "/system/features")).json().features;
    expect(features.food_scan).toEqual({ available: true });
  });

  it("food_scan is unavailable (provider unconfigured) by default", async () => {
    const u = await setup();
    expect((await get(u.auth, "/system/features")).json().features.food_scan).toEqual({ available: false, reason: "provider_unconfigured" });
  });
});
