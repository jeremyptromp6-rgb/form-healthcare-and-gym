import type { FoodItem } from "./food";

/**
 * Food search: every query word must start a word in the food's name or brand
 * ("chick bre" finds "Chicken breast"). Ranking: names starting with the query, then whole-word
 * matches, then the user's own foods, then shorter names.
 */

export function normalizeText(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

export const SEARCH_LIMITS = { minQueryLength: 1, maxQueryLength: 60, defaultResults: 20, maxResults: 50 } as const;

export function searchFoods<T extends FoodItem>(foods: readonly T[], query: string, limit: number = SEARCH_LIMITS.defaultResults): T[] {
  const q = normalizeText(query.slice(0, SEARCH_LIMITS.maxQueryLength));
  if (q.length < SEARCH_LIMITS.minQueryLength) return [];
  const tokens = q.split(" ");
  const scored: { food: T; score: number }[] = [];
  for (const food of foods) {
    const name = normalizeText(food.name);
    const words = normalizeText(`${food.name} ${food.brand ?? ""}`).split(" ");
    if (!tokens.every((t) => words.some((w) => w.startsWith(t)))) continue;
    let score = 0;
    if (name.startsWith(q)) score += 100;
    score += tokens.filter((t) => words.includes(t)).length * 10;
    if (food.origin === "user_food") score += 5;
    score -= name.length / 100;
    scored.push({ food, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.food.name.localeCompare(b.food.name))
    .slice(0, Math.min(limit, SEARCH_LIMITS.maxResults))
    .map((x) => x.food);
}
