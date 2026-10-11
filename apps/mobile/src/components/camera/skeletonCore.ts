/**
 * Tuning of the skeleton tracker, set by the measurements in skeletonCore.test.ts (lag against
 * the old pipeline, jitter while still, slow and moving, overshoot). Units: positions are fractions
 * of the video width, speeds are widths per second, times are ms unless the name says otherwise.
 */
export const SKELETON_TUNING = {
  // Two constant-velocity trackers (alpha-beta filters, the steady state of a Kalman filter) run on
  // every joint axis: a calm one for steady and slow motion (small lowAccel) and an agile one for
  // sudden changes (large highAccel). Accelerations are in widths per second squared; noise is the
  // expected size of the model's per-result noise in widths. The blend between the two follows how
  // well each predicted the last results (innovation energy, smoothed by innovAlpha per result):
  // the agile one takes over when the calm one is clearly worse, by switchBias in log energy.
  filter: { noise: 0.004, lowAccel: 0.06, highAccel: 1.8, innovAlpha: 0.3, switchSharp: 4, switchBias: 1.2 },
  vis: { lowpass: 0.5, enter: 0.55, exit: 0.35 },
  fade: { inMs: 120, outMs: 220, jointHoldMs: 150, personHoldMs: 250, keepMs: 700 },
  predict: {
    // Look-ahead from the capture time to now: at most maxMs, at most maxFracW of the width, and
    // only gain of the velocity (the rest would overshoot a reversal). A velocity below lookLo
    // (widths per second) is taken as noise and not looked ahead; it ramps in fully by lookHi.
    maxMs: 140,
    maxFracW: 0.04,
    gain: 0.4,
    lookLo: 0.06,
    lookHi: 0.12,
    // No look-ahead for joints that are not clearly visible.
    dampZeroVis: 0.4,
    dampFullVis: 0.7,
    // A new result that disagrees with the look-ahead is absorbed over reconcileTauMs (1 means
    // practically at once: any smoothing here costs lag, and the trackers already smooth).
    reconcileTauMs: 1,
    // When a joint's velocity is zeroed (it is lost, or the guard holds it), the look-ahead it had
    // been showing is let go over this long instead of at once, so the picture glides back.
    zeroVelTauMs: 50,
    latencyAlpha: 0.2,
    latencyMaxMs: 150,
  },
  // A joint that jumps further than stepBase + stepPerS * dt is held until the jump is confirmed
  // (holdResults results within confirmDist of each other). A suspicion never lasts longer than
  // maxHoldMs, though: fast real motion never settles within confirmDist, so after that long the
  // new position is accepted anyway (re-seeded through the alpha dip) instead of frozen for good.
  // The same limit applies to a whole person held because many joints jump at once. A person whose
  // torso middle is more than newcomerDist (widths) from every existing person, when there are
  // several, is a newcomer: it gets an empty slot and fades in instead of inheriting a slot.
  guard: { stepBase: 0.06, stepPerS: 4, confirmDist: 0.05, holdResults: 2, maxHoldMs: 300, reseedFadeMs: 150, swapRatio: 0.6, newcomerDist: 0.3 },
  view: { maxDpr: 2, maxPixels: 1500000 },
  governor: { glowOffDrawMs: 6, minimalDrawMs: 10, windowFrames: 30 },
};

export type SkeletonTuning = typeof SKELETON_TUNING;

/**
 * The skeleton tracker, as JavaScript SOURCE TEXT (like the pose engine core): it runs inside the
 * camera page. `function skeletonCore(CFG)` returns { createMapper, createBank }.
 *
 * The mapper turns normalised video coordinates into CSS px on a cover-cropped, optionally
 * mirrored view, and sizes the canvas backing store. The bank turns the model's results (about
 * 30 per second, each arriving late) into a skeleton that is drawn on every display frame:
 * two blended alpha-beta trackers per joint, a short bounded look-ahead that covers the latency, a
 * soft reconcile when a new result disagrees with the look-ahead, hysteresis on joint visibility,
 * hold-then-fade on dropouts, and a guard that never lets a joint teleport. Everything is driven
 * by the times passed in, so a fake clock controls it completely.
 *
 * Plain ES2017 only: no backticks, no dollar-brace, no backslashes, no regex literals.
 */
export const SKELETON_CORE = `function skeletonCore(CFG) {
  var N = 33;
  var MAXP = 4;
  var FAR = -1000000000;
  var F = CFG.filter, V = CFG.vis, FD = CFG.fade, PR = CFG.predict, G = CFG.guard, VW = CFG.view;
  // Left/right landmark pairs as consecutive indices: face, then shoulders to feet.
  // Torso joints (shoulders and hips): their middle says which person is which between results.
  var TORSO = [11, 12, 23, 24];
  // Cost of giving an incoming person a slot that has no position to compare with.
  var FREE = 1000000000;
  var PAIRS = [1, 4, 2, 5, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function createMapper() {
    var ox = 0, oy = 0, dw = 1, dh = 1, cwv = 1, flip = false;
    var out = { pw: 1, ph: 1, scale: 1 };
    function backing(cw, ch, eff) {
      out.pw = Math.max(1, Math.round(cw * eff));
      out.ph = Math.max(1, Math.round(ch * eff));
    }
    return {
      update: function (cw, ch, vw, vh, dpr, mirror) {
        var w = vw > 0 ? vw : cw, h = vh > 0 ? vh : ch;
        var s = Math.max(cw / w, ch / h);
        dw = w * s; dh = h * s;
        ox = (cw - dw) / 2; oy = (ch - dh) / 2;
        cwv = cw; flip = !!mirror;
        var eff = Math.min(dpr > 0 ? dpr : 1, VW.maxDpr);
        backing(cw, ch, eff);
        if (out.pw * out.ph > VW.maxPixels) eff = eff * Math.sqrt(VW.maxPixels / (out.pw * out.ph));
        backing(cw, ch, eff);
        for (var guard = 0; guard < 200 && out.pw * out.ph > VW.maxPixels && eff > 0.01; guard++) {
          eff = eff * 0.995;
          backing(cw, ch, eff);
        }
        out.scale = eff;
        return out;
      },
      px: function (nx) { var x = ox + nx * dw; return flip ? cwv - x : x; },
      py: function (ny) { return oy + ny * dh; }
    };
  }

  function f64() { return new Float64Array(N); }
  function makePerson(primary) {
    return {
      on: false, lastSeen: 0, pa: 0, paT: 0, vzero: true, tok: false, tx: 0, ty: 0, pj: false, pjT: 0,
      seeded: new Uint8Array(N), isOn: new Uint8Array(N), sus: new Uint8Array(N),
      // Two trackers per axis (calm 0, agile 1): position and velocity, and how well each predicted.
      x0: f64(), y0: f64(), x1: f64(), y1: f64(), vx0: f64(), vy0: f64(), vx1: f64(), vy1: f64(),
      ev0: f64(), ev1: f64(), mix: f64(),
      ox: f64(), oy: f64(), tau: f64(), cx: f64(), cy: f64(), sdt: f64(), susT: f64(), lrx: f64(), lry: f64(), l2x: f64(), l2y: f64(), tc2: f64(),
      vis: f64(), tc: f64(), tr: f64(),
      lostAt: f64().fill(FAR), seedAt: f64().fill(FAR),
      a: f64(), at: f64(),
      out: { x: new Float32Array(N), y: new Float32Array(N), a: new Float32Array(N), pa: 0, primary: primary }
    };
  }

  function wipe(P) {
    P.on = false; P.pa = 0; P.paT = 0; P.lastSeen = 0; P.vzero = true; P.tok = false; P.tx = 0; P.ty = 0; P.pj = false; P.pjT = 0;
    P.seeded.fill(0); P.isOn.fill(0); P.sus.fill(0);
    P.x0.fill(0); P.y0.fill(0); P.x1.fill(0); P.y1.fill(0);
    P.vx0.fill(0); P.vy0.fill(0); P.vx1.fill(0); P.vy1.fill(0);
    P.ev0.fill(0); P.ev1.fill(0); P.mix.fill(0);
    P.ox.fill(0); P.oy.fill(0); P.tau.fill(1); P.cx.fill(0); P.cy.fill(0); P.sdt.fill(0); P.susT.fill(0); P.lrx.fill(0); P.lry.fill(0); P.l2x.fill(0); P.l2y.fill(0); P.tc2.fill(0);
    P.vis.fill(0); P.tc.fill(0); P.tr.fill(0);
    P.lostAt.fill(FAR); P.seedAt.fill(FAR); P.a.fill(0); P.at.fill(0);
    P.out.x.fill(0); P.out.y.fill(0); P.out.a.fill(0); P.out.pa = 0;
  }

  function createBank() {
    var slots = [];
    for (var s = 0; s < MAXP; s++) slots.push(makePerson(s === 0));
    var scene = { n: 0, people: [] };
    var lat = 0, haveLat = false;
    var asp = 1, invAsp = 1, capX = PR.maxFracW, capY = PR.maxFracW;
    var ex = 0, ey = 0, ga = 0, gb = 0;
    var rawX = new Float64Array(N), rawY = new Float64Array(N);
    var has = new Uint8Array(N), wasOn = new Uint8Array(N), chk = new Uint8Array(N);
    var jump = new Uint8Array(N), force = new Uint8Array(N), acc = new Uint8Array(N);
    var expX = new Float64Array(N), expY = new Float64Array(N);
    // Result rate, as an EWMA of the capture interval: a slow device holds a person longer.
    var rint = 0, haveInt = false, lastCap = 0, haveCap = false;
    // Scratch for matching the incoming people to the slots (no allocation per result).
    var pcx = new Float64Array(MAXP), pcy = new Float64Array(MAXP), pok = new Uint8Array(MAXP);
    var done = new Uint8Array(MAXP), took = new Uint8Array(MAXP), slotOf = new Int8Array(MAXP);

    // Aspect-corrected distance, in units of the video width.
    function dist(ax, ay, bx, by) {
      var dx = ax - bx, dy = (ay - by) * invAsp;
      return Math.sqrt(dx * dx + dy * dy);
    }
    // How long a person is shown at full alpha after the last result, and how long it is remembered.
    function holdMs() { return Math.max(FD.personHoldMs, 2 * rint); }
    function keepMs() { return Math.max(FD.keepMs, holdMs() + FD.outMs); }
    // The middle of the torso (shoulders and hips) of one incoming person, into pcx/pcy/pok at j.
    // Falls back to every clearly visible joint when the torso is not in the result.
    function centroid(joints, j) {
      var sx = 0, sy = 0, c = 0, len = Math.min(joints.length, N), q, lm;
      for (q = 0; q < TORSO.length; q++) {
        if (TORSO[q] >= len) continue;
        lm = joints[TORSO[q]];
        if (lm && isFinite(lm[0]) && isFinite(lm[1]) && lm[2] > 0.2) { sx += lm[0]; sy += lm[1]; c++; }
      }
      if (c === 0) {
        for (q = 0; q < len; q++) {
          lm = joints[q];
          if (lm && isFinite(lm[0]) && isFinite(lm[1]) && lm[2] > 0.2) { sx += lm[0]; sy += lm[1]; c++; }
        }
      }
      pok[j] = c > 0 ? 1 : 0;
      pcx[j] = c > 0 ? sx / c : 0;
      pcy[j] = c > 0 ? sy / c : 0;
    }
    // 0 below dampZeroVis, 1 above dampFullVis: unsure joints are not extrapolated.
    function damp(vis) { return clamp((vis - PR.dampZeroVis) / (PR.dampFullVis - PR.dampZeroVis), 0, 1); }
    // Steady-state gains of an alpha-beta filter (the Kalman gains of a constant-velocity model)
    // for acceleration noise accel and step dt (s). Writes ga, gb.
    function gains(accel, dt) {
      var l = accel * dt * dt / F.noise;
      var r = Math.sqrt(l * l + 8 * l);
      ga = -(l * l + 8 * l - (l + 4) * r) / 8;
      gb = (l * l + 4 * l - l * r) / 4;
    }
    // A velocity that is no bigger than the estimate's own noise is not looked ahead: it ramps in
    // smoothly from lookLo to lookHi (widths per second).
    function gate(v) {
      var t = (Math.abs(v) - PR.lookLo) / (PR.lookHi - PR.lookLo);
      if (t <= 0) return 0;
      if (t >= 1) return v;
      return v * t * t * (3 - 2 * t);
    }
    // Where the joint is at time t: both trackers extrapolated from their capture time (bounded,
    // damped), then blended. Writes ex, ey.
    function traj(P, i, t) {
      var age = t - P.tc[i];
      var k = PR.gain * damp(P.vis[i]) * 0.001 * (age < 0 ? 0 : age > PR.maxMs ? PR.maxMs : age);
      var w = P.mix[i];
      var a0 = P.x0[i] + clamp(gate(P.vx0[i]) * k, -capX, capX), a1 = P.x1[i] + clamp(gate(P.vx1[i]) * k, -capX, capX);
      var b0 = P.y0[i] + clamp(gate(P.vy0[i]) * k, -capY, capY), b1 = P.y1[i] + clamp(gate(P.vy1[i]) * k, -capY, capY);
      ex = a0 + w * (a1 - a0); ey = b0 + w * (b1 - b0);
    }
    // Where a joint would be at time t if it carried on at the speed of its last two accepted
    // results (at most three result intervals ahead). Writes ex, ey.
    function lineOf(P, i, t) {
      var pdt = P.tc[i] - P.tc2[i];
      var kk = pdt > 1 ? (t - P.tc[i]) / pdt : 0;
      kk = clamp(kk, 0, 3);
      ex = P.lrx[i] + (P.lrx[i] - P.l2x[i]) * kk;
      ey = P.lry[i] + (P.lry[i] - P.l2y[i]) * kk;
    }
    // What is drawn at time t: the trajectory plus the reconcile offset, which decays away.
    function shown(P, i, t) {
      traj(P, i, t);
      var d = t - P.tr[i];
      var e = d > 0 ? Math.exp(-d / P.tau[i]) : 1;
      ex += P.ox[i] * e; ey += P.oy[i] * e;
    }
    // After the trajectory parameters changed at tr, keep what is drawn continuous (sx, sy).
    function reconcile(P, i, tr, sx, sy, tau) {
      traj(P, i, tr);
      P.ox[i] = sx - ex; P.oy[i] = sy - ey; P.tr[i] = tr;
      P.tau[i] = Math.max(0.001, tau);
    }
    // Stops a joint's extrapolation. What was shown is kept and decays away over zeroVelTauMs, so
    // the picture glides back to the filtered position instead of snapping.
    function zeroVel(P, i, tr) {
      if (P.vx0[i] === 0 && P.vy0[i] === 0 && P.vx1[i] === 0 && P.vy1[i] === 0) return;
      shown(P, i, tr);
      var sx = ex, sy = ey;
      P.vx0[i] = 0; P.vy0[i] = 0; P.vx1[i] = 0; P.vy1[i] = 0;
      reconcile(P, i, tr, sx, sy, PR.zeroVelTauMs);
    }
    // Start a joint (or restart it after a jump) at the raw position: never a slide.
    function seed(P, i, tc, tr, dip) {
      P.x0[i] = rawX[i]; P.y0[i] = rawY[i]; P.x1[i] = rawX[i]; P.y1[i] = rawY[i];
      P.vx0[i] = 0; P.vy0[i] = 0; P.vx1[i] = 0; P.vy1[i] = 0;
      P.ev0[i] = 4 * F.noise * F.noise; P.ev1[i] = P.ev0[i]; P.mix[i] = 0;
      P.ox[i] = 0; P.oy[i] = 0; P.tau[i] = 1;
      P.tc[i] = tc; P.tr[i] = tr; P.sus[i] = 0;
      P.lrx[i] = rawX[i]; P.lry[i] = rawY[i]; P.l2x[i] = rawX[i]; P.l2y[i] = rawY[i]; P.tc2[i] = tc - 1;
      if (!P.seeded[i]) { P.seeded[i] = 1; P.at[i] = tr; P.a[i] = 0; }
      P.seedAt[i] = dip ? tr : FAR;
    }
    function update(P, i, tc, tr) {
      var dt = (tc - P.tc[i]) * 0.001;
      if (dt <= 0) return;
      if (dt < 0.001) dt = 0.001;
      shown(P, i, tr);
      var sx = ex, sy = ey;
      var rx = rawX[i], ry = rawY[i];
      // Calm tracker.
      gains(F.lowAccel, dt);
      var xp = P.x0[i] + P.vx0[i] * dt, yp = P.y0[i] + P.vy0[i] * dt;
      var exr = rx - xp, eyr = ry - yp;
      P.x0[i] = xp + ga * exr; P.y0[i] = yp + ga * eyr;
      P.vx0[i] += gb * exr / dt; P.vy0[i] += gb * eyr / dt;
      P.ev0[i] += F.innovAlpha * (0.5 * (exr * exr + eyr * eyr) - P.ev0[i]);
      // Agile tracker.
      gains(F.highAccel, dt);
      xp = P.x1[i] + P.vx1[i] * dt; yp = P.y1[i] + P.vy1[i] * dt;
      exr = rx - xp; eyr = ry - yp;
      P.x1[i] = xp + ga * exr; P.y1[i] = yp + ga * eyr;
      P.vx1[i] += gb * exr / dt; P.vy1[i] += gb * eyr / dt;
      P.ev1[i] += F.innovAlpha * (0.5 * (exr * exr + eyr * eyr) - P.ev1[i]);
      // The agile tracker takes over when the calm one has been clearly worse lately.
      P.mix[i] = 1 / (1 + Math.exp(-F.switchSharp * (Math.log((P.ev0[i] + 1e-9) / (P.ev1[i] + 1e-9)) - F.switchBias)));
      P.tc2[i] = P.tc[i]; P.tc[i] = tc;
      P.l2x[i] = P.lrx[i]; P.l2y[i] = P.lry[i]; P.lrx[i] = rx; P.lry[i] = ry;
      reconcile(P, i, tr, sx, sy, PR.reconcileTauMs);
    }

    function ingest(P, joints, tc, tr) {
      var i, k, len = Math.min(joints.length, N);
      var fresh = !P.on || tr - P.lastSeen > keepMs();
      if (fresh) { wipe(P); P.on = true; P.paT = tr; }
      var snap = !fresh && tr - P.lastSeen > holdMs() + FD.outMs;
      // Visibility: a low-pass with enter/exit thresholds, so a flickering joint does not blink.
      for (i = 0; i < N; i++) {
        var lm = i < len ? joints[i] : null;
        var ok = !!lm && isFinite(lm[0]) && isFinite(lm[1]);
        has[i] = ok ? 1 : 0;
        var rv = 0;
        if (ok) { rawX[i] = lm[0]; rawY[i] = lm[1]; rv = lm[2]; if (!(rv > 0)) rv = 0; else if (rv > 1) rv = 1; }
        wasOn[i] = P.isOn[i];
        if (!P.seeded[i]) P.vis[i] = rv; else P.vis[i] += V.lowpass * (rv - P.vis[i]);
        if (P.isOn[i]) { if (P.vis[i] < V.exit) P.isOn[i] = 0; } else if (P.vis[i] >= V.enter) P.isOn[i] = 1;
      }
      // Guard: find joints that jumped further than a person can move, and swapped left/right pairs.
      var comparable = 0, njump = 0;
      for (i = 0; i < N; i++) {
        jump[i] = 0; force[i] = 0; chk[i] = 0;
        // A joint that comes back inside the hold window is compared too (against where it was last
        // accepted), so a pair that returns swapped is caught and not slid across.
        if (!(P.seeded[i] && P.isOn[i] && has[i] && (wasOn[i] || tr - P.lostAt[i] <= FD.jointHoldMs + FD.outMs))) continue;
        chk[i] = 1; comparable++;
        // Where the joint is expected to have been when the frame was captured.
        traj(P, i, tc);
        expX[i] = ex; expY[i] = ey;
        // The allowed step is fixed when a jump is first suspected, so holding does not widen it.
        var dtj = P.sus[i] > 0 ? P.sdt[i] : (tc - P.tc[i]) * 0.001;
        if (dtj < 0) dtj = 0;
        if (P.sus[i] === 0) P.sdt[i] = dtj;
        // A jump is far from where the trackers expected the joint AND from where it was last
        // accepted: fast real motion can outrun the trackers (they overshoot a reversal), but a
        // person cannot move further than stepBase + stepPerS * dt from the last accepted position.
        if (dist(rawX[i], rawY[i], expX[i], expY[i]) > G.stepBase + G.stepPerS * dtj && dist(rawX[i], rawY[i], P.lrx[i], P.lry[i]) > G.stepBase + G.stepPerS * dtj) { jump[i] = 1; njump++; }
      }
      for (k = 0; k < PAIRS.length; k += 2) {
        var a = PAIRS[k], b = PAIRS[k + 1];
        if (!chk[a] || !chk[b]) continue;
        // A swap must look cheaper both against the expectation and against the last accepted pose.
        var straight = dist(rawX[a], rawY[a], expX[a], expY[a]) + dist(rawX[b], rawY[b], expX[b], expY[b]);
        var swapped = dist(rawX[a], rawY[a], expX[b], expY[b]) + dist(rawX[b], rawY[b], expX[a], expY[a]);
        if (!(straight > G.stepBase && swapped < G.swapRatio * straight)) continue;
        straight = dist(rawX[a], rawY[a], P.lrx[a], P.lry[a]) + dist(rawX[b], rawY[b], P.lrx[b], P.lry[b]);
        swapped = dist(rawX[a], rawY[a], P.lrx[b], P.lry[b]) + dist(rawX[b], rawY[b], P.lrx[a], P.lry[a]);
        if (!(straight > G.stepBase && swapped < G.swapRatio * straight)) continue;
        // ... and against the last accepted pose carried on at its own speed: two wrists that really
        // cross each other fast are on that line, while a label swap is not.
        lineOf(P, a, tc); var lax = ex, lay = ey;
        lineOf(P, b, tc);
        straight = dist(rawX[a], rawY[a], lax, lay) + dist(rawX[b], rawY[b], ex, ey);
        swapped = dist(rawX[a], rawY[a], ex, ey) + dist(rawX[b], rawY[b], lax, lay);
        if (straight > G.stepBase && swapped < G.swapRatio * straight) { force[a] = 1; force[b] = 1; }
      }
      var personJump = comparable >= 4 && njump >= 0.4 * comparable;
      var nconf = 0;
      for (i = 0; i < N; i++) {
        acc[i] = 0;
        if (!chk[i] || !(jump[i] || force[i])) { P.sus[i] = 0; continue; }
        if (P.sus[i] > 0 && dist(rawX[i], rawY[i], P.cx[i], P.cy[i]) <= G.confirmDist) { if (P.sus[i] < 250) P.sus[i]++; }
        else { if (P.sus[i] === 0) P.susT[i] = tc; P.sus[i] = 1; P.cx[i] = rawX[i]; P.cy[i] = rawY[i]; }
        // Confirmed by repetition, or suspected for so long that it must be real (fast motion).
        if (P.sus[i] > G.holdResults || tc - P.susT[i] >= G.maxHoldMs) acc[i] = 1;
        if (jump[i] && acc[i]) nconf++;
      }
      // A person held because many joints jump at once is held for at most maxHoldMs, whatever the
      // joints do (garbage on every result never confirms): then it is reset, with the fade.
      if (personJump) { if (!P.pj) { P.pj = true; P.pjT = tc; } } else P.pj = false;
      var reset = personJump && (nconf >= 0.4 * comparable || tc - P.pjT >= G.maxHoldMs);
      if (reset) P.pj = false;
      for (i = 0; i < N; i++) {
        if (!has[i] || !P.isOn[i]) {
          if (wasOn[i] && !P.isOn[i]) { P.lostAt[i] = tr; zeroVel(P, i, tr); }
          continue;
        }
        if (!P.seeded[i]) { seed(P, i, tc, tr, false); continue; }
        if (!wasOn[i] && tr - P.lostAt[i] > FD.jointHoldMs + FD.outMs) { seed(P, i, tc, tr, false); continue; }
        if (snap) { seed(P, i, tc, tr, false); continue; }
        if (reset) { seed(P, i, tc, tr, true); continue; }
        // Back inside the hold window: an honest return carries on, a jump or swap is re-seeded.
        if (!wasOn[i]) { if (chk[i] && (jump[i] || force[i])) seed(P, i, tc, tr, true); else update(P, i, tc, tr); continue; }
        if (personJump) { zeroVel(P, i, tr); continue; }
        if (chk[i] && P.sus[i] > 0) {
          if (acc[i]) seed(P, i, tc, tr, true);
          else zeroVel(P, i, tr);
          continue;
        }
        update(P, i, tc, tr);
      }
      P.lastSeen = tr; P.vzero = false;
    }

    // Gives every incoming person the slot of the person it is closest to (torso middle against the
    // slot's last one), nearest pairs first, so two people that swap order in the list keep their
    // slots. People with nothing to compare take the first free slot. Up to MAXP people, no allocation.
    function assign(people, np) {
      var j, s, r, nv = 0, nOn = 0;
      for (s = 0; s < MAXP; s++) if (slots[s].on) nOn++;
      for (j = 0; j < MAXP; j++) {
        took[j] = 0; slotOf[j] = -1; pok[j] = 0;
        done[j] = 1;
        if (j < np && people[j] && people[j].length > 0) { done[j] = 0; nv++; centroid(people[j], j); }
      }
      for (r = 0; r < nv; r++) {
        var bj = -1, bs = -1, bc = 2 * FREE;
        for (j = 0; j < MAXP; j++) {
          if (done[j]) continue;
          for (s = 0; s < MAXP; s++) {
            if (took[s]) continue;
            var Q = slots[s];
            var c = FREE;
            if (Q.on && Q.tok && pok[j]) {
              c = dist(pcx[j], pcy[j], Q.tx, Q.ty);
              // With several people around, one far from everyone is a newcomer: an empty slot (FREE) is
              // better than inheriting this one (FREE + 1). A lone person that jumps keeps its slot.
              if (c > G.newcomerDist && (nOn >= 2 || nv >= 2)) c = FREE + 1;
            }
            if (c < bc) { bc = c; bj = j; bs = s; }
          }
        }
        done[bj] = 1; took[bs] = 1; slotOf[bj] = bs;
      }
    }

    // A person missing from this result: stop extrapolating, the hold and fade run in step().
    function absent(P, tr) {
      if (P.vzero) return;
      for (var i = 0; i < N; i++) if (P.seeded[i]) zeroVel(P, i, tr);
      P.vzero = true;
    }

    function slew(cur, tgt, dt, inMs, outMs) {
      if (tgt > cur) { cur += dt / inMs; return cur > tgt ? tgt : cur; }
      if (tgt < cur) { cur -= dt / outMs; return cur < tgt ? tgt : cur; }
      return cur;
    }

    return {
      push: function (people, captureMs, arriveMs, vw, vh) {
        var l = clamp(arriveMs - captureMs, 0, PR.latencyMaxMs);
        lat = haveLat ? lat + PR.latencyAlpha * (l - lat) : l;
        haveLat = true;
        if (vw > 0 && vh > 0) { asp = vw / vh; invAsp = vh / vw; }
        capX = PR.maxFracW; capY = PR.maxFracW * asp;
        if (captureMs > lastCap || !haveCap) {
          if (haveCap) {
            var iv = clamp(captureMs - lastCap, 0, 1000);
            rint = haveInt ? rint + 0.2 * (iv - rint) : iv;
            haveInt = true;
          }
          lastCap = captureMs; haveCap = true;
        }
        var np = people ? Math.min(people.length, MAXP) : 0;
        assign(people, np);
        var who = 0, pi;
        for (pi = 0; pi < MAXP; pi++) {
          var P = slots[pi];
          who = -1;
          for (var jj = 0; jj < np; jj++) if (slotOf[jj] === pi) who = jj;
          if (who >= 0) {
            ingest(P, people[who], captureMs, arriveMs);
            P.tok = pok[who] === 1; P.tx = pcx[who]; P.ty = pcy[who];
          } else if (P.on) absent(P, arriveMs);
        }
      },
      step: function (nowMs) {
        var n = 0, hold = holdMs(), keep = keepMs(), prim = -1, pi;
        // The primary person is the first one still being seen (else the first one still shown).
        for (pi = 0; pi < MAXP && prim < 0; pi++) if (slots[pi].on && nowMs - slots[pi].lastSeen <= hold) prim = pi;
        for (pi = 0; pi < MAXP && prim < 0; pi++) if (slots[pi].on && nowMs - slots[pi].lastSeen <= keep) prim = pi;
        for (pi = 0; pi < MAXP; pi++) {
          var P = slots[pi], o = P.out;
          if (P.on && nowMs - P.lastSeen > keep) wipe(P);
          if (!P.on) { o.pa = 0; continue; }
          o.primary = pi === prim;
          n = pi + 1;
          var dtp = clamp(nowMs - P.paT, 0, 100);
          P.paT = nowMs;
          P.pa = slew(P.pa, nowMs - P.lastSeen <= hold ? 1 : 0, dtp, FD.inMs, FD.outMs);
          o.pa = P.pa;
          for (var i = 0; i < N; i++) {
            if (!P.seeded[i]) { o.a[i] = 0; continue; }
            var dt = clamp(nowMs - P.at[i], 0, 100);
            P.at[i] = nowMs;
            var tgt = P.isOn[i] || nowMs - P.lostAt[i] <= FD.jointHoldMs ? 1 : 0;
            P.a[i] = slew(P.a[i], tgt, dt, FD.inMs, FD.outMs);
            var ramp = clamp((nowMs - P.seedAt[i]) / G.reseedFadeMs, 0, 1);
            o.a[i] = P.a[i] * ramp;
            shown(P, i, nowMs);
            o.x[i] = ex; o.y[i] = ey;
          }
        }
        if (scene.people.length !== n) {
          scene.people.length = 0;
          for (var q = 0; q < n; q++) scene.people.push(slots[q].out);
        }
        scene.n = n;
        return scene;
      },
      latency: function () { return lat; },
      reset: function () {
        for (var pi = 0; pi < MAXP; pi++) wipe(slots[pi]);
        scene.people.length = 0; scene.n = 0;
        lat = 0; haveLat = false;
        rint = 0; haveInt = false; lastCap = 0; haveCap = false;
      }
    };
  }

  return { createMapper: createMapper, createBank: createBank };
}`;
