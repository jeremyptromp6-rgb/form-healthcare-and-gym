import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { discardTemp } from './privateFiles';

/**
 * Prepares a camera shot for storage: at most 1080 px on the long edge, re-encoded as JPEG at
 * quality 0.8 (re-encoding also drops the original's EXIF, including any location). Returns a
 * temporary file for `addProgressPhoto` to move into the private folder; the camera's own file is
 * removed here.
 */

export const PROGRESS_MAX_EDGE = 1080;
export const PROGRESS_QUALITY = 0.8;

export async function prepareProgressPhoto(shot: { uri: string; width?: number; height?: number }): Promise<{ uri: string; width: number; height: number }> {
  try {
    let ctx = ImageManipulator.manipulate(shot.uri);
    const long = Math.max(shot.width ?? 0, shot.height ?? 0);
    if (long > PROGRESS_MAX_EDGE) ctx = (shot.width ?? 0) >= (shot.height ?? 0) ? ctx.resize({ width: PROGRESS_MAX_EDGE }) : ctx.resize({ height: PROGRESS_MAX_EDGE });
    const rendered = await ctx.renderAsync();
    const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PROGRESS_QUALITY });
    return { uri: saved.uri, width: saved.width ?? rendered.width, height: saved.height ?? rendered.height };
  } finally {
    discardTemp(shot.uri);
  }
}
