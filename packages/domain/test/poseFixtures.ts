import type { PoseDetection, PoseKeypoint, PosePerson } from "../src";

/**
 * Synthetic landmark fixtures: side-view skeletons (facing +x, image y down) built from joint
 * angles, so every generated frame has an exactly known knee/elbow angle and known form features.
 */

export const FRAME = { width: 1280, height: 720 };
type P = { x: number; y: number };
const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: P, dx: number, dy: number): P => ({ x: a.x + dx, y: a.y + dy });

/** Near (left) side confident, far (right) side slightly offset and less confident, like a real side view. */
function person(parts: Record<string, P>, conf = 0.95, farConf = 0.7, override: Record<string, number> = {}): PosePerson {
  const keypoints: PoseKeypoint[] = [];
  for (const [part, p] of Object.entries(parts)) {
    if (part === "nose") {
      keypoints.push({ name: "nose", x: p.x / FRAME.width, y: p.y / FRAME.height, confidence: override.nose ?? conf });
      continue;
    }
    for (const side of ["left", "right"] as const) {
      const name = `${side}_${part}`;
      const q = side === "left" ? p : add(p, 6, -4);
      keypoints.push({ name, x: q.x / FRAME.width, y: q.y / FRAME.height, confidence: override[name] ?? (side === "left" ? conf : farConf) });
    }
  }
  return { keypoints };
}

function head(shoulder: P, lean: number, torso: number) {
  const ear = add(shoulder, 0.25 * torso * Math.sin(rad(lean)), -0.25 * torso * Math.cos(rad(lean)));
  return { ear, eye: add(ear, 0.07 * torso, -0.02 * torso), nose: add(ear, 0.1 * torso, 0.01 * torso) };
}

export interface SquatOpts {
  kneeDeg: number;
  leanDeg?: number;
  heelLift?: number;
  /** Share of knee bend taken by shin tilt (higher = knees further forward). */
  shinShare?: number;
}

/** Standing / squatting / lunging front leg. Ankle fixed on the floor. */
export function legsAndTorso(o: SquatOpts, ankle: P = { x: 640, y: 650 }, L = 150, torso = 190) {
  const bend = 180 - o.kneeDeg;
  const s = rad(bend * (o.shinShare ?? 0.4));
  const t = rad(bend) - s;
  const knee = add(ankle, L * Math.sin(s), -L * Math.cos(s));
  const hip = add(knee, -L * Math.sin(t), -L * Math.cos(t));
  const lean = o.leanDeg ?? 0;
  const shoulder = add(hip, torso * Math.sin(rad(lean)), -torso * Math.cos(rad(lean)));
  const lift = (o.heelLift ?? 0) * L;
  return {
    ankle,
    knee,
    hip,
    shoulder,
    heel: add(ankle, -0.25 * L, 0.05 * L - lift),
    foot: add(ankle, 0.45 * L, 0.08 * L),
    ...head(shoulder, lean, torso),
  };
}

export function squatFrame(o: SquatOpts): PosePerson {
  const b = legsAndTorso(o);
  // Arms held forward for balance.
  const elbow = add(b.shoulder, 0.55 * 110, 0.35 * 110);
  const wrist = add(elbow, 100, 0);
  return person({ ...b, elbow, wrist, hand: add(wrist, 20, 0) });
}

export function lungeFrame(o: SquatOpts): PosePerson {
  const front = legsAndTorso({ shinShare: 0.25, leanDeg: 5, ...o }, { x: 760, y: 650 });
  // Back leg: knee drops behind the hip; ankle well behind.
  const backKnee = add(front.hip, -0.55 * 150, 0.8 * 150 * (1 - (180 - o.kneeDeg) / 300));
  const backAnkle = { x: front.hip.x - 1.4 * 150, y: 640 };
  const elbow = add(front.shoulder, 10, 0.6 * 110);
  const wrist = add(elbow, 5, 0.55 * 110);
  const near = person({ ...front, elbow, wrist, hand: add(wrist, 0, 20) });
  // Replace the far (right) leg with the back leg.
  const set = (name: string, p: P) => {
    const k = near.keypoints.find((x) => x.name === name)!;
    k.x = p.x / FRAME.width;
    k.y = p.y / FRAME.height;
  };
  set("right_knee", backKnee);
  set("right_ankle", backAnkle);
  set("right_heel", add(backAnkle, -30, -25));
  set("right_foot", add(backAnkle, 45, 10));
  return near;
}

export interface PushUpOpts {
  elbowDeg: number;
  /** Hip below (+) / above (−) the shoulder–ankle line, in body lengths. */
  sag?: number;
  forearmTiltDeg?: number;
}

export function pushUpFrame(o: PushUpOpts): PosePerson {
  const wrist = { x: 900, y: 640 };
  const Lf = 130;
  const Lu = 150;
  const body = 650;
  const ft = rad(o.forearmTiltDeg ?? 8);
  const elbow = add(wrist, -Lf * Math.sin(ft), -Lf * Math.cos(ft));
  // elbow→wrist direction rotated by the elbow angle, choosing the rotation that puts the shoulder forward.
  const base = Math.atan2(wrist.y - elbow.y, wrist.x - elbow.x);
  const cands = [base + rad(o.elbowDeg), base - rad(o.elbowDeg)].map((a) => add(elbow, Lu * Math.cos(a), Lu * Math.sin(a)));
  const shoulder = cands[0]!.x >= cands[1]!.x ? cands[0]! : cands[1]!;
  const drop = 650 - shoulder.y;
  const ankle = { x: shoulder.x - Math.sqrt(body * body - drop * drop), y: 650 };
  const onLine = { x: shoulder.x + 0.45 * (ankle.x - shoulder.x), y: shoulder.y + 0.45 * (ankle.y - shoulder.y) };
  const hip = add(onLine, 0, (o.sag ?? 0) * body);
  const knee = { x: hip.x + 0.5 * (ankle.x - hip.x), y: hip.y + 0.5 * (ankle.y - hip.y) };
  const ear = add(shoulder, 45, -10);
  return person({
    shoulder,
    elbow,
    wrist,
    hand: add(wrist, 25, 0),
    hip,
    knee,
    ankle,
    heel: add(ankle, -10, -25),
    foot: add(ankle, -5, 15),
    ear,
    eye: add(ear, 12, 2),
    nose: add(ear, 22, 8),
  });
}

export interface CurlOpts {
  elbowDeg: number;
  /** Upper arm drifting forward from the torso (deg). */
  upperArmDeg?: number;
  leanDeg?: number;
}

export function curlFrame(o: CurlOpts): PosePerson {
  const b = legsAndTorso({ kneeDeg: 178, leanDeg: o.leanDeg ?? 2 }, { x: 640, y: 690 }, 150, 200);
  const Lu = 110;
  const Lf = 100;
  const lean = rad(o.leanDeg ?? 2);
  const ua = rad(o.upperArmDeg ?? 4) + lean;
  const elbow = add(b.shoulder, Lu * Math.sin(ua), Lu * Math.cos(ua));
  // Forearm: rotate the elbow→shoulder direction by the elbow angle toward the front.
  const base = Math.atan2(b.shoulder.y - elbow.y, b.shoulder.x - elbow.x);
  const cands = [base + rad(o.elbowDeg), base - rad(o.elbowDeg)].map((a) => add(elbow, Lf * Math.cos(a), Lf * Math.sin(a)));
  const wrist = cands[0]!.x >= cands[1]!.x ? cands[0]! : cands[1]!;
  return person({ ...b, elbow, wrist, hand: add(wrist, 12, -8) });
}

export const detection = (people: PosePerson[], timestampMs: number, brightness = 150): PoseDetection => ({ timestampMs, frame: FRAME, people, brightness });

/** Joint angle over one rep: hold at the top, cosine down, short hold, cosine up. */
export function repAngles(top: number, bottom: number, repMs: number, fps = 30): number[] {
  const hold = 0.15 * repMs;
  const move = (repMs - hold - 0.05 * repMs) / 2;
  const out: number[] = [];
  for (let t = 0; t < repMs; t += 1000 / fps) {
    let a: number;
    if (t < hold) a = top;
    else if (t < hold + move) a = top - (top - bottom) * (1 - Math.cos((Math.PI * (t - hold)) / move)) / 2;
    else if (t < hold + move + 0.05 * repMs) a = bottom;
    else a = bottom + ((top - bottom) * (1 - Math.cos(Math.PI * Math.min(1, (t - hold - move - 0.05 * repMs) / move)))) / 2;
    out.push(a);
  }
  return out;
}
