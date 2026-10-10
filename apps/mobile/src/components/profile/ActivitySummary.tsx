import { View } from 'react-native';
import { AppText, Card, Divider, StatStrip } from '@/components/ui';
import type { ProfileSummaryStats } from '@/lib/types';
import { colors, space } from '@/theme/tokens';

/** Workouts over the last 30 days and food over the last 7 — the same numbers Progress shows. */
export function ActivitySummary({ s }: { s: ProfileSummaryStats }) {
  const w = s.workouts;
  const n = s.nutrition;
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ gap: space.sm }}>
        <AppText variant="label" color={colors.textMuted}>
          Training · last {w.rangeDays} days
        </AppText>
        <StatStrip
          variant="flat"
          items={[
            { label: 'Workouts', value: String(w.workouts) },
            { label: 'Minutes', value: w.minutes.toLocaleString() },
            { label: 'Verified reps', value: w.verifiedReps.toLocaleString() },
          ]}
        />
        <AppText variant="caption" color={colors.textFaint}>
          {w.adherencePercent !== null ? `${w.trainingDays} training days · ${w.adherencePercent}% of your plan` : `${w.trainingDays} training days`}
          {s.recordsBeaten ? ` · ${s.recordsBeaten} ${s.recordsBeaten === 1 ? 'record' : 'records'} beaten all time` : ''}
        </AppText>
      </View>
      <Divider />
      <View style={{ gap: space.sm }}>
        <AppText variant="label" color={colors.textMuted}>
          Food · last {n.rangeDays} days
        </AppText>
        {n.daysLogged === 0 ? (
          <AppText variant="caption" color={colors.textMuted}>
            Nothing logged this week.
          </AppText>
        ) : (
          <>
            <StatStrip
              variant="flat"
              items={[
                { label: 'Days logged', value: String(n.daysLogged) },
                { label: 'On target', value: n.hasTargets ? String(n.daysOnTarget) : '—' },
                { label: 'Avg kcal', value: n.averageKcal !== null ? n.averageKcal.toLocaleString() : '—' },
              ]}
            />
            {n.estimatedPercent ? (
              <AppText variant="caption" color={colors.textFaint}>
                {n.estimatedPercent}% of logged calories are estimates.
              </AppText>
            ) : null}
          </>
        )}
      </View>
    </Card>
  );
}
