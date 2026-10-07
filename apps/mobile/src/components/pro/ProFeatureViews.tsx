import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, View } from 'react-native';
import { CoachCard } from '@/components/coach/CoachViews';
import { AppText, Badge, Card, Divider, InlineMessage, Row, Stat } from '@/components/ui';
import { formatWeight } from '@/lib/units';
import type { BodyQuestInsights, FormIntelligence, RestOfToday, WeeklyReportEntry } from '@/lib/types';
import { colors, space } from '@/theme/tokens';

/** Views for FORM Pro features. Every number is the server's, from the user's own records. */

const STAT_LABEL: Record<string, string> = { strength: 'Strength', muscle: 'Muscle', endurance: 'Endurance', mobility: 'Mobility', form: 'Form', consistency: 'Consistency' };
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const fmtDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function BodyQuestInsightsView({ insights }: { insights: BodyQuestInsights }) {
  return (
    <View style={{ gap: space.md }}>
      {insights.focus ? (
        <Card variant="raised" style={{ gap: space.xs, borderWidth: 1, borderColor: colors.primarySoft }}>
          <AppText variant="label" color={colors.primary}>
            Where effort pays most
          </AppText>
          <AppText variant="body">{insights.focus.lever}</AppText>
        </Card>
      ) : null}
      {insights.stats.map((s) => (
        <Card key={s.stat} style={{ gap: space.xs }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText variant="bodyStrong">{STAT_LABEL[s.stat] ?? s.stat}</AppText>
            <AppText variant="bodyStrong" color={s.value === null ? colors.textFaint : colors.text}>
              {s.value === null ? 'Not measured yet' : s.value}
            </AppText>
          </Row>
          {s.change4w !== null ? (
            <AppText variant="caption" color={s.change4w >= 0 ? colors.primary : colors.textMuted}>
              {signed(s.change4w)} over 4 weeks
            </AppText>
          ) : null}
          {s.history.some((h) => h.value !== null) ? (
            <AppText variant="caption" color={colors.textFaint} accessibilityLabel={`Weekly values: ${s.history.map((h) => `${fmtDay(h.weekStart)} ${h.value ?? 'not measured'}`).join(', ')}`}>
              Weekly: {s.history.slice(-6).map((h) => h.value ?? '–').join(' · ')}
            </AppText>
          ) : null}
          <AppText variant="caption" color={colors.textMuted}>
            {s.lever}
          </AppText>
        </Card>
      ))}
    </View>
  );
}

export function WeeklyReportView({ entry }: { entry: WeeklyReportEntry }) {
  const r = entry.report;
  const t = r.training;
  return (
    <View style={{ gap: space.md }}>
      <AppText variant="label" color={colors.textMuted}>
        {fmtDay(r.weekStart)} – {fmtDay(r.weekEnd)}
      </AppText>
      {r.empty ? (
        <InlineMessage tone="info">{`A quiet week — nothing logged. ${r.focus}`}</InlineMessage>
      ) : (
        <>
          <Row gap={space.sm}>
            <Stat label="Workouts" value={String(t.workouts)} unit={t.change ? `${signed(t.change.workouts)} vs last week` : undefined} />
            <Stat label="Verified reps" value={String(t.verifiedReps)} />
            <Stat label="Avg form" value={t.averageFormScore !== null ? String(t.averageFormScore) : '—'} />
          </Row>
          <Card style={{ gap: space.sm }}>
            <AppText variant="heading">This week</AppText>
            {r.highlights.map((h) => (
              <Row key={h} gap={space.sm} style={{ alignItems: 'flex-start' }}>
                <Ionicons name="checkmark" size={16} color={colors.primary} style={{ marginTop: 3 }} />
                <AppText variant="body" style={{ flex: 1 }}>
                  {h}
                </AppText>
              </Row>
            ))}
            <Divider />
            <AppText variant="label" color={colors.primary}>
              Focus for next week
            </AppText>
            <AppText variant="body">{r.focus}</AppText>
          </Card>
        </>
      )}
      {entry.coach ? <CoachCard response={entry.coach} title={`Coach note · ${fmtDay(entry.generatedAt.slice(0, 10))}, from your last 7 days`} /> : null}
    </View>
  );
}

export function FormIntelligenceView({ data, units }: { data: FormIntelligence; units: 'metric' | 'imperial' }) {
  if (data.reps === 0) {
    return <InlineMessage tone="info">No camera-verified reps of this exercise in this range yet. Track a set with the camera to build its form history.</InlineMessage>;
  }
  return (
    <View style={{ gap: space.md }}>
      {data.insights.map((i) => (
        <InlineMessage key={i} tone="info" icon="analytics-outline">
          {i}
        </InlineMessage>
      ))}
      <Card style={{ gap: space.xs }}>
        <AppText variant="heading">Sessions</AppText>
        {data.sessions
          .slice()
          .reverse()
          .map((s) => (
            <Row key={s.workoutId} style={{ justifyContent: 'space-between' }}>
              <AppText variant="body">{fmtDay(s.localDate)}</AppText>
              <AppText variant="caption" color={colors.textMuted}>
                {[s.topLoadKg > 0 ? formatWeight(s.topLoadKg, units) : null, `${s.verifiedReps} reps`, s.formScore !== null ? `form ${s.formScore}` : null, s.romPercent !== null ? `ROM ${s.romPercent}%` : null].filter(Boolean).join(' · ')}
              </AppText>
            </Row>
          ))}
      </Card>
      {data.byLoad.filter((l) => l.loadKg > 0).length > 1 ? (
        <Card style={{ gap: space.xs }}>
          <AppText variant="heading">Form by load</AppText>
          {data.byLoad
            .filter((l) => l.loadKg > 0)
            .map((l) => (
              <Row key={l.loadKg} style={{ justifyContent: 'space-between' }}>
                <AppText variant="body">{formatWeight(l.loadKg, units)}</AppText>
                <AppText variant="caption" color={colors.textMuted}>
                  {l.formScore !== null ? `form ${l.formScore}` : '—'} · {l.reps} reps
                </AppText>
              </Row>
            ))}
        </Card>
      ) : null}
      {data.issues.length ? (
        <Card style={{ gap: space.xs }}>
          <AppText variant="heading">Technique</AppText>
          {data.issues.map((i) => (
            <Row key={i.code} style={{ justifyContent: 'space-between' }}>
              <AppText variant="body">{i.label}</AppText>
              <Badge label={`${i.recentPercent}% of recent reps${i.change === 'fewer' ? ' · improving' : i.change === 'more' ? ' · more often' : ''}`} tone={i.change === 'fewer' ? 'primary' : i.change === 'more' ? 'warning' : 'neutral'} />
            </Row>
          ))}
          <AppText variant="caption" color={colors.textFaint}>
            From side-view camera checks — coaching cues, not a medical assessment.
          </AppText>
        </Card>
      ) : null}
    </View>
  );
}

export function RestOfTodayView({ suggestion: s, onOpenRecipe }: { suggestion: RestOfToday; onOpenRecipe: (recipeId: string) => void }) {
  if (s.done) return <InlineMessage tone="success">You&apos;re within about 150 kcal of today&apos;s target — nothing more to plan today.</InlineMessage>;
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="caption" color={colors.textMuted}>
        Left today: {s.remaining.kcal} kcal · {s.remaining.proteinG} g protein
      </AppText>
      {s.meals.map((m) => (
        <Pressable key={`${m.slot}-${m.recipeId}`} accessibilityRole="button" accessibilityLabel={`${m.slot}: ${m.title}, ${m.nutrients.kcal} kcal. Open recipe`} onPress={() => onOpenRecipe(m.recipeId)}>
          <Card style={{ gap: 2 }}>
            <AppText variant="label" color={colors.textMuted}>
              {m.slot[0]!.toUpperCase() + m.slot.slice(1)}
            </AppText>
            <AppText variant="bodyStrong">{m.title}</AppText>
            <AppText variant="caption" color={colors.textMuted}>
              {m.servings} serving{m.servings === 1 ? '' : 's'} · {m.nutrients.kcal} kcal · {m.nutrients.proteinG} g protein
            </AppText>
          </Card>
        </Pressable>
      ))}
      {s.warnings.map((w) => (
        <InlineMessage key={w} tone="info">
          {w}
        </InlineMessage>
      ))}
    </View>
  );
}
