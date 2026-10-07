import type { MeasureUnit, RepTrace } from '@form/domain';
import { config } from './config';
import type {
  AdDecision,
  CompletionResult,
  Entitlements,
  Exercise,
  ExerciseDetail,
  FeatureMap,
  AmountMethod,
  FoodItem,
  FoodLog,
  FoodScan,
  FoodUnit,
  GroceryListView,
  HomeViewModel,
  LoggedMeal,
  MealAlternative,
  MealPlanView,
  Recipe,
  XpLedgerEntry,
  MealType,
  RecentFood,
  Me,
  NutritionDay,
  NutritionPreferences,
  OnboardingStatus,
  Personalization,
  ProfileOptions,
  ProfilePatch,
  PainLevel,
  PersonalRecord,
  NotificationPreferences,
  ProfileSummaryStats,
  AnalyticsRange,
  ProgressAnalytics,
  CoachResponse,
  CoachStatus,
  CoachTopic,
  CoachTurn,
  Achievement,
  BodyQuest,
  Celebration,
  Streaks,
  SessionSet,
  TodayWorkout,
  WorkoutSession,
  WorkoutSummaryDetail,
  Progress,
  ProviderStatus,
  Targets,
  User,
  UserProfile,
  UserSettings,
  WeightEntry,
  WorkoutResult,
  WorkoutSummary, BillingCatalog, BodyQuestInsights, FormIntelligence, RestOfToday, WeeklyReportEntry } from './types';

export type ApiErrorKind = 'network' | 'unauthorized' | 'forbidden' | 'validation' | 'not_found' | 'rate_limited' | 'unavailable' | 'pro_required' | 'server';

export class ApiError extends Error {
  constructor(
    readonly kind: ApiErrorKind,
    readonly code: string,
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'unauthorized';
  if (status === 402) return 'pro_required';
  if (status === 403) return 'forbidden';
  if (status === 400 || status === 409 || status === 422) return 'validation';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unavailable';
  return 'server';
}

export async function request<T>(path: string, opts: { method?: string; body?: unknown; token?: string | null; timeoutMs?: number } = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? config.requestTimeoutMs);
  let res: Response;
  try {
    res = await fetch(`${config.apiUrl}${path}`, {
      method: opts.method ?? 'GET',
      headers: {
        ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal,
    });
  } catch {
    throw new ApiError('network', 'network', "Can't reach FORM. Check your connection.", null, true);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 204) return undefined as T;
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const err = json?.error ?? {};
    const kind = kindForStatus(res.status);
    const retryable = err.details?.retryable ?? (kind === 'server' || kind === 'rate_limited');
    throw new ApiError(kind, err.code ?? 'unknown', err.message ?? 'Something went wrong', res.status, retryable, err.details);
  }
  return json as T;
}

type AuthResponse = { token: string; user: User };

const COACH_TIMEOUT_MS = 35_000;

export interface NewFoodLog {
  clientLogId: string;
  /** Replace a scan estimate with this (e.g. weighed) entry. */
  replacesLogId?: string;
  localDate?: string;
  mealType?: MealType;
  amountMethod: AmountMethod;
  /** Measured entries: typed from a scale's display (default) or read from a connected scale. */
  weightSource?: WeightSource;
  food?: { foodId: string; quantity: number; unit: FoodUnit; servingId?: string | null };
  manual?: { name: string; kcal: number; proteinG: number; carbsG: number; fatG: number; quantity?: number | null; unit?: MeasureUnit | null };
}

export type WeightSource = 'typed' | 'scale';

/** Everything that changes a meal plan; each returns the updated plan. */
export type PlanAction =
  | { kind: 'servings'; planId: string; mealId: string; servings: number }
  | { kind: 'swap'; planId: string; mealId: string; recipeId: string; servings: number }
  | { kind: 'add'; planId: string; date: string; slot: MealType; recipeId: string; servings: number }
  | { kind: 'remove'; planId: string; mealId: string }
  | { kind: 'eaten'; planId: string; mealId: string; clientLogId: string }
  | { kind: 'uneaten'; planId: string; mealId: string }
  | { kind: 'repeat'; planId: string; date: string; toDates: string[] };

function planActionPath(a: PlanAction): string {
  const base = `/meal-plans/${a.planId}`;
  switch (a.kind) {
    case 'add':
      return `${base}/meals`;
    case 'repeat':
      return `${base}/days/${a.date}/repeat`;
    case 'eaten':
    case 'uneaten':
      return `${base}/meals/${a.mealId}/eaten`;
    default:
      return `${base}/meals/${a.mealId}`;
  }
}
function planActionMethod(a: PlanAction): string {
  return a.kind === 'add' || a.kind === 'eaten' || a.kind === 'repeat' ? 'POST' : a.kind === 'remove' || a.kind === 'uneaten' ? 'DELETE' : 'PATCH';
}
function planActionBody(a: PlanAction): object | undefined {
  switch (a.kind) {
    case 'servings':
      return { servings: a.servings };
    case 'swap':
      return { recipeId: a.recipeId, servings: a.servings };
    case 'add':
      return { date: a.date, slot: a.slot, recipeId: a.recipeId, servings: a.servings };
    case 'eaten':
      return { clientLogId: a.clientLogId };
    case 'repeat':
      return { toDates: a.toDates };
    default:
      return undefined;
  }
}

export type GroceryAction =
  | { kind: 'check'; itemId: string; checked: boolean }
  | { kind: 'delete'; itemId: string }
  | { kind: 'custom'; clientItemId: string; name: string; quantity?: string | null }
  | { kind: 'recipe'; recipeId: string; servings: number }
  | { kind: 'clear' };

function groceryPath(a: GroceryAction): string {
  if (a.kind === 'check' || a.kind === 'delete') return `/grocery/items/${a.itemId}`;
  if (a.kind === 'custom') return '/grocery/items';
  if (a.kind === 'recipe') return `/grocery/recipes/${encodeURIComponent(a.recipeId)}`;
  return '/grocery/clear-checked';
}
function groceryMethod(a: GroceryAction): string {
  return a.kind === 'check' ? 'PATCH' : a.kind === 'delete' ? 'DELETE' : 'POST';
}
function groceryBody(a: GroceryAction): object | undefined {
  if (a.kind === 'check') return { checked: a.checked };
  if (a.kind === 'custom') return { clientItemId: a.clientItemId, name: a.name, ...(a.quantity ? { quantity: a.quantity } : {}) };
  if (a.kind === 'recipe') return { servings: a.servings };
  return undefined;
}

export interface NewMeal {
  clientMealId: string;
  localDate?: string;
  mealType?: MealType;
  mealName?: string | null;
  items: { food: { foodId: string; quantity: number; unit: FoodUnit; servingId?: string | null }; amountMethod: AmountMethod; weightSource?: WeightSource; replacesLogId?: string }[];
}

export type FoodLogPatch = Partial<{
  mealType: MealType;
  localDate: string;
  amountMethod: AmountMethod;
  weightSource: WeightSource;
  quantity: number;
  unit: FoodUnit;
  servingId: string | null;
  name: string;
  kcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}>;

export interface ScanConfirmation {
  confirmKey: string;
  localDate?: string;
  mealType: MealType;
  mealName?: string | null;
  items: { itemId: string; remove?: boolean; optionKey?: string; foodId?: string; amount?: number }[];
}

export interface NewUserFood {
  clientFoodId: string;
  name: string;
  brand?: string | null;
  basis: 'g' | 'ml';
  servingLabel: string;
  servingAmount: number;
  perServing: { kcal: number; proteinG: number; carbsG: number; fatG: number };
}


export interface NewSet {
  clientSetId: string;
  exerciseId: string;
  reps: number;
  loadKg: number;
  targetReps?: number;
  targetLoadKg?: number;
  restSeconds?: number;
  /** Camera trace (angles + form features); the server verifies reps, form and ROM from it. */
  trace?: RepTrace;
}

export interface NewWorkout {
  clientWorkoutId: string;
  localDate: string;
  durationMinutes: number;
  painLevel: PainLevel;
  sets: { exerciseId: string; reps: number; loadKg: number }[];
}

/** Typed FORM API. Every authenticated call takes the session token first. */
export const api = {
  register: (email: string, password: string) => request<AuthResponse>('/auth/register', { method: 'POST', body: { email, password } }),
  login: (email: string, password: string) => request<AuthResponse>('/auth/login', { method: 'POST', body: { email, password } }),
  logoutAll: (token: string) => request<void>('/auth/logout-all', { method: 'POST', token }),

  me: (token: string, today: string) => request<Me>(`/me?today=${today}`, { token }),
  catalog: (token: string) => request<ProfileOptions>('/catalog/profile-options', { token }),
  patchProfile: (token: string, patch: ProfilePatch & { localDate: string }) =>
    request<{ profile: UserProfile; targets: Targets | null; onboarding: OnboardingStatus; personalization: Personalization }>('/me/profile', {
      method: 'PATCH',
      body: patch,
      token,
    }),
  patchPreferences: (token: string, patch: Partial<NutritionPreferences>) =>
    request<{ preferences: NutritionPreferences; movedToAllergies: string[]; onboarding: OnboardingStatus }>('/me/preferences', {
      method: 'PATCH',
      body: patch,
      token,
    }),
  personalization: (token: string, today: string) => request<Personalization>(`/me/personalization?today=${today}`, { token }),
  weightHistory: (token: string) => request<{ entries: WeightEntry[] }>('/me/weight?limit=90', { token }),
  logWeight: (token: string, body: WeightEntry) => request<{ entry: WeightEntry; currentWeightKg: number | null }>('/me/weight', { method: 'POST', body, token }),
  deleteWeight: (token: string, localDate: string) => request<void>(`/me/weight/${localDate}`, { method: 'DELETE', token }),
  photo: (token: string) => request<{ mimeType: string; data: string; updatedAt: string }>('/me/photo', { token }),
  uploadPhoto: (token: string, body: { mimeType: 'image/jpeg' | 'image/png'; data: string }) =>
    request<{ mimeType: string; byteSize: number }>('/me/photo', { method: 'PUT', body, token }),
  deletePhoto: (token: string) => request<void>('/me/photo', { method: 'DELETE', token }),
  notifications: (token: string) => request<NotificationPreferences>('/me/notifications', { token }),
  updateNotifications: (token: string, patch: Partial<NotificationPreferences>) => request<NotificationPreferences>('/me/notifications', { method: 'PATCH', token, body: patch }),
  profileSummary: (token: string, today: string) => request<ProfileSummaryStats>(`/me/summary?today=${today}`, { token }),
  dataSummary: (token: string) => request<{ counts: Record<string, number> }>('/me/data-summary', { token }),
  /** The full export as text (JSON), after re-entering the password. */
  exportData: (token: string, password: string) => request<unknown>('/me/export', { method: 'POST', token, body: { password }, timeoutMs: 60_000 }),
  changePassword: (token: string, currentPassword: string, newPassword: string) => request<{ token: string }>('/auth/password', { method: 'POST', token, body: { currentPassword, newPassword } }),
  legal: () => request<{ termsUrl: string | null; privacyUrl: string | null }>('/legal'),
  updateSettings: (token: string, patch: Partial<UserSettings>) => request<UserSettings>('/me/settings', { method: 'PATCH', body: patch, token }),
  completeOnboarding: (token: string) => request<OnboardingStatus>('/onboarding/complete', { method: 'POST', token }),
  deleteAccount: (token: string, body: { password: string; confirm: string; acknowledgeSubscription?: boolean }) => request<void>('/me', { method: 'DELETE', token, body }),

  home: (token: string, today: string) => request<HomeViewModel>(`/home?today=${today}`, { token }),
  addWater: (token: string, body: { clientLogId: string; ml: number }) => request<{ duplicate: boolean }>('/water', { method: 'POST', body, token }),
  deleteWater: (token: string, id: string) => request<void>(`/water/${id}`, { method: 'DELETE', token }),
  progress: (token: string, today: string) => request<Progress>(`/progress?today=${today}`, { token }),
  records: (token: string) => request<{ records: PersonalRecord[] }>('/records', { token }),
  exercises: (token: string) => request<{ exercises: Exercise[] }>('/exercises', { token }),
  todayWorkout: (token: string) => request<TodayWorkout>('/workouts/today', { token }),
  regeneratePlan: (token: string) => request<TodayWorkout>('/workouts/today/regenerate', { method: 'POST', token }),
  startSession: (token: string, clientSessionId: string, source: 'plan' | 'empty') =>
    request<{ session: WorkoutSession }>('/workouts/sessions', { method: 'POST', body: { clientSessionId, source }, token }),
  activeSession: (token: string) => request<{ session: WorkoutSession | null }>('/workouts/sessions/active', { token }),
  session: (token: string, id: string) => request<{ session: WorkoutSession }>(`/workouts/sessions/${id}`, { token }),
  logSet: (token: string, id: string, body: NewSet) =>
    request<{ set: SessionSet; session: WorkoutSession }>(`/workouts/sessions/${id}/sets`, { method: 'POST', body, token }),
  deleteSet: (token: string, id: string, setId: string) =>
    request<{ session: WorkoutSession }>(`/workouts/sessions/${id}/sets/${setId}`, { method: 'DELETE', token }),
  sessionAction: (token: string, id: string, action: 'pause' | 'resume' | 'discard' | 'rest/skip') =>
    request<{ session: WorkoutSession }>(`/workouts/sessions/${id}/${action}`, { method: 'POST', token }),
  startRest: (token: string, id: string, seconds: number) =>
    request<{ session: WorkoutSession }>(`/workouts/sessions/${id}/rest`, { method: 'POST', body: { seconds }, token }),
  completeSession: (token: string, id: string, painLevel: PainLevel) =>
    request<CompletionResult>(`/workouts/sessions/${id}/complete`, { method: 'POST', body: { painLevel }, token }),
  workoutDetail: (token: string, id: string) => request<WorkoutSummaryDetail>(`/workouts/${id}`, { token }),
  exerciseDetail: (token: string, id: string) => request<ExerciseDetail>(`/exercises/${id}`, { token }),
  workouts: (token: string) => request<{ workouts: WorkoutSummary[] }>('/workouts?limit=10', { token }),
  logWorkout: (token: string, body: NewWorkout) => request<WorkoutResult>('/workouts', { method: 'POST', body, token }),

  nutritionDay: (token: string, date: string, today: string) => request<NutritionDay>(`/nutrition/days/${date}?today=${today}`, { token }),
  addFood: (token: string, log: NewFoodLog) => request<{ duplicate: boolean; log: FoodLog }>('/nutrition/logs', { method: 'POST', body: log, token }),
  addMeal: (token: string, meal: NewMeal) => request<{ duplicate: boolean; meal: LoggedMeal }>('/nutrition/meals', { method: 'POST', body: meal, token }),
  recipes: (token: string, f: { slot?: MealType; q?: string; saved?: boolean } = {}) => {
    const qs = new URLSearchParams({ ...(f.slot ? { slot: f.slot } : {}), ...(f.q ? { q: f.q } : {}), ...(f.saved ? { saved: 'true' } : {}) }).toString();
    return request<{ recipes: Recipe[] }>(`/recipes${qs ? `?${qs}` : ''}`, { token });
  },
  recipe: (token: string, id: string) => request<{ recipe: Recipe }>(`/recipes/${encodeURIComponent(id)}`, { token }),
  saveRecipe: (token: string, id: string, save: boolean) => request<void>(`/recipes/${encodeURIComponent(id)}/saved`, { method: save ? 'PUT' : 'DELETE', token }),
  currentPlan: (token: string) => request<{ plan: MealPlanView | null }>('/meal-plans/current', { token }),
  createPlan: (token: string, body: { clientPlanId: string; days: 1 | 7; startDate?: string }) => request<{ duplicate: boolean; plan: MealPlanView }>('/meal-plans', { method: 'POST', body, token }),
  deletePlan: (token: string, planId: string) => request<void>(`/meal-plans/${planId}`, { method: 'DELETE', token }),
  planAction: (token: string, a: PlanAction) => request<{ plan: MealPlanView }>(planActionPath(a), { method: planActionMethod(a), token, ...(planActionBody(a) ? { body: planActionBody(a) } : {}) }),
  alternatives: (token: string, planId: string, mealId: string) => request<{ alternatives: MealAlternative[] }>(`/meal-plans/${planId}/meals/${mealId}/alternatives`, { token }),
  grocery: (token: string) => request<{ list: GroceryListView }>('/grocery', { token }),
  // Coach answers can take a while (the server waits up to ~20 s for the AI before falling back).
  coachStatus: (token: string) => request<CoachStatus>('/coach/status', { token }),
  coachInsight: (token: string, topic: CoachTopic, today: string) => request<{ insight: CoachResponse }>(`/coach/insight?topic=${topic}&today=${today}`, { token, timeoutMs: COACH_TIMEOUT_MS }),
  coachMessages: (token: string) => request<{ messages: CoachTurn[]; retentionDays: number }>('/coach/messages', { token }),
  sendCoachMessage: (token: string, body: { message: string; clientMessageId: string; today: string }) =>
    request<{ duplicate: boolean; response: CoachResponse }>('/coach/messages', { token, method: 'POST', body, timeoutMs: COACH_TIMEOUT_MS }),
  clearCoachMessages: (token: string) => request<void>('/coach/messages', { token, method: 'DELETE' }),
  progressAnalytics: (token: string, range: AnalyticsRange, today: string, exercise?: string) =>
    request<{ analytics: ProgressAnalytics }>(`/analytics/progress?range=${range}&today=${today}${exercise ? `&exercise=${exercise}` : ''}`, { token }),
  achievements: (token: string) => request<{ achievements: Achievement[] }>('/achievements', { token }),
  streaks: (token: string) => request<{ today: string; timezone: string; streaks: Streaks }>('/streaks', { token }),
  bodyQuest: (token: string) => request<{ bodyQuest: BodyQuest; insights: BodyQuestInsights | null; insightsLocked: boolean }>('/body-quest', { token }),
  celebrations: (token: string) => request<{ celebrations: Celebration[] }>('/celebrations', { token }),
  markCelebrationsSeen: (token: string, ids: number[]) => request<{ marked: number }>('/celebrations/seen', { token, method: 'POST', body: { ids } }),
  xpEvents: (token: string, limit = 30) => request<{ events: XpLedgerEntry[] }>(`/xp/events?limit=${limit}`, { token }),
  groceryAction: (token: string, a: GroceryAction) => request<{ list: GroceryListView }>(groceryPath(a), { method: groceryMethod(a), token, ...(groceryBody(a) ? { body: groceryBody(a) } : {}) }),
  updateFood: (token: string, id: string, patch: FoodLogPatch) => request<{ log: FoodLog }>(`/nutrition/logs/${id}`, { method: 'PATCH', body: patch, token }),
  deleteFood: (token: string, id: string) => request<void>(`/nutrition/logs/${id}`, { method: 'DELETE', token }),
  createScan: (token: string, body: { clientScanId: string; image: { mimeType: 'image/jpeg'; data: string } }) =>
    request<{ scan: FoodScan }>('/nutrition/scans', { method: 'POST', body, token }),
  getScan: (token: string, id: string) => request<{ scan: FoodScan }>(`/nutrition/scans/${id}`, { token }),
  confirmScan: (token: string, id: string, body: ScanConfirmation) =>
    request<{ duplicate: boolean; scan: FoodScan }>(`/nutrition/scans/${id}/confirm`, { method: 'POST', body, token }),
  discardScan: (token: string, id: string) => request<void>(`/nutrition/scans/${id}`, { method: 'DELETE', token }),
  searchFoods: (token: string, q: string) => request<{ query: string; foods: FoodItem[] }>(`/foods/search?q=${encodeURIComponent(q)}`, { token }),
  recentFoods: (token: string) => request<{ recent: RecentFood[] }>('/foods/recent', { token }),
  myFoods: (token: string) => request<{ foods: FoodItem[] }>('/foods/mine', { token }),
  food: (token: string, id: string) => request<{ food: FoodItem }>(`/foods/${encodeURIComponent(id)}`, { token }),
  createFood: (token: string, body: NewUserFood) => request<{ food: FoodItem }>('/foods', { method: 'POST', body, token }),
  deleteUserFood: (token: string, id: string) => request<void>(`/foods/${encodeURIComponent(id)}`, { method: 'DELETE', token }),

  entitlements: (token: string) => request<Entitlements>('/entitlements', { token }),
  billingProducts: (token: string, platform: 'ios' | 'android' | 'web') => request<BillingCatalog>(`/billing/products?platform=${platform}`, { token }),
  verifyPurchase: (token: string, body: { platform: 'ios' | 'android' | 'web'; productId: string; receipt: string }) => request<Entitlements>('/billing/verify', { method: 'POST', body, token }),
  restorePurchases: (token: string, body: { platform: 'ios' | 'android' | 'web'; receipts: string[] }) =>
    request<{ restored: number; linkedElsewhere: number; entitlements: Entitlements }>('/billing/restore', { method: 'POST', body, token }),
  devCheckout: (token: string, body: { productId: string; storeAccount: string }) => request<{ receipt: string }>('/billing/dev/checkout', { method: 'POST', body, token }),
  devReceipts: (token: string, storeAccount: string) => request<{ receipts: string[] }>('/billing/dev/receipts', { method: 'POST', body: { storeAccount }, token }),
  devSimulate: (token: string, event: string) => request<{ entitlements: Entitlements }>('/billing/dev/simulate', { method: 'POST', body: { event }, token }),
  weeklyReports: (token: string) => request<{ canGenerate: boolean; reports: WeeklyReportEntry[] }>('/reports/weekly', { token, timeoutMs: 35_000 }),
  formIntelligence: (token: string, exerciseId: string, range: 30 | 90) =>
    request<{ exercise: { id: string; name: string; cameraVerifiable: boolean }; range: number; from: string; to: string; intelligence: FormIntelligence }>(`/exercises/${exerciseId}/form-intelligence?range=${range}`, { token }),
  restOfToday: (token: string) => request<{ suggestion: RestOfToday }>('/meal-plans/rest-of-today', { token }),
  providers: (token: string) => request<{ providers: ProviderStatus[] }>('/system/providers', { token }),
  features: (token: string) => request<{ features: FeatureMap }>('/system/features', { token }),
  adDecision: (token: string, placement: string) => request<AdDecision>(`/ads/decision?placement=${placement}`, { token }),
};
