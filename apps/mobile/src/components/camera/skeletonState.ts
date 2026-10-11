import { EXERCISE_BY_ID, type LiveFeedback, type LiveFrame } from '@form/domain';
import { palettes } from '@/theme/tokens';
import type { SkeletonPalette, SkeletonState, SkeletonTone } from './skeletonTypes';
import { skeletonToneColors } from './skeletonTone';

/** Frames in a row that must be untrackable before the skeleton says so (a blink is not a loss). */
const UNTRACKABLE_FRAMES = 4;
/** Frames in a row a new body side must be seen before the highlight moves to it. */
const SIDE_FRAMES = 5;

/**
 * The skeleton is drawn over the camera, so it always uses the Evening palette (round 4, D2).
 * Tone colours come from the same mapping as the feedback strip (D1), never from a second list.
 */
export function skeletonPalette(): SkeletonPalette {
  const p = palettes.dark;
  return { ...skeletonToneColors(p), other: p.danger, halo: p.bg, highlight: p.text };
}

/** MediaPipe pose indices: left/right shoulder, elbow, wrist, hip, knee, ankle. */
const CHAIN = {
  knee: { left: [23, 25, 27], right: [24, 26, 28] },
  elbow: { left: [11, 13, 15], right: [12, 14, 16] },
} as const;

/**
 * The joints the exercise is judged on, as MediaPipe indices (hip-knee-ankle or
 * shoulder-elbow-wrist) on the tracked side. Empty when the exercise has no camera joint or no
 * side is known yet.
 */
export function chainFor(exerciseId: string, side: 'left' | 'right' | null): number[] {
  const joint = EXERCISE_BY_ID.get(exerciseId)?.camera?.joint;
  if (!joint || !side) return [];
  return [...CHAIN[joint][side]];
}

/**
 * Turns the live frame and the coach's current cue into the skeleton's state, and says when it
 * has changed. The judgement lives here, in plain TypeScript, so the camera page only draws.
 */
export class SkeletonStateTracker {
  private state: SkeletonState;
  private side: 'left' | 'right' | null = null;
  private untrackableRun = 0;
  private untrackable = false;
  private candidate: 'left' | 'right' | null = null;
  private candidateRun = 0;

  constructor(
    private readonly exerciseId: string,
    reduceMotion: boolean,
  ) {
    this.state = this.build('good', reduceMotion);
  }

  setReduceMotion(reduceMotion: boolean): void {
    if (reduceMotion !== this.state.reduceMotion) this.state = { ...this.state, reduceMotion };
  }

  /** The new state when this frame changed anything the skeleton shows; null when nothing changed. */
  update(frame: Pick<LiveFrame, 'trackable' | 'framing'>, cue: LiveFeedback | null): SkeletonState | null {
    if (frame.trackable) {
      this.untrackableRun = 0;
      this.untrackable = false;
    } else if (++this.untrackableRun >= UNTRACKABLE_FRAMES) this.untrackable = true;

    const seen = frame.framing.side;
    if (!seen) {
      this.candidateRun = 0; // no side this frame: keep the last one, but a new side must start over
    } else {
      if (seen === this.side) this.candidateRun = 0;
      else {
        this.candidateRun = this.candidate === seen ? this.candidateRun + 1 : 1;
        this.candidate = seen;
        if (this.candidateRun >= SIDE_FRAMES) {
          this.side = seen;
          this.candidateRun = 0;
        }
      }
    }

    const tone: SkeletonTone = this.untrackable ? 'untrackable' : (cue?.tone ?? 'good');
    const prev = this.state;
    if (tone === prev.tone && this.side === prev.side) return null;
    this.state = { ...prev, tone, side: this.side, chain: chainFor(this.exerciseId, this.side) };
    return this.state;
  }

  current(): SkeletonState {
    return this.state;
  }

  /** Forget everything seen (the camera restarted). Keeps the reduce-motion setting. */
  reset(): void {
    this.side = null;
    this.untrackable = false;
    this.untrackableRun = 0;
    this.candidate = null;
    this.candidateRun = 0;
    this.state = this.build('good', this.state.reduceMotion);
  }

  private build(tone: SkeletonTone, reduceMotion: boolean): SkeletonState {
    return { v: 1, tone, side: this.side, chain: chainFor(this.exerciseId, this.side), palette: skeletonPalette(), reduceMotion };
  }
}

/**
 * The script that hands a state to the engine page. The first assignment is the original
 * one-colour line (kept so older pages still recolour); the second is the full state.
 */
export function skeletonInjection(s: SkeletonState): string {
  return `window.__skeletonColor=${JSON.stringify(s.palette[s.tone])};window.__formSkeleton=${JSON.stringify(s)};window.formSkeleton&&window.formSkeleton(window.__formSkeleton);true;`;
}
