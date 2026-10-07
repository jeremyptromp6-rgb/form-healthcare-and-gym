import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, type Href } from 'expo-router';
import { Linking, Platform } from 'react-native';
import { api, ApiError } from './api';
import { useAuth } from './auth';
import { qk, useEntitlements } from './queries';
import { storeAccountId } from './storeAccount';
import type { BillingCatalog, Entitlements, PremiumFeatureId, SubscriptionState, WeeklyReportEntry } from './types';

/**
 * FORM Pro on the client — one module, so premium checks aren't scattered through screens.
 *
 * The server decides access (EntitlementService) and refuses Pro work with 402 `pro_required`;
 * this module only reads that decision to choose what to show. Changing anything here can't unlock
 * Pro: every Pro request is checked again on the server.
 */

export const platform: 'ios' | 'android' | 'web' = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'web';

export function hasFeature(e: Pick<Entitlements, 'features'> | undefined, feature: PremiumFeatureId): boolean {
  return !!e?.features.includes(feature);
}

/** Whether the user has a feature (false while loading — the server is asked either way). */
export function useProAccess(feature: PremiumFeatureId) {
  const e = useEntitlements();
  return { has: hasFeature(e.data, feature), loading: e.isPending, entitlements: e.data };
}

/** The premium feature a failed request needs, if it failed for that reason. */
export function proFeatureOf(error: unknown): PremiumFeatureId | null {
  if (!(error instanceof ApiError) || error.kind !== 'pro_required') return null;
  return ((error.details as { feature?: PremiumFeatureId } | undefined)?.feature ?? null) as PremiumFeatureId | null;
}

export function openPaywall(feature?: PremiumFeatureId | null) {
  router.push((feature ? `/pro?feature=${feature}` : '/pro') as Href);
}

export const STATE_LABEL: Record<SubscriptionState, string> = {
  FREE: 'Free plan',
  PRO_TRIAL: 'Pro · free trial',
  PRO_ACTIVE: 'Pro',
  PRO_CANCELLED: 'Pro · cancelled',
  PRO_GRACE_PERIOD: 'Pro · payment problem',
  PRO_BILLING_ISSUE: 'Payment problem',
  PRO_EXPIRED: 'Free plan',
};

/** One sentence on where the subscription stands — dates from the server, never guessed. */
export function statusLine(e: Entitlements): string | null {
  const until = e.accessUntil ? new Date(e.accessUntil).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  switch (e.state) {
    case 'PRO_TRIAL':
      return until ? `Free trial until ${until}${e.willRenew ? ', then your plan starts' : ''}.` : null;
    case 'PRO_ACTIVE':
      return until ? `Renews on ${until}.` : null;
    case 'PRO_CANCELLED':
      return until ? `Cancelled — you keep Pro until ${until}. Nothing more will be charged.` : null;
    case 'PRO_GRACE_PERIOD':
      return `Your last payment didn't go through. Pro stays on${until ? ` until ${until}` : ''} while you update your payment details in the store.`;
    case 'PRO_BILLING_ISSUE':
      return "Pro is paused because a payment didn't go through. Update your payment details in the store to continue.";
    case 'PRO_EXPIRED':
      return 'Your Pro subscription has ended. Everything you logged is still here.';
    default:
      return null;
  }
}

export function useBillingCatalog() {
  const { authed, token } = useAuth();
  return useQuery<BillingCatalog, ApiError>({ queryKey: ['billing', 'products', platform], queryFn: () => authed((t) => api.billingProducts(t, platform)), enabled: !!token, staleTime: 5 * 60_000 });
}

/**
 * The store this build can buy from. The development store is fully wired (sandbox: no money moves);
 * a real App Store / Google Play client isn't part of this build, so it reports itself unavailable
 * rather than pretending.
 */
export function purchaseSupport(catalog: BillingCatalog | undefined): { available: true; environment: 'development' } | { available: false; reason: string } {
  if (!catalog?.provider.configured) return { available: false, reason: "FORM Pro can't be purchased in this build yet. Nothing will be charged." };
  if (catalog.provider.environment === 'development') return { available: true, environment: 'development' };
  return { available: false, reason: "In-app purchases aren't connected in this build yet. Nothing will be charged." };
}

function useAfterBillingChange() {
  const qc = useQueryClient();
  return (e: Entitlements) => {
    qc.setQueryData(qk.entitlements, e);
    // Pro changes what many screens may show: refresh everything.
    qc.invalidateQueries();
  };
}

export function usePurchase() {
  const { authed } = useAuth();
  const done = useAfterBillingChange();
  return useMutation<Entitlements, ApiError, string>({
    mutationFn: (productId) =>
      authed(async (t) => {
        const { receipt } = await api.devCheckout(t, { productId, storeAccount: await storeAccountId() });
        return api.verifyPurchase(t, { platform, productId, receipt });
      }),
    onSuccess: done,
  });
}

export function useRestore() {
  const { authed } = useAuth();
  const done = useAfterBillingChange();
  return useMutation<{ restored: number; linkedElsewhere: number; entitlements: Entitlements }, ApiError, void>({
    mutationFn: () =>
      authed(async (t) => {
        const { receipts } = await api.devReceipts(t, await storeAccountId());
        return api.restorePurchases(t, { platform, receipts });
      }),
    onSuccess: (r) => done(r.entitlements),
  });
}

/** Development store only: what time, the user or the bank would do to the subscription. */
export function useDevSimulate() {
  const { authed } = useAuth();
  const done = useAfterBillingChange();
  return useMutation<{ entitlements: Entitlements }, ApiError, string>({ mutationFn: (event) => authed((t) => api.devSimulate(t, event)), onSuccess: (r) => done(r.entitlements) });
}

export function openManage(url: string | null) {
  if (url) Linking.openURL(url).catch(() => undefined);
}

// ---- Pro feature data ----------------------------------------------------------------------------

export function useWeeklyReports() {
  const { authed, token } = useAuth();
  return useQuery<{ canGenerate: boolean; reports: WeeklyReportEntry[] }, ApiError>({ queryKey: ['reports', 'weekly'], queryFn: () => authed(api.weeklyReports), enabled: !!token, staleTime: 10 * 60_000 });
}

export function useFormIntelligence(exerciseId: string, range: 30 | 90, enabled: boolean) {
  const { authed, token } = useAuth();
  return useQuery<Awaited<ReturnType<typeof api.formIntelligence>>, ApiError>({ queryKey: ['form-intelligence', exerciseId, range], queryFn: () => authed((t) => api.formIntelligence(t, exerciseId, range)), enabled: !!token && enabled, retry: false });
}

export function useRestOfToday(enabled: boolean) {
  const { authed, token } = useAuth();
  return useQuery<Awaited<ReturnType<typeof api.restOfToday>>, ApiError>({ queryKey: ['meal-plans', 'rest-of-today'], queryFn: () => authed(api.restOfToday), enabled: !!token && enabled, retry: false, staleTime: 60_000 });
}
