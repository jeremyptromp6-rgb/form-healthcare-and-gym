import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, InlineMessage, Row } from '@/components/ui';
import { useProgressPhotos } from '@/lib/useProgressPhotos';
import { deleteAllProgressPhotos, progressPhotosSupported } from '@/lib/progressPhotos';
import { colors, space } from '@/theme/tokens';

/** "Delete all progress photos": two steps, so a stray tap can't erase a year of photos. Nothing shows when there are none. */
export function DeleteAllPhotosControl({ count, onConfirm }: { count: number; onConfirm: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (count === 0) return null;

  const run = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onConfirm();
      setAsking(false);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  if (!asking) return <Button label="Delete all progress photos" variant="danger" icon="trash-outline" onPress={() => setAsking(true)} />;
  return (
    <View style={{ gap: space.sm }}>
      <AppText variant="bodyStrong" color={colors.danger}>
        {`Delete ${count} progress photo${count === 1 ? '' : 's'} from this phone?`}
      </AppText>
      <AppText variant="caption" color={colors.textMuted}>
        This can&apos;t be undone. Nothing is kept anywhere else.
      </AppText>
      {failed ? <InlineMessage tone="danger">The photos couldn&apos;t be deleted. Try again.</InlineMessage> : null}
      <Row gap={space.sm}>
        <Button label="Keep them" variant="secondary" onPress={() => setAsking(false)} disabled={busy} style={{ flex: 1 }} />
        <Button label="Delete forever" variant="danger" onPress={run} loading={busy} style={{ flex: 1 }} />
      </Row>
    </View>
  );
}

/** The same control wired to the photo store, for the Privacy center. */
export function DeleteProgressPhotosCard() {
  const { photos } = useProgressPhotos();
  if (!photos || !progressPhotosSupported()) return null;
  return (
    <Card style={{ gap: space.sm }}>
      <AppText variant="sectionTitle" header>
        Progress photos
      </AppText>
      <AppText variant="caption" color={colors.textMuted}>
        {photos.length === 0 ? 'No progress photos on this phone.' : `${photos.length} progress photo${photos.length === 1 ? ' is' : 's are'} saved on this phone only. FORM never uploads them. Deleting your FORM account also deletes them from this phone.`}
      </AppText>
      <DeleteAllPhotosControl count={photos.length} onConfirm={deleteAllProgressPhotos} />
    </Card>
  );
}
