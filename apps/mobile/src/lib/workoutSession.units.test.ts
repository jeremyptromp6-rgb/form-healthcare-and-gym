import type { SessionExercise } from './types';
import { loadToDisplay } from './units';
import { formatPrevious, formatTarget, nextSetDefaults, verificationNote } from './workoutSession';

const ex = (over: Partial<SessionExercise> = {}): SessionExercise => ({
  exerciseId: 'bicep_curl',
  name: 'Bicep Curl',
  planned: true,
  sets: 3,
  targetReps: { min: 8, max: 12 },
  targetLoadKg: 20,
  restSeconds: 90,
  note: null,
  cameraVerifiable: false,
  loadable: true,
  previous: { localDate: '2026-09-26', sets: [{ reps: 12, loadKg: 61.23 }] },
  loggedSets: [],
  ...over,
});

const logged = (reps: number, loadKg: number) =>
  ({ id: 's', clientSetId: 'c', exerciseId: 'bicep_curl', setIndex: 0, targetReps: null, targetLoadKg: null, reps, loadKg, verifiedReps: 0, verificationStatus: 'not_tracked', romPercent: null, formScore: null, quality: null, createdAt: '' }) as SessionExercise['loggedSets'][number];

describe('next set defaults in display units', () => {
  it('is unchanged for metric users', () => {
    expect(nextSetDefaults(ex())).toEqual({ reps: 12, loadKg: 20 });
    expect(nextSetDefaults(ex(), 'metric')).toEqual({ reps: 12, loadKg: 20 });
    expect(nextSetDefaults(ex({ targetLoadKg: null }), 'metric')).toEqual({ reps: 12, loadKg: 61.23 });
  });

  it('gives imperial users a round number of pounds for a plan target (still kg underneath)', () => {
    const d = nextSetDefaults(ex(), 'imperial');
    expect(loadToDisplay(d.loadKg, 'imperial')).toBe(44);
    expect(d.loadKg).toBe(19.96);
  });

  it("repeats an imperial user's own last set exactly", () => {
    expect(nextSetDefaults(ex({ loggedSets: [logged(10, 61.23)] }), 'imperial').loadKg).toBe(61.23);
    expect(loadToDisplay(nextSetDefaults(ex({ loggedSets: [logged(10, 61.23)] }), 'imperial').loadKg, 'imperial')).toBe(135);
  });

  it('falls back to last time, then zero, and is zero for bodyweight moves', () => {
    expect(loadToDisplay(nextSetDefaults(ex({ targetLoadKg: null }), 'imperial').loadKg, 'imperial')).toBe(135);
    expect(nextSetDefaults(ex({ targetLoadKg: null, previous: null }), 'imperial').loadKg).toBe(0);
    expect(nextSetDefaults(ex({ loadable: false }), 'imperial').loadKg).toBe(0);
  });
});

describe('targets and previous sets in display units', () => {
  it('shows kilograms for metric and pounds for imperial', () => {
    expect(formatTarget(ex())).toBe('8–12 reps @ 20 kg');
    expect(formatTarget(ex(), 'imperial')).toBe('8–12 reps @ 44 lb');
    expect(formatPrevious(ex())).toBe('12 × 61.23 kg');
    expect(formatPrevious(ex(), 'imperial')).toBe('12 × 135 lb');
  });

  it('leaves out the load for bodyweight targets', () => {
    expect(formatTarget(ex({ targetLoadKg: null }), 'imperial')).toBe('8–12 reps');
  });
});

describe('verificationNote', () => {
  it("says honestly that the camera's time didn't match, and nothing for other statuses", () => {
    expect(verificationNote('trace_exceeds_time')).toBe("Not verified — camera time didn't match the workout");
    expect(verificationNote('verified')).toBeNull();
    expect(verificationNote('not_tracked')).toBeNull();
    expect(verificationNote(undefined)).toBeNull();
  });
});
