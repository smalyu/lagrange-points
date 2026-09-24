// Circular restricted three-body problem in the co-rotating frame.
//
// Normalized units: G = 1, Sun-Earth separation a = 1, Sun mass = 1,
// Earth mass = q (so the mass ratio "Earth / Sun" is q). The frame origin
// sits on the Sun, Earth is at (1, 0) and the centre of mass (CM) at (mu, 0)
// with mu = q / (1 + q). The frame spins at omega^2 = G (M_sun + M_earth) / a^3
// = 1 + q, so one orbital period is 2 pi / omega.
//
// Everything here is pure math: no DOM, importable from Node for tests.

export const SQRT3_2 = Math.sqrt(3) / 2;

/** Gascheau / Routh: L4 and L5 are linearly stable only for mu below this. */
export const ROUTH_MU = (1 - Math.sqrt(23 / 27)) / 2;

export const L_NAMES = ["L1", "L2", "L3", "L4", "L5"];

const SINGULARITY_EPS = 1e-15;

export function muFromRatio(q) {
  return q / (1 + q);
}

export function ratioFromMu(mu) {
  return mu / (1 - mu);
}

/** Build everything that depends only on the mass ratio. */
export function makeSystem(q) {
  const mu = muFromRatio(q);
  const omega2 = 1 + q;
  const system = {
    q,
    mu,
    mSun: 1,
    mEarth: q,
    omega2,
    omega: Math.sqrt(omega2),
    period: (2 * Math.PI) / Math.sqrt(omega2),
    sun: [0, 0],
    earth: [1, 0],
    cm: [mu, 0],
    lPoints: null,
  };
  system.lPoints = lagrangePoints(system);
  return system;
}

function gravity(mass, dx, dy) {
  const r2 = Math.max(dx * dx + dy * dy, SINGULARITY_EPS);
  const r = Math.sqrt(r2);
  const k = -mass / (r2 * r);
  return [k * dx, k * dy];
}

/**
 * Acceleration felt by a test particle at rest in the rotating frame.
 * Returns each term separately plus useful combinations.
 */
export function accelerations(system, x, y) {
  const sun = gravity(system.mSun, x - system.sun[0], y - system.sun[1]);
  const earth = gravity(system.mEarth, x - system.earth[0], y - system.earth[1]);
  const cf = [system.omega2 * (x - system.cm[0]), system.omega2 * (y - system.cm[1])];
  const gravitySum = [sun[0] + earth[0], sun[1] + earth[1]];
  const net = [gravitySum[0] + cf[0], gravitySum[1] + cf[1]];
  return {
    sun,
    earth,
    cf,
    gravity: gravitySum,
    net,
    dSun: Math.hypot(x - system.sun[0], y - system.sun[1]),
    dEarth: Math.hypot(x - system.earth[0], y - system.earth[1]),
    dCm: Math.hypot(x - system.cm[0], y - system.cm[1]),
  };
}

export function len(v) {
  return Math.hypot(v[0], v[1]);
}

/**
 * Dimensionless imbalance in [0, 1]: |net| divided by the total "effort"
 * of the three pulls. 0 means the three arrows close into a triangle.
 */
export function imbalance(acc) {
  const effort = len(acc.sun) + len(acc.earth) + len(acc.cf);
  if (!(effort > 0)) return 1;
  return Math.min(1, len(acc.net) / effort);
}

/**
 * Effective potential Phi = -m1/r1 - m2/r2 - omega^2 rho^2 / 2 (rho measured
 * from CM). The net acceleration of a particle at rest is -grad(Phi).
 */
export function effectivePotential(system, x, y) {
  const r1 = Math.max(Math.hypot(x - system.sun[0], y - system.sun[1]), 1e-9);
  const r2 = Math.max(Math.hypot(x - system.earth[0], y - system.earth[1]), 1e-9);
  const dx = x - system.cm[0];
  const dy = y - system.cm[1];
  return -system.mSun / r1 - system.mEarth / r2 - 0.5 * system.omega2 * (dx * dx + dy * dy);
}

/** x-component of the net acceleration on the Sun-Earth line (y = 0). */
export function axisNetX(system, x) {
  const r1 = x - system.sun[0];
  const r2 = x - system.earth[0];
  // The clamp only guards exact hits on a body; root brackets stay well
  // above it so tiny mass ratios keep their true near-body sign.
  const t1 = (system.mSun * r1) / Math.max(Math.abs(r1) ** 3, 1e-45);
  const t2 = (system.mEarth * r2) / Math.max(Math.abs(r2) ** 3, 1e-45);
  return system.omega2 * (x - system.cm[0]) - t1 - t2;
}

function bisect(f, lo, hi, iterations = 200) {
  let flo = f(lo);
  const fhi = f(hi);
  if (flo === 0) return lo;
  if (fhi === 0) return hi;
  if (flo * fhi > 0) return null;
  for (let i = 0; i < iterations; i += 1) {
    const mid = 0.5 * (lo + hi);
    if (mid === lo || mid === hi) break;
    const fm = f(mid);
    if (fm === 0) return mid;
    if (flo * fm < 0) {
      hi = mid;
    } else {
      lo = mid;
      flo = fm;
    }
  }
  return 0.5 * (lo + hi);
}

/**
 * The five equilibria. The collinear ones are the zeros of axisNetX in the
 * three intervals separated by the bodies; L4/L5 close the equilateral
 * triangles on the Sun-Earth segment, for every mass ratio.
 */
export function lagrangePoints(system) {
  const f = (x) => axisNetX(system, x);
  const xs = system.sun[0];
  const xe = system.earth[0];
  // Tiny offsets keep the brackets off the singularities; the Hill radius
  // (mu/3)^(1/3) >= ~0.007 for the smallest ratio we allow, far above them.
  const eps = 1e-9;
  const l1 = bisect(f, xs + eps, xe - eps);
  const l2 = bisect(f, xe + eps, xe + 2);
  const l3 = bisect(f, xs - 2, xs - eps);
  return {
    L1: [l1, 0],
    L2: [l2, 0],
    L3: [l3, 0],
    L4: [0.5, SQRT3_2],
    L5: [0.5, -SQRT3_2],
  };
}

/** Approximate L1/L2 distance from Earth for small mu (Hill radius). */
export function hillRadius(system) {
  return Math.cbrt(system.mu / 3);
}

/** Nearest Lagrange point to (x, y). */
export function nearestLPoint(system, x, y) {
  let best = null;
  let bestDist = Infinity;
  for (const name of L_NAMES) {
    const p = system.lPoints[name];
    const d = Math.hypot(x - p[0], y - p[1]);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return { name: best, distance: bestDist };
}

// ---------------------------------------------------------------------------
// Released-particle dynamics (adds the Coriolis term, which vanishes for a
// particle at rest and therefore never appears in the static arrows).
//   x'' =  2 omega y' + a_x
//   y'' = -2 omega x' + a_y
// where (a_x, a_y) is the static net acceleration from accelerations().

function derivatives(system, s, out) {
  const acc = accelerations(system, s[0], s[1]);
  const w2 = 2 * system.omega;
  out[0] = s[2];
  out[1] = s[3];
  out[2] = acc.net[0] + w2 * s[3];
  out[3] = acc.net[1] - w2 * s[2];
  return out;
}

const k1 = [0, 0, 0, 0];
const k2 = [0, 0, 0, 0];
const k3 = [0, 0, 0, 0];
const k4 = [0, 0, 0, 0];
const tmp = [0, 0, 0, 0];

/** One classical RK4 step, in place on s = [x, y, vx, vy]. */
export function rk4Step(system, s, dt) {
  derivatives(system, s, k1);
  for (let i = 0; i < 4; i += 1) tmp[i] = s[i] + 0.5 * dt * k1[i];
  derivatives(system, tmp, k2);
  for (let i = 0; i < 4; i += 1) tmp[i] = s[i] + 0.5 * dt * k2[i];
  derivatives(system, tmp, k3);
  for (let i = 0; i < 4; i += 1) tmp[i] = s[i] + dt * k3[i];
  derivatives(system, tmp, k4);
  for (let i = 0; i < 4; i += 1) {
    s[i] += (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
  }
  return s;
}

/** Step size that shrinks near either body so close passes stay accurate. */
export function adaptiveDt(system, s, maxDt = 0.004) {
  const r1 = Math.hypot(s[0] - system.sun[0], s[1] - system.sun[1]);
  const r2 = Math.hypot(s[0] - system.earth[0], s[1] - system.earth[1]);
  const t1 = r1 ** 1.5 / Math.sqrt(system.mSun);
  const t2 = system.mEarth > 0 ? r2 ** 1.5 / Math.sqrt(system.mEarth) : Infinity;
  return Math.max(1e-6, Math.min(maxDt, 0.02 * Math.min(t1, t2)));
}

/**
 * Advance a released particle by `duration` model time units.
 * Returns "ok", "hitSun", "hitEarth" or "escaped".
 * `onSample(x, y)` is called roughly every `sampleEvery` time units.
 */
export function advance(system, s, duration, opts = {}) {
  const sunRadius = opts.sunRadius ?? 0.02;
  const earthRadius = opts.earthRadius ?? 0.005;
  const escapeRadius = opts.escapeRadius ?? 6;
  const sampleEvery = opts.sampleEvery ?? 0.02;
  const onSample = opts.onSample;
  let t = 0;
  let sinceSample = 0;
  let guard = 0;
  while (t < duration && guard < 200000) {
    guard += 1;
    const dt = Math.min(adaptiveDt(system, s), duration - t);
    rk4Step(system, s, dt);
    t += dt;
    sinceSample += dt;
    if (onSample && sinceSample >= sampleEvery) {
      sinceSample = 0;
      onSample(s[0], s[1]);
    }
    const r1 = Math.hypot(s[0] - system.sun[0], s[1] - system.sun[1]);
    if (r1 < sunRadius) return "hitSun";
    const r2 = Math.hypot(s[0] - system.earth[0], s[1] - system.earth[1]);
    if (r2 < earthRadius) return "hitEarth";
    if (Math.hypot(s[0] - system.cm[0], s[1] - system.cm[1]) > escapeRadius) {
      return "escaped";
    }
  }
  return "ok";
}

/** Jacobi constant C = -2 Phi - v^2; conserved along released trajectories. */
export function jacobiConstant(system, s) {
  return -2 * effectivePotential(system, s[0], s[1]) - (s[2] * s[2] + s[3] * s[3]);
}

// ---------------------------------------------------------------------------
// Real-world units, for readers who want numbers. The model is scaled to one
// astronomical unit and one solar mass; the "Earth" mass follows the slider.

export const SI = (() => {
  const G = 6.6743e-11;
  const massSun = 1.98847e30;
  const au = 149597870700;
  const time = Math.sqrt(au ** 3 / (G * massSun));
  return {
    G,
    massSun,
    au,
    time,
    speed: au / time,
    accel: au / time ** 2,
    year: 2 * Math.PI * time,
  };
})();
