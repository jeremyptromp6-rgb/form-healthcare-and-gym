import {
  ALLERGENS,
  COOKING_TIMES,
  DEFAULT_EQUIPMENT,
  DIET_PREFERENCES,
  EQUIPMENT,
  EXCLUSIVE_DIET_PATTERNS,
  EXPERIENCE_LEVELS,
  FOOD_BUDGETS,
  DATE_FORMATS,
  isValidTimeZone,
  keysOf,
  onboardingStatus,
  PRIMARY_GOALS,
  PROFILE_LIMITS as L,
  TRAINING_LOCATIONS,
} from "@form/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { transaction } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { assertPlausibleLocalDate, dateKey } from "../../shared/dates";
import { assertEntryDate, userClock } from "../../shared/userClock";
import { progressAnalytics } from "../analytics/service";
import { clearChat } from "../coach/service";
import { sanitizePhoto } from "./photo";
import { latestWeight, loadNotifications, loadPreferences, loadProfile, loadSettings, markOnboardingComplete, saveNotifications, saveSettings, upsertWeight, weightHistory } from "./repo";
import { applyPreferencesPatch, applyProfilePatch, syncWeightFromHistory, userState } from "./service";

// Mass-assignment protection: each schema lists exactly the fields a client may set, and
// .strict() rejects anything else (userId, activity, energyGoal, onboardingCompletedAt, …).
const profilePatch = z
  .object({
    localDate: dateKey,
    displayName: z.string().trim().min(1).max(L.displayNameLength).nullable(),
    primaryGoal: z.enum(keysOf(PRIMARY_GOALS)),
    sex: z.enum(["male", "female", "unspecified"]),
    ageYears: z.number().int().min(L.ageYears.min).max(L.ageYears.max),
    heightCm: z.number().min(L.heightCm.min).max(L.heightCm.max),
    weightKg: z.number().min(L.weightKg.min).max(L.weightKg.max),
    experience: z.enum(keysOf(EXPERIENCE_LEVELS)),
    trainingDaysPerWeek: z.number().int().min(L.trainingDaysPerWeek.min).max(L.trainingDaysPerWeek.max),
    trainingLocation: z.enum(keysOf(TRAINING_LOCATIONS)),
    equipment: z.array(z.enum(keysOf(EQUIPMENT))).min(1).max(EQUIPMENT.length),
  })
  .partial()
  .required({ localDate: true })
  .strict();

const foodList = (max: number) => z.array(z.string().max(200)).max(max * 2);

const preferencesPatch = z
  .object({
    dietaryPreferences: z.array(z.enum(keysOf(DIET_PREFERENCES))).max(DIET_PREFERENCES.length),
    allergens: z.array(z.enum(keysOf(ALLERGENS))).max(ALLERGENS.length),
    customAllergies: foodList(L.customAllergyMax),
    dislikedFoods: foodList(L.foodListMax),
    cookingTime: z.enum(keysOf(COOKING_TIMES)),
    foodBudget: z.enum(keysOf(FOOD_BUDGETS)),
  })
  .partial()
  .strict();

const settingsPatch = z
  .object({
    units: z.enum(["metric", "imperial"]),
    timezone: z.string().max(64).refine(isValidTimeZone, "Unknown time zone"),
    timezoneAuto: z.boolean(),
    dateFormat: z.enum(DATE_FORMATS),
    personalizedAdsConsent: z.boolean(),
    analyticsConsent: z.boolean(),
    aiCoachEnabled: z.boolean(),
    aiCoachConsent: z.boolean(),
    coachKeepHistory: z.boolean(),
    foodScanConsent: z.boolean(),
  })
  .partial()
  .strict();

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour)");
const notificationsPatch = z
  .object({
    workoutReminders: z.boolean(),
    workoutReminderTime: hhmm,
    mealReminders: z.boolean(),
    weeklySummary: z.boolean(),
    achievementAlerts: z.boolean(),
    streakAlerts: z.boolean(),
    coachTips: z.boolean(),
    quietHours: z.object({ start: hhmm, end: hhmm }).strict().nullable(),
  })
  .partial()
  .strict();

const WEIGHT_BACKDATE_DAYS = 30;

/** Profile, preferences, personalization, weight, photo, settings, onboarding and account routes — all scoped to the caller. */
export function userRoutes(app: FastifyInstance, ctx: AppContext): void {
  const today = (req: { query: unknown; user: { sub: string } }) => {
    const { today: t } = z.object({ today: dateKey.optional() }).parse(req.query);
    return userClock(ctx, req.user.sub, t).today;
  };

  app.get("/catalog/profile-options", async () => ({
    goals: PRIMARY_GOALS,
    experienceLevels: EXPERIENCE_LEVELS,
    trainingLocations: TRAINING_LOCATIONS,
    equipment: EQUIPMENT,
    defaultEquipment: DEFAULT_EQUIPMENT,
    dietaryPreferences: DIET_PREFERENCES,
    exclusiveDietPatterns: EXCLUSIVE_DIET_PATTERNS,
    allergens: ALLERGENS,
    cookingTimes: COOKING_TIMES,
    foodBudgets: FOOD_BUDGETS,
    limits: L,
  }));

  app.get("/me", async (req) => {
    const user = ctx.db.prepare("SELECT id, email, created_at AS createdAt FROM users WHERE id = ?").get(req.user.sub);
    const { profile, preferences, targets, onboarding } = userState(ctx.db, req.user.sub, today(req));
    const hasPhoto = !!ctx.db.prepare("SELECT 1 FROM profile_photos WHERE user_id = ?").get(req.user.sub);
    return { user, profile, preferences, targets, onboarding, settings: loadSettings(ctx.db, req.user.sub), hasPhoto };
  });

  app.patch("/me/profile", async (req) => {
    const { localDate: clientDate, ...patch } = profilePatch.parse(req.body);
    // Changes take effect from the user's today. Once their time zone is stored the server decides
    // it; the client's date only stands in before that (and must be plausible).
    const clock = userClock(ctx, req.user.sub);
    if (clock.source !== "stored") assertPlausibleLocalDate(clientDate, ctx.now());
    const localDate = clock.source === "stored" ? clock.today : clientDate;
    transaction(ctx.db, () => applyProfilePatch(ctx.db, req.user.sub, patch, localDate, ctx.now()));
    const { profile, targets, onboarding, personalization } = userState(ctx.db, req.user.sub, localDate);
    return { profile, targets, onboarding, personalization };
  });

  app.patch("/me/preferences", async (req) => {
    const patch = preferencesPatch.parse(req.body);
    const localDate = userClock(ctx, req.user.sub).today;
    const { preferences, movedToAllergies } = transaction(ctx.db, () => applyPreferencesPatch(ctx.db, req.user.sub, patch, localDate, ctx.now()));
    return { preferences, movedToAllergies, onboarding: onboardingStatus(loadProfile(ctx.db, req.user.sub), preferences) };
  });

  app.get("/me/personalization", async (req) => userState(ctx.db, req.user.sub, today(req)).personalization);

  // ---- Weight history -------------------------------------------------------------

  app.get("/me/weight", async (req) => {
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(365).default(90) }).parse(req.query);
    return { entries: weightHistory(ctx.db, req.user.sub, limit) };
  });

  app.post("/me/weight", async (req, reply) => {
    const { localDate, weightKg } = z
      .object({ localDate: dateKey, weightKg: z.number().min(L.weightKg.min).max(L.weightKg.max) })
      .strict()
      .parse(req.body);
    assertEntryDate(ctx, req.user.sub, localDate, WEIGHT_BACKDATE_DAYS);
    transaction(ctx.db, () => {
      upsertWeight(ctx.db, req.user.sub, localDate, weightKg, ctx.now());
      // Only the newest weight becomes the current weight (and moves targets).
      if (latestWeight(ctx.db, req.user.sub)?.localDate === localDate) syncWeightFromHistory(ctx.db, req.user.sub, localDate, ctx.now());
    });
    return reply.status(201).send({ entry: { localDate, weightKg }, currentWeightKg: loadProfile(ctx.db, req.user.sub)?.weightKg ?? null });
  });

  app.delete("/me/weight/:date", async (req, reply) => {
    const { date } = z.object({ date: dateKey }).parse(req.params);
    transaction(ctx.db, () => {
      const r = ctx.db.prepare("DELETE FROM body_measurements WHERE user_id = ? AND local_date = ?").run(req.user.sub, date);
      if (r.changes === 0) throw new HttpError(404, "not_found", "No weight logged for that day");
      syncWeightFromHistory(ctx.db, req.user.sub, date, ctx.now());
    });
    return reply.status(204).send();
  });

  // ---- Profile photo (private: only ever returned to its owner) ------------------------

  app.get("/me/photo", async (req) => {
    const row = ctx.db.prepare("SELECT mime_type, data, updated_at FROM profile_photos WHERE user_id = ?").get(req.user.sub) as
      | { mime_type: string; data: Uint8Array; updated_at: string }
      | undefined;
    if (!row) throw new HttpError(404, "not_found", "No profile photo");
    return { mimeType: row.mime_type, data: Buffer.from(row.data).toString("base64"), updatedAt: row.updated_at };
  });

  app.put("/me/photo", { bodyLimit: 2 * 1024 * 1024 }, async (req) => {
    const { mimeType, data } = z
      .object({ mimeType: z.enum(["image/jpeg", "image/png"]), data: z.string().min(1).max(1_400_000) })
      .strict()
      .parse(req.body);
    const clean = sanitizePhoto(mimeType, data);
    ctx.db
      .prepare(
        `INSERT INTO profile_photos (user_id, mime_type, data, byte_size, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET mime_type = excluded.mime_type, data = excluded.data, byte_size = excluded.byte_size, updated_at = excluded.updated_at`,
      )
      .run(req.user.sub, mimeType, clean, clean.length, ctx.now().toISOString());
    return { mimeType, byteSize: clean.length };
  });

  app.delete("/me/photo", async (req, reply) => {
    ctx.db.prepare("DELETE FROM profile_photos WHERE user_id = ?").run(req.user.sub);
    return reply.status(204).send();
  });

  // ---- Settings ------------------------------------------------------------------------

  app.get("/me/settings", async (req) => loadSettings(ctx.db, req.user.sub));

  app.patch("/me/settings", async (req) => {
    const patch = settingsPatch.parse(req.body);
    const next = { ...loadSettings(ctx.db, req.user.sub), ...patch };
    transaction(ctx.db, () => {
      saveSettings(ctx.db, req.user.sub, next, ctx.now());
      // Turning chat history off removes what's already stored, not just future chats.
      if (patch.coachKeepHistory === false) clearChat(ctx.db, req.user.sub);
    });
    return next;
  });

  // ---- Notification preferences (FORM's preferences; the OS permission is separate) --------

  app.get("/me/notifications", async (req) => loadNotifications(ctx.db, req.user.sub));

  app.patch("/me/notifications", async (req) => {
    const patch = notificationsPatch.parse(req.body);
    const next = { ...loadNotifications(ctx.db, req.user.sub), ...patch };
    saveNotifications(ctx.db, req.user.sub, next, ctx.now());
    return next;
  });

  // ---- Profile summary -------------------------------------------------------------------

  /** Workouts over 30 days and food over 7, from the same analytics as Progress. */
  app.get("/me/summary", async (req) => {
    const clock = userClock(ctx, req.user.sub, z.object({ today: dateKey.optional() }).parse(req.query).today);
    const month = progressAnalytics(ctx, req.user.sub, clock, { range: 30 });
    const week = progressAnalytics(ctx, req.user.sub, clock, { range: 7 }, { sync: false });
    const recordsBeaten = (ctx.db.prepare("SELECT COUNT(*) AS n FROM personal_records WHERE user_id = ? AND status = 'awarded' AND previous IS NOT NULL").get(req.user.sub) as { n: number }).n;
    return {
      workouts: { rangeDays: 30, workouts: month.consistency.data.workouts, trainingDays: month.consistency.data.trainingDays, minutes: month.consistency.data.minutes, verifiedReps: month.verifiedReps.data.total, adherencePercent: month.consistency.data.adherencePercent },
      nutrition: {
        rangeDays: 7,
        daysLogged: week.nutrition.data.daysLogged,
        daysOnTarget: week.nutrition.data.daysOnTarget,
        daysMeetingProtein: week.nutrition.data.daysMeetingProtein,
        estimatedPercent: week.nutrition.data.estimatedPercent,
        hasTargets: week.nutrition.data.hasTargets,
        averageKcal: week.summaries.daily ? avg(week.summaries.daily.map((d) => d.averageKcal)) : null,
      },
      recordsBeaten,
    };
  });

  // ---- Onboarding ----------------------------------------------------------------------

  app.get("/onboarding", async (req) => onboardingStatus(loadProfile(ctx.db, req.user.sub), loadPreferences(ctx.db, req.user.sub)));

  app.post("/onboarding/complete", async (req) => {
    const profile = loadProfile(ctx.db, req.user.sub);
    const prefs = loadPreferences(ctx.db, req.user.sub);
    const status = onboardingStatus(profile, prefs);
    if (status.remaining.length > 0) {
      throw new HttpError(409, "onboarding_incomplete", "Finish every step before confirming", { remaining: status.remaining });
    }
    markOnboardingComplete(ctx.db, req.user.sub, ctx.now());
    return onboardingStatus(loadProfile(ctx.db, req.user.sub), prefs);
  });

}

const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
