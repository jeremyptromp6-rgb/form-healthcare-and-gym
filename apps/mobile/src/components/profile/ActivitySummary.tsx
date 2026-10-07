import { View } from 'react-native';
import { AppText, Card, Row, Stat } from '@/components/ui';
import type { ProfileSummaryStats } from '@/lib/types';
import { colors, space } from '@/theme/tokens';

/** Workouts over the last 30 days and food over the last 7 — the same numbers Progress shows. */
export function ActivitySummary({ s }: { s: ProfileSummaryStats }) {
  const w = s.workouts;
  const n = s.nutrition;
  return (
    <View style={{ gap: space.sm }}>
      <Card style={{ gap: space.sm }}>
        <AppText variant="label" color={colors.textMuted}>
          Training · last {w.rangeDays} days
        </AppText>
        <Row gap={space.sm}>
          <Stat label="Workouts" value={String(w.workouts)} />
          <Stat label="Minutes" value={w.minutes.toLocaleString()} />
          <Stat label="Verified reps" value={w.verifiedReps.toLocaleString()} />
        </Row>
        <AppText variant="caption" color={colors.textFaint}>
          {w.adherencePercent !== null ? `${w.trainingDays} training days · ${w.adherencePercent}% of your plan` : `${w.trainingDays} training days`}
          {s.recordsBeaten ? ` · ${s.recordsBeaten} ${s.recordsBeaten === 1 ? 'record' : 'records'} beaten all time` : ''}
        </AppText>
      </Card>
      <Card style={{ gap: space.sm }}>
        <AppText variant="label" color={colors.textMuted}>
          Food · last {n.rangeDays} days
        </AppText>
        {n.daysLogged === 0 ? (
          <AppText variant="caption" color={colors.textMuted}>
            Nothing logged this week.
          </AppText>
        ) : (
          <>
            <Row gap={space.sm}>
              <Stat label="Days logged" value={String(n.daysLogged)} />
              <Stat label="On target" value={n.hasTargets ? String(n.daysOnTarget) : '—'} />
              <Stat label="Avg kcal" value={n.averageKcal !== null ? n.averageKcal.toLocaleString() : '—'} />
            </Row>
            {n.estimatedPercent ? (
              <AppText variant="caption" color={colors.textFaint}>
                {n.estimatedPercent}% of logged calories are estimates.
              </AppText>
            ) : null}
          </>
        )}
      </Card>
    </View>
  );
}
