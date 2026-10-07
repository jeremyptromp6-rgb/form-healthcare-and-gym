import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';
import { discardTemp } from './privateFiles';

/**
 * Takes or picks a meal photo and prepares it for recognition: at most 1280 px on the long edge,
 * re-encoded as JPEG (which also drops the original's metadata on the device). The photo is kept
 * in memory only for this scan; nothing is saved to the gallery or the app's storage.
 */

export const SCAN_MAX_EDGE = 1280;

export type CaptureResult =
  | { ok: true; image: { uri: string; base64: string } }
  | { ok: false; reason: 'cancelled' | 'permission_denied' | 'permission_blocked' | 'failed' };

export async function capturePhoto(source: 'camera' | 'library'): Promise<CaptureResult> {
  try {
    // Web has no permission step, and the picker must open straight from the tap (no awaits first).
    if (Platform.OS !== 'web') {
      const perm = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return { ok: false, reason: perm.canAskAgain ? 'permission_denied' : 'permission_blocked' };
    }
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, exif: false };
    const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets[0]) return { ok: false, reason: 'cancelled' };
    const asset = result.assets[0];
    const long = Math.max(asset.width ?? 0, asset.height ?? 0);
    let ctx = ImageManipulator.manipulate(asset.uri);
    if (long > SCAN_MAX_EDGE) ctx = (asset.width ?? 0) >= (asset.height ?? 0) ? ctx.resize({ width: SCAN_MAX_EDGE }) : ctx.resize({ height: SCAN_MAX_EDGE });
    const rendered = await ctx.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
    // The photo lives on in memory for this scan only; the cached copies are removed now.
    discardTemp(asset.uri);
    discardTemp(saved.uri);
    if (!saved.base64) return { ok: false, reason: 'failed' };
    const base64 = saved.base64.replace(/^data:image\/\w+;base64,/, '');
    return { ok: true, image: { uri: `data:image/jpeg;base64,${base64}`, base64 } };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
