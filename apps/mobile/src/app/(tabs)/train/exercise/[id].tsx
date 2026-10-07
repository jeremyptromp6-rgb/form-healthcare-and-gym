import Ionicons from '@expo/vector-icons/Ionicons';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { BodyMap, type Muscle } from '@/components/art/BodyMap';
import { ExerciseArt } from '@/components/art/ExerciseArt';
import { AppText, Badge, BreathingGlow, Button, Card, MuscleBars, StatStrip, ErrorState, Row, Screen, SectionHeader, StateView } from '@/components/ui';
import { livePoseSupport } from '@/lib/pose/support';
import { FormIntelligenceView } from '@/components/pro/ProFeatureViews';
import { ProUpsellFor } from '@/components/pro/ProUpsellFor';
import { proFeatureOf, useFormIntelligence } from '@/lib/pro';
import { useExerciseDetail, useMe } from '@/lib/queries';
import { colors, gradients, radius, space } from '@/theme/tokens';

const EQUIPMENT_LABEL = (key: string) => key.replace(/_/g, ' ');
const PR_LABEL: Record<string, string> = { max_load: 'Heaviest', estimated_1rm: 'Est. 1RM', max_reps: 'Most reps' };

/** Exercise detail: how to do it, what it needs, camera requirements, and your history with it. */
export default function ExerciseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useExerciseDetail(id);
  const poseSupport = livePoseSupport();

  if (q.isError && !q.data) {
    return (
      <Screen title="Exercise">
        {q.error.kind === 'not_found' ? <StateView kind="empty" title="Exercise not found" /> : <ErrorState error={q.error} onRetry={q.refetch} />}
      </Screen>
    );
  }
  if (!q.data) return <Screen title="Exercise"><StateView kind="loading" /></Screen>;
  const { exercise: e, history, records } = q.data;

  return (
    <Screen title={e.name} subtitle={e.pattern.replace(/_/g, ' ')}>
      <Stack.Screen options={{ title: e.name }} />
      <LinearGradient colors={gradients.heroMedia} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={{ borderRadius: radius.xl, alignItems: 'center', paddingVertical: space.md, borderWidth: 1, borderColor: colors.border }}>
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <BreathingGlow size={230} color={colors.primary} style={{ position: 'absolute' }} />
          <ExerciseArt exerciseId={e.id} name={e.name} size="hero" style={{ height: 210 }} />
        </View>
        <Row gap={space.md} style={{ flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: space.md }}>
          <Legend color={colors.textFaint} label="Start" faint />
          <Legend color={colors.text} label="Finish" />
          <Legend color="#E06A44" label="Muscles working" />
        </Row>
      </LinearGradient>
      <StatStrip
        items={[
          { label: 'Level', value: e.difficulty.charAt(0).toUpperCase() + e.difficulty.slice(1) },
          { label: e.perSide ? 'Reps / side' : 'Reps', value: `${e.targetReps.min}–${e.targetReps.max}` },
          { label: 'Coaching', value: e.cameraVerifiable ? 'Camera' : 'Manual', tint: e.cameraVerifiable ? colors.water : undefined },
        ]}
      />

      <SectionHeader title="Muscles worked" />
      <Card style={{ gap: space.lg }}>
        <BodyMap primary={e.primaryMuscles} secondary={e.secondaryMuscles} height={210} style={{ alignSelf: 'center' }} />
        <MuscleBars
          rows={[
            ...e.primaryMuscles.map((m) => ({ muscle: m as Muscle, value: 1, caption: 'Main' })),
            ...e.secondaryMuscles.filter((m) => !e.primaryMuscles.includes(m)).map((m) => ({ muscle: m as Muscle, value: 0.45, caption: 'Helps' })),
          ]}
        />
      </Card>

      <SectionHeader title="Equipment" />
      <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
        {e.equipment.map((alt, i) => (
          <Row key={i} gap={space.sm} style={styles.gear}>
            <View style={styles.gearIcon}>
              <Ionicons name={alt.includes('bodyweight') || alt.length === 0 ? 'body' : 'barbell'} size={16} color={colors.primary} />
            </View>
            <AppText variant="bodyStrong" style={{ textTransform: 'capitalize' }}>
              {alt.length ? alt.map(EQUIPMENT_LABEL).join(' + ') : 'bodyweight'}
            </AppText>
          </Row>
        ))}
      </Row>

      <SectionHeader title="How to" />
      <Card style={{ gap: space.md }}>
        {e.instructions.map((step, i) => (
          <Row key={i} gap={space.md} style={{ alignItems: 'flex-start' }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: -1 }}>
              <AppText variant="label" color={colors.onPrimary}>
                {i + 1}
              </AppText>
            </View>
            <AppText variant="body" style={{ flex: 1 }}>
              {step}
            </AppText>
          </Row>
        ))}
      </Card>

      <Card style={{ gap: space.sm, backgroundColor: colors.warningSoft, borderColor: `${colors.warning}40` }}>
        <Row gap={space.sm}>
          <Ionicons name="shield-checkmark-outline" size={18} color={colors.warning} />
          <AppText variant="bodyStrong">Safety</AppText>
        </Row>
        {e.safety.map((s) => (
          <AppText key={s} variant="caption" color={colors.textMuted}>
            • {s}
          </AppText>
        ))}
      </Card>

      {e.camera ? (
        <Card style={{ gap: space.xs, backgroundColor: `${colors.water}12`, borderColor: `${colors.water}30` }}>
          <Row gap={space.sm}>
            <Ionicons name="videocam" size={18} color={colors.water} />
            <AppText variant="bodyStrong">Camera setup</AppText>
          </Row>
          <AppText variant="caption" color={colors.textMuted}>
            {e.camera.setup} FORM tracks your {e.camera.joint} angle on this device; nothing is recorded.
          </AppText>
          {e.cameraVerifiable && poseSupport.available ? (
            <Button
              label="Practise with camera coaching"
              icon="videocam-outline"
              variant="secondary"
              onPress={() => router.push(`/camera?exerciseId=${e.id}` as Href)}
              accessibilityHint="Practice mode — checks your camera setup without logging anything"
              style={{ marginTop: space.sm }}
            />
          ) : null}
        </Card>
      ) : null}

      <SectionHeader title="Your history" />
      {records.length ? (
        <Row gap={space.sm} style={{ flexWrap: 'wrap' }}>
          {records.map((r) => (
            <Badge key={r.kind} label={`${PR_LABEL[r.kind] ?? r.kind}: ${r.value}${r.kind === 'max_reps' ? ' reps' : ' kg'}`} tone="primary" icon="trophy" />
          ))}
        </Row>
      ) : null}
      <Card style={{ gap: space.md }}>
        {history.length === 0 ? (
          <AppText variant="caption" color={colors.textMuted}>
            You haven&apos;t done this one yet.
          </AppText>
        ) : (
          history.map((h) => (
            <View key={h.workoutId} style={{ gap: 2 }}>
              <AppText variant="bodyStrong">{new Date(`${h.localDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</AppText>
              <AppText variant="caption" color={colors.textMuted}>
                {h.sets.map((s) => `${s.reps}${s.loadKg > 0 ? ` × ${s.loadKg} kg` : ''}${s.verifiedReps ? ` (${s.verifiedReps}✓)` : ''}`).join(' · ')}
              </AppText>
            </View>
          ))
        )}
      </Card>

      {e.cameraVerifiable ? <FormHistory exerciseId={e.id} /> : null}
    </Screen>
  );
}

/** One key to the drawing: a coloured dot and what it means. */
function Legend({ color, label, faint }: { color: string; label: string; faint?: boolean }) {
  return (
    <Row gap={6}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, opacity: faint ? 0.5 : 1 }} />
      <AppText variant="label" color={colors.textMuted}>
        {label}
      </AppText>
    </Row>
  );
}

/** FORM Pro: form and range-of-motion history. The server decides access; a 402 shows the upsell instead. */
function FormHistory({ exerciseId }: { exerciseId: string }) {
  const q = useFormIntelligence(exerciseId, 90, true);
  const me = useMe();
  const locked = proFeatureOf(q.error);
  return (
    <>
      <SectionHeader title="Form history" />
      {locked ? <ProUpsellFor feature={locked} /> : null}
      {q.isPending ? <StateView kind="loading" compact /> : null}
      {q.isError && !locked ? <ErrorState error={q.error} onRetry={q.refetch} compact /> : null}
      {q.data ? <FormIntelligenceView data={q.data.intelligence} units={me.data?.settings.units ?? 'metric'} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  gear: { paddingVertical: space.sm, paddingLeft: space.sm, paddingRight: space.lg, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  gearIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
});
