/**
 * The XP ledger. Every change to a user's XP is one append-only entry — never edited, never
 * deleted. Awards, settlement adjustments, decay, corrections and progression resets are all
 * entries, so the full history is auditable and any total can be recomputed from it.
 *
 * - `idempotencyKey` is unique per user: an award can never be granted twice.
 * - Amounts are always computed server-side (ProgressionEngine, quest and consistency rules).
 * - A correction is a compensating entry, not an edit.
 * - A reset entry (amount 0) starts a new "active" epoch: active XP is the sum of entries after
 *   the latest reset; the history before it is kept untouched.
 */

export const XP_SOURCES = ["workout", "nutrition_day", "quest", "achievement", "decay", "reset", "correction"] as const;
export type XpSource = (typeof XP_SOURCES)[number];

export const XP_KINDS = ["award", "adjustment", "decay", "reset", "correction"] as const;
export type XpKind = (typeof XP_KINDS)[number];

export interface XPEvent {
  id: number;
  userId: string;
  source: XpSource;
  /** What it refers to: workout id, local date, quest:period. */
  reference: string;
  kind: XpKind;
  /** Signed: decay and compensating adjustments are negative. */
  xp: number;
  idempotencyKey: string;
  domainEventId: number | null;
  localDate: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export function sumXp(events: readonly Pick<XPEvent, "xp">[]): number {
  return events.reduce((total, e) => total + e.xp, 0);
}

/** Active XP: the sum since the latest reset (entries in id order), never below zero. */
export function activeXpFrom(events: readonly Pick<XPEvent, "kind" | "xp">[]): number {
  let total = 0;
  for (const e of events) total = e.kind === "reset" ? 0 : total + e.xp;
  return Math.max(0, total);
}

/** Lifetime XP earned across every epoch: awards, adjustments and corrections (decay not subtracted). */
export function lifetimeXpFrom(events: readonly Pick<XPEvent, "kind" | "xp">[]): number {
  return events.filter((e) => e.kind === "award" || e.kind === "adjustment" || e.kind === "correction").reduce((t, e) => t + e.xp, 0);
}
