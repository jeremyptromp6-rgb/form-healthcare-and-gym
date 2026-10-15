import { describe, expect, it } from "vitest";
import { computeMuscleRanks, PREMIUM_FEATURES, weakMuscleFocus } from "../src";

const squats = (n: number) => Array.from({ length: n }, () => ({ exerciseId: "squat", verifiedReps: 5 }));

describe("weakMuscleFocus", () => {
  it("is null for a user with nothing trained in the window", () => {
    expect(weakMuscleFocus(computeMuscleRanks([]), null)).toBeNull();
  });

  it("takes the 3 lowest-ranked muscles a focus area can train (traps and forearms never steer)", () => {
    const r = weakMuscleFocus(computeMuscleRanks(squats(6)), null)!;
    expect(r.muscles).toEqual(["chest", "back", "lats"]);
    expect(r.focusAreas).toEqual(["chest", "back"]);
  });

  it("treats full body as no choice, keeps the user's own focus first, and adds at most one weak area", () => {
    const ranks = computeMuscleRanks(squats(6));
    expect(weakMuscleFocus(ranks, ["full_body"])!.muscles).toHaveLength(3);
    const own = weakMuscleFocus(ranks, ["legs", "core"])!;
    expect(own.focusAreas).toEqual(["legs", "core", "chest"]);
    expect(own.muscles).toEqual(["chest"]);
  });
});

describe("Pro lineup", () => {
  it("leads with the six headline benefits in order, with the new ids present", () => {
    expect(PREMIUM_FEATURES.filter((f) => f.headline).map((f) => f.id)).toEqual(["FOOD_SCANNER_PREMIUM", "STREAK_SHIELD", "WEAK_MUSCLE_PLANS", "AD_FREE", "ADVANCED_PROGRESS", "MEAL_PLANNER_ADVANCED"]);
    expect(PREMIUM_FEATURES.slice(0, 6).every((f) => f.headline)).toBe(true);
  });
});
