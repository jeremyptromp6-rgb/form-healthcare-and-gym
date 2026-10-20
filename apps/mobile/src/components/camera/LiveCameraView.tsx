import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText, Button, InlineMessage, ProgressBar, Row, StateView, type IconName } from '@/components/ui';
import { fitBox, feedAspect, isCompactCamera, panelMaxHeight, PANEL, topBarReserve, type FeedFit } from '@/lib/pose/cameraLayout';
import { trackingLabel, WAITING_TIP, type CameraAction, type CameraScreenModel, type GetReadyStep, type LiveReadout } from '@/lib/pose/status';
import { formWord } from '@/lib/workoutSession';
import { a11y, colors, MAX_CONTENT_WIDTH, palettes, radius, space } from '@/theme/tokens';
import { hudToneColor, type HudTone } from './skeletonTone';

export interface LiveCameraViewProps {
  /** Names what the framing check needs in view, for the tracking pill. */
  exerciseId: string;
  exerciseName: string;
  /** "Set 2 of 3" in a workout; null in practice mode. */
  setLabel: string | null;
  /** "8–12 reps"; null when there's no target. */
  targetLabel: string | null;
  setupText: string;
  model: CameraScreenModel;
  readout: LiveReadout | null;
  paused: boolean;
  /** The "get into position" countdown, while it runs: shown over the video, and no count shows while the numbers run. */
  getReady?: GetReadyStep | null;
  /** The camera feed element (platform-specific), rendered under the overlays. */
  feed: ReactNode;
  /**
   * `fill`: the feed is sized to the video area and shows exactly what it analyses (the native camera).
   * `aspect` (default): the feed gets a box with the video's own aspect, so nothing is cropped (WebView, web).
   */
  feedFit?: FeedFit;
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

/** The strip's icon per tone; its colour comes from skeletonTone, the same place the skeleton's does. */
const TONE_ICON = { ready: 'checkmark-circle', adjust: 'alert-circle', info: 'information-circle' } as const satisfies Record<HudTone, string>;
const toneOf = (t: HudTone) => ({ color: hudToneColor(colors, t), icon: TONE_ICON[t] });

/** Chips and the rep counter sit on the live video, so they use the Evening palette whatever the app's mood. */
const hud = palettes.dark;

/**
 * Training with the camera should feel like training with a coach who can see you: the exercise,
 * your set, the reps that counted, one line of feedback, how deep you went. The machinery (frame
 * rate, joint angles, movement phases) stays out of sight. Pure view: every number comes from the
 * rep engine; nothing shows a number it didn't measure.
 *
 * The video takes the screen; the controls float over its top edge as glass chips, and everything
 * else sits in a panel under it (never over it, so your feet are never hidden). On a short screen
 * or with large text the panel tightens, and if it still can't fit its middle scrolls.
 */
export function LiveCameraView(p: LiveCameraViewProps) {
  const { model, readout } = p;
  const win = useWindowDimensions();
  const compact = isCompactCamera(win.height, win.fontScale);
  const m = compact ? PANEL.compact : PANEL.regular;
  const [slot, setSlot] = useState<{ w: number; h: number } | null>(null);
  const getReady = p.getReady ?? null;
  // While the numbers count down nothing shows as counted (the brief "ready" that follows is just a label).
  const countingDown = typeof getReady === 'number';
  const rep = !p.paused && !countingDown ? (readout?.rep ?? null) : null;
  const tone = model.feedback ? toneOf(model.feedback.tone) : null;
  const tracking = !p.paused && !!readout?.trackable;
  const verified = rep?.verifiedReps ?? 0;
  const rom = rep ? (rep.liveRomPercent ?? rep.lastRep?.romPercent ?? null) : null;
  const q = rep?.quality;
  const form = rep?.lastRep ? formWord(rep.lastRep.formScore) : null;
  const reserve = topBarReserve(win.fontScale);

  // The fallback feed is boxed to the video's aspect (once the slot is measured); the native feed fills.
  const box = (p.feedFit ?? 'aspect') === 'aspect' && slot ? fitBox(slot.w, slot.h, feedAspect(readout?.frameAspect, win.width, win.height)) : null;
  const feedStyle = box ? { position: 'absolute' as const, left: box.left, top: box.top, width: box.width, height: box.height, overflow: 'hidden' as const } : StyleSheet.absoluteFill;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.column}>
        <View
          style={styles.slot}
          testID="camera-slot"
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout;
            setSlot((prev) => (prev && Math.abs(prev.w - width) < 0.5 && Math.abs(prev.h - height) < 0.5 ? prev : { w: width, h: height }));
          }}>
          {/* Never flattened: a wrapper that flips between flattened and real (as `accessible` or the box
              style change) makes React Native re-parent the camera view, which interrupts the camera. */}
          <View style={StyleSheet.absoluteFill} collapsable={false} accessible={!model.overlay} accessibilityLabel="Camera preview">
            <View style={feedStyle} collapsable={false} testID="camera-feed-box">
              {p.feed}
            </View>
            {!model.overlay && !p.paused ? (
              <>
                <View style={[styles.chips, { top: reserve }]}>
                  <View style={styles.chip}>
                    <Ionicons name="lock-closed" size={12} color={hud.textMuted} />
                    <AppText variant="label" color={hud.text}>
                      Private · not recorded
                    </AppText>
                  </View>
                </View>
                {rep ? (
                  <View style={[styles.counter, { top: reserve }]} accessible accessibilityLabel={`${verified} verified ${verified === 1 ? 'rep' : 'reps'}`}>
                    <AppText variant="valueLg" color={hud.text}>
                      {verified}
                    </AppText>
                    <AppText variant="label" color={hud.textMuted}>
                      {verified === 1 ? 'rep' : 'reps'}
                    </AppText>
                  </View>
                ) : null}
                {getReady !== null ? (
                  <View style={styles.countdownWrap}>
                    <View style={styles.countdown} testID="get-ready">
                      {getReady === 'ready' ? (
                        <AppText variant="heading" color={hud.text}>
                          Ready
                        </AppText>
                      ) : (
                        <>
                          <AppText variant="label" color={hud.textMuted}>
                            Get into position
                          </AppText>
                          <AppText variant="valueLg" color={hud.text}>
                            {String(getReady)}
                          </AppText>
                        </>
                      )}
                    </View>
                  </View>
                ) : null}
                {tracking && !countingDown ? (
                  <View style={styles.detected}>
                    <View style={styles.detectedDot} />
                    <Ionicons name="body-outline" size={14} color={hud.text} />
                    <AppText variant="label" color={hud.text} style={{ flexShrink: 1 }}>
                      {trackingLabel(p.exerciseId)}
                    </AppText>
                  </View>
                ) : null}
              </>
            ) : null}
            {model.overlay ? (
              <ScrollView style={styles.overlay} contentContainerStyle={[styles.overlayContent, { paddingTop: reserve }]}>
                {model.overlay.kind === 'loading' && model.overlay.title ? (
                  <LoadingCard title={model.overlay.title} message={model.overlay.message} progress={model.overlay.progress ?? null} tip={!!model.overlay.tip} />
                ) : (
                  <StateView
                    kind={model.overlay.kind}
                    title={model.overlay.title || undefined}
                    message={model.overlay.message || undefined}
                    actionLabel={model.overlay.actionLabel ?? undefined}
                    onAction={model.overlay.action ? () => p.onAction(model.overlay!.action!) : undefined}
                  />
                )}
                {model.overlay.action === 'start' ? (
                  <AppText variant="caption" color={colors.textMuted} style={{ textAlign: 'center', paddingHorizontal: space.lg }}>
                    Setup: {p.setupText}
                  </AppText>
                ) : null}
              </ScrollView>
            ) : p.paused ? (
              <ScrollView style={styles.overlay} contentContainerStyle={[styles.overlayContent, { paddingTop: reserve }]}>
                <StateView kind="empty" title="Paused" message="The camera is off while paused. Reps already verified in this set are kept." actionLabel="Resume" onAction={p.onResume} />
              </ScrollView>
            ) : null}
          </View>

          <View style={styles.topBar}>
            <HudButton icon="close" label="End camera" onPress={p.onEnd} />
            <View style={styles.title}>
              <AppText variant="heading" header numberOfLines={1} color={hud.text}>
                {p.exerciseName}
              </AppText>
              <AppText variant="caption" numberOfLines={1} color={p.setLabel ? hud.primary : hud.textMuted}>
                {p.setLabel ? `${p.setLabel}${p.targetLabel ? ` · ${p.targetLabel}` : ''}` : 'Practice — nothing is logged'}
              </AppText>
            </View>
            <HudButton icon={p.paused ? 'play' : 'pause'} label={p.paused ? 'Resume' : 'Pause'} onPress={p.paused ? p.onResume : p.onPause} />
          </View>
        </View>

        <View style={[styles.panel, { maxHeight: panelMaxHeight(win.height), paddingTop: m.padTop, paddingBottom: m.padBottom, gap: m.gap }]}>
          {model.feedback && tone ? (
            <View
              style={[styles.feedback, { borderColor: `${tone.color}33`, minHeight: m.feedbackMin, paddingVertical: m.feedbackPad }, compact && styles.feedbackCompact]}
              accessible
              accessibilityLiveRegion="polite"
              accessibilityRole="alert">
              {compact ? null : <View style={[styles.accent, { backgroundColor: tone.color }]} />}
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

          <ScrollView style={styles.panelScroll} contentContainerStyle={{ gap: m.gap }} showsVerticalScrollIndicator={false}>
            <Row gap={space.lg} style={{ alignItems: 'flex-start' }}>
              <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`Verified reps: ${verified}. ${rep ? 'Only full-range reps count' : 'Not counting yet'}`}>
                <AppText variant="label" color={colors.textMuted}>
                  Verified reps
                </AppText>
                <AppText variant={compact ? 'stat' : 'number'} color={colors.primary}>
                  {verified}
                </AppText>
                <AppText variant={compact ? 'label' : 'caption'} color={colors.textFaint}>
                  {rep ? 'Full range only' : 'Not counting yet'}
                </AppText>
              </View>
              <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`Form: ${form ?? 'after your first rep'}${q?.averageFormScore != null ? `, average ${formWord(q.averageFormScore).toLowerCase()}` : ''}`}>
                <AppText variant="label" color={colors.textMuted}>
                  Form
                </AppText>
                <AppText variant={compact ? 'stat' : 'heading'} style={compact ? undefined : { lineHeight: 36 }}>
                  {form ?? '—'}
                </AppText>
                <AppText variant={compact ? 'label' : 'caption'} color={colors.textFaint}>
                  {form ? 'Last rep' : 'After your first rep'}
                </AppText>
              </View>
            </Row>

            <View style={{ gap: m.bar - 2 }} accessible accessibilityLabel={`Range of motion: ${rom === null ? 'none yet' : `${rom} percent`}`}>
              <Row style={{ justifyContent: 'space-between' }}>
                <AppText variant="label" color={colors.textMuted}>
                  Range of motion
                </AppText>
                <AppText variant="label" style={{ fontVariant: ['tabular-nums'] }}>
                  {rom === null ? '—' : `${rom}%`}
                </AppText>
              </Row>
              <ProgressBar value={(rom ?? 0) / 100} color={rom !== null && rom < 90 ? colors.warning : colors.primary} height={m.bar} />
            </View>

            {q && q.verifiedReps > 0 ? (
              <AppText variant="caption" color={colors.textMuted}>
                {`${q.verifiedReps} verified ${q.verifiedReps === 1 ? 'rep' : 'reps'} · ${q.perfectReps} perfect · average range ${q.averageRomPercent}%`}
              </AppText>
            ) : null}
          </ScrollView>

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
      </View>
    </SafeAreaView>
  );
}

/** First-run waiting: what is happening, how far along it is (when it is known) and what to do meanwhile. */
function LoadingCard({ title, message, progress, tip }: { title: string; message: string; progress: number | null; tip: boolean }) {
  const pct = progress === null ? null : Math.round(progress * 100);
  return (
    <View style={styles.loadCard} accessibilityLiveRegion="polite">
      <Ionicons name="camera-outline" size={40} color={colors.primary} />
      <AppText variant="sectionTitle" header style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      <AppText variant="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
        {message}
      </AppText>
      {pct === null ? null : (
        <View style={{ alignSelf: 'stretch', gap: space.xs }}>
          <ProgressBar value={progress ?? 0} label="Camera coach download" />
          <AppText variant="label" color={colors.textMuted} style={{ textAlign: 'center', fontVariant: ['tabular-nums'] }}>
            {`${pct}%`}
          </AppText>
        </View>
      )}
      {tip ? (
        <View style={styles.loadTip}>
          <Ionicons name="information-circle" size={18} color={colors.textMuted} />
          <AppText variant="caption" color={colors.textMuted} style={{ flex: 1 }}>
            {WAITING_TIP}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** A round glass button for the top bar: it floats over the video, so it uses the Evening palette. */
function HudButton({ icon, label, onPress }: { icon: IconName; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [styles.hudButton, pressed && { backgroundColor: hud.cardRaised }]}>
      <Ionicons name={icon} size={20} color={hud.text} />
    </Pressable>
  );
}

/** Coaching headlines arrive as "CORRECT FORM"; show them as a coach would say them. */
function sentence(s: string): string {
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

const glass = `${hud.bg}CC`;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  column: { flex: 1, width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center' },
  // The video area: edge to edge, and everything the panel doesn't need.
  slot: { flex: 1, minHeight: 200, overflow: 'hidden', backgroundColor: hud.bg, borderBottomLeftRadius: radius.lg, borderBottomRightRadius: radius.lg },
  topBar: { pointerEvents: 'box-none', position: 'absolute', top: space.sm, left: space.md, right: space.md, flexDirection: 'row', alignItems: 'center', gap: space.sm },
  hudButton: { minWidth: a11y.minTouch, minHeight: a11y.minTouch, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: hud.hairline, backgroundColor: glass },
  title: { flex: 1, alignItems: 'center', paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.lg, borderWidth: 1, borderColor: hud.hairline, backgroundColor: glass },
  chips: { pointerEvents: 'box-none', position: 'absolute', left: space.md, gap: space.sm, alignItems: 'flex-start', maxWidth: '70%' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: hud.hairline, backgroundColor: glass },
  counter: { pointerEvents: 'none', position: 'absolute', right: space.md, minWidth: 76, alignItems: 'center', paddingTop: space.xs, paddingBottom: space.sm, paddingHorizontal: space.lg, borderRadius: radius.lg, borderWidth: 1, borderColor: hud.hairline, backgroundColor: `${hud.bg}D9` },
  detected: { pointerEvents: 'none', position: 'absolute', bottom: space.md, left: space.md, maxWidth: '85%', flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1, borderColor: hud.hairline, backgroundColor: glass },
  detectedDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: hudToneColor(hud, 'ready') },
  countdownWrap: { pointerEvents: 'none', ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  countdown: { minWidth: 120, alignItems: 'center', gap: space.xs, paddingVertical: space.md, paddingHorizontal: space.xl, borderRadius: radius.lg, borderWidth: 1, borderColor: hud.hairline, backgroundColor: `${hud.bg}D9` },
  loadCard: { alignItems: 'center', gap: space.md, alignSelf: 'center', width: '100%', maxWidth: 340, paddingHorizontal: space.lg },
  loadTip: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.card },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.surface },
  overlayContent: { flexGrow: 1, justifyContent: 'center', gap: space.sm, paddingBottom: space.md },
  // The bottom panel: the strip, the stats and the button. It keeps its natural height until the window can't spare it.
  panel: { paddingHorizontal: space.lg },
  panelScroll: { flexGrow: 0, flexShrink: 1 },
  feedback: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingRight: space.md, paddingLeft: space.sm, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden', backgroundColor: colors.card },
  feedbackCompact: { paddingLeft: space.md, gap: space.sm },
  accent: { width: 4, alignSelf: 'stretch', borderRadius: radius.pill },
});
