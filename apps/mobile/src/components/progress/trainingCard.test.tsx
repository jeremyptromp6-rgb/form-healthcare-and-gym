import { render, screen } from '@testing-library/react-native';
import { TrainingCard } from './TrainingCard';

describe('TrainingCard', () => {
  it('totals real workouts, charts each one, and marks this week', async () => {
    await render(
      <TrainingCard
        today="2026-10-06"
        workouts={[
          { id: 'a', localDate: '2026-10-05', durationMinutes: 40, xp: 30 },
          { id: 'b', localDate: '2026-10-01', durationMinutes: 25, xp: 20 },
        ]}
      />,
    );
    expect(screen.getByText('Training time · last 2 workouts')).toBeTruthy();
    expect(screen.getByText('65')).toBeTruthy();
    expect(screen.getByLabelText('Minutes per workout: 25, 40')).toBeTruthy();
    expect(screen.getByLabelText('Trained 1 day this week')).toBeTruthy();
    expect(screen.getByLabelText('XP: 50')).toBeTruthy();
  });

  it('invites a first workout when there are none', async () => {
    await render(<TrainingCard today="2026-10-06" workouts={[]} />);
    expect(screen.getByText('Training time')).toBeTruthy();
    expect(screen.getByText(/Finish a workout/)).toBeTruthy();
  });
});
