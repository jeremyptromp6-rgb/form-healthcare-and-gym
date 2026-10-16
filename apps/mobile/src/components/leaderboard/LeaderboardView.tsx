import Ionicons from '@expo/vector-icons/Ionicons';
import { View } from 'react-native';
import { PodiumMedal, type Podium } from '@/components/art/PodiumMedal';
import { RankEmblem } from '@/components/art/RankEmblem';
import { AppText, Button, Card, InlineMessage, Row, SectionHeader, Segmented, StateView } from '@/components/ui';
import type { Leaderboard, LeaderboardEntry, LeaderboardPeriod, LeaderboardYou } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

const PERIODS: { value: LeaderboardPeriod; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
  { value: 'all', label: 'All time' },
];
const PERIOD_UNIT: Record<LeaderboardPeriod, string> = { today: 'XP today', week: 'XP this week', all: 'XP' };
const EMPTY_COPY: Record<LeaderboardPeriod, string> = {
  today: 'Nobody has earned XP today yet. Finish a workout or log your meals and you could be first.',
  week: 'Nobody has earned XP this week yet. Finish a workout or log your meals and you could be first.',
  all: 'Nobody has earned XP yet. Finish a workout and you could be first.',
};

export type LeaderboardState = { kind: 'loading' } | { kind: 'unsupported' } | { kind: 'error'; onRetry: () => void } | { kind: 'ok'; board: Leaderboard };

const fmt = (n: number) => Math.round(n).toLocaleString();

/** "7. Athlete #AB12C, Starter, 340 XP this week" — one sentence per row for screen readers. */
export const entryLabel = (e: Pick<LeaderboardEntry, 'position' | 'name' | 'rankLabel' | 'points' | 'isYou'>, period: LeaderboardPeriod) =>
  `${e.position}. ${e.isYou ? 'You, ' : ''}${e.name}, ${e.rankLabel}, ${fmt(e.points)} ${PERIOD_UNIT[period]}`;

function PodiumColumn({ entry, place, period }: { entry: LeaderboardEntry; place: Podium; period: LeaderboardPeriod }) {
  // First place stands tallest: the others sit lower.
  const drop = place === 1 ? 0 : place === 2 ? space.lg : space.xl;
  return (
    <View
      accessible
      accessibilityLabel={entryLabel({ ...entry, position: place }, period)}
      style={{ flex: 1, alignItems: 'center', gap: space.xs, marginTop: drop, paddingHorizontal: space.xs }}>
      <PodiumMedal place={place} size={place === 1 ? 84 : 68} />
      <RankEmblem rank={entry.rank} size={place === 1 ? 40 : 32} prestige={entry.prestige} />
      <AppText variant="bodyStrong" numberOfLines={2} style={{ textAlign: 'center' }} color={entry.isYou ? colors.primary : undefined}>
        {entry.isYou ? `${entry.name} (you)` : entry.name}
      </AppText>
      <AppText variant="label" color={colors.textMuted} style={{ fontVariant: ['tabular-nums'] }}>
        {`${fmt(entry.points)} XP`}
      </AppText>
    </View>
  );
}

/** The top three: 2nd, 1st, 3rd, so the winner stands in the middle. */
export function Podiums({ entries, period }: { entries: LeaderboardEntry[]; period: LeaderboardPeriod }) {
  const top = entries.slice(0, 3);
  const order: Podium[] = top.length >= 3 ? [2, 1, 3] : top.length === 2 ? [2, 1] : [1];
  return (
    <Card style={{ paddingVertical: space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        {order.map((place) => (
          <PodiumColumn key={place} entry={top[place - 1]!} place={place} period={period} />
        ))}
      </View>
    </Card>
  );
}

/** One place on the board. `you` highlights the caller's own row. */
export function LeaderboardRow({ entry, period }: { entry: Pick<LeaderboardEntry, 'position' | 'name' | 'anonymous' | 'isYou' | 'points' | 'rank' | 'rankLabel' | 'prestige'>; period: LeaderboardPeriod }) {
  return (
    <View
      accessible
      accessibilityLabel={entryLabel(entry, period)}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        paddingVertical: space.sm,
        paddingHorizontal: space.md,
        borderRadius: radius.md,
        backgroundColor: entry.isYou ? colors.primarySoft : undefined,
      }}>
      <AppText variant="bodyStrong" color={entry.isYou ? colors.primary : colors.textMuted} style={{ width: 34, textAlign: 'center', fontVariant: ['tabular-nums'] }}>
        {entry.position}
      </AppText>
      <RankEmblem rank={entry.rank} size={34} prestige={entry.prestige} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body" numberOfLines={1} color={entry.isYou ? colors.primary : undefined}>
          {entry.isYou ? `${entry.name} (you)` : entry.name}
        </AppText>
        <AppText variant="caption" color={colors.textMuted}>
          {entry.rankLabel}
        </AppText>
      </View>
      <AppText variant="bodyStrong" style={{ fontVariant: ['tabular-nums'] }}>
        {fmt(entry.points)}
      </AppText>
    </View>
  );
}

/** Your own place, always visible: inside the list it is highlighted; outside the top 50 it is pinned after it. */
function YourPlace({ you, period }: { you: LeaderboardYou; period: LeaderboardPeriod }) {
  if (you.position === null) {
    return (
      <InlineMessage tone="info" icon="flash-outline">
        {period === 'today' ? 'Earn XP today to join the board.' : period === 'week' ? 'Earn XP this week to join the board.' : 'Earn your first XP to join the board.'}
      </InlineMessage>
    );
  }
  return <LeaderboardRow entry={{ ...you, position: you.position, isYou: true }} period={period} />;
}

/** The leaderboard: period switch, top-3 podium, ranked rows, and the caller's own place pinned below when it is outside the list. */
export function LeaderboardView({
  period,
  onPeriodChange,
  state,
  onOpenSettings,
}: {
  period: LeaderboardPeriod;
  onPeriodChange: (p: LeaderboardPeriod) => void;
  state: LeaderboardState;
  onOpenSettings?: () => void;
}) {
  const board = state.kind === 'ok' ? state.board : null;
  const listed = board?.entries ?? [];
  const youListed = listed.some((e) => e.isYou);
  return (
    <View style={{ gap: space.lg }}>
      <Segmented options={PERIODS} value={period} onChange={onPeriodChange} label="Leaderboard period" />

      {state.kind === 'loading' ? <StateView kind="loading" compact /> : null}
      {state.kind === 'unsupported' ? (
        <StateView kind="empty" compact title="Leaderboards are coming soon" message="FORM is updating. Check back soon and the board will be here." />
      ) : null}
      {state.kind === 'error' ? <StateView kind="error" compact title="Couldn't load the leaderboard" message="Check your connection and try again." actionLabel="Try again" onAction={state.onRetry} /> : null}

      {board ? (
        listed.length === 0 ? (
          <View style={{ gap: space.md }}>
            <StateView kind="empty" compact title="No one on the board yet" message={EMPTY_COPY[period]} />
            <YourPlace you={board.you} period={period} />
          </View>
        ) : (
          <>
            <Podiums entries={listed} period={period} />
            {listed.length > 3 ? (
              <View style={{ gap: space.xs }}>
                {listed.slice(3).map((e) => (
                  <LeaderboardRow key={`${e.position}-${e.name}`} entry={e} period={period} />
                ))}
              </View>
            ) : null}
            {youListed ? null : (
              <View style={{ gap: space.sm }}>
                <SectionHeader title="Your place" />
                <YourPlace you={board.you} period={period} />
              </View>
            )}
            <AppText variant="caption" color={colors.textFaint} style={{ textAlign: 'center' }}>
              {`${fmt(board.totalRanked)} ${board.totalRanked === 1 ? 'person' : 'people'} earned XP ${period === 'all' ? 'so far' : period === 'today' ? 'today' : 'this week'}. Points are XP earned from verified training and logged food.`}
            </AppText>
          </>
        )
      ) : null}

      <Card style={{ gap: space.sm }}>
        <Row gap={space.sm}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
          <AppText variant="bodyStrong">Your privacy</AppText>
        </Row>
        <AppText variant="caption" color={colors.textMuted}>
          {
            'You appear as “Athlete #code” unless you choose to show your name. Only a name, rank and points are ever shown: no photo, email or details. You can change this any time.'
          }
        </AppText>
        {onOpenSettings ? <Button label="Choose how you appear" variant="secondary" onPress={onOpenSettings} /> : null}
      </Card>
    </View>
  );
}
