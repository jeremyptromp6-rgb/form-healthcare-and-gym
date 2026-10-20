import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { discardTemp } from './privateFiles';
import type { WeightEntry } from './types';

/**
 * Body progress photos live ONLY on this phone: JPEGs plus a small JSON index in the app's private
 * documents folder. They are never put in the gallery and never uploaded, and deleting one (or all)
 * removes the file itself. The index is a file, not secure-store, because secure-store is too small
 * for a growing list.
 */

export type PhotoPose = 'front' | 'side' | 'back';
export const POSES: readonly PhotoPose[] = ['front', 'side', 'back'];
export const POSE_LABEL: Record<PhotoPose, string> = { front: 'Front', side: 'Side', back: 'Back' };

export interface ProgressPhoto {
  id: string;
  /** The day it was taken, YYYY-MM-DD. */
  date: string;
  pose: PhotoPose;
  /** File name inside the private photos folder. */
  file: string;
  /** Body weight on or before that day, from the user's weight log, when there was one. */
  weightKg: number | null;
}

export const PRIVACY_COPY = 'Your photos stay on this phone. FORM never uploads them.';

const DIR_NAME = 'progress-photos';
const INDEX_NAME = 'index.json';
const FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Photos are only kept on a phone: the web build has no private folder. */
export const progressPhotosSupported = (): boolean => Platform.OS !== 'web';

const folder = () => new Directory(Paths.document, DIR_NAME);
const indexFile = () => new File(folder(), INDEX_NAME);

/** The on-screen source for a stored photo. */
export const photoUri = (photo: Pick<ProgressPhoto, 'file'>): string => new File(folder(), photo.file).uri;

const isPose = (v: unknown): v is PhotoPose => v === 'front' || v === 'side' || v === 'back';

function sanitize(raw: unknown): ProgressPhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: ProgressPhoto[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    if (!r || typeof r !== 'object') continue;
    const { id, date, pose, file, weightKg } = r;
    if (typeof id !== 'string' || !id || typeof date !== 'string' || !DATE.test(date) || !isPose(pose) || typeof file !== 'string' || !FILE_NAME.test(file)) continue;
    out.push({ id, date, pose, file, weightKg: typeof weightKg === 'number' && Number.isFinite(weightKg) && weightKg > 0 ? weightKg : null });
  }
  return out.sort((a, b) => (a.date === b.date ? a.id.localeCompare(b.id) : a.date.localeCompare(b.date)));
}

// ---------------------------------------------------------------------------------------------
// Change notifications, and one write at a time

const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
export function subscribeProgressPhotos(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(task: () => Promise<T>): Promise<T> => {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
};

async function readIndex(): Promise<ProgressPhoto[]> {
  const file = indexFile();
  if (!file.exists) return [];
  try {
    return sanitize(JSON.parse(await file.text()));
  } catch {
    // An unreadable index is treated as empty rather than blocking new photos.
    return [];
  }
}

function writeIndex(photos: ProgressPhoto[]): void {
  const dir = folder();
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = indexFile();
  if (!file.exists) file.create();
  file.write(JSON.stringify(photos));
}

// ---------------------------------------------------------------------------------------------
// The photo store

/** Every stored photo, oldest first. */
export function listProgressPhotos(): Promise<ProgressPhoto[]> {
  if (!progressPhotosSupported()) return Promise.resolve([]);
  return serial(readIndex);
}

/**
 * Moves a prepared JPEG (a temporary file) into the private folder and records it. The temporary
 * file is removed either way.
 */
export function addProgressPhoto(input: { sourceUri: string; pose: PhotoPose; date: string; weightKg: number | null }): Promise<ProgressPhoto> {
  return serial(async () => {
    try {
      if (!progressPhotosSupported()) throw new Error('Progress photos need the FORM app on a phone.');
      if (!DATE.test(input.date)) throw new Error('That date is not valid.');
      const dir = folder();
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
      const photo: ProgressPhoto = { id, date: input.date, pose: input.pose, file: `${input.date}-${input.pose}-${id}.jpg`, weightKg: input.weightKg !== null && input.weightKg > 0 ? input.weightKg : null };
      const target = new File(dir, photo.file);
      await new File(input.sourceUri).copy(target);
      try {
        writeIndex([...(await readIndex()), photo]);
      } catch (e) {
        if (target.exists) target.delete();
        throw e;
      }
      return photo;
    } finally {
      discardTemp(input.sourceUri);
      notify();
    }
  });
}

/** Deletes one photo: its file first, then its index entry. */
export function deleteProgressPhoto(id: string): Promise<void> {
  return serial(async () => {
    const all = await readIndex();
    const gone = all.find((p) => p.id === id);
    if (!gone) return;
    const file = new File(folder(), gone.file);
    if (file.exists) file.delete();
    writeIndex(all.filter((p) => p.id !== id));
    notify();
  });
}

/** Deletes every progress photo and the index: the whole private folder. Safe when there is nothing. */
export function deleteAllProgressPhotos(): Promise<void> {
  if (!progressPhotosSupported()) return Promise.resolve();
  return serial(async () => {
    const dir = folder();
    if (dir.exists) dir.delete();
    notify();
  });
}

// ---------------------------------------------------------------------------------------------
// Helpers (pure)

/** The weight logged on that day, or the latest one before it; null when there isn't one. */
export function weightOnOrBefore(entries: readonly WeightEntry[], date: string): number | null {
  let best: WeightEntry | null = null;
  for (const e of entries) if (e.localDate <= date && (best === null || e.localDate > best.localDate)) best = e;
  return best ? best.weightKg : null;
}

/** Photos of one pose, oldest first. */
export const photosOfPose = (photos: readonly ProgressPhoto[], pose: PhotoPose): ProgressPhoto[] => photos.filter((p) => p.pose === pose);

/** The most recent photo of a pose, or null. */
export const latestOfPose = (photos: readonly ProgressPhoto[], pose: PhotoPose): ProgressPhoto | null => {
  const of = photosOfPose(photos, pose);
  return of.length ? of[of.length - 1]! : null;
};
