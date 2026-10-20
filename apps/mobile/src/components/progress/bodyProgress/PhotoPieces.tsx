import { Ionicons } from '@expo/vector-icons';
import { Image, Pressable, View } from 'react-native';
import { AppText } from '@/components/ui';
import { photoUri, POSE_LABEL, type ProgressPhoto } from '@/lib/progressPhotos';
import { formatWeight, type Units } from '@/lib/units';
import { colors, radius, space } from '@/theme/tokens';
import { shortDate } from './timeline';

/** Photos are portrait: width / height. */
export const PHOTO_ASPECT = 3 / 4;

/** "12 Oct 2026 · 81.2 kg" (the weight only when there is one). */
export const photoCaption = (p: ProgressPhoto, units: Units): string => `${shortDate(p.date)}${p.weightKg !== null ? ` · ${formatWeight(p.weightKg, units)}` : ''}`;

/** What a screen reader hears for a photo. */
export const photoLabel = (p: ProgressPhoto, units: Units): string => `${POSE_LABEL[p.pose]} photo, ${shortDate(p.date)}${p.weightKg !== null ? `, ${formatWeight(p.weightKg, units)}` : ''}`;

/** A stored photo, cropped to the portrait frame. Decorative: the caption or label next to it says what it is. */
export function PhotoImage({ photo, opacity = 1 }: { photo: ProgressPhoto; opacity?: number }) {
  return <Image source={{ uri: photoUri(photo) }} style={{ width: '100%', height: '100%', opacity }} resizeMode="cover" accessibilityIgnoresInvertColors importantForAccessibility="no" />;
}

/** A timeline tile: the photo with its date and weight underneath. */
export function PhotoTile({ photo, units, onPress, selected }: { photo: ProgressPhoto; units: Units; onPress: () => void; selected?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={photoLabel(photo, units)} accessibilityState={{ selected: !!selected }} onPress={onPress} style={{ width: '31%', gap: space.xs }}>
      <View style={{ aspectRatio: PHOTO_ASPECT, borderRadius: radius.sm, overflow: 'hidden', backgroundColor: colors.cardRaised, borderWidth: selected ? 2 : 0, borderColor: colors.primary }}>
        <PhotoImage photo={photo} />
        <View style={{ position: 'absolute', left: space.xs, top: space.xs, backgroundColor: colors.scrim, borderRadius: radius.pill, paddingHorizontal: space.sm }}>
          <AppText variant="label" color="#FFFFFF">
            {POSE_LABEL[photo.pose]}
          </AppText>
        </View>
      </View>
      <AppText variant="caption" color={colors.text} numberOfLines={1}>
        {shortDate(photo.date)}
      </AppText>
      <AppText variant="caption" color={colors.textMuted} numberOfLines={1}>
        {photo.weightKg !== null ? formatWeight(photo.weightKg, units) : ' '}
      </AppText>
    </Pressable>
  );
}

/** The one-line privacy promise shown wherever photos are taken, viewed or managed. */
export function PrivacyNote({ text }: { text: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'center' }}>
      <Ionicons name="lock-closed-outline" size={16} color={colors.primary} importantForAccessibility="no" />
      <View style={{ flex: 1 }}>
        <AppText variant="caption" color={colors.textMuted}>
          {text}
        </AppText>
      </View>
    </View>
  );
}
