import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Divider, Field, IconButton, InlineMessage, Row, StateView } from '@/components/ui';
import type { GroceryItemView, GroceryListView as List } from '@/lib/types';
import { a11y, colors, space } from '@/theme/tokens';

export interface GroceryListViewProps {
  list: List;
  onToggle: (item: GroceryItemView) => void;
  onDelete: (item: GroceryItemView) => void;
  onAddCustom: (name: string, quantity: string | null) => void;
  adding?: boolean;
  onClearChecked: () => void;
  error?: string | null;
  onOpenPlan: () => void;
}

const SOURCE: Record<GroceryItemView['source'], string> = { plan: 'For your plan', recipe: 'From a recipe', custom: 'Added by you' };

/** The shopping list, by aisle. Plan items follow the plan; recipe and custom items are yours to remove. Pure view. */
export function GroceryListView(p: GroceryListViewProps) {
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const add = () => {
    if (!name.trim()) return;
    p.onAddCustom(name.trim(), quantity.trim() || null);
    setName('');
    setQuantity('');
  };
  const ticked = p.list.total - p.list.remaining;

  return (
    <View style={{ gap: space.lg }}>
      <AppText variant="bodyStrong">{p.list.total === 0 ? 'Your list is empty' : p.list.remaining === 0 ? 'All done — everything’s ticked off' : `${p.list.remaining} of ${p.list.total} to buy`}</AppText>

      <Card style={{ gap: space.sm }}>
        <Row gap={space.sm} style={{ alignItems: 'flex-end' }}>
          <Field label="Add an item" value={name} onChangeText={setName} placeholder="e.g. coffee filters" onSubmitEditing={add} style={{ flex: 2 }} maxLength={80} />
          <Field label="Amount (optional)" value={quantity} onChangeText={setQuantity} placeholder="1 pack" onSubmitEditing={add} style={{ flex: 1 }} maxLength={30} />
        </Row>
        <Button label="Add to list" icon="add" variant="secondary" onPress={add} loading={p.adding} disabled={!name.trim()} />
      </Card>
      {p.error ? <InlineMessage tone="danger">{p.error}</InlineMessage> : null}

      {p.list.total === 0 ? (
        <Card>
          <StateView kind="empty" compact title="Nothing to buy yet" message="Plan your meals and their ingredients appear here, grouped by aisle. You can add anything else yourself." actionLabel="Plan meals" onAction={p.onOpenPlan} />
        </Card>
      ) : null}

      {p.list.sections.map((s) => (
        <View key={s.aisle} style={{ gap: space.sm }}>
          <AppText variant="heading" header style={{ fontSize: 17 }}>
            {s.label}
          </AppText>
          <Card style={{ paddingVertical: space.xs }}>
            {s.items.map((i, k) => (
              <View key={i.id}>
                {k > 0 ? <Divider /> : null}
                <Row style={styles.row}>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={`${i.name}${i.amountText ? `, ${i.amountText}` : ''}`}
                    accessibilityState={{ checked: i.checked }} aria-checked={i.checked}
                    onPress={() => p.onToggle(i)}
                    style={styles.check}>
                    <Ionicons name={i.checked ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={i.checked ? colors.primary : colors.textFaint} />
                    <View style={{ flex: 1 }}>
                      <AppText variant="body" color={i.checked ? colors.textMuted : colors.text} style={{ textDecorationLine: i.checked ? 'line-through' : 'none' }}>
                        {i.name}
                      </AppText>
                      <AppText variant="caption" color={colors.textFaint}>
                        {SOURCE[i.source]}
                      </AppText>
                    </View>
                    {i.amountText ? <AppText variant="bodyStrong" color={i.checked ? colors.textMuted : colors.text}>{i.amountText}</AppText> : null}
                  </Pressable>
                  {i.source !== 'plan' ? <IconButton icon="close" label={`Remove ${i.name}`} onPress={() => p.onDelete(i)} /> : null}
                </Row>
              </View>
            ))}
          </Card>
        </View>
      ))}

      {ticked > 0 ? <Button label="Clear ticked items" variant="ghost" onPress={p.onClearChecked} /> : null}
      {p.list.total > 0 ? (
        <AppText variant="caption" color={colors.textFaint}>
          {p.list.note} Items for your plan update when the plan changes.
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: a11y.minTouch + 8, paddingVertical: space.xs },
  check: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: a11y.minTouch },
});
