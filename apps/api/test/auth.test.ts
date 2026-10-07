import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { loadConfig } from "../src/config";
import { makeApp, registerUser, testConfig } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

describe("authentication", () => {
  it("registers, logs in and reads /me", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app, "Alex@Example.com");
    const login = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "alex@example.com", password: "correct-horse-battery" } });
    expect(login.statusCode).toBe(200);
    const me = await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${login.json().token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user).toMatchObject({ id: u.id, email: "alex@example.com" });
    expect(me.json().user.password_hash).toBeUndefined();
  });

  it("rejects duplicate emails case-insensitively", async () => {
    ({ app } = await makeApp());
    await registerUser(app, "dup@example.com");
    const res = await app.inject({ method: "POST", url: "/auth/register", payload: { email: "DUP@example.com", password: "another-long-password" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("email_taken");
  });

  it("enforces password length and email format", async () => {
    ({ app } = await makeApp());
    expect((await app.inject({ method: "POST", url: "/auth/register", payload: { email: "a@b.co", password: "short" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/auth/register", payload: { email: "nope", password: "long-enough-pw" } })).statusCode).toBe(400);
  });

  it("gives the same error for a wrong password and an unknown email", async () => {
    ({ app } = await makeApp());
    await registerUser(app, "known@example.com");
    const wrong = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "known@example.com", password: "wrong-password" } });
    const unknown = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "ghost@example.com", password: "wrong-password" } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrong.json()).toEqual(unknown.json());
  });

  it("rejects missing, malformed, forged and alg=none tokens", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await app.inject({ method: "GET", url: "/me" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/me", headers: { authorization: "Bearer garbage" } })).statusCode).toBe(401);

    const [h, p] = u.token.split(".");
    const tampered = `${h}.${Buffer.from(JSON.stringify({ sub: "someone-else" })).toString("base64url")}.${u.token.split(".")[2]}`;
    expect((await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${tampered}` } })).statusCode).toBe(401);

    const none = `${Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")}.${p}.`;
    expect((await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${none}` } })).statusCode).toBe(401);
  });

  it("rejects a token signed with a different secret", async () => {
    ({ app } = await makeApp());
    const other = await buildApp({ config: { ...testConfig, jwtSecret: "a-completely-different-secret-value-123456" } });
    const foreign = await registerUser(other.app);
    await other.app.close();
    expect((await app.inject({ method: "GET", url: "/me", headers: foreign.auth })).statusCode).toBe(401);
  });

  it("rate-limits login attempts", async () => {
    ({ app } = await makeApp());
    const codes: number[] = [];
    for (let i = 0; i < 12; i++) {
      codes.push((await app.inject({ method: "POST", url: "/auth/login", payload: { email: "x@example.com", password: "whatever-pw" } })).statusCode);
    }
    expect(codes).toContain(429);
  });

  it("revokes every session with logout-all, and a fresh login works again", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app, "revoke@example.com");
    const second = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "revoke@example.com", password: "correct-horse-battery" } });
    const secondAuth = { authorization: `Bearer ${second.json().token}` };

    expect((await app.inject({ method: "POST", url: "/auth/logout-all", headers: u.auth })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/me", headers: u.auth })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/me", headers: secondAuth })).statusCode).toBe(401);

    const fresh = await app.inject({ method: "POST", url: "/auth/login", payload: { email: "revoke@example.com", password: "correct-horse-battery" } });
    expect((await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${fresh.json().token}` } })).statusCode).toBe(200);
  });

  it("rejects a structurally valid token that lacks the token version claim", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const legacy = app.jwt.sign({ sub: u.id } as never);
    expect((await app.inject({ method: "GET", url: "/me", headers: { authorization: `Bearer ${legacy}` } })).statusCode).toBe(401);
  });

  it("deletes an account only with the correct password, and its token stops working", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    // 403 (not 401): a wrong confirmation must not look like an expired session to the client.
    const wrong = await app.inject({ method: "DELETE", url: "/me", headers: u.auth, payload: { password: "nope", confirm: "DELETE" } });
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().error.code).toBe("password_incorrect");
    expect((await app.inject({ method: "GET", url: "/me", headers: u.auth })).statusCode).toBe(200);
    expect((await app.inject({ method: "DELETE", url: "/me", headers: u.auth, payload: { password: "correct-horse-battery", confirm: "DELETE" } })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/me", headers: u.auth })).statusCode).toBe(401);
  });
});

describe("config", () => {
  const prod = { NODE_ENV: "production", JWT_SECRET: "x".repeat(32), CORS_ORIGINS: "https://app.form.fitness" };

  it("refuses to start in production without a strong JWT secret", () => {
    expect(() => loadConfig({ ...prod, JWT_SECRET: "short" })).toThrow(/JWT_SECRET/);
    expect(loadConfig(prod).jwtSecret).toBe("x".repeat(32));
  });

  it("requires explicit CORS origins in production", () => {
    expect(() => loadConfig({ ...prod, CORS_ORIGINS: undefined })).toThrow(/CORS_ORIGINS/);
    expect(() => loadConfig({ ...prod, CORS_ORIGINS: "*" })).toThrow(/CORS_ORIGINS/);
  });

  it("rejects malformed environment values", () => {
    expect(() => loadConfig({ PORT: "not-a-port" })).toThrow(/PORT/);
    expect(() => loadConfig({ NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
    expect(() => loadConfig({ TOKEN_TTL: "forever" })).toThrow(/TOKEN_TTL/);
  });

  it("defaults sensibly in development", () => {
    const c = loadConfig({ NODE_ENV: "test" });
    expect(c.corsOrigins).toEqual(["http://localhost:8081"]);
    expect(c.jwtSecret.length).toBeGreaterThanOrEqual(32);
  });
});

describe("security headers", () => {
  it("sends baseline security headers and forbids caching of personal data", async () => {
    ({ app } = await makeApp());
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
