import { KG_PLATES, LB_PLATES, platesPerSide } from '@form/domain';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { AppText, Button, IconButton, Segmented } from '@/components/ui';
import { barOptions } from '@/lib/barWeight';
import { loadToDisplay, loadUnit, type Units } from '@/lib/units';
import { colors, radius, space } from '@/theme/tokens';

/** Plate colours, heaviest first: the usual gym colour coding, taken from theme tokens. */
const plateColor = (rank: number) => [colors.danger, colors.water, colors.carbs, colors.success, colors.purple, colors.textMuted, colors.accent][rank % 7];

export interface PlateCalculatorSheetProps {
  visible: boolean;
  onClose: () => void;
  /** The load to build, kg (as stored). */
  loadKg: number;
  units: Units;
  /** Bar weight in display units. */
  bar: number;
  onChangeBar: (bar: number) => void;
}

/** "20 + 10 + 2.5", or null when no plates go on. */
export function eachSideText(perSide: number[]): string | null {
  return perSide.length ? perSide.join(' + ') : null;
}

/**
 * Plate calculator sheet: which plates go on each side of the bar for a load. A simple drawing of one
 * side of the bar with coloured plates, and the same thing in words ("Each side: 20 + 10 + 2.5").
 */
export function PlateCalculatorSheet({ visible, onClose, loadKg, units, bar, onChangeBar }: PlateCalculatorSheetProps) {
  const unit = loadUnit(units);
  const available = units === 'imperial' ? LB_PLATES : KG_PLATES;
  const target = loadToDisplay(loadKg, units);
  const r = platesPerSide(target, bar, available);
  const text = eachSideText(r.perSide);
  const biggest = available[0];
  const summary = r.belowBar
    ? `${target} ${unit} is lighter than the ${bar} ${unit} bar. Just the bar.`
    : text
      ? `Each side: ${text}`
      : 'Each side: no plates, just the bar';
  const detail = r.belowBar
    ? null
    : r.exact
      ? `${r.loaded} ${unit} on the bar`
      : `${r.loaded} ${unit} on the bar, ${r.remainder} ${unit} short of ${target} ${unit}. The plates can't make it exactly.`;

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.scrim}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} testID="plates-outside" />
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.head}>
            <AppText variant="title" header>
              Plates
            </AppText>
            <IconButton icon="close" label="Close plate calculator" onPress={onClose} />
          </View>
          <AppText variant="body" color={colors.textMuted}>
            {`Load ${target} ${unit} on a ${bar} ${unit} bar`}
          </AppText>

          {/* The drawing is decorative: the text below says the same thing. */}
          <View style={styles.drawing} accessible={false} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <View style={styles.collar} />
            <View style={styles.rod}>
              {r.perSide.map((p, i) => (
                <View
                  key={`${p}-${i}`}
                  style={[styles.plate, { height: 40 + Math.round(64 * (p / biggest)), width: p >= 10 ? 14 : 9, backgroundColor: plateColor(available.indexOf(p)) }]}
                  testID="plate"
                />
              ))}
              <View style={styles.tip} />
            </View>
          </View>

          <View style={{ gap: space.xs }} accessibilityLiveRegion="polite">
            <AppText variant="heading" accessibilityLabel={summary}>
              {summary}
            </AppText>
            {detail ? (
              <AppText variant="caption" color={r.exact ? colors.textMuted : colors.warning}>
                {detail}
              </AppText>
            ) : null}
          </View>

          <Segmented
            label="Bar weight"
            options={barOptions(units).map((b) => ({ value: String(b), label: `${b} ${unit}` }))}
            value={String(bar)}
            onChange={(v) => onChangeBar(Number(v))}
          />
          <Button label="Done" variant="secondary" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: space.xl, paddingTop: space.md, gap: space.lg, borderWidth: 1, borderColor: colors.border, width: '100%', maxWidth: 560, alignSelf: 'center' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  drawing: { flexDirection: 'row', alignItems: 'center', height: 120, justifyContent: 'flex-start', paddingVertical: space.xs },
  collar: { width: 10, height: 30, borderRadius: 3, backgroundColor: colors.borderStrong },
  rod: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 3, height: 120 },
  plate: { borderRadius: 4 },
  tip: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.borderStrong, minWidth: 24 },
});
