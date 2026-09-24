import { test } from "node:test";
import assert from "node:assert/strict";

import { L_NAMES, accelerations, makeSystem } from "../js/physics.js";
import { createCamera, fitBox, worldToScreen } from "../js/camera.js";
import { buildChain, chainScale } from "../js/chain.js";

const BOX = { minX: -1.12, maxX: 1.78, minY: -1.02, maxY: 1.02 };

function camera(rot = 0, zoom = 1) {
  const cam = createCamera();
  cam.view = { left: 0, top: 64, width: 1440, height: 680 };
  cam.rot = rot;
  const fit = fitBox(cam, BOX, 24);
  cam.center = fit.center;
  cam.zoom = zoom;
  return cam;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test("bullseye: at every L-point gravity lands on the target and the loop closes", () => {
  for (const q of [3.003e-6, 9.546e-4, 0.0123, 0.25, 1]) {
    const sys = makeSystem(q);
    for (const rot of [0, 1]) {
      const cam = camera(rot);
      for (const name of L_NAMES) {
        const p = sys.lPoints[name];
        const acc = accelerations(sys, p[0], p[1]);
        const k = chainScale(cam, sys, acc);
        const chain = buildChain(cam, sys, acc, p, k);
        assert.ok(dist(chain.gravityEnd, chain.target) < 1e-6, `${name} q=${q} rot=${rot}`);
        assert.ok(dist(chain.Q, chain.P) < 1e-6, `${name} closes q=${q}`);
      }
    }
  }
});

test("at natural scale the spin leg is a copy of the CM -> probe segment", () => {
  const sys = makeSystem(0.25);
  const cam = camera();
  const probe = [0.5, 1.0];
  const acc = accelerations(sys, probe[0], probe[1]);
  // Far from the bodies, nothing is capped: rho must be exactly 1.
  const k = chainScale(cam, sys, acc);
  const chain = buildChain(cam, sys, acc, probe, k);
  if (chain.rho > 0.999) {
    const C = worldToScreen(cam, sys.cm[0], sys.cm[1]);
    const P = worldToScreen(cam, probe[0], probe[1]);
    const spin = chain.legs[2].vec;
    assert.ok(Math.abs(spin[0] - (P[0] - C[0])) < 1e-9);
    assert.ok(Math.abs(spin[1] - (P[1] - C[1])) < 1e-9);
    assert.ok(dist(chain.target, C) < 1e-9);
  } else {
    assert.fail(`expected natural scale at ${probe}, got rho=${chain.rho}`);
  }
});

test("capped arrows shrink together and the target slides along the tether", () => {
  const sys = makeSystem(0.25);
  const cam = camera();
  const probe = [0.08, 0.05]; // close to the Sun: huge pull
  const acc = accelerations(sys, probe[0], probe[1]);
  const k = chainScale(cam, sys, acc);
  const chain = buildChain(cam, sys, acc, probe, k);
  assert.ok(chain.rho < 0.5);
  const longest = Math.max(...chain.legs.map((l) => l.length));
  assert.ok(longest <= Math.max(1.3 * cam.baseScale, 0.72 * Math.min(cam.view.width, cam.view.height)) + 1e-6);
  // Target stays on the P -> C segment.
  const C = chain.C;
  const P = chain.P;
  const t = chain.target;
  const cross = (C[0] - P[0]) * (t[1] - P[1]) - (C[1] - P[1]) * (t[0] - P[0]);
  assert.ok(Math.abs(cross) < 1e-6);
});

test("lanes switch on for collinear chains on the axis only", () => {
  const sys = makeSystem(0.25);
  const cam = camera();
  const onAxis = [0.45, 0];
  const acc1 = accelerations(sys, onAxis[0], onAxis[1]);
  const c1 = buildChain(cam, sys, acc1, onAxis, chainScale(cam, sys, acc1));
  assert.ok(c1.laneWeight > 0.99);
  const off = [0.5, 0.8];
  const acc2 = accelerations(sys, off[0], off[1]);
  const c2 = buildChain(cam, sys, acc2, off, chainScale(cam, sys, acc2));
  assert.equal(c2.laneWeight, 0);
});

test("the L4 close-up keeps the natural scale (target exactly on the CM)", () => {
  const sys = makeSystem(0.25);
  const cam = camera(0, 1.55);
  cam.center = [0.5, 0.45];
  const p = sys.lPoints.L4;
  const acc = accelerations(sys, p[0], p[1]);
  const chain = buildChain(cam, sys, acc, p, chainScale(cam, sys, acc));
  assert.ok(chain.rho > 0.999, `rho=${chain.rho}`);
  assert.ok(dist(chain.target, chain.C) < 1e-6);
});

test("no lanes off the axis, even when the legs are nearly collinear", () => {
  for (const q of [3.003e-6, 1e-4]) {
    const sys = makeSystem(q);
    const cam = camera();
    const p = sys.lPoints.L4;
    const acc = accelerations(sys, p[0], p[1]);
    const chain = buildChain(cam, sys, acc, p, chainScale(cam, sys, acc));
    assert.equal(chain.laneWeight, 0, `q=${q}`);
    assert.ok(dist(chain.Q, chain.P) < 1e-6);
  }
});

test("zooming in never makes arrows longer than the cap", () => {
  const sys = makeSystem(3.003e-6);
  const cam = camera(0, 300);
  cam.center = [1, 0];
  const p = sys.lPoints.L1;
  const acc = accelerations(sys, p[0], p[1]);
  const k = chainScale(cam, sys, acc);
  const chain = buildChain(cam, sys, acc, p, k);
  const cap = Math.max(1.3 * cam.baseScale, 0.72 * Math.min(cam.view.width, cam.view.height));
  for (const leg of chain.legs) assert.ok(leg.length <= cap + 1e-6);
  assert.ok(dist(chain.gravityEnd, chain.target) < 1e-6);
});
