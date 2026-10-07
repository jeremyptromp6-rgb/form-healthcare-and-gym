import { describe, expect, it } from "vitest";
import {
  CAMERA_READY_EXERCISES,
  CAMERA_REQUIREMENTS,
  CANONICAL_LANDMARKS,
  EXERCISES,
  FRAMING_MESSAGES,
  FRAMING_TIMING,
  FramingTracker,
  LivePoseSession,
  MEDIAPIPE_POSE_INDEX,
  MovementStateMachine,
  ROM_SPECS,
  SKELETON_EDGES,
  assessFraming,
  createUnconfiguredProviders,
  exerciseAnalyzer,
  fromMediaPipePose,
  jointAngleDeg,
  noopRepConsumer,
  toPixelSpace,
  type LiveRepConsumer,
  type PoseDetection,
  type PoseKeypoint,
  type PosePerson,
} from "../src";

const FRAME = { width: 1280, height: 720 };

/**
 * A side-on person built in pixel space (so angles are exact), then normalized like a provider
 * would report it. `L` is the segment length in px; the near (left) side is confident, the far
 * (right) side less so, as in a real side view.
 */
function person(o: { cx?: number; top?: number; L?: number; kneeDeg?: number; elbowDeg?: number; conf?: number; farConf?: number; override?: Record<string, number> } = {}): PosePerson {
  const { cx = 640, top = 150, L = 150, kneeDeg = 175, elbowDeg = 170, conf = 0.95, farConf = 0.6 } = o;
  const a = ((180 - kneeDeg) / 2) * (Math.PI / 180);
  const e = (180 - elbowDeg) * (Math.PI / 180);
  const shoulder = { x: cx, y: top };
  const hip = { x: cx, y: top + L };
  const knee = { x: hip.x + L * Math.sin(a), y: hip.y + L * Math.cos(a) };
  const ankle = { x: knee.x - L * Math.sin(a), y: knee.y + L * Math.cos(a) };
  const elbow = { x: cx, y: top + 0.6 * L };
  const wrist = { x: elbow.x + 0.6 * L * Math.sin(e), y: elbow.y + 0.6 * L * Math.cos(e) };
  const px: Record<string, { x: number; y: number }> = {
    nose: { x: cx + 0.1 * L, y: top - 0.4 * L },
    eye: { x: cx + 0.08 * L, y: top - 0.45 * L },
    ear: { x: cx, y: top - 0.42 * L },
    shoulder,
    elbow,
    wrist,
    hand: { x: wrist.x, y: wrist.y + 0.15 * L },
    hip,
    knee,
    ankle,
    heel: { x: ankle.x - 0.1 * L, y: ankle.y + 0.05 * L },
    foot: { x: ankle.x + 0.25 * L, y: ankle.y + 0.05 * L },
  };
  const keypoints: PoseKeypoint[] = [];
  for (const [part, p] of Object.entries(px)) {
    if (part === "nose") keypoints.push({ name: "nose", x: p.x / FRAME.width, y: p.y / FRAME.height, confidence: conf });
    else
      for (const side of ["left", "right"]) {
        const name = `${side}_${part}`;
        keypoints.push({ name, x: p.x / FRAME.width, y: p.y / FRAME.height, confidence: o.override?.[name] ?? (side === "left" ? conf : farConf) });
      }
  }
  return { keypoints };
}

const detect = (people: PosePerson[], timestampMs = 0, brightness?: number): PoseDetection => ({ timestampMs, frame: FRAME, people, ...(brightness === undefined ? {} : { brightness }) });
const SQUAT = CAMERA_REQUIREMENTS.bodyweight_squat!;

describe("pose contract & landmarks", () => {
  it("maps MediaPipe's 33 landmarks onto every canonical landmark exactly once", () => {
    expect(MEDIAPIPE_POSE_INDEX).toHaveLength(33);
    const mapped = MEDIAPIPE_POSE_INDEX.filter((n) => n !== null);
    expect(new Set(mapped).size).toBe(mapped.length);
    expect([...mapped].sort()).toEqual([...CANONICAL_LANDMARKS].sort());
  });

  it("covers head, shoulders, elbows, wrists/hands, hips, knees, ankles/feet", () => {
    for (const part of ["nose", "shoulder", "elbow", "wrist", "hand", "hip", "knee", "ankle", "foot"])
      expect(CANONICAL_LANDMARKS.some((n) => n.endsWith(part))).toBe(true);
  });

  it("converts MediaPipe output, clamping confidence and dropping unusable points", () => {
    const raw = Array.from({ length: 33 }, (_, i) => ({ x: i / 33, y: 0.5, visibility: i === 11 ? 1.4 : 0.8 }));
    raw[12] = { x: Number.NaN, y: 0.5, visibility: 0.9 };
    const kps = fromMediaPipePose(raw);
    expect(kps).toHaveLength(CANONICAL_LANDMARKS.length - 1);
    expect(kps.find((k) => k.name === "left_shoulder")!.confidence).toBe(1);
    expect(kps.find((k) => k.name === "right_shoulder")).toBeUndefined();
    // No visibility reported → zero confidence, never assumed visible.
    expect(fromMediaPipePose([{ x: 0.5, y: 0.5 }])[0]!.confidence).toBe(0);
  });

  it("skeleton edges only join canonical landmarks", () => {
    for (const [a, b] of SKELETON_EDGES) {
      expect(CANONICAL_LANDMARKS).toContain(a);
      expect(CANONICAL_LANDMARKS).toContain(b);
    }
  });

  it("measures angles in pixel space — normalized coords on a 16:9 frame would distort them", () => {
    // A true 90° angle in pixels, rotated 45° so the axis stretch changes it.
    const px = [
      { name: "a", x: 440, y: 200, confidence: 1 },
      { name: "b", x: 640, y: 400, confidence: 1 },
      { name: "c", x: 840, y: 200, confidence: 1 },
    ];
    const norm = px.map((k) => ({ ...k, x: k.x / FRAME.width, y: k.y / FRAME.height }));
    const [a, b, c] = toPixelSpace(norm, FRAME);
    expect(jointAngleDeg(a!, b!, c!)).toBeCloseTo(90, 5);
    expect(Math.abs(jointAngleDeg(norm[0]!, norm[1]!, norm[2]!)! - 90)).toBeGreaterThan(20);
  });

  it("the default pose provider is honestly unconfigured and returns no landmarks", async () => {
    const pose = createUnconfiguredProviders().pose;
    expect(pose.status().state).toBe("unconfigured");
    const r = await pose.estimate({ width: 1, height: 1, data: new Uint8Array(4) }, 0);
    expect(r.ok).toBe(false);
  });
});

describe("camera-ready exercises", () => {
  it("includes squat, push-up, bicep curl and lunge", () => {
    for (const id of ["bodyweight_squat", "push_up", "bicep_curl", "lunge"]) expect(CAMERA_READY_EXERCISES).toContain(id);
  });

  it("every camera-verifiable exercise has a framing requirement, and nothing else is camera-ready", () => {
    for (const e of EXERCISES.filter((x) => x.cameraVerifiable)) expect(CAMERA_REQUIREMENTS[e.id]).toBeDefined();
    for (const id of CAMERA_READY_EXERCISES) expect(id in ROM_SPECS).toBe(true);
    expect(LivePoseSession.for("deadlift")).toBeNull();
    expect(LivePoseSession.for("not_an_exercise")).toBeNull();
  });
});

describe("assessFraming", () => {
  it("ready when the required side is fully visible at a usable size", () => {
    const a = assessFraming(detect([person()]), SQUAT);
    expect(a).toMatchObject({ issue: null, trackable: true, side: "left", missing: [] });
  });

  it("no person / no person in the dark", () => {
    expect(assessFraming(detect([]), SQUAT)).toMatchObject({ issue: "no_person", trackable: false, message: FRAMING_MESSAGES.no_person });
    expect(assessFraming(detect([], 0, 10), SQUAT).issue).toBe("low_light");
  });

  it("multiple clearly visible people block tracking; a faint second detection doesn't", () => {
    expect(assessFraming(detect([person(), person({ cx: 300 })]), SQUAT).issue).toBe("multiple_people");
    expect(assessFraming(detect([person(), person({ cx: 300, conf: 0.2, farConf: 0.2 })]), SQUAT).issue).toBeNull();
  });

  it("low light when the frame is dark even if some landmarks come through", () => {
    expect(assessFraming(detect([person()], 0, 20), SQUAT).issue).toBe("low_light");
  });

  it("too far when the body is small in frame", () => {
    expect(assessFraming(detect([person({ L: 40, top: 300 })]), SQUAT)).toMatchObject({ issue: "too_far", trackable: false });
  });

  it("too close when the body is cut off and fills the frame", () => {
    const a = assessFraming(detect([person({ L: 330, top: 40 })]), SQUAT);
    expect(a.issue).toBe("too_close");
    expect(a.message).toBe("Move farther away so your full body is visible.");
    expect(a.missing).toContain("left_ankle");
  });

  it("partial body tells the user which way to fix it", () => {
    const a = assessFraming(detect([person({ top: 300 })]), SQUAT);
    expect(a.issue).toBe("partial_body");
    expect(a.message).toMatch(/lower body is out of frame/);
  });

  it("occlusion: required joints in frame but not visible", () => {
    const hidden = { left_ankle: 0.2, right_ankle: 0.1 };
    expect(assessFraming(detect([person({ override: hidden })]), SQUAT)).toMatchObject({ issue: "occluded", missing: ["left_ankle"] });
    // The same missing joints in dim light are blamed on the light.
    expect(assessFraming(detect([person({ override: hidden })], 0, 60), SQUAT).issue).toBe("low_light");
  });

  it("insufficient landmarks when the model sees too little of the body", () => {
    const override = Object.fromEntries(person().keypoints.map((k) => [k.name, 0.1]));
    override.left_shoulder = 0.9;
    override.left_hip = 0.9;
    expect(assessFraming(detect([person({ conf: 0.1, override })]), SQUAT).issue).toBe("insufficient_landmarks");
  });

  it("upper-body exercises don't need legs in frame", () => {
    const noLegs = person({ top: 300, L: 200 }); // ankles well below the frame
    expect(assessFraming(detect([noLegs]), CAMERA_REQUIREMENTS.bicep_curl!).issue).toBeNull();
    expect(assessFraming(detect([noLegs]), SQUAT).trackable).toBe(false);
  });

  it("uses the more visible side", () => {
    const leftHidden = person({ override: { left_knee: 0.1, left_ankle: 0.1 }, farConf: 0.9 });
    expect(assessFraming(detect([leftHidden]), SQUAT)).toMatchObject({ issue: null, side: "right" });
  });
});

describe("FramingTracker", () => {
  it("debounces issue changes so feedback doesn't flicker", () => {
    const t = new FramingTracker(SQUAT);
    expect(t.update(detect([person()], 0)).stable.issue).toBeNull();
    // One bad frame doesn't change the message…
    expect(t.update(detect([person({ L: 40, top: 300 })], 100)).stable.issue).toBeNull();
    expect(t.update(detect([person()], 200)).stable.issue).toBeNull();
    // …a persistent one does, after settleMs.
    const far = person({ L: 40, top: 300 });
    t.update(detect([far], 300));
    expect(t.update(detect([far], 300 + FRAMING_TIMING.settleMs - 1)).stable.issue).toBeNull();
    expect(t.update(detect([far], 300 + FRAMING_TIMING.settleMs)).stable.issue).toBe("too_far");
  });

  it("per-frame trackability is exact even while the message is settling", () => {
    const t = new FramingTracker(SQUAT);
    t.update(detect([person()], 0));
    const r = t.update(detect([], 50));
    expect(r.frame.trackable).toBe(false);
    expect(r.stable.trackable).toBe(true);
  });

  it("says the person left the frame (not 'step into view') after they were tracked", () => {
    const t = new FramingTracker(SQUAT);
    expect(t.update(detect([], 0)).stable.issue).toBe("no_person");
    t.update(detect([person()], 1000));
    t.update(detect([person()], 1500));
    t.update(detect([], 2000));
    expect(t.update(detect([], 2000 + FRAMING_TIMING.settleMs)).stable.message).toBe(FRAMING_MESSAGES.left_frame);
    // Long gone → back to the plain prompt.
    const later = 1500 + FRAMING_TIMING.leftFrameWindowMs + 1;
    t.update(detect([], later));
    expect(t.update(detect([], later + FRAMING_TIMING.settleMs)).stable.issue).toBe("no_person");
  });

  it("detects a stalled frame stream and resets cleanly", () => {
    const t = new FramingTracker(SQUAT);
    t.update(detect([person()], 1000));
    expect(t.isStale(1000 + FRAMING_TIMING.staleMs)).toBe(false);
    expect(t.isStale(1001 + FRAMING_TIMING.staleMs)).toBe(true);
    t.reset();
    expect(t.update(detect([], 5000)).stable.issue).toBe("no_person");
  });
});

describe("LivePoseSession", () => {
  it("measures the real joint angle only on trackable frames", () => {
    const s = LivePoseSession.for("bodyweight_squat")!;
    const ready = s.push(detect([person({ kneeDeg: 100 })], 0));
    expect(ready.trackable).toBe(true);
    expect(ready.angle!.angleDeg).toBeCloseTo(100, 3);
    const far = s.push(detect([person({ L: 40, top: 300, kneeDeg: 100 })], 50));
    expect(far.angle).toBeNull();
    expect(s.push(detect([person(), person({ cx: 300 })], 100)).angle).toBeNull();
  });

  it("a placeholder rep consumer counts nothing and claims nothing", () => {
    const s = LivePoseSession.for("bodyweight_squat", noopRepConsumer())!;
    let t = 0;
    for (const knee of [175, 140, 95, 140, 175, 175]) {
      const f = s.push(detect([person({ kneeDeg: knee })], (t += 400)));
      expect(f.events).toEqual([]);
    }
    expect(s.verifiedReps).toBeNull();
    expect(noopRepConsumer().count).toBeNull();
  });

  it("a real rep consumer plugs into the same contract (the Stage F seam)", () => {
    const machine = new MovementStateMachine(ROM_SPECS.bodyweight_squat);
    let count = 0;
    const consumer: LiveRepConsumer = {
      push: (sample) => {
        const events = machine.push(sample);
        count += events.filter((e) => e.type === "rep_verified").length;
        return events;
      },
      get count() {
        return count;
      },
      reset: () => {},
    };
    const s = LivePoseSession.for("bodyweight_squat", consumer)!;
    let t = 0;
    for (const knee of [175, 150, 120, 95, 120, 150, 175]) s.push(detect([person({ kneeDeg: knee })], (t += 250)));
    expect(s.verifiedReps).toBe(1);
  });

  it("people are ordered primary first for the overlay", () => {
    const s = LivePoseSession.for("push_up")!;
    const faint = person({ cx: 300, conf: 0.2, farConf: 0.2 });
    const main = person();
    expect(s.push(detect([faint, main], 0)).people[0]).toBe(main);
  });

  it("the elbow analyzer tracks curls from pixel-space landmarks", () => {
    const s = LivePoseSession.for("bicep_curl")!;
    const f = s.push(detect([person({ elbowDeg: 60 })], 0));
    expect(f.trackable).toBe(true);
    expect(f.angle!.angleDeg).toBeCloseTo(60, 3);
    expect(exerciseAnalyzer("bicep_curl")).not.toBeNull();
  });
});
