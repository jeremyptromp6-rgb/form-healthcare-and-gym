import { ML_PER, type AmountBasis, type CountUnit, type Serving, type VolumeUnit } from "../nutrition/units";
import type { Allergen, DietPreference } from "../users/profileOptions";
import type { FoodItem } from "./food";

/**
 * FORM's verified reference database: common generic foods with standard nutrition values
 * (USDA FoodData Central generic entries, per 100 g, or per 100 ml for drinks). Branded products
 * are added by users from their labels (user foods). Values describe the food as listed
 * ("cooked", "raw", "dry") — the name always says which.
 *
 * Densities come from the same source's household measures (e.g. 1 cup cooked rice = 158 g), so a
 * cup of rice converts to exactly the grams the database lists for it. Drinks use their density
 * so they can be weighed. Foods without a density are only measured by weight.
 */

type Contains = "meat" | "poultry" | "fish" | "shellfish" | "dairy" | "egg" | "honey";

interface Row {
  id: string;
  name: string;
  basis?: AmountBasis;
  /** kcal, protein, carbs, fat per 100 g/ml. */
  m: [number, number, number, number];
  servings?: [string, number][];
  /** Grams in one household measure (from the reference's own measures), or a density in g/ml. */
  vol?: [VolumeUnit, number] | number;
  allergens?: Allergen[];
  contains?: Contains[];
}

const ROWS: Row[] = [
  // Poultry, meat, fish
  { id: "chicken_breast_cooked", name: "Chicken breast, skinless, cooked", m: [165, 31, 0, 3.6], servings: [["1 breast (172 g)", 172]], contains: ["poultry"] },
  { id: "chicken_breast_raw", name: "Chicken breast, skinless, raw", m: [120, 22.5, 0, 2.6], contains: ["poultry"] },
  { id: "chicken_thigh_cooked", name: "Chicken thigh, skinless, cooked", m: [209, 26, 0, 10.9], servings: [["1 thigh (52 g)", 52]], contains: ["poultry"] },
  { id: "ground_beef_90_cooked", name: "Ground beef 90% lean, cooked", m: [217, 26.1, 0, 11.7], servings: [["3 oz (85 g)", 85]], contains: ["meat"] },
  { id: "salmon_cooked", name: "Salmon, Atlantic, cooked", m: [206, 22.1, 0, 12.4], servings: [["1 fillet (154 g)", 154]], allergens: ["fish"], contains: ["fish"] },
  { id: "tuna_canned_water", name: "Tuna, light, canned in water, drained", m: [116, 25.5, 0, 0.8], servings: [["1 can drained (142 g)", 142]], allergens: ["fish"], contains: ["fish"] },
  { id: "cod_cooked", name: "Cod, Atlantic, cooked", m: [105, 22.8, 0, 0.9], servings: [["1 fillet (180 g)", 180]], allergens: ["fish"], contains: ["fish"] },
  { id: "shrimp_cooked", name: "Shrimp, cooked", m: [99, 24, 0.2, 0.3], servings: [["3 oz (85 g)", 85]], allergens: ["crustaceans"], contains: ["shellfish"] },

  // Eggs & dairy
  { id: "egg_whole", name: "Egg, whole, raw", m: [143, 12.6, 0.7, 9.5], servings: [["1 large egg (50 g)", 50]], allergens: ["eggs"], contains: ["egg"] },
  { id: "egg_white", name: "Egg white, raw", m: [52, 10.9, 0.7, 0.2], servings: [["1 large white (33 g)", 33]], allergens: ["eggs"], contains: ["egg"] },
  { id: "milk_whole", name: "Milk, whole (3.25%)", basis: "ml", vol: 1.03, m: [64, 3.3, 4.8, 3.6], servings: [["1 cup (240 ml)", 240], ["1 glass (200 ml)", 200]], allergens: ["milk"], contains: ["dairy"] },
  { id: "milk_skim", name: "Milk, skim", basis: "ml", vol: 1.035, m: [35, 3.4, 5, 0.1], servings: [["1 cup (240 ml)", 240]], allergens: ["milk"], contains: ["dairy"] },
  { id: "greek_yogurt_nonfat", name: "Greek yogurt, plain, nonfat", m: [59, 10.2, 3.6, 0.4], servings: [["1 container (170 g)", 170]], allergens: ["milk"], contains: ["dairy"] },
  { id: "greek_yogurt_whole", name: "Greek yogurt, plain, whole milk", m: [97, 9, 4, 5], servings: [["1 container (170 g)", 170]], allergens: ["milk"], contains: ["dairy"] },
  { id: "cottage_cheese_2", name: "Cottage cheese, 2% fat", m: [81, 10.5, 4.8, 2.3], servings: [["½ cup (113 g)", 113]], vol: ["cup", 226], allergens: ["milk"], contains: ["dairy"] },
  { id: "cheddar", name: "Cheddar cheese", m: [403, 24.9, 1.3, 33.1], servings: [["1 slice (28 g)", 28]], allergens: ["milk"], contains: ["dairy"] },
  { id: "feta", name: "Feta cheese", m: [264, 14.2, 4.1, 21.3], servings: [["1 oz (28 g)", 28]], allergens: ["milk"], contains: ["dairy"] },
  { id: "soy_milk", name: "Soy milk, unsweetened", basis: "ml", vol: 1.03, m: [33, 2.9, 1.7, 1.6], servings: [["1 cup (240 ml)", 240]], allergens: ["soy"] },
  { id: "butter", name: "Butter, salted", m: [717, 0.9, 0.1, 81.1], servings: [["1 tbsp (14 g)", 14]], vol: ["tbsp", 14], allergens: ["milk"], contains: ["dairy"] },

  // Grains & starches
  { id: "oats_dry", name: "Oats, rolled, dry", m: [379, 13.2, 67.7, 6.5], servings: [["½ cup (40 g)", 40]], vol: ["cup", 80] },
  { id: "rice_white_cooked", name: "Rice, white, cooked", m: [130, 2.7, 28.2, 0.3], servings: [["1 cup (158 g)", 158]], vol: ["cup", 158] },
  { id: "rice_brown_cooked", name: "Rice, brown, cooked", m: [123, 2.7, 25.6, 1], servings: [["1 cup (195 g)", 195]], vol: ["cup", 195] },
  { id: "pasta_cooked", name: "Pasta, cooked", m: [158, 5.8, 30.9, 0.9], servings: [["1 cup (140 g)", 140]], vol: ["cup", 140], allergens: ["gluten"] },
  { id: "quinoa_cooked", name: "Quinoa, cooked", m: [120, 4.4, 21.3, 1.9], servings: [["1 cup (185 g)", 185]], vol: ["cup", 185] },
  { id: "bread_whole_wheat", name: "Bread, whole wheat", m: [252, 12.4, 42.7, 3.5], servings: [["1 slice (32 g)", 32]], allergens: ["gluten"] },
  { id: "bread_white", name: "Bread, white", m: [266, 7.6, 50.6, 3.3], servings: [["1 slice (25 g)", 25]], allergens: ["gluten"] },
  { id: "potato_baked", name: "Potato, baked, with skin", m: [93, 2.5, 21.2, 0.1], servings: [["1 medium (173 g)", 173]] },
  { id: "sweet_potato_baked", name: "Sweet potato, baked, with skin", m: [90, 2, 20.7, 0.2], servings: [["1 medium (114 g)", 114]] },

  // Legumes & plant protein
  { id: "lentils_cooked", name: "Lentils, cooked", m: [116, 9, 20.1, 0.4], servings: [["1 cup (198 g)", 198]], vol: ["cup", 198] },
  { id: "chickpeas_cooked", name: "Chickpeas, cooked", m: [164, 8.9, 27.4, 2.6], servings: [["1 cup (164 g)", 164]], vol: ["cup", 164] },
  { id: "black_beans_cooked", name: "Black beans, cooked", m: [132, 8.9, 23.7, 0.5], servings: [["1 cup (172 g)", 172]], vol: ["cup", 172] },
  { id: "tofu_firm", name: "Tofu, firm", m: [144, 17.3, 2.8, 8.7], servings: [["½ block (126 g)", 126]], allergens: ["soy"] },
  { id: "hummus", name: "Hummus", m: [166, 7.9, 14.3, 9.6], servings: [["2 tbsp (30 g)", 30]], vol: ["tbsp", 15], allergens: ["sesame"] },

  // Fruit
  { id: "banana", name: "Banana, raw", m: [89, 1.1, 22.8, 0.3], servings: [["1 medium (118 g)", 118]] },
  { id: "apple", name: "Apple, raw, with skin", m: [52, 0.3, 13.8, 0.2], servings: [["1 medium (182 g)", 182]] },
  { id: "orange", name: "Orange, raw", m: [47, 0.9, 11.8, 0.1], servings: [["1 medium (131 g)", 131]] },
  { id: "blueberries", name: "Blueberries, raw", m: [57, 0.7, 14.5, 0.3], servings: [["1 cup (148 g)", 148]], vol: ["cup", 148] },
  { id: "strawberries", name: "Strawberries, raw", m: [32, 0.7, 7.7, 0.3], servings: [["1 cup (144 g)", 144]] },
  { id: "avocado", name: "Avocado, raw", m: [160, 2, 8.5, 14.7], servings: [["½ avocado (68 g)", 68]] },

  // Vegetables
  { id: "broccoli_cooked", name: "Broccoli, boiled", m: [35, 2.4, 7.2, 0.4], servings: [["1 cup (156 g)", 156]], vol: ["cup", 156] },
  { id: "spinach_raw", name: "Spinach, raw", m: [23, 2.9, 3.6, 0.4], servings: [["1 cup (30 g)", 30]], vol: ["cup", 30] },
  { id: "carrot_raw", name: "Carrot, raw", m: [41, 0.9, 9.6, 0.2], servings: [["1 medium (61 g)", 61]] },
  { id: "tomato_raw", name: "Tomato, raw", m: [18, 0.9, 3.9, 0.2], servings: [["1 medium (123 g)", 123]] },
  { id: "tomatoes_canned", name: "Tomatoes, canned, chopped", m: [32, 1.6, 7.3, 0.3], servings: [["1 can (400 g)", 400]] },
  { id: "onion_raw", name: "Onion, raw", m: [40, 1.1, 9.3, 0.1], servings: [["1 medium (110 g)", 110]] },
  { id: "garlic_raw", name: "Garlic, raw", m: [149, 6.4, 33.1, 0.5], servings: [["1 clove (3 g)", 3]] },
  { id: "bell_pepper_raw", name: "Bell pepper, red, raw", m: [31, 1, 6, 0.3], servings: [["1 medium (119 g)", 119]] },
  { id: "cucumber_raw", name: "Cucumber, raw, with peel", m: [15, 0.7, 3.6, 0.1], servings: [["1 cup sliced (104 g)", 104]] },
  { id: "lettuce_romaine", name: "Lettuce, romaine, raw", m: [17, 1.2, 3.3, 0.3], servings: [["1 cup shredded (47 g)", 47]] },
  { id: "peas_cooked", name: "Peas, green, frozen, cooked", m: [78, 5.2, 14.3, 0.2], servings: [["1 cup (160 g)", 160]], vol: ["cup", 160] },
  { id: "lemon_juice", name: "Lemon juice, raw", m: [22, 0.4, 6.9, 0.2], servings: [["1 tbsp (15 g)", 15]], vol: ["tbsp", 15] },

  // Nuts, seeds, fats
  { id: "almonds", name: "Almonds", m: [579, 21.2, 21.6, 49.9], servings: [["1 oz (28 g)", 28]], allergens: ["tree_nuts"] },
  { id: "walnuts", name: "Walnuts", m: [654, 15.2, 13.7, 65.2], servings: [["1 oz (28 g)", 28]], allergens: ["tree_nuts"] },
  { id: "peanut_butter", name: "Peanut butter, smooth", m: [588, 25.1, 19.6, 50.4], servings: [["1 tbsp (16 g)", 16]], vol: ["tbsp", 16], allergens: ["peanuts"] },
  { id: "chia_seeds", name: "Chia seeds", m: [486, 16.5, 42.1, 30.7], servings: [["1 tbsp (12 g)", 12]], vol: ["tbsp", 12] },
  { id: "olive_oil", name: "Olive oil", m: [884, 0, 0, 100], servings: [["1 tbsp (13.5 g)", 13.5]], vol: ["tbsp", 13.5] },

  // Other
  { id: "honey", name: "Honey", m: [304, 0.3, 82.4, 0], servings: [["1 tbsp (21 g)", 21]], vol: ["tbsp", 21], contains: ["honey"] },
  { id: "dark_chocolate", name: "Dark chocolate, 70–85% cocoa", m: [598, 7.8, 45.9, 42.6], servings: [["1 square (10 g)", 10]] },
  { id: "orange_juice", name: "Orange juice", basis: "ml", vol: 1.04, m: [45, 0.7, 10.4, 0.2], servings: [["1 cup (240 ml)", 240]] },
  { id: "soy_sauce", name: "Soy sauce", m: [53, 8.1, 4.9, 0.6], servings: [["1 tbsp (16 g)", 16]], vol: ["tbsp", 16], allergens: ["soy", "gluten"] },
  { id: "coffee_black", name: "Coffee, brewed, black", basis: "ml", vol: 1, m: [1, 0.1, 0, 0], servings: [["1 cup (240 ml)", 240]] },
];

const ANIMAL = new Set<Contains>(["meat", "poultry", "fish", "shellfish"]);

/** Restrictions a food is known to satisfy, from what it contains. Halal/kosher are only claimed for plant foods. */
function suitableFor(r: Row): DietPreference[] {
  const c = new Set(r.contains ?? []);
  const out: DietPreference[] = [];
  const plantOnly = c.size === 0;
  if (plantOnly) out.push("vegan", "halal", "kosher");
  if (![...c].some((x) => ANIMAL.has(x))) out.push("vegetarian");
  if (!c.has("meat") && !c.has("poultry")) out.push("pescatarian");
  if (!c.has("dairy")) out.push("dairy_free");
  if (!(r.allergens ?? []).includes("gluten")) out.push("gluten_free");
  return [...new Set(out)];
}

/** A serving that is one natural piece (a banana, an egg, a slice) or one packaged item (a can, a container). */
export function servingKind(label: string): CountUnit {
  if (/^1 (can|container|bottle|bar|packet|pot)\b/i.test(label)) return "item";
  if (/^1 (small|medium|large|breast|thigh|fillet|slice|square|egg)\b/i.test(label)) return "piece";
  return "serving";
}

function densityOf(r: Row): number | undefined {
  if (r.vol === undefined) return undefined;
  if (typeof r.vol === "number") return r.vol;
  const [unit, grams] = r.vol;
  return grams / ML_PER[unit];
}


export const VERIFIED_FOOD_PREFIX = "fdb:";

export const VERIFIED_FOODS: readonly FoodItem[] = ROWS.map((r) => {
  const basis = r.basis ?? "g";
  const [kcal, proteinG, carbsG, fatG] = r.m;
  const servings: Serving[] = (r.servings ?? []).map(([label, amount], i) => ({ id: `s${i + 1}`, label, amount, kind: servingKind(label) }));
  const gramsPerMl = densityOf(r);
  return {
    id: `${VERIFIED_FOOD_PREFIX}${r.id}`,
    name: r.name,
    brand: null,
    basis,
    per100: { kcal, proteinG, carbsG, fatG },
    servings,
    ...(gramsPerMl ? { gramsPerMl } : {}),
    origin: "verified_database",
    allergens: r.allergens ?? [],
    suitableFor: suitableFor(r),
  };
});

const BY_ID = new Map(VERIFIED_FOODS.map((f) => [f.id, f]));

export function verifiedFood(id: string): FoodItem | null {
  return BY_ID.get(id) ?? null;
}
