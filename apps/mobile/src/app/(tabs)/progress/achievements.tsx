import { AchievementList } from '@/components/recognition/RecognitionViews';
import { AppText, ErrorState, Screen, StateView } from '@/components/ui';
import { useAchievements, useRefetchOnFocus } from '@/lib/queries';
import { colors } from '@/theme/tokens';

export default function AchievementsScreen() {
  const q = useAchievements();
  useRefetchOnFocus(q.refetch);
  const list = q.data?.achievements ?? [];
  const unlocked = list.filter((a) => a.state === 'unlocked').length;
  return (
    <Screen title="Achievements" subtitle={q.data ? `${unlocked} of ${list.length} unlocked` : undefined} refreshing={q.isRefetching} onRefresh={q.refetch}>
      {q.isPending ? <StateView kind="loading" /> : null}
      {q.isError && !q.data ? <ErrorState error={q.error} onRetry={q.refetch} /> : null}
      {q.data ? (
        <>
          <AchievementList achievements={list} />
          <AppText variant="caption" color={colors.textFaint}>
            Achievements come only from what you actually do — sessions with serious pain never count, and unlocks are yours for good.
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}
