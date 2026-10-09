import { useFeatures } from './queries';
import type { FeatureKey } from './types';

/**
 * Whether a product feature is live, from the server's feature map (engine built and any
 * required provider configured). Unknown while loading; never optimistically "available".
 * `unknown` means the server couldn't be asked (offline, or a sleeping server still waking) —
 * that's "try again", not "not available". `recheck` asks the server again and resolves to the
 * fresh answer, so a feature switched on server-side shows up without waiting for the cache.
 */
export function useFeature(key: FeatureKey) {
  const q = useFeatures();
  const f = q.data?.features[key];
  return {
    loading: q.isPending,
    available: f?.available === true,
    reason: f && !f.available ? f.reason : null,
    unknown: !q.data && q.isError,
    checking: q.isFetching,
    recheck: async () => (await q.refetch()).data?.features[key]?.available === true,
  };
}
