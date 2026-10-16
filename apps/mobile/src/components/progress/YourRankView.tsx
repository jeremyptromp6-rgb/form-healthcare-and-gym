import Ionicons from '@expo/vector-icons/Ionicons';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { rankColor } from '@/components/art/RankEmblem';
import { Chart } from '@/components/analytics/Chart';
import { RankEmblem } from '@/components/progress/ProgressionViews';
import { AppText, BreathingGlow, Button, Card, ExerciseList, GradientCard, InlineMessage, ListRow, ProgressBar, Row, Segmented, SectionHeader } from '@/components/ui';
import { rankChart, xpChange, xpTimeline, type RankRange } from '@/lib/rankHistory';
import { rankLabel } from '@/lib/prestige';
import type { Progress, Standing, XpLedgerEntry } from '@/lib/types';
import { colors, gradients, space } from '@/theme/tokens';

const fmt = (n: number) => Math.round(n).toLocaleString();

/** Where the user is inside their current rank, from the rank ladder (XP is total active XP, the same number that sets the level). */
export function rankProgress(p: Pick<Progress, 'totalXp' | 'rank' | 'rankLadder'> & Pick<Progress, 'prestige' | 'xpIntoStep' | 'xpForStep' | 'prestigeAtXp'>) {
  const i = Math.max(0, p.rankLadder.findIndex((r) => r.name === p.rank));
  const current = p.rankLadder[i];
  const next = p.rankLadder[i + 1] ?? null;
  const from = current?.xpRequired ?? 0;
  const into = Math.max(0, p.totalXp - from);
  const span = next ? Math.max(1, next.xpRequired - from) : 0;
  return { into, span, next, toNext: next ? Math.max(0, next.xpRequired - p.totalXp) : 0, fraction: next ? Math.min(1, into / span) : 1, endless: endlessStep(p, from, into) };
}

/** Past the last rank the climb never ends: the run to Champion 1, then each Champion step after it. */
function endlessStep(p: Pick<Progress, 'totalXp' | 'prestige' | 'xpIntoStep' | 'xpForStep' | 'prestigeAtXp'>, from: number, into: number) {
  if (p.prestige != null && p.prestige > 0 && (p.xpForStep ?? 0) > 0) {
    const span = p.xpForStep as number;
    const done = Math.min(span, Math.max(0, p.xpIntoStep ?? 0));
    return { name: rankLabel('Champion', p.prestige), nextName: rankLabel('Champion', p.prestige + 1), into: done, span, toNext: span - done, fraction: done / span };
  }
  if (p.prestigeAtXp != null && p.prestigeAtXp > from && p.totalXp < p.prestigeAtXp) {
    const span = p.prestigeAtXp - from;
    return { name: 'Champion', nextName: rankLabel('Champion', 1), into, span, toNext: p.prestigeAtXp - p.totalXp, fraction: Math.min(1, into / span) };
  }
  return null;
}

export type StandingState = { kind: 'loading' } | { kind: 'unsupported' } | { kind: 'error'; onRetry: () => void } | { kind: 'ok'; standing: Standing };

/** The rank hero: FORM's own badge, points inside the rank, and what is left to the next one. */
export function RankHero({ progress: p }: { progress: Progress }) {
  const r = rankProgress(p);
  const tint = rankColor(p.rank);
  return (
    <GradientCard colorsOverride={gradients.heroMedia} style={{ gap: space.lg, paddingVertical: space.xl, alignItems: 'center' }}>
      <View style={{ alignItems: 'center', justifyContent: 'center', minHeight: 150 }}>
        <BreathingGlow size={170} color={tint} style={{ position: 'absolute' }} />
        <RankEmblem rank={p.rank} size={120} prestige={p.prestige} />
      </View>
      <View style={{ alignItems: 'center', gap: 2 }}>
        <AppText variant="overline" color={tint}>
          Your rank
        </AppText>
        <AppText variant="display" header style={{ textAlign: 'center' }}>
          {rankLabel(p.rank, p.prestige)}
        </AppText>
        <AppText variant="label" color={colors.textMuted}>
          Level {p.level}
        </AppText>
      </View>
      <View style={{ alignSelf: 'stretch', gap: space.sm }}>
        {r.next ? (
          <>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText variant="label" style={{ fontVariant: ['tabular-nums'] }} accessibilityLabel={`${fmt(r.into)} of ${fmt(r.span)} XP in ${p.rank}`}>
                {`${fmt(r.into)} / ${fmt(r.span)} XP`}
              </AppText>
              <AppText variant="label" color={colors.textMuted}>
                {p.rank}
              </AppText>
            </Row>
            <ProgressBar value={r.fraction} height={10} color={tint} label={`Progress to ${r.next.name}`} />
            <AppText variant="caption" color={colors.textMuted}>
              {`${fmt(r.toNext)} XP to ${r.next.name}`}
            </AppText>
          </>
        ) : r.endless ? (
          <>
            <Row style={{ justifyContent: 'space-between' }}>
              <AppText variant="label" style={{ fontVariant: ['tabular-nums'] }} accessibilityLabel={`${fmt(r.endless.into)} of ${fmt(r.endless.span)} XP in ${r.endless.name}`}>
                {`${fmt(r.endless.into)} / ${fmt(r.endless.span)} XP`}
              </AppText>
              <AppText variant="label" color={colors.textMuted}>
                {r.endless.name}
              </AppText>
            </Row>
            <ProgressBar value={r.endless.fraction} height={10} color={tint} label={`Progress to ${r.endless.nextName}`} />
            <AppText variant="caption" color={colors.textMuted}>
              {`${fmt(r.endless.toNext)} XP to ${r.endless.nextName}`}
            </AppText>
          </>
        ) : (
          <AppText variant="bodyStrong" style={{ textAlign: 'center' }}>
            {`Top rank reached · ${fmt(p.totalXp)} XP`}
          </AppText>
        )}
      </View>
    </GradientCard>
  );
}

/** "Top 5% of FORM users" — anonymous; the server sends only a percentile and a head count. */
export function StandingCard({ state, totalXp }: { state: StandingState; totalXp: number }) {
  if (state.kind === 'loading') {
    return (
      <Card>
        <AppText variant="caption" color={colors.textMuted}>
          Loading your standing…
        </AppText>
      </Card>
    );
  }
  if (state.kind === 'error') {
    return (
      <Card style={{ gap: space.sm }}>
        <AppText variant="bodyStrong">{"Couldn't load your standing right now."}</AppText>
        <Button label="Try again" variant="secondary" onPress={state.onRetry} />
      </Card>
    );
  }
  if (state.kind === 'unsupported') {
    return (
      <Card style={{ gap: space.xs }}>
        <AppText variant="bodyStrong">Standing is not ready yet</AppText>
        <AppText variant="caption" color={colors.textMuted}>
          FORM is updating. Check back soon and your standing will be here.
        </AppText>
      </Card>
    );
  }
  const { percentile, rankedUsers } = state.standing;
  if (percentile === null) {
    return (
      <Card style={{ gap: space.xs }}>
        <Row gap={space.sm}>
          <Ionicons name="people-outline" size={20} color={colors.textMuted} />
          <AppText variant="bodyStrong">{totalXp > 0 && rankedUsers >= 20 ? 'Earn XP to see your standing' : 'Standing appears once more people train'}</AppText>
        </Row>
        <AppText variant="caption" color={colors.textMuted}>
          {'It is always anonymous: you only ever see your own place, never anyone else’s.'}
        </AppText>
      </Card>
    );
  }
  return (
    <Card style={{ gap: space.sm }}>
      <View accessible accessibilityLabel={`Top ${percentile} percent of FORM users, out of ${rankedUsers} people with XP`}>
        <Row gap={space.md}>
          <Ionicons name="trophy-outline" size={28} color={colors.accent} />
          <View style={{ flex: 1 }}>
            <AppText variant="display" header style={{ fontSize: 34, lineHeight: 40 }}>
              {`Top ${percentile}%`}
            </AppText>
            <AppText variant="body" color={colors.textMuted}>
              of FORM users
            </AppText>
          </View>
        </Row>
      </View>
      <AppText variant="caption" color={colors.textFaint}>
        {`Measured by XP across ${rankedUsers.toLocaleString()} people. Anonymous: nobody else’s name or details are shared.`}
      </AppText>
    </Card>
  );
}

const RANGES: { value: RankRange; label: string }[] = [
  { value: '1M', label: '1M' },
  { value: '3M', label: '3M' },
  { value: 'All', label: 'All' },
];
const WINDOW_WORDS: Record<RankRange, string> = { '1M': 'in the last month', '3M': 'in the last 3 months', All: 'in the history shown' };

/** The line of the user's XP over time from the XP ledger, ending at the XP on their badge. */
export function RankOverTime({ progress: p, events, today }: { progress: Progress; events: XpLedgerEntry[]; today: string }) {
  const [range, setRange] = useState<RankRange>('1M');
  const timeline = useMemo(() => xpTimeline(events, p.totalXp, p.provisionalXp, today), [events, p.totalXp, p.provisionalXp, today]);
  const chart = useMemo(() => rankChart(timeline.points, range, today), [timeline, range, today]);
  const change = xpChange(chart);
  return (
    <Card style={{ gap: space.md }}>
      <Segmented options={RANGES} value={range} onChange={setRange} label="Range" />
      {events.length === 0 ? (
        <AppText variant="caption" color={colors.textMuted}>
          Your line starts with your first workout. Every XP you earn is drawn here.
        </AppText>
      ) : (
        <>
          <Chart chart={chart} />
          {change !== null ? (
            <AppText variant="label" color={change >= 0 ? colors.primary : colors.warning} style={{ fontVariant: ['tabular-nums'] }}>
              {`${change >= 0 ? '+' : '−'}${fmt(Math.abs(change))} XP ${WINDOW_WORDS[range]}`}
            </AppText>
          ) : null}
        </>
      )}
      {!timeline.complete && range === 'All' ? (
        <AppText variant="caption" color={colors.textFaint}>
          Showing your most recent XP changes.
        </AppText>
      ) : null}
    </Card>
  );
}

/** Your Rank: the badge, where you stand among FORM users, and the climb over time. */
export function YourRankView({
  progress,
  standing,
  events,
  eventsState,
  today,
  onOpenLeaderboard,
}: {
  progress: Progress;
  standing: StandingState;
  events: XpLedgerEntry[];
  eventsState: 'loading' | 'error' | 'ok';
  today: string;
  /** Opens the leaderboards; the link is hidden when omitted. */
  onOpenLeaderboard?: () => void;
}) {
  const section = { gap: space.md } as const;
  return (
    <View style={{ gap: space.lg }}>
      <RankHero progress={progress} />
      <View style={section}>
        <SectionHeader title="Your standing" />
        <StandingCard state={standing} totalXp={progress.totalXp} />
        {onOpenLeaderboard ? (
          <ExerciseList>
            <ListRow title="Leaderboards" subtitle="See who earned the most XP today, this week or ever" icon="podium-outline" iconTint={colors.primary} onPress={onOpenLeaderboard} />
          </ExerciseList>
        ) : null}
      </View>
      <View style={section}>
        <SectionHeader title="Rank over time" />
        {eventsState === 'error' ? (
          <InlineMessage tone="info" icon="cloud-offline-outline">
            {"Couldn't load your XP history right now."}
          </InlineMessage>
        ) : eventsState === 'loading' ? (
          <AppText variant="caption" color={colors.textMuted}>
            Loading your XP history…
          </AppText>
        ) : (
          <RankOverTime progress={progress} events={events} today={today} />
        )}
      </View>
    </View>
  );
}
