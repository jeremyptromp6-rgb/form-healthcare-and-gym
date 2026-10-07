import type { ReactNode } from 'react';
import type { PremiumFeatureId } from '@/lib/types';
import { ProUpsellFor } from './ProUpsellFor';

/**
 * Shows a Pro feature, or its upsell when the server said it's locked. `locked` always comes from
 * the server's answer (a locked section, a 402) — never from a client-side guess.
 */
export function ProFeatureGate({ feature, locked, children }: { feature: PremiumFeatureId; locked: boolean; children: ReactNode }) {
  return locked ? <ProUpsellFor feature={feature} /> : <>{children}</>;
}
