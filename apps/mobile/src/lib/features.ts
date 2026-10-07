import { useFeatures } from './queries';
import type { FeatureKey } from './types';

/**
 * Whether a product feature is live, from the server's feature map (engine built and any
 * required provider configured). Unknown while loading; never optimistically "available".
 */
export function useFeature(key: FeatureKey) {
  const q = useFeatures();
  const f = q.data?.features[key];
  return {
    loading: q.isPending,
    available: f?.available === true,
    reason: f && !f.available ? f.reason : null,
  };
}
