/**
 * Production entrypoint plan (scripts/start.mjs): when backups run, when the server refuses to start,
 * and that no secret value ever reaches a command line or a log message. Plus /status's backup flag.
 */
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";
import { startPlan } from "../scripts/start.mjs";
import { makeApp } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

const SECRETS = {
  R2_ACCOUNT_ID: "acct-0123456789abcdef0123456789abcdef",
  LITESTREAM_BUCKET: "form-backups-bucket",
  LITESTREAM_ACCESS_KEY_ID: "AKIDEXAMPLEKEYID0123456789",
  LITESTREAM_SECRET_ACCESS_KEY: "s3cr3t/ValueThatMustNeverBeLogged+0123456789",
};

describe("startPlan", () => {
  it("starts the server directly, backups off, when no backup variable is set", () => {
    const plan = startPlan({ NODE_ENV: "production" }, false);
    expect(plan).toEqual({ action: "run", backup: "off", log: "backups: off", command: { cmd: "node", args: ["--enable-source-maps", "dist/server.js"] } });
    // Blank values (an emptied dashboard field) count as unset.
    expect(startPlan({ ...Object.fromEntries(Object.keys(SECRETS).map((k) => [k, "  "])) }, true)).toMatchObject({ action: "run", backup: "off" });
  });

  it("restores, then replicates the server, when all four variables are set and the binary exists", () => {
    const plan = startPlan({ ...SECRETS, DATABASE_PATH: "/var/data/form.db" }, true);
    expect(plan).toMatchObject({ action: "run", backup: "litestream" });
    if (plan.action !== "run") throw new Error("expected run");
    expect(plan.restore).toEqual({ cmd: "./bin/litestream", args: ["restore", "-config", "litestream.yml", "-if-db-not-exists", "-if-replica-exists", "/var/data/form.db"] });
    expect(plan.command).toEqual({ cmd: "./bin/litestream", args: ["replicate", "-config", "litestream.yml", "-exec", "node --enable-source-maps dist/server.js"] });
    // Flags come before the positional database path, as Litestream requires.
    expect(plan.restore!.args.at(-1)).toBe("/var/data/form.db");
  });

  it("defaults the database path like the server does", () => {
    const plan = startPlan({ ...SECRETS }, true);
    expect(plan.action === "run" && plan.restore?.args.at(-1)).toBe("./form.db");
  });

  it("never puts a secret value in a command line or message", () => {
    const plans = [startPlan({ ...SECRETS }, true), startPlan({ ...SECRETS }, false), startPlan({ ...SECRETS, LITESTREAM_SECRET_ACCESS_KEY: "" }, true)];
    const text = JSON.stringify(plans);
    for (const value of Object.values(SECRETS)) expect(text).not.toContain(value);
  });

  it("refuses a half-configured backup, naming only the missing variables", () => {
    for (const name of Object.keys(SECRETS)) {
      const env: Record<string, string> = { ...SECRETS };
      delete env[name];
      const plan = startPlan(env, true);
      expect(plan.action).toBe("refuse");
      if (plan.action !== "refuse") continue;
      expect(plan.message).toContain(`missing ${name}`);
    }
    expect(startPlan({ LITESTREAM_BUCKET: SECRETS.LITESTREAM_BUCKET }, true).action).toBe("refuse");
  });

  it("refuses when backups are configured but the Litestream binary is missing", () => {
    const plan = startPlan({ ...SECRETS }, false);
    expect(plan.action).toBe("refuse");
    if (plan.action === "refuse") expect(plan.message).toMatch(/bin\/litestream is missing/);
  });
});

describe("/status backup flag", () => {
  it("reads FORM_BACKUP, defaulting to off", () => {
    expect(loadConfig({ NODE_ENV: "test" }).backup).toBe("off");
    expect(loadConfig({ NODE_ENV: "test", FORM_BACKUP: "litestream" }).backup).toBe("litestream");
    expect(() => loadConfig({ NODE_ENV: "test", FORM_BACKUP: "yes" })).toThrow(/FORM_BACKUP/);
  });

  it("says on or off, and nothing else about the backup", async () => {
    ({ app } = await makeApp());
    const off = await app.inject({ method: "GET", url: "/status" });
    expect(off.json().backup).toBe("off");
    await app.close();
    ({ app } = await makeApp({ config: { backup: "litestream" } }));
    const on = await app.inject({ method: "GET", url: "/status" });
    expect(on.json().backup).toBe("on");
    expect(on.body).not.toMatch(/litestream|r2|bucket/i);
  });
});
