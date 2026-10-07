import { createHash } from "node:crypto";
import {  addDays,
  buildCoachContext,
  COACH_PROVIDER_TYPES,
  deterministicCoach,
  EXERCISE_BY_ID,
  formatRecordValue,
  issueMessage,
  validateCoachOutput,
  type CoachContext,
  type CoachContextInput,
  type CoachDegradation,
  type CoachProviderType,
  type CoachResponse,
  type CoachTopic,
  type FormIssueCode,
  type ProviderFailureCode, bodyQuestInsights } from "@form/domain";
import type { Db } from "../../db";
import { HttpError } from "../../http/errors";
import type { AppContext } from "../../shared/context";
import { errorKind } from "../../shared/observability";
import { can, proRequired } from "../billing/entitlements";
import { coachChatsToday } from "../billing/service";
import { reserveProviderCall } from "../../shared/providerBudget";
import { leaksInstructions } from "../../providers/aiCoach";
import type { UserClock } from "../../shared/userClock";
import { coachNutritionContext } from "../nutrition/service";
import { computeUserProgress } from "../progression/service";
import { analyticsForCoach, progressAnalytics } from "../analytics/service";
import { syncQuests } from "../quests/service";
import { listRecords } from "../records/service";
import { bodyQuestView, computeStreaks, syncAchievements, syncDerived } from "../recognition/service";
import { loadSettings } from "../users/repo";
import { userState } from "../users/service";

/**
 * AI Coach service.
 *
 * Provider selection: REAL_AI_PROVIDER when configured and ready; otherwise DETERMINISTIC_FALLBACK
 * (rules over the same facts, labelled as such); UNAVAILABLE when the coach is switched off.
 * Every answer — AI or rules — goes through the domain validator; an AI answer that fails it, times
 * out, is rate limited or errors is replaced by the rules answer, marked with why.
 *
 * Cost control: an insight is cached per topic, day and context fingerprint; real AI calls are
 * capped per user per day; chat is capped per hour. Privacy: only the minimal CoachContext leaves
 * the server; chat history is kept 30 days and can be cleared; usage records hold no content.
 */

export const COACH_RETENTION_DAYS = 30;
const INSIGHT_RETENTION_DAYS = 7;
const CHAT_HISTORY_TURNS = 6;
export const CHAT_MAX_CHARS = 1000;

export interface CoachMode {
  type: CoachProviderType;
  provider: string;
  /**
   * Why the real AI isn't answering: not configured, rules-only server, the user hasn't agreed to
   * share their data with the AI provider, or the user switched the coach off. Null when the AI
   * answers or the server has no coach at all.
   */
  reason: "unconfigured" | "rules_only" | "consent_required" | "disabled_by_user" | null;
  /** The AI could answer if the user agreed (so the app can offer the choice). */
  aiAvailable: boolean;
}

/** Which coach answers for this user — server configuration first, then the user's own choices. */
export function coachMode(ctx: AppContext, userId?: string): CoachMode {
  const c = ctx.config.coach;
  const aiReady = c.provider === "anthropic" && ctx.providers.ai.status().state === "ready";
  if (c.provider === "none") return { type: COACH_PROVIDER_TYPES.UNAVAILABLE, provider: "none", reason: null, aiAvailable: false };
  const settings = userId ? loadSettings(ctx.db, userId) : null;
  if (settings && !settings.aiCoachEnabled) return { type: COACH_PROVIDER_TYPES.UNAVAILABLE, provider: "none", reason: "disabled_by_user", aiAvailable: aiReady };
  if (c.provider === "anthropic") {
    if (!aiReady) return { type: COACH_PROVIDER_TYPES.DETERMINISTIC_FALLBACK, provider: "FORM rules", reason: "unconfigured", aiAvailable: false };
    // Nothing goes to the AI provider until the user agrees.
    if (settings && !settings.aiCoachConsent) return { type: COACH_PROVIDER_TYPES.DETERMINISTIC_FALLBACK, provider: "FORM rules", reason: "consent_required", aiAvailable: true };
    return { type: COACH_PROVIDER_TYPES.REAL_AI_PROVIDER, provider: ctx.providers.ai.status().provider, reason: null, aiAvailable: true };
  }
  return { type: COACH_PROVIDER_TYPES.DETERMINISTIC_FALLBACK, provider: "FORM rules", reason: "rules_only", aiAvailable: false };
}

function assertCoachOn(ctx: AppContext, userId: string): CoachMode {
  const mode = coachMode(ctx, userId);
  if (mode.reason === "disabled_by_user") throw new HttpError(403, "coach_disabled", "You've switched the coach off. Turn it on in Settings to use it.");
  if (mode.type === COACH_PROVIDER_TYPES.UNAVAILABLE) throw new HttpError(503, "coach_unavailable", "The coach is switched off");
  return mode;
}

// ---- Context -------------------------------------------------------------------------------------

function localTime(timezone: string, now: Date): { localTime: string; weekday: string } {
  const tz = timezone || "UTC";
  return {
    localTime: new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now),
    weekday: new Intl.DateTimeFormat("en-GB", { timeZone: tz, weekday: "long" }).format(now),
  };
}

function trainingInput(db: Db, userId: string, today: string): Pick<CoachContextInput, "workouts" | "formIssues"> {
  const from = addDays(today, -27);
  const rows = db
    .prepare(
      `SELECT w.id, w.local_date AS localDate, w.duration_minutes AS durationMinutes, w.pain_level AS painLevel,
              (SELECT COALESCE(SUM(e.xp), 0) FROM xp_events e WHERE e.user_id = w.user_id AND e.source = 'workout' AND e.source_key = w.id) AS xp,
              s.id AS setId, s.exercise_id AS exerciseId, s.reps, s.verified_reps AS verifiedReps, s.load_kg AS loadKg
       FROM workouts w LEFT JOIN workout_sets s ON s.workout_id = w.id
       WHERE w.user_id = ? AND w.local_date BETWEEN ? AND ? ORDER BY w.local_date DESC, w.created_at DESC, s.id`,
    )
    .all(userId, from, today) as { id: string; localDate: string; durationMinutes: number; painLevel: "none" | "mild" | "serious"; xp: number; setId: number | null; exerciseId: string | null; reps: number; verifiedReps: number; loadKg: number }[];
  const reps = db
    .prepare(
      `SELECT s.workout_id AS workoutId, s.exercise_id AS exerciseId, r.form_score AS formScore, r.rom_percent AS romPercent, r.issues
       FROM verified_reps r JOIN workout_sets s ON s.id = r.set_id JOIN workouts w ON w.id = s.workout_id
       WHERE w.user_id = ? AND w.local_date BETWEEN ? AND ? AND w.pain_level <> 'serious'`,
    )
    .all(userId, from, today) as { workoutId: string; exerciseId: string; formScore: number | null; romPercent: number; issues: string }[];
  const nameOf = (id: string) => EXERCISE_BY_ID.get(id)?.name ?? id;

  const workouts = new Map<string, CoachContextInput["workouts"][number]>();
  for (const r of rows) {
    const w = workouts.get(r.id) ?? { localDate: r.localDate, durationMinutes: r.durationMinutes, painLevel: r.painLevel, xp: r.xp, exercises: [] };
    workouts.set(r.id, w);
    if (!r.exerciseId) continue;
    let e = w.exercises.find((x) => x.exerciseId === r.exerciseId);
    if (!e) {
      e = { exerciseId: r.exerciseId, name: nameOf(r.exerciseId), sets: 0, reps: 0, verifiedReps: 0, topLoadKg: 0, avgFormScore: null, avgRomPercent: null };
      w.exercises.push(e);
    }
    e.sets++;
    e.reps += r.reps;
    e.verifiedReps += r.verifiedReps;
    e.topLoadKg = Math.max(e.topLoadKg, r.loadKg);
  }
  for (const [id, w] of workouts) {
    for (const e of w.exercises) {
      const mine = reps.filter((r) => r.workoutId === id && r.exerciseId === e.exerciseId);
      const scored = mine.filter((r) => r.formScore !== null);
      if (scored.length) e.avgFormScore = Math.round(scored.reduce((a, r) => a + r.formScore!, 0) / scored.length);
      if (mine.length) e.avgRomPercent = Math.round(mine.reduce((a, r) => a + Math.min(100, r.romPercent), 0) / mine.length);
    }
  }
  const counts = new Map<string, { exerciseId: string; code: string; count: number }>();
  for (const r of reps) {
    for (const code of JSON.parse(r.issues) as string[]) {
      const k = `${r.exerciseId}:${code}`;
      counts.set(k, { exerciseId: r.exerciseId, code, count: (counts.get(k)?.count ?? 0) + 1 });
    }
  }
  const formIssues = [...counts.values()].map((c) => ({ ...c, name: nameOf(c.exerciseId), cue: issueMessage(c.exerciseId, c.code as FormIssueCode) }));
  return { workouts: [...workouts.values()], formIssues };
}

/** Brings recognition up to date, then gathers the minimal, authorized context for the coach. */
export function loadCoachContext(ctx: AppContext, userId: string, clock: UserClock): CoachContext {
  const { db } = ctx;
  const now = ctx.now();
  const today = clock.today;
  const quests = syncQuests(ctx, userId, clock);
  syncDerived(db, userId, today, now);
  const state = userState(db, userId, today);
  const progress = computeUserProgress(db, userId, today, now);
  const bq = bodyQuestView(db, userId, today, now);
  const achievements = syncAchievements(db, userId, today, now);
  const streaks = computeStreaks(db, userId, today);
  const monthAgo = addDays(today, -29);
  const unlocked = achievements.filter((a) => a.state === "unlocked").sort((a, b) => (b.unlockedAt ?? "").localeCompare(a.unlockedAt ?? ""));
  const next = achievements.filter((a) => a.state !== "unlocked").sort((a, b) => b.progress / b.target - a.progress / a.target)[0];
  const nextRank = progress.rankLadder.find((r) => r.minLevel > progress.level) ?? null;

  return buildCoachContext({
    now: { localDate: today, ...localTime(clock.timezone, now) },
    personalization: state.personalization,
    hasTargets: state.targets !== null,
    ...trainingInput(db, userId, today),
    progression: {
      level: progress.level,
      rank: progress.rank,
      totalXp: progress.totalXp,
      xpToNextLevel: Math.max(0, progress.xpForNextLevel - progress.xpIntoLevel),
      nextRank: nextRank ? { name: nextRank.name, minLevel: nextRank.minLevel } : null,
      trainWithinDays: progress.consistency.trainWithinDays,
      recovering: progress.consistency.recovering,
    },
    nutrition: coachNutritionContext(ctx, userId, today),
    bodyQuest: { stage: bq.stage, overall: bq.overall, stats: Object.fromEntries(Object.entries(bq.stats).map(([k, v]) => [k, v.value])), nextStage: bq.next?.stage ?? null, unmet: (bq.next?.requirements ?? []).filter((r) => !r.met) },
    records: listRecords(db, userId, today)
      .filter((r) => r.previous !== null && r.localDate !== null && r.localDate >= monthAgo && r.kind !== "longest_streak")
      .sort((a, b) => (b.localDate ?? "").localeCompare(a.localDate ?? ""))
      .map((r) => ({ exercise: r.exerciseName ?? "All training", label: r.label, display: r.display, previousDisplay: formatRecordValue(r.kind, r.previous!), localDate: r.localDate! })),
    achievements: { unlocked: unlocked.map((a) => a.title), next: next ? { title: next.title, progress: next.progress, target: next.target } : null },
    streaks: {
      workout: { current: streaks.workout.current, longest: streaks.workout.longest, plannedRestDays: streaks.workout.plannedRestDays },
      weekly: { current: streaks.weekly.current, target: streaks.weekly.target, metThisWeek: streaks.weekly.metThisWeek },
      nutrition: { current: streaks.nutrition.current, available: streaks.nutrition.available },
      quest: { current: streaks.quest.current },
    },
    quests: [...quests.daily, ...quests.weekly].map((q) => ({ title: q.title, cadence: q.cadence, progress: q.progress, target: q.target, completed: q.completed })),
    // Already settled above, so no second sync.
    analytics: analyticsForCoach(progressAnalytics(ctx, userId, clock, { range: 30 }, { sync: false })),
    // FORM Pro: the longer view and the stat that most needs work.
    ...(can(ctx, userId, "PERSONALIZED_RECOMMENDATIONS")
      ? (() => {
          const focus = bodyQuestInsights(bq, bq.snapshots).focus;
          return { analyticsLong: analyticsForCoach(progressAnalytics(ctx, userId, clock, { range: 90 }, { sync: false })), bodyQuestFocus: focus ? { stat: focus.stat, value: focus.value } : null };
        })()
      : {}),
  });
}

/** Fingerprint of what the coach would see (minus the clock minute), for the insight cache. */
export function contextHash(c: CoachContext, topic: CoachTopic): string {
  const facts = Object.fromEntries(Object.entries(c.facts).filter(([k]) => k !== "now.localTime").sort(([a], [b]) => a.localeCompare(b)));
  return createHash("sha256").update(JSON.stringify({ topic, facts, food: c.food, equipment: c.equipment, safety: c.safety })).digest("hex").slice(0, 32);
}

// ---- Running the coach ---------------------------------------------------------------------------

const DEGRADE: Record<ProviderFailureCode, CoachDegradation> = {
  unconfigured: "unconfigured",
  network: "timeout",
  rate_limited: "rate_limited",
  unavailable: "provider_error",
  permission_denied: "provider_error",
  invalid_input: "provider_error",
};

function rulesAnswer(c: CoachContext, topic: CoachTopic, message: string | null, now: Date, degraded: CoachDegradation | null): CoachResponse {
  const r = validateCoachOutput(deterministicCoach(c, topic, message), c, { topic, generatedAt: now.toISOString(), provider: { type: COACH_PROVIDER_TYPES.DETERMINISTIC_FALLBACK, name: "FORM rules" }, degraded });
  // The rules are tested to always validate; if a future change breaks that, fail loudly rather than show unchecked text.
  if (!r.ok) throw new Error(`deterministic coach produced an invalid answer: ${r.reasons.join(", ")}`);
  return r.response;
}

function aiCallsToday(db: Db, userId: string, today: string): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM coach_calls WHERE user_id = ? AND local_date = ? AND provider_type = 'real_ai'").get(userId, today) as { n: number }).n;
}

function recordCall(db: Db, userId: string, today: string, kind: "insight" | "chat", type: CoachProviderType, outcome: string, now: Date) {
  db.prepare("INSERT INTO coach_calls (user_id, local_date, kind, provider_type, outcome, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(userId, today, kind, type, outcome, now.toISOString());
}

/** One coaching answer: real AI when allowed and valid, otherwise the rules — always validated. */
async function answer(ctx: AppContext, userId: string, c: CoachContext, topic: CoachTopic, message: string | null, history: { role: "user" | "coach"; text: string }[], kind: "insight" | "chat"): Promise<CoachResponse> {
  const mode = coachMode(ctx, userId);
  const now = ctx.now();
  const today = String(c.facts["now.localDate"]);
  if (mode.type !== COACH_PROVIDER_TYPES.REAL_AI_PROVIDER) {
    recordCall(ctx.db, userId, today, kind, mode.type, mode.reason ?? "rules", now);
    return rulesAnswer(c, topic, message, now, mode.reason === "unconfigured" ? "unconfigured" : mode.reason === "consent_required" ? "no_consent" : null);
  }
  // Pro: the configured daily AI budget. Free: a smaller allowance, then labelled rule-based tips.
  const dailyCap = can(ctx, userId, "AI_COACH_ADVANCED") ? ctx.config.coach.dailyAiCalls : Math.min(ctx.config.coach.dailyAiCalls, ctx.config.freeLimits.aiCallsPerDay);
  if (aiCallsToday(ctx.db, userId, today) >= dailyCap) {
    recordCall(ctx.db, userId, today, kind, COACH_PROVIDER_TYPES.DETERMINISTIC_FALLBACK, "daily_limit", now);
    return rulesAnswer(c, topic, message, now, "daily_limit");
  }
  // Service-wide ceiling: many accounts together can't run up the bill either.
  if (!reserveProviderCall(ctx.db, "ai_coach", now, ctx.config.coach.globalDailyAiCalls)) {
    ctx.log.warn({ provider: "ai_coach", limit: ctx.config.coach.globalDailyAiCalls }, "global daily AI budget reached");
    recordCall(ctx.db, userId, today, kind, COACH_PROVIDER_TYPES.DETERMINISTIC_FALLBACK, "global_limit", now);
    return rulesAnswer(c, topic, message, now, "rate_limited");
  }
  // The provider gets an abort signal; a provider that ignores it (or throws) still can't hang or break the request.
  const budget = ctx.config.coach.timeoutMs + 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    ctx.providers.ai.respond({ context: c, topic, message, history }, { signal: AbortSignal.timeout(budget) }).catch((err: unknown) => {
      ctx.log.warn({ provider: "ai_coach", ...errorKind(err) }, "coach provider error");
      return { ok: false as const, code: "unavailable" as const, message: "The coach failed", retryable: true };
    }),
    new Promise<{ ok: false; code: "network"; message: string; retryable: true }>((resolve) => {
      timer = setTimeout(() => resolve({ ok: false, code: "network", message: "The coach took too long", retryable: true }), budget + 250);
    }),
  ]).finally(() => clearTimeout(timer));
  if (!result.ok) {
    recordCall(ctx.db, userId, today, kind, COACH_PROVIDER_TYPES.REAL_AI_PROVIDER, `failed:${result.code}`, now);
    return rulesAnswer(c, topic, message, now, DEGRADE[result.code]);
  }
  const v = validateCoachOutput(result.value, c, { topic, generatedAt: now.toISOString(), provider: { type: COACH_PROVIDER_TYPES.REAL_AI_PROVIDER, name: mode.provider } });
  // An answer that repeats FORM's own instructions (a prompt-injection "print your rules") is never shown.
  if (v.ok && leaksInstructions(v.response.message)) {
    ctx.log.warn({ provider: "ai_coach", reasons: ["instruction_leak"] }, "coach answer rejected by validation");
    recordCall(ctx.db, userId, today, kind, COACH_PROVIDER_TYPES.REAL_AI_PROVIDER, "invalid_output", now);
    return rulesAnswer(c, topic, message, now, "invalid_output");
  }
  if (!v.ok) {
    // Never shown: log the reasons (no content) so prompt problems are visible in operations.
    ctx.log.warn({ provider: "ai_coach", reasons: v.reasons.map((r) => r.split(":")[0]) }, "coach answer rejected by validation");
    recordCall(ctx.db, userId, today, kind, COACH_PROVIDER_TYPES.REAL_AI_PROVIDER, "invalid_output", now);
    return rulesAnswer(c, topic, message, now, "invalid_output");
  }
  recordCall(ctx.db, userId, today, kind, COACH_PROVIDER_TYPES.REAL_AI_PROVIDER, "ok", now);
  return v.response;
}

function purgeOld(db: Db, userId: string, now: Date) {
  const chatCutoff = new Date(now.getTime() - COACH_RETENTION_DAYS * 86_400_000).toISOString();
  db.prepare("DELETE FROM coach_messages WHERE user_id = ? AND created_at < ?").run(userId, chatCutoff);
  db.prepare("DELETE FROM coach_calls WHERE user_id = ? AND created_at < ?").run(userId, chatCutoff);
  db.prepare("DELETE FROM coach_insights WHERE user_id = ? AND created_at < ?").run(userId, new Date(now.getTime() - INSIGHT_RETENTION_DAYS * 86_400_000).toISOString());
}

/** A coaching insight for a topic, cached per day and context: an unchanged day costs one call at most. */
export async function coachInsight(ctx: AppContext, userId: string, clock: UserClock, topic: Exclude<CoachTopic, "chat">): Promise<CoachResponse> {
  assertCoachOn(ctx, userId);
  const c = loadCoachContext(ctx, userId, clock);
  const hash = contextHash(c, topic);
  const cached = ctx.db.prepare("SELECT response FROM coach_insights WHERE user_id = ? AND topic = ? AND local_date = ? AND context_hash = ?").get(userId, topic, clock.today, hash) as { response: string } | undefined;
  if (cached) return JSON.parse(cached.response) as CoachResponse;
  // Home and another screen asking for the same insight at once cost one provider call.
  return ctx.flights.run(`coach-insight:${userId}:${topic}:${clock.today}:${hash}`, () => freshInsight(ctx, userId, clock, topic, c, hash));
}

async function freshInsight(ctx: AppContext, userId: string, clock: UserClock, topic: Exclude<CoachTopic, "chat">, c: CoachContext, hash: string): Promise<CoachResponse> {
  const response = await answer(ctx, userId, c, topic, null, [], "insight");
  // Only cache real answers and deliberate rules answers; a transient failure should be retried later.
  if (response.degraded === null || response.degraded === "unconfigured" || response.degraded === "no_consent" || response.degraded === "daily_limit") {
    ctx.db.prepare("INSERT OR REPLACE INTO coach_insights (user_id, topic, local_date, context_hash, response, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(userId, topic, clock.today, hash, JSON.stringify(response), ctx.now().toISOString());
  }
  purgeOld(ctx.db, userId, ctx.now());
  return response;
}

export interface ChatTurn {
  id: number;
  role: "user" | "coach";
  text: string;
  response: CoachResponse | null;
  at: string;
}

export function chatHistory(db: Db, userId: string, now: Date, limit = 50): ChatTurn[] {
  purgeOld(db, userId, now);
  const rows = db.prepare("SELECT id, role, text, response, created_at AS at FROM coach_messages WHERE user_id = ? ORDER BY id DESC LIMIT ?").all(userId, limit) as { id: number; role: "user" | "coach"; text: string; response: string | null; at: string }[];
  return rows.reverse().map((r) => ({ ...r, response: r.response ? (JSON.parse(r.response) as CoachResponse) : null }));
}

export function clearChat(db: Db, userId: string): void {
  db.prepare("DELETE FROM coach_messages WHERE user_id = ?").run(userId);
  db.prepare("DELETE FROM coach_insights WHERE user_id = ?").run(userId);
}

/** One chat turn. Idempotent per client message id; rate limited per hour. */
export async function coachChat(ctx: AppContext, userId: string, clock: UserClock, body: { message: string; clientMessageId: string }): Promise<{ duplicate: boolean; response: CoachResponse }> {
  assertCoachOn(ctx, userId);
  // A retry while the first attempt is still waiting on the provider shares its answer (one call, one reply).
  return ctx.flights.run(`coach-chat:${userId}:${body.clientMessageId}`, () => chatTurn(ctx, userId, clock, body));
}

async function chatTurn(ctx: AppContext, userId: string, clock: UserClock, body: { message: string; clientMessageId: string }): Promise<{ duplicate: boolean; response: CoachResponse }> {
  const { db } = ctx;
  const keep = loadSettings(db, userId).coachKeepHistory;
  const existing = db.prepare("SELECT response FROM coach_messages WHERE user_id = ? AND client_message_id = ? AND role = 'coach'").get(userId, body.clientMessageId) as { response: string } | undefined;
  if (existing) return { duplicate: true, response: JSON.parse(existing.response) as CoachResponse };
  if (!can(ctx, userId, "AI_COACH_ADVANCED") && coachChatsToday(db, userId, clock.today) >= ctx.config.freeLimits.coachChatPerDay) {
    throw proRequired("AI_COACH_ADVANCED", `You've used today's ${ctx.config.freeLimits.coachChatPerDay} coach messages. Your daily tips keep coming — or chat as much as you like with FORM Pro.`);
  }

  const now = ctx.now();
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const recent = (db.prepare("SELECT COUNT(*) AS n FROM coach_calls WHERE user_id = ? AND kind = 'chat' AND created_at >= ?").get(userId, hourAgo) as { n: number }).n;
  if (recent >= ctx.config.coach.chatPerHour) throw new HttpError(429, "coach_rate_limited", "You've sent a lot of messages — the coach will be ready again shortly.");

  // With history off, nothing earlier is kept, so nothing earlier is sent.
  const history = keep ? chatHistory(db, userId, now, CHAT_HISTORY_TURNS * 2).map((t) => ({ role: t.role, text: t.role === "coach" ? (t.response?.message ?? t.text) : t.text })) : [];
  const c = loadCoachContext(ctx, userId, clock);
  const response = await answer(ctx, userId, c, "chat", body.message, history, "chat");
  if (keep) {
    const insert = db.prepare("INSERT OR IGNORE INTO coach_messages (user_id, client_message_id, role, text, response, created_at) VALUES (?, ?, ?, ?, ?, ?)");
    insert.run(userId, body.clientMessageId, "user", body.message, null, now.toISOString());
    insert.run(userId, body.clientMessageId, "coach", response.message, JSON.stringify(response), now.toISOString());
  }
  return { duplicate: false, response };
}
