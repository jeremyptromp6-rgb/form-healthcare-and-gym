import { ADAPTIVE_RULES, type SetQuality } from '@form/domain';
import { verificationNote } from './workoutSession';

/**
 * What the camera actually verified, in words — shared by the live workout, the camera screen and the
 * summary. Pure: every number comes from the set's recorded verification (the server's answer) and
 * nothing is shown that wasn't measured. The "next time" advice uses the same thresholds as adaptive
 * training (`ADAPTIVE_RULES`), so the summary and the next plan never disagree.
 */

/** The parts of a logged set (live session or summary) that evidence is read from. */
export interface EvidenceSet {
  warmup?: boolean;
  mode?: 'live' | 'manual' | 'camera';
  reps: number;
  verifiedReps: number;
  formScore: number | null;
  romPercent: number | null;
  quality: SetQuality | null;
  verificationStatus?: string;
}

/** A set the camera had a say in: recorded by camera, or carrying verification data. A typed-in set is not one. */
export function hasCameraEvidence(s: Pick<EvidenceSet, 'mode' | 'quality' | 'verifiedReps' | 'verificationStatus'>): boolean {
  // A trace the server refused to trust is still a camera set (it must say "Not verified", not pass as typed in).
  const traced = s.verifiedReps > 0 || s.quality !== null || verificationNote(s.verificationStatus) !== null;
  return s.mode === 'manual' || s.mode === 'live' ? traced : s.mode === 'camera' || traced;
}

/** A form score in one word, as in "form Good". */
export function formLevel(score: number): string {
  if (score >= 90) return 'Great';
  if (score >= 75) return 'Good';
  if (score >= 60) return 'Decent';
  return 'Needs work';
}

const reps = (n: number) => `${n} ${n === 1 ? 'rep' : 'reps'}`;
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Why attempted reps did not count, in plain words, from the set's recorded rejections. Empty when none were rejected. */
export function rejectionReasons(q: SetQuality | null): string[] {
  if (!q) return [];
  const r = q.rejectedReps;
  const out: string[] = [];
  if (r.insufficient_rom) out.push(`${reps(r.insufficient_rom)} didn't reach full range`);
  if (r.too_fast) out.push(`${reps(r.too_fast)} too fast to verify`);
  if (r.tracking_lost) out.push(`${reps(r.tracking_lost)} lost tracking`);
  if (q.incomplete) out.push('1 unfinished rep');
  return out;
}

/** The badge on a logged set: "6 verified · form Good · ROM 92%", or "Not verified" and why. Null for sets without camera evidence. */
export function setBadge(s: EvidenceSet): { label: string; tone?: 'warning'; note?: string } | null {
  if (!hasCameraEvidence(s)) return null;
  if (s.verifiedReps > 0) {
    const parts = [`${s.verifiedReps} verified`];
    if (s.formScore !== null) parts.push(`form ${formLevel(s.formScore)}`);
    if (s.romPercent !== null) parts.push(`ROM ${Math.round(s.romPercent)}%`);
    return { label: parts.join(' · ') };
  }
  const untrusted = verificationNote(s.verificationStatus);
  const why = untrusted ? untrusted.replace(/^Not verified — /, '') : rejectionReasons(s.quality).join(', ');
  return { label: 'Not verified', tone: 'warning', ...(why ? { note: `${why.charAt(0).toUpperCase()}${why.slice(1)}. Your reps are kept as logged.` } : {}) };
}

export interface ExerciseEvidence {
  /** Camera sets that had a say (warm-ups excluded). */
  cameraSets: number;
  verified: number;
  /** Reps the camera saw attempted (verified plus the ones that did not count). */
  attempted: number;
  /** Every camera set carried its attempt count; when false, `attempted` is only the verified reps and is never shown as a total. */
  attemptedKnown: boolean;
  avgForm: number | null;
  avgRom: number | null;
  perfect: number;
  /** Reps that did not reach full range (rejected by the range check). */
  partial: number;
  topIssue: string | null;
}

const weighted = (items: { v: number | null; w: number }[]): number | null => {
  const ok = items.filter((x): x is { v: number; w: number } => x.v !== null && x.w > 0);
  const w = ok.reduce((a, x) => a + x.w, 0);
  return w > 0 ? Math.round(ok.reduce((a, x) => a + x.v * x.w, 0) / w) : null;
};

/** Everything the camera verified for one exercise across its working sets; null when it verified nothing at all. */
export function exerciseEvidence(sets: readonly EvidenceSet[]): ExerciseEvidence | null {
  const cam = sets.filter((s) => !s.warmup && hasCameraEvidence(s));
  if (cam.length === 0) return null;
  const issues = new Map<string, number>();
  for (const s of cam) {
    const msg = s.quality?.topIssue?.message;
    if (msg) issues.set(msg, (issues.get(msg) ?? 0) + s.verifiedReps);
  }
  const top = [...issues.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    cameraSets: cam.length,
    verified: cam.reduce((a, s) => a + s.verifiedReps, 0),
    attemptedKnown: cam.every((s) => s.quality !== null),
    attempted: cam.reduce((a, s) => a + Math.max(s.verifiedReps, s.quality?.attemptedReps ?? s.verifiedReps), 0),
    avgForm: weighted(cam.map((s) => ({ v: s.quality?.averageFormScore ?? s.formScore, w: s.verifiedReps }))),
    avgRom: weighted(cam.map((s) => ({ v: s.quality?.averageRomPercent ?? s.romPercent, w: s.verifiedReps }))),
    perfect: cam.reduce((a, s) => a + (s.quality?.perfectReps ?? 0), 0),
    partial: cam.reduce((a, s) => a + (s.quality?.rejectedReps.insufficient_rom ?? 0), 0),
    topIssue: top ? top[0] : null,
  };
}

/** "6 of 8 reps verified (2 didn't reach full range); most common fix: keep your back neutral". Null when the camera saw no reps. */
export function whatWeSaw(e: ExerciseEvidence): string | null {
  if (e.attempted === 0) return null;
  const head = e.attemptedKnown ? `${e.verified} of ${reps(e.attempted)} verified` : `${reps(e.verified)} verified`;
  const partial = e.partial > 0 ? ` (${e.partial} didn't reach full range)` : '';
  const fix = e.topIssue && e.verified > 0 ? `; most common fix: ${lowerFirst(e.topIssue)}` : '';
  return `${head}${partial}${fix}`;
}

/**
 * The one thing to do next time, by the same rules adaptive training uses: form under the bar → clean it up first;
 * range under the bar (or reps that fell short of it) → own the full range; otherwise progress. Null with nothing verified.
 */
export function nextTime(e: ExerciseEvidence): string | null {
  if (e.verified === 0) return null;
  if (e.avgForm !== null && e.avgForm < ADAPTIVE_RULES.progressFormScore) {
    return e.topIssue
      ? `Focus on this before adding weight: ${lowerFirst(e.topIssue)}. Progress once form averages ${ADAPTIVE_RULES.progressFormScore}+.`
      : `Make every rep clean before adding weight. Progress once form averages ${ADAPTIVE_RULES.progressFormScore}+.`;
  }
  if (e.partial > 0 || (e.avgRom !== null && e.avgRom < ADAPTIVE_RULES.progressRomPercent)) {
    return 'Go for the full range of motion before adding weight.';
  }
  // Only claim solid form and range when both were actually measured.
  if (e.avgForm === null || e.avgRom === null) return null;
  return 'Form and range were solid — you are ready to add a little weight or a rep or two.';
}
