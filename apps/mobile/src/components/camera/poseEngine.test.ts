import { CROWD_CHECK_MS, ENGINE_CORE, poseEngineHtml } from './poseEngineHtml';

/**
 * The engine core is source text that runs inside the WebView. These tests evaluate that exact
 * text against a fake MediaPipe and a fake clock: backend choice on real frames, fallback when a
 * backend can't start, and the "only you in frame" crowd check.
 */

type Pt = { x: number; y: number; visibility: number };
const person = (cx: number): Pt[] => Array.from({ length: 33 }, (_, i) => ({ x: cx + (i % 3) * 0.01, y: 0.1 + (i / 33) * 0.8, visibility: 0.95 }));

function setup(opts: { cost: Record<string, number>; failing?: string[]; crowdSees?: () => Pt[][]; modelStatus?: number }) {
  let now = 0;
  const clock = { now: () => now };
  const closed: string[] = [];
  const created: string[] = [];
  const Vision = {
    FilesetResolver: { forVisionTasks: async () => ({}) },
    PoseLandmarker: {
      createFromOptions: async (_files: unknown, o: { baseOptions: { delegate: string }; runningMode: string; numPoses: number }) => {
        const delegate = o.baseOptions.delegate;
        if (opts.failing?.includes(delegate)) throw new Error(`${delegate} unavailable`);
        created.push(`${o.runningMode}:${delegate}:${o.numPoses}`);
        return {
          detectForVideo: () => {
            now += opts.cost[delegate]!;
            return { landmarks: [person(0.5)] };
          },
          detect: () => {
            now += 5;
            return { landmarks: opts.crowdSees ? opts.crowdSees() : [person(0.5)] };
          },
          close: () => closed.push(delegate),
        };
      },
    },
  };
  const fetchMock = async () => ({ ok: (opts.modelStatus ?? 200) === 200, status: opts.modelStatus ?? 200, arrayBuffer: async () => new ArrayBuffer(8) });
  const sent: { type: string; [k: string]: unknown }[] = [];
  const factory = new Function('self', 'fetch', 'performance', `return (${ENGINE_CORE});`)({ Vision }, fetchMock, clock) as (
    send: (m: unknown) => void,
    cfg: object,
  ) => (m: object) => void;
  const handle = factory((m) => sent.push(m as { type: string }), { cdn: 'https://cdn.test', modelUrl: 'https://model.test/pose.task', crowdEveryMs: CROWD_CHECK_MS });
  let ts = 1000;
  const frame = (dt = 33) => {
    ts += dt;
    handle({ type: 'frame', ts, bitmap: { close: () => undefined } });
  };
  const init = async () => {
    handle({ type: 'init' });
    for (let i = 0; i < 10; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { init, frame, sent, closed, created, results: () => sent.filter((m) => m.type === 'result') as unknown as { people: number[][][] }[] };
}

describe('phone pose engine core', () => {
  it('tracks one person per frame and keeps whichever backend is faster on real frames', async () => {
    const e = setup({ cost: { GPU: 50, CPU: 30 } });
    await e.init();
    expect(e.sent[0]).toEqual({ type: 'ready', backend: 'GPU' });
    expect(e.created).toEqual(['VIDEO:GPU:1', 'VIDEO:CPU:1', 'IMAGE:CPU:2']);
    for (let i = 0; i < 20; i++) e.frame();
    expect(e.sent.find((m) => m.type === 'backend')).toEqual({ type: 'backend', backend: 'CPU', ms: 30 });
    expect(e.closed).toEqual(['GPU']);
    expect(e.results()).toHaveLength(20);
  });

  it('keeps the GPU when it is the faster one', async () => {
    const e = setup({ cost: { GPU: 12, CPU: 40 } });
    await e.init();
    for (let i = 0; i < 20; i++) e.frame();
    expect(e.sent.find((m) => m.type === 'backend')).toMatchObject({ backend: 'GPU' });
    expect(e.closed).toEqual(['CPU']);
  });

  it('uses the CPU alone when the GPU cannot start (no probing)', async () => {
    const e = setup({ cost: { GPU: 10, CPU: 30 }, failing: ['GPU'] });
    await e.init();
    expect(e.sent[0]).toEqual({ type: 'ready', backend: 'CPU' });
    for (let i = 0; i < 20; i++) e.frame();
    expect(e.sent.some((m) => m.type === 'backend')).toBe(false);
  });

  it('reports a second person found by the periodic crowd check, then drops it once they leave', async () => {
    let crowd: Pt[][] = [person(0.5), person(0.15)];
    const e = setup({ cost: { GPU: 20, CPU: 20 }, crowdSees: () => crowd });
    await e.init();
    e.frame();
    expect(e.results().at(-1)!.people).toHaveLength(2);
    // Between checks the other person stays reported (the rep gate must not flicker open).
    e.frame();
    expect(e.results().at(-1)!.people).toHaveLength(2);
    crowd = [person(0.5)];
    e.frame(CROWD_CHECK_MS);
    expect(e.results().at(-1)!.people).toHaveLength(1);
  });

  it('never counts the tracked person twice', async () => {
    const e = setup({ cost: { GPU: 20, CPU: 20 }, crowdSees: () => [person(0.5)] });
    await e.init();
    e.frame();
    expect(e.results().at(-1)!.people).toHaveLength(1);
  });

  it('says so when the model cannot be downloaded', async () => {
    const e = setup({ cost: { GPU: 20, CPU: 20 }, modelStatus: 503 });
    await e.init();
    expect(e.sent).toEqual([{ type: 'error', message: 'model 503' }]);
  });

  it('the page embeds the core as text and runs the model in a worker, with an in-page fallback', () => {
    const html = poseEngineHtml({ modelUrl: 'https://example.test/pose.task', colors: { good: '#0f0', warn: '#ff0', other: '#f00' } });
    expect(html).toContain(JSON.stringify(ENGINE_CORE));
    expect(html).toContain('new Worker(');
    expect(html).toContain('startInline');
    expect(html).toContain('requestVideoFrameCallback');
    // Nothing relies on Function.prototype.toString (Hermes returns bytecode, not source).
    expect(html).not.toContain('.toString()');
  });
});
