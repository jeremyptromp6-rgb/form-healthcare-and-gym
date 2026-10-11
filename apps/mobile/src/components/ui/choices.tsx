import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Animated, Pressable, StyleSheet, TextInput, View, type TextStyle } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';
import { a11y, colors, edgeLight, radius, space, type } from '@/theme/tokens';
import { ICON_BUBBLE, stateIcon, type IconName } from './controls';
import { Row } from './layout';
import { AppText } from './text';

/** Large single-choice card (radio semantics). Use inside a view with accessibilityRole="radiogroup". */
export function ChoiceCard({
  title,
  description,
  icon,
  selected,
  onPress,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  selected: boolean;
  onPress: () => void;
}) {
  const reduce = useReducedMotion();
  const [scale] = useState(() => new Animated.Value(1));
  const bounce = () => {
    if (reduce) return;
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.97, duration: 70, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, useNativeDriver: true }),
    ]).start();
  };
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={title}
        accessibilityHint={description}
        accessibilityState={{ checked: selected }} aria-checked={selected}
        onPress={() => {
          bounce();
          onPress();
        }}
        style={({ pressed }) => [styles.card, selected && styles.cardSelected, pressed && { backgroundColor: selected ? colors.primarySoft : colors.cardRaised }]}>
        <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
          {icon ? (
            <View style={[styles.icon, selected && { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={stateIcon(icon, selected)} size={20} color={selected ? colors.primary : colors.textMuted} />
            </View>
          ) : null}
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong">{title}</AppText>
            {description ? (
              <AppText variant="caption" color={colors.textMuted}>
                {description}
              </AppText>
            ) : null}
          </View>
          <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={22} color={selected ? colors.primary : colors.textFaint} />
        </Row>
      </Pressable>
    </Animated.View>
  );
}

/** Multi-select chips (checkbox semantics). */
export function ChipGroup({
  label,
  options,
  selected,
  onToggle,
  tone = 'primary',
}: {
  label?: string;
  options: { key: string; label: string }[];
  selected: readonly string[];
  onToggle: (key: string) => void;
  tone?: 'primary' | 'danger';
}) {
  const active = tone === 'danger' ? { bg: colors.dangerSoft, border: colors.danger } : { bg: colors.primarySoft, border: colors.primary };
  return (
    <View style={{ gap: space.sm }} accessibilityLabel={label}>
      {label ? (
        <AppText variant="label" color={colors.textMuted}>
          {label}
        </AppText>
      ) : null}
      <View style={styles.chips}>
        {options.map((o) => {
          const on = selected.includes(o.key);
          return (
            <Pressable
              key={o.key}
              accessibilityRole="checkbox"
              accessibilityLabel={o.label}
              accessibilityState={{ checked: on }} aria-checked={on}
              onPress={() => onToggle(o.key)}
              hitSlop={{ top: 4, bottom: 4 }}
              style={({ pressed }) => [styles.chip, on ? { backgroundColor: active.bg, borderColor: active.border } : pressed && { backgroundColor: colors.cardRaised, borderColor: colors.borderStrong }, on && pressed && { opacity: 0.85 }]}>
              {/* Always drawn, so selecting never changes the chip's width: an outline circle, filled with a tick when on. */}
              <Ionicons name={stateIcon('checkmark-circle', on)} size={16} color={on ? active.border : colors.textFaint} />
              <AppText variant="caption" color={on ? colors.text : colors.textMuted}>
                {o.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Free-text list input: type and add, tap × to remove. Normalization happens on the server. */
export function TagInput({
  label,
  hint,
  items,
  onChange,
  placeholder,
  max,
  maxLength,
  tone = 'neutral',
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
  max: number;
  maxLength: number;
  tone?: 'neutral' | 'danger';
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = () => {
    const v = text.trim().replace(/\s+/g, ' ');
    if (!v) return;
    if (v.length > maxLength) return setError(`Keep each item under ${maxLength} characters.`);
    if (items.some((i) => i.toLowerCase() === v.toLowerCase())) return setError('Already added.');
    if (items.length >= max) return setError(`You can add up to ${max}.`);
    setError(null);
    onChange([...items, v]);
    setText('');
  };
  const fg = tone === 'danger' ? colors.danger : colors.textMuted;
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="label" color={colors.textMuted}>
        {label}
      </AppText>
      <Row gap={space.sm}>
        <TextInput
          accessibilityLabel={label}
          accessibilityHint={hint}
          value={text}
          onChangeText={setText}
          onSubmitEditing={add}
          placeholder={placeholder}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.primary}
          returnKeyType="done"
          blurOnSubmit={false}
          style={styles.input}
        />
        <Pressable accessibilityRole="button" accessibilityLabel={`Add to ${label}`} onPress={add} style={({ pressed }) => [styles.addButton, pressed && { backgroundColor: colors.primarySoft, borderColor: colors.primary }]}>
          <Ionicons name="add" size={20} color={colors.text} />
        </Pressable>
      </Row>
      {hint ? (
        <AppText variant="caption" color={colors.textFaint}>
          {hint}
        </AppText>
      ) : null}
      {error ? (
        <AppText variant="caption" color={colors.danger}>
          {error}
        </AppText>
      ) : null}
      {items.length > 0 ? (
        <View style={styles.chips}>
          {items.map((i) => (
            <View key={i} style={[styles.chip, tone === 'danger' && { borderColor: colors.danger, backgroundColor: colors.dangerSoft }]}>
              <AppText variant="caption">{i}</AppText>
              <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${i}`} hitSlop={12} onPress={() => onChange(items.filter((x) => x !== i))}>
                <Ionicons name="close" size={14} color={fg} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The lit top edge (dark mode) is a side colour, so a selected card has to claim its top edge too.
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg, ...edgeLight },
  cardSelected: { borderColor: colors.primary, borderTopColor: colors.primary, backgroundColor: colors.primarySoft },
  icon: { width: ICON_BUBBLE.md, height: ICON_BUBBLE.md, borderRadius: ICON_BUBBLE.md / 2, backgroundColor: colors.cardRaised, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: a11y.minTouch - 8,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  input: {
    flex: 1,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 48,
    color: colors.text,
    ...(type.body as TextStyle),
  },
  addButton: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.cardRaised,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
