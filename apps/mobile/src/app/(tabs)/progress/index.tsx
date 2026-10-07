import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { AdSlot } from '@/components/AdSlot';
import { TrainingCard } from '@/components/progress/TrainingCard';
import { ConsistencyCard, LevelHero, LevelUpBanner, RankLadder, ResetNotice, XpHistory } from '@/components/progress/ProgressionViews';
import { AchievementTile, BodyQuestSummaryCard, RecordsList, sortAchievements, StreaksGrid } from '@/components/recognition/RecognitionViews';
import { AppText, Card, Divider, ErrorState, ListRow, Row, Screen, SectionHeader, Stat, StateView } from '@/components/ui';
import { localDateKey } from '@/lib/dates';
import { useAchievements, useBodyQuest, useProgress, useRecords, useRefetchOnFocus, useStreaks, useWorkouts, useXpEvents } from '@/lib/queries';
import { colors, space } from '@/theme/tokens';

/** Progress: the journey (level and rank), how to keep it, what you've earned (records), and where every XP came from. */
export default function ProgressScreen() {
  const today = localDateKey();
  const progress = useProgress(today);
  const records = useRecords();
  const workouts = useWorkouts();
  const xpEvents = useXpEvents();
  const bodyQuest = useBodyQuest();
  const achievements = useAchievements();
  const streaks = useStreaks();
  const [levelUpDismissed, setLevelUpDismissed] = useState<string | null>(null);
  const refetch = () => Promise.all([progress.refetch(), records.refetch(), workouts.refetch(), xpEvents.refetch(), bodyQuest.refetch(), achievements.refetch(), streaks.refetch()]);
  useRefetchOnFocus(refetch);

  const p = progress.data;
  const bq = bodyQuest.data?.bodyQuest;
  const list = achievements.data?.achievements ?? [];

  return (
    <Screen title="Progress" subtitle="Your journey" refreshing={progress.isRefetching} onRefresh={refetch}>
      {progress.isPending ? <StateView kind="loading" /> : null}
      {progress.isError && !p ? <ErrorState error={progress.error} onRetry={refetch} /> : null}

      {p ? (
        <>
          {p.recentLevelUp && levelUpDismissed !== p.recentLevelUp.at ? <LevelUpBanner progress={p} onDismiss={() => setLevelUpDismissed(p.recentLevelUp?.at ?? null)} /> : null}
          <LevelHero progress={p} />
          <ResetNotice progress={p} today={today} />
          <ConsistencyCard progress={p} />

          <SectionHeader title="Your training" />
          {workouts.data ? <TrainingCard workouts={workouts.data.workouts} today={today} /> : workouts.isError ? <ErrorState error={workouts.error} onRetry={workouts.refetch} compact /> : <StateView kind="loading" compact />}

          {bq ? (
            <BodyQuestSummaryCard stage={bq.stage} highestStage={bq.highestStage} overall={bq.overall} statsWithData={bq.statsWithData} nextStage={bq.next?.stage ?? null} onPress={() => router.push('/progress/body-quest' as Href)} />
          ) : bodyQuest.isError ? (
            <Card>
              <ErrorState error={bodyQuest.error} onRetry={bodyQuest.refetch} compact />
            </Card>
          ) : null}

          <Card style={{ paddingVertical: space.xs }}>
            <ListRow title="Trends" subtitle="Strength, form, consistency, food and more over 7, 30 or 90 days" icon="analytics-outline" iconTint={colors.primary} onPress={() => router.push('/progress/analytics' as Href)} />
            <Divider />
            <ListRow title="Weekly report" subtitle="Your week in numbers, with a coach note — FORM Pro" icon="document-text-outline" iconTint={colors.primary} onPress={() => router.push('/progress/reports' as Href)} />
          </Card>

          <SectionHeader title="Streaks" />
          {streaks.data ? (
            <StreaksGrid streaks={streaks.data.streaks} />
          ) : streaks.isError ? (
            <Card>
              <ErrorState error={streaks.error} onRetry={streaks.refetch} compact />
            </Card>
          ) : (
            <Card>
              <StateView kind="loading" compact />
            </Card>
          )}

          <SectionHeader
            title="Achievements"
            action={
              list.length ? (
                <Pressable accessibilityRole="button" onPress={() => router.push('/progress/achievements' as Href)} hitSlop={12} style={{ minHeight: 32, justifyContent: 'center' }}>
                  <AppText variant="label" color={colors.primary}>
                    {`${list.filter((a) => a.state === 'unlocked').length} of ${list.length} · View all`}
                  </AppText>
                </Pressable>
              ) : undefined
            }
          />
          {achievements.isError && !achievements.data ? (
            <Card>
              <ErrorState error={achievements.error} onRetry={achievements.refetch} compact />
            </Card>
          ) : !achievements.data ? (
            <Card>
              <StateView kind="loading" compact />
            </Card>
          ) : (
            <View style={{ gap: space.sm }}>
              {sortAchievements(list)
                .slice(0, 3)
                .map((a) => (
                  <AchievementTile key={a.id} a={a} />
                ))}
            </View>
          )}

          <SectionHeader title="XP by source" />

          <Row gap={space.sm}>
            <Stat label="Workouts" value={p.xpSources.workouts.toLocaleString()} unit="XP" icon="barbell-outline" />
            <Stat label="Nutrition" value={p.xpSources.nutrition.toLocaleString()} unit="XP" icon="leaf-outline" />
            <Stat label="Quests" value={p.xpSources.quests.toLocaleString()} unit="XP" icon="flag-outline" />
          </Row>
          <AppText variant="caption" color={colors.textFaint} style={{ marginTop: -space.sm }}>
            {[
              p.lastReset ? 'Since your last fresh start.' : null,
              p.xpSources.decay < 0 ? `Missed training days: ${p.xpSources.decay} XP.` : null,
              !p.nutritionXpEnabled ? 'Nutrition XP starts once your body profile is set, so FORM can check your intake is safe.' : 'Nutrition XP is confirmed at the end of each day.',
            ]
              .filter(Boolean)
              .join(' ')}
          </AppText>

          <SectionHeader title="Personal records" />
          {records.isError && !records.data ? (
            <Card>
              <ErrorState error={records.error} onRetry={records.refetch} compact />
            </Card>
          ) : !records.data || records.data.records.length === 0 ? (
            <Card>
              {records.isPending ? (
                <StateView kind="loading" compact />
              ) : (
                <StateView kind="empty" compact title="No records yet" message="Records come from reps the camera verified, so every one is earned." />
              )}
            </Card>
          ) : (
            <RecordsList records={records.data.records} />
          )}

          <SectionHeader title="Recent workouts" />
          {workouts.isError && !workouts.data ? (
            <Card>
              <ErrorState error={workouts.error} onRetry={workouts.refetch} compact />
            </Card>
          ) : !workouts.data || workouts.data.workouts.length === 0 ? (
            <Card>
              {workouts.isPending ? <StateView kind="loading" compact /> : <StateView kind="empty" compact title="No workouts yet" message="Your finished workouts will show up here." />}
            </Card>
          ) : (
            <Card style={{ paddingVertical: space.xs }}>
              {workouts.data.workouts.map((w, i) => (
                <View key={w.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListRow
                    title={new Date(`${w.localDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                    subtitle={`${w.durationMinutes} min${w.painLevel === 'serious' ? ' · pain reported' : ''}`}
                    right={
                      <AppText variant="bodyStrong" color={w.xp > 0 ? colors.primary : colors.textFaint}>
                        +{w.xp} XP
                      </AppText>
                    }
                  />
                </View>
              ))}
            </Card>
          )}

          <SectionHeader title="XP history" />
          {xpEvents.isError && !xpEvents.data ? (
            <Card>
              <ErrorState error={xpEvents.error} onRetry={xpEvents.refetch} compact />
            </Card>
          ) : xpEvents.isPending ? (
            <Card>
              <StateView kind="loading" compact />
            </Card>
          ) : (
            <XpHistory events={xpEvents.data?.events ?? []} />
          )}

          <SectionHeader title="Ranks" />
          <RankLadder progress={p} />

          <AdSlot placement="progress_footer" />
        </>
      ) : null}
    </Screen>
  );
}
