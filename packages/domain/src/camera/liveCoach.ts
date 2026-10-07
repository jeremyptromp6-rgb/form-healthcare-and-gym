import type { FeatureFamily } from "../analysis/features";
import { assessRepForm, EXERCISE_FAMILY, issueMessage } from "../analysis/formAnalysis";
import { MovementStateMachine, ROM_SPECS, type AngleSample, type MovementEvent, type MovementPhase, type RejectedAttempt, type RomSpec } from "../analysis/repVerification";
import { summarizeSet, type AssessedRep, type SetQuality } from "../analysis/setAnalysis";
import type { LiveRepConsumer } from "./livePose";

/**
 * Live rep verification + coaching on the device. Runs the same MovementStateMachine and form
 * rules as the server, over exactly the samples the set's trace records, so the live count and
 * the server's verified count agree. The server's result is still the one that counts.
 */

/** What each exercise calls the shared movement phases. */
export const PHASE_LABELS: Record<FeatureFamily, Record<MovementPhase, string>> = {
  squat: { unknown: "Stand tall to start", top: "Standing", descending: "Descending", bottom: "Required depth", ascending: "Ascending" },
  lunge: { unknown: "Stand tall to start", top: "Standing", descending: "Descending", bottom: "Required depth", ascending: "Ascending" },
  push_up: { unknown: "Start at the top, arms straight", top: "Top", descending: "Descending", bottom: "Required depth", ascending: "Ascending" },
  curl: { unknown: "Start with your arm extended", top: "Extended", descending: "Curling", bottom: "Required contraction", ascending: "Returning" },
};

export interface LiveFeedback {
  headline: "CORRECT FORM" | "FIX YOUR FORM" | "REP NOT VERIFIED";
  message: string;
  tone: "good" | "fix" | "warn";
  atMs: number;
}

export interface LiveRepState {
  phase: MovementPhase;
  phaseLabel: string;
  verifiedReps: number;
  /** Depth of the movement in progress (0–100), null at the top. */
  liveRomPercent: number | null;
  lastRep: AssessedRep | null;
  quality: SetQuality;
  feedback: LiveFeedback | null;
}

export const FEEDBACK_TIMING = {
  /** A cue stays up at least this long before another replaces it. */
  minHoldMs: 1200,
  /** …and disappears after this long without a new rep event. */
  expireMs: 4000,
} as const;

/** Keeps only this much confident history for form scoring (a rep can't be longer). */
const HISTORY_MS = 20_000;

export class LiveRepVerifier implements LiveRepConsumer {
  private readonly spec: RomSpec;
  private readonly family: FeatureFamily;
  private machine: MovementStateMachine;
  private history: AngleSample[] = [];
  private reps: AssessedRep[] = [];
  private rejected: RejectedAttempt[] = [];
  private current: LiveFeedback | null = null;
  private pending: LiveFeedback | null = null;
  private lastT = 0;

  private constructor(readonly exerciseId: string) {
    this.spec = (ROM_SPECS as Record<string, RomSpec>)[exerciseId]!;
    this.family = EXERCISE_FAMILY[exerciseId]!;
    this.machine = new MovementStateMachine(this.spec);
  }

  static for(exerciseId: string): LiveRepVerifier | null {
    return exerciseId in ROM_SPECS && EXERCISE_FAMILY[exerciseId] ? new LiveRepVerifier(exerciseId) : null;
  }

  get count(): number {
    return this.reps.length;
  }

  push(sample: AngleSample): MovementEvent[] {
    this.lastT = sample.tMs;
    if (sample.confidence >= this.spec.minConfidence) {
      this.history.push(sample);
      if (this.machine.currentPhase === "top" || this.machine.currentPhase === "unknown") {
        const cutoff = sample.tMs - HISTORY_MS;
        if (this.history[0] && this.history[0].tMs < cutoff) this.history = this.history.filter((s) => s.tMs >= cutoff);
      }
    }
    return this.handle(this.machine.push(sample));
  }

  reset(): void {
    this.machine = new MovementStateMachine(this.spec);
    this.history = [];
    this.reps = [];
    this.rejected = [];
    this.current = null;
    this.pending = null;
  }

  state(nowMs: number = this.lastT): LiveRepState {
    if (this.pending && (!this.current || nowMs - this.current.atMs >= FEEDBACK_TIMING.minHoldMs)) {
      this.current = { ...this.pending, atMs: Math.max(this.pending.atMs, nowMs) };
      this.pending = null;
    }
    if (this.current && !this.pending && nowMs - this.current.atMs > FEEDBACK_TIMING.expireMs) this.current = null;
    const phase = this.machine.currentPhase;
    return {
      phase,
      phaseLabel: PHASE_LABELS[this.family][phase],
      verifiedReps: this.reps.length,
      liveRomPercent: this.machine.liveRomPercent,
      lastRep: this.reps.at(-1) ?? null,
      quality: summarizeSet(this.exerciseId, this.reps, this.rejected, this.machine.result().incomplete),
      feedback: this.current,
    };
  }

  private handle(events: MovementEvent[]): MovementEvent[] {
    for (const e of events) {
      if (e.type === "rep_verified") {
        const form = assessRepForm(this.exerciseId, e.rep, this.history)!;
        this.reps.push({ ...e.rep, formScore: form.score, issues: form.issues.map((i) => i.code), perfect: form.perfect });
        const top = form.issues[0];
        this.offer(
          top
            ? { headline: "FIX YOUR FORM", message: top.message, tone: "fix", atMs: e.rep.endMs }
            : { headline: "CORRECT FORM", message: form.perfect ? "Full range, good control." : "Good rep.", tone: "good", atMs: e.rep.endMs },
        );
      } else {
        this.rejected.push({ reason: e.reason, minAngleDeg: e.minAngleDeg, startMs: e.startMs, endMs: e.endMs });
        const message =
          e.reason === "insufficient_rom" ? issueMessage(this.exerciseId, "depth") : e.reason === "too_fast" ? "Control the movement" : "Stay in frame for the whole rep";
        this.offer({ headline: "REP NOT VERIFIED", message, tone: "warn", atMs: e.endMs });
      }
    }
    return events;
  }

  /** Throttle: a new cue waits until the current one has been up for `minHoldMs`. */
  private offer(f: LiveFeedback) {
    if (!this.current || f.atMs - this.current.atMs >= FEEDBACK_TIMING.minHoldMs) {
      this.current = f;
      this.pending = null;
    } else this.pending = f;
  }
}
