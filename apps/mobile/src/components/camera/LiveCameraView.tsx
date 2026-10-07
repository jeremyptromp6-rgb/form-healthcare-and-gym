import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, IconButton, InlineMessage, ProgressBar, Row, StateView } from '@/components/ui';
import type { CameraAction, CameraScreenModel, LiveReadout } from '@/lib/pose/status';
import { formWord } from '@/lib/workoutSession';
import { colors, MAX_CONTENT_WIDTH, radius, space } from '@/theme/tokens';

export interface LiveCameraViewProps {
  exerciseName: string;
  /** "Set 2 of 3" in a workout; null in practice mode. */
  setLabel: string | null;
  /** "8–12 reps"; null when there's no target. */
  targetLabel: string | null;
  setupText: string;
  model: CameraScreenModel;
  readout: LiveReadout | null;
  paused: boolean;
  /** The camera feed element (platform-specific), rendered under the overlays. */
  feed: ReactNode;
  /** Workout mode: save this set with its trace (the server re-verifies it). */
  onLogSet?: () => void;
  logging?: boolean;
  /** Result of the last save: the server's verified count is the one that counts. */
  logMessage?: { tone: 'success' | 'danger' | 'info'; text: string } | null;
  /** Practice mode: start counting again. */
  onResetCount?: () => void;
  onAction: (action: CameraAction) => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
}

const TONE = {
  ready: { color: colors.primary, icon: 'checkmark-circle' },
  adjust: { color: colors.warning, icon: 'alert-circle' },
  info: { color: colors.textMuted, icon: 'information-circle' },
} as const;

/**
 * Training with the camera should feel like training with a coach who can see you: the exercise,
 * your set, the reps that counted, one line of feedback, how deep you went. The machinery (frame
 * rate, joint angles, movement phases) stays out of sight. Pure view: every number comes from the
 * rep engine; nothing shows a number it didn't measure.
 */
export function LiveCameraView(p: LiveCameraViewProps) {
  const { model, readout } = p;
  const rep = !p.paused ? (readout?.rep ?? null) : null;
  const tone = model.feedback ? TONE[model.feedback.tone] : null;
  const tracking = !p.paused && !!readout?.trackable;
  const verified = rep?.verifiedReps ?? 0;
  const rom = rep ? (rep.liveRomPercent ?? rep.lastRep?.romPercent ?? null) : null;
  const q = rep?.quality;
  const form = rep?.lastRep ? formWord(rep.lastRep.formScore) : null;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.column}>
        <View style={styles.topBar}>
          <IconButton icon="close" label="End camera" onPress={p.onEnd} color={colors.text} />
          <View style={{ flex: 1, alignItems: 'center' }}>
            <AppText variant="heading" header numberOfLines={1}>
              {p.exerciseName}
            </AppText>
            <AppText variant="caption" color={p.setLabel ? colors.primary : colors.textMuted}>
              {p.setLabel ? `${p.setLabel}${p.targetLabel ? ` · ${p.targetLabel}` : ''}` : 'Practice — nothing is logged'}
            </AppText>
          </View>
          <IconButton icon={p.paused ? 'play' : 'pause'} label={p.paused ? 'Resume' : 'Pause'} onPress={p.paused ? p.onResume : p.onPause} color={colors.text} />
        </View>

        <View style={styles.feed} accessible={!model.overlay} accessibilityLabel="Camera preview">
          {p.feed}
          {!model.overlay && !p.paused ? (
            <>
              <View style={styles.chips}>
                <View style={styles.chip}>
                  <Ionicons name="lock-closed" size={12} color={colors.text} />
                  <AppText variant="label">Private · not recorded</AppText>
                </View>
              </View>
              {rep ? (
                <View style={styles.counter} accessible accessibilityLabel={`${verified} verified ${verified === 1 ? 'rep' : 'reps'}`}>
                  <AppText variant="display" style={{ fontSize: 34, lineHeight: 38, fontVariant: ['tabular-nums'] }}>
                    {verified}
                  </AppText>
                  <AppText variant="label" color={colors.textMuted}>
                    {verified === 1 ? 'rep' : 'reps'}
                  </AppText>
                </View>
              ) : null}
              {tracking ? (
                <View style={styles.detected}>
                  <Ionicons name="body-outline" size={14} color={colors.primary} />
                  <AppText variant="label">Full body detected</AppText>
                </View>
              ) : null}
            </>
          ) : null}
          {model.overlay ? (
            <View style={styles.overlay}>
              <StateView
                kind={model.overlay.kind}
                title={model.overlay.title || undefined}
                message={model.overlay.message || undefined}
                actionLabel={model.overlay.actionLabel ?? undefined}
                onAction={model.overlay.action ? () => p.onAction(model.overlay!.action!) : undefined}
              />
              {model.overlay.action === 'start' ? (
                <AppText variant="caption" color={colors.textMuted} style={{ textAlign: 'center', paddingHorizontal: space.lg }}>
                  Setup: {p.setupText}
                </AppText>
              ) : null}
            </View>
          ) : p.paused ? (
            <View style={styles.overlay}>
              <StateView kind="empty" title="Paused" message="The camera is off while paused. Reps already verified in this set are kept." actionLabel="Resume" onAction={p.onResume} />
            </View>
          ) : null}
        </View>

        {model.feedback && tone ? (
          <View style={styles.feedback} accessible accessibilityLiveRegion="polite" accessibilityRole="alert">
            <Ionicons name={tone.icon} size={22} color={tone.color} />
            <View style={{ flex: 1 }}>
              {model.feedback.headline ? (
                <AppText variant="bodyStrong" color={tone.color}>
                  {sentence(model.feedback.headline)}
                </AppText>
              ) : null}
              <AppText variant={model.feedback.headline ? 'caption' : 'bodyStrong'} color={model.feedback.headline ? colors.textMuted : colors.text}>
                {model.feedback.message}
              </AppText>
            </View>
          </View>
        ) : null}

        <Row gap={space.lg} style={{ alignItems: 'flex-start' }}>
          <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`Verified reps: ${verified}. ${rep ? 'Only full-range reps count' : 'Not counting yet'}`}>
            <AppText variant="label" color={colors.textMuted}>
              Verified reps
            </AppText>
            <AppText variant="number" color={colors.primary}>
              {verified}
            </AppText>
            <AppText variant="caption" color={colors.textFaint}>
              {rep ? 'Full range only' : 'Not counting yet'}
            </AppText>
          </View>
          <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`Form: ${form ?? 'after your first rep'}${q?.averageFormScore != null ? `, average ${formWord(q.averageFormScore).toLowerCase()}` : ''}`}>
            <AppText variant="label" color={colors.textMuted}>
              Form
            </AppText>
            <AppText variant="heading" style={{ lineHeight: 36 }}>
              {form ?? '—'}
            </AppText>
            <AppText variant="caption" color={colors.textFaint}>
              {form ? 'Last rep' : 'After your first rep'}
            </AppText>
          </View>
        </Row>

        <View style={{ gap: 6 }} accessible accessibilityLabel={`Range of motion: ${rom === null ? 'none yet' : `${rom} percent`}`}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText variant="label" color={colors.textMuted}>
              Range of motion
            </AppText>
            <AppText variant="label" style={{ fontVariant: ['tabular-nums'] }}>
              {rom === null ? '—' : `${rom}%`}
            </AppText>
          </Row>
          <ProgressBar value={(rom ?? 0) / 100} color={rom !== null && rom < 90 ? colors.warning : colors.primary} height={8} />
        </View>

        {q && q.verifiedReps > 0 ? (
          <AppText variant="caption" color={colors.textMuted}>
            {`${q.verifiedReps} verified ${q.verifiedReps === 1 ? 'rep' : 'reps'} · ${q.perfectReps} perfect · average range ${q.averageRomPercent}%`}
          </AppText>
        ) : null}

        {p.logMessage ? <InlineMessage tone={p.logMessage.tone}>{p.logMessage.text}</InlineMessage> : null}
        {p.onLogSet ? (
          verified > 0 ? (
            <Button label={`Log set · ${verified} verified rep${verified === 1 ? '' : 's'}`} icon="checkmark" onPress={p.onLogSet} loading={p.logging} disabled={p.paused} />
          ) : (
            <Button label="Log reps manually" variant="secondary" icon="create-outline" onPress={p.onEnd} accessibilityHint="Closes the camera so you can enter reps yourself" />
          )
        ) : p.onResetCount ? (
          <Button label="Reset count" variant="secondary" icon="refresh" onPress={p.onResetCount} disabled={verified === 0 && !q?.attemptedReps} />
        ) : null}
      </View>
    </SafeAreaView>
  );
}

/** Coaching headlines arrive as "CORRECT FORM"; show them as a coach would say them. */
function sentence(s: string): string {
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  column: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', padding: space.lg, gap: space.lg },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  feed: { flex: 1, minHeight: 260, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000' },
  chips: { pointerEvents: 'none', position: 'absolute', top: space.md, left: space.md, flexDirection: 'row' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.55)' },
  counter: { pointerEvents: 'none', position: 'absolute', top: space.md, right: space.md, minWidth: 72, alignItems: 'center', paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.lg, backgroundColor: 'rgba(0,0,0,0.6)' },
  detected: { pointerEvents: 'none', position: 'absolute', bottom: space.md, left: space.md, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.6)' },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.surface, justifyContent: 'center', gap: space.sm },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.lg, minHeight: 60, backgroundColor: colors.card },
});
