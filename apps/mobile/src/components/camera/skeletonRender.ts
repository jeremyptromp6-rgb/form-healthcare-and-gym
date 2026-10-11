/**
 * The skeleton's look: a calm, tapered, softly lit figure drawn over the camera. This file is a
 * "text module": SKELETON_RENDER is plain ES2017 source that runs inside the WebView page and on
 * the web, so it cannot import anything and must stay free of backticks, backslashes, regex
 * literals, `?.`, `??`, shadowBlur and hex colours (colours come only from the state palette).
 * Tests evaluate the text with `new Function`.
 *
 * Draw order, per person: halo (a dark outline so the figure reads on any background), glow
 * (emphasised chain only, top quality only), tapered bones, a thin highlight on the torso and the
 * emphasised chain, joints sized by hierarchy (rings on emphasised ones), then the head circle.
 * Bones are filled trapezoids (one fill instead of two strokes) whose width follows the joint at
 * each end, so limbs taper naturally and the joint discs cover the round ends.
 *
 * Transitions use no blended colours: a tone change draws the bones twice, the old and the new
 * palette colour, with complementary alpha. Emphasis eases a per-joint weight that scales width,
 * brightness and ring alpha. reduceMotion makes both instant and drops glow, sprite and pulse.
 * Quality 2 = full, 1 = no glow or sprite, 0 = minimal (batched halo + core strokes + dots).
 */

/**
 * Bones as MediaPipe pose indices. Mirrors SKELETON_EDGES / MEDIAPIPE_POSE_INDEX in
 * packages/domain/src/camera/pose.ts minus the face loop and the heel bones (a simplified foot
 * runs ankle to foot index). Pinned by skeletonRender.test.ts.
 */
export const SKELETON_BONES: readonly (readonly [number, number])[] = [
  [11, 12], // shoulders
  [23, 24], // hips
  [11, 23], // left torso
  [12, 24], // right torso
  [11, 13], // left upper arm
  [13, 15], // left forearm
  [15, 19], // left hand
  [12, 14], // right upper arm
  [14, 16], // right forearm
  [16, 20], // right hand
  [23, 25], // left thigh
  [25, 27], // left shin
  [27, 31], // left foot
  [24, 26], // right thigh
  [26, 28], // right shin
  [28, 32], // right foot
];

/** Every number the look depends on. Lengths are CSS px, alphas 0..1, times ms. */
export const SKELETON_STYLE = {
  /** Limb width at a full-width joint, as a fraction of torso length (then clamped). */
  widthPerTorso: 0.1,
  minWidth: 2.6,
  maxWidth: 18,
  /** The torso length is smoothed so widths never twitch. */
  scaleSmooth: 0.2,
  /** Width at each joint, as a fraction of the base width (indexed by MediaPipe landmark). */
  jointWidth: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0.78, 0.78, 0.6, 0.6, 0, 0, 0.45, 0.45, 0, 0, 1, 1, 0.8, 0.8, 0.6, 0.6, 0, 0, 0.45, 0.45],
  /** Disc radius at each joint, as a fraction of the base width: shoulders, hips, knees, elbows big. */
  jointRadius: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.62, 0.62, 0.52, 0.52, 0.38, 0.38, 0, 0, 0.26, 0.26, 0, 0, 0.62, 0.62, 0.55, 0.55, 0.4, 0.4, 0, 0, 0.28, 0.28],
  /** Outline: extra width per side, as a fraction of the base width, and its clamp. */
  haloPad: 0.2,
  haloPadMin: 1,
  haloPadMax: 3.2,
  haloAlpha: 0.55,
  coreAlpha: 0.88,
  /** The soft tone-coloured plate behind the torso. */
  plateAlpha: 0.17,
  /** The side that is not being tracked is drawn this much dimmer. */
  dimAlpha: 0.42,
  /** Emphasised chain: extra width/size, highlight, ring and glow. */
  emphGrow: 0.45,
  emphHighlight: 0.5,
  torsoHighlight: 0.2,
  highlightWidth: 0.2,
  ringGap: 3,
  ringWidth: 1.2,
  ringAlpha: 0.85,
  ringPulse: 0.7,
  ringPulseMs: 1500,
  /** Two stacked strokes (wide and faint, narrower and stronger) fake a soft edge without blur. */
  glowWidth: 2.3,
  glowAlpha: 0.07,
  glowCoreWidth: 1.5,
  glowCoreAlpha: 0.09,
  bloomRadius: 3.2,
  bloomAlpha: 0.42,
  /** The pre-rendered bloom sprite: concentric discs of the highlight colour. */
  spriteSize: 64,
  spriteSteps: 14,
  spriteStepAlpha: 0.085,
  /** Head circle: radius from the face points (kept between these fractions of the torso), ring width. */
  headMinRadius: 0.15,
  headMaxRadius: 0.28,
  /** Head radius = this x the widest span between the face points (ear to ear when both are seen). */
  headSpan: 0.56,
  headWidth: 0.4,
  headFill: 0.25,
  /** The bright centre of the large joints. */
  jointCore: 0.4,
  jointCoreAlpha: 0.6,
  neckStart: 0.7,
  neckEnd: 0.55,
  /** Transitions. */
  fadeMs: 200,
  emphasisMs: 200,
  /** The second person, and quality 0: batched strokes. */
  otherAlpha: 0.6,
  otherScale: 0.85,
  simpleWidth: 0.8,
  simpleMinAlpha: 0.3,
  /** A joint counts as drawn above this alpha. */
  minAlpha: 0.01,
} as const;

export const SKELETON_RENDER = `function skeletonRender(CFG) {
  var S = (CFG && CFG.style) || ${JSON.stringify(SKELETON_STYLE)};
  var EDGES = (CFG && CFG.edges) || ${JSON.stringify(SKELETON_BONES)};
  return {
    create: function (env) {
      var TAU = Math.PI * 2;
      var V = S.minAlpha;
      var NB = EDGES.length;
      var ea = new Int8Array(NB);
      var eb = new Int8Array(NB);
      var esd = new Uint8Array(NB);
      var tors = new Uint8Array(NB);
      var jside = new Uint8Array(33);
      var k, i;
      for (i = 0; i < 33; i++) jside[i] = i < 11 ? 0 : (i % 2 === 1 ? 1 : 2);
      for (k = 0; k < NB; k++) {
        ea[k] = EDGES[k][0];
        eb[k] = EDGES[k][1];
        esd[k] = jside[ea[k]] === jside[eb[k]] ? jside[ea[k]] : 0;
        tors[k] = (ea[k] === 11 || ea[k] === 12 || ea[k] === 23 || ea[k] === 24) && (eb[k] === 11 || eb[k] === 12 || eb[k] === 23 || eb[k] === 24) ? 1 : 0;
      }
      var nj = 0;
      for (i = 0; i < 33; i++) if (S.jointRadius[i] > 0) nj++;
      var JT = new Int8Array(nj);
      var nm = 0;
      var JM = new Int8Array(nj);
      nj = 0;
      for (i = 0; i < 33; i++) {
        if (S.jointRadius[i] > 0) {
          JT[nj++] = i;
          if (S.jointWidth[i] >= 0.58) JM[nm++] = i;
        }
      }
      var st = null;
      var pal = null;
      var quality = 2;
      var reduce = false;
      var color = '';
      var prevColor = '';
      var toneAt = 0;
      var fadeK = 1;
      var trackedSide = 0;
      var ej = new Float32Array(33);
      var tg = new Uint8Array(33);
      var lastNow = -1;
      var slotU = new Float32Array(4);
      var sprite = null;
      var spriteKey = '';
      var c = null;
      var P = 1;
      var px = null;
      var py = null;
      var pj = null;
      var rw = 4;
      var hp = 1;
      var hx = 0;
      var hy = 0;
      var hr = 0;
      var ha = 0;
      var nx0 = 0;
      var ny0 = 0;
      var nx1 = 0;
      var ny1 = 0;
      var na = 0;
      var nowMs = 0;

      function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
      function dimF(sd, e) {
        if (trackedSide === 0 || sd === 0 || sd === trackedSide) return 1;
        return S.dimAlpha + (1 - S.dimAlpha) * e;
      }
      function jw(j) { var w = rw * S.jointWidth[j] * (1 + S.emphGrow * ej[j]); return w > S.maxWidth ? S.maxWidth : w; }
      function jr(j) { var r = rw * S.jointRadius[j] * (1 + S.emphGrow * 0.8 * ej[j]); return r < 1.1 ? 1.1 : r; }
      function ja(j) { return pj[j] * dimF(jside[j], ej[j]); }
      function ba(m) {
        var a = ea[m];
        var b = eb[m];
        var al = pj[a] < pj[b] ? pj[a] : pj[b];
        return al * dimF(esd[m], ej[a] < ej[b] ? ej[a] : ej[b]);
      }
      function quad(ax, ay, bx, by, wa, wb) {
        var dx = bx - ax;
        var dy = by - ay;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.5) return;
        var nx = (-dy / d) * 0.5;
        var ny = (dx / d) * 0.5;
        c.beginPath();
        c.moveTo(ax + nx * wa, ay + ny * wa);
        c.lineTo(bx + nx * wb, by + ny * wb);
        c.lineTo(bx - nx * wb, by - ny * wb);
        c.lineTo(ax - nx * wa, ay - ny * wa);
        c.closePath();
        c.fill();
      }
      function disc(x, y, r) {
        c.beginPath();
        c.arc(x, y, r, 0, TAU);
        c.fill();
      }

      // Torso length in px (shoulder middle to hip middle), else one side, else the bounding box.
      function scaleOf(p, slot) {
        var x = p.x;
        var y = p.y;
        var a = p.a;
        var u = 0;
        var s1 = a[11] > V;
        var s2 = a[12] > V;
        var h1 = a[23] > V;
        var h2 = a[24] > V;
        var dx, dy;
        if (s1 && s2 && h1 && h2) {
          dx = (x[11] + x[12]) / 2 - (x[23] + x[24]) / 2;
          dy = (y[11] + y[12]) / 2 - (y[23] + y[24]) / 2;
          u = Math.sqrt(dx * dx + dy * dy);
        } else if (s1 && h1) {
          dx = x[11] - x[23];
          dy = y[11] - y[23];
          u = Math.sqrt(dx * dx + dy * dy);
        } else if (s2 && h2) {
          dx = x[12] - x[24];
          dy = y[12] - y[24];
          u = Math.sqrt(dx * dx + dy * dy);
        } else {
          var x0 = 1e9;
          var x1 = -1e9;
          var y0 = 1e9;
          var y1 = -1e9;
          var cnt = 0;
          for (var j = 0; j < 33; j++) {
            if (a[j] > V) {
              cnt++;
              if (x[j] < x0) x0 = x[j];
              if (x[j] > x1) x1 = x[j];
              if (y[j] < y0) y0 = y[j];
              if (y[j] > y1) y1 = y[j];
            }
          }
          u = cnt > 1 ? Math.max(x1 - x0, y1 - y0) / 3.4 : slotU[slot];
        }
        if (!(u > 0)) u = slotU[slot] > 0 ? slotU[slot] : 40;
        u = clamp(u, 16, 600);
        slotU[slot] = slotU[slot] > 0 ? slotU[slot] + (u - slotU[slot]) * S.scaleSmooth : u;
        return slotU[slot];
      }

      // Fit a circle to the nose, eyes and ears; the neck runs from the shoulders to its edge.
      function fitHead(u) {
        var sx = 0;
        var sy = 0;
        var n = 0;
        var amax = 0;
        var j;
        for (var q = 0; q < 5; q++) {
          j = q === 0 ? 0 : (q === 1 ? 2 : (q === 2 ? 5 : (q === 3 ? 7 : 8)));
          if (pj[j] > V) {
            sx += px[j];
            sy += py[j];
            n++;
            if (pj[j] > amax) amax = pj[j];
          }
        }
        ha = 0;
        na = 0;
        if (n === 0) return;
        var cx = sx / n;
        var cy = sy / n;
        var span = 0;
        var j2;
        for (var q2 = 0; q2 < 5; q2++) {
          j = q2 === 0 ? 0 : (q2 === 1 ? 2 : (q2 === 2 ? 5 : (q2 === 3 ? 7 : 8)));
          if (pj[j] <= V) continue;
          for (var q3 = q2 + 1; q3 < 5; q3++) {
            j2 = q3 === 1 ? 2 : (q3 === 2 ? 5 : (q3 === 3 ? 7 : 8));
            if (pj[j2] <= V) continue;
            var dx = px[j] - px[j2];
            var dy = py[j] - py[j2];
            var d = Math.sqrt(dx * dx + dy * dy);
            if (d > span) span = d;
          }
        }
        hr = clamp(span * S.headSpan, u * S.headMinRadius, u * S.headMaxRadius);
        hx = cx;
        hy = cy - hr * 0.12;
        ha = amax;
        if (pj[11] > V && pj[12] > V) {
          var mx = (px[11] + px[12]) / 2;
          var my = (py[11] + py[12]) / 2;
          var ddx = mx - hx;
          var ddy = my - hy;
          var dd = Math.sqrt(ddx * ddx + ddy * ddy);
          if (dd > hr * 1.15) {
            nx0 = mx;
            ny0 = my;
            nx1 = hx + (ddx / dd) * hr;
            ny1 = hy + (ddy / dd) * hr;
            na = Math.min(pj[11], pj[12], ha);
          }
        }
      }

      function twoTone(fn) {
        if (prevColor) {
          fn(prevColor, 1 - fadeK);
          fn(color, fadeK);
        } else fn(color, 1);
      }

      function haloPass() {
        c.fillStyle = pal.halo;
        var m, a, b, j, t;
        for (m = 0; m < NB; m++) {
          a = ea[m];
          b = eb[m];
          if (pj[a] <= V || pj[b] <= V) continue;
          c.globalAlpha = P * S.haloAlpha * ba(m);
          quad(px[a], py[a], px[b], py[b], jw(a) + 2 * hp, jw(b) + 2 * hp);
        }
        if (na > V) {
          c.globalAlpha = P * S.haloAlpha * na;
          quad(nx0, ny0, nx1, ny1, rw * S.neckStart + 2 * hp, rw * S.neckEnd + 2 * hp);
        }
        for (t = 0; t < nj; t++) {
          j = JT[t];
          if (pj[j] <= V) continue;
          c.globalAlpha = P * S.haloAlpha * ja(j);
          disc(px[j], py[j], jr(j) + hp);
        }
      }

      function emphasisPath() {
        var any = 0;
        var maxE = 0;
        var minA = 1;
        c.beginPath();
        for (var m = 0; m < NB; m++) {
          var a = ea[m];
          var b = eb[m];
          var e = ej[a] < ej[b] ? ej[a] : ej[b];
          if (e > 0.02 && pj[a] > V && pj[b] > V) {
            c.moveTo(px[a], py[a]);
            c.lineTo(px[b], py[b]);
            any = 1;
            if (e > maxE) maxE = e;
            if (pj[a] < minA) minA = pj[a];
            if (pj[b] < minA) minA = pj[b];
          }
        }
        return any ? maxE * minA : 0;
      }

      function glow(col, mul) {
        if (quality < 2 || reduce) return;
        var w = emphasisPath();
        if (w <= 0) return;
        c.strokeStyle = col;
        c.lineWidth = Math.min(S.maxWidth * 2.4, rw * S.glowWidth);
        c.globalAlpha = P * mul * S.glowAlpha * w;
        c.stroke();
        c.lineWidth = Math.min(S.maxWidth * 1.6, rw * S.glowCoreWidth);
        c.globalAlpha = P * mul * S.glowCoreAlpha * w;
        c.stroke();
      }

      function makeSprite() {
        if (sprite && spriteKey === pal.highlight) return;
        spriteKey = pal.highlight;
        var z = S.spriteSize;
        sprite = env.createCanvas(z, z);
        var sc = sprite.getContext('2d');
        if (!sc) return;
        sc.clearRect(0, 0, z, z);
        sc.fillStyle = pal.highlight;
        sc.globalAlpha = S.spriteStepAlpha;
        for (var s = 0; s < S.spriteSteps; s++) {
          sc.beginPath();
          sc.arc(z / 2, z / 2, (z / 2) * (1 - s / S.spriteSteps), 0, TAU);
          sc.fill();
        }
        sc.globalAlpha = 1;
      }

      function bloom() {
        if (quality < 2 || reduce || !st.chain || st.chain.length === 0) return;
        var f = st.chain.length > 1 ? st.chain[1] : st.chain[0];
        if (!(ej[f] > 0.02) || pj[f] <= V) return;
        makeSprite();
        if (!sprite) return;
        var r = rw * S.bloomRadius;
        c.globalAlpha = P * S.bloomAlpha * ej[f] * pj[f];
        c.drawImage(sprite, px[f] - r, py[f] - r, r * 2, r * 2);
      }

      function coreBones(col, mul) {
        c.fillStyle = col;
        var m, a, b, e;
        if (quality >= 1 && pj[11] > V && pj[12] > V && pj[23] > V && pj[24] > V) {
          var mn = Math.min(pj[11], pj[12], pj[23], pj[24]);
          c.globalAlpha = P * mul * S.plateAlpha * mn;
          c.beginPath();
          c.moveTo(px[11], py[11]);
          c.lineTo(px[12], py[12]);
          c.lineTo(px[24], py[24]);
          c.lineTo(px[23], py[23]);
          c.closePath();
          c.fill();
        }
        for (m = 0; m < NB; m++) {
          a = ea[m];
          b = eb[m];
          if (pj[a] <= V || pj[b] <= V) continue;
          e = ej[a] < ej[b] ? ej[a] : ej[b];
          c.globalAlpha = P * mul * ba(m) * (S.coreAlpha + (1 - S.coreAlpha) * e);
          quad(px[a], py[a], px[b], py[b], jw(a), jw(b));
        }
        if (na > V) {
          c.globalAlpha = P * mul * na * S.coreAlpha;
          quad(nx0, ny0, nx1, ny1, rw * S.neckStart, rw * S.neckEnd);
        }
      }

      function coreJoints(col, mul) {
        c.fillStyle = col;
        for (var t = 0; t < nj; t++) {
          var j = JT[t];
          if (pj[j] <= V) continue;
          c.globalAlpha = P * mul * ja(j) * (S.coreAlpha + (1 - S.coreAlpha) * ej[j]);
          disc(px[j], py[j], jr(j));
        }
      }

      // A small bright centre on the large joints, so they read as nodes rather than blobs.
      function jointCores() {
        c.fillStyle = pal.highlight;
        for (var t = 0; t < nm; t++) {
          var j = JM[t];
          if (pj[j] <= V) continue;
          c.globalAlpha = P * S.jointCoreAlpha * ja(j);
          disc(px[j], py[j], jr(j) * S.jointCore);
        }
      }

      function highlightPass() {
        c.strokeStyle = pal.highlight;
        c.lineWidth = clamp(rw * S.highlightWidth, 0.8, 3);
        var any = 0;
        var mp = 1;
        var m, a, b;
        c.beginPath();
        for (m = 0; m < NB; m++) {
          if (!tors[m]) continue;
          a = ea[m];
          b = eb[m];
          if (pj[a] <= V || pj[b] <= V) continue;
          c.moveTo(px[a], py[a]);
          c.lineTo(px[b], py[b]);
          any = 1;
          if (ba(m) < mp) mp = ba(m);
        }
        if (any) {
          c.globalAlpha = P * S.torsoHighlight * mp;
          c.stroke();
        }
        var w = emphasisPath();
        if (w > 0) {
          c.globalAlpha = P * S.emphHighlight * w;
          c.stroke();
        }
      }

      function rings() {
        if (!st.chain) return;
        c.strokeStyle = pal.highlight;
        c.lineWidth = S.ringWidth;
        var pulse = reduce ? 0 : Math.sin((nowMs / S.ringPulseMs) * TAU) * S.ringPulse;
        for (var t = 0; t < st.chain.length; t++) {
          var j = st.chain[t];
          if (!(ej[j] > 0.02) || pj[j] <= V) continue;
          c.globalAlpha = P * S.ringAlpha * ej[j] * pj[j];
          c.beginPath();
          c.arc(px[j], py[j], jr(j) + hp + S.ringGap + pulse, 0, TAU);
          c.stroke();
        }
      }

      function head(col, twoTones, pm) {
        if (ha <= V) return;
        var hw = rw * S.headWidth;
        c.beginPath();
        c.arc(hx, hy, hr, 0, TAU);
        c.strokeStyle = pal.halo;
        c.lineWidth = hw + 2 * hp;
        c.globalAlpha = P * S.haloAlpha * ha;
        c.stroke();
        c.lineWidth = hw;
        if (twoTones && prevColor) {
          c.fillStyle = prevColor;
          c.globalAlpha = P * pm * ha * S.headFill * (1 - fadeK);
          c.fill();
          c.strokeStyle = prevColor;
          c.globalAlpha = P * pm * ha * S.coreAlpha * (1 - fadeK);
          c.stroke();
          c.fillStyle = col;
          c.globalAlpha = P * pm * ha * S.headFill * fadeK;
          c.fill();
          c.strokeStyle = col;
          c.globalAlpha = P * pm * ha * S.coreAlpha * fadeK;
          c.stroke();
        } else {
          c.fillStyle = col;
          c.globalAlpha = P * pm * ha * S.headFill;
          c.fill();
          c.strokeStyle = col;
          c.globalAlpha = P * pm * ha * S.coreAlpha;
          c.stroke();
        }
      }

      function load(p, slot, scaleMul) {
        px = p.x;
        py = p.y;
        pj = p.a;
        P = p.pa;
        var u = scaleOf(p, slot);
        rw = clamp(u * S.widthPerTorso * scaleMul, S.minWidth, S.maxWidth);
        hp = clamp(rw * S.haloPad, S.haloPadMin, S.haloPadMax);
        fitHead(u);
      }

      function rich(p, slot) {
        load(p, slot, 1);
        haloPass();
        twoTone(glow);
        bloom();
        twoTone(coreBones);
        highlightPass();
        twoTone(coreJoints);
        jointCores();
        rings();
        head(color, true, 1);
      }

      // Quality 0 and the second person: one batched halo stroke and one core stroke per group.
      function simple(p, slot, col, pm, dims, scaleMul) {
        load(p, slot, scaleMul);
        var g, m, a, b, t, j, any, gal;
        for (g = 0; g < 2; g++) {
          gal = g ? S.dimAlpha : 1;
          any = 0;
          c.beginPath();
          for (m = 0; m < NB; m++) {
            a = ea[m];
            b = eb[m];
            if (pj[a] < S.simpleMinAlpha || pj[b] < S.simpleMinAlpha) continue;
            if (((dims && dimF(esd[m], 0) < 1) ? 1 : 0) !== g) continue;
            c.moveTo(px[a], py[a]);
            c.lineTo(px[b], py[b]);
            any = 1;
          }
          if (any) {
            c.strokeStyle = pal.halo;
            c.lineWidth = rw + 2 * hp;
            c.globalAlpha = P * S.haloAlpha * gal;
            c.stroke();
            c.strokeStyle = col;
            c.lineWidth = rw * S.simpleWidth;
            c.globalAlpha = P * pm * gal;
            c.stroke();
          }
          c.fillStyle = pal.halo;
          c.globalAlpha = P * S.haloAlpha * gal;
          c.beginPath();
          for (t = 0; t < nm; t++) {
            j = JM[t];
            if (pj[j] < S.simpleMinAlpha || ((dims && dimF(jside[j], 0) < 1) ? 1 : 0) !== g) continue;
            c.moveTo(px[j] + jr(j) + hp, py[j]);
            c.arc(px[j], py[j], jr(j) + hp, 0, TAU);
          }
          c.fill();
          c.fillStyle = col;
          c.globalAlpha = P * pm * gal;
          c.beginPath();
          for (t = 0; t < nm; t++) {
            j = JM[t];
            if (pj[j] < S.simpleMinAlpha || ((dims && dimF(jside[j], 0) < 1) ? 1 : 0) !== g) continue;
            c.moveTo(px[j] + jr(j), py[j]);
            c.arc(px[j], py[j], jr(j), 0, TAU);
          }
          c.fill();
        }
        head(col, false, pm);
      }

      return {
        setState: function (s, now) {
          if (!s || !s.palette) return;
          var nc = s.palette[s.tone];
          var nr = !!s.reduceMotion;
          if (st && color && nc !== color && !nr && quality > 0) {
            prevColor = color;
            toneAt = now;
          } else if (nc !== color) prevColor = '';
          st = s;
          pal = s.palette;
          color = nc;
          reduce = nr;
          trackedSide = s.side === 'left' ? 1 : (s.side === 'right' ? 2 : 0);
          tg.fill(0);
          if (s.chain) for (var j = 0; j < s.chain.length; j++) tg[s.chain[j]] = 1;
          if (nr) for (var q = 0; q < 33; q++) ej[q] = tg[q];
        },
        setQuality: function (q) {
          quality = q < 0 ? 0 : (q > 2 ? 2 : q | 0);
          if (quality === 0) prevColor = '';
        },
        draw: function (ctx, f, now) {
          ctx.clearRect(0, 0, f.w, f.h);
          if (!st) return;
          c = ctx;
          nowMs = now;
          var dt = lastNow < 0 ? 0 : clamp(now - lastNow, 0, 100);
          lastNow = now;
          var step = reduce ? 1 : dt / S.emphasisMs;
          var j;
          for (j = 0; j < 33; j++) {
            var d = tg[j] - ej[j];
            ej[j] = d > step ? ej[j] + step : (d < -step ? ej[j] - step : tg[j]);
          }
          fadeK = 1;
          if (prevColor) {
            var t = (now - toneAt) / S.fadeMs;
            if (reduce || t >= 1 || prevColor === color) prevColor = '';
            else {
              t = t < 0 ? 0 : t;
              fadeK = t * t * (3 - 2 * t);
            }
          }
          c.save();
          c.lineCap = 'round';
          c.lineJoin = 'round';
          for (var i2 = 0; i2 < f.people.length && i2 < 4; i2++) {
            var p = f.people[i2];
            if (!p || !(p.pa > V)) continue;
            if (!p.primary) simple(p, i2, pal.other, S.otherAlpha, false, S.otherScale);
            else if (quality === 0) simple(p, i2, color, S.coreAlpha, true, 1);
            else rich(p, i2);
          }
          c.globalAlpha = 1;
          c.restore();
        },
        clear: function (ctx, w, h) { ctx.clearRect(0, 0, w, h); }
      };
    }
  };
}`;
