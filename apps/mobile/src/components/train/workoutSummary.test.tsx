import type { SetQuality } from '@form/domain';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { WorkoutSummaryDetail } from '@/lib/types';
import { WorkoutSummaryView } from './WorkoutSummaryView';

// What the summary shows about the camera: an evidence card only when the camera had a say, what we saw and
// what to do next per exercise, honest zero-verified and manual-only cases, PR rules and the next steps.

const quality = (over: Partial<SetQuality> = {}): SetQuality => ({
  attemptedReps: 8,
  verifiedReps: 6,
  rejectedReps: { insufficient_rom: 2 },
  incomplete: false,
  averageFormScore: 74,
  averageRomPercent: 93,
  perfectReps: 2,
  topIssue: { code: 'torso_lean', message: 'Keep your back neutral' },
  ...over,
});

type SummarySet = WorkoutSummaryDetail['sets'][number];
const squat = (over: Partial<SummarySet> = {}): SummarySet => ({
  exerciseId: 'bodyweight_squat', name: 'Bodyweight Squat', setIndex: 0, targetReps: 10, reps: 6, verifiedReps: 6, loadKg: 0, romPercent: 93, formScore: 74, quality: quality(), mode: 'camera', ...over,
});
const curl = (over: Partial<SummarySet> = {}): SummarySet => ({
  exerciseId: 'bicep_curl', name: 'Bicep Curl', setIndex: 0, targetReps: 12, reps: 10, verifiedReps: 0, loadKg: 12, romPercent: null, formScore: null, quality: null, mode: 'manual', ...over,
});

const make = (sets: SummarySet[], over: Partial<WorkoutSummaryDetail> = {}): WorkoutSummaryDetail => ({
  workout: { id: 'w1', localDate: '2026-09-28', durationMinutes: 30, painLevel: 'none', xp: 50, flags: [] },
  totals: { sets: sets.length, reps: sets.reduce((a, s) => a + s.reps, 0), verifiedReps: sets.reduce((a, s) => a + s.verifiedReps, 0), volumeKg: 120, perfectReps: 2, averageFormScore: sets.some((s) => s.formScore !== null) ? 74 : null },
  sets,
  prs: [],
  ...over,
});

describe('WorkoutSummaryView camera evidence', () => {
  it('shows the evidence card, what we saw and the next step for a camera exercise', async () => {
    await render(<WorkoutSummaryView summary={make([squat()])} />);
    expect(screen.getByText('What the camera verified')).toBeTruthy();
    expect(screen.getByText('Verified reps')).toBeTruthy();
    expect(screen.getByText('of 8')).toBeTruthy();
    expect(screen.getByText('Average range')).toBeTruthy();
    expect(screen.getByText('93%')).toBeTruthy();
    expect(screen.getByText("Not counted: 2 reps didn't reach full range.")).toBeTruthy();
    expect(screen.getByText("What we saw: 6 of 8 reps verified (2 didn't reach full range); most common fix: keep your back neutral.")).toBeTruthy();
    // Form 74 is under the adaptive bar (80): clean it up before adding weight.
    expect(screen.getByText(/^Next time: Focus on this before adding weight: keep your back neutral/)).toBeTruthy();
  });

  it('tells a strong set to progress', async () => {
    const strong = squat({ formScore: 88, romPercent: 96, quality: quality({ attemptedReps: 8, verifiedReps: 8, rejectedReps: {}, averageFormScore: 88, averageRomPercent: 96, topIssue: null }), verifiedReps: 8, reps: 8 });
    await render(<WorkoutSummaryView summary={make([strong])} />);
    expect(screen.getByText(/^Next time: Form and range were solid/)).toBeTruthy();
    expect(screen.queryByText(/Not counted/)).toBeNull();
  });

  it('a mixed workout scores only the camera sets and says the rest were by hand', async () => {
    await render(<WorkoutSummaryView summary={make([squat(), curl()])} />);
    expect(screen.getByText('What the camera verified')).toBeTruthy();
    expect(screen.getByText('The camera tracked 1 of 2 sets. The others were logged by hand and are not scored for form or range.')).toBeTruthy();
    // The hand-logged exercise gets no what-we-saw or next-time line.
    expect(screen.getAllByText(/^What we saw:/)).toHaveLength(1);
    expect(screen.getAllByText(/^Next time:/)).toHaveLength(1);
  });

  it('a manual-only workout shows no camera card, form, range or placeholder numbers', async () => {
    const manualOnly = make([curl(), curl({ setIndex: 1 })], { totals: { sets: 2, reps: 20, verifiedReps: 0, volumeKg: 240, perfectReps: 0, averageFormScore: null } });
    await render(<WorkoutSummaryView summary={manualOnly} />);
    expect(screen.queryByText('What the camera verified')).toBeNull();
    expect(screen.queryByText('Verified reps')).toBeNull();
    expect(screen.queryByText(/form|ROM|range/i)).toBeNull();
    expect(screen.queryByText(/What we saw|Next time/)).toBeNull();
  });

  it('a camera set with zero verified reps says so and keeps the reps, with no advice invented', async () => {
    const none = squat({ verifiedReps: 0, reps: 10, formScore: null, romPercent: null, quality: quality({ verifiedReps: 0, attemptedReps: 3, rejectedReps: { insufficient_rom: 3 }, averageFormScore: null, averageRomPercent: null, topIssue: null }) });
    await render(<WorkoutSummaryView summary={make([none], { totals: { sets: 1, reps: 10, verifiedReps: 0, volumeKg: 0, perfectReps: 0, averageFormScore: null } })} />);
    expect(screen.getByText("The camera didn't verify any reps this time (3 reps didn't reach full range). Your reps are kept as logged and earn XP as logged sets.")).toBeTruthy();
    expect(screen.queryByText(/^Next time:/)).toBeNull();
    expect(screen.queryByText('Average form')).toBeNull();
  });

  it('only a beaten record is a PR card; a first value is a baseline', async () => {
    const prs = [
      { exerciseId: 'bodyweight_squat', kind: 'max_reps', value: 12, status: 'awarded', previous: 10 },
      { exerciseId: 'bodyweight_squat', kind: 'best_form', value: 90, status: 'awarded', previous: null },
    ];
    await render(<WorkoutSummaryView summary={make([squat()], { prs })} />);
    expect(screen.getAllByText('New personal record')).toHaveLength(1);
    expect(screen.getByText('First records set')).toBeTruthy();
  });

  it('offers the next steps and links each exercise, only when it can navigate', async () => {
    const onNavigate = jest.fn();
    await render(<WorkoutSummaryView summary={make([squat()])} onNavigate={onNavigate} />);
    await fireEvent.press(screen.getByRole('button', { name: 'See your next workout' }));
    expect(onNavigate).toHaveBeenLastCalledWith('/train');
    await fireEvent.press(screen.getByRole('button', { name: 'Your progress' }));
    expect(onNavigate).toHaveBeenLastCalledWith('/progress/analytics');
    await fireEvent.press(screen.getByRole('link', { name: 'Bodyweight Squat, open exercise' }));
    expect(onNavigate).toHaveBeenLastCalledWith('/train/exercise/bodyweight_squat');
  });

  it('shows no next-step buttons or links without a way to navigate, and never an upsell', async () => {
    await render(<WorkoutSummaryView summary={make([squat()])} />);
    expect(screen.queryByRole('button', { name: 'See your next workout' })).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/Upgrade|FORM Pro/)).toBeNull();
  });
});
