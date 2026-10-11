import { ENGINE_CORE, poseEngineHtml } from './poseEngineHtml';

/**
 * Model choice inside the phone engine. The engine core is source text that runs in the WebView;
 * these tests evaluate that exact text against a fake MediaPipe (where the FULL and LITE models cost
 * different amounts per frame), fake downloads and a fake clock: full model by default, a quiet
 * automatic swap to lite when the full model is slow, and the GPU/CPU choice running again on lite.
 */

type Behaviour = { cost: number; start?: 'ok' | 'hang' | 'fail' | 'late' };
type Costs = { full: { GPU: Behaviour; CPU: Behaviour }; lite: { GPU: Behaviour; CPU: Behaviour } };
type Created = { model: 'full' | 'lite'; delegate: 'GPU' | 'CPU'; options: Record<string, unknown> };

const FULL_URL = 'https://model.test/full.task';
const LITE_URL = 'https://model.test/lite.task';

const fast = (cost: number): { GPU: Behaviour; CPU: Behaviour } => ({ GPU: { cost }, CPU: { cost: cost + 40 } });

function setup(opts: { costs: Partial<Costs>; liteFetch?: 'ok' | 'status' | 'reject'; gateLite?: boolean; cfg?: Record<string, unknown> }) {
  const costs: Costs = { full: fast(20), lite: fast(15), ...opts.costs };
  let now = 0;
  const clock = { now: () => now };
  const created: Created[] = [];
  const closed: string[] = [];
  const detectTs: number[] = [];
  const timeline: string[] = [];
  let lastUs = -1;
  const Vision = {
    FilesetResolver: { forVisionTasks: async (p: string) => ({ wasmLoaderPath: `${p}/vision_wasm_internal.js`, wasmBinaryPath: `${p}/vision_wasm_internal.wasm` }) },
    PoseLandmarker: {
      createFromOptions: (_files: unknown, o: { baseOptions: { delegate: 'GPU' | 'CPU'; modelAssetBuffer: Uint8Array } }) => {
        const delegate = o.baseOptions.delegate;
        const model = o.baseOptions.modelAssetBuffer[0] === 1 ? 'full' : 'lite';
        const b = costs[model][delegate];
        created.push({ model, delegate, options: o as unknown as Record<string, unknown> });
        timeline.push(`create:${model}`);
        const instance = {
          detectForVideo: (_img: unknown, tsMs: number) => {
            const us = Math.round(tsMs * 1000);
            if (us <= lastUs) throw new Error(`Packet timestamp mismatch: expected > ${lastUs}, received ${us}`);
            lastUs = us;
            detectTs.push(tsMs);
            now += b.cost;
            return { landmarks: [Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.9 }))] };
          },
          close: () => closed.push(`${model}:${delegate}`),
        };
        if (b.start === 'hang') return new Promise(() => undefined);
        if (b.start === 'fail') return Promise.reject(new Error(`${delegate} unavailable`));
        if (b.start === 'late') return new Promise((resolve) => setTimeout(() => resolve(instance), 120));
        return Promise.resolve(instance);
      },
    },
  };
  const fetched: { url: string; init: unknown }[] = [];
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const bodyOf = (bytes: number, fill: number) => {
    const chunks = [new Uint8Array(bytes / 2).fill(fill), new Uint8Array(bytes / 2).fill(fill)];
    return { getReader: () => ({ read: async () => (chunks.length ? { done: false, value: chunks.shift()! } : { done: true, value: undefined }) }) };
  };
  const fetchMock = async (url: string, init?: unknown) => {
    fetched.push({ url, init });
    const isFull = url.endsWith('full.task');
    const isLite = url.endsWith('lite.task');
    if (isLite && opts.gateLite) await gate;
    if (isLite && opts.liteFetch === 'reject') throw new Error('network down');
    if (isLite && opts.liteFetch === 'status') return { ok: false, status: 503, headers: { get: () => null } };
    const bytes = isFull ? 600 : isLite ? 400 : 1200;
    return { ok: true, status: 200, headers: { get: (h: string) => (h === 'content-length' ? String(bytes) : null) }, body: bodyOf(bytes, isFull ? 1 : isLite ? 2 : 0) };
  };
  const urls = { createObjectURL: () => 'blob:wasm' };
  const factory = new Function('self', 'fetch', 'performance', 'URL', 'Blob', `return (${ENGINE_CORE});`)({ Vision }, fetchMock, clock, urls, class {}) as (
    send: (m: unknown) => void,
    cfg: object,
  ) => (m: object) => void;
  const sent: { type: string; [k: string]: unknown }[] = [];
  const handle = factory((m) => {
    sent.push(m as { type: string });
    const x = m as { type: string; variant?: string };
    timeline.push(x.type === 'model' ? `send:model:${x.variant}` : `send:${x.type}`);
  }, {
    cdn: 'https://cdn.test',
    modelUrl: FULL_URL,
    liteUrl: LITE_URL,
    gpuTimeoutMs: 40,
    slowFrameMs: 40,
    ...opts.cfg,
  });
  let ts = 1000;
  const frames = async (n: number, fixedTs?: number) => {
    for (let i = 0; i < n; i++) {
      ts += 33;
      handle({ type: 'frame', ts: fixedTs ?? ts, bitmap: { close: () => undefined } });
      // A macrotask per frame, so downloads and creates started by the engine get to progress.
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  const waitFor = async (cond: () => boolean, ms = 1500) => {
    for (let i = 0; i < ms / 2 && !cond(); i++) await new Promise((r) => setTimeout(r, 2));
  };
  // The 'switching' notice (sent just before the lite model is created) has its own tests; `of('model')` is the full/lite verdicts.
  const of = (t: string) => sent.filter((m) => m.type === t && !(t === 'model' && m.variant === 'switching'));
  const switching = () => sent.filter((m) => m.type === 'model' && m.variant === 'switching');
  const init = async () => {
    handle({ type: 'init' });
    await waitFor(() => of('ready').length > 0 || of('error').length > 0);
  };
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));
  return { init, frames, sent, created, closed, fetched, detectTs, of, switching, timeline, release, waitFor, settle };
}

describe('phone pose engine: full model with automatic lite fallback', () => {
  it('a fast GPU keeps the full model and never fetches the lite one', async () => {
    const e = setup({ costs: { full: fast(20) } });
    await e.init();
    await e.frames(30);
    expect(e.fetched.map((f) => f.url)).toEqual(['https://cdn.test/wasm/vision_wasm_internal.wasm', FULL_URL]);
    expect(e.created.map((c) => `${c.model}:${c.delegate}`)).toEqual(['full:GPU']);
    expect(e.of('model')).toEqual([{ type: 'model', variant: 'full' }]);
    expect(e.of('backend')).toEqual([{ type: 'backend', backend: 'GPU', ms: 20 }]);
    expect(e.of('result')).toHaveLength(30);
    expect(e.closed).toEqual([]);
  });

  it('a slow full model swaps to lite, and tracking never pauses during the swap', async () => {
    const e = setup({ costs: { full: fast(50), lite: fast(15) }, gateLite: true });
    await e.init();
    await e.frames(15);
    // The lite download is under way (held back here); the full model keeps returning results.
    await e.waitFor(() => e.fetched.some((f) => f.url === LITE_URL));
    expect(e.fetched.some((f) => f.url === LITE_URL)).toBe(true);
    await e.frames(10);
    expect(e.of('result')).toHaveLength(25);
    expect(e.of('model')).toEqual([{ type: 'model', variant: 'full' }]);
    expect(e.created.map((c) => c.model)).toEqual(['full']);
    // The download finishes: lite takes over between frames, and the full model is closed.
    e.release();
    await e.waitFor(() => e.of('model').length === 2);
    expect(e.of('model')).toEqual([{ type: 'model', variant: 'full' }, { type: 'model', variant: 'lite' }]);
    expect(e.closed).toEqual(['full:GPU']);
    await e.frames(5);
    expect(e.of('result')).toHaveLength(30);
    expect(e.of('error')).toEqual([]);
    expect(e.of('frameError')).toEqual([]);
  });

  it('sends the model messages in order: full after ready, lite on the switch', async () => {
    const e = setup({ costs: { full: fast(50), lite: fast(15) } });
    await e.init();
    await e.frames(20);
    await e.waitFor(() => e.of('model').length === 2);
    const order = e.sent.filter((m) => m.type === 'ready' || m.type === 'model').map((m) => (m.type === 'model' ? `model:${m.variant}` : m.type));
    expect(order).toEqual(['ready', 'model:full', 'model:switching', 'model:lite']);
  });

  it('says it is switching before it creates the lite model, and only then', async () => {
    const e = setup({ costs: { full: fast(50), lite: fast(15) }, gateLite: true });
    await e.init();
    await e.frames(15);
    await e.waitFor(() => e.fetched.some((f) => f.url === LITE_URL));
    // Still downloading (quietly): nothing to announce yet, and nothing created.
    expect(e.switching()).toEqual([]);
    e.release();
    await e.waitFor(() => e.of('model').length === 2);
    expect(e.switching()).toEqual([{ type: 'model', variant: 'switching' }]);
    const tl = e.timeline.filter((x) => x.startsWith('create:') || x.startsWith('send:model'));
    expect(tl).toEqual(['create:full', 'send:model:full', 'send:model:switching', 'create:lite', 'send:model:lite']);
  });

  it('a fast model never announces a switch, and a failed lite download does not either', async () => {
    const quick = setup({ costs: { full: fast(20) } });
    await quick.init();
    await quick.frames(30);
    expect(quick.switching()).toEqual([]);
    const broken = setup({ costs: { full: fast(50) }, liteFetch: 'status' });
    await broken.init();
    await broken.frames(20);
    await broken.settle(30);
    expect(broken.switching()).toEqual([]);
  });

  it('a failed lite download (HTTP error) stays on full, silently, and the backend choice carries on', async () => {
    const e = setup({ costs: { full: { GPU: { cost: 50 }, CPU: { cost: 90 } } }, liteFetch: 'status' });
    await e.init();
    const progressAtReady = e.of('progress').length;
    await e.frames(45);
    expect(e.fetched.some((f) => f.url === LITE_URL)).toBe(true);
    expect(e.of('model')).toEqual([{ type: 'model', variant: 'full' }]);
    expect(e.of('error')).toEqual([]);
    expect(e.of('frameError')).toEqual([]);
    expect(e.of('progress')).toHaveLength(progressAtReady);
    expect(e.created.every((c) => c.model === 'full')).toBe(true);
    expect(e.of('result')).toHaveLength(45);
    // The slow GPU was still compared with the CPU on the full model, as before.
    expect(e.of('backend')).toEqual([{ type: 'backend', backend: 'GPU', ms: 50 }]);
    expect(e.closed).toEqual(['full:CPU']);
  });

  it('a lite download that throws stays on full, silently', async () => {
    const e = setup({ costs: { full: fast(50) }, liteFetch: 'reject' });
    await e.init();
    await e.frames(25);
    expect(e.of('model')).toEqual([{ type: 'model', variant: 'full' }]);
    expect(e.of('error')).toEqual([]);
    expect(e.of('result')).toHaveLength(25);
    expect(e.closed).not.toContain('full:GPU');
  });

  it('a lite model that fails to start stays on full', async () => {
    const e = setup({ costs: { full: fast(50), lite: { GPU: { cost: 15, start: 'fail' }, CPU: { cost: 15 } } } });
    await e.init();
    await e.frames(25);
    expect(e.created.map((c) => `${c.model}:${c.delegate}`)).toContain('lite:GPU');
    expect(e.of('model')).toEqual([{ type: 'model', variant: 'full' }]);
    expect(e.of('error')).toEqual([]);
    expect(e.closed).not.toContain('full:GPU');
    expect(e.of('result')).toHaveLength(25);
  });

  it('a lite model that hangs while starting stays on full, and is closed if it ever finishes', async () => {
    const e = setup({ costs: { full: fast(50), lite: { GPU: { cost: 15, start: 'late' }, CPU: { cost: 15 } } } });
    await e.init();
    await e.frames(20);
    // The start timeout (40 ms here) passes well before the late create finishes (120 ms).
    await e.settle(250);
    await e.frames(3);
    expect(e.of('model')).toEqual([{ type: 'model', variant: 'full' }]);
    expect(e.of('error')).toEqual([]);
    expect(e.closed).toEqual(['lite:GPU']);
    expect(e.of('result')).toHaveLength(23);
  });

  it('a lite model that never finishes starting stays on full', async () => {
    const e = setup({ costs: { full: fast(50), lite: { GPU: { cost: 15, start: 'hang' }, CPU: { cost: 15 } } } });
    await e.init();
    await e.frames(20);
    await e.settle(100);
    await e.frames(3);
    expect(e.of('model')).toEqual([{ type: 'model', variant: 'full' }]);
    expect(e.of('error')).toEqual([]);
    expect(e.of('result')).toHaveLength(23);
  });

  it('without a lite URL there is no model choice and no model messages (behaviour as before)', async () => {
    const e = setup({ costs: { full: { GPU: { cost: 70 }, CPU: { cost: 30 } } }, cfg: { liteUrl: undefined } });
    await e.init();
    await e.frames(40);
    expect(e.of('model')).toEqual([]);
    expect(e.fetched.map((f) => f.url)).toEqual(['https://cdn.test/wasm/vision_wasm_internal.wasm', FULL_URL]);
    // Slow, but with nothing to fall back to the old GPU-versus-CPU trial runs, exactly as before.
    expect(e.of('backend')).toEqual([{ type: 'backend', backend: 'CPU', ms: 30 }]);
    expect(e.closed).toEqual(['full:GPU']);
    expect(e.of('result')).toHaveLength(40);
  });

  it('reports no download progress while the lite model is fetched', async () => {
    const e = setup({ costs: { full: fast(50), lite: fast(15) } });
    await e.init();
    const progress = e.of('progress').map((m) => [m.stage, m.pct]);
    expect(progress.at(-1)).toEqual(['starting', 100]);
    await e.frames(20);
    await e.waitFor(() => e.of('model').length === 2);
    await e.frames(20);
    expect(e.of('progress').map((m) => [m.stage, m.pct])).toEqual(progress);
  });

  it('every download asks the cache first', async () => {
    const e = setup({ costs: { full: fast(50) } });
    await e.init();
    await e.frames(20);
    await e.waitFor(() => e.of('model').length === 2);
    expect(e.fetched.length).toBeGreaterThanOrEqual(3);
    e.fetched.forEach((f) => expect(f.init).toEqual({ cache: 'force-cache' }));
  });

  it('timestamps strictly increase through the swap, even when the caller repeats a time', async () => {
    const e = setup({ costs: { full: fast(50), lite: fast(15) } });
    await e.init();
    await e.frames(20, 5000);
    await e.waitFor(() => e.of('model').length === 2);
    await e.frames(20, 5000);
    expect(e.of('model')).toHaveLength(2);
    const resultTs = e.of('result').map((m) => m.ts as number);
    expect(resultTs).toHaveLength(40);
    resultTs.forEach((t, i) => i > 0 && expect(t).toBeGreaterThan(resultTs[i - 1]));
    e.detectTs.forEach((t, i) => i > 0 && expect(t).toBeGreaterThan(e.detectTs[i - 1]));
    expect(e.of('frameError')).toEqual([]);
  });

  it('after the swap the GPU/CPU choice runs again on lite, using the lite model', async () => {
    const e = setup({ costs: { full: fast(50), lite: { GPU: { cost: 60 }, CPU: { cost: 30 } } } });
    await e.init();
    await e.frames(20);
    await e.waitFor(() => e.of('model').length === 2);
    // No backend verdict was given for the full model: it was replaced before one was reached.
    expect(e.of('backend')).toEqual([]);
    await e.frames(45);
    expect(e.created.map((c) => `${c.model}:${c.delegate}`)).toEqual(['full:GPU', 'lite:GPU', 'lite:CPU']);
    expect(e.of('backend')).toEqual([{ type: 'backend', backend: 'CPU', ms: 30 }]);
    expect(e.closed).toEqual(['full:GPU', 'lite:GPU']);
    expect(e.of('model')).toHaveLength(2);
    expect(e.of('frameError')).toEqual([]);
  });

  it('a lite model that is itself fast on the GPU gets one GPU verdict', async () => {
    const e = setup({ costs: { full: fast(50), lite: fast(15) } });
    await e.init();
    await e.frames(20);
    await e.waitFor(() => e.of('model').length === 2);
    await e.frames(25);
    expect(e.of('backend')).toEqual([{ type: 'backend', backend: 'GPU', ms: 15 }]);
    expect(e.created.map((c) => `${c.model}:${c.delegate}`)).toEqual(['full:GPU', 'lite:GPU']);
  });

  it('passes the confidence options to the landmarker, for both models', async () => {
    const e = setup({ costs: { full: fast(50), lite: fast(15) } });
    await e.init();
    await e.frames(20);
    await e.waitFor(() => e.of('model').length === 2);
    expect(e.created.map((c) => c.model)).toEqual(['full', 'lite']);
    e.created.forEach((c) => {
      expect(c.options).toMatchObject({ numPoses: 1, runningMode: 'VIDEO', minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
    });
  });

  it('takes the confidence options from the settings when given', async () => {
    const e = setup({ costs: { full: fast(20) }, cfg: { confDetection: 0.6, confPresence: 0.3, confTracking: 0.2 } });
    await e.init();
    expect(e.created[0].options).toMatchObject({ minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.3, minTrackingConfidence: 0.2 });
  });

  it('the model budget comes from the settings', async () => {
    const e = setup({ costs: { full: fast(50), lite: fast(15) }, cfg: { modelBudgetMs: 80 } });
    await e.init();
    await e.frames(30);
    expect(e.of('model')).toEqual([{ type: 'model', variant: 'full' }]);
    expect(e.fetched.some((f) => f.url === LITE_URL)).toBe(false);
  });

  it('sizes the progress bar from the model bytes setting', async () => {
    const e = setup({ costs: { full: fast(20) }, cfg: { modelBytes: 9e6 } });
    await e.init();
    expect(e.of('progress').at(-1)).toEqual({ type: 'progress', stage: 'starting', pct: 100 });
    expect(e.of('progress').every((m) => (m.pct as number) <= 100)).toBe(true);
  });
});

describe('phone pose engine: page wiring for the model settings', () => {
  const colors = { good: '#0f0', warn: '#ff0', other: '#f00' };
  const cfgOf = (html: string) => JSON.parse(/const CFG = (.*);\n/.exec(html)![1]);

  it('passes the lite URL, sizes, budget and confidence into the engine settings', () => {
    const html = poseEngineHtml({ modelUrl: 'https://example.test/full.task', liteModelUrl: 'https://example.test/lite.task', colors });
    const cfg = cfgOf(html);
    expect(cfg.liteUrl).toBe('https://example.test/lite.task');
    expect(cfg.engine).toMatchObject({ modelBytes: 9_000_000, liteBytes: 5_500_000, modelBudgetMs: 32, confDetection: 0.5, confPresence: 0.4, confTracking: 0.4 });
    expect(html).toContain('liteUrl: CFG.liteUrl');
    expect(html).toContain('CFG.engine');
  });

  it('has no lite model unless asked, and keeps the old page contract', () => {
    const html = poseEngineHtml({ modelUrl: 'https://example.test/full.task', colors });
    expect(cfgOf(html).liteUrl).toBeNull();
    expect(html).toContain(JSON.stringify(ENGINE_CORE));
    expect(html).toContain('new Worker(');
    expect(html).not.toContain('.toString()');
  });
});

describe('ENGINE_CORE text hygiene', () => {
  it('is plain ES2017 source text that compiles on its own', () => {
    expect(() => new Function(`return (${ENGINE_CORE});`)).not.toThrow();
  });

  it('avoids everything that breaks inside the page template', () => {
    expect(ENGINE_CORE).not.toContain('`');
    expect(ENGINE_CORE).not.toContain('${');
    expect(ENGINE_CORE).not.toContain('\\');
    expect(ENGINE_CORE).not.toContain('.toString()');
    expect(ENGINE_CORE).not.toContain('</script');
    expect(ENGINE_CORE).not.toContain('shadowBlur');
    expect(ENGINE_CORE).not.toContain('??');
    expect(ENGINE_CORE).not.toMatch(/\?\.(?!\d)/);
    expect(ENGINE_CORE.includes(String.fromCharCode(0x2028)) || ENGINE_CORE.includes(String.fromCharCode(0x2029))).toBe(false);
    expect(ENGINE_CORE).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // Newer than ES2017: optional catch binding, object spread, exponent operator, async generators.
    expect(ENGINE_CORE).not.toMatch(/catch\s*\{/);
    expect(ENGINE_CORE).not.toMatch(/\{\s*\.\.\./);
    expect(ENGINE_CORE).not.toContain('**');
    expect(ENGINE_CORE).not.toMatch(/async\s*\*|for\s+await/);
  });

  it('has no regular expression literals', () => {
    // A slash that starts an expression (after an operator or opening bracket) and isn't a comment.
    const lines = ENGINE_CORE.split('\n').map((l) => l.replace(/'[^']*'/g, "''"));
    const offenders = lines.filter((l) => /(^|[=(,:;!&|?{}[])\s*\/(?![/*])/.test(l));
    expect(offenders).toEqual([]);
  });
});
