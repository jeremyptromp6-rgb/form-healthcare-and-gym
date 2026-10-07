import { describe, expect, it } from "vitest";
import {
  analyzeSet,
  assessFraming,
  CAMERA_REQUIREMENTS,
  evaluateSet,
  exerciseAnalyzer,
  FEEDBACK_TIMING,
  keepRecorded,
  LivePoseSession,
  LiveRepVerifier,
  MovementStateMachine,
  ROM_SPECS,
  setVerifiedEvent,
  toPixelSpace,
  verifyReps,
  type AngleSample,
  type LiveRepState,
  type PosePerson,
} from "../src";
import { curlFrame, detection, FRAME, lungeFrame, pushUpFrame, repAngles, squatFrame, type CurlOpts, type PushUpOpts, type SquatOpts } from "./poseFixtures";

const FPS = 30;
const DT = 1000 / FPS;

type Builder = (angle: number, depth: number) => PosePerson[];
interface RepPlan {
  bottom: number;
  repMs?: number;
  top?: number;
  /** Frame transform for this rep (bad form, occlusion…), given the frame index within the rep. */
  frames?: (people: PosePerson[], i: number, n: number) => PosePerson[];
}

const TOPS: Record<string, number> = { bodyweight_squat: 172, lunge: 172, push_up: 168, bicep_curl: 162 };

/** Runs a planned set through the full on-device pipeline and the server's analysis of its trace. */
function runSet(exerciseId: string, build: Builder, plan: RepPlan[], opts: { lead?: number; session?: LivePoseSession; t0?: number; top?: number } = {}) {
  const session = opts.session ?? LivePoseSession.for(exerciseId)!;
  const spec = ROM_SPECS[exerciseId as keyof typeof ROM_SPECS];
  let t = opts.t0 ?? 0;
  const top0 = opts.top ?? TOPS[exerciseId]!;
  const push = (people: PosePerson[]) => {
    const f = session.push(detection(people, t));
    t += DT;
    return f;
  };
  const phases: string[] = [];
  for (let i = 0; i < (opts.lead ?? 10); i++) push(build(top0, 0));
  for (const rep of plan) {
    const top = rep.top ?? top0;
    const angles = repAngles(top, rep.bottom, rep.repMs ?? 2000, FPS);
    angles.forEach((a, i) => {
      const depth = Math.max(0, Math.min(1, (top - a) / (top - spec.fullRomBottomDeg)));
      const people = build(a, depth);
      const f = push(rep.frames ? rep.frames(people, i, angles.length) : people);
      const label = (session.reps as LiveRepVerifier).state(f.timestampMs).phaseLabel;
      if (phases.at(-1) !== label) phases.push(label);
    });
  }
  for (let i = 0; i < 10; i++) push(build(top0, 0));
  const live = (session.reps as LiveRepVerifier).state(t);
  const server = analyzeSet(exerciseId, session.trace())!;
  return { session, live, server, phases, t };
}

const squat = (mod: Partial<SquatOpts> | ((d: number) => Partial<SquatOpts>) = {}): Builder => (angle, d) => [
  squatFrame({ kneeDeg: angle, leanDeg: 10 + 30 * d, ...(typeof mod === "function" ? mod(d) : mod) }),
];
const lunge = (mod: (d: number) => Partial<SquatOpts> = () => ({})): Builder => (angle, d) => [lungeFrame({ kneeDeg: angle, ...mod(d) })];
const pushUp = (mod: (d: number) => Partial<PushUpOpts> = () => ({})): Builder => (angle, d) => [pushUpFrame({ elbowDeg: angle, ...mod(d) })];
const curl = (mod: (d: number) => Partial<CurlOpts> = () => ({})): Builder => (angle, d) => [curlFrame({ elbowDeg: angle, ...mod(d) })];

/** Live and server must agree exactly: same reps, same timings, same form. */
function expectAgreement(r: ReturnType<typeof runSet>) {
  expect(r.server.reps.map((x) => [x.startMs, x.endMs, x.romPercent, x.formScore])).toEqual(
    (r.session.reps as LiveRepVerifier).state().quality.verifiedReps === 0 ? [] : liveReps(r.session),
  );
  expect(r.server.quality.verifiedReps).toBe(r.live.verifiedReps);
  expect(r.server.quality.attemptedReps).toBe(r.live.quality.attemptedReps);
}
function liveReps(s: LivePoseSession) {
  // The verifier exposes reps through its quality + lastRep; re-derive via a fresh verifier over the trace.
  const v = LiveRepVerifier.for(s.exerciseId)!;
  const reps: [number, number, number, number][] = [];
  for (const sample of s.trace().samples) {
    for (const e of v.push(sample)) if (e.type === "rep_verified") { const last = v.state().lastRep!; reps.push([last.startMs, last.endMs, last.romPercent, last.formScore]); }
  }
  return reps;
}

describe("fixtures are geometrically exact", () => {
  it.each([
    ["bodyweight_squat", squatFrame({ kneeDeg: 95 })],
    ["lunge", lungeFrame({ kneeDeg: 100 })],
    ["push_up", pushUpFrame({ elbowDeg: 90 })],
    ["bicep_curl", curlFrame({ elbowDeg: 55 })],
  ] as const)("%s: framing is trackable and the analyzer measures the built angle", (id, p) => {
    expect(assessFraming({ timestampMs: 0, frame: FRAME, people: [p], brightness: 150 }, CAMERA_REQUIREMENTS[id]!)).toMatchObject({ trackable: true });
    const s = exerciseAnalyzer(id)!.sample(toPixelSpace(p.keypoints, FRAME), 0)!;
    expect(s.angleDeg).toBeCloseTo({ bodyweight_squat: 95, lunge: 100, push_up: 90, bicep_curl: 55 }[id], 0);
  });
});

describe("full reps — every camera exercise", () => {
  it("squat: Standing → Descending → Required depth → Ascending → Standing, verified with form and ROM", () => {
    const r = runSet("bodyweight_squat", squat(), [{ bottom: 88 }, { bottom: 90 }, { bottom: 92 }]);
    expect(r.live.verifiedReps).toBe(3);
    expect(r.phases).toEqual(expect.arrayContaining(["Standing", "Descending", "Required depth", "Ascending"]));
    expect(r.phases.indexOf("Descending")).toBeLessThan(r.phases.indexOf("Required depth"));
    expect(r.server.quality).toMatchObject({ attemptedReps: 3, verifiedReps: 3, perfectReps: 3, averageFormScore: 100 });
    expect(r.server.quality.averageRomPercent).toBeGreaterThanOrEqual(95);
    expect(r.live.feedback).toMatchObject({ headline: "CORRECT FORM" });
    expectAgreement(r);
  });

  it("push-up: Top → Descending → Required depth → Ascending → Top", () => {
    const r = runSet("push_up", pushUp(), [{ bottom: 82 }, { bottom: 81 }]);
    expect(r.live.verifiedReps).toBe(2);
    expect(r.phases).toEqual(expect.arrayContaining(["Top", "Descending", "Required depth", "Ascending"]));
    expect(r.server.quality.perfectReps).toBe(2);
    expectAgreement(r);
  });

  it("bicep curl: Extended → Curling → Required contraction → Returning → Extended", () => {
    const r = runSet("bicep_curl", curl(), [{ bottom: 48 }, { bottom: 50 }]);
    expect(r.live.verifiedReps).toBe(2);
    expect(r.phases).toEqual(expect.arrayContaining(["Extended", "Curling", "Required contraction", "Returning"]));
    expect(r.server.quality.averageFormScore).toBe(100);
    expectAgreement(r);
  });

  it("lunge: measures the front leg; Standing → … → Standing", () => {
    const r = runSet("lunge", lunge(), [{ bottom: 95 }, { bottom: 97 }]);
    expect(r.live.verifiedReps).toBe(2);
    expect(r.phases).toEqual(expect.arrayContaining(["Standing", "Descending", "Required depth", "Ascending"]));
    expect(r.server.quality.perfectReps).toBe(2);
    expectAgreement(r);
  });
});

describe("partial and incomplete movements are never counted", () => {
  it("partial squat: rejected for range, with a depth cue", () => {
    const r = runSet("bodyweight_squat", squat(), [{ bottom: 90 }, { bottom: 125 }, { bottom: 90 }]);
    expect(r.live.verifiedReps).toBe(2);
    expect(r.server.quality).toMatchObject({ attemptedReps: 3, verifiedReps: 2, rejectedReps: { insufficient_rom: 1 } });
    expectAgreement(r);
  });

  it("partial curl gets 'Complete the full range'", () => {
    const s = LivePoseSession.for("bicep_curl")!;
    const r = runSet("bicep_curl", curl(), [{ bottom: 85 }], { session: s });
    expect(r.live.verifiedReps).toBe(0);
    expect(r.live.feedback).toMatchObject({ headline: "REP NOT VERIFIED", message: "Complete the full range" });
  });

  it("a rep that never returns to full extension doesn't count", () => {
    const s = LivePoseSession.for("bodyweight_squat")!;
    let t = 0;
    for (let i = 0; i < 10; i++) s.push(detection(squat()(172, 0), (t += DT)));
    const down = repAngles(172, 90, 2000).slice(0, 35); // stops at the bottom
    down.forEach((a) => s.push(detection(squat()(a, 0.8), (t += DT))));
    const res = analyzeSet("bodyweight_squat", s.trace())!;
    expect(res.quality).toMatchObject({ verifiedReps: 0, incomplete: true, attemptedReps: 1 });
  });

  it("tracking that starts mid-movement can't produce a rep", () => {
    const s = LivePoseSession.for("bodyweight_squat")!;
    let t = 0;
    // Camera starts while the user is already at the bottom, then they stand up.
    for (const a of [95, 100, 120, 140, 160, 172, 172]) s.push(detection(squat()(a, 0.5), (t += 60)));
    expect(s.verifiedReps).toBe(0);
  });

  it("too-fast reps are rejected", () => {
    const r = runSet("bodyweight_squat", squat(), [{ bottom: 90, repMs: 450 }, { bottom: 90, repMs: 450 }]);
    expect(r.live.verifiedReps).toBe(0);
    expect(r.server.quality.rejectedReps.too_fast).toBe(2);
    expect(r.live.feedback?.message).toBe("Control the movement");
  });
});

describe("bad form is scored and corrected — one cue at a time", () => {
  it("squat: excessive forward lean → 'Keep your back neutral'", () => {
    const r = runSet("bodyweight_squat", squat((d) => ({ leanDeg: 10 + 65 * d })), [{ bottom: 90 }]);
    expect(r.live.verifiedReps).toBe(1); // form scores the rep; it doesn't un-verify it
    expect(r.server.reps[0]!.issues).toContain("torso_lean");
    expect(r.server.reps[0]!.formScore).toBeLessThan(90);
    expect(r.live.feedback).toMatchObject({ headline: "FIX YOUR FORM", message: "Keep your back neutral" });
    expectAgreement(r);
  });

  it("squat: heels lifting and knees far past the toes", () => {
    const r = runSet("bodyweight_squat", squat((d) => ({ heelLift: 0.3 * d, shinShare: 0.95 })), [{ bottom: 90 }]);
    expect(r.server.reps[0]!.issues).toEqual(expect.arrayContaining(["heel_lift", "knee_alignment"]));
  });

  it("squat: shallow-but-verified reps get 'Go slightly deeper' and lower ROM", () => {
    const r = runSet("bodyweight_squat", squat(), [{ bottom: 99 }]);
    expect(r.live.verifiedReps).toBe(1);
    expect(r.server.reps[0]!.romPercent).toBeLessThan(90);
    expect(r.server.reps[0]!.issues).toContain("depth");
    expect(r.server.reps[0]!.perfect).toBe(false);
  });

  it("push-up: sagging hips → 'Keep your body in a straight line'", () => {
    const r = runSet("push_up", pushUp(() => ({ sag: 0.12 })), [{ bottom: 85 }]);
    expect(r.server.reps[0]!.issues[0]).toBe("body_line");
    expect(r.live.feedback?.message).toBe("Keep your body in a straight line");
    expectAgreement(r);
  });

  it("push-up: forearms far from vertical at the bottom → elbow position", () => {
    const r = runSet("push_up", pushUp((d) => ({ forearmTiltDeg: 8 + 40 * d })), [{ bottom: 85 }]);
    expect(r.server.reps[0]!.issues).toContain("elbow_position");
  });

  it("push-up: not locking out at the top → 'Complete the full range'", () => {
    const r = runSet("push_up", pushUp(), [{ bottom: 85, top: 157 }], { top: 157 });
    expect(r.live.verifiedReps).toBe(1);
    expect(r.server.reps[0]?.issues).toContain("extension");
  });

  it("curl: elbow drifting forward and torso swinging", () => {
    const r = runSet("bicep_curl", curl((d) => ({ upperArmDeg: 4 + 40 * d, leanDeg: 2 + 18 * d })), [{ bottom: 50 }]);
    expect(r.server.reps[0]!.issues).toEqual(expect.arrayContaining(["elbow_stability", "torso_swing"]));
    expect(r.live.feedback?.message).toBe("Keep your elbows stable");
  });

  it("lunge: front knee far past the toes, torso tipping", () => {
    const r = runSet("lunge", lunge((d) => ({ shinShare: 0.8, leanDeg: 5 + 40 * d })), [{ bottom: 95 }]);
    expect(r.server.reps[0]!.issues).toEqual(expect.arrayContaining(["knee_alignment", "torso_lean"]));
  });

  it("form checks whose landmarks aren't visible are skipped, not guessed", () => {
    // Heels and toes never visible: heel lift and knee alignment can't be judged.
    const hideFeet = (ps: PosePerson[]) => ps.map((p) => ({ keypoints: p.keypoints.map((k) => (/heel|foot/.test(k.name) ? { ...k, confidence: 0.1 } : k)) }));
    const r = runSet("bodyweight_squat", (a, d) => hideFeet(squat({ heelLift: 0.4 * d, shinShare: 0.95 })(a, d)), [{ bottom: 90 }]);
    expect(r.live.verifiedReps).toBe(1);
    expect(r.server.reps[0]!.issues).not.toContain("heel_lift");
    expect(r.server.reps[0]!.issues).not.toContain("knee_alignment");
  });
});

describe("confidence gating — prefer 'rep not verified' over a false positive", () => {
  const midRep = (transform: (p: PosePerson) => PosePerson[]) => (people: PosePerson[], i: number, n: number) =>
    i > n * 0.35 && i < n * 0.6 ? transform(people[0]!) : people;

  it("low landmark confidence mid-rep → tracking lost, rep not counted; the others still count", () => {
    const low = (p: PosePerson) => [{ keypoints: p.keypoints.map((k) => ({ ...k, confidence: 0.2 })) }];
    const r = runSet("bodyweight_squat", squat(), [{ bottom: 90 }, { bottom: 90, frames: midRep(low) }, { bottom: 90 }]);
    expect(r.live.verifiedReps).toBe(2);
    expect(r.server.quality.rejectedReps.tracking_lost).toBe(1);
    expect(r.server.gatedFrames).toHaveProperty("insufficient_landmarks");
    expectAgreement(r);
  });

  it("missing landmarks (feet out of frame) mid-rep → not counted, gate recorded", () => {
    const cut = (p: PosePerson) => [{ keypoints: p.keypoints.map((k) => (/ankle|heel|foot/.test(k.name) ? { ...k, y: 1.1 } : k)) }];
    const r = runSet("bodyweight_squat", squat(), [{ bottom: 90, frames: midRep(cut) }]);
    expect(r.live.verifiedReps).toBe(0);
    expect(Object.keys(r.server.gatedFrames).some((g) => g === "partial_body" || g === "too_close")).toBe(true);
    expect(r.live.feedback?.message).toBe("Stay in frame for the whole rep");
  });

  it("occlusion mid-rep → not counted", () => {
    const occlude = (p: PosePerson) => [{ keypoints: p.keypoints.map((k) => (/knee|ankle/.test(k.name) ? { ...k, confidence: 0.1 } : k)) }];
    const r = runSet("bodyweight_squat", squat(), [{ bottom: 90, frames: midRep(occlude) }]);
    expect(r.live.verifiedReps).toBe(0);
    expect(r.server.gatedFrames.occluded).toBeGreaterThan(0);
  });

  it("a second person stepping in mid-rep → ambiguous, not counted", () => {
    const second = (p: PosePerson) => [p, { keypoints: p.keypoints.map((k) => ({ ...k, x: k.x - 0.3 })) }];
    const r = runSet("bodyweight_squat", squat(), [{ bottom: 90, frames: midRep(second) }, { bottom: 90 }]);
    expect(r.live.verifiedReps).toBe(1);
    expect(r.server.gatedFrames.multiple_people).toBeGreaterThan(0);
    expectAgreement(r);
  });

  it("an out-of-frame person between reps doesn't break later reps", () => {
    const r = runSet("bodyweight_squat", squat(), [{ bottom: 90 }]);
    for (let i = 0; i < 30; i++) r.session.push(detection([], r.t + i * DT)); // walks away
    const again = runSet("bodyweight_squat", squat(), [{ bottom: 90 }], { session: r.session, t0: r.t + 40 * DT });
    expect(again.live.verifiedReps).toBe(2);
    expect(again.server.quality.verifiedReps).toBe(2);
  });
});

describe("temporal validation", () => {
  const spec = ROM_SPECS.bodyweight_squat;
  const trace = (angles: number[], dt = 50): AngleSample[] => angles.map((a, i) => ({ tMs: i * dt, angleDeg: a, confidence: 0.9 }));
  const smooth = [170, ...repAngles(170, 90, 2000, 20), 170, 170];

  it("duplicate frames never double-count", () => {
    const samples = trace(smooth).flatMap((s) => [s, { ...s }, { ...s }]);
    expect(verifyReps({ poseStatus: "ok", samples }, spec).verifiedReps).toBe(1);
  });

  it("jitter around the top and bottom thresholds counts one rep, not several", () => {
    const jittery = smooth.map((a, i) => a + (i % 2 ? 4 : -4));
    const r = verifyReps({ poseStatus: "ok", samples: trace(jittery) }, spec);
    expect(r.verifiedReps).toBe(1);
    expect(r.rejected).toEqual([]);
  });

  it("a one-frame landmark glitch is ignored", () => {
    const glitch = [...smooth];
    glitch[5] = 60; // impossible jump at the top
    const r = verifyReps({ poseStatus: "ok", samples: trace(glitch) }, spec);
    expect(r.verifiedReps).toBe(1);
    expect(r.rejected).toEqual([]);
  });

  it("a gap mid-rep (interruption) aborts that rep", () => {
    const s = trace(smooth);
    const gapped = s.map((x, i) => (i > 20 ? { ...x, tMs: x.tMs + 1000 } : x));
    const r = verifyReps({ poseStatus: "ok", samples: gapped }, spec);
    expect(r.verifiedReps).toBe(0);
    expect(r.rejected[0]!.reason).toBe("tracking_lost");
  });

  it("live interruption is recorded so the server aborts the same rep even after a short pause", () => {
    const s = LivePoseSession.for("bodyweight_squat")!;
    let t = 0;
    const b = squat();
    for (let i = 0; i < 10; i++) s.push(detection(b(172, 0), (t += DT)));
    for (const a of repAngles(172, 90, 2000).slice(0, 30)) s.push(detection(b(a, 0.7), (t += DT)));
    s.interrupt(); // camera paused for a moment
    t += 200; // well under maxGapMs
    for (const a of repAngles(172, 90, 2000).slice(30)) s.push(detection(b(a, 0.5), (t += DT)));
    for (let i = 0; i < 10; i++) s.push(detection(b(172, 0), (t += DT)));
    expect(s.verifiedReps).toBe(0);
    const server = analyzeSet("bodyweight_squat", s.trace())!;
    expect(server.quality.verifiedReps).toBe(0);
    expect(server.quality.rejectedReps.tracking_lost).toBe(1);
  });

  it("interruption keeps reps already verified in the set", () => {
    const r = runSet("bodyweight_squat", squat(), [{ bottom: 90 }, { bottom: 90 }]);
    r.session.interrupt();
    expect(r.session.verifiedReps).toBe(2);
    r.session.startSet();
    expect(r.session.verifiedReps).toBe(0);
    expect(r.session.trace().samples).toEqual([]);
  });
});

describe("exercise transitions", () => {
  it("curling in front of a squat session counts no squats", () => {
    const r = runSet("bodyweight_squat", (a) => [curlFrame({ elbowDeg: a })], [{ bottom: 50 }, { bottom: 50 }]);
    expect(r.live.verifiedReps).toBe(0);
  });

  it("squatting in front of a push-up session counts no push-ups", () => {
    const r = runSet("push_up", (a, d) => squat()(a, d), [{ bottom: 90 }]);
    expect(r.live.verifiedReps).toBe(0);
  });

  it("switching exercise starts clean: a new session per exercise", () => {
    const squats = runSet("bodyweight_squat", squat(), [{ bottom: 90 }, { bottom: 90 }]);
    const curls = runSet("bicep_curl", curl(), [{ bottom: 50 }], { t0: squats.t + 500 });
    expect(squats.live.verifiedReps).toBe(2);
    expect(curls.live.verifiedReps).toBe(1);
    expect(curls.server.quality.attemptedReps).toBe(1);
  });
});

describe("feedback throttling", () => {
  it("keeps each cue up for the minimum hold, then shows the latest, then expires", () => {
    const v = LiveRepVerifier.for("bodyweight_squat")!;
    const m = new MovementStateMachine(ROM_SPECS.bodyweight_squat); // (for timing reference only)
    expect(m.currentPhase).toBe("unknown");
    const samples = (t0: number, bottom: number, repMs: number) => [170, ...repAngles(170, bottom, repMs, 20), 170].map((a, i) => ({ tMs: t0 + i * 50, angleDeg: a, confidence: 0.9 }));
    const first = samples(0, 90, 1400);
    first.forEach((s) => v.push(s));
    const end1 = first.at(-1)!.tMs;
    expect(v.state(end1).feedback?.headline).toBe("FIX YOUR FORM"); // 1.4 s rep: "Control the movement" (tempo)
    // A partial rep finishing within the hold time waits its turn.
    const second = samples(end1 + 50, 130, 700);
    second.forEach((s) => v.push(s));
    const end2 = second.at(-1)!.tMs;
    const shown: LiveRepState["feedback"] = v.state(end2).feedback;
    if (end2 - end1 < FEEDBACK_TIMING.minHoldMs) expect(shown?.headline).toBe("FIX YOUR FORM");
    expect(v.state(end1 + FEEDBACK_TIMING.minHoldMs + 1).feedback?.headline).toBe("REP NOT VERIFIED");
    expect(v.state(end2 + FEEDBACK_TIMING.minHoldMs + FEEDBACK_TIMING.expireMs + 10).feedback).toBeNull();
  });
});

describe("set quality, recorded vs verified, events", () => {
  it("summarises verified reps, average form, average ROM and perfect reps", () => {
    const r = runSet("bodyweight_squat", squat((d) => ({ leanDeg: 10 + 30 * d })), [{ bottom: 88 }, { bottom: 90 }, { bottom: 99 }, { bottom: 125 }]);
    expect(r.server.quality).toMatchObject({ attemptedReps: 4, verifiedReps: 3, perfectReps: 2, rejectedReps: { insufficient_rom: 1 } });
    expect(r.server.reps[2]!.formScore).toBeLessThan(100);
    expect(r.server.quality.averageFormScore).toBe(Math.round(r.server.reps.reduce((a, x) => a + x.formScore, 0) / 3));
    expect(r.server.quality.topIssue).toEqual({ code: "depth", message: "Go slightly deeper" });
  });

  it("verified reps never exceed recorded reps; quality follows the kept reps", () => {
    const r = runSet("bodyweight_squat", squat(), [{ bottom: 90 }, { bottom: 90 }, { bottom: 99 }]);
    const kept = keepRecorded("bodyweight_squat", r.server, 2);
    expect(kept.quality).toMatchObject({ verifiedReps: 2, attemptedReps: 3, perfectReps: 2, averageFormScore: 100 });
    const set = evaluateSet({ exerciseId: "bodyweight_squat", reps: 2, loadKg: 0, trace: r.session.trace() }, 0);
    expect(set).toMatchObject({ verifiedReps: 2, formScore: 100, verificationStatus: "verified" });
    expect(set.analysis!.quality.attemptedReps).toBe(3);
    expect(set.verifiedRepDetails[0]).toMatchObject({ formScore: 100, perfect: true });
  });

  it("a set without a trace has no form score or analysis", () => {
    expect(evaluateSet({ exerciseId: "bodyweight_squat", reps: 10, loadKg: 0 }, 0)).toMatchObject({ verifiedReps: 0, formScore: null, romPercent: null, analysis: null });
  });

  it("emits one idempotent domain event per analyzed set, with no XP in it", () => {
    const r = runSet("push_up", pushUp(), [{ bottom: 85 }]);
    const e = setVerifiedEvent({ workoutId: "w1", exerciseId: "push_up", setIndex: 2, recordedReps: 1, analysis: r.server, occurredAt: new Date("2026-09-28T10:00:00Z") });
    expect(e).toMatchObject({ type: "exercise.set_verified", key: "w1:2", verifiedReps: 1, recordedReps: 1, attemptedReps: 1 });
    expect(JSON.stringify(e)).not.toMatch(/xp/i);
  });
});
