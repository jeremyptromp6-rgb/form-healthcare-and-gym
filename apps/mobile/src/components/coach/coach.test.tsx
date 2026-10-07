import { fireEvent, render, screen } from '@testing-library/react-native';
import type { CoachResponse, CoachStatus, CoachTurn } from '@/lib/types';
import { CoachCard, CoachChatView, COACH_SUGGESTIONS, degradedNote, providerLabel } from './CoachViews';

const response = (over: Partial<CoachResponse> = {}): CoachResponse => ({
  topic: 'home',
  message: "You've done 1 of 3 planned sessions this week. Today is a good day to train.",
  category: 'consistency',
  priority: 'normal',
  evidence: [{ fact: 'training.doneThisWeek', claim: 'Sessions this week', value: '1' }],
  actions: [{ id: 'open_train', label: 'Start a workout', route: '/train' }],
  confidence: 'high',
  generatedAt: '2026-09-30T12:00:00Z',
  provider: { type: 'real_ai', name: 'Claude (claude-opus-5-5)' },
  degraded: null,
  ...over,
});

const status = (over: Partial<CoachStatus> = {}): CoachStatus => ({ mode: 'real_ai', provider: 'Claude', reason: null, aiAvailable: true, settings: { enabled: true, aiConsent: true, keepHistory: true }, chat: { available: true, maxChars: 1000, perHour: 20 }, retentionDays: 30, ...over });

describe('CoachCard', () => {
  it('shows the advice, what it is based on, and routes its actions', async () => {
    const onAction = jest.fn();
    await render(<CoachCard response={response()} onAction={onAction} />);
    expect(screen.getByText('AI coach')).toBeTruthy();
    expect(screen.getByText(/1 of 3 planned sessions/)).toBeTruthy();
    expect(screen.getByLabelText('Based on: Sessions this week, 1')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Start a workout' }));
    expect(onAction).toHaveBeenCalledWith('/train');
  });

  it('labels rule-based answers honestly and explains every fallback', async () => {
    const rules = response({ provider: { type: 'deterministic_fallback', name: 'FORM rules' }, degraded: 'invalid_output' });
    await render(<CoachCard response={rules} title="Today's tip" />);
    expect(screen.getByText('Rule-based tip')).toBeTruthy();
    expect(screen.getByText(/didn't pass FORM's accuracy and safety checks/)).toBeTruthy();
    expect(providerLabel(response())).toBe('AI coach');
    expect(degradedNote(response())).toBeNull();
    expect(degradedNote({ provider: { type: 'deterministic_fallback', name: 'FORM rules' }, degraded: null })).toBe('Rule-based coaching from your data — not AI.');
    for (const d of ['unconfigured', 'timeout', 'rate_limited', 'provider_error', 'daily_limit'] as const) {
      expect(degradedNote({ provider: { type: 'deterministic_fallback', name: 'FORM rules' }, degraded: d })).toMatch(/rule-based|until tomorrow/);
    }
  });
});

describe('CoachChatView', () => {
  const turns: CoachTurn[] = [
    { id: 1, role: 'user', text: "How's my form?", response: null, at: '2026-09-30T12:00:00Z' },
    { id: 2, role: 'coach', text: 'x', response: response({ message: 'Push your knees out over your toes on squats.', category: 'form', actions: [] }), at: '2026-09-30T12:00:05Z' },
  ];

  it('starts with an honest prompt and quick questions that send', async () => {
    const onSend = jest.fn();
    await render(<CoachChatView turns={[]} status={status()} sending={false} error={null} onSend={onSend} onAction={jest.fn()} onClear={jest.fn()} />);
    expect(screen.getByText(/Answers use only what FORM knows about you/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: COACH_SUGGESTIONS[1]! }));
    expect(onSend).toHaveBeenCalledWith("How's my form?");
    expect(screen.getByText(/not medical advice/)).toBeTruthy();
    expect(screen.getByText(/Chats are kept for 30 days/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Clear chat' })).toBeNull();
  });

  it('shows the conversation, sends trimmed text, and can clear', async () => {
    const onSend = jest.fn();
    const onClear = jest.fn();
    await render(<CoachChatView turns={turns} status={status()} sending={false} error={null} onSend={onSend} onAction={jest.fn()} onClear={onClear} />);
    expect(screen.getByLabelText("You: How's my form?")).toBeTruthy();
    expect(screen.getByText('Push your knees out over your toes on squats.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Message the coach'), '  What next?  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('What next?');
    await fireEvent.press(screen.getByRole('button', { name: 'Clear chat' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('is upfront that rules are not AI, and shows progress and errors', async () => {
    await render(<CoachChatView turns={turns} status={status({ mode: 'deterministic_fallback', provider: 'FORM rules', reason: 'unconfigured' })} sending error="You've sent a lot of messages — the coach will be ready again shortly." onSend={jest.fn()} onAction={jest.fn()} onClear={jest.fn()} />);
    expect(screen.getByText(/never presented as AI/)).toBeTruthy();
    expect(screen.getByLabelText('The coach is answering')).toBeTruthy();
    expect(screen.getByText(/the coach will be ready again shortly/)).toBeTruthy();
  });
});
