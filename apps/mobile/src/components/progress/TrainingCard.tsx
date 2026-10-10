import { StyleSheet, View } from 'react-native';
import { AppText, Card, Row, StatStrip, WeekDays } from '@/components/ui';
import { trainingWeek } from '@/lib/week';
import { colors, radius, space } from '@/theme/tokens';

type W = { id: string; localDate: string; durationMinutes: number; xp: number };

const shortDay = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' });

/**
 * Your training at a glance: minutes across recent workouts, a bar for each session (oldest to
 * newest), and the days you've trained this week. Every number is a real workout.
 */
export function TrainingCard({ workouts, today }: { workouts: W[]; today: string }) {
  const recent = [...workouts].sort((a, b) => a.localDate.localeCompare(b.localDate)).slice(-10);
  const minutes = recent.reduce((n, w) => n + w.durationMinutes, 0);
  const max = Math.max(1, ...recent.map((w) => w.durationMinutes));
  const week = trainingWeek(
    workouts.map((w) => w.localDate),
    today,
  );
  return (
    <Card style={{ gap: space.lg }}>
      <View style={{ gap: 2 }}>
        <AppText variant="label" color={colors.textMuted}>
          {recent.length ? `Training time · last ${recent.length} ${recent.length === 1 ? 'workout' : 'workouts'}` : 'Training time'}
        </AppText>
        <Row gap={6} style={{ alignItems: 'baseline' }}>
          <AppText variant="display" style={{ fontVariant: ['tabular-nums'] }}>
            {minutes.toLocaleString()}
          </AppText>
          <AppText variant="bodyStrong" color={colors.textMuted}>
            min
          </AppText>
        </Row>
      </View>
      {recent.length ? (
        <View style={styles.chart} accessible accessibilityLabel={`Minutes per workout: ${recent.map((w) => w.durationMinutes).join(', ')}`}>
          {recent.map((w, i) => (
            <View key={w.id} style={styles.col}>
              <View style={[styles.bar, { height: `${Math.max(6, (w.durationMinutes / max) * 100)}%`, backgroundColor: i === recent.length - 1 ? colors.primary : `${colors.primary}88` }]} />
              <AppText variant="label" color={colors.textFaint} style={{ fontSize: 12 }}>
                {shortDay(w.localDate)}
              </AppText>
            </View>
          ))}
        </View>
      ) : (
        <AppText variant="caption" color={colors.textMuted}>
          Finish a workout and your training time shows up here.
        </AppText>
      )}
      <WeekDays trained={week.trained} todayIndex={week.todayIndex} />
      <StatStrip
        variant="flat"
        items={[
          { label: 'This week', value: String(week.trained.filter(Boolean).length), unit: 'days' },
          { label: 'Workouts', value: String(workouts.length) },
          { label: 'XP', value: workouts.reduce((n, w) => n + w.xp, 0).toLocaleString(), tint: colors.accent },
        ]}
      />
    </Card>
  );
}

const styles = StyleSheet.create({
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 130 },
  col: { flex: 1, height: '100%', justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  bar: { width: '100%', maxWidth: 26, borderRadius: radius.sm, minHeight: 6 },
});
