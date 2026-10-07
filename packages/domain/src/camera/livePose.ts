import { INTERRUPTED_GATE, type AngleSample, type MovementEvent, type RepTrace } from "../analysis/repVerification";
import { EXERCISE_BY_ID } from "../workouts/exercises";
import { exerciseAnalyzer, type ExerciseAnalyzer } from "./analysis";
import { CAMERA_REQUIREMENTS, FRAMING_THRESHOLDS, FramingTracker, type FramingAssessment } from "./framing";
import { LiveRepVerifier, type LiveRepState } from "./liveCoach";
import { toPixelSpace, type PoseDetection, type PosePerson } from "./pose";

/**
 * Live pose session: the on-device consumer of a PoseProvider stream for one exercise.
 *
 *   PoseDetection → FramingTracker (can we analyze this frame?) → ExerciseAnalyzer (angle + features)
 *     → LiveRepConsumer (rep verification + form, see LiveRepVerifier) · set trace for the server
 *
 * Only frames whose framing is trackable reach the analyzer; nothing downstream ever sees a
 * guessed body. Every analyzed frame — including gated ones, as confidence-0 samples with the
 * reason — is recorded in the set's trace, and the rep consumer sees exactly the recorded samples,
 * so the server's re-verification of the trace reaches the same result as the live count.
 */

export interface LiveRepConsumer {
  push(sample: AngleSample): MovementEvent[];
  /** Reps verified so far, or null when this consumer doesn't verify reps. */
  readonly count: number | null;
  /** New set: forget everything. */
  reset(): void;
}

/** Placeholder consumer: accepts samples, counts nothing, claims nothing. */
export function noopRepConsumer(): LiveRepConsumer {
  return { push: () => [], count: null, reset() {} };
}

/** Exercises the live camera can track: an analyzer, a framing requirement and library camera setup. */
export const CAMERA_READY_EXERCISES: readonly string[] = Object.keys(CAMERA_REQUIREMENTS).filter(
  (id) => EXERCISE_BY_ID.get(id)?.cameraVerifiable === true && exerciseAnalyzer(id) !== null,
);

export const LIVE_TRACE_LIMITS = {
  /** Frames closer together than this are skipped (≤ 20 fps analyzed), identically live and in the trace. */
  minFrameIntervalMs: 50,
  /** A set's trace stops recording (and counting) here; the server accepts at most 20 000. */
  maxSamples: 18_000,
} as const;

export interface LiveFrame {
  timestampMs: number;
  /** Smoothed framing for display. */
  framing: FramingAssessment;
  /** Whether this exact frame was analyzable. */
  trackable: boolean;
  /** Detected people, primary (most visible) first. Normalized coordinates, for the overlay. */
  people: PosePerson[];
  /** Measured sample for this frame (set-relative time), when trackable. */
  angle: AngleSample | null;
  events: MovementEvent[];
  /** False when this frame was skipped by the rate cap (framing still updates). */
  analyzed: boolean;
}

function visible(p: PosePerson): number {
  return p.keypoints.filter((k) => k.confidence >= FRAMING_THRESHOLDS.visibleConfidence).length;
}

export class LivePoseSession {
  private readonly tracker: FramingTracker;
  private samples: AngleSample[] = [];
  private setStartMs: number | null = null;
  private lastAnalyzedMs = -Infinity;

  private constructor(
    readonly exerciseId: string,
    private readonly analyzer: ExerciseAnalyzer,
    readonly reps: LiveRepConsumer,
  ) {
    this.tracker = new FramingTracker(CAMERA_REQUIREMENTS[exerciseId]!);
  }

  /** Null for exercises the camera can't track. Defaults to the live rep verifier. */
  static for(exerciseId: string, reps?: LiveRepConsumer): LivePoseSession | null {
    const analyzer = exerciseAnalyzer(exerciseId);
    if (!analyzer || !CAMERA_READY_EXERCISES.includes(exerciseId)) return null;
    return new LivePoseSession(exerciseId, analyzer, reps ?? LiveRepVerifier.for(exerciseId)!);
  }

  push(detection: PoseDetection): LiveFrame {
    const { frame, stable } = this.tracker.update(detection);
    const people = [...detection.people].sort((a, b) => visible(b) - visible(a));
    const t = detection.timestampMs;
    const base = { timestampMs: t, framing: stable, trackable: frame.trackable, people };
    if (t - this.lastAnalyzedMs < LIVE_TRACE_LIMITS.minFrameIntervalMs || this.traceFull) {
      return { ...base, angle: null, events: [], analyzed: false };
    }
    this.lastAnalyzedMs = t;
    this.setStartMs ??= t;
    const tMs = Math.round(t - this.setStartMs);

    let sample: AngleSample;
    let angle: AngleSample | null = null;
    if (frame.trackable && people[0]) {
      angle = this.analyzer.sample(toPixelSpace(people[0].keypoints, detection.frame), tMs);
      sample = angle ?? { tMs, angleDeg: 0, confidence: 0, gate: "insufficient_landmarks" };
    } else {
      sample = { tMs, angleDeg: 0, confidence: 0, gate: frame.issue ?? "insufficient_landmarks" };
    }
    this.samples.push(sample);
    const events = this.reps.push(sample);
    return { ...base, angle, events, analyzed: true };
  }

  get verifiedReps(): number | null {
    return this.reps.count;
  }

  /** Live rep state as of the latest analyzed frame, when the consumer verifies reps. */
  repState(): LiveRepState | null {
    return this.reps instanceof LiveRepVerifier ? this.reps.state(this.samples.at(-1)?.tMs ?? 0) : null;
  }

  /** The current set's trace, for the server to verify. */
  trace(): RepTrace {
    return { poseStatus: "ok", samples: [...this.samples] };
  }

  get traceFull(): boolean {
    return this.samples.length >= LIVE_TRACE_LIMITS.maxSamples;
  }

  isStale(nowMs: number): boolean {
    return this.tracker.isStale(nowMs);
  }

  /**
   * Camera paused / page hidden / stream stalled: drop framing state and abort any rep in
   * progress. Reps already verified in this set are kept; the trace shows the gap.
   */
  interrupt(): void {
    this.tracker.reset();
    const last = this.samples.at(-1);
    if (!last || last.gate === INTERRUPTED_GATE) return;
    // Recorded explicitly so the server aborts the same rep, however short the gap was.
    const marker: AngleSample = { tMs: last.tMs, angleDeg: 0, confidence: 0, gate: INTERRUPTED_GATE };
    this.samples.push(marker);
    this.reps.push(marker);
  }

  /** Start a new set: clears the trace, reps and framing. */
  startSet(): void {
    this.tracker.reset();
    this.reps.reset();
    this.samples = [];
    this.setStartMs = null;
    this.lastAnalyzedMs = -Infinity;
  }
}
