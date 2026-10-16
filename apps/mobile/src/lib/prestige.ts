/** Endless Champion levels: the server sends `prestige` once a user is at the max level. Older servers omit these fields. */

/** The level at which "Champion 1" starts (the server's max level). */
export const PRESTIGE_LEVEL = 100;

export interface PrestigeFields {
  level: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  fractionToNext: number;
  prestige?: number | null;
  xpIntoStep?: number;
  xpForStep?: number;
}

/** "Champion 3" for a prestige, otherwise just the rank name. */
export function rankLabel(rank: string, prestige?: number | null): string {
  return prestige != null && prestige > 0 ? `${rank} ${prestige}` : rank;
}

export interface StepProgress {
  /** XP earned inside the current step (a level below the top, a Champion step at it). */
  into: number;
  /** XP span of the step; 0 only on an old server at the top. */
  span: number;
  fraction: number;
  toNext: number;
  /** What the step leads to: "level 14" or "Champion 4". */
  nextName: string | null;
}

/** The bar everyone sees: progress to the next level, or to the next Champion at the top. */
export function stepProgress(p: PrestigeFields): StepProgress {
  if (p.prestige != null && p.prestige > 0 && (p.xpForStep ?? 0) > 0) {
    const span = p.xpForStep as number;
    const into = Math.min(span, Math.max(0, p.xpIntoStep ?? 0));
    return { into, span, fraction: into / span, toNext: span - into, nextName: `Champion ${p.prestige + 1}` };
  }
  if (p.xpForNextLevel === 0) return { into: 0, span: 0, fraction: 1, toNext: 0, nextName: null };
  return { into: p.xpIntoLevel, span: p.xpForNextLevel, fraction: p.fractionToNext, toNext: Math.max(0, p.xpForNextLevel - p.xpIntoLevel), nextName: `level ${p.level + 1}` };
}
