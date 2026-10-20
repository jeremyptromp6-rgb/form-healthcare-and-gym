import { fireEvent, render, screen } from '@testing-library/react-native';
import CoachScreen from '@/app/coach';
import { ApiError } from '@/lib/api';
import type { CoachStatus, CoachTurn } from '@/lib/types';

/** The coach route: a failed message load shows an error, a failed send gives the text back, a failed clear says so. */

const mockSend = jest.fn();
const mockClear = jest.fn();
const mockMessagesRefetch = jest.fn();
let mockMessages: Record<string, unknown> = {};

const mockStatus: CoachStatus = { mode: 'real_ai', provider: 'Claude', reason: null, aiAvailable: true, settings: { enabled: true, aiConsent: true, keepHistory: true }, chat: { available: true, maxChars: 1000, perHour: 20 }, retentionDays: 30 };
const turns: CoachTurn[] = [{ id: 1, role: 'user', text: 'Hello', response: null, at: '2026-09-30T12:00:00Z' }];

jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true } }));
jest.mock('@/components/pro/ProUpsellFor', () => ({ ProUpsellFor: () => null }));
jest.mock('@/lib/pro', () => ({ proFeatureOf: () => null }));
jest.mock('@/lib/queries', () => ({
  useCoachStatus: () => ({ data: mockStatus, isError: false, error: null, refetch: jest.fn() }),
  useCoachMessages: () => mockMessages,
  useSendCoachMessage: () => ({ mutateAsync: (...a: unknown[]) => mockSend(...a), isPending: false }),
  useClearCoachMessages: () => ({ mutate: (...a: unknown[]) => mockClear(...a), isPending: false }),
}));

const offline = () => new ApiError('network', 'network', "Can't reach FORM.", null, true);

beforeEach(() => {
  jest.clearAllMocks();
  mockMessages = { data: { messages: turns, retentionDays: 30 }, isError: false, error: null, refetch: mockMessagesRefetch };
});

describe('Coach screen', () => {
  it('shows an error with a retry when the messages fail to load, not a spinner', async () => {
    mockMessages = { data: undefined, isError: true, error: offline(), refetch: mockMessagesRefetch };
    await render(<CoachScreen />);
    await fireEvent.press(screen.getByRole('button', { name: /try again|retry/i }));
    expect(mockMessagesRefetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the typed message and shows why when the send fails', async () => {
    mockSend.mockRejectedValue(offline());
    await render(<CoachScreen />);
    await fireEvent.changeText(screen.getByLabelText('Message the coach'), 'How do I get stronger?');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(/Couldn.t reach the coach/)).toBeTruthy();
    expect(screen.getByLabelText('Message the coach').props.value).toBe('How do I get stronger?');
  });

  it('empties the box once the send works', async () => {
    mockSend.mockResolvedValue({ duplicate: false, response: {} });
    await render(<CoachScreen />);
    await fireEvent.changeText(screen.getByLabelText('Message the coach'), 'Hi coach');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    await screen.findByLabelText('Message the coach');
    expect(screen.getByLabelText('Message the coach').props.value).toBe('');
  });

  it('asks before clearing the chat, and says so when clearing fails', async () => {
    mockClear.mockImplementation((_v: unknown, opts: { onError: (e: ApiError) => void }) => opts.onError(offline()));
    await render(<CoachScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Clear chat' }));
    expect(mockClear).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Yes, clear chat' }));
    expect(mockClear).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Couldn.t clear the chat. Check your connection/)).toBeTruthy();
  });
});
