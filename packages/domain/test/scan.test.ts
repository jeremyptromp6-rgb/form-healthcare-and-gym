import { describe, expect, it } from "vitest";
import {
  presentMacros,
  buildScanReview,
  buildUserFood,
  confidenceBand,
  developmentRecognitionProvider,
  estimateItem,
  matchCatalogFood,
  resolveScanSelections,
  sanitizeRecognition,
  sanitizeScanBox,
  sanitizeSummary,
  ScanSelectionError,
  VERIFIED_FOODS,
  verifiedFood,
  type RecognitionResult,
  type RecognizedFood,
  type ScanReview,
} from "../src";

const item = (over: Partial<RecognizedFood> = {}): RecognizedFood => ({
  label: "Banana",
  confidence: 0.9,
  alternatives: [],
  servingGrams: 120,
  servingLowGrams: 100,
  servingHighGrams: 140,
  per100g: { kcal: 90, proteinG: 1, carbsG: 23, fatG: 0.3 },
  hiddenIngredients: [],
  composite: false,
  ...over,
});
const result = (items: RecognizedFood[], over: Partial<RecognitionResult> = {}): RecognitionResult => ({ imageQuality: "ok", containsFood: true, items, ...over });

describe("sanitizing provider output (untrusted input)", () => {
  it("clamps confidences and portions, orders the range and drops unusable items", () => {
    const r = sanitizeRecognition(
      result([
        item({ confidence: 1.7, servingGrams: 99999, servingLowGrams: 5000, servingHighGrams: 10 }),
        item({ label: "  ", confidence: 0.5 }),
        item({ label: "Mystery", per100g: { kcal: 2000, proteinG: 0, carbsG: 0, fatG: 0 } }), // denser than fat
        item({ label: "Soup", alternatives: [{ label: "soup", confidence: 0.4, per100g: { kcal: 40, proteinG: 2, carbsG: 5, fatG: 1 } }] }),
      ]),
    );
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ confidence: 1, servingGrams: 2000, servingLowGrams: 2000, servingHighGrams: 2000 });
    expect(r.items[1]!.alternatives).toEqual([]); // an alternative identical to the label is noise
  });

  it("caps the number of items and alternatives", () => {
    const many = sanitizeRecognition(result(Array.from({ length: 20 }, (_, i) => item({ label: `Food ${i}`, alternatives: Array.from({ length: 9 }, (_, j) => ({ label: `Alt ${j}`, confidence: 0.1, per100g: { kcal: 50, proteinG: 1, carbsG: 10, fatG: 0 } })) }))));
    expect(many.items).toHaveLength(8);
    expect(many.items[0]!.alternatives).toHaveLength(3);
  });
});

describe("food location boxes and the meal summary", () => {
  it("sanitizeScanBox keeps a valid box, rounds and clamps, and drops everything unusable", () => {
    expect(sanitizeScanBox([300, 60, 700, 440])).toEqual([300, 60, 700, 440]);
    expect(sanitizeScanBox([300.4, 59.6, 699.5, 440.2])).toEqual([300, 60, 700, 440]);
    expect(sanitizeScanBox([-50, -10, 500, 1200])).toEqual([0, 0, 500, 1000]); // out of range is clamped
    expect(sanitizeScanBox([700, 440, 300, 60])).toBeUndefined(); // swapped corners
    expect(sanitizeScanBox([300, 60, 300, 440])).toBeUndefined(); // no height
    expect(sanitizeScanBox([100, 100, 110, 900])).toBeUndefined(); // a sliver
    expect(sanitizeScanBox([100, 100, 130, 130])).toBeUndefined(); // 30x30 = 900 is a speck
    expect(sanitizeScanBox([100, 100, 150, 150])).toEqual([100, 100, 150, 150]); // 50x50 = 2500 is the smallest
    expect(sanitizeScanBox([100, 100, 700])).toBeUndefined(); // wrong length
    expect(sanitizeScanBox([100, 100, 700, 700, 5])).toBeUndefined();
    expect(sanitizeScanBox([])).toBeUndefined();
    expect(sanitizeScanBox([100, "100", 700, 700])).toBeUndefined(); // not numbers
    expect(sanitizeScanBox([100, Number.NaN, 700, 700])).toBeUndefined();
    expect(sanitizeScanBox([100, 100, Number.POSITIVE_INFINITY, 700])).toBeUndefined();
    expect(sanitizeScanBox(null)).toBeUndefined();
    expect(sanitizeScanBox("300,60,700,440")).toBeUndefined();
    expect(sanitizeScanBox({ 0: 1, length: 4 })).toBeUndefined();
  });

  it("sanitizeSummary strips markup, collapses whitespace and quotes, and caps the length", () => {
    expect(sanitizeSummary('  "Grilled chicken with **rice**"  ')).toBe("Grilled chicken with rice");
    expect(sanitizeSummary("Rice\n\tand <beans> `on` a plate\u0007")).toBe("Rice and beans on a plate");
    const long = "Grilled chicken with rice and steamed broccoli, ".repeat(10);
    const cut = sanitizeSummary(long)!;
    expect(cut.length).toBeLessThanOrEqual(160);
    expect(cut.endsWith("…")).toBe(true);
    expect(cut).not.toMatch(/[\s,]…$/);
    expect(cut.slice(0, -1)).toMatch(/(broccoli|rice|and|with|chicken|steamed|Grilled)$/); // cut at a word boundary
    expect(sanitizeSummary("Rice and beans.")).toBe("Rice and beans."); // no ellipsis when nothing was cut
  });

  it("sanitizeSummary refuses calorie and gram figures, non-strings and near-empty text", () => {
    expect(sanitizeSummary("About 600 kcal of chicken and rice.")).toBeUndefined();
    expect(sanitizeSummary("A chicken dish, high in calories.")).toBeUndefined();
    expect(sanitizeSummary("A bowl with 150g of rice.")).toBeUndefined();
    expect(sanitizeSummary("A bowl with 150 g of rice.")).toBeUndefined();
    expect(sanitizeSummary("Two grilled chicken pieces with rice.")).toBe("Two grilled chicken pieces with rice."); // "g" inside words is fine
    expect(sanitizeSummary(42)).toBeUndefined();
    expect(sanitizeSummary(undefined)).toBeUndefined();
    expect(sanitizeSummary("  **  ")).toBeUndefined();
    expect(sanitizeSummary("ab")).toBeUndefined();
  });

  it("sanitizeRecognition keeps a valid box and summary, and drops invalid ones WITHOUT dropping the item", () => {
    const r = sanitizeRecognition(
      result([item({ label: "Rice", box: [300.2, 60, 700, 440] }), item({ label: "Chicken", box: [700, 440, 300, 60] }), item({ label: "Greens" })], { summary: "  Rice, chicken and greens.  " }),
    );
    expect(r.items.map((i) => i.label)).toEqual(["Rice", "Chicken", "Greens"]);
    expect(r.items[0]!.box).toEqual([300, 60, 700, 440]);
    expect("box" in r.items[1]!).toBe(false); // no undefined-valued key
    expect("box" in r.items[2]!).toBe(false);
    expect(r.summary).toBe("Rice, chicken and greens.");
    const bad = sanitizeRecognition(result([item()], { summary: "600 kcal" }));
    expect("summary" in bad).toBe(false);
    expect("summary" in sanitizeRecognition(result([item()]))).toBe(false);
  });

  it("buildScanReview passes the box and summary through", () => {
    const review = buildScanReview(result([item({ label: "Banana", box: [100, 100, 500, 500] }), item({ label: "Apple" })], { summary: "A banana and an apple." }), VERIFIED_FOODS);
    expect(review.status).toBe("ok");
    expect(review.summary).toBe("A banana and an apple.");
    expect(review.items[0]!.box).toEqual([100, 100, 500, 500]);
    expect("box" in review.items[1]!).toBe(false);
    const plain = buildScanReview(result([item()]), VERIFIED_FOODS);
    expect("summary" in plain).toBe(false);
    expect("box" in plain.items[0]!).toBe(false);
  });

  it("an old stored review without the fields still loads and resolves", () => {
    const old = JSON.parse(JSON.stringify(buildScanReview(result([item({ label: "Banana" })]), VERIFIED_FOODS))) as ScanReview;
    expect(old.summary).toBeUndefined();
    expect(old.items[0]!.box).toBeUndefined();
    expect(resolveScanSelections(old, [{ itemId: "i1" }])).toHaveLength(1);
  });
});

describe("catalog matching", () => {
  it("maps simple foods to the verified database, preferring cooked entries", () => {
    expect(matchCatalogFood("banana", VERIFIED_FOODS)?.id).toBe("fdb:banana");
    expect(matchCatalogFood("Grilled chicken breast", VERIFIED_FOODS)?.id).toBe("fdb:chicken_breast_cooked");
    expect(matchCatalogFood("white rice", VERIFIED_FOODS)?.id).toBe("fdb:rice_white_cooked");
    expect(matchCatalogFood("Scrambled eggs", VERIFIED_FOODS)).toBeNull(); // "scrambled" isn't a raw egg
    expect(matchCatalogFood("eggs", VERIFIED_FOODS)?.id).toMatch(/^fdb:egg/);
  });

  it("never maps a mixed dish or an ambiguous label onto one ingredient", () => {
    expect(matchCatalogFood("Chicken curry", VERIFIED_FOODS)).toBeNull();
    expect(matchCatalogFood("chicken breast", VERIFIED_FOODS, { composite: true })).toBeNull();
    expect(matchCatalogFood("chicken", VERIFIED_FOODS)).toBeNull(); // breast? thigh? — too ambiguous
    expect(matchCatalogFood("the", VERIFIED_FOODS)).toBeNull();
  });
});

describe("building the review", () => {
  it("no food / unknown food / poor image", () => {
    expect(buildScanReview(result([], { containsFood: false }), VERIFIED_FOODS).status).toBe("no_food");
    expect(buildScanReview(result([]), VERIFIED_FOODS).status).toBe("unknown_food");
    expect(buildScanReview(result([item({ confidence: 0.2 })], { imageQuality: "blurry" }), VERIFIED_FOODS)).toMatchObject({ status: "poor_image", imageQuality: "blurry", items: [] });
    // Poor quality but a confident detection still gets a review (with the quality note).
    expect(buildScanReview(result([item({ confidence: 0.9 })], { imageQuality: "too_dark" }), VERIFIED_FOODS).status).toBe("ok");
  });

  it("multiple foods with confidence bands, alternatives and nutrition sources", () => {
    const review = buildScanReview(
      result([
        item({ label: "Grilled chicken breast", confidence: 0.88 }),
        item({ label: "Chicken curry", confidence: 0.6, composite: true, hiddenIngredients: ["oil", "cream"] }),
        item({ label: "Greens", confidence: 0.3, alternatives: [{ label: "Broccoli", confidence: 0.25, per100g: { kcal: 34, proteinG: 2.8, carbsG: 6.6, fatG: 0.4 } }] }),
      ]),
      VERIFIED_FOODS,
    );
    expect(review.status).toBe("ok");
    expect(review.items.map((i) => [i.id, i.band, i.needsChoice])).toEqual([
      ["i1", "high", false],
      ["i2", "medium", false],
      ["i3", "low", true],
    ]);
    expect(review.items[0]!.options[0]).toMatchObject({ nutritionSource: "verified_database", foodId: "fdb:chicken_breast_cooked", per100: { kcal: 165 } });
    expect(review.items[1]!.options[0]).toMatchObject({ nutritionSource: "recognizer_estimate", foodId: null });
    expect(review.items[2]!.options.map((o) => o.key)).toEqual(["primary", "alt1"]);
    expect(review.items[2]!.options[1]!.nutritionSource).toBe("verified_database"); // "Broccoli" → Broccoli, boiled
  });

  it("confidence bands are about identity only", () => {
    expect([0.9, 0.75, 0.6, 0.45, 0.2].map(confidenceBand)).toEqual(["high", "high", "medium", "medium", "low"]);
  });
});

describe("estimated nutrition: confidence and accuracy are separate", () => {
  const review = buildScanReview(
    result([item({ label: "Banana", confidence: 0.95 }), item({ label: "Chicken curry", confidence: 0.95, composite: true, hiddenIngredients: ["oil"], per100g: { kcal: 150, proteinG: 12, carbsG: 6, fatG: 9 } })]),
    VERIFIED_FOODS,
  );

  it("a confidently recognised mixed dish still gets a rough, wide estimate", () => {
    const banana = review.items[0]!;
    const curry = review.items[1]!;
    const b = estimateItem(banana, banana.options[0]!, 120);
    const c = estimateItem(curry, curry.options[0]!, 120);
    expect(b.accuracy).toBe("reference");
    expect(c.accuracy).toBe("rough");
    expect(b.kcal).toBe(107);
    expect(b.kcalLow).toBeLessThan(b.kcal);
    expect(b.kcalHigh).toBeGreaterThan(b.kcal);
    expect((c.kcalHigh - c.kcalLow) / c.kcal).toBeGreaterThan((b.kcalHigh - b.kcalLow) / b.kcal);
  });

  it("the range follows an edited amount", () => {
    const banana = review.items[0]!;
    const small = estimateItem(banana, banana.options[0]!, 60);
    expect(small.kcal).toBe(53);
    expect(small.kcalHigh).toBeLessThan(estimateItem(banana, banana.options[0]!, 120).kcalHigh);
  });
});

describe("resolving the user's choices", () => {
  const review = buildScanReview(
    result([
      item({ label: "Banana", confidence: 0.9 }),
      item({ label: "Greens", confidence: 0.3, alternatives: [{ label: "Broccoli", confidence: 0.3, per100g: { kcal: 34, proteinG: 2.8, carbsG: 6.6, fatG: 0.4 } }] }),
      item({ label: "Cookie", confidence: 0.8, per100g: { kcal: 480, proteinG: 5, carbsG: 65, fatG: 22 } }),
    ]),
    VERIFIED_FOODS,
  );

  it("keeps, switches, edits the amount, picks another food and removes items", () => {
    const oats = verifiedFood("fdb:oats_dry")!;
    const entries = resolveScanSelections(review, [
      { itemId: "i1", amount: 60 },
      { itemId: "i2", optionKey: "alt1", amount: 100 },
      { itemId: "i3", food: oats, amount: 40 },
    ]);
    expect(entries.map((e) => [e.name, e.amount, presentMacros(e.macros).kcal])).toEqual([
      ["Banana", 60, 53],
      ["Broccoli", 100, 35],
      ["Oats, rolled, dry", 40, 152],
    ]);
    expect(entries[1]!.foodId).toBe("fdb:broccoli_cooked");
    expect(entries[0]!.macros.kcal).toBeCloseTo(53.4, 9); // stored exact, rounded only for display
    expect(resolveScanSelections(review, [{ itemId: "i1" }, { itemId: "i2", optionKey: "primary" }, { itemId: "i3", remove: true }])).toHaveLength(2);
  });

  it("low-confidence items need an explicit choice; every item needs a decision", () => {
    expect(() => resolveScanSelections(review, [{ itemId: "i1" }, { itemId: "i2" }, { itemId: "i3" }])).toThrow(/choose the right food/);
    expect(() => resolveScanSelections(review, [{ itemId: "i1" }, { itemId: "i2", optionKey: "alt1" }])).toThrow(/needs a decision/);
    expect(() => resolveScanSelections(review, [{ itemId: "i9" }])).toThrow(ScanSelectionError);
  });

  it("refuses empty confirmations, bad options and impossible amounts", () => {
    const all = ["i1", "i2", "i3"];
    expect(() => resolveScanSelections(review, all.map((itemId) => ({ itemId, remove: true })))).toThrow(/nothing left/);
    expect(() => resolveScanSelections(review, [{ itemId: "i1", optionKey: "alt7" }, { itemId: "i2", remove: true }, { itemId: "i3", remove: true }])).toThrow(ScanSelectionError);
    expect(() => resolveScanSelections(review, [{ itemId: "i1", amount: 0 }, { itemId: "i2", remove: true }, { itemId: "i3", remove: true }])).toThrow(/plausible/);
    expect(() => resolveScanSelections(review, [{ itemId: "i1", amount: 50_000 }, { itemId: "i2", remove: true }, { itemId: "i3", remove: true }])).toThrow(/plausible/);
  });

  it("a user food picked instead keeps its own basis", () => {
    const shake = buildUserFood("u1", { name: "Protein shake", basis: "ml", servingLabel: "1 bottle", servingAmount: 330, perServing: { kcal: 200, proteinG: 30, carbsG: 10, fatG: 4 } });
    const [e] = resolveScanSelections(review, [{ itemId: "i1", food: shake, amount: 330 }, { itemId: "i2", remove: true }, { itemId: "i3", remove: true }]);
    expect(e).toMatchObject({ name: "Protein shake", basis: "ml", foodId: "u1", macros: { kcal: 200 } });
  });
});

describe("development fallback", () => {
  it("is clearly marked and doesn't pretend to look at the photo", async () => {
    const dev = developmentRecognitionProvider();
    expect(dev.development).toBe(true);
    expect(dev.status()).toMatchObject({ provider: expect.stringMatching(/not real recognition/) });
    const a = await dev.recognize({ mimeType: "image/jpeg", data: new Uint8Array([1, 2, 3]) });
    const b = await dev.recognize({ mimeType: "image/png", data: new Uint8Array([9, 9, 9, 9]) });
    expect(a).toEqual(b); // same sample whatever the image
    expect(buildScanReview((a as { ok: true; value: RecognitionResult }).value, VERIFIED_FOODS).items).toHaveLength(3);
  });

  it("returns plausible boxes and a summary so the review UI can be tried", async () => {
    const r = await developmentRecognitionProvider().recognize({ mimeType: "image/jpeg", data: new Uint8Array([1]) });
    const value = (r as { ok: true; value: RecognitionResult }).value;
    const review = buildScanReview(value, VERIFIED_FOODS);
    expect(review.summary).toBe("Grilled chicken with white rice and green vegetables.");
    expect(review.items.map((i) => i.box)).toEqual([
      [300, 60, 700, 440],
      [320, 480, 720, 880],
      [60, 300, 300, 700],
    ]);
    for (const i of review.items) expect(sanitizeScanBox(i.box)).toEqual(i.box);
  });
});
