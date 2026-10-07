import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useState } from 'react';
import { PaywallView } from '@/components/pro/ProViews';
import { ErrorState, IconButton, Screen, StateView } from '@/components/ui';
import { ApiError } from '@/lib/api';
import { purchaseSupport, useBillingCatalog, useDevSimulate, usePurchase, useRestore } from '@/lib/pro';
import { useEntitlements } from '@/lib/queries';
import type { PremiumFeatureId } from '@/lib/types';

/** The paywall: FORM Pro's value, the store's plans and prices, purchase, restore and the subscription's state. */
export default function ProScreen() {
  const params = useLocalSearchParams<{ feature?: string }>();
  const catalog = useBillingCatalog();
  const entitlements = useEntitlements();
  const purchase = usePurchase();
  const restore = useRestore();
  const simulate = useDevSimulate();
  const [plan, setPlan] = useState<'monthly' | 'annual'>('annual');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const close = <IconButton icon="close" label="Close" onPress={() => (router.canGoBack() ? router.back() : router.replace('/' as Href))} />;
  const describe = (e: ApiError) => (e.kind === 'network' ? "Couldn't reach the store. Nothing was charged — try again." : e.message);

  if ((catalog.isError && !catalog.data) || (entitlements.isError && !entitlements.data)) {
    return (
      <Screen title="FORM Pro" right={close}>
        <ErrorState error={(catalog.error ?? entitlements.error)!} onRetry={() => Promise.all([catalog.refetch(), entitlements.refetch()])} />
      </Screen>
    );
  }
  if (!catalog.data || !entitlements.data) {
    return (
      <Screen title="FORM Pro" right={close}>
        <StateView kind="loading" />
      </Screen>
    );
  }
  const busy = purchase.isPending ? 'purchase' : restore.isPending ? 'restore' : null;

  return (
    <Screen title="FORM Pro" right={close}>
      <PaywallView
        catalog={catalog.data}
        entitlements={entitlements.data}
        feature={(params.feature as PremiumFeatureId | undefined) ?? null}
        plan={plan}
        onPlan={setPlan}
        support={purchaseSupport(catalog.data)}
        busy={busy}
        error={error}
        notice={notice}
        onPurchase={(productId) => {
          setError(null);
          setNotice(null);
          purchase.mutate(productId, { onSuccess: (e) => setNotice(e.tier === 'pro' ? "You're on FORM Pro. Thanks for supporting FORM." : null), onError: (e) => setError(describe(e)) });
        }}
        onRestore={() => {
          setError(null);
          setNotice(null);
          restore.mutate(undefined, {
            onSuccess: (r) =>
              r.restored > 0 ? setNotice('Purchases restored.') : r.linkedElsewhere > 0 ? setError('That subscription belongs to another FORM account. Sign in to that account to use it.') : setNotice('No purchases found for this store account.'),
            onError: (e) => setError(describe(e)),
          });
        }}
        onSimulate={(event) => simulate.mutate(event, { onError: (e) => setError(describe(e)) })}
      />
    </Screen>
  );
}
