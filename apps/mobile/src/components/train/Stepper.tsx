import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui';
import { colors, radius, space } from '@/theme/tokens';

/** Large −/+ control for use mid-set: big targets, big number, no keyboard needed. */
export function Stepper({
  label,
  value,
  onChange,
  step = 1,
  min = 0,
  max = 200,
  unit,
  format = (v) => String(v),
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  unit?: string;
  format?: (v: number) => string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v * 100) / 100));
  return (
    <View style={styles.wrap} accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: `${format(value)}${unit ? ` ${unit}` : ''}` }}>
      <AppText variant="overline" color={colors.textMuted}>
        {label}
      </AppText>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} disabled={value <= min} onPress={() => onChange(clamp(value - step))} style={[styles.btn, value <= min && styles.disabled]}>
          <Ionicons name="remove" size={28} color={colors.text} />
        </Pressable>
        <View style={styles.valueBox}>
          <AppText variant="display" style={{ fontSize: 52, lineHeight: 58, fontVariant: ['tabular-nums'] }}>
            {format(value)}
          </AppText>
          {unit ? (
            <AppText variant="caption" color={colors.textMuted}>
              {unit}
            </AppText>
          ) : null}
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label}`} disabled={value >= max} onPress={() => onChange(clamp(value + step))} style={[styles.btn, styles.btnPlus, value >= max && styles.disabled]}>
          <Ionicons name="add" size={28} color={colors.onPrimary} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, gap: space.sm, alignItems: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  btn: { width: 58, height: 58, borderRadius: radius.pill, backgroundColor: colors.cardRaised, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  btnPlus: { backgroundColor: colors.primary, borderColor: colors.primary },
  disabled: { opacity: 0.35 },
  valueBox: { minWidth: 76, alignItems: 'center' },
});
