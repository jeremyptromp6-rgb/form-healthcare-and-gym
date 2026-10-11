import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';
import { a11y, colors, edgeLight, elevation, glow, radius, space, type } from '@/theme/tokens';
import { Row } from './layout';
import { AppText } from './text';

export type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * The icon rule: outline at rest, filled when active, selected or earned. Maps `x-outline` and `x`
 * both ways. When the wanted variant doesn't exist the name is kept as given (or its other form),
 * so a state change never turns into a missing glyph.
 */
export function stateIcon(name: string, filled: boolean): IconName {
  const has = (n: string) => n in Ionicons.glyphMap;
  const base = name.replace(/-outline$/, '');
  const wanted = filled ? base : `${base}-outline`;
  if (has(wanted)) return wanted as IconName;
  if (has(name)) return name as IconName;
  if (has(base)) return base as IconName;
  return name as IconName;
}

/** The IconBubble size scale: small (compact rows), medium (rows, the default), large (feature rows). */
export const ICON_BUBBLE = { sm: 32, md: 40, lg: 48 } as const;

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

/** Resting, pressed and disabled look of each variant. Every variant keeps a 1px border, so pressing never shifts layout. */
function buttonLook(variant: ButtonVariant, pressed: boolean, disabled: boolean) {
  if (disabled) {
    // Not an opacity fade: a quiet raised fill with faint text, which still reads at 4.5:1.
    return { bg: variant === 'ghost' ? 'transparent' : colors.cardRaised, border: variant === 'ghost' ? 'transparent' : colors.border, fg: colors.textFaint };
  }
  switch (variant) {
    case 'primary':
      return { bg: pressed ? colors.primaryDeep : colors.primary, border: pressed ? colors.primaryDeep : colors.primary, fg: colors.onPrimary };
    case 'secondary':
      return { bg: pressed ? colors.cardRaised : colors.card, border: colors.borderStrong, fg: colors.text };
    case 'ghost':
      return { bg: pressed ? colors.cardRaised : 'transparent', border: pressed ? colors.borderStrong : 'transparent', fg: colors.text };
    case 'danger':
      return { bg: pressed ? `${colors.danger}33` : colors.dangerSoft, border: `${colors.danger}${pressed ? '66' : '40'}`, fg: colors.danger };
  }
}

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
  variant?: ButtonVariant;
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
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }} aria-disabled={!!inactive} aria-busy={!!loading}
      disabled={!!inactive}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [{ transform: [{ scale: pressed && !reduceMotion ? 0.98 : 1 }] }, style]}>
      {({ pressed }) => {
        // A loading button keeps its look (the spinner says "busy"); only a disabled one goes quiet.
        const look = buttonLook(variant, pressed, !!disabled);
        const raised = variant === 'primary' && !disabled;
        return (
          <View
            style={[
              styles.button,
              { backgroundColor: look.bg, borderColor: look.border },
              // Lifted at rest, pressed down toward the page; the dark-mode glow goes with the lift.
              raised && (pressed ? elevation.card : [elevation.lifted, glow(colors.primary)]),
              variant === 'secondary' && !disabled && edgeLight,
            ]}>
            <Row gap={space.sm} style={{ justifyContent: 'center' }}>
              {loading ? <ActivityIndicator color={look.fg} size="small" /> : icon ? <Ionicons name={icon} size={18} color={look.fg} /> : null}
              <AppText variant="bodyStrong" color={look.fg}>
                {label}
              </AppText>
              {iconRight && !loading ? <Ionicons name={iconRight} size={18} color={look.fg} /> : null}
            </Row>
          </View>
        );
      }}
    </Pressable>
  );
}

/** Icon-only button with a guaranteed touch target and a required screen-reader label. `active` fills the icon (the icon rule). */
export function IconButton({ icon, label, onPress, color = colors.textFaint, active }: { icon: IconName; label: string; onPress: () => void; color?: string; active?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: colors.cardRaised }]}>
      <Ionicons name={active === undefined ? icon : stateIcon(icon, active)} size={18} color={color} />
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

/** Segment labels are caption-sized: the caption scale on the body faces (strong when selected). */
const SEGMENT_IDLE = { ...type.body, fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight };
const SEGMENT_ACTIVE = { ...type.bodyStrong, fontSize: type.caption.fontSize, lineHeight: type.caption.lineHeight };

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  /** `icon` is optional: shown outline at rest and filled on the selected segment. */
  options: { value: T; label: string; icon?: IconName }[];
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
              style={({ pressed }) => [styles.segment, active ? styles.segmentActive : pressed && { backgroundColor: colors.cardRaised }]}>
              {o.icon ? <Ionicons name={stateIcon(o.icon, active)} size={16} color={active ? colors.primary : colors.textMuted} /> : null}
              <Text style={[(active ? SEGMENT_ACTIVE : SEGMENT_IDLE) as TextStyle, { color: active ? colors.text : colors.textMuted }]}>{o.label}</Text>
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
  button: { minHeight: 52, borderRadius: radius.pill, borderWidth: 1, paddingHorizontal: space.xl, justifyContent: 'center' },
  iconButton: { minWidth: a11y.minTouch, minHeight: a11y.minTouch, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.borderStrong,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 50,
    color: colors.text,
    ...(type.body as TextStyle),
  },
  segmented: { flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.pill, padding: 4, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.hairline },
  // The 1px border is always there (transparent when idle) so selecting never shifts the label.
  segment: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    minHeight: a11y.minTouch,
    paddingVertical: 7,
    paddingHorizontal: space.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  segmentActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
});
