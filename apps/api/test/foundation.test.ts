import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { migrate, openDb, schemaVersion } from "../src/db";
import { MIGRATIONS } from "../src/db/migrations";
import { makeApp, registerUser } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

describe("migrations", () => {
  it("upgrades a v1 database in place, preserving users, workouts and their XP", async () => {
    const dir = mkdtempSync(join(tmpdir(), "form-mig-"));
    const path = join(dir, "v1.db");
    try {
      // Build a database exactly as the v1 app left it.
      const v1 = openDb(path, MIGRATIONS.slice(0, 1));
      v1.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u1', 'old@example.com', 'x', '2026-09-01T00:00:00Z')").run();
      v1.prepare(
        "INSERT INTO profiles (user_id, sex, age_years, height_cm, weight_kg, activity, goal, updated_at) VALUES ('u1', 'male', 30, 180, 80, 'moderate', 'maintain', '2026-09-01T00:00:00Z')",
      ).run();
      v1.prepare(
        `INSERT INTO workouts (id, user_id, client_workout_id, local_date, duration_minutes, pain_level, xp_awarded, xp_flags, created_at)
         VALUES ('w1', 'u1', 'c1', '2026-09-01', 30, 'none', 45, '[]', '2026-09-01T10:00:00Z')`,
      ).run();
      v1.prepare(
        `INSERT INTO food_entries (id, user_id, local_date, name, grams, source, kcal, protein_g, carbs_g, fat_g, created_at)
         VALUES ('f1', 'u1', '2026-09-01', 'Oats', 80, 'scale', 300, 10, 54, 6, '2026-09-01T08:00:00Z')`,
      ).run();
      expect(schemaVersion(v1)).toBe(1);

      migrate(v1);
      expect(schemaVersion(v1)).toBe(MIGRATIONS.length);
      expect(v1.prepare("SELECT source, source_key, xp FROM xp_events").all()).toEqual([{ source: "workout", source_key: "w1", xp: 45 }]);
      expect(v1.prepare("SELECT name FROM food_logs").all()).toEqual([{ name: "Oats" }]);
      expect(v1.prepare("SELECT token_version FROM users").get()).toEqual({ token_version: 0 });
      expect(v1.prepare("SELECT onboarding_completed_at FROM profiles").get()).toEqual({ onboarding_completed_at: "2026-09-01T00:00:00Z" });
      // Existing users keep targets for all of their history.
      expect(v1.prepare("SELECT effective_from, target_kcal FROM nutrition_targets").get()).toEqual({ effective_from: "1970-01-01", target_kcal: 2759 });
      // v4: legacy "maintain" becomes Improve Overall Health (same energy strategy) with goal history.
      expect(v1.prepare("SELECT primary_goal, goal, experience FROM profiles").get()).toEqual({ primary_goal: "improve_health", goal: "maintain", experience: null });
      expect(v1.prepare("SELECT primary_goal, effective_from FROM goal_history").get()).toEqual({ primary_goal: "improve_health", effective_from: "1970-01-01" });
      // v5: weight history starts from the profile weight.
      expect(v1.prepare("SELECT local_date, weight_kg FROM body_measurements").all()).toEqual([{ local_date: "2026-09-01", weight_kg: 80 }]);
      const cols = (v1.prepare("PRAGMA table_info(workouts)").all() as { name: string }[]).map((c) => c.name);
      expect(cols).not.toContain("xp_awarded");
      v1.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is idempotent: re-running migrations on an up-to-date database changes nothing", () => {
    const db = openDb(":memory:");
    const v = schemaVersion(db);
    migrate(db);
    expect(schemaVersion(db)).toBe(v);
    db.close();
  });

  it("enforces ledger integrity at the database level", () => {
    const db = openDb(":memory:");
    db.prepare("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u', 'a@b.co', 'x', 'now')").run();
    const insert = (source: string, kind: string, xp: number, key: string) =>
      db.prepare("INSERT INTO xp_events (user_id, source, source_key, kind, xp, idempotency_key, created_at) VALUES ('u', ?, 'k', ?, ?, ?, 'n')").run(source, kind, xp, key);
    expect(() => insert("workout", "award", -5, "a")).toThrow(/CHECK/); // awards are never negative
    expect(() => insert("cheat", "award", 5, "b")).toThrow(/CHECK/); // unknown source
    expect(() => insert("decay", "decay", 5, "c")).toThrow(/CHECK/); // decay only subtracts
    expect(() => insert("reset", "reset", 10, "d")).toThrow(/CHECK/); // a reset carries no XP
    insert("workout", "award", 5, "e");
    expect(() => insert("workout", "award", 5, "e")).toThrow(/UNIQUE/); // idempotency key
    expect(() => db.prepare("UPDATE xp_events SET xp = 50").run()).toThrow(/append-only/);
    expect(() => db.prepare("DELETE FROM xp_events").run()).toThrow(/append-only/);
    // Deleting the account still removes everything.
    db.prepare("DELETE FROM users WHERE id = 'u'").run();
    expect(db.prepare("SELECT COUNT(*) AS n FROM xp_events").get()).toEqual({ n: 0 });
    db.close();
  });
});

describe("settings", () => {
  it("defaults to privacy-preserving settings and applies partial updates", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await app.inject({ method: "GET", url: "/me/settings", headers: u.auth })).json()).toEqual({
      units: "metric",
      timezone: null,
      timezoneAuto: true,
      dateFormat: "system",
      personalizedAdsConsent: false,
      analyticsConsent: false,
      aiCoachEnabled: true,
      aiCoachConsent: false, // nothing goes to an external AI until the user agrees
      coachKeepHistory: true,
      foodScanConsent: false,
    });
    const patched = await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { analyticsConsent: true } });
    expect(patched.json()).toMatchObject({ analyticsConsent: true, personalizedAdsConsent: false });
    expect((await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { units: "furlongs" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { isAdmin: true } })).statusCode).toBe(400);
  });

  it("keeps settings private to each user", async () => {
    ({ app } = await makeApp());
    const a = await registerUser(app);
    const b = await registerUser(app);
    await app.inject({ method: "PATCH", url: "/me/settings", headers: a.auth, payload: { analyticsConsent: true } });
    expect((await app.inject({ method: "GET", url: "/me/settings", headers: b.auth })).json().analyticsConsent).toBe(false);
  });
});


describe("feature availability", () => {
  it("reports which features are live and why the rest are not", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const { features } = (await app.inject({ method: "GET", url: "/system/features", headers: u.auth })).json();
    expect(features.camera_verification).toEqual({ available: true });
    expect(features.pro_purchase).toEqual({ available: false, reason: "provider_unconfigured" });
    expect(features.quests).toEqual({ available: true });
    expect(features.body_quest).toEqual({ available: true });
    expect(features.ai_coach).toEqual({ available: false, reason: "provider_unconfigured" }); // rule-based coaching still answers, labelled as rules
    expect(Object.entries(features).filter(([, f]) => (f as { available: boolean }).available).map(([k]) => k)).toEqual(["camera_verification", "quests", "achievements", "body_quest", "meal_planner", "recipes", "grocery"]);
  });
});
