import Ionicons from '@expo/vector-icons/Ionicons';
import { Linking, Pressable, View } from 'react-native';
import { AppText, Badge, Button, Card, ChoiceCard, InlineMessage, Row } from '@/components/ui';
import { STATE_LABEL, statusLine } from '@/lib/pro';
import type { BillingCatalog, BillingProduct, Entitlements, PremiumFeature, PremiumFeatureId } from '@/lib/types';
import { colors, radius, space } from '@/theme/tokens';

/**
 * FORM Pro UI. Pure views: what Pro adds and what Free keeps, the plans the store actually offers
 * (prices and trials come from the provider, never hard-coded), and the subscription's real state.
 * No countdowns, pre-ticked upsells or hidden close buttons.
 */

/** A locked Pro feature, where it would appear: what it does, what Free keeps, and a way to see Pro. */
export function ProUpsell({ feature, title, pro, free, onOpen, compact }: { feature: PremiumFeatureId; title: string; pro: string; free?: string; onOpen: (feature: PremiumFeatureId) => void; compact?: boolean }) {
  return (
    <Card variant="raised" style={{ gap: space.sm, borderWidth: 1, borderColor: colors.primarySoft }}>
      <Row gap={space.sm}>
        <Ionicons name="star" size={14} color={colors.primary} />
        <AppText variant="label" color={colors.primary}>
          FORM Pro
        </AppText>
      </Row>
      <AppText variant="heading">{title}</AppText>
      {!compact ? (
        <AppText variant="body" color={colors.textMuted}>
          {pro}
        </AppText>
      ) : null}
      {free && !compact ? (
        <AppText variant="caption" color={colors.textFaint}>
          On Free: {free}
        </AppText>
      ) : null}
      <Button label="See FORM Pro" variant="secondary" onPress={() => onOpen(feature)} />
    </Card>
  );
}

const perPeriod = (p: BillingProduct) => (p.plan === 'annual' ? '/year' : '/month');

/** Savings of the annual plan against twelve months, from the provider's own prices. */
export function annualSavingsPercent(products: BillingProduct[]): number | null {
  const m = products.find((p) => p.plan === 'monthly')?.price;
  const a = products.find((p) => p.plan === 'annual')?.price;
  if (!m || !a || m.currency !== a.currency || m.amount <= 0) return null;
  const pct = Math.round((1 - a.amount / (m.amount * 12)) * 100);
  return pct > 0 ? pct : null;
}

export interface PaywallViewProps {
  catalog: BillingCatalog;
  entitlements: Entitlements;
  /** The feature that brought the user here, highlighted first. */
  feature: PremiumFeatureId | null;
  plan: 'monthly' | 'annual';
  onPlan: (plan: 'monthly' | 'annual') => void;
  support: { available: true; environment: 'development' } | { available: false; reason: string };
  onPurchase: (productId: string) => void;
  onRestore: () => void;
  busy: 'purchase' | 'restore' | null;
  error: string | null;
  notice: string | null;
  /** Development store only: sandbox controls for the subscription's lifecycle. */
  onSimulate?: (event: string) => void;
}

const SIMULATIONS: { event: string; label: string }[] = [
  { event: 'renew', label: 'Renew' },
  { event: 'cancel', label: 'Cancel renewal' },
  { event: 'resume', label: 'Resume' },
  { event: 'billing_issue', label: 'Payment fails' },
  { event: 'grace_expired', label: 'Grace ends' },
  { event: 'recover', label: 'Payment recovers' },
  { event: 'expire', label: 'Expire' },
  { event: 'refund', label: 'Refund' },
];

function FeatureRow({ f, highlighted }: { f: PremiumFeature; highlighted: boolean }) {
  return (
    <Row gap={space.md} style={{ alignItems: 'flex-start', padding: space.sm, borderRadius: radius.md, backgroundColor: highlighted ? colors.primarySoft : 'transparent' }}>
      <Ionicons name="checkmark-circle" size={20} color={colors.primary} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodyStrong">{f.title}</AppText>
        <AppText variant="caption" color={colors.textMuted}>
          {f.pro}
        </AppText>
        <AppText variant="caption" color={colors.textFaint}>
          Free: {f.free}
        </AppText>
      </View>
    </Row>
  );
}

export function PaywallView(p: PaywallViewProps) {
  const { catalog, entitlements: e } = p;
  const pro = e.tier === 'pro';
  const features = [...catalog.features].sort((a, b) => Number(b.id === p.feature) - Number(a.id === p.feature));
  const products = catalog.products;
  const selected = products.find((x) => x.plan === p.plan) ?? products[0] ?? null;
  const savings = annualSavingsPercent(products);
  const dev = catalog.provider.environment === 'development';
  const status = statusLine(e);
  const legal = catalog.legal;

  return (
    <View style={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <AppText variant="overline" color={colors.primary}>
          FORM Pro
        </AppText>
        <AppText variant="title" header>
          Training that adapts to you.
        </AppText>
        <AppText variant="body" color={colors.textMuted}>
          Coaching, training, nutrition and progress that learn from your own reps, form and food — and progress you only when you&apos;ve earned it.
        </AppText>
      </View>

      {dev ? (
        <InlineMessage tone="warning" icon="construct-outline">
          Development store — sandbox purchases for testing. No real payment is taken.
        </InlineMessage>
      ) : null}

      {pro || e.state === 'PRO_BILLING_ISSUE' || e.state === 'PRO_EXPIRED' ? (
        <Card variant="raised" style={{ gap: space.sm }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <AppText variant="heading">Your plan</AppText>
            <Badge label={STATE_LABEL[e.state]} tone={pro ? 'primary' : 'warning'} />
          </Row>
          {status ? <AppText variant="body">{status}</AppText> : null}
          {pro && catalog.manageUrl ? <Button label="Manage subscription" variant="secondary" icon="open-outline" onPress={() => Linking.openURL(catalog.manageUrl!).catch(() => undefined)} /> : null}
          {pro && !catalog.manageUrl && !dev ? (
            <AppText variant="caption" color={colors.textMuted}>
              Manage or cancel it in the store you subscribed with.
            </AppText>
          ) : null}
        </Card>
      ) : null}

      <View style={{ gap: space.xs }} accessibilityRole="list">
        {features.map((f) => (
          <FeatureRow key={f.id} f={f} highlighted={f.id === p.feature} />
        ))}
      </View>

      {!pro ? (
        <View style={{ gap: space.md }}>
          {products.length ? (
            <View style={{ gap: space.sm }} accessibilityRole="radiogroup" accessibilityLabel="Choose a plan">
              {products.map((x) => (
                <ChoiceCard
                  key={x.id}
                  title={`${x.plan === 'annual' ? 'Yearly' : 'Monthly'} · ${x.price!.display}${perPeriod(x)}`}
                  description={[x.trialDays ? `${x.trialDays}-day free trial` : null, x.plan === 'annual' && savings ? `Save ${savings}% vs monthly` : null].filter(Boolean).join(' · ') || undefined}
                  selected={selected?.id === x.id}
                  onPress={() => p.onPlan(x.plan)}
                />
              ))}
            </View>
          ) : null}
          {p.support.available && selected ? (
            <Button
              label={selected.trialDays ? `Start ${selected.trialDays}-day free trial` : `Subscribe · ${selected.price!.display}${perPeriod(selected)}`}
              onPress={() => p.onPurchase(selected.id)}
              loading={p.busy === 'purchase'}
              disabled={p.busy !== null}
            />
          ) : (
            <InlineMessage tone="info" icon="information-circle-outline">
              {p.support.available ? 'No plans are available right now.' : p.support.reason}
            </InlineMessage>
          )}
          {selected ? (
            <AppText variant="caption" color={colors.textFaint}>
              {selected.trialDays ? `After the free trial, ${selected.price!.display}${perPeriod(selected)}. ` : ''}Renews automatically until you cancel in your store account. Cancel any time — you keep Pro until the end of the period you paid for, and everything you logged stays yours.
            </AppText>
          ) : null}
        </View>
      ) : null}

      {p.support.available ? <Button label="Restore purchases" variant="ghost" onPress={p.onRestore} loading={p.busy === 'restore'} disabled={p.busy !== null} /> : null}
      {p.error ? <InlineMessage tone="danger">{p.error}</InlineMessage> : null}
      {p.notice ? <InlineMessage tone="success">{p.notice}</InlineMessage> : null}

      {legal.termsUrl || legal.privacyUrl ? (
        <Row gap={space.lg} style={{ justifyContent: 'center' }}>
          {legal.termsUrl ? (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(legal.termsUrl!).catch(() => undefined)} hitSlop={12}>
              <AppText variant="caption" color={colors.textMuted}>
                Terms
              </AppText>
            </Pressable>
          ) : null}
          {legal.privacyUrl ? (
            <Pressable accessibilityRole="link" onPress={() => Linking.openURL(legal.privacyUrl!).catch(() => undefined)} hitSlop={12}>
              <AppText variant="caption" color={colors.textMuted}>
                Privacy policy
              </AppText>
            </Pressable>
          ) : null}
        </Row>
      ) : null}

      {dev && p.onSimulate && (pro || e.source === 'development') ? (
        <Card style={{ gap: space.sm }}>
          <AppText variant="label" color={colors.textMuted}>
            Sandbox lifecycle (development only)
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {SIMULATIONS.map((s) => (
              <Button key={s.event} label={s.label} variant="secondary" onPress={() => p.onSimulate!(s.event)} disabled={p.busy !== null} style={{ flexGrow: 1 }} />
            ))}
          </View>
        </Card>
      ) : null}
    </View>
  );
}
