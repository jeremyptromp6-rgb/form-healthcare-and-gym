import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

/**
 * Private files on the device: the user's data export (handed to wherever they choose, never kept
 * by FORM), and the temporary images the photo picker and resizer leave in the app's cache
 * (deleted as soon as they've been read).
 */

const EXPORT_PREFIX = 'form-export-';

/**
 * Saves the export: a download on the web; on a phone, a temporary file handed to the share sheet
 * (Files, AirDrop, email…) and deleted once the sheet closes — a full copy of someone's health data
 * never lingers inside the app.
 */
export async function saveExport(json: string, filename: string): Promise<{ where: 'download' | 'shared'; uri: string | null }> {
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // Release the in-memory copy once the browser has it.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return { where: 'download', uri: null };
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("This device can't share files, so the export couldn't be saved.");
  const file = new File(Paths.cache, filename);
  try {
    if (file.exists) file.delete();
    file.create();
    file.write(json);
    await Sharing.shareAsync(file.uri, { mimeType: 'application/json', UTI: 'public.json', dialogTitle: 'Save your FORM data' });
    return { where: 'shared', uri: null };
  } finally {
    discardTemp(file.uri);
  }
}

/** Deletes any export left on the device (a crash mid-share, or an older version's copy). Called on sign-out. */
export function purgeLocalExports(): void {
  if (Platform.OS === 'web') return;
  for (const dir of [Paths.cache, Paths.document]) {
    try {
      for (const entry of new Directory(dir).list()) {
        if (entry instanceof File && entry.name.startsWith(EXPORT_PREFIX) && entry.name.endsWith('.json')) entry.delete();
      }
    } catch {
      // Best effort: nothing to purge, or the directory can't be listed.
    }
  }
}

/** Deletes a temporary file the picker or image tools wrote to the cache. Web data/blob URIs have nothing to delete. */
export function discardTemp(uri: string | null | undefined): void {
  if (!uri || Platform.OS === 'web' || !uri.startsWith('file:')) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Best effort: the OS clears the cache directory eventually.
  }
}
