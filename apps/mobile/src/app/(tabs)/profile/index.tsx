import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { Pressable, View } from 'react-native';
import { Avatar } from '@/components/profile/Avatar';
import { ProfileSummary } from '@/components/profile/ProfileSummary';
import { GOAL_ICONS } from '@/components/profile/sections';
import { BodyQuestSummaryCard, RecordsList } from '@/components/recognition/RecognitionViews';
import { RankEmblem, rankColor } from '@/components/art/RankEmblem';
import { AppText, Badge, Button, Card, GradientCard, ErrorState, InlineMessage, ProgressBar, Row, Screen, SectionHeader, StatStrip, StateView } from '@/components/ui';
import { localDateKey } from '@/lib/dates';
import { useFeature } from '@/lib/features';
import { labelOf } from '@/lib/profileForm';
import { useAchievements, useBodyQuest, useCatalog, useMe, useProfileSummary, useProgress, useRecords, useRefetchOnFocus, useWeightHistory, useWorkouts } from '@/lib/queries';
import { ActivitySummary } from '@/components/profile/ActivitySummary';
import type { OnboardingStep } from '@/lib/types';
import { formatWeight } from '@/lib/units';
import { colors, gradients, space } from '@/theme/tokens';

export default function ProfileHub() {
  const me = useMe();
  const catalog = useCatalog();
  const progress = useProgress(localDateKey());
  const records = useRecords();
  const workouts = useWorkouts();
  const weight = useWeightHistory();
  const bodyQuest = useBodyQuest();
  const achievements = useAchievements();
  const summary = useProfileSummary();
  const refetch = () => Promise.all([me.refetch(), progress.refetch(), records.refetch(), workouts.refetch(), weight.refetch(), bodyQuest.refetch(), achievements.refetch(), summary.refetch()]);
  useRefetchOnFocus(refetch);

  if (me.isError && !me.data) return <Screen title="Profile"><ErrorState error={me.error} onRetry={refetch} /></Screen>;
  if (!me.data || !catalog.data) return <Screen title="Profile"><StateView kind="loading" /></Screen>;

  const m = me.data;
  const p = progress.data;
  const name = m.profile?.displayName ?? m.user.email.split('@')[0]!;
  const goal = m.profile?.primaryGoal;
  const missing = m.onboarding.remaining;
  const edit = (s: OnboardingStep) => router.push(`/profile/edit/${s}` as Href);
  const latestWeight = weight.data?.entries[0];

  return (
    <Screen title="Profile" subtitle={m.user.email} refreshing={me.isRefetching} onRefresh={refetch} right={<SettingsButton />}>
      <GradientCard colorsOverride={gradients.heroMedia} style={{ gap: space.lg }}>
        <Row gap={space.lg}>
          <Avatar name={name} hasPhoto={m.hasPhoto} />
          <View style={{ flex: 1, gap: 6 }}>
            <AppText variant="title" header style={{ fontSize: 24, lineHeight: 30 }}>
              {name}
            </AppText>
            {goal ? <Badge label={labelOf(catalog.data.goals, goal)} tone="primary" icon={GOAL_ICONS[goal]} /> : null}
          </View>
        </Row>
        {p ? (
          <Row gap={space.md} style={{ alignSelf: 'stretch' }}>
          <RankEmblem rank={p.rank} size={46} />
          <View style={{ flex: 1, gap: space.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText variant="bodyStrong">
                Level {p.level} · <AppText variant="bodyStrong" color={rankColor(p.rank)}>{p.rank}</AppText>
              </AppText>
              <AppText variant="caption" color={colors.textMuted}>
                {p.totalXp.toLocaleString()} XP
              </AppText>
            </Row>
            <ProgressBar value={p.fractionToNext} height={6} label={`Progress to level ${p.level + 1}`} />
          </View>
          </Row>
        ) : progress.isError ? (
          <AppText variant="caption" color={colors.textMuted}>
            Level and XP couldn&apos;t load. Pull to refresh.
          </AppText>
        ) : null}
      </GradientCard>

      <StatStrip
        items={[
          { label: 'Streak', value: p ? String(p.streak.current) : '–', unit: p?.streak.current === 1 ? 'day' : 'days', tint: colors.accent },
          { label: 'Records', value: records.data ? String(records.data.records.length) : '–' },
          { label: 'Best streak', value: p ? String(p.streak.longest) : '–', unit: p?.streak.longest === 1 ? 'day' : 'days', tint: colors.purple },
        ]}
      />

      {missing.length > 0 ? (
        <Pressable accessibilityRole="button" onPress={() => edit(missing[0]!)}>
          <InlineMessage tone="info" icon="person-outline">
            {`Finish personalizing FORM — ${missing.length} ${missing.length === 1 ? 'section' : 'sections'} to go. Tap to continue.`}
          </InlineMessage>
        </Pressable>
      ) : null}

      <ComingSoon />
      {bodyQuest.data ? (
        <BodyQuestSummaryCard
          stage={bodyQuest.data.bodyQuest.stage}
          highestStage={bodyQuest.data.bodyQuest.highestStage}
          overall={bodyQuest.data.bodyQuest.overall}
          statsWithData={bodyQuest.data.bodyQuest.statsWithData}
          nextStage={bodyQuest.data.bodyQuest.next?.stage ?? null}
          onPress={() => router.push('/progress/body-quest' as Href)}
        />
      ) : null}
      {achievements.data ? (
        <Pressable accessibilityRole="button" onPress={() => router.push('/progress/achievements' as Href)}>
          <Card style={{ gap: space.sm }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row gap={space.sm}>
                <Ionicons name="medal" size={20} color={colors.accent} />
                <AppText variant="bodyStrong">Achievements</AppText>
              </Row>
              <AppText variant="caption" color={colors.textMuted}>
                {achievements.data.achievements.filter((a) => a.state === 'unlocked').length} of {achievements.data.achievements.length}
              </AppText>
            </Row>
            <ProgressBar value={achievements.data.achievements.filter((a) => a.state === 'unlocked').length / Math.max(1, achievements.data.achievements.length)} height={6} color={colors.accent} />
          </Card>
        </Pressable>
      ) : null}

      {summary.data ? <ActivitySummary s={summary.data} /> : null}

      <SectionHeader title="Personal records" action={<SeeAll href="/progress" />} />
      {records.data && records.data.records.length > 0 ? (
        <RecordsList records={records.data.records} limit={3} />
      ) : (
        <Card style={{ gap: space.md }}>
          {records.isError && !records.data ? (
            <ErrorState error={records.error} onRetry={records.refetch} compact />
          ) : !records.data ? (
            <StateView kind="loading" compact />
          ) : (
            <AppText variant="caption" color={colors.textMuted}>
              No records yet. They come from reps the camera verified, so every one is earned.
            </AppText>
          )}
        </Card>
      )}

      <SectionHeader title="Recent workouts" action={<SeeAll href="/progress" />} />
      <Card style={{ gap: space.md }}>
        {workouts.isError && !workouts.data ? (
          <ErrorState error={workouts.error} onRetry={workouts.refetch} compact />
        ) : !workouts.data ? (
          <StateView kind="loading" compact />
        ) : workouts.data.workouts.length === 0 ? (
          <AppText variant="caption" color={colors.textMuted}>
            No workouts yet.
          </AppText>
        ) : (
          workouts.data.workouts.slice(0, 3).map((w) => (
            <Row key={w.id} style={{ justifyContent: 'space-between' }}>
              <AppText variant="body">
                {new Date(`${w.localDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} · {w.durationMinutes} min
              </AppText>
              <AppText variant="bodyStrong" color={w.xp > 0 ? colors.primary : colors.textFaint}>
                +{w.xp} XP
              </AppText>
            </Row>
          ))
        )}
      </Card>

      <SectionHeader title="Weight" action={<SeeAll href="/profile/weight" label="History" />} />
      <Pressable accessibilityRole="button" accessibilityLabel="Open weight history" onPress={() => router.push('/profile/weight')}>
        <Card style={{ gap: space.xs }}>
          {latestWeight ? (
            <>
              <AppText variant="number">{formatWeight(latestWeight.weightKg, m.settings.units)}</AppText>
              <AppText variant="caption" color={colors.textMuted}>
                Last logged {new Date(`${latestWeight.localDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · Tap to log or view history
              </AppText>
            </>
          ) : (
            <AppText variant="caption" color={colors.textMuted}>
              {weight.isPending ? 'Loading…' : 'No weight logged yet. Tap to add one.'}
            </AppText>
          )}
        </Card>
      </Pressable>

      <SectionHeader title="Your plan" />
      <ProfileSummary me={m} catalog={catalog.data} onEdit={edit} />

      <Button label="Settings & privacy" icon="settings-outline" variant="secondary" onPress={() => router.push('/profile/settings')} />
    </Screen>
  );
}

function SettingsButton() {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.push('/profile/settings')} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="settings-outline" size={22} color={colors.text} />
    </Pressable>
  );
}

function SeeAll({ href, label = 'See all' }: { href: Href; label?: string }) {
  return (
    <Pressable accessibilityRole="link" onPress={() => router.navigate(href)} hitSlop={10}>
      <AppText variant="label" color={colors.primary}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Features whose engines aren't built yet are named quietly in one place — no placeholder content. */
function ComingSoon() {
  const bodyQuest = useFeature('body_quest');
  const achievements = useFeature('achievements');
  if (bodyQuest.loading || achievements.loading) return null;
  const coming = [!bodyQuest.available && 'Body Quest (body goals with check-ins)', !achievements.available && 'Achievements (badges for real milestones)'].filter(Boolean);
  if (coming.length === 0) return null;
  return (
    <Card variant="plain" style={{ gap: space.xs }}>
      <AppText variant="bodyStrong">Coming to FORM</AppText>
      <AppText variant="caption" color={colors.textMuted}>
        {coming.join(' and ')} {coming.length === 1 ? "isn't" : "aren't"} available yet. Everything you log now will count toward them.
      </AppText>
    </Card>
  );
}
