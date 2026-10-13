import { EXERCISE_BY_ID } from '@form/domain';

/** One landmark as the engines report it: normalized x, y and visibility. */
export type Landmark = readonly [x: number, y: number, visibility: number];

/** MediaPipe pose indices: left/right shoulder and hip. */
const L_SHOULDER = 11;
const R_SHOULDER = 12;
const L_HIP = 23;
const R_HIP = 24;

/** All four torso joints must be at least this visible for a reading. */
const MIN_VISIBILITY = 0.5;
/** Shoulder width over torso length: front-on is about 0.7-0.9, 45 degrees about 0.5, side-on under 0.2. */
export const FRONT_ON_RATIO = 0.55;
/** Readings in a row at or above the ratio before the user counts as front-on (about a second of frames). */
export const FRONT_ON_READINGS = 20;
/** Readings in a row below the ratio before front-on is cleared. */
export const CLEAR_READINGS = 10;

/**
 * How square-on the torso faces the camera, from the landmarks in pixel space: shoulder width over
 * torso length. Null when a torso joint is missing or unclear, or the torso has no length.
 */
export function bodyOrientationRatio(lm: readonly Landmark[] | undefined, w: number, h: number): number | null {
  if (!lm || !(w > 0) || !(h > 0)) return null;
  const ls = lm[L_SHOULDER];
  const rs = lm[R_SHOULDER];
  const lh = lm[L_HIP];
  const rh = lm[R_HIP];
  if (!ls || !rs || !lh || !rh) return null;
  for (const p of [ls, rs, lh, rh]) {
    if (!(p[2] >= MIN_VISIBILITY) || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return null;
  }
  const shoulderWidth = Math.hypot((ls[0] - rs[0]) * w, (ls[1] - rs[1]) * h);
  const torsoLen = Math.hypot(((ls[0] + rs[0]) / 2 - (lh[0] + rh[0]) / 2) * w, ((ls[1] + rs[1]) / 2 - (lh[1] + rh[1]) / 2) * h);
  if (!(torsoLen > 0)) return null;
  return shoulderWidth / torsoLen;
}

/**
 * Says when the user faces the camera although the exercise is measured side-on. Debounced both ways;
 * a frame with no usable reading (nobody in view, a joint hidden) neither raises nor clears it.
 * Exercises that are not measured side-on never report anything.
 */
export class StanceTracker {
  private readonly active: boolean;
  private on = 0;
  private off = 0;
  private frontOn = false;

  constructor(exerciseId: string) {
    this.active = EXERCISE_BY_ID.get(exerciseId)?.camera?.view === 'side';
  }

  /** Feeds one frame's first person (or undefined) and returns the current stance. */
  update(lm: readonly Landmark[] | undefined, w: number, h: number): 'front-on' | null {
    if (!this.active) return null;
    const ratio = bodyOrientationRatio(lm, w, h);
    if (ratio === null) return this.current();
    if (ratio >= FRONT_ON_RATIO) {
      this.off = 0;
      if (++this.on >= FRONT_ON_READINGS) this.frontOn = true;
    } else {
      this.on = 0;
      if (++this.off >= CLEAR_READINGS) this.frontOn = false;
    }
    return this.current();
  }

  current(): 'front-on' | null {
    return this.frontOn ? 'front-on' : null;
  }

  reset(): void {
    this.on = 0;
    this.off = 0;
    this.frontOn = false;
  }
}
