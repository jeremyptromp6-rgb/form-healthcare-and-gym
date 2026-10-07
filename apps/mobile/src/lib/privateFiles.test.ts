import { Platform } from 'react-native';
import { purgeLocalExports, saveExport } from './privateFiles';

const mockFiles = new Map<string, string>();
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(dirOrUri: string, name?: string) {
      this.uri = name ? `${dirOrUri}/${name}` : dirOrUri;
    }
    get name() {
      return this.uri.split('/').pop()!;
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
    delete() {
      mockFiles.delete(this.uri);
    }
  }
  class Directory {
    mockDir: string;
    constructor(mockDirPath: string) {
      this.mockDir = mockDirPath;
    }
    list() {
      return [...mockFiles.keys()].filter((k) => k.startsWith(`${this.mockDir}/`)).map((k) => new File(k));
    }
  }
  return { File, Directory, Paths: { cache: 'file:///cache', document: 'file:///docs' } };
});
const mockShare = jest.fn();
jest.mock('expo-sharing', () => ({ isAvailableAsync: async () => true, shareAsync: (...a: unknown[]) => mockShare(...a) }));

describe('the data export on a phone', () => {
  beforeAll(() => {
    Platform.OS = 'ios';
  });
  beforeEach(() => mockFiles.clear());

  it('is handed to the share sheet as a JSON file and never kept by FORM', async () => {
    mockShare.mockImplementation(async (uri: string) => expect(mockFiles.get(uri)).toBe('{"a":1}'));
    await expect(saveExport('{"a":1}', 'form-export-2026-10-02.json')).resolves.toEqual({ where: 'shared', uri: null });
    expect(mockShare).toHaveBeenCalledWith('file:///cache/form-export-2026-10-02.json', expect.objectContaining({ mimeType: 'application/json', UTI: 'public.json' }));
    expect(mockFiles.size).toBe(0);
  });

  it('is deleted even when sharing fails', async () => {
    mockShare.mockRejectedValue(new Error('cancelled'));
    await expect(saveExport('{}', 'form-export-x.json')).rejects.toThrow('cancelled');
    expect(mockFiles.size).toBe(0);
  });

  it('leftover exports are purged at sign-out; other files are left alone', () => {
    mockFiles.set('file:///docs/form-export-old.json', '{}');
    mockFiles.set('file:///cache/form-export-crash.json', '{}');
    mockFiles.set('file:///cache/picked-photo.jpg', 'x');
    purgeLocalExports();
    expect([...mockFiles.keys()]).toEqual(['file:///cache/picked-photo.jpg']);
  });
});
