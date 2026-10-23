import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render as rtlRender, screen } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { PRO_OFFER_AFTER_WORKOUTS, resetProWelcomeMemory, trainedRecently } from '@/lib/proWelcome';
import type { BillingCatalog } from '@/lib/types';
import { planLine, ProWelcomeHost } from './ProWelcome';

/** The one-time FORM Pro welcome on Home. */

const mockOpenPaywall = jest.fn();
const mockStore = new Map<string, string>();
const mockSet = jest.fn(async (k: string, v: string) => void mockStore.set(k, v));

const mockCatalog: BillingCatalog = {
  provider: { configured: true, name: 'Development store', environment: 'development' },
  products: [
    { id: 'form_pro_monthly', plan: 'monthly', title: 'Monthly', period: 'P1M', price: { amount: 3.99, currency: 'USD', display: '$3.99' }, trialDays: null, environment: 'development' },
    { id: 'form_pro_annual', plan: 'annual', title: 'Yearly', period: 'P1Y', price: { amount: 28.99, currency: 'USD', display: '$28.99' }, trialDays: null, environment: 'development' },
  ],
  features: [
    { id: 'STREAK_SHIELD', title: 'Streak Shield', pro: '2 streak freezes every month.', free: 'Your streak resets after a missed day.', headline: true },
    { id: 'ADAPTIVE_TRAINING', title: 'Adaptive training', pro: 'Progress when earned.', free: 'Rule-based progression.', headline: true },
    { id: 'FOOD_SCANNER_PREMIUM', title: 'Unlimited AI food scans', pro: 'Scan every meal.', free: '3 AI scans a day.' },
  ],
  manageUrl: null,
  legal: { termsUrl: null, privacyUrl: null },
};

let mockTier: 'free' | 'pro' = 'free';
let mockOnboarded = true;
let mockCelebrations: unknown[] = [];
let mockSession: unknown = null;
let mockCatalogData: BillingCatalog | undefined = mockCatalog;
let mockWorkoutCount = 3;
let mockLatestDate = new Date().toISOString().slice(0, 10);
const mockWorkoutsCall = jest.fn();

jest.mock('expo-router', () => ({ useIsFocused: () => true, router: { push: jest.fn() } }));
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: (k: string, v: string) => mockSet(k, v),
}));
jest.mock('@/lib/pro', () => ({ STATE_LABEL: {}, statusLine: () => null, openPaywall: () => mockOpenPaywall(), useBillingCatalog: () => ({ data: mockCatalogData }),
  // Mirrors lib/pro.purchaseSupport (the real module pulls in the whole navigation stack).
  purchaseSupport: (c?: BillingCatalog) => (c?.provider.configured && c.provider.environment === 'development' ? { available: true } : { available: false, reason: 'coming soon' }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ token: 't', authed: (fn: (t: string) => unknown) => fn('t') }) }));
jest.mock('@/lib/api', () => ({ api: { workouts: () => { mockWorkoutsCall(); return Promise.resolve({ workouts: Array.from({ length: mockWorkoutCount }, (_, i) => ({ id: `w${i}`, localDate: mockLatestDate })) }); } } }));
jest.mock('@/lib/queries', () => ({
  qk: { workouts: ['workouts'] },
  useMe: () => ({ data: { user: { id: 'u1' }, onboarding: { completed: mockOnboarded } } }),
  useEntitlements: () => ({ data: { tier: mockTier } }),
  useCelebrations: () => ({ isError: false, isSuccess: true, data: { celebrations: mockCelebrations } }),
  useActiveSession: () => ({ isSuccess: true, data: mockSession }),
}));

// A fresh query cache per render, so the workout count is read again each time.
const render = (ui: ReactElement) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
};

const flush = () => act(async () => void (await Promise.resolve()));

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  resetProWelcomeMemory();
  mockTier = 'free';
  mockOnboarded = true;
  mockCelebrations = [];
  mockSession = null;
  mockCatalogData = mockCatalog;
  mockWorkoutCount = 3;
});

describe('FORM Pro welcome', () => {
  it('shows once for a free user after onboarding, with the real features and prices', async () => {
    const first = await render(<ProWelcomeHost />);
    expect(await screen.findByText('Welcome to FORM')).toBeTruthy();
    expect(screen.getByText('Adaptive training')).toBeTruthy();
    expect(screen.getByText('Streak Shield')).toBeTruthy();
    expect(screen.queryByText('Weekly progress report')).toBeNull(); // not a headline benefit
    expect(screen.getByText(/And 1 more, plus what Free keeps/)).toBeTruthy();
    expect(screen.getByText('Monthly · $3.99/month')).toBeTruthy();
    expect(screen.getByText('Yearly · $28.99/year')).toBeTruthy();
    expect(mockStore.get('form.proWelcome.u1')).toBe('1');

    // A fresh start of the app (same device, same account): it does not come back.
    await first.unmount();
    resetProWelcomeMemory();
    await render(<ProWelcomeHost />);
    await flush();
    expect(screen.queryByText('Welcome to FORM')).toBeNull();
  });

  it('opens the plans screen from See plans, and does not come back', async () => {
    await render(<ProWelcomeHost />);
    await fireEvent.press(await screen.findByRole('button', { name: 'See plans' }));
    expect(mockOpenPaywall).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Welcome to FORM')).toBeNull();
  });

  it('never shows to a Pro user, and leaves the flag alone', async () => {
    mockTier = 'pro';
    await render(<ProWelcomeHost />);
    await flush();
    expect(screen.queryByText('Welcome to FORM')).toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it.each([
    ['the close icon', () => screen.getByRole('button', { name: 'Close' })],
    ['Not now', () => screen.getByRole('button', { name: 'Not now' })],
    ['a tap outside the card', () => screen.getByTestId('pro-welcome-outside', { includeHiddenElements: true })],
  ])('closes with %s without opening the plans', async (_name, target) => {
    await render(<ProWelcomeHost />);
    await screen.findByText('Welcome to FORM');
    await fireEvent.press(target());
    expect(screen.queryByText('Welcome to FORM')).toBeNull();
    expect(mockOpenPaywall).not.toHaveBeenCalled();
  });

  it('waits while a celebration is pending, a workout is open, onboarding is unfinished or prices are missing', async () => {
    mockCelebrations = [{ id: 1 }];
    const view = await render(<ProWelcomeHost />);
    await flush();
    expect(screen.queryByText('Welcome to FORM')).toBeNull();
    mockCelebrations = [];
    mockSession = { id: 's1' };
    await view.rerender(<ProWelcomeHost />);
    await flush();
    expect(screen.queryByText('Welcome to FORM')).toBeNull();
    mockSession = null;
    mockOnboarded = false;
    await view.rerender(<ProWelcomeHost />);
    await flush();
    expect(screen.queryByText('Welcome to FORM')).toBeNull();
    mockOnboarded = true;
    mockCatalogData = undefined;
    await view.rerender(<ProWelcomeHost />);
    await flush();
    expect(screen.queryByText('Welcome to FORM')).toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
    // Once everything is clear it appears (celebrations first, then the offer).
    mockCatalogData = mockCatalog;
    await view.rerender(<ProWelcomeHost />);
    expect(await screen.findByText('Welcome to FORM')).toBeTruthy();
  });

  it('never shows while Pro cannot be bought (no store connected: coming soon), and leaves the flag alone', async () => {
    mockCatalogData = { ...mockCatalog, provider: { configured: false, name: 'Billing', environment: null }, products: [] };
    await render(<ProWelcomeHost />);
    await flush();
    expect(screen.queryByText('Welcome to FORM')).toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('waits until the user has finished three workouts, and does not even ask before everything else is in order', async () => {
    expect(PRO_OFFER_AFTER_WORKOUTS).toBe(3);
    mockWorkoutCount = 2;
    await render(<ProWelcomeHost />);
    await flush();
    await flush();
    expect(screen.queryByText('Welcome to FORM')).toBeNull();
    expect(mockSet).not.toHaveBeenCalled(); // not marked as seen, so it can still come later
    expect(mockWorkoutsCall).toHaveBeenCalled();

    mockWorkoutsCall.mockClear();
    mockOnboarded = false;
    await render(<ProWelcomeHost />);
    await flush();
    await flush();
    expect(mockWorkoutsCall).not.toHaveBeenCalled(); // only queried when otherwise eligible
    mockOnboarded = true;

    mockWorkoutCount = 3;
    await render(<ProWelcomeHost />);
    expect(await screen.findByText('Welcome to FORM')).toBeTruthy();
  });

  it('stays away from someone just coming back after a break', async () => {
    mockLatestDate = '2020-01-01';
    await render(<ProWelcomeHost />);
    await flush();
    await flush();
    expect(screen.queryByText('Welcome to FORM')).toBeNull();
    expect(mockSet).not.toHaveBeenCalled();
    const now = new Date('2026-10-23T09:00:00');
    expect(trainedRecently('2026-10-17', now)).toBe(true);
    expect(trainedRecently('2026-10-02', now)).toBe(false);
    expect(trainedRecently(undefined, now)).toBe(false);
  });

  it('words each plan from the store price', () => {
    expect(planLine(mockCatalog.products[0]!)).toBe('Monthly · $3.99/month');
  });
});
