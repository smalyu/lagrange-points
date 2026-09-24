// Geometry of the tip-to-tail chain of pulls.
//
// All arrows share one scale k (px per unit of acceleration). At the natural
// scale k = s / omega^2 (s = px per Sun-Earth distance) the spin push drawn
// from any point is an exact copy of the CM -> probe segment, so the chain
// Sun pull -> Earth pull lands on the centre of mass exactly when the probe
// is balanced. When arrows would get too long, k shrinks for all of them at
// once and the target slides from the CM towards the probe by rho = k w^2 / s.

import { scaleOf, vecToScreen, worldToScreen } from "./camera.js";
import { len } from "./physics.js";
import { smoothstep } from "./draw.js";

export const LEG_KEYS = ["sun", "earth", "cf"];

/**
 * Uniform arrow scale for this probe position: the natural scale, unless the
 * longest arrow would exceed the cap. The cap follows the visible view (about
 * three quarters of its short side), so a zoomed-in close-up like the L4
 * moment keeps the natural scale and gravity lands exactly on the CM.
 */
export function chainScale(cam, sys, acc, capFactor = 1.3) {
  const s = scaleOf(cam);
  const aMax = Math.max(len(acc.sun), len(acc.earth), len(acc.cf), 1e-300);
  const kNat = s / sys.omega2;
  const capPx = Math.max(capFactor * cam.baseScale, 0.72 * Math.min(cam.view.width, cam.view.height));
  const kCap = capPx / aMax;
  return Math.min(kNat, kCap);
}

function lineDeviation(a, b) {
  // Angle between two lines (not rays), in radians, in [0, pi/2].
  let d = Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

/**
 * Build screen-space geometry for the chain.
 *   morph: 0 = every arrow starts at the probe (fan), 1 = tip to tail (chain)
 *   laneGap: px between lanes when the legs are nearly collinear
 */
export function buildChain(cam, sys, acc, probe, k, opts = {}) {
  const morph = opts.morph ?? 1;
  const laneGap = opts.laneGap ?? 9;
  const s = scaleOf(cam);
  const P = worldToScreen(cam, probe[0], probe[1]);
  const C = worldToScreen(cam, sys.cm[0], sys.cm[1]);
  const vecs = LEG_KEYS.map((key) => vecToScreen(cam, acc[key][0], acc[key][1], k));

  // Joints of the true (unshifted) chain.
  const joints = [P];
  for (const v of vecs) {
    const last = joints[joints.length - 1];
    joints.push([last[0] + v[0], last[1] + v[1]]);
  }
  const Q = joints[3];
  const net = vecToScreen(cam, acc.net[0], acc.net[1], k);

  // Lanes: when every visible leg lies within a few degrees of one line
  // (always true on the Sun-Earth axis) the legs would sit on top of each
  // other, so shift each one sideways into its own lane.
  // Only on the axis: elsewhere (e.g. L4 at a tiny mass, where the Sun pull
  // and the spin push nearly overlap) a sideways lane would draw the closed
  // loop as open. There the dashed spin push simply runs over the Sun pull.
  let laneWeight = 0;
  let normal = [0, -1];
  const onAxis = Math.abs(probe[1]) * s < 3;
  const ref = vecs.find((v) => Math.hypot(v[0], v[1]) > 2);
  if (ref && morph > 0 && onAxis) {
    let maxDev = 0;
    for (const v of vecs) {
      if (Math.hypot(v[0], v[1]) <= 2) continue;
      maxDev = Math.max(maxDev, lineDeviation(ref, v));
    }
    const deg = (maxDev * 180) / Math.PI;
    laneWeight = smoothstep(6, 2, deg) * morph;
    const rl = Math.hypot(ref[0], ref[1]);
    normal = [-ref[1] / rl, ref[0] / rl];
    // Stack lanes upwards on screen (or leftwards for a vertical axis),
    // judged in the un-turned view so they do not flip while the view spins.
    const cs = Math.cos(cam.spin || 0);
    const sn = Math.sin(cam.spin || 0);
    const n0x = normal[0] * cs - normal[1] * sn;
    const n0y = normal[0] * sn + normal[1] * cs;
    if (n0y > 1e-6 || (Math.abs(n0y) <= 1e-6 && n0x > 0)) {
      normal = [-normal[0], -normal[1]];
    }
  }

  const legs = LEG_KEYS.map((key, i) => {
    const off = laneWeight * i * laneGap;
    const shift = [normal[0] * off, normal[1] * off];
    const chainStart = joints[i];
    const start = [
      P[0] + (chainStart[0] - P[0]) * morph + shift[0],
      P[1] + (chainStart[1] - P[1]) * morph + shift[1],
    ];
    const end = [start[0] + vecs[i][0], start[1] + vecs[i][1]];
    return { key, start, end, vec: vecs[i], length: Math.hypot(vecs[i][0], vecs[i][1]), lane: i };
  });

  // The leftover gets its own lane on the other side (lane -1), so on the
  // axis it never hides the Sun pull that starts at the probe too.
  const netOff = -laneWeight * laneGap;
  const netStart = [P[0] + normal[0] * netOff, P[1] + normal[1] * netOff];
  const netEnd = [netStart[0] + net[0], netStart[1] + net[1]];

  // Dotted connectors that show where a shifted leg really continues.
  const connectors = [];
  if (laneWeight > 0.01) {
    for (let i = 0; i < 2; i += 1) {
      connectors.push([legs[i].end, legs[i + 1].start]);
    }
    connectors.push([legs[2].end, netEnd]);
  }

  const rho = (k * sys.omega2) / s;
  const target = [P[0] + rho * (C[0] - P[0]), P[1] + rho * (C[1] - P[1])];
  const gravityEnd = joints[2];
  const centroid = [
    (joints[0][0] + joints[1][0] + joints[2][0] + joints[3][0]) / 4,
    (joints[0][1] + joints[1][1] + joints[2][1] + joints[3][1]) / 4,
  ];

  return {
    P,
    C,
    Q,
    k,
    rho,
    target,
    gravityEnd,
    joints,
    legs,
    net: { start: netStart, end: netEnd, length: Math.hypot(net[0], net[1]) },
    connectors,
    laneWeight,
    laneNormal: normal,
    centroid,
    morph,
  };
}
