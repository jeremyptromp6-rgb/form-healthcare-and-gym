import {
  DEFAULT_NOTIFICATIONS,
  DEFAULT_SETTINGS,
  deriveProfileFields,
  type GoalChange,
  type NotificationPreferences,
  type NutritionPreferences,
  type PrimaryGoal,
  type UserProfile,
  type UserSettings,
} from "@form/domain";
import type { Db } from "../../db";

// ---- Profile ----------------------------------------------------------------------

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  primary_goal: UserProfile["primaryGoal"];
  sex: UserProfile["sex"];
  age_years: number | null;
  height_cm: number | null;
  weight_kg: number | null;
  experience: UserProfile["experience"];
  training_days_per_week: number | null;
  training_location: UserProfile["trainingLocation"];
  equipment: string | null;
  activity: UserProfile["activity"];
  goal: UserProfile["energyGoal"];
  onboarding_completed_at: string | null;
  updated_at: string;
}

export function loadProfile(db: Db, userId: string): UserProfile | null {
  const r = db.prepare("SELECT * FROM profiles WHERE user_id = ?").get(userId) as ProfileRow | undefined;
  if (!r) return null;
  return {
    userId: r.user_id,
    displayName: r.display_name,
    primaryGoal: r.primary_goal,
    sex: r.sex,
    ageYears: r.age_years,
    heightCm: r.height_cm,
    weightKg: r.weight_kg,
    experience: r.experience,
    trainingDaysPerWeek: r.training_days_per_week,
    trainingLocation: r.training_location,
    equipment: r.equipment ? JSON.parse(r.equipment) : null,
    activity: r.activity,
    energyGoal: r.goal,
    onboardingCompletedAt: r.onboarding_completed_at,
    updatedAt: r.updated_at,
  };
}

export function emptyProfile(userId: string, now: Date): UserProfile {
  return {
    userId,
    displayName: null,
    primaryGoal: null,
    sex: null,
    ageYears: null,
    heightCm: null,
    weightKg: null,
    experience: null,
    trainingDaysPerWeek: null,
    trainingLocation: null,
    equipment: null,
    activity: null,
    energyGoal: null,
    onboardingCompletedAt: null,
    updatedAt: now.toISOString(),
  };
}

/** Writes the whole profile. Derived fields are always recomputed here, never taken from input. */
export function writeProfile(db: Db, p: UserProfile, now: Date): UserProfile {
  const derived = deriveProfileFields(p);
  const next: UserProfile = { ...p, ...derived, updatedAt: now.toISOString() };
  db.prepare(
    `INSERT INTO profiles (user_id, display_name, primary_goal, sex, age_years, height_cm, weight_kg, experience,
       training_days_per_week, training_location, equipment, activity, goal, onboarding_completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET display_name = excluded.display_name, primary_goal = excluded.primary_goal,
       sex = excluded.sex, age_years = excluded.age_years, height_cm = excluded.height_cm, weight_kg = excluded.weight_kg,
       experience = excluded.experience, training_days_per_week = excluded.training_days_per_week,
       training_location = excluded.training_location, equipment = excluded.equipment, activity = excluded.activity,
       goal = excluded.goal, updated_at = excluded.updated_at`,
  ).run(
    next.userId,
    next.displayName,
    next.primaryGoal,
    next.sex,
    next.ageYears,
    next.heightCm,
    next.weightKg,
    next.experience,
    next.trainingDaysPerWeek,
    next.trainingLocation,
    next.equipment ? JSON.stringify(next.equipment) : null,
    next.activity,
    next.energyGoal,
    next.onboardingCompletedAt,
    next.updatedAt,
  );
  return next;
}

export function markOnboardingComplete(db: Db, userId: string, now: Date): void {
  db.prepare("UPDATE profiles SET onboarding_completed_at = ? WHERE user_id = ? AND onboarding_completed_at IS NULL").run(now.toISOString(), userId);
}

// ---- Goal history -------------------------------------------------------------------

export function loadGoalHistory(db: Db, userId: string): GoalChange[] {
  return (
    db.prepare("SELECT primary_goal, effective_from FROM goal_history WHERE user_id = ? ORDER BY effective_from").all(userId) as {
      primary_goal: PrimaryGoal;
      effective_from: string;
    }[]
  ).map((r) => ({ primaryGoal: r.primary_goal, effectiveFrom: r.effective_from }));
}

/** Records the goal in force from `effectiveFrom`. Changing twice in a day keeps the latest. */
export function recordGoal(db: Db, userId: string, goal: PrimaryGoal, effectiveFrom: string, now: Date): void {
  db.prepare(
    `INSERT INTO goal_history (user_id, primary_goal, effective_from, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, effective_from) DO UPDATE SET primary_goal = excluded.primary_goal, created_at = excluded.created_at`,
  ).run(userId, goal, effectiveFrom, now.toISOString());
}

// ---- Nutrition preferences ------------------------------------------------------------

interface PrefsRow {
  dietary_preferences: string;
  allergens: string;
  custom_allergies: string;
  disliked_foods: string;
  cooking_time: NutritionPreferences["cookingTime"];
  food_budget: NutritionPreferences["foodBudget"];
}

export function loadPreferences(db: Db, userId: string): NutritionPreferences | null {
  const r = db.prepare("SELECT * FROM nutrition_preferences WHERE user_id = ?").get(userId) as PrefsRow | undefined;
  if (!r) return null;
  return {
    dietaryPreferences: JSON.parse(r.dietary_preferences),
    allergens: JSON.parse(r.allergens),
    customAllergies: JSON.parse(r.custom_allergies),
    dislikedFoods: JSON.parse(r.disliked_foods),
    cookingTime: r.cooking_time,
    foodBudget: r.food_budget,
  };
}

export function writePreferences(db: Db, userId: string, p: NutritionPreferences, now: Date): void {
  db.prepare(
    `INSERT INTO nutrition_preferences (user_id, dietary_preferences, allergens, custom_allergies, disliked_foods, cooking_time, food_budget, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET dietary_preferences = excluded.dietary_preferences, allergens = excluded.allergens,
       custom_allergies = excluded.custom_allergies, disliked_foods = excluded.disliked_foods, cooking_time = excluded.cooking_time,
       food_budget = excluded.food_budget, updated_at = excluded.updated_at`,
  ).run(
    userId,
    JSON.stringify(p.dietaryPreferences),
    JSON.stringify(p.allergens),
    JSON.stringify(p.customAllergies),
    JSON.stringify(p.dislikedFoods),
    p.cookingTime,
    p.foodBudget,
    now.toISOString(),
  );
}

// ---- Weight history ------------------------------------------------------------------

export function upsertWeight(db: Db, userId: string, localDate: string, weightKg: number, now: Date): void {
  db.prepare(
    `INSERT INTO body_measurements (user_id, local_date, weight_kg, created_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, local_date) DO UPDATE SET weight_kg = excluded.weight_kg, created_at = excluded.created_at`,
  ).run(userId, localDate, weightKg, now.toISOString());
}

export function latestWeight(db: Db, userId: string): { localDate: string; weightKg: number } | null {
  const r = db
    .prepare("SELECT local_date, weight_kg FROM body_measurements WHERE user_id = ? AND weight_kg IS NOT NULL ORDER BY local_date DESC LIMIT 1")
    .get(userId) as { local_date: string; weight_kg: number } | undefined;
  return r ? { localDate: r.local_date, weightKg: r.weight_kg } : null;
}

export function weightHistory(db: Db, userId: string, limit: number) {
  return (
    db
      .prepare("SELECT local_date, weight_kg FROM body_measurements WHERE user_id = ? AND weight_kg IS NOT NULL ORDER BY local_date DESC LIMIT ?")
      .all(userId, limit) as { local_date: string; weight_kg: number }[]
  ).map((r) => ({ localDate: r.local_date, weightKg: r.weight_kg }));
}

// ---- Settings -------------------------------------------------------------------------

interface SettingsRow {
  units: UserSettings["units"];
  timezone: string | null;
  timezone_auto: number;
  date_format: UserSettings["dateFormat"];
  personalized_ads_consent: number;
  analytics_consent: number;
  ai_coach_enabled: number;
  ai_coach_consent: number;
  coach_keep_history: number;
  food_scan_consent: number;
}

export function loadSettings(db: Db, userId: string): UserSettings {
  const r = db.prepare("SELECT * FROM user_settings WHERE user_id = ?").get(userId) as SettingsRow | undefined;
  if (!r) return { ...DEFAULT_SETTINGS };
  return {
    units: r.units,
    timezone: r.timezone,
    timezoneAuto: r.timezone_auto === 1,
    dateFormat: r.date_format,
    personalizedAdsConsent: r.personalized_ads_consent === 1,
    analyticsConsent: r.analytics_consent === 1,
    aiCoachEnabled: r.ai_coach_enabled === 1,
    aiCoachConsent: r.ai_coach_consent === 1,
    coachKeepHistory: r.coach_keep_history === 1,
    foodScanConsent: r.food_scan_consent === 1,
  };
}

export function saveSettings(db: Db, userId: string, s: UserSettings, now: Date): void {
  db.prepare(
    `INSERT INTO user_settings (user_id, units, timezone, timezone_auto, date_format, personalized_ads_consent, analytics_consent, ai_coach_enabled, ai_coach_consent, coach_keep_history, food_scan_consent, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET units = excluded.units, timezone = excluded.timezone, timezone_auto = excluded.timezone_auto, date_format = excluded.date_format,
       personalized_ads_consent = excluded.personalized_ads_consent, analytics_consent = excluded.analytics_consent, ai_coach_enabled = excluded.ai_coach_enabled,
       ai_coach_consent = excluded.ai_coach_consent, coach_keep_history = excluded.coach_keep_history, food_scan_consent = excluded.food_scan_consent, updated_at = excluded.updated_at`,
  ).run(
    userId,
    s.units,
    s.timezone,
    Number(s.timezoneAuto),
    s.dateFormat,
    Number(s.personalizedAdsConsent),
    Number(s.analyticsConsent),
    Number(s.aiCoachEnabled),
    Number(s.aiCoachConsent),
    Number(s.coachKeepHistory),
    Number(s.foodScanConsent),
    now.toISOString(),
  );
}

// ---- Notification preferences -------------------------------------------------------------

export function loadNotifications(db: Db, userId: string): NotificationPreferences {
  const r = db.prepare("SELECT * FROM notification_preferences WHERE user_id = ?").get(userId) as Record<string, string | number | null> | undefined;
  if (!r) return { ...DEFAULT_NOTIFICATIONS, quietHours: DEFAULT_NOTIFICATIONS.quietHours ? { ...DEFAULT_NOTIFICATIONS.quietHours } : null };
  return {
    workoutReminders: r.workout_reminders === 1,
    workoutReminderTime: String(r.workout_reminder_time),
    mealReminders: r.meal_reminders === 1,
    weeklySummary: r.weekly_summary === 1,
    achievementAlerts: r.achievement_alerts === 1,
    streakAlerts: r.streak_alerts === 1,
    coachTips: r.coach_tips === 1,
    quietHours: r.quiet_start && r.quiet_end ? { start: String(r.quiet_start), end: String(r.quiet_end) } : null,
  };
}

export function saveNotifications(db: Db, userId: string, n: NotificationPreferences, now: Date): void {
  db.prepare(
    `INSERT INTO notification_preferences (user_id, workout_reminders, workout_reminder_time, meal_reminders, weekly_summary, achievement_alerts, streak_alerts, coach_tips, quiet_start, quiet_end, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET workout_reminders = excluded.workout_reminders, workout_reminder_time = excluded.workout_reminder_time,
       meal_reminders = excluded.meal_reminders, weekly_summary = excluded.weekly_summary, achievement_alerts = excluded.achievement_alerts,
       streak_alerts = excluded.streak_alerts, coach_tips = excluded.coach_tips, quiet_start = excluded.quiet_start, quiet_end = excluded.quiet_end, updated_at = excluded.updated_at`,
  ).run(
    userId,
    Number(n.workoutReminders),
    n.workoutReminderTime,
    Number(n.mealReminders),
    Number(n.weeklySummary),
    Number(n.achievementAlerts),
    Number(n.streakAlerts),
    Number(n.coachTips),
    n.quietHours?.start ?? null,
    n.quietHours?.end ?? null,
    now.toISOString(),
  );
}
