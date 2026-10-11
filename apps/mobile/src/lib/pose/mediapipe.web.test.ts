/** @jest-environment jsdom */
import { config } from '@/lib/config';
import { MODEL_BUDGET_MS, POSE_CONFIDENCE, POSE_MODEL_URLS } from './poseModels';
import { createPoseProvider } from './mediapipe.web';

// The real config module needs an API address this environment lacks; only the model URLs matter here.
jest.mock('@/lib/config', () => {
  const urls = jest.requireActual('./poseModels').POSE_MODEL_URLS;
  return { config: { poseModelUrl: urls.full, poseLiteModelUrl: urls.lite } };
});

// A fake MediaPipe: every landmarker it builds is recorded, and each inference "takes" the cost the
// test set on a fake clock (performance.now is stubbed to read it), so the model timing is exact.
let mockNow = 0;
let mockCost = 10;
interface MockLandmarker {
  url: string;
  delegate: string;
  options: Record<string, unknown>;
  closed: boolean;
  stamps: number[];
  detectForVideo: jest.Mock;
  close: jest.Mock;
}
let mockMade: MockLandmarker[] = [];
let mockFailLite = false;
let mockHold: (() => void) | null = null;

function install() {
  const create = jest.fn(async (_fileset: unknown, options: { baseOptions: { modelAssetPath: string; delegate: string }; [k: string]: unknown }) => {
    const { modelAssetPath, delegate } = options.baseOptions;
    const lite = modelAssetPath === config.poseLiteModelUrl;
    if (lite && mockFailLite) throw new Error('lite failed');
    if (lite && mockHold) await new Promise<void>((resolve) => (mockHold = resolve));
    const lm: MockLandmarker = {
      url: modelAssetPath,
      delegate,
      options,
      closed: false,
      stamps: [],
      detectForVideo: jest.fn((_src: unknown, ts: number) => {
        lm.stamps.push(ts);
        mockNow += mockCost;
        return { landmarks: [] };
      }),
      close: jest.fn(() => {
        lm.closed = true;
      }),
    };
    mockMade.push(lm);
    return lm;
  });
  window.__formVision = { FilesetResolver: { forVisionTasks: jest.fn(async () => ({})) }, PoseLandmarker: { createFromOptions: create } } as never;
  return create;
}

const video = { videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

beforeEach(() => {
  mockNow = 1000;
  mockCost = 10;
  mockMade = [];
  mockFailLite = false;
  mockHold = null;
  jest.spyOn(performance, 'now').mockImplementation(() => mockNow);
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => {
  jest.restoreAllMocks();
  delete window.__formVision;
});

async function run(provider: ReturnType<typeof createPoseProvider>, n: number, startTs = 100) {
  for (let i = 0; i < n; i++) {
    const r = await provider.estimate(video, startTs + i * 33);
    expect(r.ok).toBe(true);
  }
}
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('web pose provider: model and confidences', () => {
  it('builds the configured full model with the shared confidences and two poses', async () => {
    const create = install();
    const p = createPoseProvider();
    expect((await p.load()).ok).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    const made = mockMade[0]!;
    expect(made.url).toBe(config.poseModelUrl);
    expect(made.url).toBe(POSE_MODEL_URLS.full);
    expect(made.options).toMatchObject({
      numPoses: 2,
      minPoseDetectionConfidence: POSE_CONFIDENCE.detection,
      minPosePresenceConfidence: POSE_CONFIDENCE.presence,
      minTrackingConfidence: POSE_CONFIDENCE.tracking,
    });
    expect(p.backend).toBe('GPU');
  });
});

describe('web pose provider: lite fallback', () => {
  it('has a lite model configured in the default build (the tests below depend on it)', () => {
    expect(config.poseLiteModelUrl).toBeTruthy();
  });

  it('stays on the full model when inference is within budget', async () => {
    install();
    mockCost = MODEL_BUDGET_MS - 2;
    const p = createPoseProvider();
    await p.load();
    await run(p, 40);
    await flush();
    expect(mockMade).toHaveLength(1);
    expect(mockMade[0]!.closed).toBe(false);
  });

  it('does not judge on the slow first estimates alone (they pay for warm-up)', async () => {
    install();
    const p = createPoseProvider();
    await p.load();
    for (let i = 0; i < 4; i++) {
      mockCost = 200; // the first four are slow...
      await p.estimate(video, 100 + i);
    }
    mockCost = 10; // ...then the device is fine
    await run(p, 20, 500);
    await flush();
    expect(mockMade).toHaveLength(1);
  });

  it('swaps to lite on the same delegate when the median is over budget, then closes the full one', async () => {
    install();
    mockCost = MODEL_BUDGET_MS + 10;
    const p = createPoseProvider();
    await p.load();
    await run(p, 15);
    await flush();
    expect(mockMade).toHaveLength(2);
    const [full, lite] = mockMade as [MockLandmarker, MockLandmarker];
    expect(lite.url).toBe(config.poseLiteModelUrl);
    expect(lite.delegate).toBe(full.delegate);
    expect(lite.options).toMatchObject({ numPoses: 2, minPoseDetectionConfidence: POSE_CONFIDENCE.detection });
    expect(full.closed).toBe(true);
    // From now on the lite model serves.
    const before = lite.detectForVideo.mock.calls.length;
    await p.estimate(video, 5000);
    expect(lite.detectForVideo.mock.calls.length).toBe(before + 1);
  });

  it('keeps the full model serving until lite is ready, then swaps', async () => {
    install();
    mockCost = MODEL_BUDGET_MS + 10;
    mockHold = () => {};
    const p = createPoseProvider();
    await p.load();
    await run(p, 15);
    await run(p, 5, 2000); // lite is still being built: the full model answers
    const full = mockMade[0]!;
    expect(full.closed).toBe(false);
    expect(full.detectForVideo.mock.calls.length).toBeGreaterThanOrEqual(20);
    mockHold!(); // lite finishes building
    await flush();
    expect(full.closed).toBe(true);
    expect(mockMade).toHaveLength(2);
  });

  it('stays on full, silently, when lite fails to build', async () => {
    install();
    mockCost = MODEL_BUDGET_MS + 10;
    mockFailLite = true;
    const p = createPoseProvider();
    await p.load();
    await run(p, 15);
    await flush();
    expect(mockMade).toHaveLength(1);
    expect(mockMade[0]!.closed).toBe(false);
    const r = await p.estimate(video, 9000);
    expect(r.ok).toBe(true);
    expect(mockMade[0]!.detectForVideo.mock.calls.length).toBeGreaterThan(15);
  });

  it('only tries once, however long it runs', async () => {
    const create = install();
    mockCost = MODEL_BUDGET_MS + 10;
    mockFailLite = true;
    const p = createPoseProvider();
    await p.load();
    await run(p, 60);
    await flush();
    // One build for the full model, one (failed) attempt at lite.
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('never swaps when no lite model is configured', async () => {
    install();
    mockCost = MODEL_BUDGET_MS + 10;
    const lite = config.poseLiteModelUrl;
    (config as { poseLiteModelUrl: string | null }).poseLiteModelUrl = null;
    try {
      const p = createPoseProvider();
      await p.load();
      await run(p, 30);
      await flush();
      expect(mockMade).toHaveLength(1);
    } finally {
      (config as { poseLiteModelUrl: string | null }).poseLiteModelUrl = lite;
    }
  });

  it('passes strictly increasing timestamps to every landmarker, across the swap and repeated clock values', async () => {
    install();
    mockCost = MODEL_BUDGET_MS + 10;
    const p = createPoseProvider();
    await p.load();
    for (let i = 0; i < 15; i++) await p.estimate(video, 100); // the caller's clock does not advance
    await flush();
    for (let i = 0; i < 10; i++) await p.estimate(video, 50); // ...or even goes backwards
    const stamps = mockMade
      .flatMap((m) => m.detectForVideo.mock.invocationCallOrder.map((order, i) => ({ order, t: m.stamps[i]! })))
      .sort((a, b) => a.order - b.order)
      .map((x) => x.t);
    expect(mockMade).toHaveLength(2);
    expect(stamps.length).toBeGreaterThan(25);
    for (let i = 1; i < stamps.length; i++) expect(stamps[i]!).toBeGreaterThan(stamps[i - 1]!);
  });

  it('closing during the swap frees the new model and leaves nothing open', async () => {
    install();
    mockCost = MODEL_BUDGET_MS + 10;
    mockHold = () => {};
    const p = createPoseProvider();
    await p.load();
    await run(p, 15);
    p.close();
    mockHold!();
    await flush();
    expect(mockMade.every((m) => m.closed)).toBe(true);
  });
});
