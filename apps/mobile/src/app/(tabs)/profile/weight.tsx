import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, ErrorState, Field, IconButton, InlineMessage, Row, Screen, SectionHeader, StateView } from '@/components/ui';
import { localDateKey } from '@/lib/dates';
import { useCatalog, useDeleteWeight, useLogWeight, useMe, useWeightHistory } from '@/lib/queries';
import { formatWeight, weightInputToKg, type Units } from '@/lib/units';
import { colors, radius, space } from '@/theme/tokens';

/** Weight history: private, one entry per day, the newest sets the current weight and targets. */
export default function WeightScreen() {
  const me = useMe();
  const history = useWeightHistory();
  const log = useLogWeight();
  const del = useDeleteWeight();
  const catalog = useCatalog();
  const units: Units = me.data?.settings.units ?? 'metric';
  const limits = catalog.data?.limits.weightKg;
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const submit = () => {
    setError(null);
    setSaved(false);
    const kg = weightInputToKg(text, units);
    // Instant feedback only; the server enforces the same limits.
    if (limits && !(kg >= limits.min && kg <= limits.max)) return setError(`Enter a weight from ${formatWeight(limits.min, units)} to ${formatWeight(limits.max, units)}.`);
    if (!Number.isFinite(kg)) return setError('Enter a number.');
    log.mutate(
      { localDate: localDateKey(), weightKg: kg },
      {
        onSuccess: () => {
          setText('');
          setSaved(true);
        },
        onError: (e) => setError(e.kind === 'network' ? "Couldn't save. Check your connection." : e.message),
      },
    );
  };

  const entries = history.data?.entries ?? [];
  const chart = [...entries].slice(0, 14).reverse();
  const min = Math.min(...chart.map((e) => e.weightKg));
  const max = Math.max(...chart.map((e) => e.weightKg));

  return (
    <Screen title="Weight" subtitle="History" refreshing={history.isRefetching} onRefresh={history.refetch}>
      <Card style={{ gap: space.md }}>
        <Field
          label={`Today's weight (${units === 'metric' ? 'kg' : 'lb'})`}
          value={text}
          onChangeText={setText}
          keyboardType="decimal-pad"
          placeholder={units === 'metric' ? '70.5' : '155'}
          onSubmitEditing={submit}
        />
        {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
        {saved ? <InlineMessage tone="success">Logged. Your targets now use this weight.</InlineMessage> : null}
        <Button label="Log weight" onPress={submit} loading={log.isPending} />
        <AppText variant="caption" color={colors.textFaint}>
          Weight naturally moves day to day. Look at the trend, not a single number.
        </AppText>
      </Card>

      {history.isPending ? <StateView kind="loading" /> : null}
      {history.isError && !history.data ? <ErrorState error={history.error} onRetry={history.refetch} /> : null}

      {chart.length >= 2 ? (
        <>
          <SectionHeader title="Last 14 entries" />
          <Card>
            <View
              accessible
              accessibilityLabel={`Weight trend from ${formatWeight(chart[0]!.weightKg, units)} to ${formatWeight(chart.at(-1)!.weightKg, units)}`}
              style={{ flexDirection: 'row', alignItems: 'flex-end', height: 96, gap: 6 }}>
              {chart.map((e) => (
                <View
                  key={e.localDate}
                  style={{
                    flex: 1,
                    height: max === min ? 48 : 16 + ((e.weightKg - min) / (max - min)) * 80,
                    backgroundColor: colors.primaryDeep,
                    borderRadius: radius.sm,
                    opacity: 0.85,
                  }}
                />
              ))}
            </View>
          </Card>
        </>
      ) : null}

      {history.data ? (
        <>
          <SectionHeader title="Entries" />
          {entries.length === 0 ? (
            <Card>
              <StateView kind="empty" compact title="No entries yet" message="Log today's weight to start your history." />
            </Card>
          ) : (
            <Card style={{ gap: space.xs }}>
              {entries.map((e) => (
                <Row key={e.localDate} style={{ justifyContent: 'space-between' }}>
                  <AppText variant="body">{new Date(`${e.localDate}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</AppText>
                  <Row gap={space.xs}>
                    <AppText variant="bodyStrong">{formatWeight(e.weightKg, units)}</AppText>
                    <IconButton icon="trash-outline" label={`Delete entry for ${e.localDate}`} onPress={() => del.mutate(e.localDate)} />
                  </Row>
                </Row>
              ))}
              {del.isError ? <InlineMessage tone="danger">Couldn&apos;t delete that entry. Try again.</InlineMessage> : null}
            </Card>
          )}
        </>
      ) : null}
    </Screen>
  );
}
