import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Animated, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useReducedMotion } from '@/lib/a11y';
import { a11y, colors, radius, space } from '@/theme/tokens';
import { type IconName } from './controls';
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
        style={[styles.card, selected && styles.cardSelected]}>
        <Row gap={space.md} style={{ alignItems: 'flex-start' }}>
          {icon ? (
            <View style={[styles.icon, selected && { backgroundColor: colors.primarySoft }]}>
              <Ionicons name={icon} size={20} color={selected ? colors.primary : colors.textMuted} />
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
              style={[styles.chip, on && { backgroundColor: active.bg, borderColor: active.border }]}>
              {on ? <Ionicons name="checkmark" size={14} color={active.border} /> : null}
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
        <Pressable accessibilityRole="button" accessibilityLabel={`Add to ${label}`} onPress={add} style={styles.addButton}>
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
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: radius.lg, padding: space.lg },
  cardSelected: { borderColor: colors.primary, backgroundColor: 'rgba(214,104,66,0.08)' },
  icon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.cardRaised, alignItems: 'center', justifyContent: 'center' },
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
    fontSize: 16,
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
