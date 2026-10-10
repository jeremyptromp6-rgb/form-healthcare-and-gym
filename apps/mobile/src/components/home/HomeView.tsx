import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BodyMap } from '@/components/art/BodyMap';
import { Buddy, type BuddyMood } from '@/components/art/Buddy';
import { ExerciseThumb } from '@/components/art/ExerciseArt';
import { setsPerMuscle } from '@/lib/muscles';
import { RankEmblem as RankBadge } from '@/components/art/RankEmblem';
import { RingsArt } from '@/components/art/SceneArt';
import { AppText, Badge, BreathingGlow, Button, Card, Divider, ExerciseList, FuelSummary, HeroMedia, IconBubble, InlineMessage, ProgressBar, Row, Screen, SectionAction, SectionHeader, StateView, StatStrip, WaterLine, type IconName } from '@/components/ui';
import { levelLine, RankEmblem } from '@/components/progress/ProgressionViews';
import { CoachCard } from '@/components/coach/CoachViews';
import { BodyQuestSummaryCard } from '@/components/recognition/RecognitionViews';
import { accuracyLine, formatLitres, fuelLine, GREETING, shortDate, updatedAgo } from '@/lib/homeFormat';
import type { CoachResponse, HomeSection, HomeViewModel, QuestProgress } from '@/lib/types';
import { imagery } from '@/theme/imagery';
import { colors, radius, space } from '@/theme/tokens';

export type HomeRoute = 'train' | 'eat' | 'progress' | 'profile';

export interface HomeViewProps {
  vm: HomeViewModel;
  onNavigate: (route: HomeRoute) => void;
  onAddWater: (ml: number) => void;
  onUndoWater: (entryId: string) => void;
  waterBusy?: boolean;
  waterError?: string | null;
  refreshing?: boolean;
  onRefresh?: () => void;
  /** The last refresh failed; `vm` is the last good copy. */
  refreshFailed?: boolean;
  /** Rendered at the end of the scroll view (e.g. the free-tier ad slot). */
  footer?: React.ReactNode;
  now?: Date;
  /** Today's coaching tip (fetched separately, so a slow coach never holds Home up). */
  coach?: { response: CoachResponse | null; loading: boolean; failed: boolean };
  onOpenCoach?: () => void;
  onOpenRoute?: (route: string) => void;
}

const SECTION_LABEL: Record<HomeSection, string> = {
  progression: 'your progress',
  recognition: 'your milestones',
  today: "today's plan",
  nutrition: 'nutrition',
  water: 'water',
  quests: 'goals',
  activity: 'recent activity',
};

/**
 * Home answers one question first: what should I do today? A greeting, the day's plan with one
 * clear action, three numbers that matter, then everything else, quieter. A pure view over the
 * server's Home view model — every number comes from `vm`, every action routes somewhere real.
 */
export function HomeView({ vm, onNavigate, onAddWater, onUndoWater, waterBusy, waterError, refreshing, onRefresh, refreshFailed, footer, now, coach, onOpenCoach, onOpenRoute }: HomeViewProps) {
  const failed = (s: HomeSection) => vm.errors.includes(s);
  const date = new Date(`${vm.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <Screen
      title={`${GREETING[vm.greeting.period]}, ${vm.greeting.name}`}
      refreshing={refreshing}
      onRefresh={onRefresh}
      hero={
        <View style={{ gap: space.md, paddingTop: space.sm }}>
          <Row style={styles.greeting}>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="label" color={colors.textFaint}>
                {date}
              </AppText>
              <AppText variant="title" header>
                {`${GREETING[vm.greeting.period]}, ${vm.greeting.name}`}
              </AppText>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Open profile" onPress={() => onNavigate('profile')} hitSlop={4} style={styles.avatar}>
              <Ionicons name="person" size={20} color={colors.primary} />
            </Pressable>
          </Row>
          {vm.progression ? (
            <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${vm.progression.streak.current} day streak. Open progress`} onPress={() => onNavigate('progress')} hitSlop={4} style={[styles.chip, { backgroundColor: colors.accentSoft }]}>
                <Ionicons name="flame" size={16} color={colors.accent} />
                <AppText variant="bodyStrong" color={colors.text}>
                  {vm.progression.streak.current}
                </AppText>
                <AppText variant="label" color={colors.textMuted}>
                  day streak
                </AppText>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Level ${vm.progression.level}, ${vm.progression.rank}. Open progress`} onPress={() => onNavigate('progress')} hitSlop={4} style={[styles.chip, { backgroundColor: colors.primarySoft }]}>
                <RankBadge rank={vm.progression.rank} size={18} />
                <AppText variant="bodyStrong" color={colors.text}>
                  Lv {vm.progression.level}
                </AppText>
                <AppText variant="label" color={colors.textMuted}>
                  {vm.progression.rank}
                </AppText>
              </Pressable>
            </Row>
          ) : null}
        </View>
      }>
      {refreshFailed ? (
        <InlineMessage tone="warning" icon="cloud-offline-outline">
          {`Couldn't refresh — showing data from ${updatedAgo(vm.generatedAt, now)}. Pull down to try again.`}
        </InlineMessage>
      ) : null}

      {/* The checklist stays until every first step is done (the server sends null then); returning users get a welcome instead. */}
      {vm.firstSteps && vm.state !== 'returning' ? <FirstSteps steps={vm.firstSteps} onNavigate={onNavigate} onAddWater={onAddWater} /> : null}
      {vm.state === 'returning' ? (
        <InlineMessage tone="info" icon="hand-right-outline">
          {`Welcome back — it's been ${vm.daysSinceLastActivity} days. Ease in with a lighter session; consistency beats intensity.`}
        </InlineMessage>
      ) : null}

      {/* 3 · The one thing to do today. */}
      {vm.today ? <TodayHero today={vm.today} onNavigate={onNavigate} /> : failed('today') ? <SectionError name="today" /> : null}

      {/* 4 · Nutrition: calories, macros and water together. */}
      <View style={{ gap: space.md }}>
        <SectionHeader title="Today's fuel" action={<SectionAction label="Log food" onPress={() => onNavigate('eat')} />} />
        {vm.nutrition ? (
          <Fuel n={vm.nutrition} onNavigate={onNavigate}>
            {vm.water ? <Water w={vm.water} onAdd={onAddWater} onUndo={onUndoWater} busy={waterBusy} error={waterError} /> : null}
          </Fuel>
        ) : (
          <SectionError name="nutrition" />
        )}
      </View>
      {vm.nutrition && !vm.water ? <SectionError name="water" /> : null}

      {/* 5 · The coach's read on the day. */}
      {vm.coach.mode !== 'unavailable' && coach ? (
        <View style={{ gap: space.md }}>
          <SectionHeader title="Coach" action={onOpenCoach ? <SectionAction label="Ask the coach" onPress={onOpenCoach} /> : undefined} />
          {coach.response ? (
            <CoachCard response={coach.response} title="Today's tip" onAction={onOpenRoute} />
          ) : coach.loading ? (
            <StateView kind="loading" compact />
          ) : coach.failed ? (
            <InlineMessage tone="info" flat>
              {"The coach couldn't load right now. Pull down to try again."}
            </InlineMessage>
          ) : null}
        </View>
      ) : null}

      {/* Then the longer view: the last session, goals, level and milestones. */}
      {vm.today?.lastWorkout ? <LastSession last={vm.today.lastWorkout} /> : null}

      <View style={{ gap: space.md }}>
        <SectionHeader title="Today's goals" />
        {vm.quests ? <Quests daily={vm.quests.daily} weekly={vm.quests.weekly} /> : <SectionError name="quests" />}
      </View>

      <View style={{ gap: space.md }}>
        <SectionHeader title="Your level" action={<SectionAction label="View all" onPress={() => onNavigate('progress')} />} />
        {vm.progression ? <Level p={vm.progression} /> : <SectionError name="progression" />}
      </View>

      {vm.errors.includes('recognition') ? (
        <SectionError name="recognition" />
      ) : vm.bodyQuest.available && vm.achievements.available ? (
        <View style={{ gap: space.md }}>
          <SectionHeader title="Milestones" action={<SectionAction label="View all" onPress={() => onNavigate('progress')} />} />
          <Milestones vm={vm} onOpen={() => onNavigate('progress')} />
        </View>
      ) : (
        <Card variant="plain" style={{ gap: space.xs }}>
          <AppText variant="bodyStrong">Coming to FORM</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {[!vm.bodyQuest.available && 'Body Quest', !vm.achievements.available && 'Achievements'].filter(Boolean).join(' and ')} aren&apos;t available yet.
            Everything you log now will count toward them.
          </AppText>
        </Card>
      )}

      <AppText variant="caption" color={colors.textFaint} style={{ textAlign: 'center' }}>
        Updated {updatedAgo(vm.generatedAt, now)}
      </AppText>
      {footer}
    </Screen>
  );
}

/** Body Quest stage, the next achievement within reach, and weeks on plan — all from real activity. */
function Milestones({ vm, onOpen }: { vm: HomeViewModel; onOpen: () => void }) {
  const bq = vm.bodyQuest;
  const a = vm.achievements;
  if (!bq.available || !a.available) return null;
  return (
    <Card style={{ gap: space.md }}>
      <BodyQuestSummaryCard flat stage={bq.stage} highestStage={bq.highestStage} overall={bq.overall} statsWithData={bq.statsWithData} nextStage={bq.nextStage} onPress={onOpen} />
      <Divider />
      <View style={{ gap: space.sm }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <Row gap={space.sm}>
            <Ionicons name="medal" size={18} color={colors.accent} />
            <AppText variant="bodyStrong">
              {a.unlocked} of {a.total} achievements
            </AppText>
          </Row>
          {vm.streaks ? (
            <Badge label={`${vm.streaks.weekly.current} ${vm.streaks.weekly.current === 1 ? 'week' : 'weeks'} on plan`} tone="primary" icon="calendar" />
          ) : null}
        </Row>
        {a.next ? (
          <View style={{ gap: 4 }}>
            <AppText variant="caption" color={colors.textMuted}>
              Next up: {a.next.title} · {a.next.progress} of {a.next.target}
            </AppText>
            <ProgressBar value={a.next.progress / a.next.target} height={6} color={colors.accent} label={`${a.next.title} progress`} />
          </View>
        ) : (
          <AppText variant="caption" color={colors.textMuted}>
            Every achievement unlocked. That&apos;s real, earned work.
          </AppText>
        )}
      </View>
    </Card>
  );
}

function SectionError({ name }: { name: HomeSection }) {
  return <StateView kind="error" compact title={`Couldn't load ${SECTION_LABEL[name]}`} message="The rest of Home is up to date. Pull down to try again." />;
}

function FirstSteps({ steps, onNavigate, onAddWater }: { steps: NonNullable<HomeViewModel['firstSteps']>; onNavigate: HomeViewProps['onNavigate']; onAddWater: HomeViewProps['onAddWater'] }) {
  const meta = {
    workout: { label: 'Log your first workout', icon: 'barbell' as IconName, tint: colors.primary, action: () => onNavigate('train') },
    meal: { label: 'Log a meal', icon: 'restaurant' as IconName, tint: colors.success, action: () => onNavigate('eat') },
    water: { label: 'Drink a glass of water (250 ml)', icon: 'water' as IconName, tint: colors.water, action: () => onAddWater(250) },
  };
  return (
    <Card style={{ gap: space.md }}>
      <Row gap={space.md}>
        <IconBubble icon="rocket" tint={colors.accent} size={48} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="heading" header>
            Start here
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            Three small steps to get FORM working for you.
          </AppText>
        </View>
      </Row>
      <ProgressBar value={steps.filter((x) => x.done).length / steps.length} height={6} color={colors.success} label="First steps done" />
      <ExerciseList>
        {steps.map((s) => (
          <Pressable
            key={s.key}
            accessibilityRole="button"
            accessibilityLabel={meta[s.key].label}
            accessibilityState={{ checked: s.done }} aria-checked={s.done}
            disabled={s.done}
            onPress={meta[s.key].action}
            style={({ pressed }) => [styles.step, { opacity: pressed ? 0.7 : 1 }]}>
            {s.done ? <IconBubble icon="checkmark" tint={colors.success} size={36} solid /> : <IconBubble icon={meta[s.key].icon} tint={meta[s.key].tint} size={36} />}
            <AppText variant="bodyStrong" color={s.done ? colors.textMuted : colors.text} style={{ flex: 1, textDecorationLine: s.done ? 'line-through' : 'none' }}>
              {meta[s.key].label}
            </AppText>
            {s.done ? null : <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />}
          </Pressable>
        ))}
      </ExerciseList>
    </Card>
  );
}

/** The day's plan, big and clear, with one action. */
/** Pip matches the day: cheering you into a session, proud when it's done, resting with you. */
const MOOD: Record<NonNullable<HomeViewModel['today']>['suggestion']['kind'], BuddyMood> = {
  train: 'cheer',
  done_today: 'proud',
  weekly_goal_met: 'proud',
  rest_suggested: 'sleepy',
  recover: 'sleepy',
};

/** The previous workout: the muscles it hit, its headline numbers, and what you did. */
function LastSession({ last }: { last: NonNullable<NonNullable<HomeViewModel['today']>['lastWorkout']> }) {
  const muscles = setsPerMuscle(last.exercises.map((e) => ({ exerciseId: e.exerciseId, count: e.sets })));
  const top = muscles[0]?.value ?? 1;
  const sets = last.exercises.reduce((n, e) => n + e.sets, 0);
  return (
    <Card style={{ gap: space.lg }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={space.sm}>
          <IconBubble icon="body" tint={colors.protein} size={32} />
          <AppText variant="heading" header>
            Last session
          </AppText>
        </Row>
        <AppText variant="label" color={colors.textMuted}>
          {shortDate(last.localDate)}
        </AppText>
      </Row>
      {muscles.length ? <BodyMap heat={Object.fromEntries(muscles.map((m) => [m.muscle, m.value / top]))} height={170} style={{ alignSelf: 'center' }} /> : null}
      <StatStrip
        variant="flat"
        items={[
          { label: 'Time', value: String(last.durationMinutes), unit: 'min' },
          { label: 'Sets', value: String(sets) },
          { label: 'XP', value: `+${last.xp}`, tint: colors.accent },
        ]}
      />
      <View accessible accessibilityLabel={`Last session ${shortDate(last.localDate)}`}>
        <ExerciseList>
          {last.exercises.map((e) => (
            <View key={e.exerciseId} style={styles.sessionRow}>
              <ExerciseThumb exerciseId={e.exerciseId} size={40} />
              <AppText variant="caption" color={colors.text} style={{ flex: 1 }}>
                {`${e.name}: ${e.sets} ${e.sets === 1 ? 'set' : 'sets'}, ${e.totalReps} reps${e.bestLoadKg > 0 ? ` · top ${e.bestLoadKg} kg` : ''}${e.verifiedReps > 0 ? ` · ${e.verifiedReps} verified` : ''}`}
              </AppText>
            </View>
          ))}
        </ExerciseList>
      </View>
    </Card>
  );
}

function TodayHero({ today, onNavigate }: { today: NonNullable<HomeViewModel['today']>; onNavigate: HomeViewProps['onNavigate'] }) {
  const s = today.suggestion;
  const train = s.kind === 'train';
  return (
    <HeroMedia image={imagery.home} minHeight={train ? 300 : 240} art={<RingsArt style={{ flex: 1 }} />}>
      <Row gap={space.sm} style={{ alignItems: 'flex-end' }}>
        <View style={{ flex: 1, gap: 6 }}>
          <AppText variant="overline" color={s.kind === 'recover' ? colors.warning : colors.primary}>
            Today
          </AppText>
          <AppText variant="display" header>
            {s.title}
          </AppText>
        </View>
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <BreathingGlow size={150} color={colors.accent} style={{ position: 'absolute' }} />
          <Buddy mood={MOOD[s.kind]} size={92} />
        </View>
      </Row>
      <AppText variant="body" color={colors.textMuted}>
        {s.reason}
      </AppText>
      {today.plannedDaysPerWeek ? <WeekDots done={today.workoutsThisWeek} planned={today.plannedDaysPerWeek} /> : null}
      {s.kind === 'train' || s.kind === 'rest_suggested' ? (
        <Button label={train ? 'Start workout' : 'Train anyway'} iconRight={train ? 'arrow-forward' : undefined} variant={train ? 'primary' : 'secondary'} onPress={() => onNavigate('train')} />
      ) : null}
    </HeroMedia>
  );
}

/** One dot per planned session this week, filled as they're done. */
function WeekDots({ done, planned }: { done: number; planned: number }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }} accessible accessibilityLabel={`${done} of ${planned} sessions this week`}>
      {Array.from({ length: Math.max(planned, done) }, (_, i) => (
        <View key={i} style={[styles.dot, i < done && { backgroundColor: colors.primary }]} />
      ))}
    </View>
  );
}

function Fuel({ n, onNavigate, children }: { n: NonNullable<HomeViewModel['nutrition']>; onNavigate: HomeViewProps['onNavigate']; children?: ReactNode }) {
  const t = n.targets;
  return (
    <Card style={{ gap: space.lg }}>
      <FuelSummary
        numeral={n.kcal.toLocaleString()}
        unitLabel={t ? `/ ${t.kcal.toLocaleString()}` : null}
        caption={`Calories eaten · ${n.mealsLogged} logged`}
        ring={{ value: t ? n.kcal / t.kcal : 0, color: colors.accent, label: t ? 'Calories of target' : undefined }}
        macros={
          t
            ? [
                { label: 'Protein', value: n.proteinG, target: t.proteinG, color: colors.protein },
                { label: 'Carbs', value: n.carbsG, target: t.carbsG, color: colors.carbs },
                { label: 'Fat', value: n.fatG, target: t.fatG, color: colors.fat },
              ]
            : null
        }>
        <View style={{ gap: space.xs }}>
          <AppText variant="caption" color={colors.textMuted}>
            {fuelLine(n)}
          </AppText>
          {n.kcal > 0 ? (
            <AppText variant="caption" color={n.estimatedKcalShare > 0 ? colors.warning : colors.textFaint}>
              {accuracyLine(n.measuredKcalShare, n.estimatedKcalShare)}
            </AppText>
          ) : null}
        </View>
        {!t ? <SectionAction role="button" label="Finish your body profile to get calorie and macro targets →" onPress={() => onNavigate('profile')} /> : null}
        {n.mealsLogged === 0 ? <Button label="Log your first meal today" icon="add" variant="secondary" onPress={() => onNavigate('eat')} /> : null}
      </FuelSummary>
      {children ? (
        <>
          <Divider />
          {children}
        </>
      ) : null}
    </Card>
  );
}

function Water({
  w,
  onAdd,
  onUndo,
  busy,
  error,
}: {
  w: NonNullable<HomeViewModel['water']>;
  onAdd: (ml: number) => void;
  onUndo: (id: string) => void;
  busy?: boolean;
  error?: string | null;
}) {
  const done = w.totalMl >= w.targetMl;
  return (
    <View style={{ gap: space.sm }}>
      <WaterLine
        totalText={formatLitres(w.totalMl)}
        targetText={formatLitres(w.targetMl)}
        fraction={w.totalMl / w.targetMl}
        accessibilityLabel={`Water: ${formatLitres(w.totalMl)} of ${formatLitres(w.targetMl)}`}
      />
      <Row gap={space.sm}>
        <Button label="+250 ml" icon="water-outline" variant="secondary" onPress={() => onAdd(250)} disabled={busy} style={{ flex: 1 }} />
        <Button label="+500 ml" variant="secondary" onPress={() => onAdd(500)} disabled={busy} style={{ flex: 1 }} />
      </Row>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText variant="caption" color={colors.textFaint} style={{ flex: 1 }}>
          {done ? 'Water goal met today. ' : ''}
          {w.targetBasis === 'body_weight' ? 'A general guide based on your weight.' : 'A general guide. Add your weight in Profile for a personal one.'} Needs vary with heat and activity.
        </AppText>
        {w.lastEntryId ? (
          <SectionAction label="Undo last" accessibilityLabel="Undo last water entry" tone="muted" onPress={() => onUndo(w.lastEntryId!)} disabled={busy} />
        ) : null}
      </Row>
      {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
    </View>
  );
}

function QuestRow({ q }: { q: QuestProgress }) {
  return (
    <View style={{ gap: 6, paddingVertical: space.xs }} accessible accessibilityLabel={`${q.title}: ${q.progress} of ${q.target}${q.completed ? ', completed' : ''}, ${q.xpReward} XP`}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={space.sm} style={{ flex: 1 }}>
          <Ionicons name={q.completed ? 'checkmark-circle' : 'ellipse-outline'} size={20} color={q.completed ? colors.primary : colors.textFaint} />
          <AppText variant="body" color={q.completed ? colors.textMuted : colors.text} style={{ flexShrink: 1 }}>
            {q.title}
          </AppText>
        </Row>
        <AppText variant="label" color={q.completed ? colors.primary : colors.textFaint}>
          +{q.xpReward} XP
        </AppText>
      </Row>
      {!q.completed && q.target > 1 ? <ProgressBar value={q.progress / q.target} height={4} label={`${q.title} progress`} /> : null}
    </View>
  );
}

function Quests({ daily, weekly }: { daily: QuestProgress[]; weekly: QuestProgress[] }) {
  const allDone = daily.length > 0 && daily.every((q) => q.completed);
  return (
    <Card style={{ gap: space.xs }}>
      {allDone ? (
        <Row gap={space.sm} style={{ paddingBottom: space.xs }}>
          <Buddy mood="proud" size={44} float={false} />
          <AppText variant="bodyStrong" style={{ flex: 1 }}>
            Every goal for today is done. Nicely earned.
          </AppText>
        </Row>
      ) : null}
      {daily.map((q) => (
        <QuestRow key={q.id} q={q} />
      ))}
      {weekly.length > 0 ? (
        <>
          <Divider style={{ marginVertical: space.xs }} />
          <AppText variant="label" color={colors.textFaint}>
            This week
          </AppText>
          {weekly.map((q) => (
            <QuestRow key={q.id} q={q} />
          ))}
        </>
      ) : null}
    </Card>
  );
}

function Level({ p }: { p: NonNullable<HomeViewModel['progression']> }) {
  return (
    <Card style={{ gap: space.sm }}>
      <Row gap={space.md}>
        <RankEmblem rank={p.rank} size={44} />
        <View style={{ flex: 1 }}>
          <AppText variant="heading">
            Level {p.level} · {p.rank}
          </AppText>
          <AppText variant="label" color={colors.textMuted} style={{ fontVariant: ['tabular-nums'] }}>
            {levelLine(p)}
          </AppText>
        </View>
        <Badge label={`Best ${p.streak.longest}`} tone="accent" icon="flame" />
      </Row>
      <ProgressBar value={p.fractionToNext} height={6} label={`Progress to level ${p.level + 1}`} />
      <AppText variant="caption" color={colors.textMuted}>
        {p.xpForNextLevel === 0
          ? 'Max level reached'
          : `${(p.xpForNextLevel - p.xpIntoLevel).toLocaleString()} XP to level ${p.level + 1}${p.nextRank ? ` · ${p.nextRank.name} at level ${p.nextRank.minLevel}` : ''}`}
      </AppText>
      {p.provisionalXp > 0 ? (
        <AppText variant="caption" color={colors.textFaint}>
          Includes {p.provisionalXp} XP from today&apos;s food, confirmed when the day ends.
        </AppText>
      ) : null}
      {p.totalXp > 0 && p.trainWithinDays !== null && p.trainWithinDays <= 2 ? (
        <InlineMessage tone="warning" icon="alert-circle-outline" flat>
          {p.trainWithinDays === 1 ? `Train today to keep Level ${p.level}.` : `Train within 2 days to keep Level ${p.level}.`}
        </InlineMessage>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  greeting: { paddingTop: space.sm, paddingBottom: space.xs, alignItems: 'flex-end' },
  dot: { width: 28, height: 6, borderRadius: 3, backgroundColor: colors.track },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, minHeight: 36, borderRadius: radius.pill },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm },
});
