import { describe, expect, it } from "vitest";
import { FOOD_CATEGORIES, VERIFIED_FOODS, foodCategory, verifiedFood } from "../src";

describe("food catalog categories", () => {
  it("is a broad database with every category used and unique ids", () => {
    expect(VERIFIED_FOODS.length).toBeGreaterThanOrEqual(240);
    expect(new Set(VERIFIED_FOODS.map((f) => f.id)).size).toBe(VERIFIED_FOODS.length);
    const used = new Set(VERIFIED_FOODS.map((f) => foodCategory(f)));
    for (const c of FOOD_CATEGORIES.filter((c) => c !== "other")) expect(used.has(c), c).toBe(true);
    expect(used.has("other")).toBe(false);
  });

  it("keeps the original ids", () => {
    for (const id of ["chicken_breast_cooked", "banana", "olive_oil", "coffee_black", "tofu_firm", "honey"]) expect(verifiedFood(`fdb:${id}`), id).not.toBeNull();
  });

  it("categorises verified foods from the database and other foods from their name", () => {
    expect(foodCategory(verifiedFood("fdb:banana")!)).toBe("fruit");
    expect(foodCategory(verifiedFood("fdb:salmon_cooked")!)).toBe("fish");
    expect(foodCategory(verifiedFood("fdb:coffee_black")!)).toBe("drink");
    expect(foodCategory({ id: "u1", name: "Protein bar" })).toBe("snack");
    expect(foodCategory({ id: "u2", name: "Grandma's chicken soup" })).toBe("poultry");
    expect(foodCategory({ id: "u3", name: "Mystery thing" })).toBe("other");
  });
});
