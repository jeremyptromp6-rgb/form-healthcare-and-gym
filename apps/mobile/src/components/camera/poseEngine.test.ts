import { ENGINE_CORE, poseEngineHtml } from './poseEngineHtml';

/**
 * The engine core is source text that runs inside the WebView. These tests evaluate that exact
 * text against a fake MediaPipe, fake downloads and a fake clock: one-time downloads with
 * progress, one pose model at a time, the GPU start timeout, and the GPU/CPU choice on real frames.
 */

type Behaviour = { cost: number; start?: 'ok' | 'hang' | 'fail' };

function setup(opts: { GPU: Behaviour; CPU: Behaviour; modelStatus?: number }) {
  let now = 0;
  const clock = { now: () => now };
  const created: string[] = [];
  const closed: string[] = [];
  let lastUs = -1;
  const Vision = {
    FilesetResolver: { forVisionTasks: async (p: string) => ({ wasmLoaderPath: `${p}/vision_wasm_internal.js`, wasmBinaryPath: `${p}/vision_wasm_internal.wasm` }) },
    PoseLandmarker: {
      createFromOptions: (files: { wasmBinaryPath: string }, o: { baseOptions: { delegate: 'GPU' | 'CPU' }; numPoses: number }) => {
        const d = o.baseOptions.delegate;
        const b = opts[d];
        created.push(`${d}:${o.numPoses}:${files.wasmBinaryPath}`);
        if (b.start === 'hang') return new Promise(() => undefined);
        if (b.start === 'fail') return Promise.reject(new Error(`${d} unavailable`));
        return Promise.resolve({
          detectForVideo: (_img: unknown, tsMs: number) => {
            const us = Math.round(tsMs * 1000);
            if (us <= lastUs) throw new Error(`Packet timestamp mismatch: expected > ${lastUs}, received ${us}`);
            lastUs = us;
            now += b.cost;
            return { landmarks: [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }))] };
          },
          close: () => closed.push(d),
        });
      },
    },
  };
  const fetched: string[] = [];
  const bodyOf = (bytes: number) => {
    const chunks = [new Uint8Array(bytes / 2), new Uint8Array(bytes / 2)];
    return { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift()! } : { done: true, value: undefined }) }) };
  };
  const fetchMock = async (url: string) => {
    fetched.push(url);
    const isModel = url.endsWith('.task');
    if (isModel && opts.modelStatus && opts.modelStatus !== 200) return { ok: false, status: opts.modelStatus, headers: { get: () => null } };
    const bytes = isModel ? 600 : 1200;
    return { ok: true, status: 200, headers: { get: (h: string) => (h === 'content-length' ? String(bytes) : null) }, body: bodyOf(bytes) };
  };
  const urls = { createObjectURL: () => 'blob:wasm' };
  const factory = new Function('self', 'fetch', 'performance', 'URL', 'Blob', `return (${ENGINE_CORE});`)({ Vision }, fetchMock, clock, urls, class {}) as (
    send: (m: unknown) => void,
    cfg: object,
  ) => (m: object) => void;
  const sent: { type: string; [k: string]: unknown }[] = [];
  const handle = factory((m) => sent.push(m as { type: string }), { cdn: 'https://cdn.test', modelUrl: 'https://model.test/pose.task', gpuTimeoutMs: 40, slowFrameMs: 40 });
  let ts = 1000;
  const frames = async (n: number) => {
    for (let i = 0; i < n; i++) {
      ts += 33;
      handle({ type: 'frame', ts, bitmap: { close: () => undefined } });
      await Promise.resolve();
    }
  };
  const until = async (type: string) => {
    for (let i = 0; i < 200 && !sent.some((m) => m.type === type); i++) await new Promise((r) => setTimeout(r, 2));
  };
  const init = async () => {
    handle({ type: 'init' });
    await until('ready');
    if (!sent.some((m) => m.type === 'ready')) await until('error');
  };
  return { init, frames, sent, created, closed, fetched, of: (t: string) => sent.filter((m) => m.type === t) };
}

describe('phone pose engine core', () => {
  it('downloads the runtime and model once with progress, and runs ONE pose model (GPU when fast)', async () => {
    const e = setup({ GPU: { cost: 20 }, CPU: { cost: 30 } });
    await e.init();
    expect(e.fetched).toEqual(['https://cdn.test/wasm/vision_wasm_internal.wasm', 'https://model.test/pose.task']);
    const progress = e.of('progress').map((m) => [m.stage, m.pct]);
    expect(progress[0]).toEqual(['runtime', 0]);
    expect(progress.some(([s]) => s === 'model')).toBe(true);
    expect(progress.at(-1)).toEqual(['starting', 100]);
    // MediaPipe gets the downloaded runtime from memory, not a second download.
    expect(e.created).toEqual(['GPU:1:blob:wasm']);
    expect(e.of('ready')).toEqual([{ type: 'ready', backend: 'GPU' }]);
    await e.frames(20);
    expect(e.created).toHaveLength(1);
    expect(e.of('backend')).toEqual([{ type: 'backend', backend: 'GPU', ms: 20 }]);
    expect(e.of('result')).toHaveLength(20);
  });

  it('gives up on a GPU that never finishes starting and uses the CPU', async () => {
    const e = setup({ GPU: { cost: 10, start: 'hang' }, CPU: { cost: 30 } });
    await e.init();
    expect(e.of('ready')).toEqual([{ type: 'ready', backend: 'CPU' }]);
    await e.frames(3);
    expect(e.of('result')).toHaveLength(3);
  });

  it('uses the CPU when the GPU cannot start at all', async () => {
    const e = setup({ GPU: { cost: 10, start: 'fail' }, CPU: { cost: 30 } });
    await e.init();
    expect(e.of('ready')).toEqual([{ type: 'ready', backend: 'CPU' }]);
  });

  it('switches to the CPU when the GPU is slow on real frames and the CPU is faster', async () => {
    const e = setup({ GPU: { cost: 70 }, CPU: { cost: 30 } });
    await e.init();
    await e.frames(40);
    expect(e.of('backend')).toEqual([{ type: 'backend', backend: 'CPU', ms: 30 }]);
    expect(e.closed).toEqual(['GPU']);
    // Tracking never paused while the CPU was tried.
    expect(e.of('result')).toHaveLength(40);
  });

  it('keeps a slow GPU when the CPU is slower still', async () => {
    const e = setup({ GPU: { cost: 60 }, CPU: { cost: 90 } });
    await e.init();
    await e.frames(40);
    expect(e.of('backend')).toEqual([{ type: 'backend', backend: 'GPU', ms: 60 }]);
    expect(e.closed).toEqual(['CPU']);
  });

  it('says so when the model cannot be downloaded', async () => {
    const e = setup({ GPU: { cost: 20 }, CPU: { cost: 20 }, modelStatus: 503 });
    await e.init();
    expect(e.of('error')).toEqual([{ type: 'error', message: 'model 503' }]);
    expect(e.created).toHaveLength(0);
  });

  it('the page embeds the core as text and runs the model in a worker, with an in-page fallback', () => {
    const html = poseEngineHtml({ modelUrl: 'https://example.test/pose.task', colors: { good: '#0f0', warn: '#ff0', other: '#f00' } });
    expect(html).toContain(JSON.stringify(ENGINE_CORE));
    expect(html).toContain('new Worker(');
    expect(html).toContain('startInline');
    expect(html).toContain('requestVideoFrameCallback');
    // Download progress reaches the app.
    expect(html).toContain("post({ t: 'pose', kind: 'loading', stage: m.stage, pct: m.pct })");
    // Nothing relies on Function.prototype.toString (Hermes returns bytecode, not source).
    expect(html).not.toContain('.toString()');
  });
});
