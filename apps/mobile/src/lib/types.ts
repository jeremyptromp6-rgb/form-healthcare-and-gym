import type { AmountBasis, AmountMethod, AmountVia, DayTotals, FoodItem, FoodSource, FoodUnit, ImageQuality, Macros, MealType, NutrientProgress, NutritionTarget, ScanReviewItem, ScanStatus, SetQuality } from '@form/domain';

export type { FoodItem, MealType, AmountMethod, FoodUnit };

/** Response shapes of the FORM API. The API is the source of truth; the app only displays these. */

export interface User {
  id: string;
  email: string;
}

export interface Streak {
  current: number;
  longest: number;
  activeToday: boolean;
  restDaysRemaining: number | null;
}

export interface Progress {
  totalXp: number;
  level: number;
  rank: string;
  xpIntoLevel: number;
  xpForNextLevel: number;
  fractionToNext: number;
  /** Today's nutrition XP: shown now, settled into the ledger when the day ends. */
  provisionalXp: number;
  rankLadder: { name: string; minLevel: number; xpRequired: number }[];
  /** XP earned across all time, including before any reset. */
  lifetimeXp: number;
  /** Active epoch, by source. Decay is negative. */
  xpSources: { workouts: number; nutrition: number; quests: number; achievements: number; decay: number; corrections: number };
  nutritionXpEnabled: boolean;
  streak: Streak;
  consistency: {
    trainingDaysPerWeek: number;
    decayPerMissedDay: number;
    resetAfterDays: number;
    /** Days (counting today) within which a workout keeps active progress; null before the first workout. */
    trainWithinDays: number | null;
    recovering: boolean;
    missedThisWeek: number;
  };
  lastReset: { date: string; previousLevel: number; previousRank: string; previousActiveXp: number; gapDays: number } | null;
  recentLevelUp: { level: number; rank: string; at: string } | null;
}

export interface XpLedgerEntry {
  id: number;
  source: 'workout' | 'nutrition_day' | 'quest' | 'achievement' | 'decay' | 'reset' | 'correction';
  reference: string;
  kind: 'award' | 'adjustment' | 'decay' | 'reset' | 'correction';
  xp: number;
  localDate: string | null;
  label: string;
  detail: Record<string, unknown>;
  at: string;
}

export type Sex = 'male' | 'female' | 'unspecified';
export type Activity = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Goal = 'lose' | 'recomp' | 'maintain' | 'gain';
export type PrimaryGoal = 'build_muscle' | 'get_stronger' | 'lose_fat' | 'get_lean' | 'improve_fitness' | 'improve_health';
export type Experience = 'beginner' | 'intermediate' | 'advanced';
export type TrainingLocation = 'home' | 'gym' | 'both';

/** Stored profile. Nullable while onboarding is in progress; `activity` and `energyGoal` are server-derived. */
export interface UserProfile {
  displayName: string | null;
  primaryGoal: PrimaryGoal | null;
  sex: Sex | null;
  ageYears: number | null;
  heightCm: number | null;
  weightKg: number | null;
  experience: Experience | null;
  trainingDaysPerWeek: number | null;
  trainingLocation: TrainingLocation | null;
  equipment: string[] | null;
  activity: Activity | null;
  energyGoal: Goal | null;
  onboardingCompletedAt: string | null;
}

/** Fields the client may edit. */
export type ProfilePatch = Partial<
  Pick<UserProfile, 'displayName' | 'primaryGoal' | 'sex' | 'ageYears' | 'heightCm' | 'weightKg' | 'experience' | 'trainingDaysPerWeek' | 'trainingLocation'>
> & { equipment?: string[] };

/** Allergies (hard constraints) and dislikes (soft preferences) are deliberately separate. */
export interface NutritionPreferences {
  dietaryPreferences: string[];
  allergens: string[];
  customAllergies: string[];
  dislikedFoods: string[];
  cookingTime: string | null;
  foodBudget: string | null;
}

export type OnboardingStep = 'goal' | 'body' | 'training' | 'nutrition' | 'habits';

export interface Option {
  key: string;
  label: string;
  description?: string;
}

export interface ProfileOptions {
  goals: (Option & { key: PrimaryGoal; description: string; energyGoal: Goal })[];
  experienceLevels: (Option & { key: Experience; description: string })[];
  trainingLocations: (Option & { key: TrainingLocation })[];
  equipment: Option[];
  defaultEquipment: Record<TrainingLocation, string[]>;
  dietaryPreferences: (Option & { kind: 'restriction' | 'style' })[];
  exclusiveDietPatterns: string[];
  allergens: Option[];
  cookingTimes: (Option & { maxMinutes: number | null })[];
  foodBudgets: Option[];
  limits: {
    ageYears: { min: number; max: number };
    heightCm: { min: number; max: number };
    weightKg: { min: number; max: number };
    trainingDaysPerWeek: { min: number; max: number };
    displayNameLength: number;
    foodListMax: number;
    customAllergyMax: number;
    foodItemLength: number;
  };
}

export interface Personalization {
  goal: { primary: PrimaryGoal | null; energy: Goal | null; since: string | null };
  missing: OnboardingStep[];
  safety: { isMinor: boolean };
}

export interface WeightEntry {
  localDate: string;
  weightKg: number;
}

export interface Targets {
  bmrKcal: number;
  tdeeKcal: number;
  targetKcal: number;
  safeFloorKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  appliedGoal: Goal;
  notes?: string[];
}

export interface OnboardingStatus {
  completed: boolean;
  remaining: OnboardingStep[];
  nextStep: OnboardingStep | 'review' | null;
}

export interface UserSettings {
  units: 'metric' | 'imperial';
  timezone: string | null;
  personalizedAdsConsent: boolean;
  analyticsConsent: boolean;
  timezoneAuto: boolean;
  dateFormat: 'system' | 'day_month' | 'month_day' | 'iso';
  aiCoachEnabled: boolean;
  aiCoachConsent: boolean;
  coachKeepHistory: boolean;
  foodScanConsent: boolean;
}

export interface Me {
  user: User & { createdAt: string };
  profile: UserProfile | null;
  preferences: NutritionPreferences | null;
  targets: Targets | null;
  onboarding: OnboardingStatus;
  settings: UserSettings;
  hasPhoto: boolean;
}

export interface FoodLog {
  id: string;
  clientLogId: string | null;
  localDate: string;
  mealType: MealType;
  loggedAt: string;
  name: string;
  brand: string | null;
  foodId: string | null;
  source: FoodSource;
  amountMethod: AmountMethod;
  isEstimate: boolean;
  quantity: number | null;
  unit: FoodUnit | null;
  servingId: string | null;
  servingLabel: string | null;
  /** Rounded for display (the server stores full precision). */
  amount: number | null;
  amountUnit: AmountBasis | null;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  /** How the amount was normalised, the gram-first weight, and where a measured weight came from. */
  measurement: { via: AmountVia | null; grams: number | null; densityGPerMl: number | null; weightSource: 'typed' | 'scale' | null };
  /** What the numbers were calculated from (null for manual entries). */
  basis: { per100: Macros; unit: AmountBasis | null; calcVersion: number | null } | null;
  /** The scan this entry came from. */
  scanId: string | null;
  /** Entries logged together (a scan or a weighed meal) share a meal id and name. */
  mealId: string | null;
  mealName: string | null;
  /** The scan estimate this entry superseded, and what it said. */
  replacedLogId: string | null;
  replacedEstimate: { id: string; name: string; amount: number | null; amountUnit: AmountBasis | null; kcal: number; scanId: string | null; loggedAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type Aisle = 'protein' | 'carbohydrates' | 'produce' | 'other';

export interface Recipe {
  id: string;
  title: string;
  slots: MealType[];
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  totalMinutes: number;
  perServing: Macros;
  servingGrams: number;
  ingredients: { foodId: string; name: string; amount: number; unit: 'g' | 'ml'; note: string | null; aisle: Aisle }[];
  pantry: string[];
  steps: string[];
  allergens: string[];
  suitableFor: string[];
  styles: string[];
  costTier: number;
  source: 'form_library';
  saved: boolean;
  fit: { verdict: 'ok' | 'caution' | 'excluded'; matchedAllergens: string[]; disliked: boolean; overTime: boolean; overBudget: boolean };
}

export interface PlannedMealView {
  id: string;
  date: string;
  slot: MealType;
  recipeId: string;
  title: string;
  totalMinutes: number | null;
  servings: number;
  nutrients: Macros;
  status: 'planned' | 'eaten';
  foodLogId: string | null;
  canMarkEaten: boolean;
}

export interface MealPlanView {
  id: string;
  clientPlanId: string;
  startDate: string;
  days: number;
  dates: string[];
  status: 'active' | 'archived';
  targets: { kcal: number; proteinG: number; carbsG: number; fatG: number; safeFloorKcal: number };
  warnings: string[];
  meals: PlannedMealView[];
  totalsByDate: Record<string, { planned: Macros; eaten: Macros; meals: number }>;
  createdAt: string;
  updatedAt: string;
}

export interface MealAlternative {
  recipeId: string;
  title: string;
  servings: number;
  display: Macros;
  kcalDelta: number;
  proteinDelta: number;
  totalMinutes: number;
  notes: string[];
}

export interface GroceryItemView {
  id: string;
  name: string;
  source: 'plan' | 'recipe' | 'custom';
  foodId: string | null;
  amount: number | null;
  unit: 'g' | 'ml' | null;
  amountText: string | null;
  aisle: Aisle;
  checked: boolean;
}

export interface GroceryListView {
  sections: { aisle: Aisle; label: string; items: GroceryItemView[] }[];
  total: number;
  remaining: number;
  note: string;
}

export interface LoggedMeal {
  mealId: string;
  mealName: string | null;
  logs: FoodLog[];
  totals: DayTotals;
}

export interface FoodScan {
  id: string;
  clientScanId: string;
  status: ScanStatus;
  imageQuality: ImageQuality;
  items: ScanReviewItem[];
  provider: { name: string; development: boolean };
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  logs: FoodLog[];
}

export interface NutritionDay {
  date: string;
  isToday: boolean;
  logs: FoodLog[];
  totals: DayTotals;
  byMeal: Record<MealType, DayTotals>;
  progress: { kcal: NutrientProgress; proteinG: NutrientProgress; carbsG: NutrientProgress; fatG: NutrientProgress } | null;
  targets: NutritionTarget | null;
  water: { totalMl: number; targetMl: number; targetBasis: 'body_weight' | 'default'; progress: NutrientProgress; lastEntryId: string | null };
  xp: { xp: number; flags: string[]; settled: boolean } | null;
}

export interface RecentFood {
  food: FoodItem;
  last: { quantity: number; unit: FoodUnit; servingId: string | null; amountMethod: AmountMethod; mealType: MealType; loggedAt: string };
}

export type PainLevel = 'none' | 'mild' | 'serious';

export interface WorkoutSetResult {
  setIndex: number;
  exerciseId: string;
  reps: number;
  loadKg: number;
  verifiedReps: number;
  verificationStatus: string;
  romPercent: number | null;
}

export interface WorkoutResult {
  duplicate: boolean;
  workout: { id: string; xp: number; flags: string[]; sets?: WorkoutSetResult[] };
  prs?: { exerciseId: string; kind: string; value: number; previous: number | null; status: string }[];
  progress: Progress;
}

export interface WorkoutSummary {
  id: string;
  localDate: string;
  durationMinutes: number;
  painLevel: PainLevel;
  xp: number;
  createdAt: string;
}

export type PrKind = 'max_load' | 'estimated_1rm' | 'max_reps' | 'best_form' | 'best_rom' | 'workout_verified_reps' | 'longest_streak';

/** The current best for one metric — per exercise, or across all training (exerciseId null). */
export interface PersonalRecord {
  exerciseId: string | null;
  exerciseName: string | null;
  kind: PrKind;
  label: string;
  unit: string;
  direction: 'higher' | 'lower';
  value: number;
  display: string;
  previous: number | null;
  localDate: string | null;
  /** Set within the last 7 days. */
  recent: boolean;
}

export type TrendDirection = 'improving' | 'stable' | 'declining' | 'insufficient_data';
export type AnalyticsRange = 7 | 30 | 90;
export type AnalyticsSectionId = 'strength' | 'form' | 'rom' | 'verified_reps' | 'consistency' | 'nutrition' | 'weight' | 'xp' | 'prs' | 'body_quest' | 'quests';

export interface Trend {
  direction: TrendDirection;
  movement: 'up' | 'down' | 'flat' | null;
  from: number | null;
  to: number | null;
  change: number | null;
  changePercent: number | null;
  points: number;
  spanDays: number;
  reason: 'too_few_points' | 'too_short_span' | null;
}

/** A chart, ready to draw. Values are already in the user's units. */
export interface ChartModel {
  id: string;
  title: string;
  unit: string;
  trendUnit: string;
  kind: 'line' | 'bar';
  granularity: 'day' | 'week' | 'month';
  points: { key: string; value: number | null; estimated: boolean; partial: boolean }[];
  target: { value: number; label: string } | null;
  trend: Trend;
  state: 'ok' | 'no_data' | 'insufficient_data' | 'partial';
}

export interface AnalyticsSection<T> {
  available: boolean;
  /** A FORM Pro section this user doesn't have: the server sent no data for it. */
  locked?: { feature: PremiumFeatureId; title: string; pro: string } | null;
  focus: boolean;
  interpretation: string | null;
  data: T;
}

export interface PeriodSummary {
  key: string;
  from: string;
  to: string;
  partial: boolean;
  hasData: boolean;
  trainingDays: number;
  workouts: number;
  minutes: number;
  verifiedReps: number;
  averageForm: number | null;
  daysLogged: number;
  averageKcal: number | null;
  averageProteinG: number | null;
  xpEarned: number;
  prs: number;
}

export interface ProgressAnalytics {
  range: { days: AnalyticsRange; from: string; to: string; timezone: string; granularity: 'day' | 'week' | 'month' };
  units: 'metric' | 'imperial';
  goal: { primary: string | null };
  order: AnalyticsSectionId[];
  strength: AnalyticsSection<{ exercises: { exerciseId: string; name: string; sessions: number; measure: 'estimated_1rm' | 'verified_reps' }[]; selected: { exerciseId: string; name: string; measure: 'estimated_1rm' | 'verified_reps'; chart: ChartModel; best: number | null } | null }>;
  form: AnalyticsSection<{ chart: ChartModel; averageScore: number | null; reps: number }>;
  rom: AnalyticsSection<{ chart: ChartModel; averagePercent: number | null; reps: number }>;
  verifiedReps: AnalyticsSection<{ chart: ChartModel; total: number }>;
  consistency: AnalyticsSection<{ chart: ChartModel; trainingDays: number; plannedDays: number; adherencePercent: number | null; workouts: number; minutes: number }>;
  nutrition: AnalyticsSection<{ kcalChart: ChartModel; proteinChart: ChartModel; daysLogged: number; daysOnTarget: number; daysMeetingProtein: number; daysBelowSafeMinimum: number; estimatedPercent: number | null; measuredPercent: number | null; hasTargets: boolean }>;
  weight: AnalyticsSection<{ chart: ChartModel; latest: number | null; latestDate: string | null; entries: number }>;
  xp: AnalyticsSection<{ chart: ChartModel; earned: number; lost: number; levelUps: { level: number; rank: string; date: string }[]; level: number; rank: string; resets: string[] }>;
  prs: AnalyticsSection<{ chart: ChartModel; records: { date: string; exercise: string; label: string; display: string; previousDisplay: string | null; beaten: boolean }[] }>;
  quests: AnalyticsSection<{ completed: number; daily: number; weekly: number; history: { title: string; cadence: 'daily' | 'weekly'; period: string; xpReward: number }[] }>;
  bodyQuest: AnalyticsSection<{ chart: ChartModel; stage: string; overall: number | null; stageChanges: { weekStart: string; from: string; to: string }[] }>;
  achievements: { unlocked: { id: string; title: string; date: string }[] };
  streaks: { workout: { current: number; longest: number }; weekly: { current: number; longest: number }; nutrition: { current: number; longest: number; available: boolean }; quest: { current: number; longest: number } };
  summaries: { daily: PeriodSummary[] | null; weekly: PeriodSummary[] | null; monthly: PeriodSummary[] | null };
  generatedAt: string;
}

export type CoachMode = 'real_ai' | 'deterministic_fallback' | 'unavailable';
export type CoachTopic = 'daily_insight' | 'home' | 'workout' | 'form' | 'nutrition' | 'consistency' | 'pr' | 'body_quest' | 'progression';

/** A validated coaching answer. Every fact in it came from FORM's own records. */
export interface CoachResponse {
  topic: CoachTopic | 'chat';
  message: string;
  category: 'daily_insight' | 'workout' | 'form' | 'nutrition' | 'consistency' | 'pr' | 'body_quest' | 'progression' | 'recovery' | 'general';
  priority: 'low' | 'normal' | 'high';
  evidence: { fact: string; claim: string; value: string }[];
  actions: { id: string; label: string; route: string }[];
  confidence: 'low' | 'medium' | 'high';
  generatedAt: string;
  provider: { type: Exclude<CoachMode, 'unavailable'>; name: string };
  degraded: 'unconfigured' | 'no_consent' | 'timeout' | 'rate_limited' | 'provider_error' | 'invalid_output' | 'daily_limit' | null;
}

/** FORM's notification preferences — separate from the device's permission to notify. */
export interface NotificationPreferences {
  workoutReminders: boolean;
  workoutReminderTime: string;
  mealReminders: boolean;
  weeklySummary: boolean;
  achievementAlerts: boolean;
  streakAlerts: boolean;
  coachTips: boolean;
  quietHours: { start: string; end: string } | null;
}

export interface ProfileSummaryStats {
  workouts: { rangeDays: number; workouts: number; trainingDays: number; minutes: number; verifiedReps: number; adherencePercent: number | null };
  nutrition: { rangeDays: number; daysLogged: number; daysOnTarget: number; daysMeetingProtein: number; estimatedPercent: number | null; hasTargets: boolean; averageKcal: number | null };
  recordsBeaten: number;
}

export interface CoachStatus {
  mode: CoachMode;
  provider: string;
  reason: 'unconfigured' | 'rules_only' | 'consent_required' | 'disabled_by_user' | null;
  aiAvailable: boolean;
  settings: { enabled: boolean; aiConsent: boolean; keepHistory: boolean };
  chat: { available: boolean; maxChars: number; perHour: number };
  retentionDays: number;
}

export interface CoachTurn {
  id: number;
  role: 'user' | 'coach';
  text: string;
  response: CoachResponse | null;
  at: string;
}

export type AchievementState = 'locked' | 'in_progress' | 'unlocked';

export interface Achievement {
  id: string;
  title: string;
  description: string;
  xpReward: number;
  requires: 'camera' | 'nutrition_targets' | null;
  state: AchievementState;
  progress: number;
  target: number;
  unlockedAt: string | null;
}

export interface StreakState {
  current: number;
  longest: number;
  activeToday: boolean;
  restDaysRemaining: number | null;
  startDate: string | null;
}

export interface Streaks {
  workout: StreakState & { plannedRestDays: number };
  nutrition: StreakState & { available: boolean };
  quest: StreakState;
  weekly: { current: number; longest: number; metThisWeek: boolean; startWeek: string | null; target: number };
}

export const BODY_QUEST_STAGES = ['starter', 'foundation', 'builder', 'athlete', 'elite'] as const;
export type BodyQuestStage = (typeof BODY_QUEST_STAGES)[number];
export const BODY_QUEST_STATS = ['strength', 'muscle', 'endurance', 'mobility', 'form', 'consistency'] as const;
export type BodyQuestStat = (typeof BODY_QUEST_STATS)[number];

export interface BodyQuestStatResult {
  value: number | null;
  status: 'ok' | 'insufficient_data';
  sample: number;
  needs: 'verify_same_exercise_twice' | 'train_for_a_week' | 'verify_more_reps' | 'train_more' | null;
  detail: Record<string, number>;
}

export interface BodyQuest {
  engineVersion: number;
  asOf: string;
  stage: BodyQuestStage;
  highestStage: BodyQuestStage;
  overall: number | null;
  stats: Record<BodyQuestStat, BodyQuestStatResult>;
  statsWithData: number;
  historyWeeks: number;
  next: { stage: BodyQuestStage; requirements: { kind: 'overall' | 'stats' | 'weeks'; needed: number; have: number; met: boolean }[] } | null;
  snapshots: { weekStart: string; asOf: string; stage: BodyQuestStage; overall: number | null; stats: Record<BodyQuestStat, number | null>; engineVersion: number }[];
}

export type Celebration =
  | { id: number; kind: 'achievement'; at: string; payload: { achievementId: string; title: string; description: string; xpReward: number } }
  | { id: number; kind: 'personal_record'; at: string; payload: { workoutId: string; exerciseId: string; exerciseName: string | null; kind: PrKind; label: string; display: string; previousDisplay: string; rewarded: boolean } }
  | { id: number; kind: 'streak'; at: string; payload: { streak: 'workout' | 'nutrition' | 'quest' | 'weekly'; length: number; startDate: string } }
  | { id: number; kind: 'body_quest'; at: string; payload: { stage: BodyQuestStage; overall: number | null } };

export interface Exercise {
  id: string;
  name: string;
  kind: 'bodyweight' | 'weighted';
  cameraVerifiable: boolean;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[][];
  pattern: string;
  difficulty: Experience;
  loadable: boolean;
  loadIncrementKg: number;
  targetReps: { min: number; max: number };
  perSide: boolean;
  instructions: string[];
  safety: string[];
  camera: { joint: 'knee' | 'elbow'; view: 'side' | 'front'; setup: string } | null;
}

export type Progression = 'new' | 'repeat' | 'increase_load' | 'increase_reps' | 'deload' | 'hold_for_rom' | 'hold_for_form';

export interface PlannedExercise {
  exerciseId: string;
  name: string;
  sets: number;
  targetReps: { min: number; max: number };
  targetLoadKg: number | null;
  restSeconds: number;
  progression: Progression;
  note: string | null;
  cameraVerifiable: boolean;
}

export interface WorkoutPlan {
  generator: { id: string; version: number };
  date: string;
  title: string;
  focus: 'full_body' | 'upper' | 'lower';
  exercises: PlannedExercise[];
  estimatedMinutes: number;
  notes: string[];
}

export interface TodayWorkout {
  date: string;
  planId: string;
  plan: WorkoutPlan;
  /** Workouts already completed today. */
  completedToday: number;
  activeSession: { id: string; status: 'active' | 'paused'; localDate: string } | null;
}

export interface SessionSet {
  id: string;
  clientSetId: string;
  exerciseId: string;
  setIndex: number;
  targetReps: number | null;
  targetLoadKg: number | null;
  reps: number;
  loadKg: number;
  verifiedReps: number;
  verificationStatus: string;
  romPercent: number | null;
  formScore: number | null;
  /** Camera analysis summary (attempted / verified / perfect reps, averages); null without a trace. */
  quality: SetQuality | null;
  createdAt: string;
}

export interface SessionExercise {
  exerciseId: string;
  name: string;
  planned: boolean;
  sets: number | null;
  targetReps: { min: number; max: number } | null;
  targetLoadKg: number | null;
  restSeconds: number;
  note: string | null;
  cameraVerifiable: boolean;
  loadable: boolean;
  previous: { localDate: string; sets: { reps: number; loadKg: number }[] } | null;
  loggedSets: SessionSet[];
}

export interface WorkoutSession {
  id: string;
  clientSessionId: string;
  status: 'active' | 'paused' | 'completed' | 'discarded';
  localDate: string;
  startedAt: string;
  pausedAt: string | null;
  pausedMs: number;
  activeMinutes: number;
  lastActivityAt: string;
  /** Idle past the limit since this time: the clock is stopped there until the user acts again. */
  idleSince: string | null;
  /** Untouched for a long while, or started on an earlier day: finish it with what was logged, or discard it. */
  leftOpen: boolean;
  rest: { endsAt: string; seconds: number | null; remainingSeconds: number | null } | null;
  workoutId: string | null;
  completedAt: string | null;
  exercises: SessionExercise[];
}

export interface WorkoutSummaryDetail {
  workout: { id: string; localDate: string; durationMinutes: number; painLevel: PainLevel; xp: number; flags: string[] };
  totals: { sets: number; reps: number; verifiedReps: number; volumeKg: number; perfectReps: number; averageFormScore: number | null };
  sets: { exerciseId: string; name: string; setIndex: number; targetReps: number | null; reps: number; verifiedReps: number; loadKg: number; romPercent: number | null; formScore: number | null; quality: SetQuality | null }[];
  prs: { exerciseId: string; kind: string; value: number; status: string; previous?: number | null }[];
}

export interface CompletionResult extends WorkoutSummaryDetail {
  duplicate: boolean;
  progress: Progress;
}

export interface ExerciseDetail {
  exercise: Exercise;
  history: { workoutId: string; localDate: string; sets: { reps: number; verifiedReps: number; loadKg: number; romPercent: number | null }[] }[];
  records: { kind: string; value: number }[];
}

export type PremiumFeatureId =
  | 'AI_COACH_ADVANCED'
  | 'ADAPTIVE_TRAINING'
  | 'ADVANCED_FORM_ANALYSIS'
  | 'ADVANCED_ROM_ANALYSIS'
  | 'FOOD_SCANNER_PREMIUM'
  | 'MEAL_PLANNER_ADVANCED'
  | 'ADVANCED_PROGRESS'
  | 'WEEKLY_AI_REPORT'
  | 'ADVANCED_BODY_QUEST'
  | 'PERSONALIZED_RECOMMENDATIONS'
  | 'AD_FREE';

export type SubscriptionState = 'FREE' | 'PRO_TRIAL' | 'PRO_ACTIVE' | 'PRO_CANCELLED' | 'PRO_GRACE_PERIOD' | 'PRO_BILLING_ISSUE' | 'PRO_EXPIRED';

/** What the server says this user can use — the app never decides this itself. */
export interface Entitlements {
  tier: 'free' | 'pro';
  state: SubscriptionState;
  features: PremiumFeatureId[];
  productId: string | null;
  accessUntil: string | null;
  willRenew: boolean;
  environment: 'production' | 'sandbox' | 'development' | null;
  source: 'store' | 'development' | 'admin_grant' | null;
  /** Free allowances (null on Pro). */
  limits: { foodScansPerDay: number; coachChatPerDay: number; aiCallsPerDay: number; mealPlanDays: number; analyticsRangeDays: number } | null;
  usage: { foodScansToday: number; coachChatsToday: number };
}

export interface PremiumFeature {
  id: PremiumFeatureId;
  title: string;
  pro: string;
  free: string;
}

export interface BillingProduct {
  id: string;
  plan: 'monthly' | 'annual';
  title: string;
  period: 'P1M' | 'P1Y';
  price: { amount: number; currency: string; display: string } | null;
  trialDays: number | null;
  environment: 'production' | 'sandbox' | 'development';
}

export interface BillingCatalog {
  provider: { configured: boolean; name: string; environment: 'production' | 'sandbox' | 'development' | null };
  products: BillingProduct[];
  features: PremiumFeature[];
  manageUrl: string | null;
  legal: { termsUrl: string | null; privacyUrl: string | null };
}

export interface WeeklyReport {
  weekStart: string;
  weekEnd: string;
  training: {
    workouts: number;
    trainingDays: number;
    plannedDays: number | null;
    minutes: number;
    verifiedReps: number;
    averageFormScore: number | null;
    averageRomPercent: number | null;
    change: { workouts: number; verifiedReps: number; formScore: number | null } | null;
  };
  recordsBeaten: { exercise: string; label: string; display: string }[];
  nutrition: { daysLogged: number; hasTargets: boolean; proteinDaysMet: number; daysOnTarget: number; daysBelowSafeMinimum: number };
  xp: { earned: number; levelAtEnd: number; rankAtEnd: string };
  bodyQuest: { stageAtStart: string | null; stageAtEnd: string | null; overallAtStart: number | null; overallAtEnd: number | null } | null;
  highlights: string[];
  focus: string;
  empty: boolean;
}

export interface WeeklyReportEntry {
  weekStart: string;
  generatedAt: string;
  report: WeeklyReport;
  coach: CoachResponse | null;
}

export interface FormIntelligence {
  sessions: { localDate: string; workoutId: string; topLoadKg: number; verifiedReps: number; formScore: number | null; romPercent: number | null; repSpread: number | null }[];
  formTrend: Trend;
  romTrend: Trend;
  issues: { code: string; label: string; earlierPercent: number; recentPercent: number; change: 'fewer' | 'more' | 'steady' }[];
  byLoad: { loadKg: number; sessions: number; reps: number; formScore: number | null; romPercent: number | null }[];
  insights: string[];
  reps: number;
}

export interface RestOfToday {
  date: string;
  eaten: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  remaining: { kcal: number; proteinG: number; carbsG: number; fatG: number };
  meals: { slot: MealType; recipeId: string; title: string; servings: number; nutrients: { kcal: number; proteinG: number; carbsG: number; fatG: number } }[];
  warnings: string[];
  done: boolean;
}

export interface BodyQuestInsights {
  stats: { stat: string; value: number | null; history: { weekStart: string; value: number | null }[]; change4w: number | null; lever: string }[];
  focus: { stat: string; value: number; lever: string } | null;
  strongest: { stat: string; value: number } | null;
}

export type ProviderKind = 'ai' | 'pose' | 'food_recognition' | 'billing' | 'ads' | 'analytics' | 'notifications';

export interface ProviderStatus {
  kind: ProviderKind;
  state: 'ready' | 'unconfigured' | 'degraded';
  provider: string;
  missing?: string[];
  reason?: string;
}

export type FeatureKey =
  | 'camera_verification'
  | 'food_scan'
  | 'ai_coach'
  | 'pro_purchase'
  | 'ads'
  | 'quests'
  | 'achievements'
  | 'body_quest'
  | 'meal_planner'
  | 'recipes'
  | 'grocery';

export type FeatureMap = Record<FeatureKey, { available: true } | { available: false; reason: 'provider_unconfigured' | 'not_built' }>;

export interface QuestProgress {
  id: string;
  title: string;
  cadence: 'daily' | 'weekly';
  periodKey: string;
  progress: number;
  target: number;
  xpReward: number;
  completed: boolean;
}

export type HomeSection = 'progression' | 'today' | 'nutrition' | 'water' | 'quests' | 'activity' | 'recognition';
export type TodayKind = 'recover' | 'done_today' | 'weekly_goal_met' | 'rest_suggested' | 'train';

/** Home view model — one server aggregation for the user's local day. `null` sections failed to load (see `errors`). */
export interface HomeViewModel {
  generatedAt: string;
  date: string;
  timezone: string;
  timezoneSource: 'stored' | 'client' | 'utc';
  greeting: { period: 'morning' | 'afternoon' | 'evening' | 'night'; name: string; primaryGoal: PrimaryGoal | null };
  state: 'new' | 'returning' | 'active';
  daysSinceLastActivity: number | null;
  firstSteps: { key: 'workout' | 'meal' | 'water'; done: boolean }[] | null;
  progression: {
    level: number;
    rank: string;
    totalXp: number;
    xpIntoLevel: number;
    xpForNextLevel: number;
    fractionToNext: number;
    provisionalXp: number;
    nextRank: { name: string; minLevel: number } | null;
    streak: Streak;
    trainWithinDays: number | null;
    lastResetDate: string | null;
  } | null;
  today: {
    suggestion: { kind: TodayKind; title: string; reason: string };
    plannedDaysPerWeek: number | null;
    workoutsThisWeek: number;
    trainedToday: boolean;
    lastWorkout: {
      localDate: string;
      durationMinutes: number;
      xp: number;
      exercises: { exerciseId: string; name: string; sets: number; totalReps: number; verifiedReps: number; bestLoadKg: number }[];
    } | null;
  } | null;
  nutrition: {
    kcal: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    mealsLogged: number;
    mealsWithFood: number;
    remainingKcal: number | null;
    estimatedKcalShare: number;
    measuredKcalShare: number;
    targets: { kcal: number; proteinG: number; carbsG: number; fatG: number; safeFloorKcal: number } | null;
  } | null;
  water: { totalMl: number; targetMl: number; targetBasis: 'body_weight' | 'default'; lastEntryId: string | null; entries: number } | null;
  quests: { available: true; daily: QuestProgress[]; weekly: QuestProgress[] } | null;
  bodyQuest: { available: false } | { available: true; stage: BodyQuestStage; highestStage: BodyQuestStage; overall: number | null; statsWithData: number; nextStage: BodyQuestStage | null };
  achievements:
    | { available: false; recent: { id: string; title: string; unlockedAt: string }[] }
    | {
        available: true;
        unlocked: number;
        total: number;
        recent: { id: string; title: string; unlockedAt: string }[];
        next: { id: string; title: string; progress: number; target: number } | null;
      };
  streaks: {
    workout: { current: number; longest: number };
    nutrition: { current: number; longest: number; available: boolean };
    quest: { current: number; longest: number };
    weekly: { current: number; longest: number; target: number; metThisWeek: boolean };
  } | null;
  /** Which coach answers: real AI, labelled rules, or none. */
  coach: { mode: CoachMode; provider: string };
  errors: HomeSection[];
}

export type AdDecision =
  | { served: true; creative: { adId: string; network: string; placement: string } }
  | { served: false; reason: string; retryable: boolean };
