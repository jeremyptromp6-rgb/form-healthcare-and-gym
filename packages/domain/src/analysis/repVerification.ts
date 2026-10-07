import { assertFiniteInRange, DomainValidationError } from "../shared/errors";
import type { FrameFeatures } from "./features";

/**
 * Rep Verification Engine.
 *
 * Counts reps from a joint-angle trace produced by pose detection. If pose data is unavailable,
 * denied, gated (person out of frame, several people, low confidence) or interrupted mid-rep, the
 * rep is not verified — FORM prefers "rep not verified" over a false positive.
 */

export interface RomSpec {
  /** Joint angle (deg) that counts as the extended / top position, e.g. knee ≥ 160 in a squat. */
  topAngleDeg: number;
  /** Angle that must be reached for the rep to count (required depth / contraction). */
  bottomAngleDeg: number;
  /** A movement shallower than this below `topAngleDeg` is treated as noise, not an attempt. */
  attemptThresholdDeg: number;
  /** Faster reps than this are rejected as implausible / bouncing. */
  minRepDurationMs: number;
  /** Samples below this pose confidence are ignored (treated as gaps). */
  minConfidence: number;
  /**
   * Reference range for ROM %: a full, controlled rep (2D side-view joint angle). Wider than the
   * verification thresholds, so a verified-but-shallow rep scores below 100%.
   */
  fullRomTopDeg: number;
  fullRomBottomDeg: number;
}

const SQUAT_KNEE: RomSpec = {
  topAngleDeg: 160,
  bottomAngleDeg: 100,
  attemptThresholdDeg: 20,
  minRepDurationMs: 600,
  minConfidence: 0.5,
  fullRomTopDeg: 170,
  fullRomBottomDeg: 90,
};

/** ROM rules per exercise. Keys here are exactly the exercises FORM can verify with a camera. */
export const ROM_SPECS = {
  squat: SQUAT_KNEE,
  bodyweight_squat: SQUAT_KNEE,
  goblet_squat: SQUAT_KNEE,
  // Elbow: extended ≈ 150°+, curled ≤ 60°.
  bicep_curl: { topAngleDeg: 150, bottomAngleDeg: 60, attemptThresholdDeg: 20, minRepDurationMs: 700, minConfidence: 0.5, fullRomTopDeg: 160, fullRomBottomDeg: 45 },
  push_up: { topAngleDeg: 155, bottomAngleDeg: 95, attemptThresholdDeg: 20, minRepDurationMs: 500, minConfidence: 0.5, fullRomTopDeg: 165, fullRomBottomDeg: 80 },
  lunge: { topAngleDeg: 160, bottomAngleDeg: 105, attemptThresholdDeg: 20, minRepDurationMs: 600, minConfidence: 0.5, fullRomTopDeg: 170, fullRomBottomDeg: 95 },
} satisfies Record<string, RomSpec>;

/** Temporal validation shared by every exercise. */
export const MOVEMENT_LIMITS = {
  /** Rising this far off the lowest point means the movement has reversed (hysteresis). */
  reversalDeg: 10,
  /** A gap between confident samples longer than this mid-rep aborts the rep (tracking lost). */
  maxGapMs: 600,
  /** Faster joint rotation than this is a landmark glitch, not movement. */
  maxAngularVelocityDegPerS: 1000,
  /** This many consecutive "glitches" in a row are accepted as a real discontinuity. */
  outlierRunToAccept: 3,
  /**
   * Frames the framing check rejected (out of frame, occluded, too few landmarks…) for this long
   * mid-rep abort it. Several people in view abort it at once — whose rep would it be?
   */
  maxGatedMs: 200,
} as const;

/** Gate recorded when tracking was interrupted (camera paused, page hidden): aborts a rep in progress. */
export const INTERRUPTED_GATE = "interrupted";
/** Gate recorded when several people are in view: aborts a rep in progress immediately. */
export const AMBIGUOUS_GATE = "multiple_people";

export type PoseStatus = "ok" | "unavailable" | "permission_denied";

export interface AngleSample {
  /** Milliseconds since the start of the set. */
  tMs: number;
  angleDeg: number;
  confidence: number;
  /** Form features measured on the same frame (see analysis/features). */
  features?: FrameFeatures;
  /** Why this frame couldn't be analyzed (framing issue); such frames carry confidence 0. */
  gate?: string;
}

export interface RepTrace {
  poseStatus: PoseStatus;
  samples: AngleSample[];
}

export type RepRejectionReason = "insufficient_rom" | "too_fast" | "tracking_lost";

/** The VerifiedRep model: one rep the engine saw complete with the required range of motion. */
export interface VerifiedRep {
  index: number;
  /** Last moment at the top before the rep (ms since set start). */
  startMs: number;
  /** When the lowest point was reached. */
  bottomMs: number;
  /** When full extension was reached again. */
  endMs: number;
  durationMs: number;
  minAngleDeg: number;
  /** Most extended angle at the top before the rep. */
  peakAngleDeg: number;
  /** Amplitude as % of the exercise's reference range, capped at 100. */
  romPercent: number;
}

export interface RejectedAttempt {
  reason: RepRejectionReason;
  minAngleDeg: number;
  startMs: number;
  endMs: number;
}

export interface RepVerificationResult {
  status: "verified" | "pose_unavailable" | "permission_denied" | "insufficient_data";
  verifiedReps: number;
  reps: VerifiedRep[];
  rejected: RejectedAttempt[];
  /** A rep was in progress when the trace ended — never counted. */
  incomplete: boolean;
  /** Mean ROM of verified reps. Null when no reps verified. */
  averageRomPercent: number | null;
  /** Frames that couldn't be analyzed, by reason (framing gate or low confidence). */
  gatedFrames: Record<string, number>;
}

const MAX_SAMPLES = 20_000;

export function romPercent(spec: RomSpec, peakAngleDeg: number, minAngleDeg: number): number {
  const top = Math.min(peakAngleDeg, spec.fullRomTopDeg);
  const bottom = Math.max(minAngleDeg, spec.fullRomBottomDeg);
  return Math.round(Math.max(0, Math.min(1, (top - bottom) / (spec.fullRomTopDeg - spec.fullRomBottomDeg))) * 100);
}

/** Throws DomainValidationError for malformed traces (API input). */
export function validateTrace(trace: RepTrace): void {
  if (trace.samples.length > MAX_SAMPLES) throw new DomainValidationError(`trace exceeds ${MAX_SAMPLES} samples`, "samples");
  let lastT = -Infinity;
  for (const s of trace.samples) {
    assertFiniteInRange(s.angleDeg, 0, 360, "angleDeg");
    assertFiniteInRange(s.confidence, 0, 1, "confidence");
    if (!Number.isFinite(s.tMs) || s.tMs < lastT) throw new DomainValidationError("samples must be in non-decreasing time order", "tMs");
    lastT = s.tMs;
    if (s.features) for (const v of Object.values(s.features)) if (v !== undefined) assertFiniteInRange(v, -1000, 1000, "features");
  }
}

export function verifyReps(trace: RepTrace, spec: RomSpec): RepVerificationResult {
  const empty = (status: RepVerificationResult["status"], gatedFrames: Record<string, number> = {}): RepVerificationResult => ({
    status,
    verifiedReps: 0,
    reps: [],
    rejected: [],
    incomplete: false,
    averageRomPercent: null,
    gatedFrames,
  });

  if (trace.poseStatus === "unavailable") return empty("pose_unavailable");
  if (trace.poseStatus === "permission_denied") return empty("permission_denied");
  validateTrace(trace);

  const gatedFrames: Record<string, number> = {};
  let usable = 0;
  for (const s of trace.samples) {
    if (s.confidence >= spec.minConfidence) usable++;
    else {
      const key = s.gate ?? "low_confidence";
      gatedFrames[key] = (gatedFrames[key] ?? 0) + 1;
    }
  }
  if (usable === 0) return empty("insufficient_data", gatedFrames);

  const machine = new MovementStateMachine(spec);
  for (const s of trace.samples) machine.push(s);
  const { reps, rejected, incomplete } = machine.result();

  return {
    status: "verified",
    verifiedReps: reps.length,
    reps,
    rejected,
    incomplete,
    averageRomPercent: reps.length === 0 ? null : Math.round(reps.reduce((a, r) => a + r.romPercent, 0) / reps.length),
    gatedFrames,
  };
}

/**
 * Phases shared by every camera exercise (each exercise names them — see PHASE_LABELS):
 * unknown (not yet seen at the top) → top → descending → bottom (required depth reached)
 * → ascending → back to top (full extension) = rep complete.
 */
export type MovementPhase = "unknown" | "top" | "descending" | "bottom" | "ascending";

export type MovementEvent = { type: "rep_verified"; rep: VerifiedRep } | ({ type: "rep_rejected" } & RejectedAttempt);

interface Attempt {
  startMs: number;
  peakAngleDeg: number;
  minAngleDeg: number;
  minMs: number;
  depthReached: boolean;
  /** Highest angle since the movement last reversed upward (detects a second dip). */
  riseMax: number;
}

/**
 * MovementStateMachine — incremental rep detection over joint-angle samples. The same machine
 * serves live camera analysis (push samples as they arrive) and server-side verification of the
 * recorded trace (verifyReps), so both always agree on exactly the same samples.
 *
 * Temporal validation:
 * - starts in `unknown`: a rep only begins after the joint has been seen fully extended, so
 *   tracking that starts mid-movement can't produce a rep;
 * - duplicate / out-of-order frames are ignored;
 * - a single-frame angle jump faster than any human joint is a landmark glitch and is skipped;
 * - frames the framing check rejected for `maxGatedMs` (out of frame, occluded…), any frame with
 *   several people, an explicit interruption, or a gap in confident samples longer than
 *   `maxGapMs` abort the rep in progress as `tracking_lost` and return to `unknown`;
 * - hysteresis: an attempt starts `attemptThresholdDeg` below the top and the movement only
 *   reverses after rising `reversalDeg` off the lowest point, so jitter can't double-count.
 *
 * A rep counts only with the required depth, a return to full extension and a plausible duration
 * measured from the last moment at the top.
 */
export class MovementStateMachine {
  private phase: MovementPhase = "unknown";
  private last: AngleSample | null = null;
  private outlierRun = 0;
  private gatedSince: number | null = null;
  private lastTopMs = 0;
  private topPeak = -Infinity;
  private attempt: Attempt | null = null;
  private readonly reps: VerifiedRep[] = [];
  private readonly rejected: RejectedAttempt[] = [];

  constructor(private readonly spec: RomSpec) {}

  get currentPhase(): MovementPhase {
    return this.phase;
  }

  /** ROM of the movement in progress (live depth gauge), or null at the top. */
  get liveRomPercent(): number | null {
    return this.attempt ? romPercent(this.spec, this.attempt.peakAngleDeg, this.attempt.minAngleDeg) : null;
  }

  /** Feed one sample; low-confidence samples are gaps. Returns any rep events it completes. */
  push(s: AngleSample): MovementEvent[] {
    if (s.gate === INTERRUPTED_GATE) return this.interrupt();
    if (s.confidence < this.spec.minConfidence) {
      if (!s.gate) return []; // brief low-confidence dropout: the gap rule decides
      this.gatedSince ??= s.tMs;
      if (s.gate === AMBIGUOUS_GATE || s.tMs - this.gatedSince >= MOVEMENT_LIMITS.maxGatedMs) return this.lose(s.tMs);
      return [];
    }
    this.gatedSince = null;
    if (this.last && s.tMs <= this.last.tMs) return [];
    const events: MovementEvent[] = [];
    if (this.last) {
      const dt = s.tMs - this.last.tMs;
      if (dt > MOVEMENT_LIMITS.maxGapMs) events.push(...this.lose(this.last.tMs));
      else if ((Math.abs(s.angleDeg - this.last.angleDeg) / dt) * 1000 > MOVEMENT_LIMITS.maxAngularVelocityDegPerS) {
        this.outlierRun++;
        if (this.outlierRun < MOVEMENT_LIMITS.outlierRunToAccept) return events;
        events.push(...this.lose(this.last.tMs)); // a real discontinuity, not one bad frame
      }
    }
    this.outlierRun = 0;
    this.last = s;
    return events.concat(this.step(s));
  }

  /** Tracking stopped (interruption): abort any rep in progress; a new rep needs the top again. */
  interrupt(): MovementEvent[] {
    const events = this.last ? this.lose(this.last.tMs) : [];
    this.last = null;
    return events;
  }

  /** Reps completed so far. A rep still in progress never counts. */
  result(): { reps: VerifiedRep[]; rejected: RejectedAttempt[]; incomplete: boolean } {
    return { reps: [...this.reps], rejected: [...this.rejected], incomplete: this.attempt !== null };
  }

  private lose(atMs: number): MovementEvent[] {
    const a = this.attempt;
    this.attempt = null;
    this.phase = "unknown";
    this.topPeak = -Infinity;
    if (!a) return [];
    const r: RejectedAttempt = { reason: "tracking_lost", minAngleDeg: a.minAngleDeg, startMs: a.startMs, endMs: atMs };
    this.rejected.push(r);
    return [{ type: "rep_rejected", ...r }];
  }

  private step(s: AngleSample): MovementEvent[] {
    const spec = this.spec;
    const angle = s.angleDeg;

    if (this.phase === "unknown") {
      if (angle >= spec.topAngleDeg) this.enterTop(s);
      return [];
    }
    if (this.phase === "top") {
      if (angle >= spec.topAngleDeg) {
        this.lastTopMs = s.tMs;
        this.topPeak = Math.max(this.topPeak, angle);
      } else if (angle <= spec.topAngleDeg - spec.attemptThresholdDeg) {
        const depth = angle <= spec.bottomAngleDeg;
        this.attempt = { startMs: this.lastTopMs, peakAngleDeg: this.topPeak, minAngleDeg: angle, minMs: s.tMs, depthReached: depth, riseMax: angle };
        this.phase = depth ? "bottom" : "descending";
      }
      return [];
    }

    const a = this.attempt!;
    if (angle < a.minAngleDeg) {
      a.minAngleDeg = angle;
      a.minMs = s.tMs;
    }
    if (this.phase === "descending" || this.phase === "bottom") {
      if (angle <= spec.bottomAngleDeg) {
        a.depthReached = true;
        this.phase = "bottom";
      }
      if (angle >= a.minAngleDeg + MOVEMENT_LIMITS.reversalDeg) {
        this.phase = "ascending";
        a.riseMax = angle;
      }
    } else if (this.phase === "ascending") {
      a.riseMax = Math.max(a.riseMax, angle);
      if (angle <= a.riseMax - MOVEMENT_LIMITS.reversalDeg) {
        // Dipped again before reaching the top: still the same attempt.
        this.phase = a.depthReached ? "bottom" : "descending";
        a.minAngleDeg = Math.min(a.minAngleDeg, angle);
        return [];
      }
    }
    if (this.phase === "ascending" && angle >= spec.topAngleDeg) return this.complete(s, a);
    return [];
  }

  private enterTop(s: AngleSample) {
    this.phase = "top";
    this.lastTopMs = s.tMs;
    this.topPeak = s.angleDeg;
  }

  private complete(s: AngleSample, a: Attempt): MovementEvent[] {
    const spec = this.spec;
    this.attempt = null;
    this.enterTop(s);
    const duration = s.tMs - a.startMs;
    const base = { minAngleDeg: a.minAngleDeg, startMs: a.startMs, endMs: s.tMs };
    let reason: RepRejectionReason | null = null;
    if (!a.depthReached) reason = "insufficient_rom";
    else if (duration < spec.minRepDurationMs) reason = "too_fast";
    if (reason) {
      const r: RejectedAttempt = { reason, ...base };
      this.rejected.push(r);
      return [{ type: "rep_rejected", ...r }];
    }
    const rep: VerifiedRep = {
      index: this.reps.length,
      startMs: a.startMs,
      bottomMs: a.minMs,
      endMs: s.tMs,
      durationMs: Math.round(duration),
      minAngleDeg: a.minAngleDeg,
      peakAngleDeg: a.peakAngleDeg,
      romPercent: romPercent(spec, a.peakAngleDeg, a.minAngleDeg),
    };
    this.reps.push(rep);
    return [{ type: "rep_verified", rep }];
  }
}
