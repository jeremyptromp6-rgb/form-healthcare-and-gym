import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';
import { a11y, colors, radius, shadow, space, type } from '@/theme/tokens';
import { Row } from './layout';
import { AppText } from './text';

export type IconName = ComponentProps<typeof Ionicons>['name'];

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  iconRight,
  loading,
  disabled,
  style,
  accessibilityHint,
}: {
  label: string;
  onPress?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  icon?: IconName;
  /** A trailing icon — usually an arrow on the one action that moves the user forward. */
  iconRight?: IconName;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
}) {
  const reduceMotion = useReducedMotion();
  const inactive = disabled || loading;
  const fg = variant === 'primary' ? colors.onPrimary : variant === 'danger' ? colors.danger : colors.text;
  const content = (
    <Row gap={space.sm} style={{ justifyContent: 'center' }}>
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon ? <Ionicons name={icon} size={18} color={fg} /> : null}
      <AppText variant="bodyStrong" color={fg}>
        {label}
      </AppText>
      {iconRight && !loading ? <Ionicons name={iconRight} size={18} color={fg} /> : null}
    </Row>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }} aria-disabled={!!inactive} aria-busy={!!loading}
      disabled={!!inactive}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [{ opacity: inactive ? 0.45 : pressed ? 0.85 : 1, transform: [{ scale: pressed && !reduceMotion ? 0.98 : 1 }] }, style]}>
      <View
        style={[
          styles.button,
          variant === 'primary' && { backgroundColor: colors.primary, ...shadow.card, shadowColor: colors.primary, shadowOpacity: 0.28 },
          variant === 'secondary' && { backgroundColor: colors.card, borderColor: colors.borderStrong, borderWidth: 1 },
          variant === 'danger' && { backgroundColor: colors.dangerSoft },
        ]}>
        {content}
      </View>
    </Pressable>
  );
}

/** Icon-only button with a guaranteed touch target and a required screen-reader label. */
export function IconButton({ icon, label, onPress, color = colors.textFaint }: { icon: IconName; label: string; onPress: () => void; color?: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.iconButton}>
      <Ionicons name={icon} size={18} color={color} />
    </Pressable>
  );
}

export function Field({ label, hint, error, style, ...input }: TextInputProps & { label: string; hint?: string; error?: string }) {
  return (
    <View style={[{ gap: space.xs }, style as StyleProp<ViewStyle>]}>
      <AppText variant="label" color={colors.textMuted}>
        {label}
      </AppText>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error ?? hint}
        aria-invalid={error ? true : undefined}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.primary}
        style={[styles.input, error ? { borderColor: colors.danger } : null]}
        {...input}
      />
      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : hint ? (
        <AppText variant="caption" color={colors.textFaint}>
          {hint}
        </AppText>
      ) : null}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <View style={{ gap: space.xs }} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {label ? (
        <AppText variant="label" color={colors.textMuted}>
          {label}
        </AppText>
      ) : null}
      <View style={styles.segmented}>
        {options.map((o) => {
          const active = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ checked: active }} aria-checked={active}
              onPress={() => onChange(o.value)}
              style={[styles.segment, active && styles.segmentActive]}>
              <Text style={[(active ? type.bodyStrong : type.body) as TextStyle, { color: active ? colors.onPrimary : colors.textMuted, fontSize: 14 }]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function Toggle({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Row style={{ justifyContent: 'space-between', minHeight: a11y.minTouch }}>
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="body">{label}</AppText>
        {description ? (
          <AppText variant="caption" color={colors.textMuted}>
            {description}
          </AppText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={description}
        value={value}
        onValueChange={onChange}
        disabled={disabled}
        trackColor={{ true: colors.primaryDeep, false: colors.borderStrong }}
        thumbColor={colors.text}
      />
    </Row>
  );
}

const styles = StyleSheet.create({
  button: { minHeight: 52, borderRadius: radius.pill, paddingHorizontal: space.xl, justifyContent: 'center' },
  iconButton: { minWidth: a11y.minTouch, minHeight: a11y.minTouch, alignItems: 'center', justifyContent: 'center' },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 50,
    color: colors.text,
    ...(type.body as TextStyle),
    fontSize: 16,
  },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  segment: { flex: 1, minHeight: 40, paddingVertical: 8, paddingHorizontal: space.xs, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill },
  segmentActive: { backgroundColor: colors.primary },
});
