import { Ionicons } from '@expo/vector-icons';
import { dayNumber, monthGrid, seasonMonths, seasonProgress, type SeasonProgress } from '@form/domain';
import { useMemo, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { ChestArt, FlameArt } from '@/components/art/StreakArt';
import { AppText, Badge, Card, IconButton, ProgressBar, Row } from '@/components/ui';
import type { Streaks } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** What each season chest is called, in milestone order. */
export const CHEST_NAMES = ['Spark chest', 'Kindle chest', 'Blaze chest', 'Inferno chest'] as const;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

/** The line under the streak number: how the streak is kept alive, from the engine's own rest rules. */
export function restLine(s: Pick<Streaks['workout'], 'current' | 'activeToday' | 'restDaysRemaining' | 'plannedRestDays'>): string {
  if (s.current === 0) return 'Train today to start a streak. Rest days in your plan never break it.';
  if (s.activeToday) return `Done today. Up to ${s.plannedRestDays} rest ${plural(s.plannedRestDays, 'day', 'days')} in a row keep it alive.`;
  if (s.restDaysRemaining === 0) return 'Train today to keep your streak going.';
  const n = s.restDaysRemaining ?? s.plannedRestDays;
  return `${n} rest ${plural(n, 'day', 'days')} left before it breaks.`;
}

/** The big streak number with the flame, the best streak and the rest-day protection. */
export function StreakHero({ streak }: { streak: Streaks['workout'] }) {
  const lit = streak.current > 0;
  return (
    <Card style={styles.hero}>
      <FlameArt lit={lit} size={132} />
      <View style={{ alignItems: 'center' }} accessible accessibilityLabel={`${streak.current} day streak`}>
        <AppText variant="display" color={lit ? colors.text : colors.textMuted}>
          {String(streak.current)}
        </AppText>
        <AppText variant="bodyStrong" color={colors.textMuted}>
          day streak
        </AppText>
      </View>
      <Row gap={space.sm} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
        <Badge label={`Best ${streak.longest}`} tone="accent" icon="trophy" />
        <Badge label={`${streak.plannedRestDays} rest ${plural(streak.plannedRestDays, 'day', 'days')} allowed`} tone="primary" icon="shield-checkmark" />
      </Row>
      <AppText variant="caption" color={colors.textMuted} style={{ textAlign: 'center' }}>
        {restLine(streak)}
      </AppText>
    </Card>
  );
}

const endsIn = (daysLeft: number) => (daysLeft === 0 ? 'Last day of the season' : `Season ends in ${daysLeft} ${plural(daysLeft, 'day', 'days')}`);

/** The season reward track: progress toward the next chest and the four chests, open or locked. */
export function SeasonTrack({ progress: p }: { progress: SeasonProgress }) {
  return (
    <Card style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <AppText variant="overline" color={colors.primary}>
            {`Season ${p.season.quarter} · ${p.season.year}`}
          </AppText>
          <AppText variant="bodyStrong">{`${p.days} training ${plural(p.days, 'day', 'days')} this season`}</AppText>
        </View>
        <Badge label={endsIn(p.daysLeft)} tone="neutral" icon="time" />
      </Row>
      <ProgressBar value={p.fractionToNext} color={colors.accent} label="Progress to the next season chest" />
      <AppText variant="caption" color={colors.textMuted}>
        {p.next ? `${p.next.remaining} more training ${plural(p.next.remaining, 'day', 'days')} for the next chest.` : 'Every chest is open. Season complete.'}
      </AppText>
      <View style={styles.chests}>
        {p.milestones.map((m, i) => (
          <View key={m.at} style={styles.chest} accessible accessibilityLabel={`${CHEST_NAMES[i]}, ${m.at} training days, ${m.reached ? 'opened' : 'locked'}`}>
            <ChestArt tier={i} open={m.reached} size={64} />
            <AppText variant="label" color={m.reached ? colors.text : colors.textFaint} style={{ textAlign: 'center' }}>
              {CHEST_NAMES[i]}
            </AppText>
            <AppText variant="caption" color={colors.textFaint}>
              {`${m.at} days`}
            </AppText>
          </View>
        ))}
      </View>
      <AppText variant="caption" color={colors.textFaint}>
        Chests are badges only. They come from counted, pain-free training days and never change your XP.
      </AppText>
    </Card>
  );
}

/** "Tuesday 14 October 2026" for a date key. */
export function longDate(key: string): string {
  const weekday = WEEKDAYS[(dayNumber(key) + 3) % 7]!;
  return `${weekday} ${Number(key.slice(8, 10))} ${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/** The accessibility label of one calendar day. */
export function dayLabel(key: string, today: string, trained: boolean): string {
  const state = key > today ? 'upcoming' : trained ? 'trained' : 'no workout';
  return `${longDate(key)}${key === today ? ', today' : ''}, ${state}`;
}

/** The season's three months, one at a time (arrows or a swipe), Monday first. */
export function SeasonCalendar({ progress: p, today, trainedDates }: { progress: SeasonProgress; today: string; trainedDates: readonly string[] }) {
  const months = seasonMonths(p.season);
  const todayMonth = months.findIndex((m) => m.slice(0, 7) === today.slice(0, 7));
  const [index, setIndex] = useState(todayMonth >= 0 ? todayMonth : 0);
  const trained = useMemo(() => new Set(trainedDates), [trainedDates]);
  const grid = monthGrid(months[index]!);
  const last = months.length - 1;

  // A swipe left or right turns the month (setState is stable, so the handlers never go stale).
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_e, g) => {
          if (g.dx < -40) setIndex((i) => Math.min(last, i + 1));
          else if (g.dx > 40) setIndex((i) => Math.max(0, i - 1));
        },
      }),
    [last],
  );

  const monthKey = months[index]!;
  const title = `${MONTHS[Number(monthKey.slice(5, 7)) - 1]} ${monthKey.slice(0, 4)}`;
  return (
    <Card style={{ gap: space.md }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <IconButton icon="chevron-back" label="Previous month" onPress={() => setIndex((i) => Math.max(0, i - 1))} color={index === 0 ? colors.border : colors.textMuted} />
        <AppText variant="bodyStrong" header>
          {title}
        </AppText>
        <IconButton icon="chevron-forward" label="Next month" onPress={() => setIndex((i) => Math.min(last, i + 1))} color={index === last ? colors.border : colors.textMuted} />
      </Row>
      <View style={styles.weekRow} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        {WEEKDAY_LETTERS.map((d, i) => (
          <AppText key={i} variant="label" color={colors.textFaint} style={styles.weekLetter}>
            {d}
          </AppText>
        ))}
      </View>
      <View style={{ gap: space.xs }} accessible={false} {...pan.panHandlers}>
        {grid.map((week, wi) => (
          <View key={wi} style={styles.weekRow}>
            {week.map((key, di) => {
              if (!key) return <View key={di} style={styles.cell} />;
              const done = trained.has(key);
              const isToday = key === today;
              const future = key > today;
              return (
                <View key={di} style={styles.cell}>
                  <View
                    accessible
                    accessibilityLabel={dayLabel(key, today, done)}
                    style={[styles.day, done && styles.dayDone, isToday && styles.dayToday, future && { opacity: 0.35 }]}>
                    {done ? (
                      <Ionicons name="flame" size={16} color={colors.onPrimary} />
                    ) : (
                      <AppText variant="label" color={isToday ? colors.text : colors.textMuted}>
                        {String(Number(key.slice(8, 10)))}
                      </AppText>
                    )}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </View>
    </Card>
  );
}

/** The whole Streak & Season screen body, from the streak data and the workout history. */
export function StreakSeasonView({ streaks, today, workouts }: { streaks: Streaks; today: string; workouts: readonly { localDate: string; painLevel: string }[] }) {
  const progress = useMemo(() => seasonProgress(workouts, today), [workouts, today]);
  const trainedDates = useMemo(() => workouts.filter((w) => w.painLevel !== 'serious').map((w) => w.localDate), [workouts]);
  return (
    <View style={{ gap: space.lg }}>
      <StreakHero streak={streaks.workout} />
      <SeasonTrack progress={progress} />
      <SeasonCalendar progress={progress} today={today} trainedDates={trainedDates} />
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
  chests: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  chest: { flex: 1, alignItems: 'center', gap: 2 },
  weekRow: { flexDirection: 'row' },
  weekLetter: { flex: 1, textAlign: 'center' },
  cell: { flex: 1, alignItems: 'center' },
  day: { width: 38, height: 38, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent' },
  dayDone: { backgroundColor: colors.accent },
  dayToday: { borderColor: colors.primary },
});
