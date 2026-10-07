import { View } from 'react-native';
import { useAdDecision } from '@/lib/queries';
import { colors, radius, space } from '@/theme/tokens';
import { AppText, Badge } from './ui';

/**
 * Free-tier ad placement. The server's AdService decides; the app only renders a served
 * ad. When nothing was served (Pro user, provider unconfigured, error), the slot collapses —
 * no placeholder pretends to be an ad. A dev-only note explains why.
 */
export function AdSlot({ placement }: { placement: 'home_feed' | 'progress_footer' | 'recipe_list' }) {
  const ad = useAdDecision(placement);
  if (!ad.data) return null;
  if (!ad.data.served) {
    if (!__DEV__ || ad.data.reason === 'pro_user') return null;
    return (
      <AppText variant="caption" color={colors.textFaint} style={{ textAlign: 'center' }}>
        Dev: ad slot empty ({ad.data.reason.replace(/_/g, ' ')})
      </AppText>
    );
  }
  // A real ad network SDK renders its creative here once one is integrated.
  return (
    <View style={{ borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: space.lg, gap: space.sm }}>
      <Badge label="Sponsored" />
      <AppText variant="caption" color={colors.textMuted}>
        {ad.data.creative.network} · {ad.data.creative.adId}
      </AppText>
    </View>
  );
}
