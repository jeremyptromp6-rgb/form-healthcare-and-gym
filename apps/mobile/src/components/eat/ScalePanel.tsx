import { measuredPortionFromScale, type ScaleProvider, type ScaleState } from '@form/domain';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { AppText, Badge, Button, Row } from '@/components/ui';
import { useScale } from '@/lib/scale';
import { colors, radius, space } from '@/theme/tokens';

/**
 * A connected kitchen scale, when this device has one. Every state is shown for what it is:
 * not connected, connecting, connected (waiting for food), reading (still moving), stable, error.
 * Only a stable reading can be used. Without scale support it says so — typing the weight from any
 * kitchen scale is always available above.
 */
export function ScalePanel({ provider, onUse }: { provider: ScaleProvider; onUse: (grams: number) => void }) {
  const scale = useScale(provider);
  if (!provider.supported) {
    return (
      <AppText variant="caption" color={colors.textFaint}>
        No smart scale connected — weigh the food on any kitchen scale and type the weight.
      </AppText>
    );
  }
  return (
    <View style={styles.panel} accessibilityLiveRegion="polite">
      <Row style={{ justifyContent: 'space-between' }}>
        <AppText variant="label" color={colors.textMuted}>
          Scale
        </AppText>
        {provider.development ? <Badge label="SIMULATED — NOT A REAL SCALE" tone="warning" /> : null}
      </Row>
      <ScaleBody state={scale.state} onConnect={scale.connect} onDisconnect={scale.disconnect} onUse={onUse} />
    </View>
  );
}

export function ScaleBody({ state, onConnect, onDisconnect, onUse }: { state: ScaleState; onConnect: () => void; onDisconnect: () => void; onUse: (grams: number) => void }) {
  switch (state.status) {
    case 'not_connected':
      return <Button label="Connect scale" icon="scale-outline" variant="secondary" onPress={onConnect} />;
    case 'connecting':
      return (
        <Row gap={space.sm}>
          <ActivityIndicator color={colors.primary} />
          <AppText variant="body">Connecting…</AppText>
        </Row>
      );
    case 'connected':
      return (
        <>
          <AppText variant="body">Connected to {state.device}. Place the food on the scale.</AppText>
          <Button label="Disconnect" variant="ghost" onPress={onDisconnect} />
        </>
      );
    case 'reading':
      return (
        <>
          <Row gap={space.sm} style={{ alignItems: 'baseline' }}>
            <AppText variant="heading" color={colors.textMuted} accessibilityLabel={`Reading ${state.grams} grams, not settled`}>
              {state.grams} g
            </AppText>
            <AppText variant="caption" color={colors.textMuted}>
              Reading… hold still
            </AppText>
          </Row>
          <Button label="Disconnect" variant="ghost" onPress={onDisconnect} />
        </>
      );
    case 'stable': {
      const portion = measuredPortionFromScale(state);
      return (
        <>
          <Row gap={space.sm} style={{ alignItems: 'baseline' }}>
            <AppText variant="heading" accessibilityLabel={`${state.grams} grams, stable`}>
              {state.grams} g
            </AppText>
            <Badge label="STABLE" tone="primary" icon="checkmark" />
          </Row>
          {portion ? (
            <Button label={`Use ${portion.quantity} g`} icon="scale-outline" onPress={() => onUse(portion.quantity)} />
          ) : (
            <AppText variant="caption" color={colors.textMuted}>
              The scale is empty — place the food on it.
            </AppText>
          )}
          <Button label="Disconnect" variant="ghost" onPress={onDisconnect} />
        </>
      );
    }
    case 'error':
      return (
        <>
          <AppText variant="caption" color={colors.danger}>
            {state.message}
          </AppText>
          {state.code !== 'unsupported' ? <Button label="Try again" variant="secondary" onPress={onConnect} /> : null}
        </>
      );
  }
}

const styles = StyleSheet.create({
  panel: {
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.wash,
  },
});
