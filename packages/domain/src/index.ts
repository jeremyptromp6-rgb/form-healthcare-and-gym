// Shared
export * from "./shared/errors";
export * from "./shared/dates";
export * from "./shared/measurement";

// Providers & feature availability
export * from "./providers/result";
export * from "./providers/registry";
export * from "./providers/features";

// Users, profile, settings, onboarding, personalization
export * from "./users/users";
export * from "./users/profileOptions";
export * from "./personalization/personalization";

// Training
export * from "./workouts/exercises";
export * from "./workouts/workouts";
export * from "./workouts/workoutEngine";
export * from "./workouts/generator";
export * from "./workouts/adaptive";
export * from "./workouts/session";
export * from "./camera/pose";
export * from "./camera/analysis";
export * from "./camera/framing";
export * from "./camera/livePose";
export * from "./camera/liveCoach";
export * from "./analysis/features";
export * from "./analysis/formAnalysis";
export * from "./analysis/formIntelligence";
export * from "./analysis/setAnalysis";
export * from "./analysis/events";
export * from "./analysis/repVerification";

// Nutrition
export * from "./nutrition/nutritionCalculator";
export * from "./nutrition/units";
export * from "./nutrition/calculation";
export * from "./nutrition/models";
export * from "./nutrition/water";
export * from "./nutrition/foodLog";
export * from "./nutrition/nutritionContext";
export * from "./food/food";
export * from "./food/foodAssessment";
export * from "./food/catalog";
export * from "./food/search";
export * from "./food/userFoods";
export * from "./food/scan";
export * from "./food/scale";
export * from "./meals/meals";
export * from "./meals/planner";
export * from "./recipes/recipes";
export * from "./recipes/library";
export * from "./grocery/grocery";

// Progression & gamification
export * from "./progression/progressionEngine";
export * from "./progression/xpEvents";
export * from "./progression/consistency";
export * from "./streaks/streakEngine";
export * from "./records/personalRecords";
export * from "./quests/quests";
export * from "./achievements/achievements";
export * from "./bodyQuest/bodyQuest";
export * from "./bodyQuest/bodyQuestEngine";
export * from "./bodyQuest/insights";

// Home
export * from "./home/todayPlan";

// Coach, analytics, notifications
export * from "./coach/coach";
export * from "./coach/response";
export * from "./coach/deterministicCoach";
export * from "./progressAnalytics/progressAnalytics";
export * from "./analytics/analytics";
export * from "./notifications/notifications";

// Monetization
export * from "./subscriptions/entitlements";
export * from "./subscriptions/billing";
export * from "./reports/weeklyReport";
export * from "./ads/adProvider";
export * from "./ads/adService";
