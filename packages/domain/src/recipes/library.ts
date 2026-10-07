import { calculatePortion, presentMacros, sumNutrients } from "../nutrition/calculation";
import type { MealType } from "../nutrition/foodLog";
import type { Macros } from "../nutrition/nutritionCalculator";
import type { FoodItem } from "../food/food";
import { verifiedFood } from "../food/catalog";
import type { Allergen, DietPreference } from "../users/profileOptions";

/**
 * FORM's recipe library — simple, everyday recipes written as structured data on top of the
 * verified food database. Nothing about a recipe's nutrition, allergens or diet suitability is
 * typed in: it is all derived from its ingredients (catalog foods, USDA reference values) with the
 * NutritionCalculator. There are no prices — only a relative cost tier per ingredient
 * (1 = low, 3 = high), so plans can respect a budget preference without inventing numbers.
 *
 * Seasonings with no meaningful energy (salt, pepper, dried herbs and spices, water) are listed as
 * pantry items: shown and checked against custom allergies, not counted in nutrition.
 */

export type Aisle = "protein" | "carbohydrates" | "produce" | "other";

interface Ing {
  food: string;
  amount: number;
  unit?: "g" | "ml";
  note?: string;
}

interface RecipeData {
  id: string;
  title: string;
  slots: MealType[];
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  ingredients: Ing[];
  pantry?: string[];
  steps: string[];
  styles?: DietPreference[];
}

/** Relative cost tier per ingredient (not a price). Unlisted foods count as 2. */
const COST: Record<string, 1 | 2 | 3> = {
  oats_dry: 1, rice_white_cooked: 1, rice_brown_cooked: 1, pasta_cooked: 1, bread_whole_wheat: 1, potato_baked: 1, sweet_potato_baked: 1,
  lentils_cooked: 1, chickpeas_cooked: 1, black_beans_cooked: 1, egg_whole: 1, banana: 1, apple: 1, carrot_raw: 1, onion_raw: 1, garlic_raw: 1,
  tomatoes_canned: 1, peas_cooked: 1, milk_skim: 1, peanut_butter: 1, tuna_canned_water: 1, soy_sauce: 1, lemon_juice: 1, orange: 1,
  chicken_thigh_cooked: 1,
  salmon_cooked: 3, shrimp_cooked: 3, cod_cooked: 3, almonds: 3, walnuts: 3, blueberries: 3, dark_chocolate: 3,
};

/** Grocery aisle per ingredient. Unlisted foods go to "other". */
const AISLE: Record<string, Aisle> = {
  chicken_breast_cooked: "protein", chicken_thigh_cooked: "protein", ground_beef_90_cooked: "protein", salmon_cooked: "protein", tuna_canned_water: "protein",
  cod_cooked: "protein", shrimp_cooked: "protein", egg_whole: "protein", egg_white: "protein", tofu_firm: "protein", lentils_cooked: "protein",
  chickpeas_cooked: "protein", black_beans_cooked: "protein", greek_yogurt_nonfat: "protein", greek_yogurt_whole: "protein", cottage_cheese_2: "protein",
  oats_dry: "carbohydrates", rice_white_cooked: "carbohydrates", rice_brown_cooked: "carbohydrates", pasta_cooked: "carbohydrates", quinoa_cooked: "carbohydrates",
  bread_whole_wheat: "carbohydrates", bread_white: "carbohydrates", potato_baked: "carbohydrates", sweet_potato_baked: "carbohydrates",
  banana: "produce", apple: "produce", orange: "produce", blueberries: "produce", strawberries: "produce", avocado: "produce", broccoli_cooked: "produce",
  spinach_raw: "produce", carrot_raw: "produce", tomato_raw: "produce", tomatoes_canned: "produce", onion_raw: "produce", garlic_raw: "produce",
  bell_pepper_raw: "produce", cucumber_raw: "produce", lettuce_romaine: "produce", peas_cooked: "produce",
};

export function aisleOf(foodId: string): Aisle {
  return AISLE[foodId.replace(/^fdb:/, "")] ?? "other";
}

const g = (food: string, amount: number, note?: string): Ing => ({ food, amount, unit: "g", ...(note ? { note } : {}) });
const ml = (food: string, amount: number): Ing => ({ food, amount, unit: "ml" });

const DATA: RecipeData[] = [
  // ---- Breakfast ---------------------------------------------------------------------------
  {
    id: "overnight_oats_berries", title: "Overnight oats with blueberries", slots: ["breakfast"], servings: 1, prepMinutes: 5, cookMinutes: 0,
    ingredients: [g("oats_dry", 50), ml("milk_skim", 150), g("greek_yogurt_nonfat", 100), g("blueberries", 80), g("chia_seeds", 10), g("honey", 7)],
    steps: ["Stir the oats, milk, yogurt, chia and honey together in a jar.", "Cover and chill overnight (at least 4 hours).", "Top with the blueberries before eating."],
  },
  {
    id: "pb_banana_oats", title: "Peanut butter banana oats", slots: ["breakfast"], servings: 1, prepMinutes: 2, cookMinutes: 5,
    ingredients: [g("oats_dry", 60), ml("soy_milk", 250), g("banana", 118), g("peanut_butter", 16)], pantry: ["cinnamon"],
    steps: ["Simmer the oats in the soy milk for 4–5 minutes, stirring, until creamy.", "Slice the banana on top and add the peanut butter and a pinch of cinnamon."],
  },
  {
    id: "eggs_spinach_toast", title: "Scrambled eggs and spinach on toast", slots: ["breakfast"], servings: 1, prepMinutes: 3, cookMinutes: 7,
    ingredients: [g("egg_whole", 150, "3 large eggs"), g("bread_whole_wheat", 64, "2 slices"), g("spinach_raw", 30), g("butter", 5)], pantry: ["salt", "black pepper"],
    steps: ["Toast the bread.", "Melt the butter in a pan over low heat, add the spinach until it wilts.", "Add the beaten eggs and stir gently until just set. Season and serve on the toast."],
  },
  {
    id: "yogurt_strawberry_walnut", title: "Greek yogurt with strawberries and walnuts", slots: ["breakfast", "snack"], servings: 1, prepMinutes: 5, cookMinutes: 0,
    ingredients: [g("greek_yogurt_nonfat", 200), g("strawberries", 100), g("walnuts", 15), g("honey", 10)],
    steps: ["Spoon the yogurt into a bowl.", "Top with sliced strawberries, chopped walnuts and a drizzle of honey."],
  },
  {
    id: "tofu_scramble", title: "Tofu scramble with peppers", slots: ["breakfast"], servings: 1, prepMinutes: 5, cookMinutes: 10,
    ingredients: [g("tofu_firm", 150), g("bell_pepper_raw", 60), g("onion_raw", 40), g("spinach_raw", 30), g("olive_oil", 5), g("bread_whole_wheat", 32, "1 slice")],
    pantry: ["salt", "black pepper", "turmeric"],
    steps: ["Soften the onion and pepper in the oil for 4 minutes.", "Crumble in the tofu with a pinch of turmeric and cook for 4 minutes.", "Stir in the spinach until wilted. Season and serve with toast."],
  },
  {
    id: "avocado_egg_toast", title: "Avocado toast with a poached egg", slots: ["breakfast", "lunch"], servings: 1, prepMinutes: 5, cookMinutes: 5,
    ingredients: [g("bread_whole_wheat", 64, "2 slices"), g("avocado", 68, "½ avocado"), g("egg_whole", 50, "1 large egg"), g("tomato_raw", 60), g("lemon_juice", 5)],
    pantry: ["salt", "black pepper"],
    steps: ["Poach the egg in simmering water for 3–4 minutes.", "Toast the bread; mash the avocado with the lemon juice and a pinch of salt.", "Spread on the toast, add sliced tomato and the egg."],
    styles: ["mediterranean"],
  },
  {
    id: "cottage_cheese_apple", title: "Cottage cheese with apple and cinnamon", slots: ["breakfast", "snack"], servings: 1, prepMinutes: 3, cookMinutes: 0,
    ingredients: [g("cottage_cheese_2", 200), g("apple", 150), g("walnuts", 10)], pantry: ["cinnamon"],
    steps: ["Dice the apple.", "Top the cottage cheese with the apple, chopped walnuts and a pinch of cinnamon."],
  },

  // ---- Lunch ---------------------------------------------------------------------------------
  {
    id: "chicken_quinoa_bowl", title: "Chicken, quinoa and roast veg bowl", slots: ["lunch", "dinner"], servings: 2, prepMinutes: 10, cookMinutes: 20,
    ingredients: [g("chicken_breast_cooked", 300), g("quinoa_cooked", 370), g("broccoli_cooked", 200), g("bell_pepper_raw", 120), g("olive_oil", 14), g("lemon_juice", 20)],
    pantry: ["salt", "black pepper", "paprika"],
    steps: ["Roast the pepper and broccoli with half the oil at 200 °C for 18–20 minutes.", "Slice the cooked chicken.", "Divide the quinoa, vegetables and chicken between two bowls; dress with lemon juice and the rest of the oil."],
    styles: ["high_protein"],
  },
  {
    id: "tuna_chickpea_salad", title: "Tuna and chickpea salad", slots: ["lunch"], servings: 2, prepMinutes: 10, cookMinutes: 0,
    ingredients: [g("tuna_canned_water", 142, "1 can, drained"), g("chickpeas_cooked", 164), g("cucumber_raw", 100), g("tomato_raw", 120), g("lettuce_romaine", 60), g("olive_oil", 10), g("lemon_juice", 15)],
    pantry: ["salt", "black pepper"],
    steps: ["Chop the cucumber, tomato and lettuce.", "Toss with the drained chickpeas and flaked tuna.", "Dress with the oil and lemon juice; season."],
    styles: ["mediterranean", "high_protein"],
  },
  {
    id: "red_lentil_soup", title: "Red lentil and tomato soup", slots: ["lunch", "dinner"], servings: 4, prepMinutes: 10, cookMinutes: 25,
    ingredients: [g("lentils_cooked", 600), g("tomatoes_canned", 400), g("onion_raw", 150), g("carrot_raw", 120), g("garlic_raw", 10), g("olive_oil", 15)],
    pantry: ["salt", "black pepper", "cumin", "water"],
    steps: ["Soften the chopped onion, carrot and garlic in the oil for 8 minutes.", "Add the cumin, tomatoes, lentils and 500 ml water; simmer for 15 minutes.", "Blend until smooth (or leave chunky) and season."],
    styles: ["mediterranean"],
  },
  {
    id: "hummus_veg_sandwich", title: "Hummus and crunchy veg sandwich", slots: ["lunch"], servings: 1, prepMinutes: 5, cookMinutes: 0,
    ingredients: [g("bread_whole_wheat", 64, "2 slices"), g("hummus", 60), g("cucumber_raw", 50), g("tomato_raw", 60), g("spinach_raw", 20), g("carrot_raw", 40)],
    steps: ["Spread both slices with hummus.", "Layer the spinach, sliced cucumber and tomato, and grated carrot. Close and cut."],
  },
  {
    id: "chickpea_spinach_stew", title: "Chickpea and spinach stew with brown rice", slots: ["lunch", "dinner"], servings: 3, prepMinutes: 10, cookMinutes: 25,
    ingredients: [g("chickpeas_cooked", 400), g("tomatoes_canned", 400), g("spinach_raw", 120), g("onion_raw", 120), g("garlic_raw", 10), g("olive_oil", 15), g("rice_brown_cooked", 450)],
    pantry: ["salt", "paprika", "cumin"],
    steps: ["Soften the onion and garlic in the oil for 6 minutes; add the spices.", "Add the tomatoes and chickpeas and simmer for 15 minutes.", "Stir in the spinach until wilted. Serve with the rice."],
    styles: ["mediterranean"],
  },
  {
    id: "greek_salad_chicken", title: "Greek salad with chicken", slots: ["lunch", "dinner"], servings: 1, prepMinutes: 10, cookMinutes: 0,
    ingredients: [g("chicken_breast_cooked", 150), g("cucumber_raw", 120), g("tomato_raw", 150), g("lettuce_romaine", 80), g("feta", 40), g("olive_oil", 10), g("lemon_juice", 10)],
    pantry: ["dried oregano", "black pepper"],
    steps: ["Chop the vegetables and slice the chicken.", "Toss with crumbled feta, oil, lemon juice and oregano."],
    styles: ["mediterranean", "high_protein", "low_carb"],
  },
  {
    id: "egg_fried_rice", title: "Egg fried rice with peas", slots: ["lunch", "dinner"], servings: 2, prepMinutes: 5, cookMinutes: 12,
    ingredients: [g("rice_white_cooked", 400), g("egg_whole", 150, "3 large eggs"), g("peas_cooked", 150), g("carrot_raw", 80), g("soy_sauce", 20), g("olive_oil", 14)],
    steps: ["Fry the diced carrot in the oil for 3 minutes.", "Push to one side, scramble the eggs, then add the rice and peas.", "Stir-fry for 4 minutes and season with soy sauce."],
  },

  // ---- Dinner --------------------------------------------------------------------------------
  {
    id: "salmon_potato_broccoli", title: "Baked salmon with potatoes and broccoli", slots: ["dinner"], servings: 2, prepMinutes: 10, cookMinutes: 30,
    ingredients: [g("salmon_cooked", 300), g("potato_baked", 400), g("broccoli_cooked", 300), g("olive_oil", 14), g("lemon_juice", 15)],
    pantry: ["salt", "black pepper", "dried dill"],
    steps: ["Roast the halved potatoes with the oil at 200 °C for 30 minutes.", "Add the salmon for the last 12–15 minutes; steam the broccoli.", "Finish with lemon juice and dill."],
    styles: ["mediterranean", "high_protein"],
  },
  {
    id: "chicken_veg_stir_fry", title: "Chicken and vegetable stir-fry with rice", slots: ["dinner"], servings: 2, prepMinutes: 10, cookMinutes: 15,
    ingredients: [g("chicken_breast_cooked", 300), g("rice_white_cooked", 316), g("bell_pepper_raw", 150), g("broccoli_cooked", 150), g("carrot_raw", 80), g("soy_sauce", 30), g("garlic_raw", 6), g("olive_oil", 14)],
    steps: ["Stir-fry the garlic and vegetables in the oil for 5 minutes.", "Add the sliced chicken and soy sauce; toss for 3 minutes.", "Serve over the rice."],
    styles: ["high_protein"],
  },
  {
    id: "beef_bolognese", title: "Lean beef bolognese", slots: ["dinner"], servings: 4, prepMinutes: 10, cookMinutes: 30,
    ingredients: [g("ground_beef_90_cooked", 400), g("pasta_cooked", 560), g("tomatoes_canned", 400), g("onion_raw", 150), g("carrot_raw", 100), g("garlic_raw", 10), g("olive_oil", 14)],
    pantry: ["dried oregano", "salt", "black pepper"],
    steps: ["Soften the onion, carrot and garlic in the oil for 8 minutes.", "Add the browned beef and tomatoes; simmer for 20 minutes.", "Serve over the pasta."],
    styles: ["high_protein"],
  },
  {
    id: "tofu_broccoli_stir_fry", title: "Tofu and broccoli stir-fry with brown rice", slots: ["dinner"], servings: 2, prepMinutes: 10, cookMinutes: 15,
    ingredients: [g("tofu_firm", 300), g("broccoli_cooked", 250), g("bell_pepper_raw", 120), g("rice_brown_cooked", 390), g("soy_sauce", 30), g("garlic_raw", 6), g("olive_oil", 14)],
    steps: ["Pan-fry the cubed tofu in half the oil until golden, about 8 minutes.", "Stir-fry the garlic, broccoli and pepper in the rest of the oil for 4 minutes.", "Toss everything with the soy sauce and serve with the rice."],
  },
  {
    id: "sweet_potato_black_bean_bowl", title: "Sweet potato and black bean bowl", slots: ["lunch", "dinner"], servings: 2, prepMinutes: 10, cookMinutes: 30,
    ingredients: [g("sweet_potato_baked", 400), g("black_beans_cooked", 344), g("avocado", 68), g("tomato_raw", 120), g("onion_raw", 60), g("lemon_juice", 15), g("olive_oil", 10)],
    pantry: ["cumin", "salt"],
    steps: ["Roast the cubed sweet potato with the oil and cumin at 200 °C for 30 minutes.", "Warm the beans; dice the tomato, onion and avocado.", "Build the bowls and squeeze over the lemon juice."],
  },
  {
    id: "lemon_cod_quinoa", title: "Lemon cod with quinoa and spinach", slots: ["dinner"], servings: 2, prepMinutes: 5, cookMinutes: 20,
    ingredients: [g("cod_cooked", 360), g("quinoa_cooked", 370), g("spinach_raw", 120), g("olive_oil", 14), g("lemon_juice", 20), g("garlic_raw", 6)],
    pantry: ["salt", "black pepper"],
    steps: ["Bake the cod with half the oil and lemon at 200 °C for 12–15 minutes.", "Wilt the spinach with the garlic in the rest of the oil.", "Serve the cod over the quinoa and spinach."],
    styles: ["mediterranean", "high_protein"],
  },
  {
    id: "garlic_shrimp_pasta", title: "Garlic shrimp pasta with spinach", slots: ["dinner"], servings: 2, prepMinutes: 10, cookMinutes: 15,
    ingredients: [g("shrimp_cooked", 250), g("pasta_cooked", 280), g("spinach_raw", 100), g("tomato_raw", 150), g("garlic_raw", 10), g("olive_oil", 20)],
    pantry: ["chilli flakes", "salt"],
    steps: ["Warm the garlic and chilli in the oil for 1 minute.", "Add the tomatoes and shrimp; cook for 3 minutes.", "Toss with the pasta and spinach until it wilts."],
    styles: ["mediterranean"],
  },
  {
    id: "chicken_thigh_sweet_potato", title: "Roast chicken thighs with sweet potato and greens", slots: ["dinner"], servings: 2, prepMinutes: 5, cookMinutes: 35,
    ingredients: [g("chicken_thigh_cooked", 300), g("sweet_potato_baked", 400), g("spinach_raw", 100), g("olive_oil", 10)],
    pantry: ["paprika", "salt", "black pepper"],
    steps: ["Roast the thighs and cubed sweet potato with the oil and paprika at 200 °C for 35 minutes.", "Wilt the spinach and serve alongside."],
  },
  {
    id: "lentil_bolognese", title: "Lentil bolognese", slots: ["dinner"], servings: 4, prepMinutes: 10, cookMinutes: 25,
    ingredients: [g("lentils_cooked", 500), g("pasta_cooked", 560), g("tomatoes_canned", 400), g("onion_raw", 150), g("carrot_raw", 100), g("garlic_raw", 10), g("olive_oil", 14)],
    pantry: ["dried oregano", "salt", "black pepper"],
    steps: ["Soften the onion, carrot and garlic in the oil for 8 minutes.", "Add the lentils and tomatoes; simmer for 15 minutes.", "Serve over the pasta."],
    styles: ["mediterranean"],
  },

  // ---- Snacks --------------------------------------------------------------------------------
  {
    id: "apple_peanut_butter", title: "Apple with peanut butter", slots: ["snack"], servings: 1, prepMinutes: 2, cookMinutes: 0,
    ingredients: [g("apple", 182), g("peanut_butter", 32)],
    steps: ["Slice the apple and serve with the peanut butter."],
  },
  {
    id: "yogurt_blueberries", title: "Greek yogurt with blueberries", slots: ["snack"], servings: 1, prepMinutes: 2, cookMinutes: 0,
    ingredients: [g("greek_yogurt_nonfat", 170), g("blueberries", 75)],
    steps: ["Top the yogurt with the blueberries."],
    styles: ["high_protein"],
  },
  {
    id: "hummus_veg_sticks", title: "Hummus with carrot and cucumber sticks", slots: ["snack"], servings: 1, prepMinutes: 5, cookMinutes: 0,
    ingredients: [g("hummus", 60), g("carrot_raw", 120), g("cucumber_raw", 80)],
    steps: ["Cut the vegetables into sticks and serve with the hummus."],
    styles: ["mediterranean"],
  },
  {
    id: "banana_almonds", title: "Banana and almonds", slots: ["snack"], servings: 1, prepMinutes: 1, cookMinutes: 0,
    ingredients: [g("banana", 118), g("almonds", 20)],
    steps: ["Enjoy together."],
  },
  {
    id: "boiled_eggs_tomato", title: "Boiled eggs with tomato", slots: ["snack"], servings: 1, prepMinutes: 2, cookMinutes: 10,
    ingredients: [g("egg_whole", 100, "2 large eggs"), g("tomato_raw", 100)], pantry: ["salt", "black pepper"],
    steps: ["Boil the eggs for 9 minutes, then cool in cold water.", "Peel and serve with sliced tomato."],
    styles: ["low_carb", "high_protein"],
  },
  {
    id: "roasted_chickpeas", title: "Crispy roasted chickpeas", slots: ["snack"], servings: 2, prepMinutes: 5, cookMinutes: 30,
    ingredients: [g("chickpeas_cooked", 240), g("olive_oil", 8)], pantry: ["paprika", "salt"],
    steps: ["Pat the chickpeas dry and toss with the oil, paprika and salt.", "Roast at 200 °C for 25–30 minutes, shaking halfway."],
  },
];

// ---- Built recipes ---------------------------------------------------------------------------

export interface RecipeIngredientLine {
  foodId: string;
  name: string;
  /** For the whole recipe, in the food's own unit (g, or ml for drinks). */
  amount: number;
  unit: "g" | "ml";
  note: string | null;
  aisle: Aisle;
  /** Full-precision nutrition of this line (whole recipe). */
  nutrients: Macros;
}

export interface LibraryRecipe {
  id: string;
  title: string;
  slots: MealType[];
  servings: number;
  prepMinutes: number;
  cookMinutes: number;
  totalMinutes: number;
  ingredients: RecipeIngredientLine[];
  pantry: string[];
  steps: string[];
  styles: DietPreference[];
  /** Per serving: full precision (use for sums) and rounded for display. */
  perServing: Macros;
  perServingDisplay: Macros;
  /** Weight of one serving, g (ml ingredients counted by weight via density, else ml). */
  servingGrams: number;
  /** Union of ingredient allergens — known for every catalog food. */
  allergens: Allergen[];
  /** Restrictions every ingredient satisfies. */
  suitableFor: DietPreference[];
  /** Relative cost per serving, 1 (low) – 3 (high), weighted by ingredient weight. Not a price. */
  costTier: number;
  source: "form_library";
}

function build(d: RecipeData): LibraryRecipe {
  const foods: FoodItem[] = d.ingredients.map((i) => {
    const f = verifiedFood(`fdb:${i.food}`);
    if (!f) throw new Error(`recipe ${d.id}: unknown food ${i.food}`);
    return f;
  });
  const calcs = d.ingredients.map((i, k) => calculatePortion(foods[k]!, { quantity: i.amount, unit: i.unit ?? "g" }));
  const lines: RecipeIngredientLine[] = d.ingredients.map((i, k) => ({
    foodId: foods[k]!.id,
    name: foods[k]!.name,
    amount: i.amount,
    unit: i.unit ?? "g",
    note: i.note ?? null,
    aisle: aisleOf(foods[k]!.id),
    nutrients: calcs[k]!.nutrients,
  }));
  // Gram-first weight of each line (drinks by density when known).
  const grams = calcs.map((c) => c.portion.grams ?? c.portion.amount);
  const total = sumNutrients(lines.map((l) => l.nutrients));
  const n = d.servings;
  const perServing = { kcal: total.kcal / n, proteinG: total.proteinG / n, carbsG: total.carbsG / n, fatG: total.fatG / n };
  const totalGrams = grams.reduce((a, b) => a + b, 0);
  const allergens = [...new Set(foods.flatMap((f) => f.allergens ?? []))].sort();
  const suitable = foods.reduce<DietPreference[] | null>((acc, f) => {
    const s = f.suitableFor ?? [];
    return acc === null ? [...s] : acc.filter((x) => s.includes(x));
  }, null) ?? [];
  const cost = grams.reduce((a, gm, k) => a + gm * (COST[d.ingredients[k]!.food] ?? 2), 0) / (totalGrams || 1);
  return {
    id: d.id,
    title: d.title,
    slots: d.slots,
    servings: n,
    prepMinutes: d.prepMinutes,
    cookMinutes: d.cookMinutes,
    totalMinutes: d.prepMinutes + d.cookMinutes,
    ingredients: lines,
    pantry: d.pantry ?? [],
    steps: d.steps,
    styles: d.styles ?? [],
    perServing,
    perServingDisplay: presentMacros(perServing),
    servingGrams: totalGrams / n,
    allergens,
    suitableFor: suitable,
    costTier: Math.round(cost * 10) / 10,
    source: "form_library",
  };
}

export const RECIPE_LIBRARY: readonly LibraryRecipe[] = DATA.map(build);

const BY_ID = new Map(RECIPE_LIBRARY.map((r) => [r.id, r]));

export function libraryRecipe(id: string): LibraryRecipe | null {
  return BY_ID.get(id) ?? null;
}

/**
 * Where recipes come from. FORM's own library is the only source today; a licensed recipe provider
 * would implement the same shape (real, structured recipes with ingredient quantities).
 */
export interface RecipeSource {
  readonly kind: "recipes";
  readonly name: string;
  list(): readonly LibraryRecipe[];
}

export const FORM_RECIPE_SOURCE: RecipeSource = { kind: "recipes", name: "FORM recipe library", list: () => RECIPE_LIBRARY };

/** Scales a recipe's ingredients to a number of servings (for display and grocery lists). */
export function scaledIngredients(r: LibraryRecipe, servings: number): { foodId: string; name: string; amount: number; unit: "g" | "ml"; aisle: Aisle }[] {
  const f = servings / r.servings;
  return r.ingredients.map((l) => ({ foodId: l.foodId, name: l.name, amount: l.amount * f, unit: l.unit, aisle: l.aisle }));
}

/** The recipe as an assessable food (allergens, diet, and every ingredient name for custom allergies and dislikes). */
export function recipeAsFood(r: LibraryRecipe) {
  return { name: r.title, ingredients: [...r.ingredients.map((i) => i.name), ...r.pantry], allergens: r.allergens, suitableFor: r.suitableFor };
}
