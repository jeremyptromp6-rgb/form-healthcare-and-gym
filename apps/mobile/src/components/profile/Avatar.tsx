import Ionicons from '@expo/vector-icons/Ionicons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { discardTemp } from '@/lib/privateFiles';
import { useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '@/components/ui';
import { useDeletePhoto, usePhoto, useUploadPhoto } from '@/lib/queries';
import { colors } from '@/theme/tokens';

const SIZE = 84;
const MAX_EDGE = 512;

function initials(name: string): string {
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

/**
 * Private profile photo. The image is resized and re-encoded on the device (which also drops
 * location metadata), uploaded, and only ever fetched with the owner's session.
 */
export function Avatar({ name, hasPhoto }: { name: string; hasPhoto: boolean }) {
  const photo = usePhoto(hasPhoto);
  const upload = useUploadPhoto();
  const remove = useDeletePhoto();
  const [message, setMessage] = useState<string | null>(null);
  const busy = upload.isPending || remove.isPending;

  const pick = async () => {
    setMessage(null);
    if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return setMessage('Photo access is off. Allow it in Settings to choose a picture.');
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    let resized: string | null = null;
    try {
      const rendered = await ImageManipulator.manipulate(result.assets[0].uri).resize({ width: MAX_EDGE }).renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
      resized = saved.uri;
      if (!saved.base64) throw new Error('no data');
      upload.mutate({ mimeType: 'image/jpeg', data: saved.base64.replace(/^data:image\/\w+;base64,/, '') }, { onError: (e) => setMessage(e.message) });
    } catch {
      setMessage("That image couldn't be used. Try another.");
    } finally {
      // The picked and resized copies only existed to read the bytes: don't leave them in the cache.
      discardTemp(result.assets[0].uri);
      discardTemp(resized);
    }
  };

  const uri = photo.data ? `data:${photo.data.mimeType};base64,${photo.data.data}` : null;

  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={hasPhoto ? 'Change profile photo' : 'Add profile photo'} onPress={pick} disabled={busy} style={styles.avatar}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} accessibilityIgnoresInvertColors />
        ) : (
          <AppText variant="title" color={colors.primary}>
            {initials(name) || '?'}
          </AppText>
        )}
        <View style={styles.badge}>{busy ? <ActivityIndicator size="small" color={colors.onPrimary} /> : <Ionicons name="camera" size={14} color={colors.onPrimary} />}</View>
      </Pressable>
      {hasPhoto ? (
        <Pressable accessibilityRole="button" onPress={() => remove.mutate()} hitSlop={10}>
          <AppText variant="caption" color={colors.textMuted}>
            Remove photo
          </AppText>
        </Pressable>
      ) : null}
      {message ? (
        <AppText variant="caption" color={colors.danger} style={{ textAlign: 'center', maxWidth: 240 }}>
          {message}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  avatar: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.primarySoft,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: SIZE - 4, height: SIZE - 4, borderRadius: (SIZE - 4) / 2 },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.bg,
  },
});
