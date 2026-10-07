import { isRewardedRecord, setVerifiedEvent, workoutXp, type EvaluatedSet, type PainLevel, type XpAward } from "@form/domain";
import type { Db } from "../../db";
import { domainEventWritten } from "../../shared/observability";
import { awardWorkoutXp, emitDomainEvent } from "../progression/service";
import { recordSetPrs, recordWorkoutPrs, type RecordedPr } from "../records/service";

export function findByClientId(db: Db, userId: string, clientWorkoutId: string) {
  return db
    .prepare(
      `SELECT w.id, w.xp_flags AS flags, (SELECT COALESCE(SUM(e.xp), 0) FROM xp_events e WHERE e.user_id = w.user_id AND e.source = 'workout' AND e.source_key = w.id) AS xp FROM workouts w
       WHERE w.user_id = ? AND w.client_workout_id = ?`,
    )
    .get(userId, clientWorkoutId) as { id: string; flags: string; xp: number } | undefined;
}

export function minutesTrainedOn(db: Db, userId: string, localDate: string): number {
  return (db.prepare("SELECT COALESCE(SUM(duration_minutes), 0) AS m FROM workouts WHERE user_id = ? AND local_date = ?").get(userId, localDate) as { m: number }).m;
}

/**
 * Persists a completed workout with its sets, verified reps and PRs, records the validated
 * workout.completed domain event, and runs the XP engine on it (PR bonuses included) — one ledger
 * award keyed by the workout. Must run inside a transaction.
 */
export function insertWorkout(
  db: Db,
  w: {
    id: string;
    userId: string;
    clientWorkoutId: string;
    localDate: string;
    durationMinutes: number;
    painLevel: PainLevel;
    sets: (EvaluatedSet & { targetReps?: number | null })[];
    /** Training already done today (for the daily cap). */
    priorTrainingMinutesToday: number;
    now: Date;
  },
): { prs: RecordedPr[]; award: XpAward } {
  const at = w.now.toISOString();
  db.prepare(
    `INSERT INTO workouts (id, user_id, client_workout_id, local_date, duration_minutes, pain_level, xp_flags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(w.id, w.userId, w.clientWorkoutId, w.localDate, w.durationMinutes, w.painLevel, "[]", at);

  const insertSet = db.prepare(
    `INSERT INTO workout_sets (workout_id, set_index, exercise_id, reps, verified_reps, verification_status, rom_percent, load_kg, target_reps, form_score, analysis)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertRep = db.prepare(
    `INSERT INTO verified_reps (set_id, rep_index, duration_ms, min_angle_deg, rom_percent, start_ms, end_ms, peak_angle_deg, form_score, issues)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  // Exercise domain events for every camera-analyzed set, in the same transaction as the workout.
  // Idempotent on (user, type, key); consumed by later progression stages.
  const insertEvent = db.prepare("INSERT OR IGNORE INTO domain_events (user_id, type, key, payload, created_at) VALUES (?, ?, ?, ?, ?)");

  const prs: RecordedPr[] = [];
  for (const s of w.sets) {
    const setId = insertSet.run(w.id, s.setIndex, s.exerciseId, s.reps, s.verifiedReps, s.verificationStatus, s.romPercent, s.loadKg, s.targetReps ?? null, s.formScore, s.analysis ? JSON.stringify(s.analysis) : null).lastInsertRowid;
    for (const r of s.verifiedRepDetails) {
      insertRep.run(setId, r.index, r.durationMs, r.minAngleDeg, r.romPercent, r.startMs ?? null, r.endMs ?? null, r.peakAngleDeg ?? null, r.formScore ?? null, JSON.stringify(r.issues ?? []));
    }
    if (s.analysis) {
      const event = setVerifiedEvent({
        workoutId: w.id,
        exerciseId: s.exerciseId,
        setIndex: s.setIndex,
        recordedReps: s.reps,
        analysis: { ...s.analysis, reps: s.verifiedRepDetails },
        occurredAt: w.now,
      });
      if (insertEvent.run(w.userId, event.type, event.key, JSON.stringify(event), at).changes > 0) domainEventWritten(db, { userId: w.userId, type: event.type, key: event.key });
    }
    // No PRs from a session flagged for serious pain.
    if (w.painLevel === "serious") continue;
    prs.push(...recordSetPrs(db, { userId: w.userId, workoutId: w.id, localDate: w.localDate, exerciseId: s.exerciseId, set: { loadKg: s.loadKg, verifiedReps: s.verifiedReps, formScore: s.formScore, romPercent: s.romPercent }, at: w.now }));
  }
  if (w.painLevel !== "serious") {
    prs.push(...recordWorkoutPrs(db, { userId: w.userId, workoutId: w.id, localDate: w.localDate, verifiedReps: w.sets.reduce((a, s) => a + s.verifiedReps, 0), at: w.now }));
  }

  const award = workoutXp({
    sets: w.sets.map((s) => ({ reps: s.reps, verifiedReps: s.verifiedReps, repQuality: s.verifiedRepDetails.map((r) => ({ formScore: (r as { formScore?: number }).formScore ?? null, romPercent: r.romPercent })) })),
    durationMinutes: w.durationMinutes,
    priorTrainingMinutesToday: w.priorTrainingMinutesToday,
    painLevel: w.painLevel,
    // A first-ever record is a baseline; the bonus is for beating one (consistency records are recognition only).
    // One improved exercise is one PR bonus, however many of its metrics moved (heavier load also lifts the 1RM).
    personalRecords: new Set(prs.filter(isRewardedRecord).map((p) => p.exerciseId)).size,
  });
  db.prepare("UPDATE workouts SET xp_flags = ? WHERE id = ?").run(JSON.stringify(award.flags), w.id);
  const eventId = emitDomainEvent(db, w.userId, "workout.completed", w.id, {
    workoutId: w.id,
    localDate: w.localDate,
    durationMinutes: w.durationMinutes,
    painLevel: w.painLevel,
    sets: w.sets.length,
    reps: award.breakdown.verifiedReps + award.breakdown.unverifiedReps,
    verifiedReps: award.breakdown.verifiedReps,
    personalRecords: prs.map((p) => ({ exerciseId: p.exerciseId, kind: p.kind, value: p.value, status: p.status })),
  }, w.now);
  awardWorkoutXp(db, { userId: w.userId, workoutId: w.id, localDate: w.localDate, xp: award.xp, detail: { flags: award.flags, breakdown: award.breakdown }, domainEventId: eventId, now: w.now });
  return { prs, award };
}

export function listWorkouts(db: Db, userId: string, limit: number) {
  return db
    .prepare(
      `SELECT w.id, w.local_date AS localDate, w.duration_minutes AS durationMinutes, w.pain_level AS painLevel,
              (SELECT COALESCE(SUM(e.xp), 0) FROM xp_events e WHERE e.user_id = w.user_id AND e.source = 'workout' AND e.source_key = w.id) AS xp, w.created_at AS createdAt
       FROM workouts w
       WHERE w.user_id = ? ORDER BY w.created_at DESC LIMIT ?`,
    )
    .all(userId, limit);
}

export function recentWorkoutPain(db: Db, userId: string, limit = 30) {
  return db.prepare("SELECT local_date AS localDate, pain_level AS painLevel FROM workouts WHERE user_id = ? ORDER BY local_date DESC LIMIT ?").all(userId, limit) as {
    localDate: string;
    painLevel: PainLevel;
  }[];
}
