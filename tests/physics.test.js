import { test } from "node:test";
import assert from "node:assert/strict";

import {
  L_NAMES,
  ROUTH_MU,
  SQRT3_2,
  accelerations,
  advance,
  axisNetX,
  effectivePotential,
  hillRadius,
  imbalance,
  jacobiConstant,
  len,
  makeSystem,
  nearestLPoint,
} from "../js/physics.js";

const RATIOS = [1e-6, 3.003e-6, 0.0123, 0.000954, 0.03, 0.1, 0.25, 0.5];

test("all five points balance for every mass ratio", () => {
  for (const q of RATIOS) {
    const sys = makeSystem(q);
    for (const name of L_NAMES) {
      const [x, y] = sys.lPoints[name];
      const acc = accelerations(sys, x, y);
      assert.ok(
        len(acc.net) < 1e-9,
        `${name} at q=${q}: |net|=${len(acc.net)}`,
      );
      assert.ok(imbalance(acc) < 1e-9, `${name} imbalance at q=${q}`);
    }
  }
});

test("collinear points are ordered L3 < Sun < L1 < Earth < L2", () => {
  for (const q of RATIOS) {
    const { lPoints } = makeSystem(q);
    assert.ok(lPoints.L3[0] < 0, `L3 q=${q}`);
    assert.ok(lPoints.L1[0] > 0 && lPoints.L1[0] < 1, `L1 q=${q}`);
    assert.ok(lPoints.L2[0] > 1, `L2 q=${q}`);
  }
});

test("L4 and L5 form equilateral triangles independent of mass", () => {
  for (const q of RATIOS) {
    const { lPoints } = makeSystem(q);
    for (const name of ["L4", "L5"]) {
      const [x, y] = lPoints[name];
      assert.ok(Math.abs(Math.hypot(x, y) - 1) < 1e-12);
      assert.ok(Math.abs(Math.hypot(x - 1, y) - 1) < 1e-12);
    }
    assert.equal(lPoints.L4[1], SQRT3_2);
  }
});

test("on the bisector, total gravity points exactly at the CM", () => {
  const sys = makeSystem(0.25);
  for (const y of [0.3, 0.7, 1.2, -0.9, 2.5]) {
    const acc = accelerations(sys, 0.5, y);
    const toCm = [sys.cm[0] - 0.5, sys.cm[1] - y];
    const cross = acc.gravity[0] * toCm[1] - acc.gravity[1] * toCm[0];
    const dot = acc.gravity[0] * toCm[0] + acc.gravity[1] * toCm[1];
    assert.ok(Math.abs(cross) < 1e-12 * len(acc.gravity) * len(toCm) + 1e-15);
    assert.ok(dot > 0);
    // Gravity vs centrifugal ratio is (a / d)^3 with a = 1.
    const d = acc.dSun;
    const ratio = len(acc.gravity) / len(acc.cf);
    assert.ok(Math.abs(ratio - 1 / d ** 3) < 1e-9);
  }
});

test("L1/L2 distances approach the Hill radius for small mu", () => {
  const sys = makeSystem(3.003e-6);
  const rh = hillRadius(sys);
  const dL1 = 1 - sys.lPoints.L1[0];
  const dL2 = sys.lPoints.L2[0] - 1;
  assert.ok(Math.abs(dL1 - rh) / rh < 0.01);
  assert.ok(Math.abs(dL2 - rh) / rh < 0.01);
});

test("net acceleration is minus the gradient of the effective potential", () => {
  const sys = makeSystem(0.1);
  const h = 1e-6;
  for (const [x, y] of [
    [0.3, 0.4],
    [1.4, -0.2],
    [-0.8, 0.9],
  ]) {
    const gx =
      (effectivePotential(sys, x + h, y) - effectivePotential(sys, x - h, y)) /
      (2 * h);
    const gy =
      (effectivePotential(sys, x, y + h) - effectivePotential(sys, x, y - h)) /
      (2 * h);
    const acc = accelerations(sys, x, y);
    assert.ok(Math.abs(acc.net[0] + gx) < 1e-6);
    assert.ok(Math.abs(acc.net[1] + gy) < 1e-6);
  }
});

test("axis profile agrees with the full 2D net acceleration", () => {
  const sys = makeSystem(0.25);
  for (const x of [-1.5, -0.4, 0.3, 0.8, 1.3, 2]) {
    assert.ok(Math.abs(axisNetX(sys, x) - accelerations(sys, x, 0).net[0]) < 1e-12);
  }
});

test("Routh critical mass ratio", () => {
  assert.ok(Math.abs(ROUTH_MU - 0.0385208965) < 1e-9);
});

test("released particle conserves the Jacobi constant", () => {
  const sys = makeSystem(0.000954);
  const [x, y] = sys.lPoints.L4;
  const s = [x + 0.01, y, 0, 0];
  const c0 = jacobiConstant(sys, s);
  const outcome = advance(sys, s, 20 * sys.period);
  assert.equal(outcome, "ok");
  assert.ok(Math.abs(jacobiConstant(sys, s) - c0) < 1e-7);
});

test("L4 with a Jupiter-like ratio is stable, with 25% it is not", () => {
  const stable = makeSystem(0.000954);
  const s1 = [...stable.lPoints.L4, 0, 0];
  s1[0] += 0.005;
  let maxDev = 0;
  advance(stable, s1, 40 * stable.period, {
    onSample: (x, y) => {
      maxDev = Math.max(
        maxDev,
        Math.hypot(x - stable.lPoints.L4[0], y - stable.lPoints.L4[1]),
      );
    },
  });
  assert.ok(maxDev < 0.3, `stable libration stayed near L4 (max ${maxDev})`);

  const unstable = makeSystem(0.25);
  const s2 = [...unstable.lPoints.L4, 0, 0];
  s2[0] += 0.005;
  let maxDev2 = 0;
  const out = advance(unstable, s2, 40 * unstable.period, {
    onSample: (x, y) => {
      maxDev2 = Math.max(
        maxDev2,
        Math.hypot(x - unstable.lPoints.L4[0], y - unstable.lPoints.L4[1]),
      );
    },
  });
  assert.ok(out !== "ok" || maxDev2 > 0.5, `unstable drifted (max ${maxDev2})`);
});

test("nearestLPoint", () => {
  const sys = makeSystem(0.25);
  const hit = nearestLPoint(sys, 0.51, 0.86);
  assert.equal(hit.name, "L4");
  assert.ok(hit.distance < 0.02);
});
