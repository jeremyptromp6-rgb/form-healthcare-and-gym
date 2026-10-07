import { fireEvent, render, screen } from '@testing-library/react-native';
import { ApiError } from '@/lib/api';
import { hasFeature, proFeatureOf, purchaseSupport, statusLine } from '@/lib/pro';
import { scanErrorMessage } from '@/lib/scan';
import type { BillingCatalog, Entitlements, WeeklyReportEntry } from '@/lib/types';
import { FormIntelligenceView, RestOfTodayView, WeeklyReportView } from './ProFeatureViews';
import { annualSavingsPercent, PaywallView, type PaywallViewProps } from './ProViews';

const free: Entitlements = {
  tier: 'free',
  state: 'FREE',
  features: [],
  productId: null,
  accessUntil: null,
  willRenew: false,
  environment: null,
  source: null,
  limits: { foodScansPerDay: 3, coachChatPerDay: 5, aiCallsPerDay: 3, mealPlanDays: 1, analyticsRangeDays: 30 },
  usage: { foodScansToday: 0, coachChatsToday: 0 },
};
const pro = (over: Partial<Entitlements> = {}): Entitlements => ({
  ...free,
  tier: 'pro',
  state: 'PRO_ACTIVE',
  features: ['ADVANCED_PROGRESS', 'WEEKLY_AI_REPORT'],
  productId: 'form_pro_annual',
  accessUntil: '2027-10-05T12:00:00.000Z',
  willRenew: true,
  environment: 'production',
  source: 'store',
  limits: null,
  ...over,
});
const catalog = (over: Partial<BillingCatalog> = {}): BillingCatalog => ({
  provider: { configured: true, name: 'Development store', environment: 'development' },
  products: [
    { id: 'form_pro_monthly', plan: 'monthly', title: 'Monthly', period: 'P1M', price: { amount: 9.99, currency: 'USD', display: '$9.99' }, trialDays: null, environment: 'development' },
    { id: 'form_pro_annual', plan: 'annual', title: 'Yearly', period: 'P1Y', price: { amount: 59.99, currency: 'USD', display: '$59.99' }, trialDays: null, environment: 'development' },
  ],
  features: [
    { id: 'ADAPTIVE_TRAINING', title: 'Adaptive training', pro: 'Progress when earned.', free: 'Rule-based progression.' },
    { id: 'WEEKLY_AI_REPORT', title: 'Weekly progress report', pro: 'A report every week.', free: 'Reports you have stay yours.' },
  ],
  manageUrl: null,
  legal: { termsUrl: null, privacyUrl: null },
  ...over,
});

async function renderPaywall(over: Partial<PaywallViewProps> = {}) {
  const props: PaywallViewProps = {
    catalog: catalog(),
    entitlements: free,
    feature: null,
    plan: 'annual',
    onPlan: jest.fn(),
    support: { available: true, environment: 'development' },
    onPurchase: jest.fn(),
    onRestore: jest.fn(),
    busy: null,
    error: null,
    notice: null,
    ...over,
  };
  await render(<PaywallView {...props} />);
  return props;
}

describe('paywall', () => {
  it("shows the value, both plans with the provider's prices, and a savings figure computed from them", async () => {
    const p = await renderPaywall({ feature: 'WEEKLY_AI_REPORT' });
    expect(screen.getByText('Training that adapts to you.')).toBeTruthy();
    expect(screen.getByText('Yearly · $59.99/year')).toBeTruthy();
    expect(screen.getByText('Monthly · $9.99/month')).toBeTruthy();
    expect(screen.getByText('Save 50% vs monthly')).toBeTruthy();
    expect(screen.getByText('Free: Rule-based progression.')).toBeTruthy(); // what Free keeps is always shown
    await fireEvent.press(screen.getByRole('button', { name: 'Subscribe · $59.99/year' }));
    expect(p.onPurchase).toHaveBeenCalledWith('form_pro_annual');
    await fireEvent.press(screen.getByRole('button', { name: 'Restore purchases' }));
    expect(p.onRestore).toHaveBeenCalled();
    expect(screen.getByText(/Development store — sandbox purchases/)).toBeTruthy();
    expect(screen.getByText(/you keep Pro until the end of the period you paid for/)).toBeTruthy();
  });

  it('offers a trial only when the store has one', async () => {
    const withTrial = catalog();
    withTrial.products = withTrial.products.map((x) => ({ ...x, trialDays: 7 }));
    await renderPaywall({ catalog: withTrial });
    expect(screen.getByRole('button', { name: 'Start 7-day free trial' })).toBeTruthy();
    expect(screen.getByText(/After the free trial, \$59\.99\/year/)).toBeTruthy();
  });

  it("never pretends a purchase is possible when it isn't", async () => {
    const none = catalog({ provider: { configured: false, name: 'Billing', environment: null }, products: [] });
    const support = purchaseSupport(none);
    expect(support.available).toBe(false);
    await renderPaywall({ catalog: none, support });
    expect(screen.queryByRole('button', { name: /Subscribe/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Restore purchases' })).toBeNull();
    expect(screen.getByText(/can't be purchased in this build yet\. Nothing will be charged/)).toBeTruthy();
    // A real store provider without a store client in this build is unavailable too — honestly.
    expect(purchaseSupport(catalog({ provider: { configured: true, name: 'App Store', environment: 'production' } }))).toEqual({ available: false, reason: expect.stringContaining("aren't connected in this build") });
  });

  it('shows a subscriber where they stand, and legal links only when configured', async () => {
    await renderPaywall({
      entitlements: pro({ state: 'PRO_CANCELLED', willRenew: false }),
      catalog: catalog({ manageUrl: 'https://apps.apple.com/account/subscriptions', legal: { termsUrl: 'https://example.com/t', privacyUrl: null } }),
    });
    expect(screen.getByText('Pro · cancelled')).toBeTruthy();
    expect(screen.getByText(/Cancelled — you keep Pro until/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage subscription' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Subscribe/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Terms' })).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Privacy policy' })).toBeNull();
  });

  it('describes every subscription state honestly', () => {
    expect(statusLine(pro({ state: 'PRO_GRACE_PERIOD' }))).toMatch(/payment didn't go through\. Pro stays on until/);
    expect(statusLine({ ...free, state: 'PRO_BILLING_ISSUE' })).toMatch(/paused because a payment didn't go through/);
    expect(statusLine({ ...free, state: 'PRO_EXPIRED' })).toMatch(/Everything you logged is still here/);
    expect(statusLine(free)).toBeNull();
    expect(annualSavingsPercent([])).toBeNull();
  });
});

describe('entitlement helpers', () => {
  it("read the server's decision and its 402s, nothing else", () => {
    expect(hasFeature(pro(), 'WEEKLY_AI_REPORT')).toBe(true);
    expect(hasFeature(free, 'WEEKLY_AI_REPORT')).toBe(false);
    expect(proFeatureOf(new ApiError('pro_required', 'pro_required', 'x', 402, false, { feature: 'FOOD_SCANNER_PREMIUM' }))).toBe('FOOD_SCANNER_PREMIUM');
    expect(proFeatureOf(new ApiError('forbidden', 'coach_disabled', 'x', 403, false))).toBeNull();
    expect(scanErrorMessage({ kind: 'pro_required', code: 'pro_required', message: "You've used today's 3 free meal scans." })).toEqual({ message: "You've used today's 3 free meal scans.", retry: false, pro: true });
  });
});

describe('Pro feature views', () => {
  it('weekly report: highlights and focus — or an honest quiet week', async () => {
    const entry: WeeklyReportEntry = {
      weekStart: '2026-09-28',
      generatedAt: '2026-10-05T09:00:00Z',
      report: {
        weekStart: '2026-09-28',
        weekEnd: '2026-10-04',
        training: { workouts: 3, trainingDays: 3, plannedDays: 3, minutes: 120, verifiedReps: 80, averageFormScore: 86, averageRomPercent: 94, change: { workouts: 1, verifiedReps: 30, formScore: 6 } },
        recordsBeaten: [],
        nutrition: { daysLogged: 6, hasTargets: true, proteinDaysMet: 5, daysOnTarget: 4, daysBelowSafeMinimum: 0 },
        xp: { earned: 340, levelAtEnd: 6, rankAtEnd: 'Starter' },
        bodyQuest: null,
        highlights: ['3 workouts on 3 days (plan: 3), 120 minutes in total.'],
        focus: 'Keep going: the plan is working.',
        empty: false,
      },
      coach: null,
    };
    const { rerender } = await render(<WeeklyReportView entry={entry} />);
    expect(screen.getByText('3 workouts on 3 days (plan: 3), 120 minutes in total.')).toBeTruthy();
    expect(screen.getByText('Keep going: the plan is working.')).toBeTruthy();
    expect(screen.getByText('+1 vs last week')).toBeTruthy();
    await rerender(<WeeklyReportView entry={{ ...entry, report: { ...entry.report, empty: true, highlights: [], focus: 'Get one session in.' } }} />);
    expect(screen.getByText(/A quiet week — nothing logged/)).toBeTruthy();
  });

  it('form history says when nothing is measured yet; rest-of-today says when the day is done', async () => {
    const empty = { sessions: [], formTrend: {} as never, romTrend: {} as never, issues: [], byLoad: [], insights: [], reps: 0 };
    const { rerender } = await render(<FormIntelligenceView data={empty} units="metric" />);
    expect(screen.getByText(/No camera-verified reps of this exercise/)).toBeTruthy();
    await rerender(
      <RestOfTodayView
        suggestion={{ date: '2026-10-05', eaten: { kcal: 2400, proteinG: 150, carbsG: 250, fatG: 80 }, remaining: { kcal: 40, proteinG: 0, carbsG: 0, fatG: 0 }, meals: [], warnings: [], done: true }}
        onOpenRecipe={jest.fn()}
      />,
    );
    expect(screen.getByText(/nothing more to plan today/)).toBeTruthy();
  });
});
