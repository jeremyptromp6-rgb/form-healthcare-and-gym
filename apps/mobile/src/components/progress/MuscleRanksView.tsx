import Ionicons from '@expo/vector-icons/Ionicons';
import { EXERCISES, MUSCLE_TIERS, TIER_THRESHOLDS, type MuscleRank, type MuscleTier } from '@form/domain';
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { BodyMap, MUSCLE_LABEL, MuscleThumb, TIER_METAL, type Muscle } from '@/components/art/BodyMap';
import { TierBadge } from '@/components/art/TierBadge';
import { AppText, Card, Divider, Row, SectionHeader } from '@/components/ui';
import type { MuscleRanks } from '@/lib/types';
import { METAL_TEXT } from '@/theme/artPalette';
import { colors, radius, scheme, space } from '@/theme/tokens';

const ROMAN = ['', 'I', 'II', 'III'] as const;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Untrained", "Gold II". */
export const tierLabel = (tier: MuscleTier, level: number) => (tier === 'untrained' ? 'Untrained' : `${cap(tier)} ${ROMAN[level] ?? ''}`.trim());

/** The tier's colour as text: its metal, or the muted text colour when untrained. */
export const tierColor = (tier: MuscleTier) => {
  const metal = TIER_METAL[tier];
  return metal ? (METAL_TEXT[scheme] as Record<string, string>)[metal] ?? colors.textMuted : colors.textMuted;
};

/** "6 more sets to reach Gold", or a line for the top rank. */
export function toNextLine(r: Pick<MuscleRank, 'nextTier' | 'setsToNext'>): string {
  if (r.nextTier === null || r.setsToNext === null) return 'Top rank. Keep it up to hold it.';
  const n = Math.max(1, r.setsToNext);
  return `${n} more ${n === 1 ? 'set' : 'sets'} to reach ${cap(r.nextTier)}`;
}

const setsText = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${n === 1 ? 'set' : 'sets'}`;

/** Where in the climb to the next tier this muscle is, 0 to 1 (full at the top rank). */
export function climb(r: MuscleRank): number {
  if (r.nextTier === null) return 1;
  const next = TIER_THRESHOLDS[r.nextTier as Exclude<MuscleTier, 'untrained'>][0];
  const from = r.tier === 'untrained' ? 0 : TIER_THRESHOLDS[r.tier as Exclude<MuscleTier, 'untrained'>][0];
  return Math.max(0, Math.min(1, (r.sets - from) / (next - from)));
}

/** A few exercises that train the muscle as a main mover, from the library. */
const suggestions = (muscle: string) => EXERCISES.filter((e) => (e.primaryMuscles as string[]).includes(muscle)).slice(0, 3).map((e) => e.name);

function RankRow({ rank, open, onToggle }: { rank: MuscleRank; open: boolean; onToggle: () => void }) {
  const name = MUSCLE_LABEL[rank.muscle as Muscle] ?? rank.muscle;
  const label = tierLabel(rank.tier, rank.level);
  const picks = suggestions(rank.muscle);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, ${label}, ${setsText(rank.sets)} in the last 28 days. ${toNextLine(rank)}`}
        accessibilityState={{ expanded: open }}
        aria-expanded={open}
        onPress={onToggle}
        style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: 56, paddingVertical: space.sm, borderRadius: radius.sm }, pressed && { backgroundColor: colors.primarySoft }]}>
        <MuscleThumb muscle={rank.muscle as Muscle} size={40} active={rank.tier !== 'untrained'} />
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong">{name}</AppText>
          <AppText variant="caption" color={tierColor(rank.tier)}>
            {label}
          </AppText>
        </View>
        <TierBadge tier={rank.tier} level={rank.level} size={32} />
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textFaint} />
      </Pressable>
      {open ? (
        <View style={{ gap: space.sm, paddingBottom: space.md, paddingLeft: 40 + space.md }}>
          <AppText variant="body">{`${setsText(rank.sets)} in the last 28 days`}</AppText>
          <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.cardRaised, overflow: 'hidden' }} accessible={false} importantForAccessibility="no-hide-descendants" aria-hidden>
            <View style={{ width: `${Math.round(climb(rank) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: rank.tier === 'untrained' ? colors.primary : tierColor(rank.tier) }} />
          </View>
          <AppText variant="bodyStrong" color={colors.primary}>
            {toNextLine(rank)}
          </AppText>
          {picks.length ? (
            <AppText variant="caption" color={colors.textMuted}>
              Try {picks.join(', ')}.
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/**
 * Muscle ranks: the body map coloured by tier, a legend, and every muscle weakest first as an expandable
 * row. Tiers come from the server (verified hard sets over the last 28 days); nothing here compares you
 * with anyone else.
 */
export function MuscleRanksView({ data }: { data: MuscleRanks }) {
  const [openMuscle, setOpenMuscle] = useState<string | null>(null);
  const ranks = data.ranks;
  const tiers = Object.fromEntries(ranks.map((r) => [r.muscle, r.tier])) as Partial<Record<Muscle, MuscleTier>>;
  const fresh = ranks.every((r) => r.sets === 0);
  const weakest = ranks.filter((r) => r.tier === 'untrained' || r.tier === 'bronze').slice(0, 3);
  return (
    <View style={{ gap: space.xl }}>
      <Card style={{ gap: space.md, alignItems: 'center' }}>
        <BodyMap tiers={tiers} height={230} style={{ alignSelf: 'center' }} />
        <Row gap={space.md} style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
          {MUSCLE_TIERS.map((t) => (
            <Row key={t} gap={4} style={{ minHeight: 24 }}>
              <TierBadge tier={t} level={t === 'untrained' ? 0 : 2} size={18} />
              <AppText variant="caption" color={tierColor(t)}>
                {cap(t)}
              </AppText>
            </Row>
          ))}
        </Row>
      </Card>

      {fresh ? (
        <Card style={{ gap: space.xs }}>
          <AppText variant="heading">Every muscle starts untrained</AppText>
          <AppText variant="body" color={colors.textMuted}>
            That is the starting line, not a verdict. Finish a workout with verified sets and the muscles you train light up here, tier by tier.
          </AppText>
        </Card>
      ) : weakest.length ? (
        <Card style={{ gap: space.xs }}>
          <AppText variant="label" color={colors.textMuted}>
            Focus next
          </AppText>
          <AppText variant="heading">{weakest.map((r) => MUSCLE_LABEL[r.muscle as Muscle] ?? r.muscle).join(', ')}</AppText>
          <AppText variant="caption" color={colors.textMuted}>
            These have the fewest hard sets in the last 28 days. A few more each week moves them up.
          </AppText>
        </Card>
      ) : null}

      <View style={{ gap: space.md }}>
        <SectionHeader title="Muscles to improve" />
        <View>
          {ranks.map((r, i) => (
            <View key={r.muscle}>
              {i > 0 ? <Divider /> : null}
              <RankRow rank={r} open={openMuscle === r.muscle} onToggle={() => setOpenMuscle(openMuscle === r.muscle ? null : r.muscle)} />
            </View>
          ))}
        </View>
      </View>

      <AppText variant="caption" color={colors.textFaint}>
        Ranks use your hard sets from the last {data.windowDays} days: one for each main muscle, half for the helpers. Only sets with verified reps count, and workouts with serious pain are left out. About 10 to 20 hard sets a week per muscle is a strong range. This is only about your own training.
      </AppText>
    </View>
  );
}
