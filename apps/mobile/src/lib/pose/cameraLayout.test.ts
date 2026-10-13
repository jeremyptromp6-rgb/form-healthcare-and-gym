import { cameraLayout, defaultFrameAspect, estimatePanelHeight, feedAspect, fitBox, isCompactCamera, panelMaxHeight, topBarReserve, visibleFraction } from './cameraLayout';

describe('isCompactCamera', () => {
  it('goes compact on a short window or a large font, and not otherwise', () => {
    expect(isCompactCamera(568, 1)).toBe(true);
    expect(isCompactCamera(639, 1)).toBe(true);
    expect(isCompactCamera(640, 1)).toBe(false);
    expect(isCompactCamera(800, 1.3)).toBe(false);
    expect(isCompactCamera(800, 1.31)).toBe(true);
    expect(isCompactCamera(915, 2)).toBe(true);
  });
});

describe('feed aspect', () => {
  it('defaults to portrait in a portrait window and landscape in a wide one', () => {
    expect(defaultFrameAspect(360, 800)).toBe(3 / 4);
    expect(defaultFrameAspect(1280, 720)).toBe(4 / 3);
  });

  it('uses what the feed reported, ignoring anything that is not a positive number', () => {
    expect(feedAspect(0.5625, 360, 800)).toBe(0.5625);
    expect(feedAspect(undefined, 360, 800)).toBe(3 / 4);
    expect(feedAspect(0, 360, 800)).toBe(3 / 4);
    expect(feedAspect(Number.NaN, 360, 800)).toBe(3 / 4);
    expect(feedAspect(Infinity, 360, 800)).toBe(3 / 4);
  });
});

describe('fitBox', () => {
  it('is the largest box with the video aspect that fits, centred', () => {
    // A tall slot: the width is the limit.
    expect(fitBox(360, 520, 3 / 4)).toEqual({ left: 0, top: 20, width: 360, height: 480 });
    // A short slot: the height is the limit.
    const b = fitBox(412, 300, 3 / 4);
    expect(b.height).toBe(300);
    expect(b.width).toBe(225);
    expect(b.left).toBeCloseTo(93.5);
    expect(b.top).toBe(0);
    // A landscape video in a portrait slot.
    expect(fitBox(360, 640, 4 / 3)).toEqual({ left: 0, top: 185, width: 360, height: 270 });
  });

  it('never exceeds the slot, whatever the inputs', () => {
    for (const [w, h] of [[320, 350], [412, 640], [1280, 700], [360, 100]] as const) {
      for (const a of [0.5, 3 / 4, 1, 4 / 3, 16 / 9]) {
        const b = fitBox(w, h, a);
        expect(b.width).toBeLessThanOrEqual(w + 1e-9);
        expect(b.height).toBeLessThanOrEqual(h + 1e-9);
        expect(b.width / b.height).toBeCloseTo(a, 6);
      }
    }
  });

  it('falls back to the whole slot for an unusable size or aspect', () => {
    expect(fitBox(0, 0, 0.75)).toEqual({ left: 0, top: 0, width: 0, height: 0 });
    expect(fitBox(360, 500, 0)).toEqual({ left: 0, top: 0, width: 360, height: 500 });
  });
});

describe('visibleFraction (what object-fit: cover keeps)', () => {
  it('shows all of the video once the box has the video aspect, at every tested screen', () => {
    for (const win of [[360, 640], [412, 465], [390, 844], [320, 568]] as const) {
      for (const aspect of [3 / 4, 4 / 3, 9 / 16]) {
        const l = cameraLayout({ width: win[0], height: win[1] }, { aspect });
        const v = visibleFraction(l.aspectBox.width, l.aspectBox.height, aspect);
        expect(v.x).toBeGreaterThanOrEqual(0.98);
        expect(v.y).toBeGreaterThanOrEqual(0.98);
      }
    }
  });

  it('shows how much the old fill-the-card layout cut off', () => {
    // A 640x480 video in a 360x640 card: the middle 42% of its width, all of its height.
    const v = visibleFraction(360, 640, 4 / 3);
    expect(v.x).toBeCloseTo(0.42, 2);
    expect(v.y).toBe(1);
    // A portrait 480x640 video in a 379x465 card loses about 7% of its height.
    expect(visibleFraction(379, 465, 3 / 4).y).toBeCloseTo(0.92, 2);
  });
});

describe('the panel and the feed it leaves', () => {
  it('caps the panel at half the window', () => {
    expect(panelMaxHeight(800)).toBe(400);
    expect(panelMaxHeight(568)).toBe(284);
  });

  it('grows with the font scale, and a rep cue adds a line to the feedback strip', () => {
    expect(estimatePanelHeight(false, 1.3)).toBeGreaterThan(estimatePanelHeight(false, 1));
    expect(estimatePanelHeight(true, 1, true)).toBeGreaterThan(estimatePanelHeight(true, 1, false));
    expect(estimatePanelHeight(true, 1)).toBeLessThan(estimatePanelHeight(false, 1));
  });

  it('keeps the HUD below the top bar, with room for a larger font', () => {
    expect(topBarReserve(1)).toBeGreaterThanOrEqual(8 + 44 + 8);
    expect(topBarReserve(1.6)).toBeGreaterThan(topBarReserve(1));
    expect(topBarReserve(3)).toBe(topBarReserve(1.6)); // capped
  });

  it('gives the video at least 60% of the screen height on the tested phones (idle strip)', () => {
    for (const [w, h] of [[320, 568], [360, 800], [390, 844], [412, 915]] as const) {
      const l = cameraLayout({ width: w, height: h });
      expect(l.feedShare).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('keeps the whole fallback box above 60% where the width allows it (portrait video)', () => {
    for (const [w, h] of [[320, 568], [360, 800], [390, 844], [412, 915]] as const) {
      expect(cameraLayout({ width: w, height: h }).aspectShare).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('leaves the video a real share at 360x640 and 320x568 with a 1.3 font scale', () => {
    expect(cameraLayout({ width: 360, height: 640, fontScale: 1.3 }).feedShare).toBeGreaterThan(0.5);
    expect(cameraLayout({ width: 320, height: 568, fontScale: 1.3 }).feedShare).toBeGreaterThan(0.45);
  });

  it('never lets the panel take more than half the window, however large the font', () => {
    const l = cameraLayout({ width: 360, height: 640, fontScale: 2 });
    expect(l.panelHeight).toBeLessThanOrEqual(320);
    expect(l.feedShare).toBeGreaterThanOrEqual(0.5);
  });

  it('subtracts the system bars from the safe height', () => {
    const l = cameraLayout({ width: 412, height: 915, insetTop: 32, insetBottom: 24 });
    expect(l.safeHeight).toBe(859);
    expect(l.feedHeight).toBe(859 - l.panelHeight);
  });
});
