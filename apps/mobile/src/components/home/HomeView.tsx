import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { BodyMap } from '@/components/art/BodyMap';
import { Buddy } from '@/components/art/Buddy';
import { ExerciseThumb } from '@/components/art/ExerciseArt';
import { setsPerMuscle } from '@/lib/muscles';
import { RankEmblem as RankBadge } from '@/components/art/RankEmblem';
import { AppText, Badge, Button, Card, Divider, ExerciseList, FuelSummary, heroInk, ICON_BUBBLE, IconBubble, InlineMessage, PhotoHero, ProgressBar, ProgressRing, Row, Screen, SectionAction, SectionHeader, StateView, StatStrip, WaterLine, type IconName } from '@/components/ui';
import { levelLine, RankEmblem } from '@/components/progress/ProgressionViews';
import { BodyQuestSummaryCard } from '@/components/recognition/RecognitionViews';
import { accuracyLine, dailySummary, formatLitres, fuelLine, GREETING, shortDate, updatedAgo } from '@/lib/homeFormat';
import { pickHomeInsight } from '@/lib/homeInsight';
import { heroPhoto } from '@/lib/heroPhotos';
import { rankLabel, stepProgress } from '@/lib/prestige';
import type { StepsCardState } from '@/lib/useSteps';
import type { CoachResponse, HomeSection, HomeViewModel, QuestProgress, WorkoutPlan } from '@/lib/types';
import { formatLoad, useUnits, type Units } from '@/lib/units';
import { colors, radius, space } from '@/theme/tokens';
import { InsightCard, MoreToggle, TodayCard, type OpenSession } from './HomeToday';

export type HomeRoute = 'train' | 'eat' | 'progress' | 'profile' | 'streak' | 'rank' | 'workout';

export interface HomeViewProps {
  vm: HomeViewModel;
  /** Display units for loads (stored in kg). Defaults to the user's setting. */
  units?: Units;
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
  /** Today's steps from Health Connect (Android). Hidden unless the device can offer them. */
  steps?: StepsCardState;
  /** Today's generated workout. Absent while loading or when it failed: Home then uses the server's suggestion. */
  plan?: WorkoutPlan | null;
  /** A workout that is open right now (active or paused): the primary action becomes Resume. */
  openSession?: OpenSession | null;
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
 * Home answers one question first: what should I do today? A short photo greeting, one card with
 * the day's workout and one clear action, at most one insight, then everything else behind "More from
 * today". A pure view over the
 * server's Home view model — every number comes from `vm`, every action routes somewhere real.
 */
export function HomeView({ vm, onNavigate, onAddWater, onUndoWater, waterBusy, waterError, refreshing, onRefresh, refreshFailed, footer, now, coach, onOpenCoach, onOpenRoute, units, steps, plan, openSession }: HomeViewProps) {
  const [more, setMore] = useState(false);
  const insight = pickHomeInsight({
    today: vm.today,
    plan,
    nutrition: vm.nutrition,
    streak: vm.progression?.streak.current ?? null,
    coach: vm.coach.mode !== 'unavailable' ? (coach?.response ?? null) : null,
    coachPending: vm.coach.mode !== 'unavailable' && !!coach?.loading,
  });
  const failed = (s: HomeSection) => vm.errors.includes(s);
  const date = new Date(`${vm.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });

  return (
    <Screen
      title={`${GREETING[vm.greeting.period]}, ${vm.greeting.name}`}
      refreshing={refreshing}
      onRefresh={onRefresh}
      hero={
        <PhotoHero source={heroPhoto('home')} minHeight={240}>
          <Row style={styles.greeting}>
            <View style={{ flex: 1, gap: 4 }}>
              <AppText variant="label" color={heroInk.muted}>
                {date}
              </AppText>
              <AppText variant="title" header color={heroInk.text}>
                {`${GREETING[vm.greeting.period]}, ${vm.greeting.name}`}
              </AppText>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Open profile" onPress={() => onNavigate('profile')} hitSlop={4} style={styles.avatar}>
              <Ionicons name="person" size={20} color={heroInk.text} />
            </Pressable>
          </Row>
          {vm.progression ? (
            <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Level ${vm.progression.level}, ${vm.progression.rank}. Open progress`} onPress={() => onNavigate('progress')} hitSlop={4} style={[styles.chip, { backgroundColor: `${heroInk.text}1F` }]}>
                <RankBadge rank={vm.progression.rank} size={18} />
                <AppText variant="bodyStrong" color={heroInk.text}>
                  Lv {vm.progression.level}
                </AppText>
                <AppText variant="label" color={heroInk.muted}>
                  {vm.progression.rank}
                </AppText>
              </Pressable>
            </Row>
          ) : null}
        </PhotoHero>
      }>
      {/* 1 · What to do today: one card, one action. Without a plan or a suggestion, say so. */}
      {openSession || vm.today || plan ? (
        <TodayCard today={vm.today} plan={plan} goal={vm.greeting.primaryGoal} openSession={openSession} onNavigate={onNavigate} />
      ) : failed('today') ? (
        <SectionError name="today" />
      ) : null}

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

      {/* 2 · At most one insight: recovery, a form hold, the coach's tip, or one plain data line. */}
      <InsightCard insight={insight} onNavigate={onNavigate} onOpenCoach={onOpenCoach} onOpenRoute={onOpenRoute} />

      {/* 3 · Everything else, one tap away. */}
      <View style={{ gap: space.lg }}>
        <MoreToggle open={more} summary={dailySummary(vm).join(' · ')} onToggle={() => setMore((m) => !m)} />
        {more ? (
          <View style={{ gap: space.lg }}>
            {vm.nutrition || vm.water || vm.progression ? <StatTiles vm={vm} onNavigate={onNavigate} /> : null}

            {steps && steps.status !== 'unavailable' && steps.status !== 'checking' ? <StepsCard steps={steps} /> : null}

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

            {vm.today?.lastWorkout ? <LastSession last={vm.today.lastWorkout} units={units} /> : null}

            <View style={{ gap: space.md }}>
              <SectionHeader title="Today's goals" />
              {vm.quests ? <Quests daily={vm.quests.daily} weekly={vm.quests.weekly} /> : <SectionError name="quests" />}
            </View>

            <View style={{ gap: space.md }}>
              <SectionHeader title="Your level" action={<SectionAction label="View all" onPress={() => onNavigate('progress')} />} />
              {vm.progression ? <Level p={vm.progression} onOpenRank={() => onNavigate('rank')} /> : <SectionError name="progression" />}
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
          </View>
        ) : null}
      </View>

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
        <IconBubble icon="rocket" tint={colors.accent} size={ICON_BUBBLE.lg} />
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
            {s.done ? <IconBubble icon="checkmark" tint={colors.success} size={ICON_BUBBLE.md} solid /> : <IconBubble icon={meta[s.key].icon} tint={meta[s.key].tint} size={ICON_BUBBLE.md} />}
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

/** The previous workout: the muscles it hit, its headline numbers, and what you did. */
function LastSession({ last, units: unitsProp }: { last: NonNullable<NonNullable<HomeViewModel['today']>['lastWorkout']>; units?: Units }) {
  const units = useUnits(unitsProp);
  const muscles = setsPerMuscle(last.exercises.map((e) => ({ exerciseId: e.exerciseId, count: e.sets })));
  const top = muscles[0]?.value ?? 1;
  const sets = last.exercises.reduce((n, e) => n + e.sets, 0);
  return (
    <Card style={{ gap: space.lg }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={space.sm}>
          <IconBubble icon="body" tint={colors.protein} size={ICON_BUBBLE.sm} />
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
                {`${e.name}: ${e.sets} ${e.sets === 1 ? 'set' : 'sets'}, ${e.totalReps} reps${e.bestLoadKg > 0 ? ` · top ${formatLoad(e.bestLoadKg, units)}` : ''}${e.verifiedReps > 0 ? ` · ${e.verifiedReps} verified` : ''}`}
              </AppText>
            </View>
          ))}
        </ExerciseList>
      </View>
    </Card>
  );
}

/** Three small numbers for the day: protein, water and the streak. Each is a quiet tile; the streak opens its screen. */
function StatTiles({ vm, onNavigate }: { vm: HomeViewModel; onNavigate: HomeViewProps['onNavigate'] }) {
  const n = vm.nutrition;
  const w = vm.water;
  const streak = vm.progression?.streak.current;
  return (
    <Row gap={space.sm} style={{ alignItems: 'stretch' }}>
      {n ? (
        <StatTile
          icon="nutrition"
          tint={colors.protein}
          label="Protein"
          value={`${Math.round(n.proteinG)} g`}
          sub={n.targets ? `of ${Math.round(n.targets.proteinG)} g` : undefined}
          fraction={n.targets ? n.proteinG / n.targets.proteinG : undefined}
          accessibilityLabel={`Protein today: ${Math.round(n.proteinG)} grams${n.targets ? ` of ${Math.round(n.targets.proteinG)}` : ''}`}
        />
      ) : null}
      {w ? (
        <StatTile
          icon="water"
          tint={colors.water}
          label="Water"
          value={`${(w.totalMl / 1000).toFixed(1)} L`}
          sub={`of ${(w.targetMl / 1000).toFixed(1)} L`}
          fraction={w.totalMl / w.targetMl}
          accessibilityLabel={`Water today, ${(w.totalMl / 1000).toFixed(1)} of ${(w.targetMl / 1000).toFixed(1)} litres`}
        />
      ) : null}
      {streak !== undefined ? (
        <StatTile
          icon="flame"
          tint={colors.accent}
          label="Streak"
          value={String(streak)}
          sub={streak === 1 ? 'day' : 'days'}
          accessibilityLabel={`${streak} day streak. Open streak and season`}
          onPress={() => onNavigate('streak')}
        />
      ) : null}
    </Row>
  );
}

function StatTile({
  icon,
  tint,
  label,
  value,
  sub,
  fraction,
  accessibilityLabel,
  onPress,
}: {
  icon: IconName;
  tint: string;
  label: string;
  value: string;
  sub?: string;
  fraction?: number;
  accessibilityLabel: string;
  onPress?: () => void;
}) {
  const body = (
    <>
      <Row gap={space.xs}>
        <Ionicons name={icon} size={14} color={tint} />
        <AppText variant="label" color={colors.textMuted} style={{ flexShrink: 1 }}>
          {label}
        </AppText>
      </Row>
      <AppText variant="stat">
        {value}
      </AppText>
      {sub ? (
        <AppText variant="caption" color={colors.textFaint}>
          {sub}
        </AppText>
      ) : null}
      {fraction !== undefined ? <ProgressBar value={fraction} height={4} color={tint} label={`${label} of daily target`} /> : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress} hitSlop={4} style={({ pressed }) => [styles.tile, { opacity: pressed ? 0.7 : 1 }]}>
        {body}
      </Pressable>
    );
  }
  return (
    <View accessible accessibilityLabel={accessibilityLabel} style={styles.tile}>
      {body}
    </View>
  );
}

/** Today's steps toward a goal. Not connected yet, it explains what it reads and offers the one button that asks. */
function StepsCard({ steps }: { steps: StepsCardState }) {
  const ready = steps.status === 'ready';
  const count = steps.today ?? 0;
  const intro = 'Show the steps from your phone and watch, counted once, and earn a little XP for them. FORM only reads your step count.';
  return (
    <View style={{ gap: space.md }}>
      <SectionHeader title="Steps" />
      <Card style={{ gap: space.md }}>
        {ready ? (
          <>
            <Row gap={space.lg}>
              <ProgressRing value={count / steps.goal} size={76} stroke={8} color={colors.primary} label="Steps of daily goal">
                <Ionicons name="walk" size={24} color={colors.primary} />
              </ProgressRing>
              <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`Steps today: ${steps.today === null ? 'not available' : `${count.toLocaleString()} of ${steps.goal.toLocaleString()}`}`}>
                <AppText variant="stat">{steps.today === null ? '—' : count.toLocaleString()}</AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  {`of ${steps.goal.toLocaleString()} steps`}
                </AppText>
                <AppText variant="caption" color={colors.textFaint}>
                  {count >= steps.goal ? 'Goal reached. ' : ''}
                  {`+${steps.xpToday} XP today (1 per 1,000, up to 10)`}
                </AppText>
              </View>
            </Row>
            {steps.weekAverage !== null ? (
              <AppText variant="caption" color={colors.textMuted}>
                {`7-day average: ${steps.weekAverage.toLocaleString()} steps`}
              </AppText>
            ) : null}
          </>
        ) : (
          <>
            <Row gap={space.md}>
              <IconBubble icon="walk" tint={colors.primary} size={ICON_BUBBLE.lg} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="heading" header>
                  Count your steps
                </AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  {steps.status === 'needs_install' ? "Steps come from the Health Connect app, which isn't on this phone yet." : steps.status === 'denied' ? "FORM doesn't have access to your steps. You can switch it on in Health Connect." : intro}
                </AppText>
              </View>
            </Row>
            {steps.status === 'needs_install' ? <Button label="Get Health Connect" icon="logo-google-playstore" onPress={steps.onInstall} /> : null}
            {steps.status === 'needs_permission' ? <Button label="Connect steps" icon="walk" onPress={steps.onConnect} loading={steps.busy} /> : null}
            {steps.status === 'denied' ? (
              <Row gap={space.sm}>
                <Button label="Open Health Connect" variant="secondary" onPress={steps.onOpenSettings} style={{ flex: 1 }} />
                <Button label="Try again" variant="secondary" onPress={steps.onConnect} loading={steps.busy} style={{ flex: 1 }} />
              </Row>
            ) : null}
          </>
        )}
      </Card>
    </View>
  );
}

const formatKcal = (v: number) => Math.round(v).toLocaleString();

function Fuel({ n, onNavigate, children }: { n: NonNullable<HomeViewModel['nutrition']>; onNavigate: HomeViewProps['onNavigate']; children?: ReactNode }) {
  const t = n.targets;
  return (
    <Card style={{ gap: space.lg }}>
      <FuelSummary
        numeral={n.kcal.toLocaleString()}
        numeralValue={n.kcal}
        formatNumeral={formatKcal}
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

function Level({ p, onOpenRank }: { p: NonNullable<HomeViewModel['progression']>; onOpenRank: () => void }) {
  const step = stepProgress(p);
  return (
    <Card style={{ gap: space.sm }}>
      <Row gap={space.md}>
        <RankEmblem rank={p.rank} size={44} prestige={p.prestige} />
        <View style={{ flex: 1 }}>
          <AppText variant="heading">
            Level {p.level} · {rankLabel(p.rank, p.prestige)}
          </AppText>
          <AppText variant="label" color={colors.textMuted} style={{ fontVariant: ['tabular-nums'] }}>
            {levelLine(p)}
          </AppText>
        </View>
        <Badge label={`Best ${p.streak.longest}`} tone="accent" icon="flame" />
      </Row>
      <ProgressBar value={step.fraction} height={6} label={`Progress to ${step.nextName ?? `level ${p.level + 1}`}`} />
      <AppText variant="caption" color={colors.textMuted}>
        {step.nextName === null
          ? 'Max level reached'
          : `${step.toNext.toLocaleString()} XP to ${step.nextName}${p.prestige == null && p.nextRank ? ` · ${p.nextRank.name} at level ${p.nextRank.minLevel}` : ''}`}
      </AppText>
      {p.provisionalXp > 0 ? (
        <AppText variant="caption" color={colors.textFaint}>
          Includes {p.provisionalXp} XP from today&apos;s food, confirmed when the day ends.
        </AppText>
      ) : null}
      <SectionAction label="Your rank and standing" onPress={onOpenRank} />
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
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: `${heroInk.text}1F`, alignItems: 'center', justifyContent: 'center' },
  tile: { flex: 1, minWidth: 0, gap: 4, padding: space.md, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, minHeight: 36, borderRadius: radius.pill },
  step: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm },
  sessionRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm },
});
