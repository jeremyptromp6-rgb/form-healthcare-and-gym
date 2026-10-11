import { readFileSync } from 'fs';
import { join } from 'path';
import type { FramingAssessment, LiveFeedback, LiveFrame } from '@form/domain';
import { palettes } from '@/theme/tokens';
import { chainFor, skeletonInjection, SkeletonStateTracker, skeletonPalette } from './skeletonState';
import { hudToneColor, skeletonToneColors } from './skeletonTone';
import type { SkeletonState } from './skeletonTypes';

type F = Pick<LiveFrame, 'trackable' | 'framing'>;
const frame = (trackable: boolean, side: 'left' | 'right' | null = 'left'): F => ({
  trackable,
  framing: { issue: null, message: '', trackable, side, missing: [] } as FramingAssessment,
});
const cue = (tone: LiveFeedback['tone']): LiveFeedback => ({ headline: 'CORRECT FORM', message: '', tone, atMs: 0 });

/** Feed the same frame n times and return the last non-null state. */
function feed(t: SkeletonStateTracker, f: F, c: LiveFeedback | null, n: number): (SkeletonState | null)[] {
  return Array.from({ length: n }, () => t.update(f, c));
}

describe('chainFor', () => {
  it('gives the hip-knee-ankle chain for knee exercises, per side', () => {
    for (const id of ['bodyweight_squat', 'lunge', 'goblet_squat', 'squat']) {
      expect(chainFor(id, 'left')).toEqual([23, 25, 27]);
      expect(chainFor(id, 'right')).toEqual([24, 26, 28]);
    }
  });

  it('gives the shoulder-elbow-wrist chain for elbow exercises, per side', () => {
    for (const id of ['push_up', 'bicep_curl']) {
      expect(chainFor(id, 'left')).toEqual([11, 13, 15]);
      expect(chainFor(id, 'right')).toEqual([12, 14, 16]);
    }
  });

  it('is empty without a side, for an unknown exercise, and for one the camera cannot judge', () => {
    expect(chainFor('bodyweight_squat', null)).toEqual([]);
    expect(chainFor('nope', 'left')).toEqual([]);
    expect(chainFor('glute_bridge', 'left')).toEqual([]);
  });

  it('returns a copy, so callers cannot change the table', () => {
    chainFor('squat', 'left').push(99);
    expect(chainFor('squat', 'left')).toEqual([23, 25, 27]);
  });
});

describe('skeletonPalette', () => {
  it('is the Evening palette, with the tone colours the feedback strip uses', () => {
    const p = skeletonPalette();
    expect(p.good).toBe(palettes.dark.primary);
    expect(p.fix).toBe(palettes.dark.warning);
    expect(p.warn).toBe(palettes.dark.warning);
    expect(p.untrackable).toBe(palettes.dark.textMuted);
    expect(p.other).toBe(palettes.dark.danger);
    expect(p.halo).toBe(palettes.dark.bg);
    expect(p.highlight).toBe(palettes.dark.text);
  });

  it('D1: skeleton tone colours equal the HUD strip colours for the same cue, in every palette', () => {
    for (const palette of [palettes.dark, palettes.light]) {
      const t = skeletonToneColors(palette);
      // The strip maps a cue: good -> ready (primary), anything else -> adjust (warning); "can't see you" is the neutral info tone.
      expect(t.good).toBe(hudToneColor(palette, 'ready'));
      expect(t.fix).toBe(hudToneColor(palette, 'adjust'));
      expect(t.warn).toBe(hudToneColor(palette, 'adjust'));
      expect(t.untrackable).toBe(hudToneColor(palette, 'info'));
    }
  });

  it('D1: the strip itself reads its colours from the same place (or still has the same literals)', () => {
    const src = readFileSync(join(__dirname, 'LiveCameraView.tsx'), 'utf8');
    if (src.includes('skeletonTone')) return; // switched over to the shared mapping
    expect(src).toMatch(/ready: \{ color: colors\.primary/);
    expect(src).toMatch(/adjust: \{ color: colors\.warning/);
    expect(src).toMatch(/info: \{ color: colors\.textMuted/);
  });
});

describe('SkeletonStateTracker', () => {
  it('starts good, with no side, no chain, and the reduce-motion setting given', () => {
    const t = new SkeletonStateTracker('bodyweight_squat', true);
    expect(t.current()).toEqual({ v: 1, tone: 'good', side: null, chain: [], palette: skeletonPalette(), reduceMotion: true });
  });

  it('follows the coach cue tone', () => {
    const t = new SkeletonStateTracker('bodyweight_squat', false);
    expect(t.update(frame(true, null), cue('fix'))!.tone).toBe('fix');
    expect(t.update(frame(true, null), cue('warn'))!.tone).toBe('warn');
    expect(t.update(frame(true, null), cue('good'))!.tone).toBe('good');
    expect(t.update(frame(true, null), null)).toBeNull();
  });

  it('is untrackable only after 4 frames in a row, and recovers at once', () => {
    const t = new SkeletonStateTracker('bodyweight_squat', false);
    const lost = feed(t, frame(false, null), null, 3);
    expect(lost).toEqual([null, null, null]);
    expect(t.current().tone).toBe('good');
    expect(t.update(frame(false, null), null)!.tone).toBe('untrackable'); // the 4th
    expect(t.update(frame(false, null), null)).toBeNull();
    expect(t.update(frame(true, null), null)!.tone).toBe('good'); // immediate
    // A blink in the middle resets the count.
    feed(t, frame(false, null), null, 3);
    t.update(frame(true, null), null);
    expect(feed(t, frame(false, null), null, 3)).toEqual([null, null, null]);
    expect(t.current().tone).toBe('good');
  });

  it('shows untrackable over any cue, and the cue again on recovery', () => {
    const t = new SkeletonStateTracker('bodyweight_squat', false);
    feed(t, frame(false, null), cue('fix'), 4);
    expect(t.current().tone).toBe('untrackable');
    expect(t.update(frame(true, null), cue('fix'))!.tone).toBe('fix');
  });

  it('moves to a new side only after 5 frames in a row, and keeps the last side on null', () => {
    const t = new SkeletonStateTracker('bodyweight_squat', false);
    expect(feed(t, frame(true, 'left'), null, 4)).toEqual([null, null, null, null]);
    expect(t.current().side).toBeNull();
    const s = t.update(frame(true, 'left'), null)!; // the 5th
    expect(s.side).toBe('left');
    expect(s.chain).toEqual([23, 25, 27]);
    // A flicker to the right does not move it.
    feed(t, frame(true, 'right'), null, 4);
    expect(t.current().side).toBe('left');
    t.update(frame(true, 'left'), null);
    feed(t, frame(true, 'right'), null, 4);
    expect(t.current().side).toBe('left');
    // A null side keeps the last known side, but interrupts a pending change.
    feed(t, frame(true, null), null, 6);
    expect(t.current().side).toBe('left');
    feed(t, frame(true, 'right'), null, 3);
    t.update(frame(true, null), null);
    feed(t, frame(true, 'right'), null, 4);
    expect(t.current().side).toBe('left');
    const moved = t.update(frame(true, 'right'), null)!; // 5 in a row now
    expect(moved.side).toBe('right');
    expect(moved.chain).toEqual([24, 26, 28]);
  });

  it('keeps the side while untrackable', () => {
    const t = new SkeletonStateTracker('push_up', false);
    feed(t, frame(true, 'right'), null, 5);
    feed(t, frame(false, null), null, 6);
    expect(t.current()).toMatchObject({ tone: 'untrackable', side: 'right', chain: [12, 14, 16] });
  });

  it('returns null when nothing changed, and a state when tone or side did', () => {
    const t = new SkeletonStateTracker('bodyweight_squat', false);
    feed(t, frame(true, 'left'), cue('good'), 5);
    for (let i = 0; i < 20; i++) expect(t.update(frame(true, 'left'), cue('good'))).toBeNull();
    const next = t.update(frame(true, 'left'), cue('fix'));
    expect(next).not.toBeNull();
    expect(next).toBe(t.current());
  });

  it('applies reduce motion to the current state, and reset forgets what it saw but keeps it', () => {
    const t = new SkeletonStateTracker('bodyweight_squat', false);
    feed(t, frame(true, 'left'), cue('fix'), 5);
    t.setReduceMotion(true);
    expect(t.current()).toMatchObject({ reduceMotion: true, tone: 'fix', side: 'left' });
    t.reset();
    expect(t.current()).toMatchObject({ reduceMotion: true, tone: 'good', side: null, chain: [] });
    expect(t.update(frame(true, null), null)).toBeNull();
  });

  it('has an empty chain for an exercise the camera does not judge', () => {
    const t = new SkeletonStateTracker('glute_bridge', false);
    feed(t, frame(true, 'left'), null, 5);
    expect(t.current()).toMatchObject({ side: 'left', chain: [] });
  });
});

describe('skeletonInjection', () => {
  const t = new SkeletonStateTracker('bodyweight_squat', false);
  feed(t, frame(true, 'left'), cue('fix'), 5);
  const s = t.current();
  const js = skeletonInjection(s);

  it('keeps the legacy colour line and the full-state line', () => {
    expect(js).toContain('window.__skeletonColor=');
    expect(js.startsWith(`window.__skeletonColor=${JSON.stringify(skeletonPalette().fix)};`)).toBe(true);
    expect(js).toContain('window.__formSkeleton=');
    expect(js).toContain(';window.formSkeleton&&window.formSkeleton(window.__formSkeleton);true;');
  });

  it('parses as JavaScript and round-trips the state through a fake window', () => {
    const win: Record<string, unknown> = {};
    let received: unknown = null;
    win.formSkeleton = (x: unknown) => (received = x);
    expect(() => new Function('window', js)).not.toThrow();
    const result = new Function('window', `return (function(){${js.replace(/true;$/, 'return true;')}})()`)(win);
    expect(result).toBe(true);
    expect(win.__skeletonColor).toBe(skeletonPalette().fix);
    expect(win.__formSkeleton).toEqual(s);
    expect(received).toEqual(s);
  });

  it('still works before the page has defined formSkeleton (the page drains __formSkeleton later)', () => {
    const win: Record<string, unknown> = {};
    new Function('window', js)(win);
    expect(win.__formSkeleton).toEqual(s);
  });
});
