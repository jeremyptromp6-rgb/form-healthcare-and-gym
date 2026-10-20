import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { BodyMap } from '@/components/art/BodyMap';
import { setsPerMuscle } from '@/lib/muscles';
import { ExerciseThumb } from '@/components/art/ExerciseArt';
import { TrophyArt } from '@/components/art/SceneArt';
import { AppText, Button, Card, HeroMedia, InlineMessage, MuscleBars, Row, StatStrip } from '@/components/ui';
import { useReducedMotion } from '@/lib/a11y';
import { CoachCard } from '@/components/coach/CoachViews';
import type { CoachResponse, WorkoutSummaryDetail } from '@/lib/types';
import { formatLoad, formatVolume, useUnits, type Units } from '@/lib/units';
import { verificationNote } from '@/lib/workoutSession';
import { imagery } from '@/theme/imagery';
import { colors, space } from '@/theme/tokens';

const FLAG_MESSAGE: Record<string, { tone: 'warning' | 'danger'; text: string }> = {
  serious_pain_no_xp: { tone: 'danger', text: "Sessions with serious pain don't earn XP or PRs. Rest, and see a professional if the pain continues." },
  daily_training_cap_reached: { tone: 'warning', text: "You'd already trained 2 hours today, so this session earns no XP. Recovery is where you progress." },
  daily_workout_cap_reached: { tone: 'warning', text: "You've already earned XP for 3 workouts today — this one is saved but earns no XP." },
  partially_capped: { tone: 'warning', text: "Part of this session went past today's 2-hour cap, so it earned partial XP." },
};
/** How each set was recorded, as a small badge on its row. */
const MODE_BADGE = { live: 'Logged', camera: 'Camera', manual: 'Manual' } as const;

const PR_LABEL: Record<string, string> = {
  max_load: 'Heaviest load',
  estimated_1rm: 'Estimated one-rep max',
  max_reps: 'Most verified reps',
  best_form: 'Best form score',
  best_rom: 'Best range of motion',
  workout_verified_reps: 'Most verified reps in a workout',
  longest_streak: 'Longest training streak',
};

/** How a record value reads, matching the server's units. */
export function prValue(kind: string, value: number, units: Units = 'metric'): string {
  const v = Math.round(value * 10) / 10;
  if (kind === 'best_form') return `form ${v}`;
  if (kind === 'best_rom') return `${v}%`;
  if (kind === 'longest_streak') return `${v} ${v === 1 ? 'day' : 'days'}`;
  if (kind === 'max_reps' || kind === 'workout_verified_reps') return `${v} ${v === 1 ? 'rep' : 'reps'}`;
  return units === 'imperial' ? formatLoad(value, units) : `${v} kg`;
}

/** A gentle arrival for the reward — a small rise and fade, skipped with reduced motion. */
function Arrive({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const reduce = useReducedMotion();
  const [anim] = useState(() => new Animated.Value(reduce ? 1 : 0));
  useEffect(() => {
    if (reduce) return anim.setValue(1);
    Animated.timing(anim, { toValue: 1, duration: 420, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [anim, delay, reduce]);
  return (
    <Animated.View style={{ opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }, { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) }] }}>
      {children}
    </Animated.View>
  );
}

export { setsPerMuscle };

/** Workout summary — used right after completion and for history entries. */
export function WorkoutSummaryView({
  summary,
  onDone,
  title = 'Workout complete',
  coachNote,
  onCoachAction,
  adNext = false,
  units: unitsProp,
}: {
  summary: WorkoutSummaryDetail;
  onDone?: () => void;
  title?: string;
  /** The coach on this session (validated server-side; may be a labelled rule-based tip). */
  coachNote?: CoachResponse | null;
  onCoachAction?: (route: string) => void;
  /** Free tier: a short ad is ready to follow Done. Said up front so it is never a surprise. */
  adNext?: boolean;
  /** Display units for loads (stored in kg). Defaults to the user's setting. */
  units?: Units;
}) {
  const units = useUnits(unitsProp);
  const volume = formatVolume(summary.totals.volumeKg, units);
  const { workout, totals } = summary;
  const muscles = setsPerMuscle(summary.sets.filter((s) => !s.warmup)); // warm-ups don't count
  const byExercise = new Map<string, WorkoutSummaryDetail['sets']>();
  for (const s of summary.sets) byExercise.set(s.name, [...(byExercise.get(s.name) ?? []), s]);
  // A beaten record is a PR worth celebrating; a first value is a baseline to beat next time.
  // Manual sets earn less XP: said once, right after the workout (history rows show the badges only).
  const manualSets = summary.sets.some((s) => !s.warmup && s.mode === 'manual');
  const awarded = summary.prs.filter((p) => p.status === 'awarded' && p.previous != null);
  const baselines = summary.prs.filter((p) => p.status === 'awarded' && p.previous == null && p.exerciseId !== '*');

  return (
    <View style={{ gap: space.lg }}>
      <Arrive>
        <Card style={{ gap: space.sm, alignItems: 'center', paddingVertical: space.xl }}>
          <AppText variant="overline" color={colors.primary}>
            {title}
          </AppText>
          <Row gap={space.xs} style={{ alignItems: 'baseline' }}>
            <AppText variant="display" style={{ fontSize: 56, lineHeight: 62 }}>
              +{workout.xp}
            </AppText>
            <AppText variant="heading" color={colors.textMuted}>
              XP
            </AppText>
          </Row>
          <AppText variant="caption" color={colors.textMuted}>
            {new Date(`${workout.localDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
          </AppText>
          <StatStrip
            style={{ alignSelf: 'stretch', marginTop: space.sm }}
            items={[
              { label: 'Time', value: String(workout.durationMinutes), unit: 'min' },
              { label: 'Volume', value: volume.value, unit: volume.unit },
              { label: 'Sets', value: String(totals.sets) },
              { label: 'Reps', value: String(totals.reps) },
            ]}
          />
        </Card>
      </Arrive>

      {awarded.map((p, i) => {
        const name = p.exerciseId === '*' ? (PR_LABEL[p.kind] ?? p.kind) : (summary.sets.find((s) => s.exerciseId === p.exerciseId)?.name ?? p.exerciseId);
        const value = prValue(p.kind, p.value, units);
        return (
          <Arrive key={i} delay={200 + i * 120}>
            <View accessible accessibilityLabel={`New personal record: ${name}, ${PR_LABEL[p.kind] ?? p.kind} ${value}`}>
              <HeroMedia image={imagery.record} minHeight={180} style={{ borderWidth: 1, borderColor: colors.accentSoft }}>
                <View style={{ alignItems: 'center', gap: space.xs }}>
                  <TrophyArt size={64} />
                  <AppText variant="overline" color={colors.accent}>
                    New personal record
                  </AppText>
                  <AppText variant="heading">{name}</AppText>
                  <AppText variant="display">{value}</AppText>
                  <AppText variant="caption" color={colors.textMuted}>
                    {p.exerciseId === '*' ? 'Across all training' : (PR_LABEL[p.kind] ?? p.kind)} · up from {prValue(p.kind, p.previous!, units)}
                  </AppText>
                </View>
              </HeroMedia>
            </View>
          </Arrive>
        );
      })}

      {baselines.length > 0 ? (
        <Card style={{ gap: space.xs }}>
          <Row gap={space.sm}>
            <Ionicons name="flag-outline" size={18} color={colors.primary} />
            <AppText variant="bodyStrong">First records set</AppText>
          </Row>
          <AppText variant="caption" color={colors.textMuted}>
            {baselines.map((p) => `${summary.sets.find((s) => s.exerciseId === p.exerciseId)?.name ?? p.exerciseId}: ${(PR_LABEL[p.kind] ?? p.kind).toLowerCase()} ${prValue(p.kind, p.value, units)}`).join(' · ')}
          </AppText>
          <AppText variant="caption" color={colors.textFaint}>
            Your baseline — beat it next time for a new PR.
          </AppText>
        </Card>
      ) : null}

      <StatStrip
        items={[
          { label: 'Verified reps', value: String(totals.verifiedReps), tint: colors.water },
          ...(totals.averageFormScore !== null
            ? [
                { label: 'Average form', value: String(totals.averageFormScore) },
                { label: 'Perfect reps', value: String(totals.perfectReps), tint: colors.success },
              ]
            : []),
        ]}
      />

      {muscles.length ? (
        <Card style={{ gap: space.lg }}>
          <Row gap={space.sm}>
            <Ionicons name="body" size={18} color={colors.protein} />
            <AppText variant="heading" header>
              Muscles worked
            </AppText>
          </Row>
          <BodyMap heat={Object.fromEntries(muscles.map((m) => [m.muscle, m.value / muscles[0]!.value]))} height={200} style={{ alignSelf: 'center' }} />
          <MuscleBars rows={muscles.map((m) => ({ ...m, caption: `${m.value} ${m.value === 1 ? 'set' : 'sets'}` }))} />
        </Card>
      ) : null}

      {onDone && manualSets ? <InlineMessage tone="info">Manual sets earn less XP (sets logged much faster than they could have been done count as manual). Logged and camera sets earn full XP.</InlineMessage> : null}
      {workout.flags.map((f) => (FLAG_MESSAGE[f] ? <InlineMessage key={f} tone={FLAG_MESSAGE[f].tone}>{FLAG_MESSAGE[f].text}</InlineMessage> : null))}
      {summary.prs.some((p) => p.status === 'needs_review') ? (
        <InlineMessage tone="info">A big jump from your previous best is held for review before it counts as a PR.</InlineMessage>
      ) : null}

      <Card style={{ gap: space.lg }}>
        {[...byExercise.entries()].map(([name, sets]) => (
          <View key={name} style={{ gap: space.sm }}>
            <Row gap={space.md}>
              <ExerciseThumb exerciseId={sets[0]!.exerciseId} size={40} />
              <AppText variant="bodyStrong" style={{ flex: 1 }}>
                {name}
              </AppText>
            </Row>
            {sets.map((s, i) => {
              // Warm-ups are listed but not numbered: the working sets count 1, 2, 3.
              const label = s.warmup ? 'Warm-up' : `Set ${sets.slice(0, i).filter((x) => !x.warmup).length + 1}`;
              return (
              <Row key={i} gap={space.sm} style={{ paddingVertical: 6, paddingHorizontal: space.sm, borderRadius: 10, backgroundColor: colors.successSoft }}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <AppText variant="caption" color={colors.text} style={{ flex: 1 }}>
                {label}: {s.reps} reps{s.loadKg > 0 ? ` × ${formatLoad(s.loadKg, units)}` : ''}
                {s.targetReps ? ` · target ${s.targetReps}` : ''}
                {s.verifiedReps > 0 ? ` · ${s.verifiedReps} verified` : ''}
                {s.verifiedReps === 0 && verificationNote(s.verificationStatus) ? ` · ${verificationNote(s.verificationStatus)}` : ''}
                {s.formScore !== null ? ` · form ${s.formScore}` : ''}
                {s.romPercent !== null ? ` · ROM ${s.romPercent}%` : ''}
              </AppText>
              {s.mode && !s.warmup ? (
                <View accessible accessibilityLabel={`${MODE_BADGE[s.mode]} set`} style={{ paddingHorizontal: space.sm, paddingVertical: 2, borderRadius: 999, backgroundColor: s.mode === 'manual' ? colors.cardRaised : colors.primarySoft }}>
                  <AppText variant="overline" color={s.mode === 'manual' ? colors.textMuted : colors.primary}>
                    {MODE_BADGE[s.mode]}
                  </AppText>
                </View>
              ) : null}
              </Row>
              );
            })}
          </View>
        ))}
      </Card>

      {workout.notes ? (
        <Card style={{ gap: space.xs }}>
          <Row gap={space.sm}>
            <Ionicons name="create-outline" size={18} color={colors.primary} />
            <AppText variant="bodyStrong" header>
              Workout notes
            </AppText>
          </Row>
          <AppText variant="body" color={colors.textMuted}>
            {workout.notes}
          </AppText>
        </Card>
      ) : null}

      {coachNote ? <CoachCard response={coachNote} title="Coach on this session" onAction={onCoachAction} /> : null}

      {onDone ? (
        <View style={{ gap: space.sm }}>
          <Button label="Done" onPress={onDone} accessibilityHint={adNext ? 'A short ad plays, then you return Home.' : undefined} />
          {adNext ? (
            <AppText variant="caption" color={colors.textMuted} style={{ textAlign: 'center' }}>
              Next: a short ad, then Home. FORM Pro has no ads.
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
