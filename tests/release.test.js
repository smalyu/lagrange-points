import { test } from "node:test";
import assert from "node:assert/strict";

import { ROUTH_MU, jacobiConstant, makeSystem } from "../js/physics.js";
import {
  LIVE_ARROWS_MAX_SPEED,
  createRun,
  describeOutcome,
  displaySpeed,
  earthRadius,
  formatOrbits,
  librationOrbits,
  nudgeSize,
  releaseState,
  simulate,
} from "../js/features/release.js";

const JUPITER_Q = 9.546e-4;
const EARTH_Q = 3.003e-6;

test("25%: let go at L4 with the tiny push, it flies off within 10 orbits", () => {
  const sys = makeSystem(0.25);
  const r = simulate(sys, "L4");
  assert.equal(r.outcome, "escaped");
  assert.ok(r.orbits > 1 && r.orbits < 10, `orbits ${r.orbits}`);
  // Not a knife-edge: rounding-level changes to the push give the same story...
  for (const f of [1 - 1e-9, 1 + 1e-9]) {
    const s = simulate(sys, "L4", { nudge: 0.005 * f });
    assert.equal(s.outcome, "escaped");
    assert.ok(Math.abs(s.orbits - r.orbits) < 0.01);
  }
  // ...and any other small push also ends in disaster within 10 orbits.
  for (const f of [0.5, 0.9, 0.98, 1.02, 1.1, 2]) {
    const s = simulate(sys, "L4", { nudge: 0.005 * f });
    assert.ok(["escaped", "hitSun", "hitEarth"].includes(s.outcome), `nudge x${f}: ${s.outcome}`);
    assert.ok(s.orbits < 15, `nudge x${f}: ${s.orbits}`);
  }
});

test("25%: L5 is unstable too", () => {
  const r = simulate(makeSystem(0.25), "L5");
  assert.ok(["escaped", "hitSun", "hitEarth"].includes(r.outcome), r.outcome);
  assert.ok(r.orbits < 10);
});

test("Jupiter's mass: L4 stays within 0.6 a for 40 orbits", () => {
  const sys = makeSystem(JUPITER_Q);
  const r = simulate(sys, "L4", { maxOrbits: 40 });
  assert.equal(r.outcome, "stable");
  assert.ok(r.maxDist < 0.6, `maxDist ${r.maxDist}`);
  assert.equal(r.leftAt, null);
  assert.ok(Math.abs(r.orbits - 40) < 0.01);
});

test("Jupiter's mass: the loop is a tadpole between about 40 and 88 degrees", () => {
  const sys = makeSystem(JUPITER_Q);
  const r = simulate(sys, "L4", { maxOrbits: 25, sampleEvery: 0.02 });
  const angles = r.samples.map(([x, y]) => (Math.atan2(y, x - sys.cm[0]) * 180) / Math.PI);
  const lo = Math.min(...angles);
  const hi = Math.max(...angles);
  assert.ok(lo > 35 && lo < 45, `min angle ${lo}`);
  assert.ok(hi > 83 && hi < 92, `max angle ${hi}`);
});

test("Jupiter's mass: the Jacobi constant is conserved along the loop", () => {
  const sys = makeSystem(JUPITER_Q);
  const run = createRun(sys, "L4");
  const c0 = jacobiConstant(sys, run.s);
  while (!run.outcome && run.orbits < 20) run.step();
  assert.ok(Math.abs(jacobiConstant(sys, run.s) - c0) < 1e-10);
});

test("real Earth mass: L4 holds (a big tadpole that never crosses the Sun-Earth line)", () => {
  const sys = makeSystem(EARTH_Q);
  const r = simulate(sys, "L4");
  assert.equal(r.outcome, "stable");
  assert.ok(r.orbits > 600, `ran ${r.orbits} orbits`);
});

test("25%: L1 is left quickly", () => {
  const sys = makeSystem(0.25);
  const r = simulate(sys, "L1", { maxOrbits: 3 });
  assert.notEqual(r.leftAt, null);
  assert.ok(r.leftAt < 0.5, `left after ${r.leftAt} orbits`);
  assert.ok(r.maxDist > 0.2);
  assert.notEqual(r.outcome, "stable");
});

test("Jupiter's mass: L1 is left quickly too", () => {
  const r = simulate(makeSystem(JUPITER_Q), "L1", { maxOrbits: 3 });
  assert.notEqual(r.leftAt, null);
  assert.ok(r.leftAt < 0.5);
  assert.notEqual(r.outcome, "stable");
});

test("the tiny push scales with sqrt(mu) for light planets", () => {
  assert.equal(nudgeSize(makeSystem(0.25).mu), 0.005);
  assert.equal(nudgeSize(makeSystem(JUPITER_Q).mu), 0.005);
  const mu = makeSystem(EARTH_Q).mu;
  assert.ok(Math.abs(nudgeSize(mu) - 0.3 * Math.sqrt(mu)) < 1e-15);
  // Pushed straight away from the Sun, starting at rest.
  const sys = makeSystem(0.25);
  const [x, y, vx, vy] = releaseState(sys, sys.lPoints.L4, 0.005);
  assert.ok(Math.abs(Math.hypot(x, y) - 1.005) < 1e-12);
  assert.ok(Math.abs(Math.atan2(y, x) - Math.PI / 3) < 1e-12);
  assert.equal(vx, 0);
  assert.equal(vy, 0);
});

test("libration period: 12.4 orbits for Jupiter, about 222 for Earth, none above Routh", () => {
  assert.ok(Math.abs(librationOrbits(makeSystem(JUPITER_Q).mu) - 12.4) < 0.1);
  assert.ok(Math.abs(librationOrbits(makeSystem(EARTH_Q).mu) - 222) < 1);
  assert.equal(librationOrbits(ROUTH_MU), Infinity);
  assert.equal(librationOrbits(0.2), Infinity);
});

test("display speed: one libration in about 13 s near a stable L4, else 0.5 orbits/s", () => {
  const jup = makeSystem(JUPITER_Q);
  assert.ok(Math.abs(displaySpeed(jup, jup.lPoints.L4) - 12.43 / 13) < 0.01);
  const earth = makeSystem(EARTH_Q);
  assert.ok(Math.abs(displaySpeed(earth, earth.lPoints.L4) - 222 / 13) < 0.2);
  const big = makeSystem(0.25);
  assert.equal(displaySpeed(big, big.lPoints.L4), 0.5);
  assert.equal(displaySpeed(jup, jup.lPoints.L1), 0.5);
});

test("Earth's impact radius grows with the cube root of its mass", () => {
  assert.ok(Math.abs(earthRadius(EARTH_Q) - 4.26e-5) < 1e-12);
  assert.ok(Math.abs(earthRadius(8 * EARTH_Q) - 2 * 4.26e-5) < 1e-12);
  assert.equal(earthRadius(0), 1e-6);
});

test("a probe dropped on the Sun is reported as hitting it", () => {
  const r = simulate(makeSystem(0.25), [0.002, 0], { nudge: 0 });
  assert.equal(r.outcome, "hitSun");
});

test("runs are deterministic", () => {
  const sys = makeSystem(0.25);
  const a = simulate(sys, "L4");
  const b = simulate(sys, "L4");
  assert.deepEqual(a, b);
});

test("outcome text", () => {
  assert.equal(formatOrbits(3.13), "3.1 orbits");
  assert.equal(formatOrbits(1.02), "1 orbit");
  assert.equal(formatOrbits(12.4), "12 orbits");
  assert.equal(describeOutcome("escaped", 3.13, "L4"), "Flew off after 3.1 orbits.");
  assert.equal(describeOutcome("hitEarth", 0.01, "L1"), "Crashed into Earth straight away.");
  assert.equal(describeOutcome("caught", 2.44, "L4"), "Caught after 2.4 orbits.");
});

test("above the 4% line, a run that has left L4 no longer counts as staying", () => {
  const run = createRun(makeSystem(0.25), "L4");
  while (!run.outcome && run.leftAt === null) run.step();
  assert.equal(run.outcome, null);
  assert.equal(run.staying(), false);
  // Below it, a wide tadpole that has not crossed the Sun-Earth line still does.
  const earth = createRun(makeSystem(EARTH_Q), "L4");
  while (!earth.outcome && earth.leftAt === null) earth.step();
  assert.equal(earth.staying(), true);
});

test("live arrows are drawn at Jupiter's mass, not at real Earth's (they would strobe)", () => {
  const jup = makeSystem(JUPITER_Q);
  const earth = makeSystem(EARTH_Q);
  assert.ok(displaySpeed(jup, jup.lPoints.L4) <= LIVE_ARROWS_MAX_SPEED);
  assert.ok(displaySpeed(earth, earth.lPoints.L4) > LIVE_ARROWS_MAX_SPEED);
  const big = makeSystem(0.25);
  assert.ok(displaySpeed(big, big.lPoints.L1) <= LIVE_ARROWS_MAX_SPEED);
});
