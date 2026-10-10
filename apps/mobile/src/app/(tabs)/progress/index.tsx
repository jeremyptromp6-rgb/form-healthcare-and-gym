import { router, type Href } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { AdSlot } from '@/components/AdSlot';
import { TrainingCard } from '@/components/progress/TrainingCard';
import { ConsistencyCard, LevelHero, LevelUpBanner, RankLadder, ResetNotice, XpHistory } from '@/components/progress/ProgressionViews';
import { AchievementTile, BodyQuestSummaryCard, RecordsList, sortAchievements, StreaksGrid } from '@/components/recognition/RecognitionViews';
import { AppText, Card, ErrorState, ExerciseList, ListRow, Screen, SectionAction, SectionHeader, StatStrip, StateView } from '@/components/ui';
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
  // Each block is a header plus its body, grouped so Screen spaces the blocks and the group spaces its own parts.
  const section = { gap: space.md } as const;

  return (
    <Screen title="Progress" subtitle="Your journey" refreshing={progress.isRefetching} onRefresh={refetch}>
      {progress.isPending ? <StateView kind="loading" compact /> : null}
      {progress.isError && !p ? <ErrorState error={progress.error} onRetry={refetch} compact /> : null}

      {/* Screen does not look inside fragments, so each block is its own keyed child of one array. */}
      {p
        ? [
            <View key="level" style={section}>
              {p.recentLevelUp && levelUpDismissed !== p.recentLevelUp.at ? <LevelUpBanner progress={p} onDismiss={() => setLevelUpDismissed(p.recentLevelUp?.at ?? null)} /> : null}
              <LevelHero progress={p} />
              <ResetNotice progress={p} today={today} />
              <ConsistencyCard progress={p} />
            </View>,

            <View key="training" style={section}>
              <SectionHeader title="Your training" />
              {workouts.data ? <TrainingCard workouts={workouts.data.workouts} today={today} /> : workouts.isError ? <ErrorState error={workouts.error} onRetry={workouts.refetch} compact /> : <StateView kind="loading" compact />}
              <ExerciseList>
                <ListRow title="Trends" subtitle="Strength, form, consistency, food and more over 7, 30 or 90 days" icon="analytics-outline" iconTint={colors.primary} onPress={() => router.push('/progress/analytics' as Href)} />
                <ListRow title="Weekly report" subtitle="Your week in numbers, with a coach note — FORM Pro" icon="document-text-outline" iconTint={colors.primary} onPress={() => router.push('/progress/reports' as Href)} />
              </ExerciseList>
            </View>,

            bq ? (
              <BodyQuestSummaryCard key="bodyquest" stage={bq.stage} highestStage={bq.highestStage} overall={bq.overall} statsWithData={bq.statsWithData} nextStage={bq.next?.stage ?? null} onPress={() => router.push('/progress/body-quest' as Href)} />
            ) : bodyQuest.isError ? (
              <ErrorState key="bodyquest" error={bodyQuest.error} onRetry={bodyQuest.refetch} compact />
            ) : null,

            <View key="streaks" style={section}>
              <SectionHeader title="Streaks" />
              {streaks.data ? <StreaksGrid streaks={streaks.data.streaks} /> : streaks.isError ? <ErrorState error={streaks.error} onRetry={streaks.refetch} compact /> : <StateView kind="loading" compact />}
            </View>,

            <View key="achievements" style={section}>
              <SectionHeader
                title="Achievements"
                action={list.length ? <SectionAction label={`${list.filter((a) => a.state === 'unlocked').length} of ${list.length} · View all`} onPress={() => router.push('/progress/achievements' as Href)} /> : undefined}
              />
              {achievements.isError && !achievements.data ? (
                <ErrorState error={achievements.error} onRetry={achievements.refetch} compact />
              ) : !achievements.data ? (
                <StateView kind="loading" compact />
              ) : (
                <ExerciseList>
                  {sortAchievements(list)
                    .slice(0, 3)
                    .map((a) => (
                      <AchievementTile key={a.id} a={a} />
                    ))}
                </ExerciseList>
              )}
            </View>,

            <View key="xp" style={section}>
              <SectionHeader title="XP by source" />
              <Card style={{ gap: space.md }}>
                <StatStrip
                  variant="flat"
                  items={[
                    { label: 'Workouts', value: p.xpSources.workouts.toLocaleString(), unit: 'XP' },
                    { label: 'Nutrition', value: p.xpSources.nutrition.toLocaleString(), unit: 'XP' },
                    { label: 'Quests', value: p.xpSources.quests.toLocaleString(), unit: 'XP' },
                  ]}
                />
                <AppText variant="caption" color={colors.textFaint}>
                  {[
                    p.lastReset ? 'Since your last fresh start.' : null,
                    p.xpSources.decay < 0 ? `Missed training days: ${p.xpSources.decay} XP.` : null,
                    !p.nutritionXpEnabled ? 'Nutrition XP starts once your body profile is set, so FORM can check your intake is safe.' : 'Nutrition XP is confirmed at the end of each day.',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                </AppText>
              </Card>
            </View>,

            <View key="records" style={section}>
              <SectionHeader title="Personal records" />
              {records.isError && !records.data ? (
                <ErrorState error={records.error} onRetry={records.refetch} compact />
              ) : !records.data || records.data.records.length === 0 ? (
                records.isPending ? (
                  <StateView kind="loading" compact />
                ) : (
                  <StateView kind="empty" compact title="No records yet" message="Records come from reps the camera verified, so every one is earned." />
                )
              ) : (
                <RecordsList records={records.data.records} />
              )}
            </View>,

            <View key="recent" style={section}>
              <SectionHeader title="Recent workouts" />
              {workouts.isError && !workouts.data ? (
                <ErrorState error={workouts.error} onRetry={workouts.refetch} compact />
              ) : !workouts.data || workouts.data.workouts.length === 0 ? (
                workouts.isPending ? (
                  <StateView kind="loading" compact />
                ) : (
                  <StateView kind="empty" compact title="No workouts yet" message="Your finished workouts will show up here." />
                )
              ) : (
                <ExerciseList>
                  {workouts.data.workouts.map((w) => (
                    <ListRow
                      key={w.id}
                      title={new Date(`${w.localDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                      subtitle={`${w.durationMinutes} min${w.painLevel === 'serious' ? ' · pain reported' : ''}`}
                      right={
                        <AppText variant="bodyStrong" color={w.xp > 0 ? colors.primary : colors.textFaint} style={{ fontVariant: ['tabular-nums'] }}>
                          +{w.xp} XP
                        </AppText>
                      }
                    />
                  ))}
                </ExerciseList>
              )}
            </View>,

            <View key="history" style={section}>
              <SectionHeader title="XP history" />
              {xpEvents.isError && !xpEvents.data ? <ErrorState error={xpEvents.error} onRetry={xpEvents.refetch} compact /> : xpEvents.isPending ? <StateView kind="loading" compact /> : <XpHistory events={xpEvents.data?.events ?? []} />}
            </View>,

            <View key="ranks" style={section}>
              <SectionHeader title="Ranks" />
              <RankLadder progress={p} />
            </View>,

            <AdSlot key="ad" placement="progress_footer" />,
          ]
        : null}
    </Screen>
  );
}
