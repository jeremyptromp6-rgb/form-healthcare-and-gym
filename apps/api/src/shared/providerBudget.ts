import type { Db } from "../db";

/**
 * Service-wide daily budgets for paid outside providers (AI coach, meal recognition). Per-user
 * limits stop one account running up a bill; these stop many accounts doing it together. Counted
 * in `provider_usage` (per UTC day, no personal data), so deleting accounts can't reset them.
 *
 * Reserves one call atomically; returns false once today's budget is spent.
 */
export function reserveProviderCall(db: Db, provider: "ai_coach" | "food_recognition", now: Date, dailyLimit: number): boolean {
  const day = now.toISOString().slice(0, 10);
  const r = db
    .prepare(
      `INSERT INTO provider_usage (day, provider, calls) VALUES (?, ?, 1)
       ON CONFLICT(day, provider) DO UPDATE SET calls = calls + 1 WHERE calls < ?`,
    )
    .run(day, provider, dailyLimit);
  return r.changes > 0 && dailyLimit > 0;
}

export function providerCallsToday(db: Db, provider: string, now: Date): number {
  const row = db.prepare("SELECT calls FROM provider_usage WHERE day = ? AND provider = ?").get(now.toISOString().slice(0, 10), provider) as { calls: number } | undefined;
  return row?.calls ?? 0;
}
