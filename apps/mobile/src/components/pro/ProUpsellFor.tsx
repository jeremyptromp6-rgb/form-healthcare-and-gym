import { openPaywall, useBillingCatalog } from '@/lib/pro';
import type { PremiumFeatureId } from '@/lib/types';
import { ProUpsell } from './ProViews';

/** A ProUpsell with the feature's wording from the server's registry (one source for every screen). */
export function ProUpsellFor({ feature, compact }: { feature: PremiumFeatureId; compact?: boolean }) {
  const catalog = useBillingCatalog();
  const f = catalog.data?.features.find((x) => x.id === feature);
  if (!f) return null;
  return <ProUpsell feature={f.id} title={f.title} pro={f.pro} free={f.free} onOpen={openPaywall} compact={compact} />;
}
