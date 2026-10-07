import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Badge, Card, Divider, ProgressBar, Row, type IconName } from '@/components/ui';
import { BODY_QUEST_STAGES, BODY_QUEST_STATS, type Achievement, type BodyQuest, type BodyQuestStage, type BodyQuestStat, type BodyQuestStatResult, type PersonalRecord, type Streaks } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

// ---- Body Quest ---------------------------------------------------------------------------------

export const STAGE_INFO: Record<BodyQuestStage, { label: string; icon: IconName; color: string; blurb: string }> = {
  starter: { label: 'Starter', icon: 'footsteps', color: '#9C8370', blurb: 'Every quest starts here. Train, verify, repeat.' },
  foundation: { label: 'Foundation', icon: 'cube', color: '#C24E2A', blurb: 'The basics are in place — a real routine is forming.' },
  builder: { label: 'Builder', icon: 'hammer', color: '#4E8A5C', blurb: 'Steady training is building real capacity.' },
  athlete: { label: 'Athlete', icon: 'flash', color: '#3E86B0', blurb: 'Strong, consistent and moving well.' },
  elite: { label: 'Elite', icon: 'diamond', color: '#C9741A', blurb: 'Months of consistent, high-quality training.' },
};

export const STAT_INFO: Record<BodyQuestStat, { label: string; icon: IconName; how: string }> = {
  strength: { label: 'Strength', icon: 'barbell', how: 'How much stronger your camera-verified sets are than your first ones.' },
  muscle: { label: 'Muscle', icon: 'body', how: 'Weekly working sets per muscle group (10 a week each is full marks), plus protein on days you log food.' },
  endurance: { label: 'Endurance', icon: 'pulse', how: 'Active training minutes a week, against the 150-minute guideline.' },
  mobility: { label: 'Mobility', icon: 'expand', how: 'Average range of motion of your verified reps.' },
  form: { label: 'Form', icon: 'ribbon', how: 'Average form score of your verified reps.' },
  consistency: { label: 'Consistency', icon: 'calendar', how: 'Planned training days you trained in the last 4 weeks. Recovery after pain is excused.' },
};

const NEEDS: Record<NonNullable<BodyQuestStatResult['needs']>, string> = {
  verify_same_exercise_twice: 'Verify the same exercise with the camera a week apart.',
  train_for_a_week: 'Measured after your first week of training.',
  verify_more_reps: 'Needs 20 camera-verified reps in the last 4 weeks.',
  train_more: 'Log at least two workouts in the last 4 weeks.',
};

export function stageLabel(stage: BodyQuestStage): string {
  return STAGE_INFO[stage].label;
}

/** The five stages as a path, with the current one lit and the highest reached marked. */
export function StageTrack({ stage, highestStage }: { stage: BodyQuestStage; highestStage?: BodyQuestStage }) {
  const current = BODY_QUEST_STAGES.indexOf(stage);
  const best = BODY_QUEST_STAGES.indexOf(highestStage ?? stage);
  return (
    <View style={styles.track} accessible accessibilityLabel={`Stage ${current + 1} of 5: ${stageLabel(stage)}`}>
      {BODY_QUEST_STAGES.map((s, i) => {
        const info = STAGE_INFO[s];
        const lit = i <= current;
        return (
          <View key={s} style={styles.trackStep}>
            {i > 0 ? <View style={[styles.trackLine, { backgroundColor: i <= current ? info.color : colors.border }]} /> : null}
            <View style={[styles.trackNode, { borderColor: lit ? info.color : i <= best ? `${info.color}88` : colors.border, backgroundColor: colors.card, borderWidth: i === current ? 2.5 : 1.5 }]}>
              <Ionicons name={info.icon} size={14} color={lit ? info.color : colors.textFaint} />
            </View>
            <AppText variant="caption" color={i === current ? colors.text : colors.textFaint} style={{ fontSize: 11 }}>
              {info.label}
            </AppText>
          </View>
        );
      })}
    </View>
  );
}

/** Compact Body Quest card for Progress, Home and Profile. */
export function BodyQuestSummaryCard({
  stage,
  highestStage,
  overall,
  statsWithData,
  nextStage,
  onPress,
}: {
  stage: BodyQuestStage;
  highestStage?: BodyQuestStage;
  overall: number | null;
  statsWithData: number;
  nextStage: BodyQuestStage | null;
  onPress?: () => void;
}) {
  const info = STAGE_INFO[stage];
  const body = (
    <Card style={{ gap: space.md }}>
      <Row gap={space.md}>
        <View style={[styles.emblem, { borderColor: info.color, backgroundColor: `${info.color}1F` }]}>
          <Ionicons name={info.icon} size={24} color={info.color} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="overline" color={info.color}>
            Body Quest
          </AppText>
          <AppText variant="heading">{info.label}</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {overall === null ? `${statsWithData} of 6 stats measured so far` : `Overall ${overall} · ${statsWithData} of 6 stats measured`}
          </AppText>
        </View>
        {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textFaint} /> : null}
      </Row>
      <StageTrack stage={stage} highestStage={highestStage} />
      {nextStage ? (
        <AppText variant="caption" color={colors.textFaint}>
          Next: {stageLabel(nextStage)}
        </AppText>
      ) : null}
    </Card>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={`Body Quest: ${info.label}. Open details`} onPress={onPress}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

/** The six stats, each with its value or an honest "not enough data yet". */
export function StatList({ stats }: { stats: BodyQuest['stats'] }) {
  return (
    <Card style={{ gap: space.xs, paddingVertical: space.sm }}>
      {BODY_QUEST_STATS.map((k, i) => {
        const s = stats[k];
        const info = STAT_INFO[k];
        return (
          <View key={k}>
            {i > 0 ? <Divider /> : null}
            <View style={{ gap: 6, paddingVertical: space.sm }} accessible accessibilityLabel={`${info.label}: ${s.value === null ? 'not enough data yet' : `${s.value} out of 100`}`}>
              <Row gap={space.sm}>
                <Ionicons name={info.icon} size={18} color={s.value === null ? colors.textFaint : colors.primary} />
                <AppText variant="bodyStrong" style={{ flex: 1 }}>
                  {info.label}
                </AppText>
                <AppText variant="bodyStrong" color={s.value === null ? colors.textFaint : colors.text} style={{ fontVariant: ['tabular-nums'] }}>
                  {s.value === null ? '—' : s.value}
                </AppText>
              </Row>
              {s.value !== null ? <ProgressBar value={s.value / 100} height={6} /> : null}
              <AppText variant="caption" color={colors.textMuted}>
                {s.value === null && s.needs ? NEEDS[s.needs] : info.how}
              </AppText>
            </View>
          </View>
        );
      })}
    </Card>
  );
}

const REQUIREMENT: Record<'overall' | 'stats' | 'weeks', (needed: number, have: number) => string> = {
  overall: (n, h) => `Overall score of ${n} or more (now ${h})`,
  stats: (n, h) => `${n} of 6 stats measured (now ${h})`,
  weeks: (n, h) => `${n} weeks of training (now ${h})`,
};

/** What the next stage asks for, as a checklist. */
export function NextStageCard({ next }: { next: NonNullable<BodyQuest['next']> }) {
  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="bodyStrong">To reach {stageLabel(next.stage)}</AppText>
      {next.requirements.map((r) => (
        <View key={r.kind} style={styles.row} accessible accessibilityLabel={`${REQUIREMENT[r.kind](r.needed, r.have)}${r.met ? ', done' : ''}`}>
          <Ionicons name={r.met ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={r.met ? colors.primary : colors.textFaint} />
          <AppText variant="body" color={r.met ? colors.textMuted : colors.text} style={{ flex: 1 }}>
            {REQUIREMENT[r.kind](r.needed, r.have)}
          </AppText>
        </View>
      ))}
    </Card>
  );
}

/** Weekly snapshots of the overall score, oldest to newest. */
export function BodyQuestHistory({ snapshots }: { snapshots: BodyQuest['snapshots'] }) {
  const recent = snapshots.slice(-12);
  if (recent.length === 0) {
    return (
      <Card>
        <AppText variant="caption" color={colors.textMuted}>
          A snapshot is saved at the end of every week you train, so you can see how far you&apos;ve come.
        </AppText>
      </Card>
    );
  }
  return (
    <Card style={{ gap: space.sm }}>
      <View style={styles.history}>
        {recent.map((s) => (
          <View key={s.weekStart} style={styles.historyCol} accessible accessibilityLabel={`Week of ${s.weekStart}: ${stageLabel(s.stage)}${s.overall === null ? '' : `, overall ${s.overall}`}`}>
            <View style={[styles.historyBar, { height: 8 + ((s.overall ?? 0) / 100) * 72, backgroundColor: s.overall === null ? colors.border : STAGE_INFO[s.stage].color }]} />
          </View>
        ))}
      </View>
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText variant="caption" color={colors.textFaint}>
          {new Date(`${recent[0]!.weekStart}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        </AppText>
        <AppText variant="caption" color={colors.textFaint}>
          Weekly snapshots
        </AppText>
      </Row>
    </Card>
  );
}

// ---- Achievements -------------------------------------------------------------------------------

export const ACHIEVEMENT_ICON: Record<string, IconName> = {
  first_rep: 'checkmark-circle',
  first_workout: 'barbell',
  form_master: 'ribbon',
  consistent: 'calendar',
  pr_breaker: 'trophy',
  nutrition_on_track: 'leaf',
  hundred_club: 'medal',
};

const REQUIRES: Record<NonNullable<Achievement['requires']>, string> = {
  camera: 'Counts camera-verified reps',
  nutrition_targets: 'Needs your body profile for targets',
};

export function AchievementTile({ a }: { a: Achievement }) {
  const unlocked = a.state === 'unlocked';
  const icon = ACHIEVEMENT_ICON[a.id] ?? 'star';
  const stateText = unlocked ? `unlocked${a.unlockedAt ? ` on ${new Date(a.unlockedAt).toLocaleDateString()}` : ''}` : a.state === 'in_progress' ? `${a.progress} of ${a.target}` : 'locked';
  return (
    <Card style={[styles.tile, unlocked && { borderColor: colors.accentSoft, borderWidth: 1 }]}>
      <View accessible accessibilityLabel={`${a.title}: ${a.description} ${stateText}. ${a.xpReward} XP`} style={{ gap: space.sm }}>
        <Row gap={space.sm}>
          <View style={[styles.badge, { backgroundColor: unlocked ? colors.accent : a.state === 'in_progress' ? colors.accentSoft : colors.cardRaised }]}>
            <Ionicons name={icon} size={22} color={unlocked ? colors.onPrimary : a.state === 'in_progress' ? colors.accent : colors.textFaint} />
            {a.state === 'locked' ? (
              <View style={styles.lock}>
                <Ionicons name="lock-closed" size={10} color={colors.textMuted} />
              </View>
            ) : null}
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong" color={unlocked ? colors.text : colors.textMuted}>
              {a.title}
            </AppText>
            <AppText variant="caption" color={colors.textFaint}>
              {unlocked ? (a.unlockedAt ? new Date(a.unlockedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unlocked') : `+${a.xpReward} XP`}
            </AppText>
          </View>
        </Row>
        <AppText variant="caption" color={colors.textMuted}>
          {a.description}
        </AppText>
        {a.state === 'in_progress' ? (
          <View style={{ gap: 4 }}>
            <ProgressBar value={a.progress / a.target} height={6} color={colors.accent} />
            <AppText variant="caption" color={colors.textFaint}>
              {a.progress} of {a.target}
            </AppText>
          </View>
        ) : null}
        {a.state === 'locked' && a.requires ? (
          <AppText variant="caption" color={colors.textFaint}>
            {REQUIRES[a.requires]}
          </AppText>
        ) : null}
      </View>
    </Card>
  );
}

/** Unlocked first, then closest to unlocking. */
export function sortAchievements(list: Achievement[]): Achievement[] {
  const rank = (a: Achievement) => (a.state === 'unlocked' ? 2 : a.progress / a.target);
  return [...list].sort((a, b) => rank(b) - rank(a));
}

export function AchievementList({ achievements }: { achievements: Achievement[] }) {
  return (
    <View style={{ gap: space.sm }}>
      {sortAchievements(achievements).map((a) => (
        <AchievementTile key={a.id} a={a} />
      ))}
    </View>
  );
}

// ---- Streaks ------------------------------------------------------------------------------------

function StreakTile({ icon, tint, label, value, unit, caption, best }: { icon: IconName; tint: string; label: string; value: string; unit: string; caption: string; best: number | null }) {
  return (
    <Card style={{ flex: 1, gap: 4, padding: space.md, backgroundColor: `${tint}14`, borderColor: `${tint}30` }}>
      <View accessible accessibilityLabel={`${label}: ${value} ${unit}. ${caption}${best !== null ? `. Best ${best}` : ''}`} style={{ gap: 4 }}>
        <Row gap={6}>
          <Ionicons name={icon} size={16} color={tint} />
          <AppText variant="label" color={colors.textMuted}>
            {label}
          </AppText>
        </Row>
        <Row gap={4} style={{ alignItems: 'baseline' }}>
          <AppText variant="number" style={{ fontSize: 26, lineHeight: 32 }}>
            {value}
          </AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {unit}
          </AppText>
        </Row>
        <AppText variant="caption" color={colors.textFaint} style={{ fontSize: 12, lineHeight: 16 }}>
          {caption}
          {best !== null && best > 0 ? ` · Best ${best}` : ''}
        </AppText>
      </View>
    </Card>
  );
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** Training, weekly consistency, nutrition and quest streaks — rest is part of every one. */
export function StreaksGrid({ streaks: s }: { streaks: Streaks }) {
  return (
    <View style={{ gap: space.sm }}>
      <Row gap={space.sm} style={{ alignItems: 'stretch' }}>
        <StreakTile
          icon="flame"
          tint={colors.accent}
          label="Training"
          value={String(s.workout.current)}
          unit={plural(s.workout.current, 'day', 'days')}
          caption={`Rest days in your plan keep it going`}
          best={s.workout.longest}
        />
        <StreakTile
          icon="calendar"
          tint={colors.primary}
          label="Weeks on plan"
          value={String(s.weekly.current)}
          unit={plural(s.weekly.current, 'week', 'weeks')}
          caption={s.weekly.metThisWeek ? 'This week: done' : `${s.weekly.target} days a week`}
          best={s.weekly.longest}
        />
      </Row>
      <Row gap={space.sm} style={{ alignItems: 'stretch' }}>
        <StreakTile
          icon="leaf"
          tint={colors.success}
          label="Nutrition"
          value={s.nutrition.available ? String(s.nutrition.current) : '—'}
          unit={s.nutrition.available ? plural(s.nutrition.current, 'day', 'days') : ''}
          caption={s.nutrition.available ? 'Finished days on target' : 'Set your body profile to track this'}
          best={s.nutrition.available ? s.nutrition.longest : null}
        />
        <StreakTile icon="flag" tint={colors.purple} label="Quests" value={String(s.quest.current)} unit={plural(s.quest.current, 'day', 'days')} caption="Days with a daily quest done" best={s.quest.longest} />
      </Row>
    </View>
  );
}

// ---- Records ------------------------------------------------------------------------------------

/** Records grouped: across all training first, then per exercise. */
export function RecordsList({ records, limit }: { records: PersonalRecord[]; limit?: number }) {
  const global = records.filter((r) => r.exerciseId === null);
  const perExercise = records.filter((r) => r.exerciseId !== null);
  const rows = [...global, ...perExercise].slice(0, limit ?? records.length);
  return (
    <Card style={{ paddingVertical: space.xs }}>
      {rows.map((r, i) => (
        <View key={`${r.exerciseId ?? '*'}:${r.kind}`}>
          {i > 0 ? <Divider /> : null}
          <Row style={{ minHeight: 60, paddingVertical: space.sm }} gap={space.md}>
            <View style={[styles.recordIcon, { backgroundColor: r.recent ? colors.accentSoft : colors.cardRaised }]}>
              <Ionicons name={r.exerciseId === null ? (r.kind === 'longest_streak' ? 'flame' : 'stats-chart') : 'trophy-outline'} size={18} color={r.recent ? colors.accent : colors.textMuted} />
            </View>
            <View style={{ flex: 1 }}>
              <AppText variant="bodyStrong">{r.exerciseName ?? r.label}</AppText>
              <AppText variant="caption" color={colors.textMuted}>
                {r.exerciseName ? r.label : 'Across all training'}
                {r.localDate ? ` · ${new Date(`${r.localDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}` : ''}
              </AppText>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 2 }}>
              <AppText variant="heading">{r.display}</AppText>
              {r.recent ? <Badge label="New" tone="accent" /> : null}
            </View>
          </Row>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  trackStep: { flex: 1, alignItems: 'center', gap: 4 },
  trackLine: { position: 'absolute', top: 14, right: '50%', width: '100%', height: 2 },
  trackNode: { width: 30, height: 30, borderRadius: 15, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  emblem: { width: 52, height: 52, borderRadius: 26, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  lock: { position: 'absolute', right: -3, bottom: -3, width: 20, height: 20, borderRadius: 10, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  history: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 84 },
  historyCol: { flex: 1, justifyContent: 'flex-end' },
  historyBar: { borderRadius: radius.sm },
  tile: { gap: space.sm },
  badge: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  recordIcon: { width: 40, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
});
