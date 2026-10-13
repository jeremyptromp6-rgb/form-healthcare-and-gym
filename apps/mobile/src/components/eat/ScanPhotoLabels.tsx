import type { ScanBox } from '@form/domain';
import { useMemo, useState } from 'react';
import { Image, Pressable, Text, useWindowDimensions, View, type TextStyle } from 'react-native';
import { containFit, layoutScanLabels, type PlacedLabel } from '@/lib/scanLabels';
import { colors, MAX_CONTENT_WIDTH, palettes, radius, space, type } from '@/theme/tokens';

/** The photo as the review needs it. `width`/`height` are the pixels of the JPEG the model saw (absent = learn them from the image itself). */
export interface ScanPhoto {
  uri: string;
  width?: number;
  height?: number;
}

export interface PhotoLabelItem {
  id: string;
  /** The item's place in the scan: the same number as its card. */
  number: number;
  /** What the chip says (short; the layout ellipsises it to fit). */
  text: string;
  /** What a screen reader says for the chip. */
  name: string;
  /** Absent when the food couldn't be located: no chip. */
  box?: ScanBox;
  removed?: boolean;
}

// Chips sit on a photo, so they use the evening palette's surface and type in both moods: always legible on any food.
const CHIP_BG = `${palettes.dark.bg}E6`;
const CHIP_TEXT = palettes.dark.text;
const DOT_RING = palettes.light.card;
const CHIP_H = 28;
// 28 dp tall chips get 8 dp of slop above and below: a 44 dp target.
const CHIP_SLOP = { top: 8, bottom: 8, left: 4, right: 4 } as const;

/** The number that ties a photo label to its card below. */
export function NumberBadge({ n, size = 24, decorative }: { n: number; size?: number; decorative?: boolean }) {
  return (
    <View
      accessible={!decorative}
      accessibilityLabel={decorative ? undefined : `Item ${n}`}
      style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' }}>
      <Text maxFontSizeMultiplier={1.2} style={[type.label as TextStyle, { color: colors.onPrimary, fontSize: size >= 24 ? 13 : 12, lineHeight: size >= 24 ? 16 : 14 }]}>
        {n}
      </Text>
    </View>
  );
}

/**
 * The meal photo, contain-fitted at its true aspect (never cropped), with a numbered label pinned to
 * each food the model located. A label that had to move off its food keeps a dot on the food and a
 * line to the chip. The labels repeat what the list below says: they are a convenience, never the
 * only place anything is written. With no items this is just the photo.
 */
export function ScanPhotoLabels({ photo, items, activeId, onSelect }: { photo: ScanPhoto; items: readonly PhotoLabelItem[]; activeId?: string | null; onSelect?: (id: string) => void }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [measured, setMeasured] = useState<number | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  // The screen's content column; replaced by the real width once the view has been laid out.
  const cw = measured ?? Math.max(0, Math.min(winW, MAX_CONTENT_WIDTH) - 2 * space.lg);
  const iw = photo.width && photo.width > 0 ? photo.width : (natural?.w ?? 0);
  const ih = photo.height && photo.height > 0 ? photo.height : (natural?.h ?? 0);
  const known = iw > 0 && ih > 0;
  const maxH = Math.min(cw * 1.25, winH * 0.5);
  // Until the true size is known the photo sits in a 4:3 block and no label is placed (a box means nothing without it).
  const fit = known ? containFit(iw, ih, cw, maxH) : containFit(4, 3, cw, maxH);

  const placed = useMemo(
    () => (known ? layoutScanLabels(items.map((i) => ({ id: i.id, text: i.text, box: i.box, removed: i.removed })), fit.w, fit.h) : []),
    [known, items, fit.w, fit.h],
  );
  const byId = new Map(items.map((i) => [i.id, i]));

  return (
    <View
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0 && Math.abs(w - (measured ?? 0)) > 0.5) setMeasured(w);
      }}
      style={{ width: '100%', height: fit.h, borderRadius: radius.lg, backgroundColor: colors.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: fit.w, height: fit.h }}>
        <Image
          source={{ uri: photo.uri }}
          accessibilityLabel="Your meal photo"
          onLoad={(e) => {
            const s = e.nativeEvent?.source;
            if (s && s.width > 0 && s.height > 0) setNatural({ w: s.width, h: s.height });
          }}
          style={{ position: 'absolute', left: 0, top: 0, width: fit.w, height: fit.h, resizeMode: 'contain' }}
        />
        {/* Lines first, so every chip and dot sits on top of them. */}
        {placed.filter((l) => l.leader).map((l) => (
          <Leader key={`leader:${l.id}`} label={l} />
        ))}
        {placed.map((l) => (
          <View key={`dot:${l.id}`} style={{ position: 'absolute', left: l.anchor.x - 7, top: l.anchor.y - 7, width: 14, height: 14, borderRadius: 7, backgroundColor: colors.primary, borderWidth: 2, borderColor: DOT_RING, pointerEvents: 'none' }} />
        ))}
        {placed.map((l) => {
          const item = byId.get(l.id)!;
          const active = l.id === activeId;
          return (
            <Pressable
              key={`chip:${l.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Item ${item.number}: ${item.name}. Show details.`}
              accessibilityState={{ selected: active }}
              hitSlop={CHIP_SLOP}
              onPress={() => onSelect?.(l.id)}
              style={({ pressed }) => ({
                position: 'absolute',
                left: l.rect.x,
                top: l.rect.y,
                width: l.rect.w,
                height: CHIP_H,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingLeft: 3,
                paddingRight: 10,
                borderRadius: radius.pill,
                backgroundColor: CHIP_BG,
                borderWidth: active ? 2 : 1,
                borderColor: active ? colors.primary : palettes.dark.borderStrong,
                opacity: pressed ? 0.85 : 1,
              })}>
              <NumberBadge n={item.number} size={20} decorative />
              <Text numberOfLines={1} maxFontSizeMultiplier={1.2} style={[type.label as TextStyle, { color: CHIP_TEXT, flex: 1 }]}>
                {l.text}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** A thin line from a moved chip back to its food: a view as long as the gap, turned to point at the dot. */
function Leader({ label }: { label: PlacedLabel }) {
  const cx = label.rect.x + label.rect.w / 2;
  const cy = label.rect.y + label.rect.h / 2;
  const len = Math.hypot(label.anchor.x - cx, label.anchor.y - cy);
  const angle = Math.atan2(label.anchor.y - cy, label.anchor.x - cx);
  return (
    <View
      style={{
        position: 'absolute',
        left: (cx + label.anchor.x) / 2 - len / 2,
        top: (cy + label.anchor.y) / 2 - 1,
        width: len,
        height: 2,
        borderRadius: 1,
        backgroundColor: colors.primary,
        transform: [{ rotate: `${angle}rad` }],
        pointerEvents: 'none',
      }}
    />
  );
}
