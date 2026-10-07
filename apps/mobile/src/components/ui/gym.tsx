import Ionicons from '@expo/vector-icons/Ionicons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { MUSCLE_LABEL, MuscleThumb, type Muscle } from '@/components/art/BodyMap';
import { colors, radius, space, type } from '@/theme/tokens';
import { ProgressBar } from './feedback';
import { AppText } from './text';

type IconName = ComponentProps<typeof Ionicons>['name'];

/**
 * The gym building blocks shared by every page: a strip of headline numbers, icon tabs, a search
 * pill, a muscle split list and the week's training days.
 */

export interface StatItem {
  label: string;
  value: string;
  unit?: string;
  /** A small accent for the number (e.g. a macro colour). */
  tint?: string;
}

/** Headline numbers side by side in one bordered strip — Duration | Volume | Sets. */
export function StatStrip({ items, style }: { items: StatItem[]; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.strip, style]}>
      {items.map((s, i) => (
        <View key={s.label} style={[styles.stripCell, i > 0 && styles.stripDivider]} accessible accessibilityLabel={`${s.label}: ${s.value}${s.unit ? ` ${s.unit}` : ''}`}>
          <AppText variant="label" color={colors.textMuted} numberOfLines={1} style={{ fontSize: 12 }}>
            {s.label}
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 3 }}>
            <AppText variant="heading" color={s.tint ?? colors.text} numberOfLines={1} style={{ fontSize: 20, lineHeight: 26, fontVariant: ['tabular-nums'] }}>
              {s.value}
            </AppText>
            {s.unit ? (
              <AppText variant="caption" color={colors.textFaint} style={{ fontSize: 12 }}>
                {s.unit}
              </AppText>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Segmented tabs with an icon over each label. */
export function IconTabs<T extends string>({ tabs, value, onChange, label }: { tabs: { value: T; label: string; icon: IconName }[]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <View style={styles.tabs} accessibilityRole="tablist" accessibilityLabel={label}>
      {tabs.map((t) => {
        const active = t.value === value;
        return (
          <Pressable
            key={t.value}
            accessibilityRole="tab"
            accessibilityLabel={t.label}
            accessibilityState={{ selected: active }}
            aria-selected={active}
            onPress={() => onChange(t.value)}
            style={[styles.tab, active && styles.tabActive]}>
            <Ionicons name={active ? (t.icon.replace('-outline', '') as IconName) : t.icon} size={18} color={active ? colors.primary : colors.textMuted} />
            <AppText variant="label" color={active ? colors.text : colors.textMuted}>
              {t.label}
            </AppText>
            {active ? <View style={styles.tabMark} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

/** A rounded search field with a magnifier. */
export function SearchPill({ value, onChangeText, placeholder, label }: { value: string; onChangeText: (v: string) => void; placeholder: string; label: string }) {
  return (
    <View style={styles.search}>
      <Ionicons name="search" size={18} color={colors.textFaint} />
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.primary}
        autoCorrect={false}
        style={[type.body as TextStyle, { flex: 1, color: colors.text, paddingVertical: 0, minHeight: 44 }]}
      />
      {value ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => onChangeText('')} hitSlop={8}>
          <Ionicons name="close-circle" size={18} color={colors.textFaint} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** A muscle split: each muscle's close-up, its name and a bar for its share. */
export function MuscleBars({ rows }: { rows: { muscle: Muscle; value: number; caption: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <View style={{ gap: space.md }}>
      {rows.map((r) => (
        <View key={r.muscle} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }} accessible accessibilityLabel={`${MUSCLE_LABEL[r.muscle]}: ${r.caption}`}>
          <MuscleThumb muscle={r.muscle} size={44} intensity={Math.max(0.35, r.value / max)} />
          <View style={{ flex: 1, gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <AppText variant="bodyStrong">{MUSCLE_LABEL[r.muscle]}</AppText>
              <AppText variant="label" color={colors.textMuted}>
                {r.caption}
              </AppText>
            </View>
            <ProgressBar value={r.value / max} height={6} color="#E0553E" />
          </View>
        </View>
      ))}
    </View>
  );
}

const DAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

/** Monday to Sunday: a filled circle for each day you trained, today ringed. */
export function WeekDays({ trained, todayIndex }: { trained: boolean[]; todayIndex: number }) {
  const count = trained.filter(Boolean).length;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }} accessible accessibilityLabel={`Trained ${count} ${count === 1 ? 'day' : 'days'} this week`}>
      {DAY_LETTERS.map((d, i) => (
        <View key={i} style={{ alignItems: 'center', gap: 6 }}>
          <View style={[styles.day, trained[i] && styles.dayDone, i === todayIndex && !trained[i] && styles.dayToday]}>
            {trained[i] ? <Ionicons name="barbell" size={14} color={colors.onPrimary} /> : null}
          </View>
          <AppText variant="label" color={i === todayIndex ? colors.text : colors.textFaint} style={{ fontSize: 12 }}>
            {d}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.wash, paddingVertical: space.sm },
  stripCell: { flex: 1, paddingHorizontal: space.md, gap: 2 },
  stripDivider: { borderLeftWidth: 1, borderLeftColor: colors.border },
  tabs: { flexDirection: 'row', backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 4 },
  tab: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: space.sm, borderRadius: radius.md, minHeight: 56, justifyContent: 'center' },
  tabActive: { backgroundColor: colors.primarySoft },
  tabMark: { position: 'absolute', bottom: 4, width: 18, height: 3, borderRadius: 2, backgroundColor: colors.primary },
  search: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.lg, borderRadius: radius.pill, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  day: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  dayDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayToday: { borderColor: colors.primary, borderWidth: 2 },
});
