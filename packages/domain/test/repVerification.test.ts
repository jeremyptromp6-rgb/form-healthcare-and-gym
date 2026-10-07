import { describe, expect, it } from "vitest";
import { DomainValidationError, ROM_SPECS, verifyReps, type AngleSample } from "../src";

const spec = ROM_SPECS.squat;

/** Builds a trace of squat reps: top (170°) → bottom → top, `repMs` per rep. */
function squats(bottoms: number[], repMs = 2000, confidence = 0.9): AngleSample[] {
  const samples: AngleSample[] = [];
  let t = 0;
  const step = repMs / 10;
  for (const bottom of bottoms) {
    for (let i = 0; i <= 10; i++) {
      const phase = i <= 5 ? i / 5 : (10 - i) / 5; // 0 → 1 → 0
      samples.push({ tMs: t, angleDeg: 170 - (170 - bottom) * phase, confidence });
      t += step;
    }
  }
  return samples;
}

describe("Rep Verification Engine", () => {
  it("counts full-depth reps", () => {
    const r = verifyReps({ poseStatus: "ok", samples: squats([90, 95, 85]) }, spec);
    expect(r.status).toBe("verified");
    expect(r.verifiedReps).toBe(3);
    expect(r.rejected).toEqual([]);
    // ROM is against the reference range (170° → 90°): the 95° rep is 94%.
    expect(r.averageRomPercent).toBe(98);
  });

  it("returns per-rep details for every verified rep", () => {
    const r = verifyReps({ poseStatus: "ok", samples: squats([90, 110 - 15]) }, spec);
    expect(r.reps.map((x) => x.index)).toEqual([0, 1]);
    expect(r.reps[0]).toMatchObject({ minAngleDeg: 90, romPercent: 100 });
    expect(r.reps[1]!.romPercent).toBe(94);
    expect(r.reps.every((x) => x.durationMs >= spec.minRepDurationMs)).toBe(true);
  });

  it("measures duration from the last moment at the top, not from partway down (regression)", () => {
    // Slow controlled descent: 600 ms at the top-to-threshold phase, then a quick bottom and return.
    // Timed from the top this rep takes 900 ms (valid); timed from the threshold crossing it would look too fast.
    const samples = [
      { tMs: 0, angleDeg: 170, confidence: 1 },
      { tMs: 600, angleDeg: 145, confidence: 1 },
      { tMs: 700, angleDeg: 95, confidence: 1 },
      { tMs: 900, angleDeg: 170, confidence: 1 },
    ];
    const r = verifyReps({ poseStatus: "ok", samples }, spec);
    expect(r.verifiedReps).toBe(1);
    expect(r.reps[0]!.durationMs).toBe(900);
  });

  it("rejects partial-ROM reps", () => {
    const r = verifyReps({ poseStatus: "ok", samples: squats([90, 125, 95]) }, spec);
    expect(r.verifiedReps).toBe(2);
    expect(r.rejected).toMatchObject([{ reason: "insufficient_rom", minAngleDeg: 125 }]);
  });

  it("rejects implausibly fast reps", () => {
    const r = verifyReps({ poseStatus: "ok", samples: squats([90, 90], 300) }, spec);
    expect(r.verifiedReps).toBe(0);
    expect(r.rejected.every((x) => x.reason === "too_fast")).toBe(true);
  });

  it("ignores small jitter at the top", () => {
    const jitter = Array.from({ length: 30 }, (_, i) => ({ tMs: i * 50, angleDeg: 165 - (i % 3) * 5, confidence: 0.9 }));
    expect(verifyReps({ poseStatus: "ok", samples: jitter }, spec).verifiedReps).toBe(0);
  });

  it("does not count a rep that never returns to the top", () => {
    const samples = squats([90]).slice(0, 8);
    expect(verifyReps({ poseStatus: "ok", samples }, spec).verifiedReps).toBe(0);
  });

  it("counts zero reps when pose is unavailable, even if samples are supplied", () => {
    const r = verifyReps({ poseStatus: "unavailable", samples: squats([90, 90]) }, spec);
    expect(r).toEqual({ status: "pose_unavailable", verifiedReps: 0, reps: [], rejected: [], incomplete: false, averageRomPercent: null, gatedFrames: {} });
  });

  it("reports camera permission denied", () => {
    expect(verifyReps({ poseStatus: "permission_denied", samples: [] }, spec).status).toBe("permission_denied");
  });

  it("refuses to verify from mostly low-confidence data", () => {
    const r = verifyReps({ poseStatus: "ok", samples: squats([90, 90], 2000, 0.2) }, spec);
    expect(r.status).toBe("insufficient_data");
    expect(r.verifiedReps).toBe(0);
  });

  it("treats an empty trace as insufficient data", () => {
    expect(verifyReps({ poseStatus: "ok", samples: [] }, spec).status).toBe("insufficient_data");
  });

  it("rejects malformed traces", () => {
    expect(() =>
      verifyReps({ poseStatus: "ok", samples: [{ tMs: 10, angleDeg: 170, confidence: 1 }, { tMs: 5, angleDeg: 90, confidence: 1 }] }, spec),
    ).toThrow(DomainValidationError);
    expect(() => verifyReps({ poseStatus: "ok", samples: [{ tMs: 0, angleDeg: 900, confidence: 1 }] }, spec)).toThrow();
  });
});
