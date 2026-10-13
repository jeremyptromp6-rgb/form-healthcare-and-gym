import { AppText, Card, StatStrip, WeekDays } from '@/components/ui';
import { localDateKey } from '@/lib/dates';
import { trainingWeek } from '@/lib/week';
import { colors, space } from '@/theme/tokens';

/** The Monday-first week containing `today`, as first and last date keys. */
export function weekBounds(today: string): { first: string; last: string } {
  const t = new Date(`${today}T12:00:00Z`);
  const offset = (t.getUTCDay() + 6) % 7;
  const at = (days: number) => new Date(t.getTime() + days * 86_400_000).toISOString().slice(0, 10);
  return { first: at(-offset), last: at(6 - offset) };
}

/** This week at a glance: the days you trained, then totals across this week's workouts only. */
export function WeekSummary({ workouts, today = localDateKey() }: { workouts: { localDate: string; durationMinutes: number; xp: number }[]; today?: string }) {
  const { first, last } = weekBounds(today);
  // The list holds the latest workouts, not just this week's; older ones must not count here.
  const thisWeek = workouts.filter((w) => w.localDate >= first && w.localDate <= last);
  const week = trainingWeek(
    thisWeek.map((w) => w.localDate),
    today,
  );
  const minutes = thisWeek.reduce((n, w) => n + w.durationMinutes, 0);
  const xp = thisWeek.reduce((n, w) => n + w.xp, 0);
  return (
    <Card style={{ gap: space.lg }}>
      <AppText variant="overline" color={colors.primary}>
        This week
      </AppText>
      <WeekDays trained={week.trained} todayIndex={week.todayIndex} />
      <StatStrip
        items={[
          { label: 'Workouts', value: String(thisWeek.length) },
          { label: 'Minutes', value: minutes.toLocaleString() },
          { label: 'XP', value: xp.toLocaleString(), tint: colors.accent },
        ]}
      />
    </Card>
  );
}
