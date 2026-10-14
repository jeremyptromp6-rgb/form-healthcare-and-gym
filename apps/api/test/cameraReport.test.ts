import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { makeApp, registerUser } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

const REPORT = { reason: "no frame within 6 s", build: "abc1234", os: "Android 15", device: "samsung SM-S918B", engine: "native" };
const post = (payload: unknown, auth?: Record<string, string>) => app.inject({ method: "POST", url: "/diagnostics/camera", headers: auth ?? {}, payload: payload as object });
const status = async () => (await app.inject({ method: "GET", url: "/status" })).json().cameraReports as Record<string, string>[];

describe("camera handover report", () => {
  it("needs a signed-in user", async () => {
    ({ app } = await makeApp());
    expect((await post(REPORT)).statusCode).toBe(401);
    expect(await status()).toEqual([]);
  });

  it("rejects long values, unknown fields and a wrong engine", async () => {
    ({ app } = await makeApp());
    // Rejected posts count toward the hourly limit too, so spread them over two users.
    const bad = [
      { ...REPORT, reason: "x".repeat(201) },
      { ...REPORT, build: "x".repeat(41) },
      { ...REPORT, os: "x".repeat(41) },
      { ...REPORT, device: "x".repeat(61) },
      { ...REPORT, userId: "someone" },
      { ...REPORT, engine: "webview" },
      { reason: "x" },
    ];
    const users = [await registerUser(app), await registerUser(app)];
    for (const [i, payload] of bad.entries()) expect((await post(payload, users[i % 2]!.auth)).statusCode).toBe(400);
    expect(await status()).toEqual([]);
  });

  it("stores a sanitised report with no user id and shows it on /status", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = await post({ ...REPORT, reason: "  boom\n\u0000 mail me@example.com \u0007 ", device: "\tPixel 9 " }, u.auth);
    expect(res.statusCode).toBe(204);
    const reports = await status();
    expect(reports).toHaveLength(1);
    expect(Object.keys(reports[0]!).sort()).toEqual(["at", "build", "device", "os", "reason"]);
    expect(reports[0]).toMatchObject({ reason: "boom   mail [email]", device: "Pixel 9", build: "abc1234", os: "Android 15", at: "2026-09-27T12:00:00.000Z" });
    const body = (await app.inject({ method: "GET", url: "/status" })).body;
    expect(body).not.toContain(u.id);
    expect(body).not.toContain(u.email);
  });

  it("keeps the last 20, newest first", async () => {
    ({ app } = await makeApp({ config: { rateLimitPerMinute: 100_000 } }));
    // The per-user hourly limit is tight, so fill the ring with five users.
    const users = [await registerUser(app), await registerUser(app), await registerUser(app), await registerUser(app), await registerUser(app)];
    for (let i = 0; i < 25; i++) expect((await post({ ...REPORT, reason: `r${i}` }, users[i % 5]!.auth)).statusCode).toBe(204);
    const reports = await status();
    expect(reports).toHaveLength(20);
    expect(reports[0]!.reason).toBe("r24");
    expect(reports[19]!.reason).toBe("r5");
  });

  it("limits each user to 5 reports an hour", async () => {
    ({ app } = await makeApp());
    const a = await registerUser(app);
    const b = await registerUser(app);
    for (let i = 0; i < 5; i++) expect((await post(REPORT, a.auth)).statusCode).toBe(204);
    expect((await post(REPORT, a.auth)).statusCode).toBe(429);
    expect((await post(REPORT, b.auth)).statusCode).toBe(204);
  });
});
