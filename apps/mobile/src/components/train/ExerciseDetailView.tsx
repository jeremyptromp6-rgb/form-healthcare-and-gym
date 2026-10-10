import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { BodyMap, type Muscle } from '@/components/art/BodyMap';
import { EXERCISE_ART_COLORS, ExerciseArt } from '@/components/art/ExerciseArt';
import { AppText, Badge, BreathingGlow, Button, Card, MuscleBars, Row, SectionHeader, StatStrip, TabRow, TrendChart, type TrendPoint } from '@/components/ui';
import type { ExerciseDetail } from '@/lib/types';
import { colors, gradients, radius, space } from '@/theme/tokens';

const EQUIPMENT_LABEL = (key: string) => key.replace(/_/g, ' ');
const PR_LABEL: Record<string, string> = { max_load: 'Heaviest', estimated_1rm: 'Est. 1RM', max_reps: 'Most reps' };

type Tab = 'about' | 'history' | 'progress';
const TABS: { value: Tab; label: string }[] = [
  { value: 'about', label: 'About' },
  { value: 'history', label: 'History' },
  { value: 'progress', label: 'Progress' },
];

export interface ExerciseDetailViewProps {
  detail: ExerciseDetail;
  /** Whether live camera coaching can run on this device. */
  poseAvailable: boolean;
  onPractise: (exerciseId: string) => void;
  /** FORM Pro form history, rendered by the route and shown at the end of Progress. */
  formHistory?: ReactNode;
}

const round1 = (v: number) => Math.round(v * 10) / 10;
const shortDate = (localDate: string) => new Date(`${localDate}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const longDate = (localDate: string) => new Date(`${localDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/** One session's real numbers, from the sets that were logged. */
interface SessionStats {
  key: string;
  label: string;
  topKg: number;
  volumeKg: number;
  totalReps: number;
  bestReps: number;
}

/** Per-session stats, oldest first. Nothing is invented: a session with no sets simply has zeros. */
function sessionStats(history: ExerciseDetail['history']): SessionStats[] {
  return history
    .map((h) => ({
      key: h.workoutId,
      date: h.localDate,
      label: shortDate(h.localDate),
      topKg: h.sets.reduce((m, s) => Math.max(m, s.loadKg), 0),
      volumeKg: h.sets.reduce((sum, s) => sum + s.reps * s.loadKg, 0),
      totalReps: h.sets.reduce((sum, s) => sum + s.reps, 0),
      bestReps: h.sets.reduce((m, s) => Math.max(m, s.reps), 0),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Exercise detail: About (how to, camera), History (records and sessions) and Progress (trends from real sets). */
export function ExerciseDetailView({ detail, poseAvailable, onPractise, formHistory }: ExerciseDetailViewProps) {
  const [tab, setTab] = useState<Tab>('about');
  const e = detail.exercise;
  const art = EXERCISE_ART_COLORS;

  return (
    <>
      <LinearGradient colors={gradients.heroMedia} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={styles.hero}>
        <View style={{ alignItems: 'center', justifyContent: 'center' }}>
          <BreathingGlow size={230} color={colors.primary} style={{ position: 'absolute' }} />
          <ExerciseArt exerciseId={e.id} name={e.name} size="hero" animated style={{ height: 210 }} />
        </View>
        <Row gap={space.md} style={{ flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: space.md }}>
          <Legend color={art.ghost} label="Start" />
          <Legend color={art.body} label="Finish" />
          <Legend color={art.work} label="Muscles working" />
        </Row>
      </LinearGradient>

      <TabRow label="Exercise sections" tabs={TABS} value={tab} onChange={setTab} />

      {tab === 'about' ? <AboutTab detail={detail} poseAvailable={poseAvailable} onPractise={onPractise} /> : null}
      {tab === 'history' ? <HistoryTab detail={detail} /> : null}
      {tab === 'progress' ? <ProgressTab detail={detail}>{formHistory}</ProgressTab> : null}
    </>
  );
}

function AboutTab({ detail, poseAvailable, onPractise }: { detail: ExerciseDetail; poseAvailable: boolean; onPractise: (exerciseId: string) => void }) {
  const e = detail.exercise;
  return (
    <>
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
            <AppText variant="bodyStrong" style={{ textTransform: 'capitalize', flexShrink: 1 }}>
              {alt.length ? alt.map(EQUIPMENT_LABEL).join(' + ') : 'bodyweight'}
            </AppText>
          </Row>
        ))}
      </Row>

      <SectionHeader title="How to" />
      <Card style={{ gap: space.md }}>
        {e.instructions.map((step, i) => (
          <Row key={i} gap={space.md} style={{ alignItems: 'flex-start' }}>
            <View style={styles.stepNo}>
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
          {e.cameraVerifiable && poseAvailable ? (
            <Button
              label="Practise with camera coaching"
              icon="videocam-outline"
              variant="secondary"
              onPress={() => onPractise(e.id)}
              accessibilityHint="Practice mode — checks your camera setup without logging anything"
              style={{ marginTop: space.sm }}
            />
          ) : null}
        </Card>
      ) : null}
    </>
  );
}

function HistoryTab({ detail }: { detail: ExerciseDetail }) {
  const { history, records } = detail;
  return (
    <>
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
              <AppText variant="bodyStrong">{longDate(h.localDate)}</AppText>
              <AppText variant="caption" color={colors.textMuted}>
                {h.sets.map((s) => `${s.reps}${s.loadKg > 0 ? ` × ${s.loadKg} kg` : ''}${s.verifiedReps ? ` (${s.verifiedReps}✓)` : ''}`).join(' · ')}
              </AppText>
            </View>
          ))
        )}
      </Card>
    </>
  );
}

function ProgressTab({ detail, children }: { detail: ExerciseDetail; children?: ReactNode }) {
  const sessions = sessionStats(detail.history);
  const weighted = sessions.some((s) => s.topKg > 0);
  const point = (s: SessionStats, value: number): TrendPoint => ({ key: s.key, label: s.label, value: round1(value) });

  let body: ReactNode;
  if (sessions.length === 0) {
    body = (
      <Card>
        <AppText variant="caption" color={colors.textMuted}>
          Log this exercise to see your progress here.
        </AppText>
      </Card>
    );
  } else if (sessions.length === 1) {
    const s = sessions[0]!;
    body = (
      <>
        <StatStrip
          items={
            weighted
              ? [
                  { label: 'Top weight', value: String(round1(s.topKg)), unit: 'kg' },
                  { label: 'Volume', value: String(round1(s.volumeKg)), unit: 'kg' },
                  { label: 'Best reps', value: String(s.bestReps) },
                ]
              : [
                  { label: 'Total reps', value: String(s.totalReps) },
                  { label: 'Best reps', value: String(s.bestReps) },
                ]
          }
        />
        <AppText variant="caption" color={colors.textMuted}>
          Log it again to see a trend.
        </AppText>
      </>
    );
  } else {
    body = (
      <Card style={{ gap: space.xl }}>
        {weighted ? (
          <>
            <TrendChart title="Top weight" unit="kg" points={sessions.filter((s) => s.topKg > 0).map((s) => point(s, s.topKg))} />
            <TrendChart title="Volume" unit="kg" points={sessions.filter((s) => s.volumeKg > 0).map((s) => point(s, s.volumeKg))} />
          </>
        ) : (
          <TrendChart title="Total reps" unit="reps" points={sessions.map((s) => point(s, s.totalReps))} />
        )}
        <TrendChart title="Best reps" unit="reps" points={sessions.map((s) => point(s, s.bestReps))} />
      </Card>
    );
  }

  return (
    <>
      <SectionHeader title="Your progress" />
      {body}
      {children}
    </>
  );
}

/** One key to the drawing: a coloured dot and what it means. */
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Row gap={6}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <AppText variant="label" color={colors.textMuted}>
        {label}
      </AppText>
    </Row>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, alignItems: 'center', paddingVertical: space.md, borderWidth: 1, borderColor: colors.border },
  gear: { paddingVertical: space.sm, paddingLeft: space.sm, paddingRight: space.lg, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  gearIcon: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  stepNo: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: -1 },
});
