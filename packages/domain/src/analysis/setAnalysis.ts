import { assessRepForm, issueMessage, type FormIssueCode } from "./formAnalysis";
import { ROM_SPECS, verifyReps, type RejectedAttempt, type RepRejectionReason, type RepTrace, type RepVerificationResult, type RomSpec, type VerifiedRep } from "./repVerification";

/**
 * Set analysis: verification + form + ROM for one set, and the quality summary.
 *
 * Three rep counts, never mixed up:
 * - attempted: every movement the camera saw start (verified + rejected + unfinished);
 * - recorded: what the user logged (the set's `reps`);
 * - verified: reps the engine saw complete with the required range — the only reps that feed
 *   authoritative progression, and never more than the recorded reps.
 */

export const ANALYZER_VERSION = "rep-form/1";

export interface AssessedRep extends VerifiedRep {
  formScore: number;
  issues: FormIssueCode[];
  perfect: boolean;
}

export interface SetQuality {
  attemptedReps: number;
  verifiedReps: number;
  rejectedReps: Partial<Record<RepRejectionReason, number>>;
  /** A rep was in progress when the set ended (not counted). */
  incomplete: boolean;
  averageFormScore: number | null;
  averageRomPercent: number | null;
  perfectReps: number;
  /** The most common form issue across verified reps, for one actionable takeaway. */
  topIssue: { code: FormIssueCode; message: string } | null;
}

export interface SetAnalysis {
  analyzerVersion: string;
  status: RepVerificationResult["status"];
  reps: AssessedRep[];
  rejected: RejectedAttempt[];
  quality: SetQuality;
  gatedFrames: Record<string, number>;
  /** Trace size and span, for audit. */
  samples: number;
  spanMs: number;
}

const avg = (xs: number[]) => (xs.length === 0 ? null : Math.round(xs.reduce((a, b) => a + b, 0) / xs.length));

export function summarizeSet(exerciseId: string, reps: readonly AssessedRep[], rejected: readonly RejectedAttempt[], incomplete: boolean): SetQuality {
  const rejectedReps: Partial<Record<RepRejectionReason, number>> = {};
  for (const r of rejected) rejectedReps[r.reason] = (rejectedReps[r.reason] ?? 0) + 1;
  const counts = new Map<FormIssueCode, number>();
  for (const r of reps) for (const code of r.issues) counts.set(code, (counts.get(code) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    attemptedReps: reps.length + rejected.length + (incomplete ? 1 : 0),
    verifiedReps: reps.length,
    rejectedReps,
    incomplete,
    averageFormScore: avg(reps.map((r) => r.formScore)),
    averageRomPercent: avg(reps.map((r) => r.romPercent)),
    perfectReps: reps.filter((r) => r.perfect).length,
    topIssue: top ? { code: top[0], message: issueMessage(exerciseId, top[0]) } : null,
  };
}

/** Full analysis of a recorded set trace. Null for exercises without camera support. */
export function analyzeSet(exerciseId: string, trace: RepTrace): SetAnalysis | null {
  const spec = (ROM_SPECS as Record<string, RomSpec>)[exerciseId];
  if (!spec) return null;
  const v = verifyReps(trace, spec);
  const reps: AssessedRep[] = v.reps.map((rep) => {
    const form = assessRepForm(exerciseId, rep, trace.samples)!;
    return { ...rep, formScore: form.score, issues: form.issues.map((i) => i.code), perfect: form.perfect };
  });
  const samples = trace.samples.length;
  return {
    analyzerVersion: ANALYZER_VERSION,
    status: v.status,
    reps,
    rejected: v.rejected,
    quality: summarizeSet(exerciseId, reps, v.rejected, v.incomplete),
    gatedFrames: v.gatedFrames,
    samples,
    spanMs: samples > 1 ? Math.round(trace.samples[samples - 1]!.tMs - trace.samples[0]!.tMs) : 0,
  };
}

/**
 * Keeps only the first `recordedReps` verified reps (verified can never exceed recorded) and
 * recomputes the quality summary over what's kept. Attempts stay as the camera saw them.
 */
export function keepRecorded(exerciseId: string, analysis: SetAnalysis, recordedReps: number): SetAnalysis {
  const reps = analysis.reps.slice(0, recordedReps);
  const quality = summarizeSet(exerciseId, reps, analysis.rejected, analysis.quality.incomplete);
  return { ...analysis, reps, quality: { ...quality, attemptedReps: analysis.quality.attemptedReps } };
}
