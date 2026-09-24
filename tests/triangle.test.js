// Pure-logic tests for chapter 2 "Why a triangle?" and features/shares.js:
// the share/miss decomposition the ticks draw, and the percentage strings.

import { test } from "node:test";
import assert from "node:assert/strict";

import { L_NAMES, accelerations, makeSystem } from "../js/physics.js";
import { formatDistance, shareStrings } from "../js/features/shares.js";

const RATIOS = [1e-6, 3.003e-6, 0.000954, 0.0123, 0.1, 0.25, 0.5, 1];

/** Shares, legs and misses exactly as shares.js draws them (world units, k = 1/omega^2). */
function decompose(sys, x, y) {
  const acc = accelerations(sys, x, y);
  const M = sys.mSun + sys.mEarth;
  const out = {};
  for (const [key, body, m] of [
    ["sun", sys.sun, sys.mSun],
    ["earth", sys.earth, sys.mEarth],
  ]) {
    const share = [(m / M) * (body[0] - x), (m / M) * (body[1] - y)];
    const leg = [acc[key][0] / sys.omega2, acc[key][1] / sys.omega2];
    out[key] = { share, leg, miss: [leg[0] - share[0], leg[1] - share[1]] };
  }
  return { acc, ...out };
}

test("shares add up to the centre of mass from any probe position", () => {
  for (const q of RATIOS) {
    const sys = makeSystem(q);
    for (const [x, y] of [[0.5, 0.8], [0.2, 0.9], [-0.7, 0.3], [1.3, -0.4], [0.8, 0.75]]) {
      const d = decompose(sys, x, y);
      const sx = x + d.sun.share[0] + d.earth.share[0];
      const sy = y + d.sun.share[1] + d.earth.share[1];
      assert.ok(Math.abs(sx - sys.cm[0]) < 1e-12 && Math.abs(sy - sys.cm[1]) < 1e-12, `q=${q} (${x},${y})`);
    }
  }
});

test("the two misses add up to the leftover (net / omega^2)", () => {
  for (const q of RATIOS) {
    const sys = makeSystem(q);
    for (const [x, y] of [[0.5, 1.2], [0.2, 0.9], [0.8, 0.75], [0.3, -0.6]]) {
      const d = decompose(sys, x, y);
      const mx = d.sun.miss[0] + d.earth.miss[0];
      const my = d.sun.miss[1] + d.earth.miss[1];
      const nx = d.acc.net[0] / sys.omega2;
      const ny = d.acc.net[1] / sys.omega2;
      assert.ok(Math.hypot(mx - nx, my - ny) < 1e-12 * (1 + Math.hypot(nx, ny)), `q=${q}`);
    }
  }
});

test("each miss lies along its own body's line", () => {
  const sys = makeSystem(0.25);
  const d = decompose(sys, 0.8, 0.75);
  for (const key of ["sun", "earth"]) {
    const { share, miss } = d[key];
    const cross = share[0] * miss[1] - share[1] * miss[0];
    assert.ok(Math.abs(cross) < 1e-12, key);
  }
  // The demo spot: outside the Sun's circle (falls short), inside Earth's (overshoots).
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  assert.ok(dot(d.sun.miss, d.sun.share) < 0);
  assert.ok(dot(d.earth.miss, d.earth.share) > 0);
});

test("at L4 and L5 both legs end exactly on their ticks, for every mass", () => {
  for (const q of RATIOS) {
    const sys = makeSystem(q);
    for (const name of ["L4", "L5"]) {
      const [x, y] = sys.lPoints[name];
      const d = decompose(sys, x, y);
      assert.ok(Math.hypot(...d.sun.miss) < 1e-12, `${name} sun q=${q}`);
      assert.ok(Math.hypot(...d.earth.miss) < 1e-12, `${name} earth q=${q}`);
    }
  }
});

test("at L1-L3 the misses are not zero but cancel along the axis", () => {
  const sys = makeSystem(0.25);
  for (const name of L_NAMES.slice(0, 3)) {
    const [x, y] = sys.lPoints[name];
    const d = decompose(sys, x, y);
    assert.ok(Math.hypot(...d.sun.miss) > 1e-3, name);
    assert.ok(Math.abs(d.sun.miss[0] + d.earth.miss[0]) < 1e-9, name);
  }
});

test("share strings always add up to 100%", () => {
  assert.deepEqual(shareStrings(0.25), { sun: "80%", earth: "20%" });
  assert.deepEqual(shareStrings(1), { sun: "50%", earth: "50%" });
  assert.deepEqual(shareStrings(3.003e-6), { sun: "99.9997%", earth: "0.0003%" });
  assert.deepEqual(shareStrings(0.1218), { sun: "89.1%", earth: "10.9%" });
  assert.deepEqual(shareStrings(0.0123), { sun: "98.8%", earth: "1.2%" });
  for (const q of [1e-6, 2e-5, 9.546e-4, 0.03, 0.07, 0.3333, 0.6, 1]) {
    const t = shareStrings(q);
    const sum = parseFloat(t.sun) + parseFloat(t.earth);
    assert.ok(Math.abs(sum - 100) < 1e-9, `${q}: ${t.sun} + ${t.earth}`);
  }
});

test("distance readout formatting", () => {
  assert.equal(formatDistance(1), "1.00");
  assert.equal(formatDistance(0.8999), "0.90");
  assert.equal(formatDistance(0.00997), "0.010");
  assert.equal(formatDistance(12.34), "12.3");
});

test("on the midline both misses scale together and the leftover aims along the CM line", () => {
  for (const q of RATIOS) {
    const sys = makeSystem(q);
    let ratio0 = null;
    for (const y of [0.3, 0.7, 0.93, 0.96, 1.2, -0.5, -1.1]) {
      const d = decompose(sys, 0.5, y);
      const oS = Math.hypot(...d.sun.miss);
      const oE = Math.hypot(...d.earth.miss);
      // |o_Sun| / |o_Earth| = m_Sun / m_Earth wherever you are on the midline.
      const ratio = oS / oE;
      if (ratio0 === null) ratio0 = ratio;
      assert.ok(Math.abs(ratio / ratio0 - 1) < 1e-9, `q=${q} y=${y}`);
      assert.ok(Math.abs(ratio - 1 / q) < 1e-6 * (1 / q), `q=${q} y=${y}: ${ratio}`);
      // net is parallel to P - C (gravity aims straight at the CM there).
      const [nx, ny] = d.acc.net;
      const cx = 0.5 - sys.cm[0];
      const cross = nx * y - ny * cx;
      assert.ok(Math.abs(cross) < 1e-12 * (1 + Math.hypot(nx, ny)), `q=${q} y=${y}`);
    }
    // Both vanish at the L4/L5 height only.
    const at = decompose(sys, 0.5, Math.sqrt(3) / 2);
    assert.ok(Math.hypot(...at.sun.miss) < 1e-12 && Math.hypot(...at.earth.miss) < 1e-12, `q=${q}`);
  }
});
