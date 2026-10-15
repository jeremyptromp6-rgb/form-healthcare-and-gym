import Ionicons from '@expo/vector-icons/Ionicons';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Buddy } from '@/components/art/Buddy';
import { AppText, Button, IconButton, Row } from '@/components/ui';
import { openPaywall } from '@/lib/pro';
import { useProWelcome } from '@/lib/proWelcome';
import type { BillingCatalog, BillingProduct } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';
import { annualSavingsPercent, splitFeatures } from './ProViews';

const perPeriod = (p: BillingProduct) => (p.plan === 'annual' ? 'year' : 'month');

/** "Monthly · $3.99/month" — straight from the store's prices, never typed in here. */
export function planLine(p: BillingProduct): string {
  return `${p.plan === 'annual' ? 'Yearly' : 'Monthly'} · ${p.price!.display}/${perPeriod(p)}`;
}

export interface ProWelcomeViewProps {
  catalog: BillingCatalog;
  onSeePlans: () => void;
  onClose: () => void;
}

/**
 * The one-time FORM Pro welcome. What Pro adds and what it costs, with a clear "Not now": a close
 * icon, a text button, the back button and a tap outside the card all just close it.
 */
export function ProWelcomeView({ catalog, onSeePlans, onClose }: ProWelcomeViewProps) {
  // The six headline benefits; the plans screen shows the rest and the Free comparison.
  const { headline: features, also } = splitFeatures(catalog.features);
  const plans = catalog.products.filter((p) => p.price);
  const savings = annualSavingsPercent(catalog.products);
  const trial = plans.find((p) => p.trialDays)?.trialDays ?? null;
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.scrim} testID="pro-welcome-scrim">
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessible={false} testID="pro-welcome-outside" />
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.closeRow}>
            <IconButton icon="close" label="Close" onPress={onClose} />
          </View>
          <ScrollView contentContainerStyle={{ gap: space.lg, alignItems: 'stretch' }} showsVerticalScrollIndicator={false} bounces={false}>
            <View style={{ alignItems: 'center', gap: space.sm }}>
              <Buddy mood="cheer" size={84} float={false} />
              <Row gap={space.xs}>
                <Ionicons name="star" size={14} color={colors.primary} />
                <AppText variant="overline" color={colors.primary}>
                  FORM Pro
                </AppText>
              </Row>
              <AppText variant="title" header style={{ textAlign: 'center' }}>
                Welcome to FORM
              </AppText>
              <AppText variant="body" color={colors.textMuted} style={{ textAlign: 'center' }}>
                Everything you need to start is free. FORM Pro adds more, when you are ready.
              </AppText>
            </View>

            <View style={{ gap: space.sm }} accessibilityRole="list">
              {features.map((f) => (
                <Row key={f.id} gap={space.md} style={{ alignItems: 'flex-start' }}>
                  <Ionicons name="checkmark-circle" size={20} color={colors.primary} style={{ marginTop: 2 }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="bodyStrong">{f.title}</AppText>
                    <AppText variant="caption" color={colors.textMuted}>
                      {f.pro}
                    </AppText>
                  </View>
                </Row>
              ))}
              {also.length ? (
                <AppText variant="caption" color={colors.textFaint}>
                  {`And ${also.length} more, plus what Free keeps, on the plans screen.`}
                </AppText>
              ) : null}
            </View>

            {plans.length ? (
              <View style={styles.plans}>
                {plans.map((p) => (
                  <AppText key={p.id} variant="bodyStrong" style={{ textAlign: 'center' }}>
                    {planLine(p)}
                  </AppText>
                ))}
                {savings || trial ? (
                  <AppText variant="caption" color={colors.textMuted} style={{ textAlign: 'center' }}>
                    {[trial ? `${trial}-day free trial` : null, savings ? `Yearly saves ${savings}%` : null].filter(Boolean).join(' · ')}
                  </AppText>
                ) : null}
              </View>
            ) : null}

            <View style={{ gap: space.sm }}>
              <Button label={trial ? 'Try Pro' : 'See plans'} iconRight="arrow-forward" onPress={onSeePlans} />
              <Button label="Not now" variant="ghost" onPress={onClose} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

/** Mounted on Home: shows the welcome once, at the right moment (see useProWelcome). */
export function ProWelcomeHost() {
  const { visible, catalog, dismiss } = useProWelcome();
  if (!visible || !catalog) return null;
  return (
    <ProWelcomeView
      catalog={catalog}
      onClose={dismiss}
      onSeePlans={() => {
        dismiss();
        openPaywall();
      }}
    />
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  card: { width: '100%', maxWidth: 400, maxHeight: '92%', backgroundColor: colors.card, borderRadius: radius.xl, padding: space.xl, paddingTop: space.md, gap: space.xs, borderWidth: 1, borderColor: colors.border },
  closeRow: { alignItems: 'flex-end' },
  plans: { gap: space.xs, padding: space.md, borderRadius: radius.md, backgroundColor: colors.primarySoft },
});
