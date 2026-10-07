import { router } from 'expo-router';
import { useState } from 'react';
import { AppText, Button, Card, Field, InlineMessage, Row, Screen, Segmented } from '@/components/ui';
import { uuid } from '@/lib/dates';
import { parseAmount } from '@/lib/eat';
import { useCreateUserFood } from '@/lib/queries';
import { colors, space } from '@/theme/tokens';

/** Create a food from its package label: nutrition per serving plus the serving size. */
export default function NewFood() {
  const create = useCreateUserFood();
  const [clientFoodId] = useState(uuid);
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [basis, setBasis] = useState<'g' | 'ml'>('g');
  const [servingLabel, setServingLabel] = useState('');
  const [servingAmount, setServingAmount] = useState('');
  const [kcal, setKcal] = useState('');
  const [p, setP] = useState('');
  const [c, setC] = useState('');
  const [f, setF] = useState('');
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
    <Screen title="New food" subtitle="From the nutrition label">
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
