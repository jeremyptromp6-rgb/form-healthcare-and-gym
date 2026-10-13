import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, View } from 'react-native';
import { MUSCLE_LABEL, MuscleThumb } from '@/components/art/BodyMap';
import { Buddy } from '@/components/art/Buddy';
import { AppText, Badge, Button, Card, ExerciseList, ExerciseRow, ExerciseThumbStrip, HeroMedia, InlineMessage, Row, StatStrip, type BadgeTone } from '@/components/ui';
import { setsPerMuscle } from '@/lib/muscles';
import type { Progression, WorkoutPlan } from '@/lib/types';
import { formatLoad, loadToDisplay, loadUnit, snapLoadKg, useUnits, type Units } from '@/lib/units';
import { formatRest } from '@/lib/workoutSession';
import { imagery } from '@/theme/imagery';
import { colors, radius, space } from '@/theme/tokens';

const PROGRESSION_BADGE: Partial<Record<Progression, { label: string; tone: BadgeTone }>> = {
  increase_load: { label: 'Add weight', tone: 'primary' },
  increase_reps: { label: 'Add reps', tone: 'primary' },
  deload: { label: 'Lighter today', tone: 'warning' },
  hold_for_rom: { label: 'Full range first', tone: 'warning' },
  hold_for_form: { label: 'Form first', tone: 'warning' },
};

/** Room kept clear beside the hero's title for Pip: his width plus a gap (only when Pip is drawn, i.e. there is no photo). */
const HERO_PIP_SIZE = 76;
const HERO_PIP_CLEARANCE = HERO_PIP_SIZE + space.sm;

/** How many muscle chips to show under the hero. */
const MAX_MUSCLES = 6;

export interface TodayViewProps {
  plan: WorkoutPlan;
  completedToday: boolean;
  /** False while a session is open (the resume card shows instead). */
  canStart: boolean;
  starting: boolean;
  startError: string | null;
  onStart: () => void;
  onOpenExercise: (exerciseId: string) => void;
  camera: { verifying: boolean; message: string };
  /** Display units for target loads (stored in kg). Defaults to the user's setting. */
  units?: Units;
}

/** Today's workout, workout first: the hero with the one action, what it trains, then the exercises. */
export function TodayView({ plan, completedToday, canStart, starting, startError, onStart, onOpenExercise, camera, units: unitsProp }: TodayViewProps) {
  const units = useUnits(unitsProp);
  const adaptive = plan.generator.id === 'adaptive';
  const totalSets = plan.exercises.reduce((n, e) => n + e.sets, 0);
  const muscles = setsPerMuscle(plan.exercises.map((e) => ({ exerciseId: e.exerciseId, count: e.sets }))).slice(0, MAX_MUSCLES);

  return (
    <View style={{ gap: space.md }}>
      <HeroMedia
        image={imagery.train}
        minHeight={200}
        art={
          // Pip, kitted up, in the top corner: the only thing that moves on this screen. The words beside it keep clear.
          <View style={styles.heroPip}>
            <Buddy mood="workout" size={HERO_PIP_SIZE} />
          </View>
        }>
        <View style={{ gap: space.md, paddingRight: imagery.train ? 0 : HERO_PIP_CLEARANCE }}>
          <AppText variant="overline" color={colors.primary}>
            Today&apos;s workout
          </AppText>
          <AppText variant="title" header style={{ fontSize: 32, lineHeight: 38 }}>
            {plan.title}
          </AppText>
        </View>
        {plan.exercises.length > 0 ? <ExerciseThumbStrip exerciseIds={plan.exercises.map((e) => e.exerciseId)} label={`${plan.exercises.length} exercises in today's workout`} /> : null}
        <StatStrip
          items={[
            { label: 'Time', value: `~${plan.estimatedMinutes}`, unit: 'min' },
            { label: 'Exercises', value: String(plan.exercises.length) },
            { label: 'Sets', value: String(totalSets) },
          ]}
        />
        {canStart && plan.exercises.length > 0 ? (
          <Button
            label={completedToday ? 'Train again' : 'Start workout'}
            iconRight={completedToday ? undefined : 'arrow-forward'}
            variant={completedToday ? 'secondary' : 'primary'}
            onPress={onStart}
            loading={starting}
          />
        ) : null}
      </HeroMedia>

      <AppText variant="caption" color={colors.textMuted}>
        {adaptive ? 'Adapted to your reps, form, range of motion and consistency.' : 'Built from your goal, equipment and recent sessions.'}
      </AppText>
      {adaptive ? <Badge label="Adaptive · Pro" tone="primary" icon="trending-up" /> : null}

      {plan.notes.map((n) => (
        <InlineMessage key={n} tone="warning">
          {n}
        </InlineMessage>
      ))}
      {startError ? <InlineMessage tone="danger">{startError}</InlineMessage> : null}
      {completedToday ? (
        <InlineMessage tone="success" icon="checkmark-circle">
          Done for today. Refuel and recover — you can still train again if you planned to.
        </InlineMessage>
      ) : null}

      {muscles.length > 0 ? (
        <View style={{ gap: space.sm }}>
          <AppText variant="overline" color={colors.textMuted} header>
            Muscles hit
          </AppText>
          <View style={styles.chips}>
            {muscles.map((m) => (
              <View key={m.muscle} style={styles.chip} accessible accessibilityLabel={`${MUSCLE_LABEL[m.muscle]}: ${m.value} ${m.value === 1 ? 'set' : 'sets'}`}>
                <MuscleThumb muscle={m.muscle} size={32} />
                <AppText variant="label">{MUSCLE_LABEL[m.muscle]}</AppText>
                <AppText variant="label" color={colors.textFaint} style={{ fontVariant: ['tabular-nums'] }}>
                  {String(m.value)}
                </AppText>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {plan.exercises.length > 0 ? (
        <Card variant="plain">
          <ExerciseList>
            {plan.exercises.map((e, i) => {
              const reps = e.targetReps.min === e.targetReps.max ? `${e.targetReps.min}` : `${e.targetReps.min}–${e.targetReps.max}`;
              return (
                <ExerciseRow
                  key={e.exerciseId}
                  exerciseId={e.exerciseId}
                  index={i + 1}
                  name={e.name}
                  detail={`${e.sets} ${e.sets === 1 ? 'set' : 'sets'} · ${reps} reps${e.targetLoadKg ? ` · ${formatLoad(e.targetLoadKg, units, true)}` : ''}`}
                  meta={`${formatRest(e.restSeconds)} rest`}
                  note={e.note}
                  badge={PROGRESSION_BADGE[e.progression]}
                  accessibilityLabel={`${e.name}: ${e.sets} sets of ${reps} reps${e.targetLoadKg ? ` at ${loadToDisplay(snapLoadKg(e.targetLoadKg, units), units)} ${loadUnit(units) === 'lb' ? 'pounds' : 'kilograms'}` : ''}`}
                  onPress={() => onOpenExercise(e.exerciseId)}
                />
              );
            })}
          </ExerciseList>
        </Card>
      ) : (
        <InlineMessage tone="info">No exercises match your equipment yet. Update your training setup in Profile.</InlineMessage>
      )}

      <CameraCoachingRow camera={camera} />
    </View>
  );
}

/** The camera-coaching status card; shown under the plan, or on its own while the plan loads or fails. */
export function CameraCoachingRow({ camera }: { camera: TodayViewProps['camera'] }) {
  return (
    <Card variant="raised" style={styles.camera}>
      <Row gap={space.sm} style={{ alignItems: 'flex-start' }}>
        <View style={[styles.camIcon, { backgroundColor: camera.verifying ? colors.water : colors.track }]}>
          <Ionicons name="videocam" size={16} color={camera.verifying ? colors.onPrimary : colors.textMuted} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Row gap={space.sm} style={{ justifyContent: 'space-between' }}>
            <AppText variant="bodyStrong" style={{ flexShrink: 1 }}>
              Camera coaching
            </AppText>
            <Badge label={camera.verifying ? 'Ready' : 'Not available'} tone={camera.verifying ? 'primary' : 'neutral'} />
          </Row>
          <AppText variant="caption" color={colors.textMuted}>
            {camera.message}
          </AppText>
          <AppText variant="caption" color={colors.textFaint}>
            Reps the camera counts earn full XP. Reps you enter yourself earn a little less.
          </AppText>
        </View>
      </Row>
    </Card>
  );
}

const styles = StyleSheet.create({
  heroPip: { position: 'absolute', top: space.md, right: space.lg },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: 4, paddingLeft: 4, paddingRight: space.md, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  camera: { paddingVertical: space.md, paddingHorizontal: space.md },
  camIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
});
