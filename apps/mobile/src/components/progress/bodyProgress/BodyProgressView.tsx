import { useState } from 'react';
import { View } from 'react-native';
import { AppText, Button, Card, InlineMessage, Row, SectionHeader, Segmented, StateView } from '@/components/ui';
import { POSE_LABEL, POSES, PRIVACY_COPY, type PhotoPose, type ProgressPhoto } from '@/lib/progressPhotos';
import type { Units } from '@/lib/units';
import { colors, radius, space } from '@/theme/tokens';
import { DeleteAllPhotosControl } from './DeleteAllPhotos';
import { PHOTO_ASPECT, PhotoImage, photoCaption, PrivacyNote, PhotoTile } from './PhotoPieces';
import { defaultPair } from './compareMath';
import { groupByMonth } from './timeline';

type Filter = 'all' | PhotoPose;
const FILTERS: { value: Filter; label: string }[] = [{ value: 'all', label: 'All' }, ...POSES.map((p) => ({ value: p as Filter, label: POSE_LABEL[p] }))];

/** One photo, large, with its date and weight, and a two-step delete. */
function PhotoDetail({ photo, units, onClose, onDelete }: { photo: ProgressPhoto; units: Units; onClose: () => void; onDelete: () => Promise<void> }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const remove = async () => {
    setBusy(true);
    setFailed(false);
    try {
      await onDelete();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  };
  return (
    <Card style={{ gap: space.md }}>
      <AppText variant="bodyStrong">{`${POSE_LABEL[photo.pose]} · ${photoCaption(photo, units)}`}</AppText>
      <View style={{ aspectRatio: PHOTO_ASPECT, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.cardRaised }}>
        <PhotoImage photo={photo} />
      </View>
      {failed ? <InlineMessage tone="danger">That photo couldn&apos;t be deleted. Try again.</InlineMessage> : null}
      {asking ? (
        <View style={{ gap: space.sm }}>
          <AppText variant="caption" color={colors.textMuted}>
            Delete this photo from this phone? This can&apos;t be undone.
          </AppText>
          <Row gap={space.sm}>
            <Button label="Keep it" variant="secondary" onPress={() => setAsking(false)} disabled={busy} style={{ flex: 1 }} />
            <Button label="Delete photo" variant="danger" onPress={remove} loading={busy} style={{ flex: 1 }} />
          </Row>
        </View>
      ) : (
        <Row gap={space.sm}>
          <Button label="Close" variant="secondary" onPress={onClose} style={{ flex: 1 }} />
          <Button label="Delete this photo" variant="danger" icon="trash-outline" onPress={() => setAsking(true)} style={{ flex: 1 }} />
        </Row>
      )}
    </Card>
  );
}

/** Body progress: take a photo, compare two, browse the timeline by month. Everything here is on this phone only. */
export function BodyProgressView({
  photos,
  units,
  onCapture,
  onCompare,
  onDeleteOne,
  onDeleteAll,
}: {
  photos: ProgressPhoto[];
  units: Units;
  onCapture: () => void;
  onCompare: () => void;
  onDeleteOne: (id: string) => Promise<void>;
  onDeleteAll: () => Promise<void>;
}) {
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const open = photos.find((p) => p.id === openId) ?? null;
  const groups = groupByMonth(photos, filter === 'all' ? null : filter);
  const canCompare = POSES.some((p) => defaultPair(photos, p) !== null);

  const deleteOpen = async () => {
    if (!open) return;
    await onDeleteOne(open.id);
    setOpenId(null);
  };

  return (
    <>
      <Card style={{ gap: space.md }}>
        <PrivacyNote text={PRIVACY_COPY} />
        <Button label="Take a photo" icon="camera-outline" onPress={onCapture} />
        <Button label="Compare two photos" icon="swap-horizontal-outline" variant="secondary" onPress={onCompare} disabled={!canCompare} />
        {!canCompare && photos.length > 0 ? (
          <AppText variant="caption" color={colors.textMuted}>
            Comparing needs two photos of the same pose.
          </AppText>
        ) : null}
      </Card>

      {photos.length === 0 ? (
        <StateView kind="empty" compact title="No photos yet" message="Take your first one. Same spot, same light, same pose each time makes the change easy to see." />
      ) : (
        <>
          <Segmented<Filter> label="Show" options={FILTERS} value={filter} onChange={setFilter} />
          {open ? <PhotoDetail key={open.id} photo={open} units={units} onClose={() => setOpenId(null)} onDelete={deleteOpen} /> : null}
          {groups.length === 0 ? (
            <AppText variant="caption" color={colors.textMuted}>
              {`No ${filter === 'all' ? '' : `${POSE_LABEL[filter].toLowerCase()} `}photos yet.`}
            </AppText>
          ) : (
            groups.map((g) => (
              <View key={g.key} style={{ gap: space.md }}>
                <SectionHeader title={g.label} />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
                  {g.photos.map((p) => (
                    <PhotoTile key={p.id} photo={p} units={units} selected={p.id === openId} onPress={() => setOpenId(p.id === openId ? null : p.id)} />
                  ))}
                </View>
              </View>
            ))
          )}
          <DeleteAllPhotosControl count={photos.length} onConfirm={onDeleteAll} />
        </>
      )}
    </>
  );
}
