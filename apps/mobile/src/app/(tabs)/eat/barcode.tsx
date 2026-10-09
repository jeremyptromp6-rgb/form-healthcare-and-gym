import { CameraView, useCameraPermissions, type BarcodeScanningResult } from 'expo-camera';
import { router, type Href } from 'expo-router';
import { useRef, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { AppText, Button, Card, Field, InlineMessage, Screen, StateView } from '@/components/ui';
import { BARCODE_TYPES, lookupBarcode, type BarcodeLookup } from '@/lib/barcode';
import { colors, radius, space } from '@/theme/tokens';

/**
 * Scan a packaged food's barcode (or type it) and look it up in Open Food Facts. A match opens
 * the New food form filled in from the label, to check and save — nothing is logged unseen.
 */
export default function BarcodeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Extract<BarcodeLookup, { ok: false }> | null>(null);
  // The camera reports the same code many times a second: look each scan up once.
  const handling = useRef(false);

  const look = async (code: string, type?: string) => {
    if (handling.current) return;
    handling.current = true;
    setBusy(true);
    setProblem(null);
    const r = await lookupBarcode(code, { type });
    setBusy(false);
    if (r.ok) {
      router.replace({ pathname: '/eat/food/new', params: { draft: JSON.stringify(r.draft) } } as unknown as Href);
      return;
    }
    setProblem(r);
    handling.current = false;
  };

  const onScanned = (s: BarcodeScanningResult) => {
    if (!problem) look(s.data, s.type);
  };

  return (
    <Screen title="Scan a barcode" subtitle="Packaged food, straight from the label">
      <View style={styles.viewfinder}>
        {permission?.granted ? (
          <>
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: [...BARCODE_TYPES] }} onBarcodeScanned={busy || problem ? undefined : onScanned} />
            <View style={styles.aim} pointerEvents="none" />
            <View style={styles.hint} pointerEvents="none">
              <AppText variant="label" color="#FFFFFF">
                {busy ? 'Looking it up…' : 'Point at the barcode'}
              </AppText>
            </View>
          </>
        ) : permission && !permission.canAskAgain ? (
          <StateView
            kind="permission"
            title="Camera access is off"
            message="Allow camera access in Settings to scan barcodes — or type the number below."
            actionLabel="Open Settings"
            onAction={() => Linking.openSettings()}
          />
        ) : (
          <StateView kind="permission" title="Use your camera to scan" message="FORM only reads the barcode. Nothing is recorded." actionLabel="Allow camera" onAction={requestPermission} />
        )}
      </View>

      {problem ? (
        <Card style={{ gap: space.sm }}>
          <InlineMessage tone={problem.kind === 'network' || problem.kind === 'rate_limited' ? 'warning' : 'info'}>{problem.message}</InlineMessage>
          <Button label="Scan again" icon="scan" variant="secondary" onPress={() => setProblem(null)} />
          {problem.kind === 'not_found' || problem.kind === 'no_nutrition' ? (
            <Button label="Add it from the label" icon="create-outline" variant="secondary" onPress={() => router.replace('/eat/food/new' as Href)} />
          ) : null}
        </Card>
      ) : null}

      <Card style={{ gap: space.md }}>
        <Field label="Or type the barcode number" value={typed} onChangeText={setTyped} keyboardType="number-pad" placeholder="e.g. 5449000000996" maxLength={14} />
        <Button label="Look it up" icon="search" onPress={() => look(typed)} loading={busy} disabled={typed.trim().length < 8} />
      </Card>

      <AppText variant="caption" color={colors.textFaint}>
        Product data from Open Food Facts, a free, open database built by volunteers (ODbL). Always check the numbers against your pack.
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  viewfinder: { height: 300, borderRadius: radius.xl, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: colors.border, justifyContent: 'center' },
  aim: { position: 'absolute', alignSelf: 'center', width: '72%', height: 120, borderRadius: radius.md, borderWidth: 3, borderColor: colors.primary },
  hint: { position: 'absolute', bottom: space.md, alignSelf: 'center', paddingHorizontal: space.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.55)' },
});
