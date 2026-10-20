import { render, screen } from '@testing-library/react-native';
import type { WorkoutSummaryDetail } from '@/lib/types';
import { WorkoutSummaryView } from './WorkoutSummaryView';

const summary: WorkoutSummaryDetail = {
  workout: { id: 'w1', localDate: '2026-09-28', durationMinutes: 42, painLevel: 'none', xp: 40, flags: [] },
  totals: { sets: 3, reps: 25, verifiedReps: 5, volumeKg: 120, perfectReps: 4, averageFormScore: 92 },
  sets: [
    { exerciseId: 'bicep_curl', name: 'Bicep Curl', setIndex: 0, targetReps: 12, reps: 10, verifiedReps: 0, loadKg: 12, romPercent: null, formScore: null, quality: null, mode: 'live', liveSeconds: 40 },
    { exerciseId: 'bicep_curl', name: 'Bicep Curl', setIndex: 1, targetReps: 12, reps: 10, verifiedReps: 0, loadKg: 12, romPercent: null, formScore: null, quality: null, mode: 'manual' },
    { exerciseId: 'bodyweight_squat', name: 'Bodyweight Squat', setIndex: 0, targetReps: null, reps: 5, verifiedReps: 5, loadKg: 0, romPercent: 100, formScore: 92, quality: null, mode: 'camera' },
  ],
  prs: [],
};

describe('summary: how each set was recorded', () => {
  it('badges every working set (a checked-off set reads Logged) and says manual sets earn less, right after the workout', async () => {
    await render(<WorkoutSummaryView summary={summary} onDone={jest.fn()} />);
    expect(screen.getByText('Logged')).toBeTruthy();
    expect(screen.queryByText('Live')).toBeNull();
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.getByText('Camera')).toBeTruthy();
    expect(screen.getByText(/^Manual sets earn less XP/)).toBeTruthy();
  });

  it('shows no note when no set resolved to manual', async () => {
    const noManual = { ...summary, sets: summary.sets.filter((s) => s.mode !== 'manual') };
    await render(<WorkoutSummaryView summary={noManual} onDone={jest.fn()} />);
    expect(screen.getByText('Logged')).toBeTruthy();
    expect(screen.queryByText(/Manual sets earn less XP/)).toBeNull();
  });

  it('shows the badges but not the note in history', async () => {
    await render(<WorkoutSummaryView summary={summary} title="Workout" />);
    expect(screen.getByText('Manual')).toBeTruthy();
    expect(screen.queryByText(/Manual sets earn less XP/)).toBeNull();
  });

  it('leaves the badge off older records without a mode', async () => {
    const old = { ...summary, sets: summary.sets.map(({ mode: _m, liveSeconds: _l, ...s }) => s) };
    await render(<WorkoutSummaryView summary={old} onDone={jest.fn()} />);
    expect(screen.queryByText('Logged')).toBeNull();
    expect(screen.queryByText(/Manual sets earn less XP/)).toBeNull();
  });
});
