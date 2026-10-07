import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef } from 'react';
import { api, type ApiError, type FoodLogPatch, type GroceryAction, type NewFoodLog, type NewMeal, type PlanAction, type NewSet, type NewUserFood, type NewWorkout, type ScanConfirmation } from './api';
import { useAuth } from './auth';
import { localDateKey, setUserTimeZone } from './dates';
import type { AnalyticsRange, Celebration, NotificationPreferences, CoachResponse, ProgressAnalytics, CoachTopic, CoachTurn, CompletionResult, HomeViewModel, MealType, Me, NutritionPreferences, PainLevel, ProfilePatch, UserSettings, WeightEntry, WorkoutSession, SessionSet } from './types';

/**
 * Server state for the whole app. Screens read through these hooks, share one cache, and
 * mutations invalidate exactly what they change — so logging food updates Home, Eat and
 * Progress together.
 */

export const qk = {
  me: ['me'] as const,
  progress: (today: string) => ['progress', today] as const,
  nutritionDay: (date: string) => ['nutrition', date] as const,
  workouts: ['workouts'] as const,
  records: ['records'] as const,
  exercises: ['exercises'] as const,
  entitlements: ['entitlements'] as const,
  providers: ['providers'] as const,
  features: ['features'] as const,
  ad: (placement: string) => ['ad', placement] as const,
  home: (today: string) => ['home', today] as const,
  todayWorkout: ['workout', 'today'] as const,
  activeSession: ['session', 'active'] as const,
  workoutDetail: (id: string) => ['workout', id] as const,
  exerciseDetail: (id: string) => ['exercise', id] as const,
  catalog: ['catalog'] as const,
  weight: ['weight'] as const,
  photo: ['photo'] as const,
  recipes: (filter: string) => ['recipes', filter] as const,
  recipe: (id: string) => ['recipe', id] as const,
  plan: ['meal-plan', 'current'] as const,
  alternatives: (mealId: string) => ['meal-plan', 'alternatives', mealId] as const,
  grocery: ['grocery'] as const,
  xpEvents: ['xp-events'] as const,
  achievements: ['achievements'] as const,
  streaks: ['streaks'] as const,
  bodyQuest: ['body-quest'] as const,
  celebrations: ['celebrations'] as const,
  coachStatus: ['coach', 'status'] as const,
  analytics: (range: AnalyticsRange, exercise: string | null) => ['analytics', range, exercise ?? ''] as const,
  coachInsight: (topic: CoachTopic) => ['coach', 'insight', topic] as const,
  coachMessages: ['coach', 'messages'] as const,
};

function useAuthedQuery<T>(key: QueryKey, fn: (token: string) => Promise<T>, opts: { staleTime?: number; enabled?: boolean; retry?: number } = {}) {
  const { authed, token } = useAuth();
  return useQuery<T, ApiError>({ queryKey: key, queryFn: () => authed(fn), staleTime: opts.staleTime, enabled: !!token && (opts.enabled ?? true), ...(opts.retry !== undefined ? { retry: opts.retry } : {}) });
}

/**
 * Refetch when a tab regains focus (skipping the first focus, which the initial fetch covers).
 * The callback is read through a ref so a new function identity each render never re-triggers it.
 */
export function useRefetchOnFocus(refetch: () => unknown) {
  const lastRun = useRef<number | null>(null);
  const latest = useRef(refetch);
  useEffect(() => {
    latest.current = refetch;
  });
  useFocusEffect(
    useCallback(() => {
      // Coming back to a screen refreshes it — at most once per FOCUS_REFRESH_MS, so flicking
      // between tabs doesn't refetch every query each time (our own changes invalidate exactly
      // what they touch; pull-to-refresh always reloads).
      const now = Date.now();
      const first = lastRun.current === null;
      if (!first && now - lastRun.current! < FOCUS_REFRESH_MS) return;
      lastRun.current = now;
      if (!first) latest.current();
    }, []),
  );
}

/** Matches the default staleTime: data younger than this is fresh enough on refocus. */
const FOCUS_REFRESH_MS = 30_000;

export const useMe = () =>
  useAuthedQuery(qk.me, async (t) => {
    const me = await api.me(t, localDateKey());
    setUserTimeZone(me.settings.timezone);
    return me;
  });
export const useProgress = (today = localDateKey()) => useAuthedQuery(qk.progress(today), (t) => api.progress(t, today));
export const useNutritionDay = (date: string, today = localDateKey()) => useAuthedQuery(qk.nutritionDay(date), (t) => api.nutritionDay(t, date, today));
export const useWorkouts = () => useAuthedQuery(qk.workouts, api.workouts);
export const useRecords = () => useAuthedQuery(qk.records, api.records);
export const useExercises = () => useAuthedQuery(qk.exercises, api.exercises, { staleTime: 60 * 60_000 });
export const useEntitlements = () => useAuthedQuery(qk.entitlements, api.entitlements);
export const useProviders = () => useAuthedQuery(qk.providers, api.providers, { staleTime: 5 * 60_000 });
export const useFeatures = () => useAuthedQuery(qk.features, api.features, { staleTime: 5 * 60_000 });
export const useAdDecision = (placement: string) => useAuthedQuery(qk.ad(placement), (t) => api.adDecision(t, placement));

// ---- Recipes, meal plans, grocery ----------------------------------------------------------

export const useRecipes = (f: { slot?: MealType; q?: string; saved?: boolean } = {}) =>
  useAuthedQuery(qk.recipes(JSON.stringify(f)), (t) => api.recipes(t, f), { staleTime: 5 * 60_000 });
export const useRecipe = (id: string) => useAuthedQuery(qk.recipe(id), (t) => api.recipe(t, id));
export const useCurrentPlan = () => useAuthedQuery(qk.plan, api.currentPlan);
export const useGrocery = () => useAuthedQuery(qk.grocery, api.grocery);
export const useXpEvents = () => useAuthedQuery(qk.xpEvents, (t) => api.xpEvents(t, 30));
export const useAchievements = () => useAuthedQuery(qk.achievements, api.achievements);
export const useStreaks = () => useAuthedQuery(qk.streaks, api.streaks);
export const useBodyQuest = () => useAuthedQuery(qk.bodyQuest, api.bodyQuest);
export const useCelebrations = () => useAuthedQuery(qk.celebrations, api.celebrations);

/** Progress analytics for a range; keeps the previous range on screen while the next one loads. */
export function useProgressAnalytics(range: AnalyticsRange, exercise: string | null) {
  const { authed, token } = useAuth();
  return useQuery<{ analytics: ProgressAnalytics }, ApiError>({
    queryKey: qk.analytics(range, exercise),
    queryFn: () => authed((t) => api.progressAnalytics(t, range, localDateKey(), exercise ?? undefined)),
    enabled: !!token,
    placeholderData: keepPreviousData,
    staleTime: 60_000,
  });
}

export const useNotificationPrefs = () => useAuthedQuery(['me', 'notifications'], api.notifications);
export function useUpdateNotifications() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<NotificationPreferences, ApiError, Partial<NotificationPreferences>>({
    mutationFn: (patch) => authed((t) => api.updateNotifications(t, patch)),
    onSuccess: (n) => qc.setQueryData(['me', 'notifications'], n),
  });
}
export const useProfileSummary = () => useAuthedQuery(['me', 'summary'], (t) => api.profileSummary(t, localDateKey()));
export const useDataSummary = () => useAuthedQuery(['me', 'data-summary'], api.dataSummary);
export const useLegal = () => useQuery({ queryKey: ['legal'], queryFn: api.legal, staleTime: 60 * 60_000 });

export const useCoachStatus = () => useAuthedQuery(qk.coachStatus, api.coachStatus, { staleTime: 5 * 60_000 });
/** A coaching insight. The server caches it per day and context, so refetching is cheap. */
export const useCoachInsight = (topic: CoachTopic, enabled = true) =>
  useAuthedQuery(qk.coachInsight(topic), (t) => api.coachInsight(t, topic, localDateKey()), { enabled, staleTime: 10 * 60_000, retry: 0 });
export const useCoachMessages = () => useAuthedQuery(qk.coachMessages, api.coachMessages);

/** Sends a chat message; the user's text shows immediately, the coach's answer when it arrives. */
export function useSendCoachMessage() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<{ duplicate: boolean; response: CoachResponse }, ApiError, { message: string; clientMessageId: string }>({
    mutationFn: (body) => authed((t) => api.sendCoachMessage(t, { ...body, today: localDateKey() })),
    onMutate: ({ message }) => {
      qc.setQueryData<{ messages: CoachTurn[]; retentionDays: number }>(qk.coachMessages, (d) =>
        d ? { ...d, messages: [...d.messages, { id: -Date.now(), role: 'user', text: message, response: null, at: new Date().toISOString() }] } : d,
      );
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.coachMessages }),
  });
}

export function useClearCoachMessages() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<void, ApiError, void>({
    mutationFn: () => authed((t) => api.clearCoachMessages(t)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['coach'] }),
  });
}

/** Marks celebrations seen (optimistically removed from the feed). */
export function useMarkCelebrationsSeen() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<{ marked: number }, ApiError, number[]>({
    mutationFn: (ids) => authed((t) => api.markCelebrationsSeen(t, ids)),
    onMutate: (ids) => {
      qc.setQueryData<{ celebrations: Celebration[] }>(qk.celebrations, (d) => (d ? { celebrations: d.celebrations.filter((c) => !ids.includes(c.id)) } : d));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.celebrations }),
  });
}
export const useAlternatives = (planId: string, mealId: string | null) =>
  useAuthedQuery(qk.alternatives(mealId ?? ''), (t) => api.alternatives(t, planId, mealId!), { enabled: !!mealId });

export function useSaveRecipe(id: string) {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, boolean>({
    mutationFn: (save) => authed((t) => api.saveRecipe(t, id, save)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.recipe(id) });
      qc.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

export function useCreatePlan() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof api.createPlan>>, ApiError, Parameters<typeof api.createPlan>[1]>({
    mutationFn: (body) => authed((t) => api.createPlan(t, body)),
    onSuccess: (res) => {
      qc.setQueryData(qk.plan, { plan: res.plan });
      qc.invalidateQueries({ queryKey: qk.grocery });
    },
  });
}

export function useDeletePlan() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (planId) => authed((t) => api.deletePlan(t, planId)),
    onSuccess: () => {
      qc.setQueryData(qk.plan, { plan: null });
      qc.invalidateQueries({ queryKey: qk.grocery });
    },
  });
}

/** Any change to the plan: the server returns the new plan; eating also moves the food log. */
export function usePlanAction() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof api.planAction>>, ApiError, PlanAction>({
    mutationFn: (a) => authed((t) => api.planAction(t, a)),
    onSuccess: (res, a) => {
      qc.setQueryData(qk.plan, { plan: res.plan });
      qc.invalidateQueries({ queryKey: qk.grocery });
      qc.invalidateQueries({ queryKey: ['meal-plan', 'alternatives'] });
      if (a.kind === 'eaten' || a.kind === 'uneaten') invalidateFood(qc);
    },
  });
}

export function useGroceryAction() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof api.groceryAction>>, ApiError, GroceryAction>({
    mutationFn: (a) => authed((t) => api.groceryAction(t, a)),
    onSuccess: (res) => qc.setQueryData(qk.grocery, { list: res.list }),
  });
}

export function useLogWorkout() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof api.logWorkout>>, ApiError, NewWorkout>({
    mutationFn: (body) => authed((t) => api.logWorkout(t, body)),
    onSuccess: () => {
      invalidateActivity(qc);
      qc.invalidateQueries({ queryKey: qk.workouts });
      qc.invalidateQueries({ queryKey: qk.records });
    },
  });
}

/** Everything a food-log change can move: every nutrition day (entries can change date), recents, Home, XP. */
function invalidateFood(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['nutrition'] });
  qc.invalidateQueries({ queryKey: ['foods', 'recent'] });
  invalidateActivity(qc);
}

/** Logs food. Keep the same clientLogId across retries: the server returns the original entry. */
export function useAddFood() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof api.addFood>>, ApiError, NewFoodLog>({
    mutationFn: (log) => authed((t) => api.addFood(t, log)),
    onSuccess: () => invalidateFood(qc),
  });
}

/** Logs several ingredients as one meal. Keep the same clientMealId across retries: it logs once. */
export function useAddMeal() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof api.addMeal>>, ApiError, NewMeal>({
    mutationFn: (meal) => authed((t) => api.addMeal(t, meal)),
    onSuccess: () => invalidateFood(qc),
  });
}

export function useUpdateFood(id: string) {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof api.updateFood>>, ApiError, FoodLogPatch>({
    mutationFn: (patch) => authed((t) => api.updateFood(t, id, patch)),
    onSuccess: () => invalidateFood(qc),
  });
}

export function useDeleteFood() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (id) => authed((t) => api.deleteFood(t, id)),
    onSuccess: () => invalidateFood(qc),
  });
}

/** Sends a photo for recognition. Retrying with the same clientScanId returns the same scan (no second recognition). */
export function useCreateScan() {
  const { authed } = useAuth();
  return useMutation<Awaited<ReturnType<typeof api.createScan>>, ApiError, Parameters<typeof api.createScan>[1]>({
    mutationFn: (body) => authed((t) => api.createScan(t, body)),
  });
}

/** Logs a reviewed scan. Keep the same confirmKey across retries: it can only ever log once. */
export function useConfirmScan(id: string) {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof api.confirmScan>>, ApiError, ScanConfirmation>({
    mutationFn: (body) => authed((t) => api.confirmScan(t, id, body)),
    onSuccess: () => invalidateFood(qc),
  });
}

export function useDiscardScan() {
  const { authed } = useAuth();
  return useMutation<unknown, ApiError, string>({ mutationFn: (id) => authed((t) => api.discardScan(t, id)) });
}

/** Food search; keeps the previous results on screen while the next query loads. */
export function useFoodSearch(q: string) {
  const { authed, token } = useAuth();
  const query = q.trim();
  return useQuery<Awaited<ReturnType<typeof api.searchFoods>>, ApiError>({
    queryKey: ['foods', 'search', query],
    queryFn: () => authed((t) => api.searchFoods(t, query)),
    enabled: !!token && query.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}

export const useRecentFoods = () => useAuthedQuery(['foods', 'recent'], api.recentFoods);
export const useMyFoods = () => useAuthedQuery(['foods', 'mine'], api.myFoods);
export const useFood = (id: string, enabled = true) => useAuthedQuery(['foods', 'item', id], (t) => api.food(t, id), { staleTime: 10 * 60_000, enabled: enabled && !!id });

export function useCreateUserFood() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof api.createFood>>, ApiError, NewUserFood>({
    mutationFn: (body) => authed((t) => api.createFood(t, body)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['foods'] }),
  });
}

export function useDeleteUserFood() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (id) => authed((t) => api.deleteUserFood(t, id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['foods'] }),
  });
}

export function usePatchProfile() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof api.patchProfile>>, ApiError, ProfilePatch>({
    mutationFn: (p) => authed((t) => api.patchProfile(t, { ...p, localDate: localDateKey() })),
    onSuccess: (res) => {
      qc.setQueryData(qk.me, (me: Me | undefined) => (me ? { ...me, profile: res.profile, targets: res.targets, onboarding: res.onboarding } : me));
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: ['nutrition'] });
      qc.invalidateQueries({ queryKey: ['progress'] });
      qc.invalidateQueries({ queryKey: qk.weight });
      qc.invalidateQueries({ queryKey: ['analytics'] });
      qc.invalidateQueries({ queryKey: ['home'] });
    },
  });
}

export function usePatchPreferences() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<Awaited<ReturnType<typeof api.patchPreferences>>, ApiError, Partial<NutritionPreferences>>({
    mutationFn: (p) => authed((t) => api.patchPreferences(t, p)),
    onSuccess: (res) => {
      qc.setQueryData(qk.me, (me: Me | undefined) => (me ? { ...me, preferences: res.preferences, onboarding: res.onboarding } : me));
      qc.invalidateQueries({ queryKey: qk.me });
    },
  });
}

/**
 * Home view model. Keyed by the device's local date so crossing midnight fetches a new day;
 * refreshed on focus, on foreground, and every few minutes while open.
 */
export function useHome() {
  const { authed, token } = useAuth();
  const today = localDateKey();
  return useQuery<HomeViewModel, ApiError>({
    queryKey: qk.home(today),
    queryFn: () => authed((t) => api.home(t, today)),
    enabled: !!token,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    placeholderData: (previous) => previous,
  });
}

/** Everything a logged action can change on Home and elsewhere. */
function invalidateActivity(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: qk.xpEvents });
  // Achievements, streaks, Body Quest and celebrations all derive from activity.
  for (const key of [qk.achievements, qk.streaks, qk.bodyQuest, qk.celebrations, qk.records]) qc.invalidateQueries({ queryKey: key });
  qc.invalidateQueries({ queryKey: ['coach', 'insight'] }); // the coach's facts changed
  qc.invalidateQueries({ queryKey: ['analytics'] });
  qc.invalidateQueries({ queryKey: ['me', 'summary'] });
  qc.invalidateQueries({ queryKey: ['home'] });
  qc.invalidateQueries({ queryKey: ['progress'] });
}

export function useAddWater() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, { ml: number; clientLogId: string }>({
    mutationFn: (body) => authed((t) => api.addWater(t, body)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nutrition'] }); // the Eat day shows water too
      invalidateActivity(qc);
    },
  });
}

export function useUndoWater() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (id) => authed((t) => api.deleteWater(t, id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['nutrition'] });
      invalidateActivity(qc);
    },
  });
}

// ---- Training ---------------------------------------------------------------------------

export const useTodayWorkout = () => useAuthedQuery(qk.todayWorkout, api.todayWorkout);
export const useWorkoutDetail = (id: string) => useAuthedQuery(qk.workoutDetail(id), (t) => api.workoutDetail(t, id), { staleTime: Infinity });
export const useExerciseDetail = (id: string) => useAuthedQuery(qk.exerciseDetail(id), (t) => api.exerciseDetail(t, id));

/** The open session, if any. Survives app restarts because it lives on the server. */
export function useActiveSession() {
  const { authed, token } = useAuth();
  return useQuery<WorkoutSession | null, ApiError>({
    queryKey: qk.activeSession,
    queryFn: () => authed(async (t) => (await api.activeSession(t)).session),
    enabled: !!token,
    staleTime: 0,
  });
}

/** Every session mutation returns the new session state, which replaces the cached copy. */
function useSessionMutation<V, R extends { session: WorkoutSession } = { session: WorkoutSession }>(fn: (token: string, v: V) => Promise<R>) {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<R, ApiError, V>({
    mutationFn: (v) => authed((t) => fn(t, v)),
    onSuccess: ({ session }) => {
      qc.setQueryData(qk.activeSession, session.status === 'active' || session.status === 'paused' ? session : null);
      qc.invalidateQueries({ queryKey: qk.todayWorkout });
    },
  });
}

export const useStartSession = () =>
  useSessionMutation<{ clientSessionId: string; source: 'plan' | 'empty' }>((t, v) => api.startSession(t, v.clientSessionId, v.source));
export const useLogSet = (sessionId: string) =>
  useSessionMutation<NewSet, { set: SessionSet; session: WorkoutSession }>((t, body) => api.logSet(t, sessionId, body));
export const useDeleteSet = (sessionId: string) => useSessionMutation<string>((t, setId) => api.deleteSet(t, sessionId, setId));
export const useSessionAction = (sessionId: string) =>
  useSessionMutation<'pause' | 'resume' | 'discard' | 'rest/skip'>((t, action) => api.sessionAction(t, sessionId, action));
export const useStartRest = (sessionId: string) => useSessionMutation<number>((t, seconds) => api.startRest(t, sessionId, seconds));

export function useCompleteSession(sessionId: string) {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<CompletionResult, ApiError, PainLevel>({
    mutationFn: (painLevel) => authed((t) => api.completeSession(t, sessionId, painLevel)),
    onSuccess: () => {
      qc.setQueryData(qk.activeSession, null);
      invalidateActivity(qc);
      for (const key of [qk.todayWorkout, qk.workouts, qk.records]) qc.invalidateQueries({ queryKey: key });
    },
  });
}

export const useCatalog = () => useAuthedQuery(qk.catalog, api.catalog, { staleTime: 24 * 60 * 60_000 });
export const useWeightHistory = () => useAuthedQuery(qk.weight, api.weightHistory);
export const usePhoto = (enabled: boolean) => {
  const { authed, token } = useAuth();
  return useQuery<Awaited<ReturnType<typeof api.photo>>, ApiError>({ queryKey: qk.photo, queryFn: () => authed(api.photo), enabled: !!token && enabled, staleTime: Infinity });
};

export function useLogWeight() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, WeightEntry>({
    mutationFn: (e) => authed((t) => api.logWeight(t, e)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.weight });
      qc.invalidateQueries({ queryKey: ['analytics'] });
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: ['nutrition'] });
      qc.invalidateQueries({ queryKey: ['home'] });
    },
  });
}

export function useDeleteWeight() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, string>({
    mutationFn: (date) => authed((t) => api.deleteWeight(t, date)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.weight });
      qc.invalidateQueries({ queryKey: ['analytics'] });
      qc.invalidateQueries({ queryKey: qk.me });
      qc.invalidateQueries({ queryKey: ['nutrition'] });
      qc.invalidateQueries({ queryKey: ['home'] });
    },
  });
}

export function useUploadPhoto() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, { mimeType: 'image/jpeg' | 'image/png'; data: string }>({
    mutationFn: (p) => authed((t) => api.uploadPhoto(t, p)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.photo });
      qc.setQueryData(qk.me, (me: Me | undefined) => (me ? { ...me, hasPhoto: true } : me));
    },
  });
}

export function useDeletePhoto() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, void>({
    mutationFn: () => authed((t) => api.deletePhoto(t)),
    onSuccess: () => {
      qc.removeQueries({ queryKey: qk.photo });
      qc.setQueryData(qk.me, (me: Me | undefined) => (me ? { ...me, hasPhoto: false } : me));
    },
  });
}

export function useCompleteOnboarding() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<unknown, ApiError, void>({
    mutationFn: () => authed((t) => api.completeOnboarding(t)),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.me }),
  });
}

export function useUpdateSettings() {
  const { authed } = useAuth();
  const qc = useQueryClient();
  return useMutation<UserSettings, ApiError, Partial<UserSettings>>({
    mutationFn: (patch) => authed((t) => api.updateSettings(t, patch)),
    onSuccess: (settings) => {
      setUserTimeZone(settings.timezone);
      qc.setQueryData(qk.me, (me: Awaited<ReturnType<typeof api.me>> | undefined) => (me ? { ...me, settings } : me));
      qc.invalidateQueries({ queryKey: ['ad'] });
      // Units and time zone change how (and for which day) Home is computed.
      qc.invalidateQueries({ queryKey: ['home'] });
      // Coach switches and consents change which coach answers (and whether chat history exists).
      qc.invalidateQueries({ queryKey: ['coach'] });
      qc.invalidateQueries({ queryKey: ['analytics'] });
    },
  });
}
