import type { NutritionTarget, NutritionTargets } from "@form/domain";
import type { Db } from "../../db";

interface TargetRow {
  effective_from: string;
  bmr_kcal: number;
  tdee_kcal: number;
  target_kcal: number;
  safe_floor_kcal: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  applied_goal: NutritionTarget["appliedGoal"];
  diet_styles: string;
}

const COLUMNS = "effective_from, bmr_kcal, tdee_kcal, target_kcal, safe_floor_kcal, protein_g, carbs_g, fat_g, applied_goal, diet_styles";

function toModel(r: TargetRow): NutritionTarget {
  return {
    effectiveFrom: r.effective_from,
    bmrKcal: r.bmr_kcal,
    tdeeKcal: r.tdee_kcal,
    targetKcal: r.target_kcal,
    safeFloorKcal: r.safe_floor_kcal,
    proteinG: r.protein_g,
    carbsG: r.carbs_g,
    fatG: r.fat_g,
    appliedGoal: r.applied_goal,
    dietStyles: JSON.parse(r.diet_styles) as string[],
  };
}

/** Records the targets in force from `effectiveFrom`. Saving twice on one day keeps the latest. */
export function saveTargetSnapshot(db: Db, userId: string, effectiveFrom: string, t: NutritionTargets, now: Date): void {
  db.prepare(
    `INSERT INTO nutrition_targets (user_id, ${COLUMNS}, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, effective_from) DO UPDATE SET bmr_kcal = excluded.bmr_kcal, tdee_kcal = excluded.tdee_kcal,
       target_kcal = excluded.target_kcal, safe_floor_kcal = excluded.safe_floor_kcal, protein_g = excluded.protein_g,
       carbs_g = excluded.carbs_g, fat_g = excluded.fat_g, applied_goal = excluded.applied_goal, diet_styles = excluded.diet_styles,
       created_at = excluded.created_at`,
  ).run(
    userId,
    effectiveFrom,
    t.bmrKcal,
    t.tdeeKcal,
    t.targetKcal,
    t.safeFloorKcal,
    t.proteinG,
    t.carbsG,
    t.fatG,
    t.appliedGoal,
    JSON.stringify(t.dietStyles),
    now.toISOString(),
  );
}

/** The snapshot in force on `date` (see domain `targetForDate`), queried directly. */
export function targetOn(db: Db, userId: string, date: string): NutritionTarget | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM nutrition_targets WHERE user_id = ? AND effective_from <= ? ORDER BY effective_from DESC LIMIT 1`)
    .get(userId, date) as TargetRow | undefined;
  return row ? toModel(row) : null;
}

export function hasAnyTarget(db: Db, userId: string): boolean {
  return db.prepare("SELECT 1 FROM nutrition_targets WHERE user_id = ? LIMIT 1").get(userId) !== undefined;
}
