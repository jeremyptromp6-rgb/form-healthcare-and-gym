import { nativePoseEnabled, resolveBuildChannel } from './config';

/** Loads the real config module with the given EXPO_PUBLIC_* variables, as a build would inline them. */
function loadConfig(env: Record<string, string | undefined>) {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) saved[k] = process.env[k];
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    let cfg!: typeof import('./config').config;
    jest.isolateModules(() => {
      cfg = (require('./config') as typeof import('./config')).config;
    });
    return cfg;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('resolveBuildChannel', () => {
  it('defaults to main and keeps whatever the pipeline set', () => {
    expect(resolveBuildChannel(undefined)).toBe('main');
    expect(resolveBuildChannel('')).toBe('main');
    expect(resolveBuildChannel('  ')).toBe('main');
    expect(resolveBuildChannel('preview')).toBe('preview');
    expect(resolveBuildChannel(' main ')).toBe('main');
  });
});

describe('nativePoseEnabled', () => {
  it('is on by default and off only for an explicit 0/false/off', () => {
    expect(nativePoseEnabled(undefined)).toBe(true);
    expect(nativePoseEnabled('')).toBe(true);
    expect(nativePoseEnabled('1')).toBe(true);
    expect(nativePoseEnabled('true')).toBe(true);
    expect(nativePoseEnabled('0')).toBe(false);
    expect(nativePoseEnabled('false')).toBe(false);
    expect(nativePoseEnabled('OFF')).toBe(false);
  });
});

describe('config diagnostics flags', () => {
  const base = { EXPO_PUBLIC_API_URL: 'https://api.test' };

  it('main builds have diagnostics off and the native camera on', () => {
    const c = loadConfig({ ...base, EXPO_PUBLIC_BUILD_CHANNEL: undefined, EXPO_PUBLIC_POSE_NATIVE: undefined });
    expect(c.buildChannel).toBe('main');
    expect(c.diagnostics).toBe(false);
    expect(c.nativePose).toBe(true);
  });

  it('only the preview channel turns diagnostics on', () => {
    expect(loadConfig({ ...base, EXPO_PUBLIC_BUILD_CHANNEL: 'preview' }).diagnostics).toBe(true);
    expect(loadConfig({ ...base, EXPO_PUBLIC_BUILD_CHANNEL: 'preview' }).buildChannel).toBe('preview');
    expect(loadConfig({ ...base, EXPO_PUBLIC_BUILD_CHANNEL: 'main' }).diagnostics).toBe(false);
    expect(loadConfig({ ...base, EXPO_PUBLIC_BUILD_CHANNEL: 'production' }).diagnostics).toBe(false);
  });

  it('EXPO_PUBLIC_POSE_NATIVE=0 is the native kill switch', () => {
    expect(loadConfig({ ...base, EXPO_PUBLIC_POSE_NATIVE: '0' }).nativePose).toBe(false);
    expect(loadConfig({ ...base, EXPO_PUBLIC_POSE_NATIVE: '1' }).nativePose).toBe(true);
  });
});
