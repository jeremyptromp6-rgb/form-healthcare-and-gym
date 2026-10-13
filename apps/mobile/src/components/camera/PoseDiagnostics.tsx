import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { LiveReadout, PoseDiag } from '@/lib/pose/status';
import { palettes, radius, space } from '@/theme/tokens';

/** The overlay lead choices (ms) the preview build offers while the look is being tuned on a real phone. */
export const LEAD_CHOICES = [0, 30, 60, 90] as const;

const hud = palettes.dark;
const mono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

const n = (v: number | null | undefined, digits = 0) => (typeof v === 'number' && Number.isFinite(v) ? v.toFixed(digits) : '–');

/** The readout's lines, plain text so a screenshot of the chip says everything. */
export function diagnosticsLines(diag: PoseDiag | null, readout: LiveReadout | null): string[] {
  if (!diag) {
    // Nothing from the feed (yet): the readout's own numbers are all there is.
    return [`engine –`, readout ? `fps ${n(readout.fps)} | latency ${n(readout.latencyMs)} ms` : 'fps – | latency – ms'];
  }
  const rung = diag.rung ? `outline:${diag.rung}` : 'outline:–';
  const lines = [`engine ${diag.engine} | ${diag.backend ?? '–'} | ${diag.variant ?? '–'} | ${rung}`];
  const second = [`fps ${n(diag.fps)}`];
  if (diag.engine === 'native') {
    second.push(`infer ${n(diag.inferMs)} ms`, `age p50 ${n(diag.ageP50)} / p95 ${n(diag.ageP95)} ms`);
  } else {
    // The WebView and web feeds report the engine's own latency through the readout.
    second.push(`latency ${n(readout?.latencyMs ?? diag.inferMs)} ms`);
  }
  lines.push(second.join(' | '));
  const third = [diag.region ? `region ${diag.region}` : null, diag.view ? `view ${diag.view}` : null, diag.mirrorX === undefined ? null : `mirror ${diag.mirrorX ? 'on' : 'off'}`, diag.leadMs === undefined ? null : `lead ${diag.leadMs}`].filter(Boolean);
  if (third.length) lines.push(third.join(' | '));
  return lines;
}

/**
 * Preview builds only (the caller renders it when `config.diagnostics` is on): a small dark chip
 * with how the live feed is performing, so one screenshot from a phone settles speed and alignment
 * questions. "Age" is the result's age when drawn, not photon-to-pixel latency. On the native feed
 * it also offers the overlay lead (ms) the video's own delay is tuned with.
 */
export function PoseDiagnostics({ diag, readout, leadMs, onLeadChange }: { diag: PoseDiag | null; readout: LiveReadout | null; leadMs?: number; onLeadChange?: (ms: number) => void }) {
  const lines = diagnosticsLines(diag, readout);
  const stepper = onLeadChange && diag?.engine === 'native';
  return (
    <View style={styles.chip} testID="pose-diagnostics">
      {lines.map((l) => (
        <Text key={l} style={styles.text}>
          {l}
        </Text>
      ))}
      {stepper ? (
        <View style={styles.stepper}>
          <Text style={styles.text}>lead</Text>
          {LEAD_CHOICES.map((ms) => {
            const on = (leadMs ?? diag?.leadMs) === ms;
            return (
              <Pressable key={ms} accessibilityRole="button" accessibilityLabel={`Overlay lead ${ms} milliseconds`} accessibilityState={{ selected: on }} hitSlop={10} onPress={() => onLeadChange(ms)} style={[styles.step, on && styles.stepOn]}>
                <Text style={[styles.text, on && styles.textOn]}>{ms}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignSelf: 'flex-start', maxWidth: '100%', gap: 1, paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm, borderWidth: 1, borderColor: hud.hairline, backgroundColor: `${hud.bg}B3` },
  text: { fontFamily: mono, fontSize: 10, lineHeight: 14, color: hud.textMuted },
  textOn: { color: hud.text },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: 2 },
  step: { minWidth: 28, alignItems: 'center', paddingVertical: 2, borderRadius: radius.pill, borderWidth: 1, borderColor: hud.hairline },
  stepOn: { backgroundColor: hud.primary, borderColor: hud.primary },
});
