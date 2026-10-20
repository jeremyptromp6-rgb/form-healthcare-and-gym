import { Platform } from 'react-native';
import { addProgressPhoto, deleteAllProgressPhotos, deleteProgressPhoto, latestOfPose, listProgressPhotos, photoUri, photosOfPose, subscribeProgressPhotos, weightOnOrBefore, type ProgressPhoto } from './progressPhotos';

const mockFiles = new Map<string, string>();
const mockDirs = new Set<string>();
jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) => parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    create() {
      mockFiles.set(this.uri, '');
    }
    write(s: string) {
      mockFiles.set(this.uri, s);
    }
    async text() {
      return mockFiles.get(this.uri) ?? '';
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    async copy(dest: { uri: string }) {
      mockFiles.set(dest.uri, mockFiles.get(this.uri) ?? '');
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockDirs.has(this.uri);
    }
    create() {
      mockDirs.add(this.uri);
    }
    delete() {
      mockDirs.delete(this.uri);
      for (const k of [...mockFiles.keys()]) if (k.startsWith(`${this.uri}/`)) mockFiles.delete(k);
    }
  }
  return { File, Directory, Paths: { document: 'file:///docs', cache: 'file:///cache' } };
});

const shot = (name: string, body = 'jpeg') => {
  const uri = `file:///cache/${name}`;
  mockFiles.set(uri, body);
  return uri;
};
const DIR = 'file:///docs/progress-photos';

beforeEach(() => {
  mockFiles.clear();
  mockDirs.clear();
  Platform.OS = 'ios';
});

describe('progress photo storage', () => {
  it('starts empty, and nothing is created just by looking', async () => {
    expect(await listProgressPhotos()).toEqual([]);
    expect(mockDirs.size).toBe(0);
  });

  it('adds a photo to the private folder with its index entry, and removes the temporary file', async () => {
    const source = shot('a.jpg', 'BYTES');
    const p = await addProgressPhoto({ sourceUri: source, pose: 'front', date: '2026-10-20', weightKg: 81.2 });
    expect(p).toMatchObject({ date: '2026-10-20', pose: 'front', weightKg: 81.2 });
    expect(p.file).toMatch(/^2026-10-20-front-.+\.jpg$/);
    expect(photoUri(p)).toBe(`${DIR}/${p.file}`);
    expect(mockFiles.get(photoUri(p))).toBe('BYTES');
    expect(mockFiles.has(source)).toBe(false);
    expect(await listProgressPhotos()).toEqual([p]);
    // Only the private documents folder is touched: the photo and the index.
    expect([...mockFiles.keys()].every((k) => k.startsWith(`${DIR}/`))).toBe(true);
    expect(mockFiles.has(`${DIR}/index.json`)).toBe(true);
  });

  it('lists oldest first and survives a restart (re-read from the index file)', async () => {
    await addProgressPhoto({ sourceUri: shot('1.jpg'), pose: 'front', date: '2026-10-20', weightKg: null });
    await addProgressPhoto({ sourceUri: shot('2.jpg'), pose: 'side', date: '2026-09-01', weightKg: 83 });
    const list = await listProgressPhotos();
    expect(list.map((p) => p.date)).toEqual(['2026-09-01', '2026-10-20']);
    expect(list[1]!.weightKg).toBeNull();
  });

  it('deletes one photo: its file and its entry; others stay', async () => {
    const a = await addProgressPhoto({ sourceUri: shot('1.jpg'), pose: 'front', date: '2026-09-01', weightKg: null });
    const b = await addProgressPhoto({ sourceUri: shot('2.jpg'), pose: 'front', date: '2026-10-01', weightKg: null });
    await deleteProgressPhoto(a.id);
    expect(mockFiles.has(photoUri(a))).toBe(false);
    expect(mockFiles.has(photoUri(b))).toBe(true);
    expect((await listProgressPhotos()).map((p) => p.id)).toEqual([b.id]);
    await expect(deleteProgressPhoto('missing')).resolves.toBeUndefined();
  });

  it('deletes all photos and the index, and is safe when there are none', async () => {
    await deleteAllProgressPhotos();
    await addProgressPhoto({ sourceUri: shot('1.jpg'), pose: 'front', date: '2026-09-01', weightKg: null });
    await addProgressPhoto({ sourceUri: shot('2.jpg'), pose: 'back', date: '2026-10-01', weightKg: null });
    await deleteAllProgressPhotos();
    expect([...mockFiles.keys()].filter((k) => k.startsWith(DIR))).toEqual([]);
    expect(await listProgressPhotos()).toEqual([]);
  });

  it('keeps going with a clean list when the index is unreadable or holds junk entries', async () => {
    mockDirs.add(DIR);
    mockFiles.set(`${DIR}/index.json`, '{not json');
    expect(await listProgressPhotos()).toEqual([]);
    mockFiles.set(
      `${DIR}/index.json`,
      JSON.stringify([
        { id: 'ok', date: '2026-10-01', pose: 'side', file: 'ok.jpg', weightKg: 80 },
        { id: 'bad-file', date: '2026-10-01', pose: 'side', file: '../../etc/passwd', weightKg: null },
        { id: 'bad-pose', date: '2026-10-01', pose: 'top', file: 'x.jpg', weightKg: null },
        { id: 'bad-date', date: 'yesterday', pose: 'side', file: 'y.jpg', weightKg: null },
      ]),
    );
    expect((await listProgressPhotos()).map((p) => p.id)).toEqual(['ok']);
  });

  it('does not keep a half-added photo when the copy fails, and still removes the temporary file', async () => {
    const source = shot('1.jpg');
    const { File } = jest.requireMock('expo-file-system');
    const spy = jest.spyOn(File.prototype, 'copy').mockRejectedValueOnce(new Error('disk full'));
    await expect(addProgressPhoto({ sourceUri: source, pose: 'front', date: '2026-10-20', weightKg: null })).rejects.toThrow('disk full');
    spy.mockRestore();
    expect(mockFiles.has(source)).toBe(false);
    expect(await listProgressPhotos()).toEqual([]);
  });

  it('tells subscribers about every change', async () => {
    const seen = jest.fn();
    const off = subscribeProgressPhotos(seen);
    const p = await addProgressPhoto({ sourceUri: shot('1.jpg'), pose: 'front', date: '2026-10-20', weightKg: null });
    await deleteProgressPhoto(p.id);
    await deleteAllProgressPhotos();
    expect(seen).toHaveBeenCalledTimes(3);
    off();
  });

  it('has nothing to store on the web', async () => {
    Platform.OS = 'web';
    expect(await listProgressPhotos()).toEqual([]);
    await expect(addProgressPhoto({ sourceUri: shot('1.jpg'), pose: 'front', date: '2026-10-20', weightKg: null })).rejects.toThrow();
  });
});

describe('helpers', () => {
  const photo = (id: string, pose: ProgressPhoto['pose'], date: string): ProgressPhoto => ({ id, pose, date, file: `${id}.jpg`, weightKg: null });

  it('weightOnOrBefore: that day, else the latest before it, else null', () => {
    const entries = [
      { localDate: '2026-10-01', weightKg: 84 },
      { localDate: '2026-10-10', weightKg: 83 },
      { localDate: '2026-10-25', weightKg: 82 },
    ];
    expect(weightOnOrBefore(entries, '2026-10-10')).toBe(83);
    expect(weightOnOrBefore(entries, '2026-10-20')).toBe(83);
    expect(weightOnOrBefore(entries, '2026-09-30')).toBeNull();
    expect(weightOnOrBefore([], '2026-10-20')).toBeNull();
  });

  it('picks photos of a pose, and the latest', () => {
    const all = [photo('a', 'front', '2026-09-01'), photo('b', 'side', '2026-09-02'), photo('c', 'front', '2026-10-01')];
    expect(photosOfPose(all, 'front').map((p) => p.id)).toEqual(['a', 'c']);
    expect(latestOfPose(all, 'front')?.id).toBe('c');
    expect(latestOfPose(all, 'back')).toBeNull();
  });
});
