import { ADAPTIVE_RULES, type SetQuality } from '@form/domain';
import { exerciseEvidence, formLevel, hasCameraEvidence, nextTime, rejectionReasons, setBadge, whatWeSaw, type EvidenceSet } from './setEvidence';

const quality = (over: Partial<SetQuality> = {}): SetQuality => ({
  attemptedReps: 8,
  verifiedReps: 6,
  rejectedReps: { insufficient_rom: 2 },
  incomplete: false,
  averageFormScore: 86,
  averageRomPercent: 92,
  perfectReps: 3,
  topIssue: { code: 'torso_lean', message: 'Keep your back neutral' },
  ...over,
});
const cam = (over: Partial<EvidenceSet> = {}): EvidenceSet => ({ mode: 'camera', reps: 6, verifiedReps: 6, formScore: 86, romPercent: 92, quality: quality(), verificationStatus: 'verified', ...over });
const manual = (over: Partial<EvidenceSet> = {}): EvidenceSet => ({ mode: 'manual', reps: 10, verifiedReps: 0, formScore: null, romPercent: null, quality: null, ...over });

describe('hasCameraEvidence', () => {
  it('is true for camera sets and sets carrying verification, false for typed-in and timed sets', () => {
    expect(hasCameraEvidence(cam())).toBe(true);
    expect(hasCameraEvidence(cam({ verifiedReps: 0, quality: null }))).toBe(true); // recorded by camera, nothing verified
    expect(hasCameraEvidence({ mode: undefined, verifiedReps: 4, quality: null })).toBe(true); // older server, no mode
    expect(hasCameraEvidence({ mode: undefined, verifiedReps: 0, quality: null, verificationStatus: 'trace_exceeds_time' })).toBe(true);
    expect(hasCameraEvidence(manual())).toBe(false);
    expect(hasCameraEvidence({ mode: 'live', verifiedReps: 0, quality: null })).toBe(false);
    expect(hasCameraEvidence({ mode: undefined, verifiedReps: 0, quality: null })).toBe(false);
  });
});

describe('setBadge', () => {
  it('reads "N verified · form Good · ROM 92%"', () => {
    expect(setBadge(cam({ verifiedReps: 8, formScore: 82, romPercent: 92.4 }))).toEqual({ label: '8 verified · form Good · ROM 92%' });
  });

  it('leaves out what was not measured', () => {
    expect(setBadge(cam({ verifiedReps: 5, formScore: null, romPercent: null }))).toEqual({ label: '5 verified' });
  });

  it('a camera set with nothing verified is "Not verified" with the reason, never a number', () => {
    const untrusted = setBadge(cam({ verifiedReps: 0, quality: null, verificationStatus: 'trace_exceeds_time' }))!;
    expect(untrusted).toMatchObject({ label: 'Not verified', tone: 'warning' });
    expect(untrusted.note).toBe("Camera time didn't match the workout. Your reps are kept as logged.");
    const partial = setBadge(cam({ verifiedReps: 0, quality: quality({ verifiedReps: 0, attemptedReps: 3, rejectedReps: { insufficient_rom: 3 } }) }))!;
    expect(partial.note).toBe("3 reps didn't reach full range. Your reps are kept as logged.");
    expect(setBadge(cam({ verifiedReps: 0, quality: null }))).toEqual({ label: 'Not verified', tone: 'warning' });
  });

  it('is null for typed-in sets: no form, no range, no placeholder', () => {
    expect(setBadge(manual())).toBeNull();
  });
});

describe('formLevel / rejectionReasons', () => {
  it('words the score', () => {
    expect([95, 80, 65, 40].map(formLevel)).toEqual(['Great', 'Good', 'Decent', 'Needs work']);
  });
  it('lists why reps did not count', () => {
    expect(rejectionReasons(quality({ rejectedReps: { insufficient_rom: 1, too_fast: 2, tracking_lost: 1 }, incomplete: true }))).toEqual([
      "1 rep didn't reach full range",
      '2 reps too fast to verify',
      '1 rep lost tracking',
      '1 unfinished rep',
    ]);
    expect(rejectionReasons(null)).toEqual([]);
  });
});

describe('exerciseEvidence / whatWeSaw / nextTime', () => {
  it('aggregates working camera sets only, weighting by verified reps', () => {
    const e = exerciseEvidence([
      cam({ verifiedReps: 6, quality: quality({ verifiedReps: 6, attemptedReps: 8, averageFormScore: 90, averageRomPercent: 95 }) }),
      cam({ verifiedReps: 2, quality: quality({ verifiedReps: 2, attemptedReps: 2, rejectedReps: {}, averageFormScore: 74, averageRomPercent: 91, topIssue: null }) }),
      cam({ warmup: true, verifiedReps: 9 }),
      manual(),
    ])!;
    expect(e).toMatchObject({ cameraSets: 2, verified: 8, attempted: 10, attemptedKnown: true, avgForm: 86, avgRom: 94, partial: 2, topIssue: 'Keep your back neutral' });
  });

  it('is null when the camera had no say (manual-only)', () => {
    expect(exerciseEvidence([manual(), manual()])).toBeNull();
  });

  it('does not claim an attempt total it does not have', () => {
    const e = exerciseEvidence([cam({ quality: null })])!;
    expect(e.attemptedKnown).toBe(false);
    expect(whatWeSaw(e)).toBe('6 reps verified');
  });

  it('says what we saw, with the most common fix', () => {
    expect(whatWeSaw(exerciseEvidence([cam()])!)).toBe("6 of 8 reps verified (2 didn't reach full range); most common fix: keep your back neutral");
    expect(whatWeSaw(exerciseEvidence([cam({ quality: quality({ rejectedReps: {}, attemptedReps: 6, topIssue: null }) })])!)).toBe('6 of 6 reps verified');
  });

  it('next time follows the adaptive rules: form first, then range, then progress', () => {
    const ev = (form: number, rom: number, partial = 0) =>
      exerciseEvidence([cam({ quality: quality({ averageFormScore: form, averageRomPercent: rom, rejectedReps: partial ? { insufficient_rom: partial } : {}, topIssue: form < 80 ? { code: 'torso_lean', message: 'Keep your back neutral' } : null }) })])!;
    expect(nextTime(ev(ADAPTIVE_RULES.progressFormScore - 1, 95))).toMatch(/keep your back neutral.*Progress once form averages 80\+/);
    expect(nextTime(ev(85, ADAPTIVE_RULES.progressRomPercent - 1))).toMatch(/full range of motion before adding weight/);
    expect(nextTime(ev(85, 95, 1))).toMatch(/full range of motion before adding weight/);
    expect(nextTime(ev(ADAPTIVE_RULES.progressFormScore, ADAPTIVE_RULES.progressRomPercent))).toMatch(/ready to add a little weight/);
  });

  it('gives no advice when nothing was verified', () => {
    expect(nextTime(exerciseEvidence([cam({ verifiedReps: 0, quality: quality({ verifiedReps: 0, averageFormScore: null, averageRomPercent: null }) })])!)).toBeNull();
  });
});
