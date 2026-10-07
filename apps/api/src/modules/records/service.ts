import {
  detectSetRecords,
  EXERCISE_BY_ID,
  formatRecordValue,
  GLOBAL_RECORD,
  isRewardedRecord,
  judgeRecord,
  PR_METRICS,
  workoutStreak,
  type PrCandidate,
  type PrKind,
  type RecordBests,
  type SetForRecords,
} from "@form/domain";
import type { Db } from "../../db";
import { emitDomainEvent } from "../progression/service";

/**
 * PersonalRecord service. Records are detected inside the workout's transaction from the server's
 * own verified data, appended (never edited — the table refuses UPDATE/DELETE), and every record
 * that beats an earlier one emits a `personal_record.set` domain event. The PR bonus itself is part
 * of the workout's XP award in the progression ledger (see insertWorkout).
 */

export type RecordedPr = PrCandidate & { exerciseId: string };

/** Current best per kind for one exercise (or "*" for global records), awarded records only. */
export function loadBests(db: Db, userId: string, exerciseId: string): RecordBests {
  const rows = db
    .prepare("SELECT kind, MAX(value) AS hi, MIN(value) AS lo FROM personal_records WHERE user_id = ? AND exercise_id = ? AND status = 'awarded' GROUP BY kind")
    .all(userId, exerciseId) as { kind: PrKind; hi: number; lo: number }[];
  const bests: RecordBests = {};
  for (const r of rows) if (PR_METRICS[r.kind]) bests[r.kind] = PR_METRICS[r.kind].direction === "higher" ? r.hi : r.lo;
  return bests;
}

function insertRecord(db: Db, e: { userId: string; workoutId: string; localDate: string; exerciseId: string; pr: PrCandidate; at: Date }): RecordedPr {
  const id = db
    .prepare("INSERT INTO personal_records (user_id, exercise_id, kind, value, previous, status, workout_id, local_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(e.userId, e.exerciseId, e.pr.kind, e.pr.value, e.pr.previous, e.pr.status, e.workoutId, e.localDate, e.at.toISOString()).lastInsertRowid;
  if (e.pr.status === "awarded" && e.pr.previous !== null) {
    const name = e.exerciseId === GLOBAL_RECORD ? null : (EXERCISE_BY_ID.get(e.exerciseId)?.name ?? e.exerciseId);
    emitDomainEvent(db, e.userId, "personal_record.set", String(id), {
      recordId: Number(id),
      workoutId: e.workoutId,
      exerciseId: e.exerciseId,
      exerciseName: name,
      kind: e.pr.kind,
      label: PR_METRICS[e.pr.kind].label,
      value: e.pr.value,
      previous: e.pr.previous,
      display: formatRecordValue(e.pr.kind, e.pr.value),
      previousDisplay: formatRecordValue(e.pr.kind, e.pr.previous),
      rewarded: isRewardedRecord(e.pr),
      localDate: e.localDate,
    }, e.at);
  }
  return { ...e.pr, exerciseId: e.exerciseId };
}

/** Records one verified set sets (no records from a session with serious pain). */
export function recordSetPrs(db: Db, e: { userId: string; workoutId: string; localDate: string; exerciseId: string; set: SetForRecords; at: Date }): RecordedPr[] {
  return detectSetRecords(loadBests(db, e.userId, e.exerciseId), e.set).map((pr) => insertRecord(db, { ...e, pr }));
}

/** Records across the whole workout: most verified reps in one workout, and the longest training streak. */
export function recordWorkoutPrs(db: Db, e: { userId: string; workoutId: string; localDate: string; verifiedReps: number; at: Date }): RecordedPr[] {
  const bests = loadBests(db, e.userId, GLOBAL_RECORD);
  const out: RecordedPr[] = [];
  const reps = judgeRecord("workout_verified_reps", e.verifiedReps, bests.workout_verified_reps ?? null);
  if (reps) out.push(insertRecord(db, { ...e, exerciseId: GLOBAL_RECORD, pr: reps }));

  const workouts = db.prepare("SELECT local_date AS localDate, pain_level AS painLevel FROM workouts WHERE user_id = ? AND local_date <= ?").all(e.userId, e.localDate) as { localDate: string; painLevel: string }[];
  const plan = db.prepare("SELECT training_days_per_week AS n FROM profiles WHERE user_id = ?").get(e.userId) as { n: number | null } | undefined;
  const longest = workoutStreak({ workouts, trainingDaysPerWeek: plan?.n ?? null }, e.localDate).longest;
  const streak = judgeRecord("longest_streak", longest, bests.longest_streak ?? null);
  if (streak) out.push(insertRecord(db, { ...e, exerciseId: GLOBAL_RECORD, pr: streak }));
  return out;
}

export interface RecordView {
  exerciseId: string | null;
  exerciseName: string | null;
  kind: PrKind;
  label: string;
  unit: string;
  direction: "higher" | "lower";
  value: number;
  display: string;
  previous: number | null;
  localDate: string | null;
  /** Set within the last 7 days. */
  recent: boolean;
}

/** The current best for every (exercise, metric), in the metric's direction. */
export function listRecords(db: Db, userId: string, today: string): RecordView[] {
  const rows = db
    .prepare("SELECT id, exercise_id AS exerciseId, kind, value, previous, local_date AS localDate FROM personal_records WHERE user_id = ? AND status = 'awarded' ORDER BY id")
    .all(userId) as { id: number; exerciseId: string; kind: PrKind; value: number; previous: number | null; localDate: string | null }[];
  const best = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const m = PR_METRICS[r.kind];
    if (!m) continue;
    const key = `${r.exerciseId}|${r.kind}`;
    const cur = best.get(key);
    if (!cur || (m.direction === "higher" ? r.value > cur.value : r.value < cur.value)) best.set(key, r);
  }
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10);
  return [...best.values()]
    .map((r) => {
      const m = PR_METRICS[r.kind];
      const global = r.exerciseId === GLOBAL_RECORD;
      return {
        exerciseId: global ? null : r.exerciseId,
        exerciseName: global ? null : (EXERCISE_BY_ID.get(r.exerciseId)?.name ?? r.exerciseId),
        kind: r.kind,
        label: m.label,
        unit: m.unit,
        direction: m.direction,
        value: r.value,
        display: formatRecordValue(r.kind, r.value),
        previous: r.previous,
        localDate: r.localDate,
        recent: r.localDate !== null && r.localDate >= weekAgo && r.localDate <= today,
      };
    })
    .sort((a, b) => (a.exerciseName ?? "").localeCompare(b.exerciseName ?? "") || a.label.localeCompare(b.label));
}
