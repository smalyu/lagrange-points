import { test } from "node:test";
import assert from "node:assert/strict";

import { accelerations, axisNetX, makeSystem } from "../js/physics.js";
import { createCamera, fitBox, worldToScreen } from "../js/camera.js";
import { profileValue, sampleRuns } from "../js/features/profile.js";

const BOX = { minX: -1.12, maxX: 1.78, minY: -1.02, maxY: 1.02 };
const MASSES = [3.003e-6, 9.546e-4, 0.0123, 0.1218, 0.25, 1];

function camera(rot = 0) {
  const cam = createCamera();
  cam.view = rot ? { left: 0, top: 70, width: 334, height: 588 } : { left: 0, top: 74, width: 1440, height: 671 };
  cam.rot = rot;
  const fit = fitBox(cam, BOX, rot ? 10 : 24);
  cam.center = fit.center;
  return cam;
}

test("on the axis the net pull is purely along the line and equals axisNetX", () => {
  for (const q of MASSES) {
    const sys = makeSystem(q);
    for (const x of [-1.5, -0.6, 0.2, 0.45, 0.8, 1.3, 1.7]) {
      const acc = accelerations(sys, x, 0);
      assert.equal(acc.net[1], 0);
      assert.ok(Math.abs(acc.net[0] - axisNetX(sys, x)) <= 1e-12 * Math.max(1, Math.abs(acc.net[0])));
    }
  }
});

test("profile value: odd, monotonic, zero exactly at zero, bounded", () => {
  assert.equal(profileValue(0), 0);
  let prev = -Infinity;
  for (const f of [-1e9, -40, -3, -0.05, -1e-6, 0, 1e-6, 0.05, 3, 40, 1e9]) {
    const v = profileValue(f);
    assert.ok(v >= prev, `not monotonic at ${f}`);
    assert.ok(Math.abs(v + profileValue(-f)) < 1e-15, `not odd at ${f}`);
    assert.ok(Math.abs(v) <= 1.4 + 1e-12);
    prev = v;
  }
  // Clearly visible even for a tiny leftover, and not saturated for typical pulls.
  assert.ok(profileValue(0.05) > 0.1);
  assert.ok(profileValue(3.5) < 0.8);
});

test("sampled strip: exactly one zero crossing per gap, right where L3, L1, L2 are", () => {
  for (const rot of [0, 1]) {
    const cam = camera(rot);
    const main = rot ? 1 : 0;
    for (const q of MASSES) {
      const sys = makeSystem(q);
      const uS = worldToScreen(cam, 0, 0)[main];
      const uE = worldToScreen(cam, 1, 0)[main];
      const uOf = (x) => uS + x * (uE - uS);
      const xOf = (u) => (u - uS) / (uE - uS);
      const lo = Math.min(uOf(BOX.minX), uOf(BOX.maxX));
      const hi = Math.max(uOf(BOX.minX), uOf(BOX.maxX));
      const runs = sampleRuns(lo, hi, [uS, uE]);
      assert.equal(runs.length, 3, "split at both bodies");
      const crossings = [];
      for (const run of runs) {
        for (let i = 1; i < run.length; i += 1) {
          assert.ok(run[i] > run[i - 1]);
          const a = axisNetX(sys, xOf(run[i - 1]));
          const b = axisNetX(sys, xOf(run[i]));
          if (a === 0 || a * b < 0) crossings.push(xOf((run[i - 1] + run[i]) / 2));
        }
      }
      assert.equal(crossings.length, 3, `q=${q} rot=${rot}: ${crossings}`);
      const px = Math.abs(uE - uS); // px per a
      const expected = ["L3", "L1", "L2"].map((n) => sys.lPoints[n][0]).sort((a, b) => a - b);
      crossings.sort((a, b) => a - b);
      for (let i = 0; i < 3; i += 1) {
        // Within one sampling step of the exact point.
        assert.ok(Math.abs(crossings[i] - expected[i]) * px <= 2.01, `q=${q} ${crossings[i]} vs ${expected[i]}`);
      }
      // The curve rises through zero at every collinear point (all three are
      // unstable along the line): negative just before, positive just after.
      for (const x of expected) {
        const d = 1e-6;
        assert.ok(axisNetX(sys, x - d) < 0 && axisNetX(sys, x + d) > 0, `q=${q} at ${x}`);
      }
    }
  }
});

test("sampling never lands on a body and stays dense next to it", () => {
  const runs = sampleRuns(0, 1000, [300, 700]);
  for (const run of runs) {
    for (const u of run) assert.ok(Math.abs(u - 300) >= 0.5 - 1e-9 && Math.abs(u - 700) >= 0.5 - 1e-9);
  }
  const mid = runs[1];
  assert.equal(mid[0], 300.5);
  assert.equal(mid[mid.length - 1], 699.5);
  assert.ok(mid[1] - mid[0] <= 0.5 + 1e-9);
});
