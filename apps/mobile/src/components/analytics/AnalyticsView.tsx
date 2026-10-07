import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Badge, Card, Divider, Row, Segmented, SectionHeader, Stat } from '@/components/ui';
import { ProUpsell } from '@/components/pro/ProViews';
import type { AnalyticsRange, AnalyticsSectionId, ChartModel, PeriodSummary, PremiumFeatureId, ProgressAnalytics } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';
import { Chart, TrendBadge } from './Chart';

export interface AnalyticsViewProps {
  analytics: ProgressAnalytics;
  range: AnalyticsRange;
  onRange: (r: AnalyticsRange) => void;
  exercise: string | null;
  onExercise: (id: string | null) => void;
  /** A newer range is loading (the previous one stays on screen). */
  updating?: boolean;
  /** Opens FORM Pro for a section the server locked. */
  onPro?: (feature: PremiumFeatureId) => void;
}

const RANGES: { value: '7' | '30' | '90'; label: string }[] = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];

const fmtDate = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const unitText = (u: string) => (u === 'score' ? '' : u === '%' ? '%' : ` ${u}`);

/** A section card: title, goal relevance, the plain reading, then whatever the section shows. */
function SectionCard({ title, focus, interpretation, trend, children }: { title: string; focus: boolean; interpretation: string | null; trend?: ChartModel; children: React.ReactNode }) {
  return (
    <Card style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between', flexWrap: 'wrap' }} gap={space.sm}>
        <AppText variant="heading">{title}</AppText>
        {focus ? <Badge label="Key for your goal" tone="primary" icon="flag-outline" /> : null}
      </Row>
      {trend ? <TrendBadge trend={trend.trend} unit={trend.trendUnit} /> : null}
      {interpretation ? (
        <AppText variant="caption" color={colors.textMuted}>
          {interpretation}
        </AppText>
      ) : null}
      {children}
    </Card>
  );
}

function Unavailable({ title, message }: { title: string; message: string }) {
  return (
    <Card style={{ gap: space.xs }}>
      <AppText variant="heading">{title}</AppText>
      <AppText variant="caption" color={colors.textMuted}>
        {message}
      </AppText>
    </Card>
  );
}

function Summaries({ title, rows }: { title: string; rows: PeriodSummary[] }) {
  const label = (s: PeriodSummary) => (title === 'By month' ? new Date(`${s.key}T12:00:00`).toLocaleDateString(undefined, { month: 'long' }) : title === 'By week' ? `Week of ${fmtDate(s.key)}` : new Date(`${s.key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' }));
  return (
    <Card style={{ paddingVertical: space.xs }}>
      {rows.map((s, i) => (
        <View key={s.key}>
          {i > 0 ? <Divider /> : null}
          <View style={{ paddingVertical: space.sm, gap: 2 }} accessible>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText variant="bodyStrong">{label(s)}</AppText>
              {s.partial ? (
                <AppText variant="caption" color={colors.textFaint}>
                  so far
                </AppText>
              ) : null}
            </Row>
            <AppText variant="caption" color={colors.textMuted}>
              {s.hasData
                ? [
                    `${s.trainingDays} training ${s.trainingDays === 1 ? 'day' : 'days'}`,
                    s.verifiedReps ? `${s.verifiedReps} verified reps` : null,
                    s.averageForm !== null ? `form ${s.averageForm}` : null,
                    s.daysLogged ? `${s.daysLogged} ${s.daysLogged === 1 ? 'day' : 'days'} of food, avg ${s.averageKcal?.toLocaleString()} kcal` : null,
                    s.xpEarned ? `+${s.xpEarned} XP` : null,
                    s.prs ? `${s.prs} ${s.prs === 1 ? 'record' : 'records'}` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'Nothing logged'}
            </AppText>
          </View>
        </View>
      ))}
    </Card>
  );
}

/** Progress analytics: every section from real records, in order of relevance to the user's goal. */
export function AnalyticsView({ analytics: a, range, onRange, exercise, onExercise, updating, onPro }: AnalyticsViewProps) {
  const sections: Record<AnalyticsSectionId, React.ReactNode> = {
    strength: a.strength.available && a.strength.data.selected ? (
      <SectionCard key="strength" title="Strength" focus={a.strength.focus} interpretation={a.strength.interpretation} trend={a.strength.data.selected.chart}>
        <ExerciseFilter exercises={a.strength.data.exercises} selected={exercise ?? a.strength.data.selected.exerciseId} onSelect={onExercise} />
        <AppText variant="caption" color={colors.textMuted}>
          {a.strength.data.selected.measure === 'estimated_1rm' ? 'Best estimated one-rep max per day, from camera-verified sets.' : 'Most verified reps in a set, per day.'}
        </AppText>
        <Chart chart={a.strength.data.selected.chart} />
      </SectionCard>
    ) : (
      <Unavailable key="strength" title="Strength" message={exercise ? 'No camera-verified sets of this exercise in this range.' : 'Strength trends come from camera-verified sets. Verify a few sets to see your progress here.'} />
    ),
    form: a.form.locked ? (
      <ProUpsell key="form" feature={a.form.locked.feature} title={a.form.locked.title} pro={a.form.locked.pro} onOpen={(f) => onPro?.(f)} />
    ) : a.form.available ? (
      <SectionCard key="form" title="Form" focus={a.form.focus} interpretation={a.form.interpretation} trend={a.form.data.chart}>
        <Row gap={space.sm}>
          <Stat label="Average form" value={a.form.data.averageScore !== null ? String(a.form.data.averageScore) : '—'} />
          <Stat label="Verified reps" value={String(a.form.data.reps)} />
        </Row>
        <Chart chart={a.form.data.chart} />
      </SectionCard>
    ) : null,
    rom: a.rom.locked ? (
      <ProUpsell key="rom" feature={a.rom.locked.feature} title={a.rom.locked.title} pro={a.rom.locked.pro} onOpen={(f) => onPro?.(f)} compact />
    ) : a.rom.available ? (
      <SectionCard key="rom" title="Range of motion" focus={a.rom.focus} interpretation={a.rom.interpretation} trend={a.rom.data.chart}>
        <Chart chart={a.rom.data.chart} />
      </SectionCard>
    ) : null,
    verified_reps: a.verifiedReps.available ? (
      <SectionCard key="verified_reps" title="Verified reps" focus={a.verifiedReps.focus} interpretation={null}>
        <AppText variant="number">{a.verifiedReps.data.total.toLocaleString()}</AppText>
        <Chart chart={a.verifiedReps.data.chart} />
      </SectionCard>
    ) : null,
    consistency: (
      <SectionCard key="consistency" title="Consistency" focus={a.consistency.focus} interpretation={a.consistency.interpretation} trend={a.consistency.data.chart}>
        <Row gap={space.sm}>
          <Stat label="Training days" value={String(a.consistency.data.trainingDays)} />
          <Stat label="Of your plan" value={a.consistency.data.adherencePercent !== null ? `${a.consistency.data.adherencePercent}%` : '—'} />
        </Row>
        <Chart chart={a.consistency.data.chart} />
        <AppText variant="caption" color={colors.textFaint}>
          Rest days in your plan are part of it — more than planned doesn&apos;t score higher.
        </AppText>
      </SectionCard>
    ),
    nutrition: a.nutrition.available ? (
      <SectionCard key="nutrition" title="Nutrition" focus={a.nutrition.focus} interpretation={a.nutrition.interpretation} trend={a.nutrition.data.kcalChart}>
        <Row gap={space.sm}>
          <Stat label="Days logged" value={String(a.nutrition.data.daysLogged)} />
          <Stat label="On target" value={a.nutrition.data.hasTargets ? String(a.nutrition.data.daysOnTarget) : '—'} />
          <Stat label="Protein met" value={a.nutrition.data.hasTargets ? String(a.nutrition.data.daysMeetingProtein) : '—'} />
        </Row>
        <Chart chart={a.nutrition.data.kcalChart} />
        <AppText variant="label" color={colors.textMuted}>
          Protein (g)
        </AppText>
        <Chart chart={a.nutrition.data.proteinChart} height={90} />
        {a.nutrition.data.estimatedPercent !== null ? (
          <AppText variant="caption" color={colors.textFaint}>
            {`${a.nutrition.data.measuredPercent}% of calories weighed, ${a.nutrition.data.estimatedPercent}% estimated. Today is judged once it ends.`}
          </AppText>
        ) : null}
        {a.nutrition.data.daysBelowSafeMinimum > 0 ? (
          <AppText variant="caption" color={colors.warning}>
            {`${a.nutrition.data.daysBelowSafeMinimum} ${a.nutrition.data.daysBelowSafeMinimum === 1 ? 'day' : 'days'} below your safe minimum — eating enough comes first.`}
          </AppText>
        ) : null}
      </SectionCard>
    ) : (
      <Unavailable key="nutrition" title="Nutrition" message="No food logged in this range." />
    ),
    weight: a.weight.available ? (
      <SectionCard key="weight" title="Weight" focus={a.weight.focus} interpretation={a.weight.interpretation} trend={a.weight.data.chart}>
        {a.weight.data.latest !== null ? (
          <AppText variant="caption" color={colors.textMuted}>
            {`Latest: ${a.weight.data.latest}${unitText(a.weight.data.chart.unit)} on ${fmtDate(a.weight.data.latestDate!)} · ${a.weight.data.entries} ${a.weight.data.entries === 1 ? 'entry' : 'entries'}`}
          </AppText>
        ) : null}
        <Chart chart={a.weight.data.chart} />
        <AppText variant="caption" color={colors.textFaint}>
          Weight changes for many reasons day to day; trends over weeks say more than any single day.
        </AppText>
      </SectionCard>
    ) : null,
    xp: a.xp.available ? (
      <SectionCard key="xp" title="XP & level" focus={a.xp.focus} interpretation={a.xp.interpretation} trend={a.xp.data.chart}>
        <AppText variant="caption" color={colors.textFaint}>
          The trend compares XP earned per week; the line shows your level&apos;s XP day by day.
        </AppText>
        <Row gap={space.sm}>
          <Stat label="Earned" value={`+${a.xp.data.earned.toLocaleString()}`} unit="XP" />
          <Stat label="Level" value={String(a.xp.data.level)} unit={a.xp.data.rank} />
        </Row>
        <Chart chart={a.xp.data.chart} />
        {a.xp.data.levelUps.length ? (
          <AppText variant="caption" color={colors.textMuted}>
            {a.xp.data.levelUps.map((l) => `Level ${l.level} on ${fmtDate(l.date)}`).join(' · ')}
          </AppText>
        ) : null}
        {a.xp.data.resets.length ? (
          <AppText variant="caption" color={colors.textFaint}>
            {`Fresh start on ${a.xp.data.resets.map(fmtDate).join(', ')} — history kept.`}
          </AppText>
        ) : null}
      </SectionCard>
    ) : null,
    prs: a.prs.available ? (
      <SectionCard key="prs" title="Personal records" focus={a.prs.focus} interpretation={null}>
        {a.prs.data.records.slice(0, 8).map((r, i) => (
          <Row key={i} style={{ justifyContent: 'space-between' }} gap={space.sm}>
            <View style={{ flex: 1 }}>
              <AppText variant="body">{r.exercise}</AppText>
              <AppText variant="caption" color={colors.textMuted}>
                {r.label} · {fmtDate(r.date)}
                {r.beaten ? '' : ' · first record'}
              </AppText>
            </View>
            <AppText variant="bodyStrong" color={r.beaten ? colors.accent : colors.text}>
              {r.display}
              {r.previousDisplay ? <AppText variant="caption" color={colors.textFaint}>{` (was ${r.previousDisplay})`}</AppText> : null}
            </AppText>
          </Row>
        ))}
      </SectionCard>
    ) : null,
    body_quest: a.bodyQuest.available ? (
      <SectionCard key="body_quest" title="Body Quest" focus={a.bodyQuest.focus} interpretation={a.bodyQuest.interpretation} trend={a.bodyQuest.data.chart}>
        <AppText variant="caption" color={colors.textMuted}>
          {`Now: ${a.bodyQuest.data.stage.charAt(0).toUpperCase()}${a.bodyQuest.data.stage.slice(1)}${a.bodyQuest.data.overall !== null ? ` · overall ${a.bodyQuest.data.overall}` : ''}`}
        </AppText>
        <Chart chart={a.bodyQuest.data.chart} height={90} />
      </SectionCard>
    ) : null,
    quests: a.quests.available ? (
      <SectionCard key="quests" title="Quests" focus={a.quests.focus} interpretation={null}>
        <AppText variant="caption" color={colors.textMuted}>
          {`${a.quests.data.completed} completed · ${a.quests.data.daily} daily, ${a.quests.data.weekly} weekly`}
        </AppText>
        {a.quests.data.history.slice(0, 6).map((q, i) => (
          <Row key={i} style={{ justifyContent: 'space-between' }}>
            <AppText variant="body" style={{ flex: 1 }}>
              {q.title}
            </AppText>
            <AppText variant="caption" color={colors.textFaint}>
              {q.cadence === 'weekly' ? `wk of ${fmtDate(q.period)}` : fmtDate(q.period)}
            </AppText>
          </Row>
        ))}
      </SectionCard>
    ) : null,
  };

  return (
    <View style={{ gap: space.lg, opacity: updating ? 0.6 : 1 }}>
      <Segmented options={RANGES} value={String(range) as '7' | '30' | '90'} onChange={(v) => onRange(Number(v) as AnalyticsRange)} label="Range" />
      <AppText variant="caption" color={colors.textFaint}>
        {`${fmtDate(a.range.from)} – ${fmtDate(a.range.to)} · your time zone (${a.range.timezone})`}
      </AppText>
      {a.order.map((id) => sections[id])}

      {a.achievements.unlocked.length ? (
        <Card style={{ gap: space.xs }}>
          <AppText variant="heading">Achievements this period</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            {a.achievements.unlocked.map((x) => `${x.title} (${fmtDate(x.date)})`).join(' · ')}
          </AppText>
        </Card>
      ) : null}

      {a.summaries.daily ? (
        <>
          <SectionHeader title="By day" />
          <Summaries title="By day" rows={a.summaries.daily} />
        </>
      ) : null}
      {a.summaries.weekly ? (
        <>
          <SectionHeader title="By week" />
          <Summaries title="By week" rows={[...a.summaries.weekly].reverse()} />
        </>
      ) : null}
      {a.summaries.monthly ? (
        <>
          <SectionHeader title="By month" />
          <Summaries title="By month" rows={[...a.summaries.monthly].reverse()} />
        </>
      ) : null}
      <AppText variant="caption" color={colors.textFaint}>
        Everything here comes from what you logged and the camera verified. FORM doesn&apos;t estimate body composition or compare you with other people.
      </AppText>
    </View>
  );
}

function ExerciseFilter({ exercises, selected, onSelect }: { exercises: ProgressAnalytics['strength']['data']['exercises']; selected: string; onSelect: (id: string | null) => void }) {
  if (exercises.length <= 1) return null;
  return (
    <View style={styles.chips} accessibilityLabel="Exercise">
      {exercises.map((e) => {
        const on = e.exerciseId === selected;
        return (
          <Pressable key={e.exerciseId} accessibilityRole="button" accessibilityState={{ selected: on }} aria-selected={on} onPress={() => onSelect(e.exerciseId)} style={[styles.chip, on && styles.chipOn]}>
            <AppText variant="caption" color={on ? colors.primary : colors.textMuted}>
              {e.name}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: space.xs, minHeight: 32, justifyContent: 'center' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
});
