import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { BodyMap } from '@/components/art/BodyMap';
import { Buddy, type BuddyMood } from '@/components/art/Buddy';
import { ExerciseThumb } from '@/components/art/ExerciseArt';
import { setsPerMuscle } from '@/lib/muscles';
import { RankEmblem as RankBadge } from '@/components/art/RankEmblem';
import { RingsArt } from '@/components/art/SceneArt';
import { AppText, Badge, BreathingGlow, Button, Card, Divider, HeroMedia, InlineMessage, MacroTile, ProgressBar, ProgressRing, Row, Screen, StatStrip, SectionHeader, Stat, StateView, type IconName } from '@/components/ui';
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
            <Pressable accessibilityRole="button" accessibilityLabel="Open profile" onPress={() => onNavigate('profile')} style={styles.avatar}>
              <Ionicons name="person" size={20} color={colors.primary} />
            </Pressable>
          </Row>
          {vm.progression ? (
            <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`${vm.progression.streak.current} day streak. Open progress`} onPress={() => onNavigate('progress')} style={[styles.chip, { backgroundColor: colors.accentSoft }]}>
                <Ionicons name="flame" size={16} color={colors.accent} />
                <AppText variant="bodyStrong" color={colors.text}>
                  {vm.progression.streak.current}
                </AppText>
                <AppText variant="label" color={colors.textMuted}>
                  day streak
                </AppText>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Level ${vm.progression.level}, ${vm.progression.rank}. Open progress`} onPress={() => onNavigate('progress')} style={[styles.chip, { backgroundColor: colors.primarySoft }]}>
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

      {vm.today ? <TodayHero today={vm.today} onNavigate={onNavigate} /> : failed('today') ? <SectionError name="today" /> : null}

      <Row gap={space.sm} style={{ alignItems: 'stretch' }}>
        <QuickAction icon="restaurant" label="Log food" tint={colors.success} onPress={() => onNavigate('eat')} accessibilityLabel="Go to Eat to log food" />
        <QuickAction icon="barbell" label="Workout" tint={colors.primary} onPress={() => onNavigate('train')} accessibilityLabel="Go to Train" />
        <QuickAction icon="trophy" label="Progress" tint={colors.purple} onPress={() => onNavigate('progress')} accessibilityLabel="Go to Progress" />
      </Row>

      {vm.today?.lastWorkout ? <LastSession last={vm.today.lastWorkout} /> : null}

      <Row gap={space.sm} style={{ alignItems: 'stretch' }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Open Eat" onPress={() => onNavigate('eat')} style={{ flex: 1 }}>
          <Stat
            label="Protein"
            value={vm.nutrition ? String(Math.round(vm.nutrition.proteinG)) : '—'}
            unit={vm.nutrition?.targets ? `/ ${vm.nutrition.targets.proteinG} g` : 'g'}
            progress={vm.nutrition?.targets ? vm.nutrition.proteinG / vm.nutrition.targets.proteinG : undefined}
            icon="nutrition"
            tint={colors.protein}
          />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Stat
            label="Water"
            value={vm.water ? formatLitres(vm.water.totalMl) : '—'}
            unit={vm.water ? `/ ${formatLitres(vm.water.targetMl)}` : undefined}
            icon="water"
            tint={colors.water}
            progress={vm.water ? vm.water.totalMl / vm.water.targetMl : undefined}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Stat
            label="Streak"
            value={vm.progression ? String(vm.progression.streak.current) : '—'}
            unit={vm.progression?.streak.current === 1 ? 'day' : 'days'}
            icon="flame"
            tint={colors.accent}
            progress={vm.progression ? vm.progression.streak.current / Math.max(1, vm.progression.streak.longest) : undefined}
          />
        </View>
      </Row>

      {vm.water ? <WaterActions w={vm.water} onAdd={onAddWater} onUndo={onUndoWater} busy={waterBusy} error={waterError} /> : <SectionError name="water" />}

      <SectionHeader title="Today's fuel" action={<Link label="Log food" onPress={() => onNavigate('eat')} />} />
      {vm.nutrition ? <Fuel n={vm.nutrition} onNavigate={onNavigate} /> : <SectionError name="nutrition" />}

      <SectionHeader title="Today's goals" />
      {vm.quests ? <Quests daily={vm.quests.daily} weekly={vm.quests.weekly} /> : <SectionError name="quests" />}

      <SectionHeader title="Your level" action={<Link label="View all" onPress={() => onNavigate('progress')} />} />
      {vm.progression ? <Level p={vm.progression} /> : <SectionError name="progression" />}

      {vm.errors.includes('recognition') ? (
        <SectionError name="recognition" />
      ) : vm.bodyQuest.available && vm.achievements.available ? (
        <>
          <SectionHeader title="Milestones" action={<Link label="View all" onPress={() => onNavigate('progress')} />} />
          <Milestones vm={vm} onOpen={() => onNavigate('progress')} />
        </>
      ) : (
        <Card variant="plain" style={{ gap: space.xs }}>
          <AppText variant="bodyStrong">Coming to FORM</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {[!vm.bodyQuest.available && 'Body Quest', !vm.achievements.available && 'Achievements'].filter(Boolean).join(' and ')} aren&apos;t available yet.
            Everything you log now will count toward them.
          </AppText>
        </Card>
      )}

      {vm.coach.mode !== 'unavailable' && coach ? (
        <>
          <SectionHeader title="Coach" action={onOpenCoach ? <Link label="Ask the coach" onPress={onOpenCoach} /> : undefined} />
          {coach.response ? (
            <CoachCard response={coach.response} title="Today's tip" onAction={onOpenRoute} />
          ) : coach.loading ? (
            <Card>
              <StateView kind="loading" compact />
            </Card>
          ) : coach.failed ? (
            <Card>
              <AppText variant="caption" color={colors.textMuted}>
                The coach couldn&apos;t load right now. Pull down to try again.
              </AppText>
            </Card>
          ) : null}
        </>
      ) : null}

      <AppText variant="caption" color={colors.textFaint} style={{ textAlign: 'center' }}>
        Updated {updatedAgo(vm.generatedAt, now)}
      </AppText>
      {footer}
    </Screen>
  );
}

function Link({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} hitSlop={12} style={{ minHeight: 32, justifyContent: 'center' }}>
      <AppText variant="label" color={colors.primary}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Body Quest stage, the next achievement within reach, and weeks on plan — all from real activity. */
function Milestones({ vm, onOpen }: { vm: HomeViewModel; onOpen: () => void }) {
  const bq = vm.bodyQuest;
  const a = vm.achievements;
  if (!bq.available || !a.available) return null;
  return (
    <View style={{ gap: space.sm }}>
      <BodyQuestSummaryCard stage={bq.stage} highestStage={bq.highestStage} overall={bq.overall} statsWithData={bq.statsWithData} nextStage={bq.nextStage} onPress={onOpen} />
      <Card style={{ gap: space.sm }}>
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
      </Card>
    </View>
  );
}

function SectionError({ name }: { name: HomeSection }) {
  return (
    <Card>
      <StateView kind="error" compact title={`Couldn't load ${SECTION_LABEL[name]}`} message="The rest of Home is up to date. Pull down to try again." />
    </Card>
  );
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
        <View style={[styles.stepIcon, { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.accentSoft }]}>
          <Ionicons name="rocket" size={22} color={colors.accent} />
        </View>
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
      {steps.map((s) => (
        <Pressable
          key={s.key}
          accessibilityRole="button"
          accessibilityLabel={meta[s.key].label}
          accessibilityState={{ checked: s.done }} aria-checked={s.done}
          disabled={s.done}
          onPress={meta[s.key].action}
          style={({ pressed }) => [styles.step, { backgroundColor: `${meta[s.key].tint}14`, borderColor: `${meta[s.key].tint}30`, transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
          <View style={[styles.stepIcon, { backgroundColor: s.done ? colors.success : meta[s.key].tint }]}>
            <Ionicons name={s.done ? 'checkmark' : meta[s.key].icon} size={18} color={colors.onPrimary} />
          </View>
          <AppText variant="bodyStrong" color={s.done ? colors.textMuted : colors.text} style={{ flex: 1, textDecorationLine: s.done ? 'line-through' : 'none' }}>
            {meta[s.key].label}
          </AppText>
          {s.done ? null : <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />}
        </Pressable>
      ))}
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

/** A bright shortcut tile: an icon in a coloured bubble and a few words. */
function QuickAction({ icon, label, tint, onPress, disabled, accessibilityLabel }: { icon: IconName; label: string; tint: string; onPress: () => void; disabled?: boolean; accessibilityLabel?: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      aria-disabled={!!disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.quick, { backgroundColor: `${tint}17`, borderColor: `${tint}33`, transform: [{ scale: pressed ? 0.96 : 1 }], opacity: disabled ? 0.6 : 1 }]}>
      <View style={[styles.quickIcon, { backgroundColor: tint }]}>
        <Ionicons name={icon} size={20} color={colors.onPrimary} />
      </View>
      <AppText variant="bodyStrong" style={{ fontSize: 14 }} numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** The previous workout: the muscles it hit, its headline numbers, and what you did. */
function LastSession({ last }: { last: NonNullable<NonNullable<HomeViewModel['today']>['lastWorkout']> }) {
  const muscles = setsPerMuscle(last.exercises.map((e) => ({ exerciseId: e.exerciseId, count: e.sets })));
  const top = muscles[0]?.value ?? 1;
  const sets = last.exercises.reduce((n, e) => n + e.sets, 0);
  return (
    <Card style={{ gap: space.lg }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Row gap={space.sm}>
          <View style={[styles.stepIcon, { width: 32, height: 32, borderRadius: 16, backgroundColor: `${colors.protein}1F` }]}>
            <Ionicons name="body" size={16} color={colors.protein} />
          </View>
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
        items={[
          { label: 'Time', value: String(last.durationMinutes), unit: 'min' },
          { label: 'Sets', value: String(sets) },
          { label: 'XP', value: `+${last.xp}`, tint: colors.accent },
        ]}
      />
      <View style={{ gap: space.sm }} accessible accessibilityLabel={`Last session ${shortDate(last.localDate)}`}>
        {last.exercises.map((e) => (
          <Row key={e.exerciseId} gap={space.md}>
            <ExerciseThumb exerciseId={e.exerciseId} size={36} />
            <AppText variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
              {e.name}: {e.sets} {e.sets === 1 ? 'set' : 'sets'}, {e.totalReps} reps{e.bestLoadKg > 0 ? ` · top ${e.bestLoadKg} kg` : ''}
              {e.verifiedReps > 0 ? ` · ${e.verifiedReps} verified` : ''}
            </AppText>
          </Row>
        ))}
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

function Fuel({ n, onNavigate }: { n: NonNullable<HomeViewModel['nutrition']>; onNavigate: HomeViewProps['onNavigate'] }) {
  const t = n.targets;
  return (
    <Card style={{ gap: space.lg }}>
      <Row gap={space.lg}>
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={space.xs} style={{ alignItems: 'baseline' }}>
            <AppText variant="display" style={{ fontVariant: ['tabular-nums'] }}>
              {n.kcal.toLocaleString()}
            </AppText>
            {t ? (
              <AppText variant="bodyStrong" color={colors.textMuted}>
                / {t.kcal.toLocaleString()}
              </AppText>
            ) : null}
          </Row>
          <AppText variant="label" color={colors.textMuted}>
            Calories eaten · {n.mealsLogged} logged
          </AppText>
        </View>
        <ProgressRing value={t ? n.kcal / t.kcal : 0} size={84} stroke={8} color={colors.accent} label={t ? 'Calories of target' : undefined}>
          <Ionicons name="flame" size={24} color={colors.accent} />
        </ProgressRing>
      </Row>
      {t ? (
        <Row gap={space.sm}>
          <MacroTile label="Protein" value={n.proteinG} target={t.proteinG} color={colors.protein} />
          <MacroTile label="Carbs" value={n.carbsG} target={t.carbsG} color={colors.carbs} />
          <MacroTile label="Fat" value={n.fatG} target={t.fatG} color={colors.fat} />
        </Row>
      ) : null}
      <AppText variant="caption" color={colors.textMuted}>
        {fuelLine(n)}
      </AppText>
      {n.kcal > 0 ? (
        <AppText variant="caption" color={n.estimatedKcalShare > 0 ? colors.warning : colors.textFaint}>
          {accuracyLine(n.measuredKcalShare, n.estimatedKcalShare)}
        </AppText>
      ) : null}
      {!t ? (
        <Pressable accessibilityRole="button" onPress={() => onNavigate('profile')}>
          <InlineMessage tone="info">Finish your body profile to get calorie and macro targets →</InlineMessage>
        </Pressable>
      ) : null}
      {n.mealsLogged === 0 ? <Button label="Log your first meal today" icon="add" variant="secondary" onPress={() => onNavigate('eat')} /> : null}
    </Card>
  );
}

function WaterActions({
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
          <Pressable accessibilityRole="button" accessibilityLabel="Undo last water entry" onPress={() => onUndo(w.lastEntryId!)} disabled={busy} hitSlop={10} style={{ minHeight: 32, justifyContent: 'center' }}>
            <AppText variant="label" color={colors.textMuted}>
              Undo last
            </AppText>
          </Pressable>
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
  return (
    <Card style={{ gap: space.xs }}>
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
        <InlineMessage tone="warning" icon="alert-circle-outline">
          {p.trainWithinDays === 1 ? `Train today to keep Level ${p.level}.` : `Train within 2 days to keep Level ${p.level}.`}
        </InlineMessage>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  greeting: { paddingTop: space.sm, paddingBottom: space.xs, alignItems: 'flex-end' },
  dot: { width: 28, height: 6, borderRadius: 3, backgroundColor: colors.track },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.card },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, minHeight: 36, borderRadius: radius.pill },
  quick: { flex: 1, gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, alignItems: 'flex-start' },
  quickIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  stepIcon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: 56,
    paddingHorizontal: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.wash,
  },
});
