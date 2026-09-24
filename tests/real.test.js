// Pure logic behind chapter "Real scale" and features/realscale.js.

import { test } from "node:test";
import assert from "node:assert/strict";

import { SI, accelerations, hillRadius, len, makeSystem } from "../js/physics.js";
import { REAL_EARTH_Q } from "../js/mass.js";
import {
  KM_PER_A,
  earthZoomTarget,
  findSpot,
  formatA,
  formatKm,
  hillOf,
  isEarthZoomed,
  isRealRatio,
  neutralDistance,
  segHitsRect,
} from "../js/features/realscale.js";

test("km formatting matches the numbers people know", () => {
  const sys = makeSystem(REAL_EARTH_Q);
  assert.equal(formatKm((1 - sys.lPoints.L1[0]) * KM_PER_A), "1.5 million km");
  assert.equal(formatKm((sys.lPoints.L2[0] - 1) * KM_PER_A), "1.5 million km");
  assert.equal(formatKm(neutralDistance(REAL_EARTH_Q) * KM_PER_A), "259,000 km");
  assert.equal(formatKm(KM_PER_A), "150 million km");
  assert.equal(formatKm(500000), "500,000 km");
  assert.equal(formatKm(2e6), "2 million km");
  assert.equal(KM_PER_A, SI.au / 1000);
});

test("distances in units of a", () => {
  assert.equal(formatA(0.02), "0.02");
  assert.equal(formatA(neutralDistance(1e-5)), "0.0032");
  assert.equal(formatA(2e-5), "2×10⁻⁵");
  assert.equal(formatA(1e-4), "10⁻⁴");
  assert.equal(formatA(1), "1");
});

test("neutral point: equal gravities, and not L1 unless the masses are equal", () => {
  for (const q of [REAL_EARTH_Q, 9.546e-4, 0.0123, 0.25, 1]) {
    const sys = makeSystem(q);
    const x = 1 - neutralDistance(q);
    const acc = accelerations(sys, x, 0);
    assert.ok(Math.abs(len(acc.sun) - len(acc.earth)) < 1e-12 * len(acc.sun), `q=${q}`);
    // Only for equal masses does symmetry put L1 on the neutral point.
    if (q < 1) assert.ok(Math.abs(x - sys.lPoints.L1[0]) > 1e-4, `q=${q}`);
    else assert.ok(Math.abs(x - sys.lPoints.L1[0]) < 1e-9);
  }
  // Real Earth: L1 is about 5.8 times farther out than the neutral point.
  const sys = makeSystem(REAL_EARTH_Q);
  const ratio = (1 - sys.lPoints.L1[0]) / neutralDistance(REAL_EARTH_Q);
  assert.ok(ratio > 5.7 && ratio < 5.85, String(ratio));
});

test("tide (Sun pull + spin) and Earth's pull cancel exactly at L1 and L2", () => {
  for (const q of [1e-6, REAL_EARTH_Q, 1e-4, 9.546e-4]) {
    const sys = makeSystem(q);
    for (const name of ["L1", "L2"]) {
      const [x, y] = sys.lPoints[name];
      const a = accelerations(sys, x, y);
      const tide = [a.sun[0] + a.cf[0], a.sun[1] + a.cf[1]];
      const sum = [tide[0] + a.earth[0], tide[1] + a.earth[1]];
      assert.ok(len(sum) < 1e-9 * len(a.earth), `${name} q=${q}`);
      // Equal and opposite.
      assert.ok(Math.abs(len(tide) - len(a.earth)) < 1e-9 * len(a.earth));
    }
  }
});

test("Hill radius helper agrees with physics.js", () => {
  for (const q of [1e-6, REAL_EARTH_Q, 0.01, 0.25]) {
    assert.ok(Math.abs(hillOf(q) - hillRadius(makeSystem(q))) < 1e-15);
  }
  assert.ok(isRealRatio(REAL_EARTH_Q * (1 + 1e-9)));
  assert.ok(!isRealRatio(1e-5));
});

function mockApp(q, over = {}) {
  return {
    state: { q },
    userZoomed: true,
    cam: {
      view: { left: 0, top: 64, width: 1440, height: 680 },
      baseScale: 330,
      zoom: 1,
      center: [0.33, 0],
      flight: null,
      ...over,
    },
  };
}

test("Earth zoom frames +-3 Hill radii in 70% of the smaller side", () => {
  const app = mockApp(REAL_EARTH_Q);
  const t = earthZoomTarget(app);
  const span = 6 * hillOf(REAL_EARTH_Q) * app.cam.baseScale * t.zoom;
  assert.ok(Math.abs(span - 0.7 * 680) < 1e-9);
  assert.deepEqual(t.center, [1, 0]);
  // Heavy "Earth": never zooms out.
  assert.ok(earthZoomTarget(mockApp(0.25)).zoom >= 1.5);
});

test("isEarthZoomed follows the camera and its flight", () => {
  const app = mockApp(REAL_EARTH_Q);
  assert.equal(isEarthZoomed(app), false);
  const t = earthZoomTarget(app);
  app.cam.flight = { to: { center: [1, 0], zoom: t.zoom } };
  assert.equal(isEarthZoomed(app), true);
  app.cam.flight = null;
  app.cam.zoom = t.zoom;
  app.cam.center = [1.0001, 0];
  assert.equal(isEarthZoomed(app), true);
  // Zoomed in deeper than the close-up (wheel, smaller window) still counts...
  app.userZoomed = true;
  app.cam.zoom = t.zoom * 3;
  assert.equal(isEarthZoomed(app), true);
  // ...zoomed out well past it does not.
  app.cam.zoom = t.zoom * 0.5;
  assert.equal(isEarthZoomed(app), false);
  app.cam.zoom = t.zoom;
  app.userZoomed = false;
  assert.equal(isEarthZoomed(app), false);
});

test("label spots keep a margin from other labels, but not from dots and the probe", () => {
  const ctx = { font: "", save() {}, restore() {}, measureText: (t) => ({ width: t.length * 6 }) };
  const parts = [{ text: "SOHO" }]; // 24 px wide -> rect 28 x 18.4
  const cand = [{ x: 100, y: 100, align: "left" }]; // rect x 98..126, y 90.8..109.2
  const labelRight = { x: 128, y: 90, w: 20, h: 20 }; // 2 px gap
  assert.ok(findSpot(ctx, parts, cand, { obstacles: [labelRight] }));
  assert.equal(findSpot(ctx, parts, cand, { obstacles: [labelRight], margin: 4 }), null);
  assert.ok(findSpot(ctx, parts, cand, { obstacles: [{ ...labelRight, tight: true }], margin: 4 }));
  // Real overlaps are rejected either way.
  assert.equal(findSpot(ctx, parts, cand, { obstacles: [{ x: 120, y: 95, w: 10, h: 10, tight: true }] }), null);
});

test("segment vs rectangle test used for label placement", () => {
  const r = { x: 10, y: 10, w: 20, h: 10 };
  assert.equal(segHitsRect({ a: [0, 15], b: [40, 15], pad: 0 }, r), true);
  assert.equal(segHitsRect({ a: [0, 0], b: [40, 0], pad: 3 }, r), false);
  assert.equal(segHitsRect({ a: [0, 8], b: [40, 8], pad: 3 }, r), true);
  assert.equal(segHitsRect({ a: [15, 15], b: [16, 16], pad: 0 }, r), true);
  assert.equal(segHitsRect({ a: [35, 0], b: [35, 40], pad: 2 }, r), false);
});
