import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { makeApp, onboard, PREFERENCES, PROFILE, registerUser, TestClock, TODAY, YESTERDAY, foodLog } from "./helpers";

let app: FastifyInstance;
afterEach(async () => app?.close());

const patchProfile = (auth: Record<string, string>, payload: object) => app.inject({ method: "PATCH", url: "/me/profile", headers: auth, payload });
const patchPrefs = (auth: Record<string, string>, payload: object) => app.inject({ method: "PATCH", url: "/me/preferences", headers: auth, payload });
const getJson = async (auth: Record<string, string>, url: string) => (await app.inject({ method: "GET", url, headers: auth })).json();

describe("catalog", () => {
  it("serves every onboarding option from the server", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const c = await getJson(u.auth, "/catalog/profile-options");
    expect(c.goals.map((g: { label: string }) => g.label)).toEqual([
      "Build Muscle",
      "Get Stronger",
      "Lose Fat",
      "Get Lean / Toned",
      "Improve Fitness",
      "Improve Overall Health",
    ]);
    expect(c.allergens).toHaveLength(14);
    expect(c.dietaryPreferences.find((d: { key: string }) => d.key === "vegan").kind).toBe("restriction");
    expect(c.limits.ageYears).toEqual({ min: 13, max: 100 });
  });
});

describe("goal selection", () => {
  it.each(["build_muscle", "get_stronger", "lose_fat", "get_lean", "improve_fitness", "improve_health"])("accepts %s", async (goal) => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = await patchProfile(u.auth, { primaryGoal: goal, localDate: TODAY });
    expect(res.statusCode).toBe(200);
    expect(res.json().profile.primaryGoal).toBe(goal);
  });

  it("accepts exactly one primary goal", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await patchProfile(u.auth, { primaryGoal: ["lose_fat", "build_muscle"], localDate: TODAY })).statusCode).toBe(400);
    expect((await patchProfile(u.auth, { primaryGoal: "get_huge", localDate: TODAY })).statusCode).toBe(400);
  });

  it("derives the energy strategy from the goal (never from the client)", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = (await patchProfile(u.auth, { ...PROFILE, primaryGoal: "get_lean", localDate: TODAY })).json();
    expect(res.profile.energyGoal).toBe("recomp");
    expect(res.targets.appliedGoal).toBe("recomp");
    expect(res.targets.targetKcal).toBe(Math.round(2759 * 0.9));
  });

  it("a goal change shapes the future without rewriting history", async () => {
    const clock = new TestClock(new Date(`${YESTERDAY}T12:00:00Z`));
    ({ app } = await makeApp({ clock }));
    const u = await registerUser(app);
    await onboard(app, u.auth, YESTERDAY);
    await app.inject({ method: "POST", url: "/nutrition/logs", headers: u.auth, payload: foodLog({ localDate: YESTERDAY, name: "Dinner", grams: null, kcal: 2760, proteinG: 150, carbsG: 300, fatG: 90 }) });

    clock.set(`${TODAY}T12:00:00Z`);
    const before = await getJson(u.auth, `/progress?today=${TODAY}`);
    const changed = (await patchProfile(u.auth, { primaryGoal: "lose_fat", localDate: TODAY })).json();
    expect(changed.personalization.goal).toEqual({ primary: "lose_fat", energy: "lose", since: TODAY });
    expect(changed.targets.targetKcal).toBeLessThan(2759);

    // Yesterday is still judged against the targets (and goal) in force yesterday.
    const yesterdayDay = await getJson(u.auth, `/nutrition/days/${YESTERDAY}?today=${TODAY}`);
    expect(yesterdayDay.targets.targetKcal).toBe(2759);
    expect((await getJson(u.auth, `/progress?today=${TODAY}`)).xpSources.nutrition).toBe(before.xpSources.nutrition);
    expect((await getJson(u.auth, `/me/personalization?today=${YESTERDAY}`)).goal.primary).toBe("improve_health");
  });
});

describe("measurements and units", () => {
  it("rejects out-of-range and non-numeric measurements", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    for (const bad of [{ ageYears: 12 }, { ageYears: 30.5 }, { heightCm: 300 }, { weightKg: 29 }, { weightKg: "80" }, { trainingDaysPerWeek: 0 }, { trainingDaysPerWeek: 8 }]) {
      expect((await patchProfile(u.auth, { ...bad, localDate: TODAY })).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it("stores metric values regardless of the display-units setting", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await app.inject({ method: "PATCH", url: "/me/settings", headers: u.auth, payload: { units: "imperial" } });
    await patchProfile(u.auth, { heightCm: 177.8, weightKg: 81.6, localDate: TODAY });
    const me = await getJson(u.auth, "/me");
    expect(me.settings.units).toBe("imperial");
    expect(me.profile).toMatchObject({ heightCm: 177.8, weightKg: 81.6 });
  });

  it("starts weight history with the onboarding weight and tracks later entries", async () => {
    const clock = new TestClock(new Date(`${YESTERDAY}T12:00:00Z`));
    ({ app } = await makeApp({ clock }));
    const u = await registerUser(app);
    await onboard(app, u.auth, YESTERDAY);
    clock.set(`${TODAY}T12:00:00Z`);

    const logged = await app.inject({ method: "POST", url: "/me/weight", headers: u.auth, payload: { localDate: TODAY, weightKg: 79.2 } });
    expect(logged.statusCode).toBe(201);
    expect(logged.json().currentWeightKg).toBe(79.2);
    expect((await getJson(u.auth, "/me/weight")).entries).toEqual([
      { localDate: TODAY, weightKg: 79.2 },
      { localDate: YESTERDAY, weightKg: 80 },
    ]);
    // The newest weight moves today's targets; yesterday keeps its own.
    expect((await getJson(u.auth, `/nutrition/days/${TODAY}`)).targets.targetKcal).toBeLessThan(2759);
    expect((await getJson(u.auth, `/nutrition/days/${YESTERDAY}`)).targets.targetKcal).toBe(2759);
  });

  it("a back-dated weight is recorded but does not replace the current weight", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await onboard(app, u.auth, TODAY);
    await app.inject({ method: "POST", url: "/me/weight", headers: u.auth, payload: { localDate: "2026-09-20", weightKg: 83 } });
    expect((await getJson(u.auth, "/me")).profile.weightKg).toBe(80);
    expect((await getJson(u.auth, "/me/weight")).entries).toHaveLength(2);
  });

  it("deleting the newest weight falls back to the previous one", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await onboard(app, u.auth, YESTERDAY);
    await app.inject({ method: "POST", url: "/me/weight", headers: u.auth, payload: { localDate: TODAY, weightKg: 78 } });
    expect((await app.inject({ method: "DELETE", url: `/me/weight/${TODAY}`, headers: u.auth })).statusCode).toBe(204);
    expect((await getJson(u.auth, "/me")).profile.weightKg).toBe(80);
    expect((await app.inject({ method: "DELETE", url: `/me/weight/${TODAY}`, headers: u.auth })).statusCode).toBe(404);
  });

  it("rejects implausible weight dates", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await app.inject({ method: "POST", url: "/me/weight", headers: u.auth, payload: { localDate: "2026-10-05", weightKg: 80 } })).statusCode).toBe(422);
    expect((await app.inject({ method: "POST", url: "/me/weight", headers: u.auth, payload: { localDate: "2026-07-01", weightKg: 80 } })).statusCode).toBe(422);
  });
});

describe("nutrition preferences", () => {
  it("saves and normalizes preferences", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = await patchPrefs(u.auth, { ...PREFERENCES, dislikedFoods: [" Olives ", "olives", "Brussels  Sprouts"] });
    expect(res.statusCode).toBe(200);
    expect(res.json().preferences).toMatchObject({ dislikedFoods: ["olives", "brussels sprouts"], allergens: ["peanuts"], customAllergies: ["kiwi"] });
  });

  it("keeps allergies and dislikes distinct: an allergy also listed as a dislike stays an allergy", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const res = (await patchPrefs(u.auth, { allergens: ["peanuts"], customAllergies: ["kiwi"], dislikedFoods: ["Kiwi", "peanuts", "olives"] })).json();
    expect(res.preferences.customAllergies).toEqual(["kiwi"]);
    expect(res.preferences.dislikedFoods).toEqual(["olives"]);
    expect(res.movedToAllergies).toEqual(["kiwi", "peanuts"]);
    const p = await getJson(u.auth, "/me/personalization");
    expect(p.nutrition.hard).toEqual({ allergens: ["peanuts"], customAllergies: ["kiwi"], dietRestrictions: [] });
    expect(p.nutrition.soft.dislikedFoods).toEqual(["olives"]);
  });

  it("rejects contradictory diets, unknown allergens and oversized lists", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await patchPrefs(u.auth, { dietaryPreferences: ["vegan", "pescatarian"] })).statusCode).toBe(422);
    expect((await patchPrefs(u.auth, { allergens: ["gluten", "unicorn"] })).statusCode).toBe(400);
    expect((await patchPrefs(u.auth, { customAllergies: Array.from({ length: 11 }, (_, i) => `thing ${i}`) })).statusCode).toBe(422);
    expect((await patchPrefs(u.auth, { dislikedFoods: ["x".repeat(41)] })).statusCode).toBe(422);
  });

  it("applies partial updates without wiping other preferences", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await patchPrefs(u.auth, PREFERENCES);
    await patchPrefs(u.auth, { foodBudget: "high" });
    expect((await getJson(u.auth, "/me")).preferences).toMatchObject({ foodBudget: "high", allergens: ["peanuts"], dietaryPreferences: ["vegetarian"] });
  });
});

describe("onboarding flow", () => {
  it("advances step by step and resumes where a returning user left off", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    const status = () => getJson(u.auth, "/onboarding");
    expect(await status()).toEqual({ completed: false, remaining: ["goal", "body", "training", "nutrition", "habits"], nextStep: "goal" });

    await patchProfile(u.auth, { primaryGoal: "build_muscle", localDate: TODAY });
    expect((await status()).nextStep).toBe("body");
    await patchProfile(u.auth, { sex: "female", ageYears: 27, heightCm: 165, weightKg: 60, localDate: TODAY });
    expect((await status()).nextStep).toBe("training");
    await patchProfile(u.auth, { experience: "beginner", trainingDaysPerWeek: 3, trainingLocation: "home", equipment: ["bodyweight"], localDate: TODAY });
    expect((await status()).nextStep).toBe("nutrition");
    // Answering "no restrictions" is still an answer.
    await patchPrefs(u.auth, { dietaryPreferences: [], allergens: [], customAllergies: [], dislikedFoods: [] });
    expect((await status()).nextStep).toBe("habits");
    await patchPrefs(u.auth, { cookingTime: "under_15", foodBudget: "low" });
    expect(await status()).toEqual({ completed: false, remaining: [], nextStep: "review" });

    expect((await app.inject({ method: "POST", url: "/onboarding/complete", headers: u.auth })).json()).toEqual({ completed: true, remaining: [], nextStep: null });
    // Completing again is harmless.
    expect((await app.inject({ method: "POST", url: "/onboarding/complete", headers: u.auth })).statusCode).toBe(200);
  });

  it("refuses to complete early and says what is missing", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await patchProfile(u.auth, { primaryGoal: "lose_fat", localDate: TODAY });
    const res = await app.inject({ method: "POST", url: "/onboarding/complete", headers: u.auth });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.details.remaining).toEqual(["body", "training", "nutrition", "habits"]);
  });

  it("persists every answer", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await onboard(app, u.auth);
    const me = await getJson(u.auth, "/me");
    expect(me.profile).toMatchObject({ ...PROFILE, activity: "moderate", energyGoal: "maintain" });
    expect(me.preferences).toEqual({ ...PREFERENCES });
    expect(me.onboarding.completed).toBe(true);
  });

  it("cannot be undone by clearing a required answer", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await onboard(app, u.auth);
    expect((await patchProfile(u.auth, { primaryGoal: null, localDate: TODAY })).statusCode).toBe(400);
    expect((await patchProfile(u.auth, { equipment: [], localDate: TODAY })).statusCode).toBe(400);
  });
});

describe("profile edits and mass assignment", () => {
  it("edits individual fields without touching others", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await onboard(app, u.auth);
    const res = (await patchProfile(u.auth, { displayName: "Sam", trainingDaysPerWeek: 5, equipment: ["bodyweight", "kettlebell"], localDate: TODAY })).json();
    expect(res.profile).toMatchObject({ displayName: "Sam", trainingDaysPerWeek: 5, activity: "active", equipment: ["bodyweight", "kettlebell"], primaryGoal: "improve_health" });
    expect((await patchProfile(u.auth, { displayName: null, localDate: TODAY })).json().profile.displayName).toBeNull();
  });

  it.each([
    ["userId", "someone-else"],
    ["activity", "very_active"],
    ["energyGoal", "gain"],
    ["goal", "gain"],
    ["onboardingCompletedAt", "2026-01-01T00:00:00Z"],
    ["updatedAt", "2020-01-01"],
    ["xp", 999999],
  ])("rejects server-controlled field %s", async (field, value) => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await patchProfile(u.auth, { [field]: value, localDate: TODAY })).statusCode).toBe(400);
    expect((await patchPrefs(u.auth, { [field]: value })).statusCode).toBe(400);
  });

  it("requires the local date so edits take effect on the user's day", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await patchProfile(u.auth, { primaryGoal: "lose_fat" })).statusCode).toBe(400);
  });
});

describe("returning legacy users", () => {
  it("keeps pre-Stage-B users in the app and reports what personalization is missing", async () => {
    let ctxRef: Awaited<ReturnType<typeof makeApp>>["ctx"];
    ({ app, ctx: ctxRef } = await makeApp());
    const u = await registerUser(app);
    // Simulate a migrated v1 profile: body data and legacy goal, completed onboarding, nothing else.
    ctxRef.db
      .prepare(
        `INSERT INTO profiles (user_id, primary_goal, sex, age_years, height_cm, weight_kg, activity, goal, onboarding_completed_at, updated_at)
         VALUES (?, 'improve_health', 'male', 30, 180, 80, 'moderate', 'maintain', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`,
      )
      .run(u.id);
    const me = await getJson(u.auth, "/me");
    expect(me.onboarding).toEqual({ completed: true, remaining: ["training", "nutrition", "habits"], nextStep: null });
    expect(me.targets.targetKcal).toBe(2759);
    expect((await getJson(u.auth, "/me/personalization")).missing).toEqual(["training", "nutrition", "habits"]);
  });
});

// ---- Photos --------------------------------------------------------------------------

function jpegWithExif(): Buffer {
  const seg = (marker: number, payload: Buffer) => Buffer.concat([Buffer.from([0xff, marker]), Buffer.from([(payload.length + 2) >> 8, (payload.length + 2) & 0xff]), payload]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    seg(0xe0, Buffer.from("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00", "latin1")),
    seg(0xe1, Buffer.from("Exif\0\0GPS 51.5007,-0.1246 iPhone 15 Pro", "latin1")),
    seg(0xfe, Buffer.from("taken at home", "latin1")),
    seg(0xdb, Buffer.from([0x00, 0x01])),
    seg(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
    Buffer.from([0x12, 0x34, 0x56, 0xff, 0xd9]),
  ]);
}

function pngWithText(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", Buffer.alloc(13)),
    chunk("tEXt", Buffer.from("Location\0Home address", "latin1")),
    chunk("IDAT", Buffer.from([1, 2, 3])),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("profile photo", () => {
  const put = (auth: Record<string, string>, mimeType: string, buf: Buffer | string) =>
    app.inject({ method: "PUT", url: "/me/photo", headers: auth, payload: { mimeType, data: typeof buf === "string" ? buf : buf.toString("base64") } });

  it("strips JPEG metadata (EXIF GPS, comments) before storing", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await put(u.auth, "image/jpeg", jpegWithExif())).statusCode).toBe(200);
    const photo = await getJson(u.auth, "/me/photo");
    const stored = Buffer.from(photo.data, "base64");
    expect(stored.toString("latin1")).not.toMatch(/Exif|GPS|iPhone|taken at home/);
    expect(stored.toString("latin1")).toContain("JFIF");
    expect([stored[0], stored[1], stored.at(-2), stored.at(-1)]).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    expect((await getJson(u.auth, "/me")).hasPhoto).toBe(true);
  });

  it("strips PNG text chunks", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await put(u.auth, "image/png", pngWithText());
    const stored = Buffer.from((await getJson(u.auth, "/me/photo")).data, "base64").toString("latin1");
    expect(stored).not.toContain("Home address");
    expect(stored).toContain("IDAT");
  });

  it("rejects mismatched types, non-images, bad base64 and oversized files", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    expect((await put(u.auth, "image/png", jpegWithExif())).statusCode).toBe(422);
    expect((await put(u.auth, "image/jpeg", Buffer.from("<svg onload=alert(1)>"))).statusCode).toBe(422);
    expect((await put(u.auth, "image/jpeg", "not base64!!")).statusCode).toBe(422);
    expect((await put(u.auth, "image/gif", jpegWithExif())).statusCode).toBe(400);
    const huge = Buffer.concat([jpegWithExif().subarray(0, 2), Buffer.alloc(1_000_001)]);
    expect((await put(u.auth, "image/jpeg", huge)).statusCode).toBe(413);
  });

  it("is private to its owner and removed with the account", async () => {
    let ctxRef: Awaited<ReturnType<typeof makeApp>>["ctx"];
    ({ app, ctx: ctxRef } = await makeApp());
    const a = await registerUser(app);
    const b = await registerUser(app);
    await put(a.auth, "image/jpeg", jpegWithExif());
    expect((await app.inject({ method: "GET", url: "/me/photo", headers: b.auth })).statusCode).toBe(404);
    await app.inject({ method: "DELETE", url: "/me", headers: a.auth, payload: { password: "correct-horse-battery", confirm: "DELETE" } });
    expect(ctxRef.db.prepare("SELECT COUNT(*) AS n FROM profile_photos").get()).toEqual({ n: 0 });
  });

  it("can be removed", async () => {
    ({ app } = await makeApp());
    const u = await registerUser(app);
    await put(u.auth, "image/jpeg", jpegWithExif());
    expect((await app.inject({ method: "DELETE", url: "/me/photo", headers: u.auth })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/me/photo", headers: u.auth })).statusCode).toBe(404);
  });
});

describe("authorization", () => {
  it("never exposes one user's profile, preferences, weight or personalization to another", async () => {
    ({ app } = await makeApp());
    const a = await registerUser(app);
    const b = await registerUser(app);
    await onboard(app, a.auth);
    await app.inject({ method: "POST", url: "/me/weight", headers: a.auth, payload: { localDate: TODAY, weightKg: 79 } });

    const meB = await getJson(b.auth, "/me");
    expect(meB.profile).toBeNull();
    expect(meB.preferences).toBeNull();
    expect((await getJson(b.auth, "/me/weight")).entries).toEqual([]);
    expect((await getJson(b.auth, "/me/personalization")).nutrition.hard.allergens).toEqual([]);
    // B editing "their" profile never touches A's.
    await patchProfile(b.auth, { primaryGoal: "lose_fat", localDate: TODAY });
    expect((await getJson(a.auth, "/me")).profile.primaryGoal).toBe("improve_health");
  });
});
