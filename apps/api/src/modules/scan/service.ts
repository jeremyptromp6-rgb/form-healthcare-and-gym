import { randomUUID } from "node:crypto";
import {
  buildScanReview,
  resolveScanSelections,
  SCAN_LIMITS,
  ScanSelectionError,
  VERIFIED_FOODS,
  type MealType,
  type ScanReview,
  type ScanSelection,
} from "@form/domain";
import type { Db } from "../../db";
import { transaction } from "../../db";
import { HttpError } from "../../http/errors";
import { loadSettings } from "../users/repo";
import type { AppContext } from "../../shared/context";
import { refundProviderCall, reserveProviderCall } from "../../shared/providerBudget";
import { providerFailure } from "../../shared/providers";
import { lastRecognitionFailure } from "../../providers/foodRecognition";
import { userClock } from "../../shared/userClock";
import { can, proRequired } from "../billing/entitlements";
import { scansToday } from "../billing/service";
import type { UserClock } from "../../shared/userClock";
import { findFood, insertScanLogs, listUserFoods, scanLogs } from "../nutrition/service";
import { sanitizePhoto, type PhotoMime } from "../users/photo";

/**
 * Food scans. The photo lives only in memory for the length of the recognition call: it is
 * checked, stripped of metadata (location, device), sent to the configured provider, and dropped.
 * What's kept is the review (labels, confidence, portion and nutrition estimates) until it's
 * confirmed or expires — enough to verify and replay the confirmation, nothing more.
 */

interface ScanRow {
  id: string;
  user_id: string;
  client_scan_id: string;
  status: ScanReview["status"];
  provider: string;
  development: number;
  review: string;
  created_at: string;
  expires_at: string;
  confirmed_at: string | null;
  confirm_key: string | null;
}

export function scanView(db: Db, row: ScanRow) {
  const review = JSON.parse(row.review) as ScanReview;
  return {
    id: row.id,
    clientScanId: row.client_scan_id,
    status: row.status,
    imageQuality: review.imageQuality,
    items: review.items,
    provider: { name: row.provider, development: row.development === 1 },
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    confirmedAt: row.confirmed_at,
    logs: row.confirmed_at ? scanLogs(db, row.user_id, row.id) : [],
  };
}

function ownScan(db: Db, userId: string, id: string): ScanRow {
  const row = db.prepare("SELECT * FROM food_scans WHERE id = ? AND user_id = ?").get(id, userId) as ScanRow | undefined;
  if (!row) throw new HttpError(404, "not_found", "Scan not found");
  return row;
}

/** Runs the provider with a hard deadline; the abort signal stops any in-flight request. */
async function recognizeWithDeadline(ctx: AppContext, image: { mimeType: PhotoMime; data: Uint8Array }) {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), ctx.config.foodRecognition.timeoutMs);
  });
  try {
    const outcome = await Promise.race([ctx.providers.food.recognize(image, { signal: controller.signal }), timeout]);
    if (outcome === "timeout") {
      controller.abort();
      throw new HttpError(504, "scan_timeout", "Food recognition took too long. Try again.", { retryable: true });
    }
    return outcome;
  } finally {
    clearTimeout(timer);
  }
}

export async function createScan(ctx: AppContext, userId: string, clientScanId: string, image: { mimeType: PhotoMime; base64: string }) {
  const { db } = ctx;
  // A retried upload (lost response) returns the original scan without calling the provider again.
  const existing = db.prepare("SELECT * FROM food_scans WHERE user_id = ? AND client_scan_id = ?").get(userId, clientScanId) as ScanRow | undefined;
  if (existing) return { created: false, scan: scanView(db, existing) };

  const provider = ctx.providers.food;
  if (provider.status().state !== "ready") {
    throw new HttpError(503, "food_scan_unavailable", "Food scanning isn't available right now. Log food by search, a label or your scale.", { retryable: false });
  }
  // A real recognition service receives the photo, so the user must have agreed first.
  if (!provider.development && !loadSettings(db, userId).foodScanConsent) {
    throw new HttpError(403, "scan_consent_required", "Scanning sends your meal photo to an outside recognition service. Allow it in Settings → Food scanner first.", { retryable: false });
  }
  // A retry while the first upload is still being recognised shares that one provider call.
  return ctx.flights.run(`scan:${userId}:${clientScanId}`, () => recognizeAndStore(ctx, userId, clientScanId, image));
}

/** Marks a ledger row `used` (the provider answered) or `released` (it didn't: the attempt doesn't count). */
function settleUsage(db: Db, id: string, state: "used" | "released"): void {
  db.prepare("UPDATE provider_usage_events SET state = ? WHERE id = ?").run(state, id);
}

async function recognizeAndStore(ctx: AppContext, userId: string, clientScanId: string, image: { mimeType: PhotoMime; base64: string }) {
  const { db } = ctx;
  const provider = ctx.providers.food;
  const now = ctx.now();

  // Everything up to the provider call is one synchronous step, so parallel requests can't all pass
  // the same check: each reserves its place in the usage ledger before the next one looks.
  // 1) The cheapest check first: a bad image costs the user nothing and the service nothing.
  // Validates type and size, strips EXIF/metadata. The bytes never touch the database or disk.
  const data = sanitizePhoto(image.mimeType, image.base64, SCAN_LIMITS.maxImageBytes);
  // 2) This user's own limits, counted from the ledger (reserved + used; discarding a scan can't refund them).
  const clock = userClock(ctx, userId);
  const counted = "state IN ('reserved', 'used')";
  if (!can(ctx, userId, "FOOD_SCANNER_PREMIUM")) {
    const limit = ctx.config.freeLimits.foodScansPerDay;
    if (scansToday(ctx, userId, clock.timezone, clock.today) >= limit) {
      throw proRequired("FOOD_SCANNER_PREMIUM", `You've used today's ${limit} free meal scans. Weighing, search and labels are always unlimited — or scan more with FORM Pro.`);
    }
  }
  const recent = (db.prepare(`SELECT COUNT(*) AS n FROM provider_usage_events WHERE user_id = ? AND kind = 'food_scan' AND created_at > ? AND ${counted}`).get(userId, new Date(now.getTime() - 3_600_000).toISOString()) as { n: number }).n;
  if (recent >= ctx.config.foodRecognition.scansPerHour) throw new HttpError(429, "scan_limit", "You've scanned a lot this hour. Try again later, or log food by search.");
  // 3) Reserve this user's place.
  const usageId = randomUUID();
  db.prepare("DELETE FROM provider_usage_events WHERE created_at < ?").run(new Date(now.getTime() - 7 * 86_400_000).toISOString());
  db.prepare("INSERT INTO provider_usage_events (id, user_id, kind, local_date, created_at, state) VALUES (?, ?, 'food_scan', ?, ?, 'reserved')").run(usageId, userId, clock.today, now.toISOString());
  // 4) Service-wide ceiling on paid recognition calls (the development sample costs nothing), last,
  // so a request that was going to be refused anyway never spends it.
  const paid = !provider.development;
  if (paid && !reserveProviderCall(db, "food_recognition", now, ctx.config.foodRecognition.globalPerDay)) {
    settleUsage(db, usageId, "released");
    ctx.log.warn({ provider: "food_recognition", limit: ctx.config.foodRecognition.globalPerDay }, "global daily recognition budget reached");
    throw new HttpError(503, "food_scan_unavailable", "Meal scanning has reached today's capacity. Log food by search, a label or your scale — scanning will be back tomorrow.", { retryable: false });
  }

  // From here the attempt can still fail: give the user's place (and, when nothing was billed, the
  // global call) back, so only scans that were actually recognised use up the allowance.
  let result;
  try {
    result = await recognizeWithDeadline(ctx, { mimeType: image.mimeType, data });
  } catch (e) {
    settleUsage(db, usageId, "released");
    // A timeout may still have been billed by the provider; anything else never reached it.
    if (paid && !(e instanceof HttpError && e.code === "scan_timeout")) refundProviderCall(db, "food_recognition", now);
    throw e;
  }
  if (!result.ok) {
    settleUsage(db, usageId, "released");
    if (paid) refundProviderCall(db, "food_recognition", now);
    // Say why in the logs (never the photo or the user): the app only shows a short message.
    ctx.log.warn({ provider: "food_recognition", code: result.code, detail: lastRecognitionFailure(ctx) }, result.message);
    throw providerFailure(result);
  }
  settleUsage(db, usageId, "used");

  const review = buildScanReview(result.value, VERIFIED_FOODS);
  const row: ScanRow = {
    id: randomUUID(),
    user_id: userId,
    client_scan_id: clientScanId,
    status: review.status,
    provider: provider.status().provider,
    development: provider.development ? 1 : 0,
    review: JSON.stringify(review),
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + SCAN_LIMITS.ttlMs).toISOString(),
    confirmed_at: null,
    confirm_key: null,
  };
  // Concurrent retries with the same client id: the unique index keeps one; return it.
  const inserted = db
    .prepare(
      `INSERT INTO food_scans (id, user_id, client_scan_id, status, provider, development, review, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, client_scan_id) DO NOTHING`,
    )
    .run(row.id, row.user_id, row.client_scan_id, row.status, row.provider, row.development, row.review, row.created_at, row.expires_at);
  const saved = inserted.changes === 1 ? row : (db.prepare("SELECT * FROM food_scans WHERE user_id = ? AND client_scan_id = ?").get(userId, clientScanId) as unknown as ScanRow);
  return { created: inserted.changes === 1, scan: scanView(db, saved) };
}

export function getScan(ctx: AppContext, userId: string, id: string) {
  return scanView(ctx.db, ownScan(ctx.db, userId, id));
}

export interface ConfirmInput {
  confirmKey: string;
  localDate?: string;
  mealType: MealType;
  mealName?: string | null;
  items: { itemId: string; remove?: boolean; optionKey?: string; foodId?: string; amount?: number }[];
}

/**
 * Confirms a reviewed scan into food logs, exactly once. The same `confirmKey` replays the result;
 * a different one after confirmation is refused. Nutrition comes from the stored review or the
 * catalog — the client only says which option, which food and how much.
 */
export function confirmScan(ctx: AppContext, userId: string, id: string, input: ConfirmInput, clock: UserClock) {
  const { db } = ctx;
  return transaction(db, () => {
    const row = ownScan(db, userId, id);
    if (row.confirmed_at) {
      if (row.confirm_key === input.confirmKey) return { duplicate: true, scan: scanView(db, row) };
      throw new HttpError(409, "scan_already_confirmed", "This scan has already been logged");
    }
    if (new Date(row.expires_at) <= ctx.now()) throw new HttpError(410, "scan_expired", "This scan has expired. Scan the meal again.");
    if (row.status !== "ok") throw new HttpError(422, "nothing_to_log", "This scan didn't find food to log");

    const review = JSON.parse(row.review) as ScanReview;
    const selections: ScanSelection[] = input.items.map((s) => {
      if (s.foodId === undefined) return { itemId: s.itemId, remove: s.remove, optionKey: s.optionKey, amount: s.amount };
      const food = findFood(db, userId, s.foodId);
      if (!food) throw new HttpError(404, "food_not_found", "That food isn't available", { itemId: s.itemId });
      return { itemId: s.itemId, remove: s.remove, food, amount: s.amount };
    });
    let entries;
    try {
      entries = resolveScanSelections(review, selections);
    } catch (e) {
      if (e instanceof ScanSelectionError) throw new HttpError(422, "invalid_selection", e.message, { itemId: e.itemId });
      throw e;
    }
    const logs = insertScanLogs(
      ctx,
      userId,
      { scanId: row.id, confirmKey: input.confirmKey, localDate: input.localDate ?? clock.today, mealType: input.mealType, mealName: input.mealName?.trim() || null, entries },
      clock,
    );
    const now = ctx.now().toISOString();
    db.prepare("UPDATE food_scans SET confirmed_at = ?, confirm_key = ? WHERE id = ? AND user_id = ?").run(now, input.confirmKey, row.id, userId);
    return { duplicate: false, scan: { ...scanView(db, { ...row, confirmed_at: now, confirm_key: input.confirmKey }), logs } };
  });
}

/** Discards a scan's stored review. Logs already created from it stay. */
export function discardScan(ctx: AppContext, userId: string, id: string): void {
  const r = ctx.db.prepare("DELETE FROM food_scans WHERE id = ? AND user_id = ?").run(id, userId);
  if (r.changes === 0) throw new HttpError(404, "not_found", "Scan not found");
}

/** Removes expired, unconfirmed scans (called opportunistically). */
export function pruneExpiredScans(db: Db, now: Date): void {
  db.prepare("DELETE FROM food_scans WHERE confirmed_at IS NULL AND expires_at <= ?").run(now.toISOString());
}

export { listUserFoods };
