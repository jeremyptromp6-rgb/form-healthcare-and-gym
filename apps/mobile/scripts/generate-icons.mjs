// Generates FORM's app icon, adaptive icon layers, favicon and splash images: Pip, the peach, drawn
// by a tiny dependency-free rasteriser and written as PNG with Node's zlib only.
//
//   node scripts/generate-icons.mjs           write assets/images/*.png
//   node scripts/generate-icons.mjs --check   re-read every file: signature, chunk CRCs, IDAT size,
//                                             dimensions, colour type, the adaptive-icon safe zone (r 313 of 1024)
//                                             and the Android 12 splash circle (r 186 of 600)
//
// Output is deterministic: running it twice gives byte-identical files.
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, '..', 'assets', 'images');

/* ------------------------------------------------------------------ colour and paint */

const hex = (h, a = 1) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
};
const solid = (c) => ({ type: 'solid', c });
/** stops: [[offset, rgba], ...] */
const linear = (x1, y1, x2, y2, stops) => ({ type: 'linear', x1, y1, x2, y2, stops });
const radial = (cx, cy, r, stops) => ({ type: 'radial', cx, cy, r, stops });

function atStops(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [o0, c0] = stops[i - 1];
      const [o1, c1] = stops[i];
      const k = (t - o0) / (o1 - o0 || 1);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k, c0[3] + (c1[3] - c0[3]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

function paintAt(p, x, y) {
  if (p.type === 'solid') return p.c;
  if (p.type === 'linear') {
    const dx = p.x2 - p.x1;
    const dy = p.y2 - p.y1;
    const t = ((x - p.x1) * dx + (y - p.y1) * dy) / (dx * dx + dy * dy);
    return atStops(p.stops, Math.min(1, Math.max(0, t)));
  }
  const t = Math.hypot(x - p.cx, y - p.cy) / p.r;
  return atStops(p.stops, Math.min(1, Math.max(0, t)));
}

/* ------------------------------------------------------------------ outlines (flattened paths) */

// An outline is an array of { pts: [[x, y], ...], closed }.

/** Builds an outline from path commands in unit space, mapped to pixels by `map` and flattened. */
class Path {
  constructor(map) {
    this.map = map;
    this.out = [];
    this.cur = null;
  }
  M(x, y) {
    this.cur = { pts: [this.map(x, y)], closed: false };
    this.out.push(this.cur);
    return this;
  }
  L(x, y) {
    this.cur.pts.push(this.map(x, y));
    return this;
  }
  C(x1, y1, x2, y2, x, y) {
    const p0 = this.cur.pts[this.cur.pts.length - 1];
    const p1 = this.map(x1, y1);
    const p2 = this.map(x2, y2);
    const p3 = this.map(x, y);
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
    const n = Math.max(10, Math.ceil(len / 3));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      this.cur.pts.push([
        u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
      ]);
    }
    return this;
  }
  Q(x1, y1, x, y) {
    const p0 = this.cur.pts[this.cur.pts.length - 1];
    const p1 = this.map(x1, y1);
    const p2 = this.map(x, y);
    const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(8, Math.ceil(len / 3));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const u = 1 - t;
      this.cur.pts.push([u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0], u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]]);
    }
    return this;
  }
  Z() {
    this.cur.closed = true;
    return this;
  }
}

const arcSegments = (r) => Math.max(16, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - 0.1 / Math.max(r, 0.5)))));

function ellipse(cx, cy, rx, ry, rot = 0) {
  const n = arcSegments(Math.max(rx, ry));
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const x = Math.cos(a) * rx;
    const y = Math.sin(a) * ry;
    pts.push([cx + x * c - y * s, cy + x * s + y * c]);
  }
  return [{ pts, closed: true }];
}

function roundRect(x, y, w, h, r) {
  const n = Math.ceil(arcSegments(r) / 4);
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= n; i++) {
      const a = a0 + (i / n) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  };
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  corner(x + w - r, y + r, Math.PI * 1.5);
  return [{ pts, closed: true }];
}

const signedArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
};

/** A stroke as a set of same-orientation polygons (a quad per segment, a disc per vertex), filled non-zero: round caps and joins. */
function strokeOf(outline, width) {
  const r = width / 2;
  const nDisc = arcSegments(r);
  const polys = [];
  const disc = (c) => {
    const pts = [];
    for (let i = 0; i < nDisc; i++) {
      const a = (i / nDisc) * Math.PI * 2;
      pts.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
    }
    polys.push(pts);
  };
  for (const { pts, closed } of outline) {
    const count = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < pts.length; i++) disc(pts[i]);
    for (let i = 0; i < count; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const nx = (-dy / len) * r;
      const ny = (dx / len) * r;
      const quad = [
        [a[0] + nx, a[1] + ny],
        [b[0] + nx, b[1] + ny],
        [b[0] - nx, b[1] - ny],
        [a[0] - nx, a[1] - ny],
      ];
      polys.push(signedArea(quad) < 0 ? quad.reverse() : quad);
    }
  }
  return polys.map((pts) => ({ pts: signedArea(pts) < 0 ? pts.reverse() : pts, closed: true }));
}

/* ------------------------------------------------------------------ rasteriser */

const SS = 4; // 4 x 4 samples per pixel

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Float32Array(w * h * 4); // premultiplied RGBA, 0..1
  }

  /**
   * Fills an outline. Coverage comes from a 4x4 supersampled scanline sweep (crossings sorted per
   * sample row, then non-zero or even-odd winding), so cost follows the shape's bounding box.
   */
  fill(outline, paint, { rule = 'nonzero', opacity = 1, erase = false } = {}) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { pts } of outline) {
      for (const [x, y] of pts) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const x0 = Math.max(0, Math.floor(minX));
    const y0 = Math.max(0, Math.floor(minY));
    const x1 = Math.min(this.w, Math.ceil(maxX));
    const y1 = Math.min(this.h, Math.ceil(maxY));
    if (x1 <= x0 || y1 <= y0) return;
    const cols = x1 - x0;
    const rows = y1 - y0;
    const subRows = rows * SS;
    const crossings = Array.from({ length: subRows }, () => []);
    for (const { pts } of outline) {
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if (a[1] === b[1]) continue;
        const dir = b[1] > a[1] ? 1 : -1;
        const ylo = Math.min(a[1], b[1]);
        const yhi = Math.max(a[1], b[1]);
        const j0 = Math.max(0, Math.ceil((ylo - y0) * SS - 0.5));
        const j1 = Math.min(subRows - 1, Math.ceil((yhi - y0) * SS - 0.5) - 1);
        const k = (b[0] - a[0]) / (b[1] - a[1]);
        for (let j = j0; j <= j1; j++) {
          const sy = y0 + (j + 0.5) / SS;
          crossings[j].push({ x: a[0] + (sy - a[1]) * k, d: dir });
        }
      }
    }
    const cov = new Float32Array(cols * rows);
    const unit = 1 / (SS * SS);
    for (let j = 0; j < subRows; j++) {
      const row = crossings[j];
      if (row.length < 2) continue;
      row.sort((p, q) => p.x - q.x);
      const base = Math.floor(j / SS) * cols;
      let wind = 0;
      for (let i = 0; i < row.length - 1; i++) {
        wind += row[i].d;
        const inside = rule === 'evenodd' ? (wind & 1) !== 0 : wind !== 0;
        if (!inside) continue;
        const ka = Math.max(0, Math.ceil((row[i].x - x0) * SS - 0.5));
        const kb = Math.min(cols * SS - 1, Math.ceil((row[i + 1].x - x0) * SS - 0.5) - 1);
        for (let k = ka; k <= kb; k++) cov[base + (k >> 2)] += unit;
      }
    }
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const c = Math.min(1, cov[(y - y0) * cols + (x - x0)]);
        if (c <= 0) continue;
        const i = (y * this.w + x) * 4;
        if (erase) {
          const keep = 1 - c * opacity;
          this.px[i] *= keep;
          this.px[i + 1] *= keep;
          this.px[i + 2] *= keep;
          this.px[i + 3] *= keep;
          continue;
        }
        const s = paintAt(paint, x + 0.5, y + 0.5);
        const a = s[3] * c * opacity;
        const inv = 1 - a;
        this.px[i] = s[0] * a + this.px[i] * inv;
        this.px[i + 1] = s[1] * a + this.px[i + 1] * inv;
        this.px[i + 2] = s[2] * a + this.px[i + 2] * inv;
        this.px[i + 3] = a + this.px[i + 3] * inv;
      }
    }
  }

  stroke(outline, width, paint, opts = {}) {
    this.fill(strokeOf(outline, width), paint, { ...opts, rule: 'nonzero' });
  }

  /** 8-bit RGBA (not premultiplied) or RGB. */
  bytes(channels) {
    const out = new Uint8Array(this.w * this.h * channels);
    for (let p = 0, o = 0; p < this.w * this.h; p++) {
      const a = this.px[p * 4 + 3];
      for (let c = 0; c < 3; c++) {
        const v = channels === 3 ? this.px[p * 4 + c] : a > 0 ? this.px[p * 4 + c] / a : 0;
        out[o++] = Math.max(0, Math.min(255, Math.round(v * 255)));
      }
      if (channels === 4) out[o++] = Math.max(0, Math.min(255, Math.round(a * 255)));
    }
    return out;
  }
}

/* ------------------------------------------------------------------ PNG */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

/** colorType 2 = RGB, 6 = RGBA; 8-bit; every scanline uses filter 0. */
function encodePng(w, h, colorType, bytes) {
  const bpp = colorType === 2 ? 3 : 4;
  const raw = Buffer.alloc(h * (1 + w * bpp));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * bpp)] = 0;
    Buffer.from(bytes.buffer, bytes.byteOffset + y * w * bpp, w * bpp).copy(raw, y * (1 + w * bpp) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

/* ------------------------------------------------------------------ Pip */

const TONES = {
  light: {
    ink: '#3A2A1F',
    top: '#FFC29B',
    bottom: '#EE8257',
    belly: '#FFE6CF',
    cheek: '#FF8A7A',
    leafLight: '#7FB06E',
    leafDeep: '#5E9150',
    rim: '#FFE3CC',
    rimAlpha: 0.45,
    highlight: '#FFFFFF',
    highlightAlpha: 0.38,
    shadow: '#7A4A26',
    shadowAlpha: 0.16,
    eye: '#3A2A1F',
  },
  dark: {
    ink: '#2A1A12',
    top: '#FFB48A',
    bottom: '#E5825A',
    belly: '#FFE0C4',
    cheek: '#F5877A',
    leafLight: '#8CC08F',
    leafDeep: '#68A06B',
    rim: '#FFB98A',
    rimAlpha: 0.7,
    highlight: '#FFF1E0',
    highlightAlpha: 0.3,
    shadow: '#000000',
    shadowAlpha: 0.4,
    eye: '#3A2A1F',
  },
};

const WHITE = hex('#FFFFFF');

/**
 * Draws Pip, centred so the unit point (60, 54) lands on (cx, cy); `s` pixels per unit (Buddy's
 * 120-unit viewBox). modes: 'full' (the app icon and splash), 'small' (favicon: no belly or blush,
 * bold eyes), 'mono' (white silhouette with the eyes and smile cut out).
 */
function drawPip(cv, { s, cx, cy, tone = 'light', mode = 'full', inkPx, shadow = true, outerRim = 0 }) {
  const T = TONES[tone];
  const map = (x, y) => [cx + (x - 60) * s, cy + (y - 54) * s];
  const P = () => new Path(map);
  const px = (n) => n * s;
  const inkW = inkPx ?? px(3.4);
  const body = () => P().M(60, 22).C(89, 22, 103, 43, 103, 68).C(103, 94, 85, 107, 60, 107).C(35, 107, 17, 94, 17, 68).C(17, 43, 31, 22, 60, 22).Z().out;
  const leafR = () => P().M(62, 13).C(64, 3, 80, 1, 90, 6).C(88, 16, 72, 20, 62, 13).Z().out;
  const leafL = () => P().M(60, 14).C(58, 6, 46, 3, 37, 8).C(39, 17, 52, 19, 60, 14).Z().out;
  const stem = () => P().M(60, 24).Q(59, 17, 62, 12).out;
  const eyes = () => [ellipse(...map(45, 57), px(6.6), px(8.4)), ellipse(...map(75, 57), px(6.6), px(8.4))];
  const smile = () => P().M(50.5, 68).Q(60, 79, 69.5, 68).out;

  if (mode === 'mono') {
    cv.fill(body(), solid(WHITE));
    cv.fill(leafR(), solid(WHITE));
    cv.fill(leafL(), solid(WHITE));
    cv.stroke(stem(), px(4.4), solid(WHITE));
    for (const e of eyes()) cv.fill(e, solid(WHITE), { erase: true });
    cv.stroke(smile(), px(3.8), solid(WHITE), { erase: true });
    return;
  }

  const small = mode === 'small';
  const bb = { x: cx + (17 - 60) * s, y: cy + (22 - 54) * s, w: 86 * s, h: 85 * s };
  const lit = (a, b) => [bb.x + a * bb.w, bb.y + b * bb.h];

  if (shadow && !small) cv.fill(ellipse(...map(60, 110), px(31), px(4.6)), solid(hex(T.shadow, T.shadowAlpha)));

  if (outerRim > 0) {
    const w = inkW + outerRim * 2;
    const rimPaint = solid(hex(T.rim, 0.95));
    for (const o of [body(), leafR(), leafL()]) cv.stroke(o, w, rimPaint);
    cv.stroke(stem(), px(4.4) + outerRim * 2, rimPaint);
  }

  // stem and leaves sit behind the outline of the body's top edge so the join reads cleanly
  cv.stroke(stem(), px(3.4), solid(hex(T.leafDeep)));
  cv.fill(leafR(), solid(hex(T.leafLight)));
  cv.stroke(leafR(), inkW, solid(hex(T.ink)));
  cv.fill(leafL(), solid(hex(T.leafDeep)));
  cv.stroke(leafL(), inkW, solid(hex(T.ink)));
  if (!small) cv.stroke(P().M(64.5, 12.6).Q(77, 10, 87.5, 7).out, px(1), solid(hex(T.leafDeep)));

  // body: two-stop gradient from top-left to bottom-right, then the outline
  const [gx1, gy1] = lit(0.15, 0);
  const [gx2, gy2] = lit(0.85, 1);
  cv.fill(body(), linear(gx1, gy1, gx2, gy2, [[0, hex(T.top)], [1, hex(T.bottom)]]));
  if (!small) {
    cv.fill(ellipse(...map(60, 83), px(25), px(18.5)), solid(hex(T.belly, 0.88)));
    cv.stroke(P().M(99.5, 62).C(100.5, 89, 83, 103.5, 60, 103.5).out, px(2.2), solid(hex(T.rim, T.rimAlpha)));
  }
  cv.fill(ellipse(...map(41.5, 36), px(small ? 8 : 10), px(small ? 4.6 : 5.6), (-25 * Math.PI) / 180), solid(hex(T.highlight, T.highlightAlpha)));
  cv.stroke(body(), inkW, solid(hex(T.ink)));

  // face
  if (!small) {
    cv.fill(ellipse(...map(32.5, 70), px(7), px(4.2)), solid(hex(T.cheek, 0.7)));
    cv.fill(ellipse(...map(87.5, 70), px(7), px(4.2)), solid(hex(T.cheek, 0.7)));
  }
  for (const e of eyes()) cv.fill(e, solid(hex(T.eye)));
  if (!small) {
    for (const dx of [45, 75]) {
      cv.fill(ellipse(...map(dx + 2.4, 53.4), px(2.7), px(2.7)), solid(WHITE));
      cv.fill(ellipse(...map(dx - 2.4, 61.2), px(1.3), px(1.3)), solid(WHITE), { opacity: 0.75 });
    }
  } else {
    for (const dx of [45, 75]) cv.fill(ellipse(...map(dx + 2.2, 53.6), px(2.6), px(2.6)), solid(WHITE));
  }
  cv.stroke(smile(), px(small ? 4.4 : 3.8), solid(hex(T.eye)));
}

/* ------------------------------------------------------------------ images */

function iconField(cv) {
  // Warm cream at the middle, easing to peach at the edges, so Pip's outline and peach body both pop.
  cv.fill(roundRect(0, 0, cv.w, cv.h, 0), radial(cv.w * 0.5, cv.h * 0.46, cv.w * 0.78, [[0, hex('#FFF7EC')], [0.5, hex('#FFDDBF')], [1, hex('#F0A47C')]]));
}

// Android masks adaptive-icon layers to a circle of 66dp in a 108dp canvas: r = 1024 * 66 / 108 / 2 = 313 px.
const SAFE_ADAPTIVE = 313;
// Android 12+ masks the splash icon to about 2/3 of its diameter; keep everything inside r = 0.31 * 600 = 186 px.
const SAFE_SPLASH = 186;

const IMAGES = [
  {
    file: 'icon.png',
    w: 1024,
    h: 1024,
    colorType: 2,
    draw(cv) {
      iconField(cv);
      drawPip(cv, { s: 7.1, cx: 512, cy: 512 + 2 * 7.1 });
    },
  },
  {
    file: 'android-icon-background.png',
    w: 1024,
    h: 1024,
    colorType: 6,
    draw(cv) {
      iconField(cv);
    },
  },
  {
    file: 'android-icon-foreground.png',
    w: 1024,
    h: 1024,
    colorType: 6,
    safeR: SAFE_ADAPTIVE,
    draw(cv) {
      drawPip(cv, { s: 4.7, cx: 512, cy: 512 + 4.7 });
    },
  },
  {
    file: 'android-icon-monochrome.png',
    w: 1024,
    h: 1024,
    colorType: 6,
    safeR: SAFE_ADAPTIVE,
    draw(cv) {
      drawPip(cv, { s: 5.4, cx: 512, cy: 512 + 0.5 * 5.4, mode: 'mono' });
    },
  },
  {
    file: 'favicon.png',
    w: 48,
    h: 48,
    colorType: 6,
    draw(cv) {
      cv.fill(roundRect(0, 0, 48, 48, 11), radial(24, 22, 36, [[0, hex('#FFF7EC')], [0.55, hex('#FFDDBF')], [1, hex('#F0A47C')]]));
      drawPip(cv, { s: 0.4, cx: 24, cy: 24.6, mode: 'small', inkPx: 1.9, shadow: false });
    },
  },
  {
    file: 'splash-icon.png',
    w: 600,
    h: 600,
    colorType: 6,
    safeR: SAFE_SPLASH,
    draw(cv) {
      drawPip(cv, { s: 2.9, cx: 300, cy: 300 - 4 * 2.9 });
    },
  },
  {
    file: 'splash-icon-dark.png',
    w: 600,
    h: 600,
    colorType: 6,
    safeR: SAFE_SPLASH,
    draw(cv) {
      drawPip(cv, { s: 2.9, cx: 300, cy: 300 - 4 * 2.9, tone: 'dark', outerRim: 5 });
    },
  },
];

/* ------------------------------------------------------------------ generate */

function generate() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const img of IMAGES) {
    const t0 = Date.now();
    const cv = new Canvas(img.w, img.h);
    img.draw(cv);
    const png = encodePng(img.w, img.h, img.colorType, cv.bytes(img.colorType === 2 ? 3 : 4));
    fs.writeFileSync(path.join(OUT, img.file), png);
    console.log(`wrote ${img.file} ${img.w}x${img.h} (${png.length} bytes, ${Date.now() - t0} ms)`);
  }
}

/* ------------------------------------------------------------------ check */

function readPng(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('bad PNG signature');
  let pos = 8;
  let ihdr = null;
  const idat = [];
  let sawEnd = false;
  const order = [];
  while (pos < buf.length) {
    if (pos + 12 > buf.length) throw new Error('truncated chunk');
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    if (pos + 12 + len > buf.length) throw new Error(`chunk ${type} overruns file`);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    const crc = buf.readUInt32BE(pos + 8 + len);
    if (crc !== crc32(buf.subarray(pos + 4, pos + 8 + len))) throw new Error(`bad CRC in ${type}`);
    order.push(type);
    if (type === 'IHDR') ihdr = { w: data.readUInt32BE(0), h: data.readUInt32BE(4), depth: data[8], colorType: data[9], interlace: data[12] };
    if (type === 'IDAT') idat.push(data);
    if (type === 'IEND') sawEnd = true;
    pos += 12 + len;
  }
  if (!ihdr || order[0] !== 'IHDR') throw new Error('missing IHDR first');
  if (!sawEnd || order[order.length - 1] !== 'IEND') throw new Error('missing IEND last');
  if (!idat.length) throw new Error('missing IDAT');
  return { ...ihdr, raw: zlib.inflateSync(Buffer.concat(idat)) };
}

function check() {
  let failures = 0;
  const fail = (file, msg) => {
    failures++;
    console.error(`FAIL ${file}: ${msg}`);
  };
  for (const img of IMAGES) {
    const file = path.join(OUT, img.file);
    try {
      const png = readPng(fs.readFileSync(file));
      const bpp = png.colorType === 2 ? 3 : png.colorType === 6 ? 4 : 0;
      const problems = [];
      if (png.w !== img.w || png.h !== img.h) problems.push(`size ${png.w}x${png.h}, expected ${img.w}x${img.h}`);
      if (png.depth !== 8) problems.push(`bit depth ${png.depth}`);
      if (png.colorType !== img.colorType) problems.push(`colour type ${png.colorType}, expected ${img.colorType}`);
      if (png.interlace !== 0) problems.push('interlaced');
      if (bpp === 0) problems.push('unsupported colour type');
      if (!problems.length) {
        const stride = 1 + png.w * bpp;
        if (png.raw.length !== png.h * stride) problems.push(`IDAT inflates to ${png.raw.length}, expected ${png.h * stride}`);
        else {
          for (let y = 0; y < png.h; y++) if (png.raw[y * stride] !== 0) problems.push(`scanline ${y} filter ${png.raw[y * stride]}`);
          if (img.colorType === 6) {
            let opaque = 0;
            let outside = 0;
            let maxR = 0;
            for (let y = 0; y < png.h; y++) {
              for (let x = 0; x < png.w; x++) {
                const a = png.raw[y * stride + 1 + x * 4 + 3];
                if (a > 0) opaque++;
                if (img.safeR && a > 0) {
                  const d = Math.hypot(x + 0.5 - png.w / 2, y + 0.5 - png.h / 2);
                  if (d > maxR) maxR = d;
                  if (d > img.safeR) outside++;
                }
              }
            }
            if (opaque === 0) problems.push('fully transparent');
            if (img.safeR) {
              if (outside) problems.push(`${outside} non-zero alpha pixels outside the safe-zone circle (r ${img.safeR})`);
              console.log(`  ${img.file}: farthest non-zero alpha pixel ${maxR.toFixed(1)} from centre (limit ${img.safeR})`);
            }
          }
        }
      }
      if (problems.length) problems.forEach((p) => fail(img.file, p));
      else console.log(`ok   ${img.file} ${png.w}x${png.h} colour type ${png.colorType}`);
    } catch (e) {
      fail(img.file, e.message);
    }
  }
  if (failures) {
    console.error(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log('all checks passed');
}

if (process.argv.includes('--check')) check();
else generate();
