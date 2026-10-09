import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { AppText, Button, Card, Field, InlineMessage, Row, Screen, Segmented } from '@/components/ui';
import type { BarcodeFoodDraft } from '@/lib/barcode';
import { uuid } from '@/lib/dates';
import { parseAmount } from '@/lib/eat';
import { useCreateUserFood } from '@/lib/queries';
import { colors, space } from '@/theme/tokens';

/** A barcode lookup's draft, if this screen was opened from the scanner (ignored if malformed). */
function readDraft(raw: string | undefined): BarcodeFoodDraft | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as BarcodeFoodDraft;
    return typeof d?.name === 'string' && (d.basis === 'g' || d.basis === 'ml') && typeof d.servingAmount === 'number' && d.perServing ? d : null;
  } catch {
    return null;
  }
}

const field = (n: number) => String(n);

/** Create a food from its package label: nutrition per serving plus the serving size. */
export default function NewFood() {
  const create = useCreateUserFood();
  const params = useLocalSearchParams<{ draft?: string }>();
  const [draft] = useState(() => readDraft(params.draft));
  const [clientFoodId] = useState(uuid);
  const [name, setName] = useState(draft?.name ?? '');
  const [brand, setBrand] = useState(draft?.brand ?? '');
  const [basis, setBasis] = useState<'g' | 'ml'>(draft?.basis ?? 'g');
  const [servingLabel, setServingLabel] = useState(draft?.servingLabel ?? '');
  const [servingAmount, setServingAmount] = useState(draft ? field(draft.servingAmount) : '');
  const [kcal, setKcal] = useState(draft ? field(draft.perServing.kcal) : '');
  const [p, setP] = useState(draft ? field(draft.perServing.proteinG) : '');
  const [c, setC] = useState(draft ? field(draft.perServing.carbsG) : '');
  const [f, setF] = useState(draft ? field(draft.perServing.fatG) : '');
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    setError(null);
    if (!name.trim()) return setError('Give the food a name.');
    const size = parseAmount(servingAmount);
    if (!Number.isFinite(size) || size <= 0) return setError(`Enter the serving size in ${basis}.`);
    const [k, pr, cb, ft] = [kcal, p, c, f].map((v) => (v.trim() === '' ? 0 : parseAmount(v)));
    if ([k, pr, cb, ft].some((v) => !Number.isFinite(v!) || v! < 0)) return setError('Nutrition values must be zero or more.');
    create.mutate(
      { clientFoodId, name: name.trim(), brand: brand.trim() || null, basis, servingLabel: servingLabel.trim(), servingAmount: size, perServing: { kcal: k!, proteinG: pr!, carbsG: cb!, fatG: ft! } },
      { onSuccess: () => router.back(), onError: (e) => setError(e.kind === 'network' ? "Couldn't save — check your connection." : e.message) },
    );
  };

  return (
    <Screen title="New food" subtitle={draft ? 'From a scanned barcode' : 'From the nutrition label'}>
      {draft ? (
        <InlineMessage tone="info" icon="barcode-outline">
          {`Filled in from Open Food Facts (barcode ${draft.code}). It's an open, volunteer-built database — check the numbers against your pack, then save.`}
        </InlineMessage>
      ) : null}
      <Card style={{ gap: space.md }}>
        <Field label="Name" value={name} onChangeText={setName} placeholder="e.g. Protein bar, chocolate" />
        <Field label="Brand (optional)" value={brand} onChangeText={setBrand} />
        <Segmented label="Measured in" options={[{ value: 'g', label: 'Grams (food)' }, { value: 'ml', label: 'Millilitres (drink)' }]} value={basis} onChange={setBasis} />
        <Row gap={space.md}>
          <Field label="Serving name" value={servingLabel} onChangeText={setServingLabel} placeholder="e.g. 1 bar" style={{ flex: 1 }} />
          <Field label={`Serving size (${basis})`} value={servingAmount} onChangeText={setServingAmount} keyboardType="decimal-pad" placeholder="e.g. 60" style={{ flex: 1 }} />
        </Row>
        <AppText variant="label" color={colors.textMuted}>
          Per serving
        </AppText>
        <Row gap={space.md}>
          <Field label="Calories" value={kcal} onChangeText={setKcal} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
          <Field label="Protein g" value={p} onChangeText={setP} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
        </Row>
        <Row gap={space.md}>
          <Field label="Carbs g" value={c} onChangeText={setC} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
          <Field label="Fat g" value={f} onChangeText={setF} keyboardType="decimal-pad" placeholder="0" style={{ flex: 1 }} />
        </Row>
        <AppText variant="caption" color={colors.textFaint}>
          Allergens aren&apos;t recorded for your own foods — always check the label.
        </AppText>
        {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
        <Button label="Save food" icon="checkmark" onPress={save} loading={create.isPending} />
      </Card>
    </Screen>
  );
}
