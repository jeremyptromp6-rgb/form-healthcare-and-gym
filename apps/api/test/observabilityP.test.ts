import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, type AppContext } from "../src/app";
import { foodLog, onboard, testConfig, TestClock, workoutPayload } from "./helpers";

let app: FastifyInstance;
let ctx: AppContext;
afterEach(async () => app?.close());

/** An app that logs at info level into memory, like production logs to stdout. */
async function loggedApp() {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const clock = new TestClock();
  ({ app, ctx } = await buildApp({
    config: { ...testConfig, logLevel: "info" },
    now: clock.now,
    logger: true,
    logStream: {
      write(line: string) {
        raw.push(line);
        lines.push(JSON.parse(line));
      },
    },
  }));
  return { lines, raw };
}

describe("observability", () => {
  it("logs requests and domain events as structured lines — never passwords, tokens, emails or food", async () => {
    const { lines, raw } = await loggedApp();
    const email = `private-${randomUUID()}@example.com`;
    const password = "a-very-secret-password";
    const reg = await app.inject({ method: "POST", url: "/auth/register", payload: { email, password } });
    const token = reg.json().token as string;
    const auth = { authorization: `Bearer ${token}` };
    await app.inject({ method: "POST", url: "/auth/login", payload: { email, password } });
    await onboard(app, auth);
    await app.inject({ method: "POST", url: "/workouts", headers: auth, payload: workoutPayload() });
    await app.inject({ method: "POST", url: "/nutrition/logs", headers: auth, payload: foodLog({ name: "Grandma's secret lasagne" }) });
    await app.inject({ method: "PATCH", url: "/me/profile", headers: auth, payload: { displayName: "Alex Example", localDate: "2026-09-27" } });

    const everything = raw.join("\n");
    for (const secret of [password, token, email, "Grandma's secret lasagne", "Alex Example", "Bearer "]) expect(everything).not.toContain(secret);

    // Every request is logged with an id and its outcome.
    const completed = lines.filter((l) => l.msg === "request completed");
    expect(completed.length).toBeGreaterThan(5);
    for (const l of completed) expect(l.reqId).toMatch(/^[0-9a-f-]{36}$/);
    // The product's important moments are visible by type, without their payloads.
    const events = lines.filter((l) => l.msg === "domain event").map((l) => l.domainEvent);
    expect(events).toContain("workout.completed");
    expect(lines.find((l) => l.msg === "domain event")).not.toHaveProperty("payload");
  });

  it("gives every response a request id, and a 500 a reference — with no internals", async () => {
    const { lines } = await loggedApp();
    const reg = await app.inject({ method: "POST", url: "/auth/register", payload: { email: `x-${randomUUID()}@example.com`, password: "correct-horse-battery" } });
    const auth = { authorization: `Bearer ${reg.json().token}` };
    expect(reg.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);

    ctx.db.exec("DROP TABLE water_logs"); // something breaks underneath
    const res = await app.inject({ method: "POST", url: "/water", headers: auth, payload: { clientLogId: randomUUID(), ml: 250 } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: "internal", message: "Something went wrong", details: { requestId: res.headers["x-request-id"] } } });
    expect(res.body).not.toContain("water_logs");
    // The log has the detail operations needs, under the same id.
    const logged = lines.find((l) => l.msg === "unhandled error");
    expect(logged).toMatchObject({ reqId: res.headers["x-request-id"], level: 50 });
  });

  it("reports health with the schema version, and 503 when the database is gone", async () => {
    await loggedApp();
    const ok = await app.inject({ method: "GET", url: "/health" });
    expect(ok.json()).toEqual({ ok: true, schemaVersion: 20 });
    ctx.db.close();
    const down = await app.inject({ method: "GET", url: "/health" });
    expect(down.statusCode).toBe(503);
    ctx.db.open(); // let onClose close it again
  });
});
