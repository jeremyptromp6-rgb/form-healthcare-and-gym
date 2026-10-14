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

/** What kind of food it is: picks the food's drawn illustration and groups the database. */
export const FOOD_CATEGORIES = ["fruit", "vegetable", "legume", "grain", "bread", "meat", "poultry", "fish", "egg", "dairy", "plant_protein", "nut", "oil", "snack", "sweet", "drink", "fast_food", "dish", "other"] as const;
export type FoodCategory = (typeof FOOD_CATEGORIES)[number];

type Entry = Omit<Row, "cat">;

interface Row {
  id: string;
  cat: FoodCategory;
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

const group = (cat: FoodCategory, entries: Entry[]): Row[] => entries.map((e) => ({ ...e, cat }));

const ROWS: Row[] = [
  // Fruit
  ...group("fruit", [
    { id: "banana", name: "Banana, raw", m: [89, 1.1, 22.8, 0.3], servings: [["1 medium (118 g)", 118]] },
    { id: "apple", name: "Apple, raw, with skin", m: [52, 0.3, 13.8, 0.2], servings: [["1 medium (182 g)", 182]] },
    { id: "orange", name: "Orange, raw", m: [47, 0.9, 11.8, 0.1], servings: [["1 medium (131 g)", 131]] },
    { id: "blueberries", name: "Blueberries, raw", m: [57, 0.7, 14.5, 0.3], servings: [["1 cup (148 g)", 148]], vol: ["cup", 148] },
    { id: "strawberries", name: "Strawberries, raw", m: [32, 0.7, 7.7, 0.3], servings: [["1 cup (144 g)", 144]] },
    { id: "avocado", name: "Avocado, raw", m: [160, 2, 8.5, 14.7], servings: [["½ avocado (68 g)", 68]] },
    { id: "pear", name: "Pear, raw", m: [57, 0.4, 15.2, 0.1], servings: [["1 medium (178 g)", 178]] },
    { id: "grapes", name: "Grapes, red or green, raw", m: [69, 0.7, 18.1, 0.2], servings: [["1 cup (151 g)", 151]], vol: ["cup", 151] },
    { id: "pineapple", name: "Pineapple, raw", m: [50, 0.5, 13.1, 0.1], servings: [["1 cup chunks (165 g)", 165]], vol: ["cup", 165] },
    { id: "mango", name: "Mango, raw", m: [60, 0.8, 15, 0.4], servings: [["1 cup pieces (165 g)", 165]], vol: ["cup", 165] },
    { id: "watermelon", name: "Watermelon, raw", m: [30, 0.6, 7.6, 0.2], servings: [["1 cup diced (152 g)", 152]], vol: ["cup", 152] },
    { id: "peach", name: "Peach, raw", m: [39, 0.9, 9.5, 0.3], servings: [["1 medium (150 g)", 150]] },
    { id: "plum", name: "Plum, raw", m: [46, 0.7, 11.4, 0.3], servings: [["1 medium (66 g)", 66]] },
    { id: "cherries", name: "Cherries, sweet, raw", m: [63, 1.1, 16, 0.2], servings: [["1 cup (138 g)", 138]], vol: ["cup", 138] },
    { id: "raspberries", name: "Raspberries, raw", m: [52, 1.2, 11.9, 0.7], servings: [["1 cup (123 g)", 123]], vol: ["cup", 123] },
    { id: "blackberries", name: "Blackberries, raw", m: [43, 1.4, 9.6, 0.5], servings: [["1 cup (144 g)", 144]], vol: ["cup", 144] },
    { id: "kiwi", name: "Kiwi fruit, raw", m: [61, 1.1, 14.7, 0.5], servings: [["1 medium (69 g)", 69]] },
    { id: "grapefruit", name: "Grapefruit, raw", m: [42, 0.8, 10.7, 0.1], servings: [["½ medium (123 g)", 123]] },
    { id: "tangerine", name: "Tangerine (mandarin), raw", m: [53, 0.8, 13.3, 0.3], servings: [["1 medium (88 g)", 88]] },
    { id: "pomegranate", name: "Pomegranate seeds, raw", m: [83, 1.7, 18.7, 1.2], servings: [["½ cup (87 g)", 87]], vol: ["cup", 174] },
    { id: "papaya", name: "Papaya, raw", m: [43, 0.5, 11, 0.3], servings: [["1 cup pieces (145 g)", 145]], vol: ["cup", 145] },
    { id: "cantaloupe", name: "Cantaloupe melon, raw", m: [34, 0.8, 8.2, 0.2], servings: [["1 cup diced (177 g)", 177]], vol: ["cup", 177] },
    { id: "apricot", name: "Apricot, raw", m: [48, 1.4, 11.1, 0.4], servings: [["1 apricot (35 g)", 35]] },
    { id: "fig", name: "Fig, raw", m: [74, 0.8, 19.2, 0.3], servings: [["1 medium (50 g)", 50]] },
    { id: "dates_medjool", name: "Dates, Medjool", m: [277, 1.8, 75, 0.2], servings: [["1 date (24 g)", 24]] },
    { id: "raisins", name: "Raisins", m: [299, 3.1, 79.2, 0.5], servings: [["1 small box (43 g)", 43]], vol: ["cup", 165] },
    { id: "apricots_dried", name: "Apricots, dried", m: [241, 3.4, 62.6, 0.5], servings: [["¼ cup (33 g)", 33]] },
    { id: "coconut_meat", name: "Coconut meat, raw", m: [354, 3.3, 15.2, 33.5], servings: [["1 piece (45 g)", 45]] },
    { id: "olives_green", name: "Olives, green, canned", m: [145, 1, 3.8, 15.3], servings: [["5 olives (16 g)", 16]] },
    { id: "applesauce", name: "Applesauce, unsweetened", m: [42, 0.2, 11.3, 0.1], servings: [["½ cup (122 g)", 122]], vol: ["cup", 244] },
  ]),

  // Vegetables
  ...group("vegetable", [
    { id: "potato_baked", name: "Potato, baked, with skin", m: [93, 2.5, 21.2, 0.1], servings: [["1 medium (173 g)", 173]] },
    { id: "sweet_potato_baked", name: "Sweet potato, baked, with skin", m: [90, 2, 20.7, 0.2], servings: [["1 medium (114 g)", 114]] },
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
    { id: "cauliflower_raw", name: "Cauliflower, raw", m: [25, 1.9, 5, 0.3], servings: [["1 cup (107 g)", 107]], vol: ["cup", 107] },
    { id: "cabbage_raw", name: "Cabbage, green, raw", m: [25, 1.3, 5.8, 0.1], servings: [["1 cup shredded (70 g)", 70]], vol: ["cup", 70] },
    { id: "kale_raw", name: "Kale, raw", m: [49, 4.3, 8.8, 0.9], servings: [["1 cup chopped (21 g)", 21]], vol: ["cup", 21] },
    { id: "arugula_raw", name: "Arugula (rocket), raw", m: [25, 2.6, 3.7, 0.7], servings: [["1 cup (20 g)", 20]], vol: ["cup", 20] },
    { id: "bok_choy_raw", name: "Bok choy, raw", m: [13, 1.5, 2.2, 0.2], servings: [["1 cup shredded (70 g)", 70]], vol: ["cup", 70] },
    { id: "zucchini_raw", name: "Zucchini, raw", m: [17, 1.2, 3.1, 0.3], servings: [["1 medium (196 g)", 196]] },
    { id: "eggplant_cooked", name: "Eggplant, cooked", m: [35, 0.8, 8.7, 0.2], servings: [["1 cup cubes (99 g)", 99]], vol: ["cup", 99] },
    { id: "mushrooms_raw", name: "Mushrooms, white, raw", m: [22, 3.1, 3.3, 0.3], servings: [["1 cup sliced (70 g)", 70]], vol: ["cup", 70] },
    { id: "asparagus_cooked", name: "Asparagus, cooked", m: [22, 2.4, 4.1, 0.2], servings: [["6 spears (90 g)", 90]] },
    { id: "green_beans_cooked", name: "Green beans, cooked", m: [35, 1.9, 7.9, 0.3], servings: [["1 cup (125 g)", 125]], vol: ["cup", 125] },
    { id: "celery_raw", name: "Celery, raw", m: [14, 0.7, 3, 0.2], servings: [["1 medium stalk (40 g)", 40]], allergens: ["celery"] },
    { id: "beetroot_cooked", name: "Beetroot, cooked", m: [44, 1.7, 10, 0.2], servings: [["1 beet (82 g)", 82]] },
    { id: "pumpkin_cooked", name: "Pumpkin, cooked", m: [20, 0.7, 4.9, 0.1], servings: [["1 cup mashed (245 g)", 245]], vol: ["cup", 245] },
    { id: "butternut_squash_baked", name: "Butternut squash, baked", m: [40, 0.9, 10.5, 0.1], servings: [["1 cup cubes (205 g)", 205]], vol: ["cup", 205] },
    { id: "brussels_sprouts_cooked", name: "Brussels sprouts, boiled", m: [36, 2.6, 7.1, 0.5], servings: [["1 cup (156 g)", 156]], vol: ["cup", 156] },
    { id: "leek_raw", name: "Leek, raw", m: [61, 1.5, 14.2, 0.3], servings: [["1 medium (89 g)", 89]] },
    { id: "radish_raw", name: "Radish, raw", m: [16, 0.7, 3.4, 0.1], servings: [["½ cup sliced (58 g)", 58]] },
    { id: "spring_onion_raw", name: "Spring onion (scallion), raw", m: [32, 1.8, 7.3, 0.2], servings: [["1 onion (15 g)", 15]] },
    { id: "potato_boiled", name: "Potato, boiled, without skin", m: [87, 1.9, 20.1, 0.1], servings: [["1 medium (136 g)", 136]] },
    { id: "carrot_cooked", name: "Carrot, boiled", m: [35, 0.8, 8.2, 0.2], servings: [["1 cup slices (156 g)", 156]], vol: ["cup", 156] },
    { id: "green_pepper_raw", name: "Bell pepper, green, raw", m: [20, 0.9, 4.6, 0.2], servings: [["1 medium (119 g)", 119]] },
    { id: "ginger_raw", name: "Ginger root, raw", m: [80, 1.8, 17.8, 0.8], servings: [["1 tbsp (6 g)", 6]] },
    { id: "sauerkraut", name: "Sauerkraut", m: [19, 0.9, 4.3, 0.1], servings: [["½ cup (71 g)", 71]], vol: ["cup", 142] },
    { id: "kimchi", name: "Kimchi", m: [15, 1.1, 2.4, 0.5], servings: [["½ cup (75 g)", 75]], vol: ["cup", 150], allergens: ["fish", "crustaceans"], contains: ["fish", "shellfish"] },
    { id: "pickles_dill", name: "Pickles, dill, cucumber", m: [11, 0.3, 2.3, 0.2], servings: [["1 medium (65 g)", 65]] },
    { id: "mixed_salad_greens", name: "Salad greens, mixed, raw", m: [20, 1.8, 3.4, 0.2], servings: [["2 cups (60 g)", 60]] },
  ]),

  // Legumes
  ...group("legume", [
    { id: "lentils_cooked", name: "Lentils, cooked", m: [116, 9, 20.1, 0.4], servings: [["1 cup (198 g)", 198]], vol: ["cup", 198] },
    { id: "chickpeas_cooked", name: "Chickpeas, cooked", m: [164, 8.9, 27.4, 2.6], servings: [["1 cup (164 g)", 164]], vol: ["cup", 164] },
    { id: "black_beans_cooked", name: "Black beans, cooked", m: [132, 8.9, 23.7, 0.5], servings: [["1 cup (172 g)", 172]], vol: ["cup", 172] },
    { id: "hummus", name: "Hummus", m: [166, 7.9, 14.3, 9.6], servings: [["2 tbsp (30 g)", 30]], vol: ["tbsp", 15], allergens: ["sesame"] },
    { id: "kidney_beans_cooked", name: "Kidney beans, cooked", m: [127, 8.7, 22.8, 0.5], servings: [["1 cup (177 g)", 177]], vol: ["cup", 177] },
    { id: "pinto_beans_cooked", name: "Pinto beans, cooked", m: [143, 9, 26.2, 0.7], servings: [["1 cup (171 g)", 171]], vol: ["cup", 171] },
    { id: "white_beans_cooked", name: "White (navy) beans, cooked", m: [140, 8.2, 26.1, 0.6], servings: [["1 cup (182 g)", 182]], vol: ["cup", 182] },
    { id: "split_peas_cooked", name: "Split peas, cooked", m: [118, 8.3, 21.1, 0.4], servings: [["1 cup (196 g)", 196]], vol: ["cup", 196] },
    { id: "edamame_cooked", name: "Edamame, cooked", m: [121, 11.9, 8.9, 5.2], servings: [["1 cup (155 g)", 155]], vol: ["cup", 155], allergens: ["soy"] },
    { id: "baked_beans_canned", name: "Baked beans, canned", m: [94, 4.7, 21.1, 0.4], servings: [["½ cup (127 g)", 127]], vol: ["cup", 254] },
    { id: "dal_yellow_lentil", name: "Dal, yellow lentil, plain cooked", m: [105, 7.5, 18, 0.4], servings: [["1 cup (198 g)", 198]], vol: ["cup", 198] },
  ]),

  // Grains, cereals and pasta
  ...group("grain", [
    { id: "oats_dry", name: "Oats, rolled, dry", m: [379, 13.2, 67.7, 6.5], servings: [["½ cup (40 g)", 40]], vol: ["cup", 80] },
    { id: "rice_white_cooked", name: "Rice, white, cooked", m: [130, 2.7, 28.2, 0.3], servings: [["1 cup (158 g)", 158]], vol: ["cup", 158] },
    { id: "rice_brown_cooked", name: "Rice, brown, cooked", m: [123, 2.7, 25.6, 1], servings: [["1 cup (195 g)", 195]], vol: ["cup", 195] },
    { id: "pasta_cooked", name: "Pasta, cooked", m: [158, 5.8, 30.9, 0.9], servings: [["1 cup (140 g)", 140]], vol: ["cup", 140], allergens: ["gluten"] },
    { id: "quinoa_cooked", name: "Quinoa, cooked", m: [120, 4.4, 21.3, 1.9], servings: [["1 cup (185 g)", 185]], vol: ["cup", 185] },
    { id: "oats_cooked", name: "Oatmeal, cooked with water", m: [71, 2.5, 12, 1.5], servings: [["1 cup (234 g)", 234]], vol: ["cup", 234] },
    { id: "couscous_cooked", name: "Couscous, cooked", m: [112, 3.8, 23.2, 0.2], servings: [["1 cup (157 g)", 157]], vol: ["cup", 157], allergens: ["gluten"] },
    { id: "bulgur_cooked", name: "Bulgur, cooked", m: [83, 3.1, 18.6, 0.2], servings: [["1 cup (182 g)", 182]], vol: ["cup", 182], allergens: ["gluten"] },
    { id: "barley_cooked", name: "Barley, pearled, cooked", m: [123, 2.3, 28.2, 0.4], servings: [["1 cup (157 g)", 157]], vol: ["cup", 157], allergens: ["gluten"] },
    { id: "pasta_whole_wheat_cooked", name: "Pasta, whole wheat, cooked", m: [124, 5.3, 26.5, 0.5], servings: [["1 cup (140 g)", 140]], vol: ["cup", 140], allergens: ["gluten"] },
    { id: "egg_noodles_cooked", name: "Egg noodles, cooked", m: [138, 4.5, 25, 2.1], servings: [["1 cup (160 g)", 160]], vol: ["cup", 160], allergens: ["gluten", "eggs"], contains: ["egg"] },
    { id: "rice_noodles_cooked", name: "Rice noodles, cooked", m: [108, 0.9, 24.9, 0.2], servings: [["1 cup (176 g)", 176]], vol: ["cup", 176] },
    { id: "rice_basmati_cooked", name: "Rice, basmati, cooked", m: [121, 3.5, 25.2, 0.4], servings: [["1 cup (163 g)", 163]], vol: ["cup", 163] },
    { id: "rice_wild_cooked", name: "Wild rice, cooked", m: [101, 4, 21.3, 0.3], servings: [["1 cup (164 g)", 164]], vol: ["cup", 164] },
    { id: "millet_cooked", name: "Millet, cooked", m: [119, 3.5, 23.7, 1], servings: [["1 cup (174 g)", 174]], vol: ["cup", 174] },
    { id: "polenta_cooked", name: "Polenta (cornmeal), cooked", m: [70, 1.6, 15, 0.3], servings: [["1 cup (240 g)", 240]], vol: ["cup", 240] },
    { id: "cornflakes", name: "Corn flakes cereal", m: [357, 7.5, 84, 0.4], servings: [["1 cup (28 g)", 28]], vol: ["cup", 28], allergens: ["gluten"] },
    { id: "muesli", name: "Muesli", m: [340, 10, 66, 6], servings: [["½ cup (55 g)", 55]], vol: ["cup", 110], allergens: ["gluten"] },
    { id: "granola", name: "Granola", m: [471, 10, 64, 20], servings: [["½ cup (61 g)", 61]], vol: ["cup", 122], allergens: ["gluten", "tree_nuts"] },
    { id: "rice_cakes", name: "Rice cakes", m: [387, 8.2, 81.5, 2.8], servings: [["1 cake (9 g)", 9]] },
    { id: "crackers_saltine", name: "Crackers, saltine", m: [421, 9.4, 74.2, 9.4], servings: [["5 crackers (15 g)", 15]], allergens: ["gluten"] },
    { id: "flour_wheat", name: "Wheat flour, white", m: [364, 10.3, 76.3, 1], servings: [["1 cup (125 g)", 125]], vol: ["cup", 125], allergens: ["gluten"] },
    { id: "spaghetti_dry", name: "Spaghetti, dry", m: [371, 13, 74.7, 1.5], servings: [["2 oz (56 g)", 56]], allergens: ["gluten"] },
  ]),

  // Bread and baked staples
  ...group("bread", [
    { id: "bread_whole_wheat", name: "Bread, whole wheat", m: [252, 12.4, 42.7, 3.5], servings: [["1 slice (32 g)", 32]], allergens: ["gluten"] },
    { id: "bread_white", name: "Bread, white", m: [266, 7.6, 50.6, 3.3], servings: [["1 slice (25 g)", 25]], allergens: ["gluten"] },
    { id: "bread_sourdough", name: "Bread, sourdough", m: [289, 11.8, 56.4, 1.8], servings: [["1 slice (50 g)", 50]], allergens: ["gluten"] },
    { id: "bread_rye", name: "Bread, rye", m: [259, 8.5, 48.3, 3.3], servings: [["1 slice (32 g)", 32]], allergens: ["gluten"] },
    { id: "baguette", name: "Baguette (French bread)", m: [272, 9, 52, 2.5], servings: [["1 slice (30 g)", 30]], allergens: ["gluten"] },
    { id: "bagel_plain", name: "Bagel, plain", m: [257, 10, 50.9, 1.6], servings: [["1 medium (105 g)", 105]], allergens: ["gluten"] },
    { id: "croissant", name: "Croissant, butter", m: [406, 8.2, 45.8, 21], servings: [["1 medium (57 g)", 57]], allergens: ["gluten", "milk"], contains: ["dairy"] },
    { id: "pita_white", name: "Pita bread, white", m: [275, 9.1, 55.7, 1.2], servings: [["1 medium (60 g)", 60]], allergens: ["gluten"] },
    { id: "naan", name: "Naan bread", m: [290, 9, 50, 5.1], servings: [["1 piece (90 g)", 90]], allergens: ["gluten", "milk"], contains: ["dairy"] },
    { id: "english_muffin", name: "English muffin", m: [227, 8.7, 44.1, 1.8], servings: [["1 muffin (57 g)", 57]], allergens: ["gluten"] },
    { id: "burger_bun", name: "Hamburger bun", m: [279, 9.6, 50.8, 4.2], servings: [["1 bun (43 g)", 43]], allergens: ["gluten"] },
    { id: "tortilla_flour", name: "Tortilla, flour", m: [312, 8.3, 49.5, 8.1], servings: [["1 medium (49 g)", 49]], allergens: ["gluten"] },
    { id: "tortilla_corn", name: "Tortilla, corn", m: [218, 5.7, 44.6, 2.9], servings: [["1 medium (26 g)", 26]] },
    { id: "pancakes", name: "Pancakes, plain", m: [227, 6.4, 28.3, 9.7], servings: [["1 medium (77 g)", 77]], allergens: ["gluten", "milk", "eggs"], contains: ["dairy", "egg"] },
    { id: "waffle", name: "Waffle, plain", m: [291, 7.9, 32.7, 14.1], servings: [["1 waffle (75 g)", 75]], allergens: ["gluten", "milk", "eggs"], contains: ["dairy", "egg"] },
  ]),

  // Meat
  ...group("meat", [
    { id: "ground_beef_90_cooked", name: "Ground beef 90% lean, cooked", m: [217, 26.1, 0, 11.7], servings: [["3 oz (85 g)", 85]], contains: ["meat"] },
    { id: "beef_sirloin_cooked", name: "Beef sirloin steak, cooked", m: [206, 29.9, 0, 8.7], servings: [["1 steak (200 g)", 200]], contains: ["meat"] },
    { id: "beef_ribeye_cooked", name: "Beef ribeye steak, cooked", m: [291, 24, 0, 21], servings: [["1 steak (230 g)", 230]], contains: ["meat"] },
    { id: "ground_beef_80_cooked", name: "Ground beef 80% lean, cooked", m: [271, 25.5, 0, 18.4], servings: [["3 oz (85 g)", 85]], contains: ["meat"] },
    { id: "pork_chop_cooked", name: "Pork chop, cooked", m: [231, 25.7, 0, 13.8], servings: [["1 chop (120 g)", 120]], contains: ["meat"] },
    { id: "pork_tenderloin_cooked", name: "Pork tenderloin, roasted", m: [143, 26.2, 0, 3.5], servings: [["3 oz (85 g)", 85]], contains: ["meat"] },
    { id: "bacon_cooked", name: "Bacon, cooked", m: [541, 37, 1.4, 42], servings: [["1 slice (8 g)", 8]], contains: ["meat"] },
    { id: "ham_sliced", name: "Ham, sliced", m: [145, 20.9, 1.5, 5.5], servings: [["1 slice (28 g)", 28]], contains: ["meat"] },
    { id: "pork_sausage_cooked", name: "Pork sausage, cooked", m: [339, 19.2, 0.7, 28.5], servings: [["1 link (25 g)", 25]], contains: ["meat"] },
    { id: "lamb_cooked", name: "Lamb, leg, roasted", m: [258, 25.6, 0, 16.5], servings: [["3 oz (85 g)", 85]], contains: ["meat"] },
    { id: "salami", name: "Salami", m: [336, 21.7, 1.2, 26.5], servings: [["1 slice (10 g)", 10]], contains: ["meat"] },
    { id: "beef_jerky", name: "Beef jerky", m: [410, 33.2, 11, 25.6], servings: [["1 oz (28 g)", 28]], allergens: ["soy"], contains: ["meat"] },
    { id: "beef_mince_lean_raw", name: "Beef mince, lean, raw", m: [137, 21.4, 0, 5.5], servings: [["100 g", 100]], contains: ["meat"] },
  ]),

  // Poultry
  ...group("poultry", [
    { id: "chicken_breast_cooked", name: "Chicken breast, skinless, cooked", m: [165, 31, 0, 3.6], servings: [["1 breast (172 g)", 172]], contains: ["poultry"] },
    { id: "chicken_breast_raw", name: "Chicken breast, skinless, raw", m: [120, 22.5, 0, 2.6], contains: ["poultry"] },
    { id: "chicken_thigh_cooked", name: "Chicken thigh, skinless, cooked", m: [209, 26, 0, 10.9], servings: [["1 thigh (52 g)", 52]], contains: ["poultry"] },
    { id: "chicken_drumstick_cooked", name: "Chicken drumstick, with skin, roasted", m: [216, 27, 0, 11.2], servings: [["1 drumstick (95 g)", 95]], contains: ["poultry"] },
    { id: "chicken_wings_cooked", name: "Chicken wings, with skin, roasted", m: [254, 23.8, 0, 17], servings: [["1 wing (34 g)", 34]], contains: ["poultry"] },
    { id: "turkey_breast_cooked", name: "Turkey breast, roasted", m: [135, 30, 0, 0.7], servings: [["3 oz (85 g)", 85]], contains: ["poultry"] },
    { id: "turkey_ground_cooked", name: "Ground turkey, cooked", m: [203, 27.1, 0, 10.4], servings: [["3 oz (85 g)", 85]], contains: ["poultry"] },
    { id: "duck_roasted", name: "Duck, roasted, meat and skin", m: [337, 19, 0, 28.4], servings: [["½ cup (70 g)", 70]], contains: ["poultry"] },
  ]),

  // Fish and seafood
  ...group("fish", [
    { id: "salmon_cooked", name: "Salmon, Atlantic, cooked", m: [206, 22.1, 0, 12.4], servings: [["1 fillet (154 g)", 154]], allergens: ["fish"], contains: ["fish"] },
    { id: "tuna_canned_water", name: "Tuna, light, canned in water, drained", m: [116, 25.5, 0, 0.8], servings: [["1 can drained (142 g)", 142]], allergens: ["fish"], contains: ["fish"] },
    { id: "cod_cooked", name: "Cod, Atlantic, cooked", m: [105, 22.8, 0, 0.9], servings: [["1 fillet (180 g)", 180]], allergens: ["fish"], contains: ["fish"] },
    { id: "shrimp_cooked", name: "Shrimp, cooked", m: [99, 24, 0.2, 0.3], servings: [["3 oz (85 g)", 85]], allergens: ["crustaceans"], contains: ["shellfish"] },
    { id: "tilapia_cooked", name: "Tilapia, cooked", m: [128, 26.2, 0, 2.7], servings: [["1 fillet (87 g)", 87]], allergens: ["fish"], contains: ["fish"] },
    { id: "sardines_canned", name: "Sardines, canned in oil, drained", m: [208, 24.6, 0, 11.5], servings: [["1 can drained (92 g)", 92]], allergens: ["fish"], contains: ["fish"] },
    { id: "mackerel_cooked", name: "Mackerel, Atlantic, cooked", m: [262, 23.9, 0, 17.8], servings: [["1 fillet (88 g)", 88]], allergens: ["fish"], contains: ["fish"] },
    { id: "trout_cooked", name: "Trout, rainbow, cooked", m: [168, 23.8, 0, 7.2], servings: [["1 fillet (143 g)", 143]], allergens: ["fish"], contains: ["fish"] },
    { id: "haddock_cooked", name: "Haddock, cooked", m: [112, 24.4, 0, 0.9], servings: [["1 fillet (150 g)", 150]], allergens: ["fish"], contains: ["fish"] },
    { id: "halibut_cooked", name: "Halibut, cooked", m: [140, 26.7, 0, 2.9], servings: [["1 fillet (160 g)", 160]], allergens: ["fish"], contains: ["fish"] },
    { id: "tuna_steak_cooked", name: "Tuna steak, bluefin, cooked", m: [184, 29.9, 0, 6.3], servings: [["1 steak (145 g)", 145]], allergens: ["fish"], contains: ["fish"] },
    { id: "smoked_salmon", name: "Salmon, smoked", m: [117, 18.3, 0, 4.3], servings: [["1 slice (28 g)", 28]], allergens: ["fish"], contains: ["fish"] },
    { id: "crab_cooked", name: "Crab, cooked", m: [97, 19.4, 0, 1.5], servings: [["3 oz (85 g)", 85]], allergens: ["crustaceans"], contains: ["shellfish"] },
    { id: "lobster_cooked", name: "Lobster, cooked", m: [89, 19, 0, 0.9], servings: [["3 oz (85 g)", 85]], allergens: ["crustaceans"], contains: ["shellfish"] },
    { id: "scallops_cooked", name: "Scallops, cooked", m: [111, 20.5, 5.4, 0.8], servings: [["3 oz (85 g)", 85]], allergens: ["molluscs"], contains: ["shellfish"] },
    { id: "mussels_cooked", name: "Mussels, blue, cooked", m: [172, 23.8, 7.4, 4.5], servings: [["3 oz (85 g)", 85]], allergens: ["molluscs"], contains: ["shellfish"] },
    { id: "oysters_raw", name: "Oysters, raw", m: [68, 7, 3.9, 2.5], servings: [["6 medium (84 g)", 84]], allergens: ["molluscs"], contains: ["shellfish"] },
    { id: "squid_raw", name: "Squid, raw", m: [92, 15.6, 3.1, 1.4], servings: [["3 oz (85 g)", 85]], allergens: ["molluscs"], contains: ["shellfish"] },
  ]),

  // Eggs
  ...group("egg", [
    { id: "egg_whole", name: "Egg, whole, raw", m: [143, 12.6, 0.7, 9.5], servings: [["1 large egg (50 g)", 50]], allergens: ["eggs"], contains: ["egg"] },
    { id: "egg_white", name: "Egg white, raw", m: [52, 10.9, 0.7, 0.2], servings: [["1 large white (33 g)", 33]], allergens: ["eggs"], contains: ["egg"] },
    { id: "egg_hard_boiled", name: "Egg, hard-boiled", m: [155, 12.6, 1.1, 10.6], servings: [["1 large egg (50 g)", 50]], allergens: ["eggs"], contains: ["egg"] },
  ]),

  // Dairy and cheese
  ...group("dairy", [
    { id: "greek_yogurt_nonfat", name: "Greek yogurt, plain, nonfat", m: [59, 10.2, 3.6, 0.4], servings: [["1 container (170 g)", 170]], allergens: ["milk"], contains: ["dairy"] },
    { id: "greek_yogurt_whole", name: "Greek yogurt, plain, whole milk", m: [97, 9, 4, 5], servings: [["1 container (170 g)", 170]], allergens: ["milk"], contains: ["dairy"] },
    { id: "cottage_cheese_2", name: "Cottage cheese, 2% fat", m: [81, 10.5, 4.8, 2.3], servings: [["½ cup (113 g)", 113]], vol: ["cup", 226], allergens: ["milk"], contains: ["dairy"] },
    { id: "cheddar", name: "Cheddar cheese", m: [403, 24.9, 1.3, 33.1], servings: [["1 slice (28 g)", 28]], allergens: ["milk"], contains: ["dairy"] },
    { id: "feta", name: "Feta cheese", m: [264, 14.2, 4.1, 21.3], servings: [["1 oz (28 g)", 28]], allergens: ["milk"], contains: ["dairy"] },
    { id: "butter", name: "Butter, salted", m: [717, 0.9, 0.1, 81.1], servings: [["1 tbsp (14 g)", 14]], vol: ["tbsp", 14], allergens: ["milk"], contains: ["dairy"] },
    { id: "mozzarella", name: "Mozzarella cheese", m: [280, 28, 3.1, 17.1], servings: [["1 oz (28 g)", 28]], allergens: ["milk"], contains: ["dairy"] },
    { id: "parmesan", name: "Parmesan cheese, grated", m: [431, 38, 4.1, 29], servings: [["1 tbsp (5 g)", 5]], allergens: ["milk"], contains: ["dairy"] },
    { id: "swiss_cheese", name: "Swiss cheese", m: [393, 27, 1.4, 31], servings: [["1 slice (28 g)", 28]], allergens: ["milk"], contains: ["dairy"] },
    { id: "cream_cheese", name: "Cream cheese", m: [342, 5.9, 4.1, 34.2], servings: [["1 tbsp (14.5 g)", 14.5]], vol: ["tbsp", 14.5], allergens: ["milk"], contains: ["dairy"] },
    { id: "ricotta", name: "Ricotta cheese, whole milk", m: [174, 11.3, 3, 13], servings: [["½ cup (124 g)", 124]], vol: ["cup", 248], allergens: ["milk"], contains: ["dairy"] },
    { id: "goat_cheese", name: "Goat cheese, soft", m: [264, 18.5, 0.1, 21.1], servings: [["1 oz (28 g)", 28]], allergens: ["milk"], contains: ["dairy"] },
    { id: "brie", name: "Brie cheese", m: [334, 20.8, 0.5, 27.7], servings: [["1 oz (28 g)", 28]], allergens: ["milk"], contains: ["dairy"] },
    { id: "yogurt_plain_whole", name: "Yogurt, plain, whole milk", m: [61, 3.5, 4.7, 3.3], servings: [["1 cup (245 g)", 245]], vol: ["cup", 245], allergens: ["milk"], contains: ["dairy"] },
    { id: "yogurt_plain_lowfat", name: "Yogurt, plain, low-fat", m: [63, 5.3, 7, 1.6], servings: [["1 container (170 g)", 170]], allergens: ["milk"], contains: ["dairy"] },
    { id: "cream_heavy", name: "Cream, heavy", m: [340, 2.8, 2.8, 36.1], servings: [["1 tbsp (15 g)", 15]], vol: ["tbsp", 15], allergens: ["milk"], contains: ["dairy"] },
    { id: "sour_cream", name: "Sour cream", m: [198, 2.4, 4.6, 19.4], servings: [["1 tbsp (12 g)", 12]], vol: ["tbsp", 12], allergens: ["milk"], contains: ["dairy"] },
    { id: "ghee", name: "Ghee (clarified butter)", m: [876, 0, 0, 99.5], servings: [["1 tbsp (13 g)", 13]], vol: ["tbsp", 13], allergens: ["milk"], contains: ["dairy"] },
  ]),

  // Plant proteins
  ...group("plant_protein", [
    { id: "tofu_firm", name: "Tofu, firm", m: [144, 17.3, 2.8, 8.7], servings: [["½ block (126 g)", 126]], allergens: ["soy"] },
    { id: "tofu_silken", name: "Tofu, silken", m: [55, 4.8, 2.4, 2.7], servings: [["½ block (170 g)", 170]], allergens: ["soy"] },
    { id: "tempeh", name: "Tempeh", m: [192, 20.3, 7.6, 10.8], servings: [["½ cup (83 g)", 83]], allergens: ["soy"] },
    { id: "seitan", name: "Seitan (wheat gluten)", m: [370, 75, 14, 1.9], servings: [["3 oz (85 g)", 85]], allergens: ["gluten"] },
    { id: "veggie_burger_patty", name: "Veggie burger patty", m: [166, 16, 10, 6], servings: [["1 patty (70 g)", 70]], allergens: ["soy", "gluten"] },
  ]),

  // Nuts and seeds
  ...group("nut", [
    { id: "almonds", name: "Almonds", m: [579, 21.2, 21.6, 49.9], servings: [["1 oz (28 g)", 28]], allergens: ["tree_nuts"] },
    { id: "walnuts", name: "Walnuts", m: [654, 15.2, 13.7, 65.2], servings: [["1 oz (28 g)", 28]], allergens: ["tree_nuts"] },
    { id: "peanut_butter", name: "Peanut butter, smooth", m: [588, 25.1, 19.6, 50.4], servings: [["1 tbsp (16 g)", 16]], vol: ["tbsp", 16], allergens: ["peanuts"] },
    { id: "chia_seeds", name: "Chia seeds", m: [486, 16.5, 42.1, 30.7], servings: [["1 tbsp (12 g)", 12]], vol: ["tbsp", 12] },
    { id: "cashews", name: "Cashews", m: [553, 18.2, 30.2, 43.9], servings: [["1 oz (28 g)", 28]], allergens: ["tree_nuts"] },
    { id: "pistachios", name: "Pistachios", m: [560, 20.2, 27.2, 45.3], servings: [["1 oz (28 g)", 28]], allergens: ["tree_nuts"] },
    { id: "hazelnuts", name: "Hazelnuts", m: [628, 15, 16.7, 60.8], servings: [["1 oz (28 g)", 28]], allergens: ["tree_nuts"] },
    { id: "pecans", name: "Pecans", m: [691, 9.2, 13.9, 72], servings: [["1 oz (28 g)", 28]], allergens: ["tree_nuts"] },
    { id: "macadamias", name: "Macadamia nuts", m: [718, 7.9, 13.8, 75.8], servings: [["1 oz (28 g)", 28]], allergens: ["tree_nuts"] },
    { id: "brazil_nuts", name: "Brazil nuts", m: [659, 14.3, 12.3, 67.1], servings: [["1 oz (28 g)", 28]], allergens: ["tree_nuts"] },
    { id: "peanuts_roasted", name: "Peanuts, roasted", m: [585, 23.7, 21.5, 49.7], servings: [["1 oz (28 g)", 28]], allergens: ["peanuts"] },
    { id: "sunflower_seeds", name: "Sunflower seeds, kernels", m: [584, 20.8, 20, 51.5], servings: [["1 oz (28 g)", 28]] },
    { id: "pumpkin_seeds", name: "Pumpkin seeds, kernels", m: [559, 30.2, 10.7, 49.1], servings: [["1 oz (28 g)", 28]] },
    { id: "flaxseed", name: "Flaxseed", m: [534, 18.3, 28.9, 42.2], servings: [["1 tbsp (10 g)", 10]], vol: ["tbsp", 10] },
    { id: "sesame_seeds", name: "Sesame seeds", m: [573, 17.7, 23.5, 49.7], servings: [["1 tbsp (9 g)", 9]], vol: ["tbsp", 9], allergens: ["sesame"] },
    { id: "hemp_seeds", name: "Hemp seeds, hulled", m: [553, 31.6, 8.7, 48.8], servings: [["1 tbsp (10 g)", 10]], vol: ["tbsp", 10] },
    { id: "almond_butter", name: "Almond butter", m: [614, 21, 19, 55.5], servings: [["1 tbsp (16 g)", 16]], vol: ["tbsp", 16], allergens: ["tree_nuts"] },
    { id: "tahini", name: "Tahini (sesame paste)", m: [595, 17, 21.2, 53.8], servings: [["1 tbsp (15 g)", 15]], vol: ["tbsp", 15], allergens: ["sesame"] },
    { id: "mixed_nuts", name: "Mixed nuts, roasted", m: [607, 20, 21, 54], servings: [["1 oz (28 g)", 28]], allergens: ["tree_nuts", "peanuts"] },
  ]),

  // Oils, fats, sauces and condiments
  ...group("oil", [
    { id: "olive_oil", name: "Olive oil", m: [884, 0, 0, 100], servings: [["1 tbsp (13.5 g)", 13.5]], vol: ["tbsp", 13.5] },
    { id: "soy_sauce", name: "Soy sauce", m: [53, 8.1, 4.9, 0.6], servings: [["1 tbsp (16 g)", 16]], vol: ["tbsp", 16], allergens: ["soy", "gluten"] },
    { id: "canola_oil", name: "Canola oil", m: [884, 0, 0, 100], servings: [["1 tbsp (13.6 g)", 13.6]], vol: ["tbsp", 13.6] },
    { id: "coconut_oil", name: "Coconut oil", m: [892, 0, 0, 99.1], servings: [["1 tbsp (13.6 g)", 13.6]], vol: ["tbsp", 13.6] },
    { id: "sesame_oil", name: "Sesame oil", m: [884, 0, 0, 100], servings: [["1 tbsp (13.6 g)", 13.6]], vol: ["tbsp", 13.6], allergens: ["sesame"] },
    { id: "margarine", name: "Margarine, soft", m: [717, 0.2, 0.7, 80.7], servings: [["1 tbsp (14 g)", 14]], vol: ["tbsp", 14] },
    { id: "mayonnaise", name: "Mayonnaise", m: [680, 1, 0.6, 75], servings: [["1 tbsp (13.8 g)", 13.8]], vol: ["tbsp", 13.8], allergens: ["eggs"], contains: ["egg"] },
    { id: "ketchup", name: "Ketchup", m: [101, 1, 27.4, 0.1], servings: [["1 tbsp (17 g)", 17]], vol: ["tbsp", 17] },
    { id: "mustard_yellow", name: "Mustard, yellow", m: [60, 3.7, 5.8, 3.3], servings: [["1 tsp (5 g)", 5]], vol: ["tsp", 5], allergens: ["mustard"] },
    { id: "bbq_sauce", name: "Barbecue sauce", m: [172, 0.8, 40, 0.6], servings: [["1 tbsp (17 g)", 17]], vol: ["tbsp", 17] },
    { id: "salsa", name: "Salsa, tomato", m: [36, 1.5, 7, 0.2], servings: [["2 tbsp (32 g)", 32]], vol: ["tbsp", 16] },
    { id: "pesto", name: "Pesto, basil", m: [450, 5, 6, 45], servings: [["1 tbsp (16 g)", 16]], vol: ["tbsp", 16], allergens: ["milk", "tree_nuts"], contains: ["dairy"] },
    { id: "marinara_sauce", name: "Marinara pasta sauce", m: [50, 1.4, 8.3, 1.3], servings: [["½ cup (125 g)", 125]], vol: ["cup", 250] },
    { id: "ranch_dressing", name: "Ranch dressing", m: [430, 1.5, 5.5, 45], servings: [["2 tbsp (30 g)", 30]], vol: ["tbsp", 15], allergens: ["milk", "eggs"], contains: ["dairy", "egg"] },
    { id: "guacamole", name: "Guacamole", m: [157, 2, 8.6, 14.3], servings: [["¼ cup (60 g)", 60]] },
    { id: "teriyaki_sauce", name: "Teriyaki sauce", m: [89, 5.9, 15.6, 0], servings: [["1 tbsp (18 g)", 18]], vol: ["tbsp", 18], allergens: ["soy", "gluten"] },
  ]),

  // Snacks
  ...group("snack", [
    { id: "potato_chips", name: "Potato chips", m: [536, 7, 52.9, 34.6], servings: [["1 oz (28 g)", 28]] },
    { id: "tortilla_chips", name: "Tortilla chips", m: [489, 7.2, 60, 25], servings: [["1 oz (28 g)", 28]] },
    { id: "popcorn_air", name: "Popcorn, air-popped", m: [387, 12.9, 77.8, 4.5], servings: [["3 cups (24 g)", 24]] },
    { id: "pretzels", name: "Pretzels, hard", m: [380, 9, 80, 3], servings: [["1 oz (28 g)", 28]], allergens: ["gluten"] },
    { id: "trail_mix", name: "Trail mix with nuts and fruit", m: [462, 13.8, 44.9, 29.4], servings: [["¼ cup (38 g)", 38]], allergens: ["peanuts", "tree_nuts"] },
    { id: "granola_bar", name: "Granola bar", m: [471, 7.6, 64.4, 19.8], servings: [["1 bar (25 g)", 25]], allergens: ["gluten"] },
    { id: "whey_protein_powder", name: "Whey protein powder", m: [400, 80, 8, 6], servings: [["1 scoop (30 g)", 30]], allergens: ["milk"], contains: ["dairy"] },
  ]),

  // Sweets, desserts and sugars
  ...group("sweet", [
    { id: "honey", name: "Honey", m: [304, 0.3, 82.4, 0], servings: [["1 tbsp (21 g)", 21]], vol: ["tbsp", 21], contains: ["honey"] },
    { id: "dark_chocolate", name: "Dark chocolate, 70–85% cocoa", m: [598, 7.8, 45.9, 42.6], servings: [["1 square (10 g)", 10]] },
    { id: "milk_chocolate", name: "Milk chocolate", m: [535, 7.7, 59.4, 29.7], servings: [["1 square (10 g)", 10]], allergens: ["milk"], contains: ["dairy"] },
    { id: "cookie_chocolate_chip", name: "Cookie, chocolate chip", m: [488, 5.8, 63.7, 24], servings: [["1 medium (16 g)", 16]], allergens: ["gluten", "milk", "eggs"], contains: ["dairy", "egg"] },
    { id: "cookie_oatmeal", name: "Cookie, oatmeal", m: [450, 6.4, 68.7, 17.3], servings: [["1 medium (16 g)", 16]], allergens: ["gluten", "eggs"], contains: ["egg"] },
    { id: "brownie", name: "Brownie", m: [466, 5.7, 53.2, 25.9], servings: [["1 square (56 g)", 56]], allergens: ["gluten", "eggs", "milk"], contains: ["dairy", "egg"] },
    { id: "cake_chocolate", name: "Chocolate cake with frosting", m: [371, 4, 56, 16], servings: [["1 slice (95 g)", 95]], allergens: ["gluten", "eggs", "milk"], contains: ["dairy", "egg"] },
    { id: "cheesecake", name: "Cheesecake", m: [321, 5.5, 25.5, 22.5], servings: [["1 slice (125 g)", 125]], allergens: ["gluten", "eggs", "milk"], contains: ["dairy", "egg"] },
    { id: "donut_glazed", name: "Doughnut, glazed", m: [421, 4.9, 48.8, 23], servings: [["1 medium (60 g)", 60]], allergens: ["gluten", "eggs", "milk"], contains: ["dairy", "egg"] },
    { id: "muffin_blueberry", name: "Muffin, blueberry", m: [377, 5.9, 53.5, 15.6], servings: [["1 medium (113 g)", 113]], allergens: ["gluten", "eggs", "milk"], contains: ["dairy", "egg"] },
    { id: "ice_cream_vanilla", name: "Ice cream, vanilla", m: [207, 3.5, 23.6, 11], servings: [["½ cup (66 g)", 66]], allergens: ["milk", "eggs"], contains: ["dairy", "egg"] },
    { id: "apple_pie", name: "Apple pie", m: [237, 1.9, 34, 11], servings: [["1 slice (125 g)", 125]], allergens: ["gluten"] },
    { id: "maple_syrup", name: "Maple syrup", m: [260, 0, 67, 0.1], servings: [["1 tbsp (20 g)", 20]], vol: ["tbsp", 20] },
    { id: "sugar_white", name: "Sugar, white granulated", m: [387, 0, 100, 0], servings: [["1 tsp (4 g)", 4]], vol: ["tsp", 4.2] },
    { id: "jam", name: "Jam (fruit preserves)", m: [250, 0.4, 64, 0.1], servings: [["1 tbsp (20 g)", 20]], vol: ["tbsp", 20] },
    { id: "chocolate_hazelnut_spread", name: "Chocolate hazelnut spread", m: [539, 6.3, 57.5, 30.9], servings: [["1 tbsp (20 g)", 20]], vol: ["tbsp", 20], allergens: ["tree_nuts", "milk"], contains: ["dairy"] },
  ]),

  // Drinks
  ...group("drink", [
    { id: "milk_whole", name: "Milk, whole (3.25%)", basis: "ml", vol: 1.03, m: [64, 3.3, 4.8, 3.6], servings: [["1 cup (240 ml)", 240], ["1 glass (200 ml)", 200]], allergens: ["milk"], contains: ["dairy"] },
    { id: "milk_skim", name: "Milk, skim", basis: "ml", vol: 1.035, m: [35, 3.4, 5, 0.1], servings: [["1 cup (240 ml)", 240]], allergens: ["milk"], contains: ["dairy"] },
    { id: "soy_milk", name: "Soy milk, unsweetened", basis: "ml", vol: 1.03, m: [33, 2.9, 1.7, 1.6], servings: [["1 cup (240 ml)", 240]], allergens: ["soy"] },
    { id: "orange_juice", name: "Orange juice", basis: "ml", vol: 1.04, m: [45, 0.7, 10.4, 0.2], servings: [["1 cup (240 ml)", 240]] },
    { id: "coffee_black", name: "Coffee, brewed, black", basis: "ml", vol: 1, m: [1, 0.1, 0, 0], servings: [["1 cup (240 ml)", 240]] },
    { id: "milk_2", name: "Milk, reduced fat (2%)", basis: "ml", vol: 1.03, m: [50, 3.3, 4.8, 1.9], servings: [["1 cup (240 ml)", 240], ["1 glass (200 ml)", 200]], allergens: ["milk"], contains: ["dairy"] },
    { id: "chocolate_milk", name: "Chocolate milk", basis: "ml", vol: 1.04, m: [83, 3.2, 10.3, 3.4], servings: [["1 cup (240 ml)", 240]], allergens: ["milk"], contains: ["dairy"] },
    { id: "kefir", name: "Kefir, plain", basis: "ml", vol: 1.03, m: [41, 3.4, 4.5, 1], servings: [["1 cup (240 ml)", 240]], allergens: ["milk"], contains: ["dairy"] },
    { id: "almond_milk", name: "Almond milk, unsweetened", basis: "ml", vol: 1.01, m: [15, 0.6, 0.3, 1.2], servings: [["1 cup (240 ml)", 240]], allergens: ["tree_nuts"] },
    { id: "oat_milk", name: "Oat milk", basis: "ml", vol: 1.03, m: [48, 1, 6.7, 1.5], servings: [["1 cup (240 ml)", 240]], allergens: ["gluten"] },
    { id: "coconut_milk_canned", name: "Coconut milk, canned", basis: "ml", vol: 0.97, m: [197, 2, 2.8, 21.3], servings: [["¼ cup (60 ml)", 60]] },
    { id: "water", name: "Water", basis: "ml", vol: 1, m: [0, 0, 0, 0], servings: [["1 glass (250 ml)", 250], ["1 bottle (500 ml)", 500]] },
    { id: "tea_black", name: "Tea, black, brewed, unsweetened", basis: "ml", vol: 1, m: [1, 0, 0.3, 0], servings: [["1 cup (240 ml)", 240]] },
    { id: "tea_green", name: "Tea, green, brewed, unsweetened", basis: "ml", vol: 1, m: [1, 0.2, 0, 0], servings: [["1 cup (240 ml)", 240]] },
    { id: "espresso", name: "Espresso", basis: "ml", vol: 1, m: [9, 0.1, 1.7, 0.2], servings: [["1 shot (30 ml)", 30]] },
    { id: "latte", name: "Latte (coffee with whole milk)", basis: "ml", vol: 1.03, m: [54, 3, 4.5, 2.6], servings: [["1 cup (240 ml)", 240]], allergens: ["milk"], contains: ["dairy"] },
    { id: "hot_chocolate", name: "Hot chocolate (cocoa) with milk", basis: "ml", vol: 1.04, m: [77, 3.2, 11.3, 2.3], servings: [["1 cup (240 ml)", 240]], allergens: ["milk"], contains: ["dairy"] },
    { id: "cola", name: "Cola", basis: "ml", vol: 1.04, m: [42, 0, 10.6, 0], servings: [["1 can (355 ml)", 355]] },
    { id: "lemonade", name: "Lemonade", basis: "ml", vol: 1.04, m: [40, 0.1, 10.4, 0], servings: [["1 cup (240 ml)", 240]] },
    { id: "apple_juice", name: "Apple juice", basis: "ml", vol: 1.05, m: [46, 0.1, 11.3, 0.1], servings: [["1 cup (240 ml)", 240]] },
    { id: "grape_juice", name: "Grape juice", basis: "ml", vol: 1.06, m: [60, 0.4, 14.8, 0.1], servings: [["1 cup (240 ml)", 240]] },
    { id: "tomato_juice", name: "Tomato juice", basis: "ml", vol: 1.03, m: [17, 0.8, 3.5, 0.1], servings: [["1 cup (240 ml)", 240]] },
    { id: "coconut_water", name: "Coconut water", basis: "ml", vol: 1.02, m: [19, 0.7, 3.7, 0.2], servings: [["1 cup (240 ml)", 240]] },
    { id: "sports_drink", name: "Sports drink", basis: "ml", vol: 1.02, m: [26, 0, 6.2, 0], servings: [["1 bottle (591 ml)", 591]] },
    { id: "milkshake", name: "Milkshake, vanilla", basis: "ml", vol: 1.06, m: [112, 3.2, 18, 3.2], servings: [["1 cup (240 ml)", 240]], allergens: ["milk"], contains: ["dairy"] },
  ]),

  // Fast food
  ...group("fast_food", [
    { id: "cheeseburger", name: "Cheeseburger, single patty with bun", m: [295, 15, 30, 12.6], servings: [["1 burger (120 g)", 120]], allergens: ["gluten", "milk", "sesame"], contains: ["meat", "dairy"] },
    { id: "french_fries", name: "French fries, fast food", m: [312, 3.4, 41.4, 14.7], servings: [["1 medium (117 g)", 117]] },
    { id: "pizza_cheese", name: "Pizza, cheese", m: [266, 11, 33, 10], servings: [["1 slice (107 g)", 107]], allergens: ["gluten", "milk"], contains: ["dairy"] },
    { id: "pizza_pepperoni", name: "Pizza, pepperoni", m: [298, 13.3, 31.7, 13.4], servings: [["1 slice (111 g)", 111]], allergens: ["gluten", "milk"], contains: ["meat", "dairy"] },
    { id: "fried_chicken_piece", name: "Fried chicken, fast food, breaded", m: [250, 21, 10, 14], servings: [["1 piece (130 g)", 130]], allergens: ["gluten"], contains: ["poultry"] },
    { id: "chicken_nuggets", name: "Chicken nuggets, fast food", m: [296, 15.5, 17, 18.5], servings: [["6 pieces (96 g)", 96]], allergens: ["gluten"], contains: ["poultry"] },
    { id: "hot_dog_bun", name: "Hot dog in bun", m: [247, 10, 23, 13], servings: [["1 hot dog (98 g)", 98]], allergens: ["gluten"], contains: ["meat"] },
    { id: "taco_beef", name: "Taco, beef, hard shell", m: [226, 9.4, 20, 12.5], servings: [["1 taco (78 g)", 78]], allergens: ["gluten", "milk"], contains: ["meat", "dairy"] },
    { id: "burrito_beef_bean", name: "Burrito, beef and bean", m: [206, 8.7, 26, 7.2], servings: [["1 burrito (190 g)", 190]], allergens: ["gluten"], contains: ["meat"] },
    { id: "sandwich_ham_cheese", name: "Sandwich, ham and cheese", m: [250, 13, 28, 9.5], servings: [["1 sandwich (150 g)", 150]], allergens: ["gluten", "milk"], contains: ["meat", "dairy"] },
    { id: "onion_rings", name: "Onion rings, breaded, fried", m: [411, 4.8, 44, 24], servings: [["6 rings (70 g)", 70]], allergens: ["gluten"] },
  ]),

  // Prepared dishes
  ...group("dish", [
    { id: "spaghetti_bolognese", name: "Spaghetti with meat sauce", m: [135, 6.3, 16, 5], servings: [["1 cup (248 g)", 248]], vol: ["cup", 248], allergens: ["gluten"], contains: ["meat"] },
    { id: "mac_and_cheese", name: "Macaroni and cheese", m: [164, 7.2, 19.5, 6.5], servings: [["1 cup (200 g)", 200]], vol: ["cup", 200], allergens: ["gluten", "milk"], contains: ["dairy"] },
    { id: "lasagna_meat", name: "Lasagna, meat", m: [135, 8, 13, 5.7], servings: [["1 piece (250 g)", 250]], allergens: ["gluten", "milk", "eggs"], contains: ["meat", "dairy", "egg"] },
    { id: "fried_rice_chicken", name: "Fried rice, takeaway style, with chicken", m: [163, 7.3, 20, 5.4], servings: [["1 cup (190 g)", 190]], vol: ["cup", 190], allergens: ["eggs", "soy"], contains: ["poultry", "egg"] },
    { id: "beef_stew", name: "Beef stew with vegetables", m: [91, 6.7, 7.9, 3.5], servings: [["1 cup (245 g)", 245]], vol: ["cup", 245], contains: ["meat"] },
    { id: "chili_con_carne", name: "Chili con carne", m: [130, 9, 10.5, 6], servings: [["1 cup (250 g)", 250]], vol: ["cup", 250], contains: ["meat"] },
    { id: "chicken_noodle_soup", name: "Chicken noodle soup", m: [36, 2.5, 3.8, 1.2], servings: [["1 cup (248 g)", 248]], vol: ["cup", 248], allergens: ["gluten", "eggs", "celery"], contains: ["poultry", "egg"] },
    { id: "tomato_soup", name: "Tomato soup", m: [43, 1.3, 7.7, 1], servings: [["1 cup (248 g)", 248]], vol: ["cup", 248] },
    { id: "lentil_soup", name: "Lentil soup", m: [56, 3.9, 9.2, 0.6], servings: [["1 cup (248 g)", 248]], vol: ["cup", 248], allergens: ["celery"] },
    { id: "mashed_potatoes", name: "Mashed potatoes with milk and butter", m: [92, 1.9, 15.5, 2.5], servings: [["1 cup (210 g)", 210]], vol: ["cup", 210], allergens: ["milk"], contains: ["dairy"] },
    { id: "sushi_california_roll", name: "Sushi roll, California", m: [126, 3.2, 18.4, 4.5], servings: [["6 pieces (170 g)", 170]], allergens: ["crustaceans", "sesame"], contains: ["shellfish"] },
    { id: "falafel", name: "Falafel", m: [333, 13.3, 31.8, 17.8], servings: [["1 patty (17 g)", 17]], allergens: ["sesame"] },
    { id: "chicken_tikka_masala", name: "Chicken tikka masala", m: [143, 10, 6, 8.5], servings: [["1 cup (240 g)", 240]], vol: ["cup", 240], allergens: ["milk"], contains: ["poultry", "dairy"] },
    { id: "omelette_plain", name: "Omelette, plain", m: [154, 10.6, 0.6, 11.7], servings: [["2-egg omelette (120 g)", 120]], allergens: ["eggs", "milk"], contains: ["egg", "dairy"] },
    { id: "vegetable_stir_fry", name: "Vegetable stir-fry", m: [75, 2.4, 8.4, 3.6], servings: [["1 cup (150 g)", 150]], vol: ["cup", 150], allergens: ["soy"] },
    { id: "dumplings_pork", name: "Dumplings, pork, steamed", m: [220, 10, 24, 9.6], servings: [["4 dumplings (120 g)", 120]], allergens: ["gluten", "soy"], contains: ["meat"] },
    { id: "caesar_salad_chicken", name: "Caesar salad with chicken", m: [127, 9.5, 5.5, 7.5], servings: [["1 bowl (250 g)", 250]], allergens: ["gluten", "milk", "eggs", "fish"], contains: ["poultry", "dairy", "egg", "fish"] },
    { id: "shakshuka", name: "Shakshuka (eggs in tomato sauce)", m: [78, 4.5, 6, 4.5], servings: [["1 cup (240 g)", 240]], vol: ["cup", 240], allergens: ["eggs"], contains: ["egg"] },
    { id: "pad_thai_chicken", name: "Pad Thai with chicken", m: [153, 8, 18.5, 5], servings: [["1 cup (200 g)", 200]], vol: ["cup", 200], allergens: ["peanuts", "eggs", "soy", "fish"], contains: ["poultry", "egg", "fish"] },
    { id: "bean_burrito_bowl", name: "Rice and bean bowl", m: [118, 4.3, 21, 1.8], servings: [["1 bowl (300 g)", 300]] },
    { id: "greek_salad", name: "Greek salad with feta", m: [80, 2.6, 5.2, 5.6], servings: [["1 bowl (220 g)", 220]], allergens: ["milk"], contains: ["dairy"] },
  ]),
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

const CATEGORY_BY_ID = new Map(ROWS.map((r) => [`${VERIFIED_FOOD_PREFIX}${r.id}`, r.cat]));

/** Name patterns for foods that are not in the database (user foods), checked in order. */
const NAME_CATEGORIES: [FoodCategory, RegExp][] = [
  ["drink", /\b(juice|soda|cola|coffee|latte|tea|smoothie|shake|milk|water|drink|lemonade|kombucha)\b/i],
  ["fast_food", /\b(burger|fries|nuggets|hot dog|kebab|taco|burrito|pizza)\b/i],
  ["sweet", /\b(cake|cookie|biscuit|candy|chocolate|ice cream|dessert|pudding|donut|doughnut|brownie|sweet|syrup|jam)\b/i],
  ["snack", /\b(chips|crisps|popcorn|pretzel|snack|cracker|bar)\b/i],
  ["egg", /\b(eggs?|omelette|omelet)\b/i],
  ["dairy", /\b(cheese|yogurt|yoghurt|cream|butter|kefir)\b/i],
  ["plant_protein", /\b(tofu|tempeh|seitan|vegan|plant-based)\b/i],
  ["poultry", /\b(chicken|turkey|duck)\b/i],
  ["fish", /\b(fish|salmon|tuna|cod|shrimp|prawn|crab|lobster|sardine|trout|squid|mussel|oyster)\b/i],
  ["meat", /\b(beef|steak|pork|bacon|ham|lamb|sausage|meat|salami|jerky)\b/i],
  ["legume", /\b(beans?|lentils?|chickpeas?|peas|hummus|dal)\b/i],
  ["nut", /\b(nuts?|almonds?|walnuts?|cashews?|seeds?|peanuts?)\b/i],
  ["oil", /\b(oil|sauce|dressing|mayo|mayonnaise|ketchup|vinegar)\b/i],
  ["bread", /\b(bread|toast|bagel|roll|bun|tortilla|wrap|pancake|waffle)\b/i],
  ["grain", /\b(rice|pasta|noodles?|oats?|oatmeal|cereal|quinoa|couscous|flour|spaghetti|muesli|granola)\b/i],
  ["fruit", /\b(apple|banana|orange|berry|berries|grapes?|mango|pear|peach|melon|fruit|lemon|cherry|cherries|kiwi|pineapple)\b/i],
  ["vegetable", /\b(salad|carrot|potato|tomato|broccoli|spinach|onion|pepper|cucumber|lettuce|cabbage|vegetables?|veggies|mushrooms?|zucchini|corn)\b/i],
  ["dish", /\b(soup|stew|curry|casserole|lasagna|risotto|sushi|bowl|stir-fry|sandwich|salad)\b/i],
];

/** The category of a food: from the database for verified foods, from its name otherwise. */
export function foodCategory(food: { id: string; name: string }): FoodCategory {
  const known = CATEGORY_BY_ID.get(food.id);
  if (known) return known;
  return NAME_CATEGORIES.find(([, re]) => re.test(food.name))?.[0] ?? "other";
}

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
