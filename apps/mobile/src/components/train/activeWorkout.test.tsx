import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';
import { Animated } from 'react-native';
import type { SessionExercise, WorkoutSession } from '@/lib/types';
import { ActiveWorkoutView, type ActiveWorkoutViewProps } from './ActiveWorkoutView';

// test/setup.ts turns reduced motion on; the animation test turns it off through this flag.
let mockReduce = true;
jest.mock('@/lib/a11y', () => ({ ...jest.requireActual('@/lib/a11y'), useReducedMotion: () => mockReduce }));

const NOW = new Date('2026-09-28T10:20:00Z');

function ex(over: Partial<SessionExercise> = {}): SessionExercise {
  return {
    exerciseId: 'bicep_curl',
    name: 'Bicep Curl',
    planned: true,
    sets: 3,
    targetReps: { min: 8, max: 12 },
    targetLoadKg: 12,
    restSeconds: 90,
    note: null,
    cameraVerifiable: true,
    loadable: true,
    previous: { localDate: '2026-09-26', sets: [{ reps: 12, loadKg: 10 }, { reps: 11, loadKg: 10 }] },
    loggedSets: [],
    ...over,
  };
}

const logged = (reps: number, loadKg: number, id: string, over: Record<string, unknown> = {}) => ({
  id,
  clientSetId: `c-${id}`,
  exerciseId: 'x',
  setIndex: 0,
  targetReps: 12,
  targetLoadKg: null,
  reps,
  loadKg,
  verifiedReps: 0,
  verificationStatus: 'not_tracked',
  romPercent: null,
  formScore: null,
  quality: null,
  createdAt: '',
  ...over,
});

function session(over: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'sess-1',
    clientSessionId: 'c-1',
    status: 'active',
    localDate: '2026-09-28',
    startedAt: '2026-09-28T10:00:00Z',
    pausedAt: null,
    pausedMs: 5 * 60_000,
    activeMinutes: 15,
    lastActivityAt: '2026-09-28T10:19:00Z',
    idleSince: null,
    leftOpen: false,
    rest: null,
    workoutId: null,
    completedAt: null,
    exercises: [ex(), ex({ exerciseId: 'push_up', name: 'Push-Up', loadable: false, targetLoadKg: null, targetReps: { min: 6, max: 15 }, previous: null })],
    ...over,
  };
}

async function renderView(s: WorkoutSession, over: Partial<ActiveWorkoutViewProps> = {}) {
  const props: ActiveWorkoutViewProps = {
    session: s,
    index: 0,
    onSelectExercise: jest.fn(),
    draft: { reps: 12, loadKg: 12 },
    onChangeDraft: jest.fn(),
    loadStepKg: 1,
    onLogSet: jest.fn(),
    onLogSetAt: jest.fn(),
    onDeleteSet: jest.fn(),
    onPause: jest.fn(),
    onResume: jest.fn(),
    onSkipRest: jest.fn(),
    onAddRest: jest.fn(),
    onEnd: jest.fn(),
    onClose: jest.fn(),
    now: NOW,
    today: '2026-09-28',
    ...over,
  };
  await render(<ActiveWorkoutView {...props} />);
  return props;
}

const resting = () => session({ rest: { endsAt: '2026-09-28T10:21:30Z', seconds: 90, remainingSeconds: 90 } });

describe('ActiveWorkoutView as one logger', () => {
  beforeEach(() => {
    mockReduce = true;
  });

  it('renders every exercise with its set table in one tree', async () => {
    await renderView(session());
    // Bicep Curl (focused) and Push-Up (compact) each have their next set as the active row.
    expect(screen.getAllByLabelText('Set 1 reps')[0]).toBeTruthy();
    expect(screen.getByLabelText('Set 1 weight in kilograms')).toBeTruthy();
    expect(screen.getAllByLabelText('Set 1 reps')).toHaveLength(2); // Bicep Curl and Push-Up
    expect(screen.getByRole('button', { name: 'Complete set 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log set 1 of Push-Up' })).toBeTruthy();
    // Only the focused exercise is a header; the others are compact, pressable rows.
    expect(screen.getAllByRole('header')).toHaveLength(1);
    expect(screen.getByRole('header', { name: 'Bicep Curl' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show Push-Up' })).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByText('0/3 sets')).toBeTruthy();
  });

  it('logs the typed values from the focused row check', async () => {
    const p = await renderView(session());
    await fireEvent.changeText(screen.getByLabelText('Set 1 weight in kilograms'), '22,5');
    await fireEvent.changeText(screen.getAllByLabelText('Set 1 reps')[0]!, '9');
    await fireEvent.press(screen.getByRole('button', { name: 'Complete set 1' }));
    expect(p.onLogSet).toHaveBeenCalledTimes(1);
    expect(p.onLogSet).toHaveBeenCalledWith({ reps: 9, loadKg: 22.5 });
    // The whole typed set was also pushed into the parent's draft, last.
    expect(p.onChangeDraft).toHaveBeenLastCalledWith({ reps: 9, loadKg: 22.5 });
  });

  it('logs the draft when the Log set button is pressed (no arguments)', async () => {
    const p = await renderView(session());
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1' }));
    expect(p.onLogSet).toHaveBeenCalledTimes(1);
    expect(p.onLogSet).toHaveBeenCalledWith();
  });

  it('logs another exercise straight from its row with the edited values', async () => {
    const p = await renderView(session());
    await fireEvent.changeText(screen.getAllByLabelText('Set 1 reps')[1]!, '14');
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    expect(p.onLogSetAt).toHaveBeenCalledTimes(1);
    expect(p.onLogSetAt).toHaveBeenCalledWith(1, { reps: 14, loadKg: 0 });
    expect(p.onLogSet).not.toHaveBeenCalled();
  });

  it('uses the suggested numbers for another exercise when nothing is edited, weight included', async () => {
    const p = await renderView(session(), { index: 1, draft: { reps: 10, loadKg: 0 } });
    // Bicep Curl is now the compact one; its defaults are the plan (12 reps @ 12 kg).
    await fireEvent.changeText(screen.getByLabelText('Set 1 weight in kilograms'), '15');
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Bicep Curl' }));
    expect(p.onLogSetAt).toHaveBeenCalledWith(0, { reps: 12, loadKg: 15 });
  });

  it('leaves other exercises display-only without onLogSetAt', async () => {
    await renderView(session(), { onLogSetAt: undefined });
    expect(screen.queryByRole('button', { name: /Log set 1 of/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Complete set 1' })).toBeTruthy();
  });

  it('only lets the next set be completed; later planned sets are display-only', async () => {
    await renderView(session({ exercises: [ex({ loggedSets: [logged(12, 12, 'a')] }), ex({ exerciseId: 'push_up', name: 'Push-Up' })] }));
    // Focused Bicep Curl: set 1 done, set 2 active, set 3 queued.
    expect(screen.getByLabelText('Set 1 done')).toBeTruthy();
    expect(screen.getByLabelText('Set 2 reps')).toBeTruthy();
    expect(screen.queryByLabelText('Set 3 reps')).toBeNull();
    expect(screen.getByText('Set 2 of 3 · 8–12 reps @ 12 kg')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Complete set 2' })).toBeTruthy();
  });

  it('floats the rest timer with +15 s, +30 s and Skip, keeping logging available', async () => {
    const p = await renderView(resting());
    expect(screen.getByLabelText('90 seconds of rest left')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Log set 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Increase Reps' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '+15 s' }));
    expect(p.onAddRest).toHaveBeenLastCalledWith(105);
    await fireEvent.press(screen.getByRole('button', { name: '+30 s' }));
    expect(p.onAddRest).toHaveBeenLastCalledWith(120);
    await fireEvent.press(screen.getByRole('button', { name: 'Skip rest' }));
    expect(p.onSkipRest).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1' }));
    expect(p.onLogSet).toHaveBeenCalledTimes(1);
  });

  it('has no rest pill when not resting', async () => {
    await renderView(session());
    expect(screen.queryByRole('button', { name: 'Skip rest' })).toBeNull();
  });

  it('deletes a logged set of the focused exercise and shows its verified badge', async () => {
    const s = session({ exercises: [ex({ loggedSets: [logged(12, 12, 'set-a', { verifiedReps: 10, formScore: 92 })] }), ex({ exerciseId: 'push_up', name: 'Push-Up' })] });
    const p = await renderView(s);
    expect(screen.getByText('10 verified · Great form')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete set 1' }));
    expect(p.onDeleteSet).toHaveBeenCalledWith('set-a');
  });

  it('keeps delete labels unique when several exercises have logged sets', async () => {
    const s = session({ exercises: [ex({ loggedSets: [logged(12, 12, 'set-a')] }), ex({ exerciseId: 'push_up', name: 'Push-Up', loadable: false, loggedSets: [logged(10, 0, 'set-b')] })] });
    await renderView(s);
    expect(screen.getAllByRole('button', { name: /Delete set 1/ })).toHaveLength(1);
  });

  it('shows the left-open message', async () => {
    await renderView(session({ leftOpen: true, idleSince: '2026-09-27T19:00:00Z', localDate: '2026-09-27' }));
    expect(screen.getByText(/You left this workout open on Sunday/)).toBeTruthy();
  });

  it('shows the pause overlay and resumes', async () => {
    const p = await renderView(session({ status: 'paused', pausedAt: '2026-09-28T10:15:00Z' }));
    expect(screen.getByText('Paused', { exact: true })).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Resume' })[0]!);
    expect(p.onResume).toHaveBeenCalled();
  });

  it('pauses, minimises and opens the camera', async () => {
    const onOpenCamera = jest.fn();
    const p = await renderView(session(), { onOpenCamera });
    await fireEvent.press(screen.getByRole('button', { name: 'Pause workout' }));
    expect(p.onPause).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Minimise workout' }));
    expect(p.onClose).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Use camera coaching' }));
    expect(onOpenCamera).toHaveBeenCalled();
  });

  it('focuses a compact section when it is pressed', async () => {
    const p = await renderView(session());
    await fireEvent.press(screen.getByRole('button', { name: 'Show Push-Up' }));
    expect(p.onSelectExercise).toHaveBeenCalledWith(1);
  });

  it('shows the log error in the focused section by default and in logErrorIndex when given', async () => {
    await renderView(session(), { logError: 'Not saved — no connection.' });
    expect(screen.getByText('Not saved — no connection.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry — save this set' })).toBeTruthy();
  });

  it('puts the log error under another exercise and leaves the focused log button alone', async () => {
    const p = await renderView(session(), { logError: 'Not saved — no connection.', logErrorIndex: 1 });
    expect(screen.getAllByText('Not saved — no connection.')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry — save this set' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Log set 1' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    expect(p.onLogSetAt).toHaveBeenCalledWith(1, { reps: 15, loadKg: 0 });
  });

  it('disables logging while paused', async () => {
    await renderView(session({ status: 'paused', pausedAt: '2026-09-28T10:15:00Z' }));
    // The modal overlay hides the table from assistive tech; the disabled state is still set on the check.
    const check = screen.getByRole('button', { name: 'Complete set 1', includeHiddenElements: true });
    expect(check.props.accessibilityState.disabled).toBe(true);
  });

  it('shows every active row busy and blocked while a set is being saved, not just the focused one', async () => {
    await renderView(session(), { logging: true });
    for (const name of ['Complete set 1', 'Log set 1 of Push-Up']) {
      const check = screen.getByRole('button', { name });
      expect(check.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Log set 1 of Push-Up' }));
    expect(screen.getByRole('button', { name: 'Complete set 1' }).props.accessibilityState.busy).toBe(true);
  });

  it('leaves the active rows idle when nothing is being saved', async () => {
    await renderView(session());
    for (const name of ['Complete set 1', 'Log set 1 of Push-Up']) {
      expect(screen.getByRole('button', { name }).props.accessibilityState).toMatchObject({ disabled: false, busy: false });
    }
  });

  describe('typed values reach the draft before any blur', () => {
    function Harness({ onLog }: { onLog: (d: { reps: number; loadKg: number }) => void }) {
      const [draft, setDraft] = useState({ reps: 12, loadKg: 12 });
      const base: ActiveWorkoutViewProps = {
        session: session(),
        index: 0,
        onSelectExercise: jest.fn(),
        draft,
        onChangeDraft: setDraft,
        loadStepKg: 1,
        onLogSet: (d) => onLog(d ?? draft), // like workout.tsx: no argument logs the parent's draft
        onDeleteSet: jest.fn(),
        onPause: jest.fn(),
        onResume: jest.fn(),
        onSkipRest: jest.fn(),
        onAddRest: jest.fn(),
        onEnd: jest.fn(),
        onClose: jest.fn(),
        now: NOW,
        today: '2026-09-28',
      };
      return <ActiveWorkoutView {...base} />;
    }

    it('logs what was typed when the big Log set button is pressed without the field blurring', async () => {
      const onLog = jest.fn();
      await render(<Harness onLog={onLog} />);
      await fireEvent.changeText(screen.getByLabelText('Set 1 weight in kilograms'), '22.5');
      await fireEvent.changeText(screen.getAllByLabelText('Set 1 reps')[0]!, '9');
      await fireEvent.press(screen.getByRole('button', { name: 'Log set 1' })); // no blur in between
      expect(onLog).toHaveBeenCalledTimes(1);
      expect(onLog).toHaveBeenCalledWith({ reps: 9, loadKg: 22.5 });
    });

    it('passes each parseable keystroke to onChangeDraft as it is typed', async () => {
      const p = await renderView(session());
      await fireEvent.changeText(screen.getAllByLabelText('Set 1 reps')[0]!, '9');
      expect(p.onChangeDraft).toHaveBeenLastCalledWith({ reps: 9, loadKg: 12 });
      await fireEvent.changeText(screen.getByLabelText('Set 1 weight in kilograms'), '22.');
      expect(p.onChangeDraft).toHaveBeenLastCalledWith({ reps: 12, loadKg: 22 });
    });

    it('steps from the typed number, not from a stale draft', async () => {
      await render(<Harness onLog={jest.fn()} />);
      await fireEvent.changeText(screen.getAllByLabelText('Set 1 reps')[0]!, '20');
      await fireEvent.press(screen.getByRole('button', { name: 'Increase Reps' }));
      expect(screen.getAllByLabelText('Set 1 reps')[0]!.props.value).toBe('21');
    });
  });
});

describe('ActiveWorkoutView completion animation', () => {
  beforeEach(() => {
    mockReduce = false;
    jest.useFakeTimers();
  });
  afterEach(async () => {
    await act(async () => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    mockReduce = true;
  });

  const props = (s: WorkoutSession): ActiveWorkoutViewProps => ({
    session: s,
    index: 0,
    onSelectExercise: jest.fn(),
    draft: { reps: 12, loadKg: 12 },
    onChangeDraft: jest.fn(),
    loadStepKg: 1,
    onLogSet: jest.fn(),
    onDeleteSet: jest.fn(),
    onPause: jest.fn(),
    onResume: jest.fn(),
    onSkipRest: jest.fn(),
    onAddRest: jest.fn(),
    onEnd: jest.fn(),
    onClose: jest.fn(),
    now: NOW,
    today: '2026-09-28',
  });

  it('plays when the active set is logged: the same row turns done instead of being replaced', async () => {
    const { rerender } = await render(<ActiveWorkoutView {...props(session())} />);
    expect(screen.getByRole('button', { name: 'Complete set 1' })).toBeTruthy();
    const timing = jest.spyOn(Animated, 'timing');
    const withSet = session({ exercises: [ex({ loggedSets: [logged(12, 12, 'a')] }), ex({ exerciseId: 'push_up', name: 'Push-Up', loadable: false, targetLoadKg: null, previous: null })] });
    await rerender(<ActiveWorkoutView {...props(withSet)} />);
    expect(screen.getByLabelText('Set 1 done')).toBeTruthy();
    expect(timing).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ toValue: 1.25 }));
    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByLabelText('Set 1 done')).toBeTruthy();
    timing.mockRestore();
  });

  it('does not animate rows that are already done when the screen opens', async () => {
    const timing = jest.spyOn(Animated, 'timing');
    await render(<ActiveWorkoutView {...props(session({ exercises: [ex({ loggedSets: [logged(12, 12, 'a')] })] }))} />);
    expect(timing).not.toHaveBeenCalled();
    timing.mockRestore();
  });
});
