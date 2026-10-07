import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Card, InlineMessage, type IconName } from '@/components/ui';
import { appliesImmediately, applyThemeNow, readThemePreference, writeThemePreference, type ThemePreference } from '@/theme/appearance';
import { allGradients, colors, palettes, radius, scheme, space } from '@/theme/tokens';

const CHOICES: { value: ThemePreference; label: string; icon: IconName }[] = [
  { value: 'system', label: 'Device', icon: 'phone-portrait-outline' },
  { value: 'light', label: 'Morning', icon: 'sunny' },
  { value: 'dark', label: 'Evening', icon: 'moon' },
];

/** A tiny picture of the app in one mood: the page, a hero glow, a card with a ring. */
function Swatch({ mood }: { mood: 'light' | 'dark' }) {
  const p = palettes[mood];
  return (
    <View style={[styles.swatch, { backgroundColor: p.bg }]}>
      <LinearGradient colors={allGradients[mood].heroMedia} style={styles.swatchHero}>
        <View style={[styles.swatchSun, { backgroundColor: mood === 'dark' ? '#F6E3C2' : '#F5A65B' }]} />
      </LinearGradient>
      <View style={[styles.swatchCard, { backgroundColor: p.card, borderColor: p.border }]}>
        <View style={[styles.swatchRing, { borderColor: p.accent }]} />
        <View style={{ flex: 1, gap: 3 }}>
          <View style={[styles.swatchLine, { backgroundColor: p.text, width: '70%' }]} />
          <View style={[styles.swatchLine, { backgroundColor: p.textFaint, width: '45%' }]} />
        </View>
      </View>
      <View style={[styles.swatchButton, { backgroundColor: p.primary }]} />
    </View>
  );
}

/** Morning (light), Evening (dark) or match the device — each shown as a little preview. */
export function AppearancePicker() {
  const [choice, setChoice] = useState<ThemePreference>(readThemePreference);
  const [pending, setPending] = useState(false);
  const pick = (v: ThemePreference) => {
    setChoice(v);
    writeThemePreference(v);
    if (appliesImmediately) applyThemeNow();
    else setPending(true);
  };
  return (
    <Card style={{ gap: space.md }}>
      <View style={{ flexDirection: 'row', gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Appearance">
        {CHOICES.map((c) => {
          const active = c.value === choice;
          return (
            <Pressable
              key={c.value}
              accessibilityRole="radio"
              accessibilityLabel={c.label}
              accessibilityState={{ checked: active }}
              aria-checked={active}
              onPress={() => pick(c.value)}
              style={({ pressed }) => [styles.choice, active && styles.choiceActive, { opacity: pressed ? 0.85 : 1 }]}>
              {c.value === 'system' ? (
                <View style={styles.split}>
                  <View style={{ flex: 1, overflow: 'hidden' }}>
                    <Swatch mood="light" />
                  </View>
                  <View style={{ flex: 1, overflow: 'hidden' }}>
                    <Swatch mood="dark" />
                  </View>
                </View>
              ) : (
                <Swatch mood={c.value} />
              )}
              <View style={styles.choiceLabel}>
                <Ionicons name={c.icon} size={14} color={active ? colors.primary : colors.textMuted} />
                <AppText variant="label" color={active ? colors.text : colors.textMuted} numberOfLines={1}>
                  {c.label}
                </AppText>
              </View>
            </Pressable>
          );
        })}
      </View>
      <AppText variant="caption" color={colors.textFaint}>
        {`Morning is warm cream; Evening is cosy espresso with a moonlit sky. You're seeing ${scheme === 'dark' ? 'Evening' : 'Morning'} now.`}
      </AppText>
      {pending ? (
        <InlineMessage tone="success" icon="checkmark-circle">
          Saved — close and reopen FORM to see your new look.
        </InlineMessage>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  choice: { flex: 1, gap: space.sm, padding: 6, borderRadius: radius.md, borderWidth: 2, borderColor: colors.border, backgroundColor: colors.cardRaised },
  choiceActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceLabel: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingBottom: 2 },
  split: { flexDirection: 'row', borderRadius: radius.sm, overflow: 'hidden' },
  swatch: { height: 96, borderRadius: radius.sm, padding: 6, gap: 5, overflow: 'hidden' },
  swatchHero: { height: 30, borderRadius: 8, alignItems: 'flex-end', padding: 5 },
  swatchSun: { width: 14, height: 14, borderRadius: 7 },
  swatchCard: { flexDirection: 'row', alignItems: 'center', gap: 5, padding: 5, borderRadius: 8, borderWidth: 1 },
  swatchRing: { width: 14, height: 14, borderRadius: 7, borderWidth: 3 },
  swatchLine: { height: 4, borderRadius: 2 },
  swatchButton: { height: 10, borderRadius: 5, marginHorizontal: 6 },
});
