// Feature "release": let the probe go and watch it move.
//
// Until now the probe was held still, so only three pulls acted on it. Once
// it moves, a fourth one appears: the Coriolis push, sideways to the motion
// (x'' = net_x + 2 omega y', y'' = net_y - 2 omega x'). This module owns the
// simulation (pure helpers at the top, testable in Node) and the live view:
// the moving probe, its fading trail, the white leftover and the teal
// Coriolis arrow, and the "Orbit 2.4" status line.
//
// app.release = { start({nudge, maxOrbits}), stop(reason), running(), info() }
// Events: "releasestart", "releaseleave", "releasesettled", "releaseend".

import { defineStrings, fmtNumber, plural } from "../i18n.js";
import { t as coreT } from "../strings.js";
import { L_NAMES, ROUTH_MU, accelerations, adaptiveDt, rk4Step } from "../physics.js";
import { vecToScreen, worldToScreen } from "../camera.js";
import { COLORS, alpha, font } from "../theme.js";
import { arrow, label, rectsOverlap, smoothstep } from "../draw.js";

// ---------------------------------------------------------------------------
// Pure simulation helpers (no DOM).

/** Physical radii, in units of the Sun-Earth distance a. */
export const SUN_RADIUS = 0.00465;
export const ESCAPE_RADIUS = 4;
/** Runs end after this many orbits unless something else happens first. */
export const RUN_ORBITS = 40;
/** Around a stable L4/L5 a run lasts this many libration periods instead. */
export const RUN_LIBRATIONS = 3;
/** ...and counts as "settled" once it has come back after half a period. */
export const SETTLE_LIBRATIONS = 0.5;
export const MAX_STEPS_PER_FRAME = 4000;

/** "Earth" radius at mass ratio q: constant density, so it grows as q^(1/3). */
export function earthRadius(q) {
  return Math.max(1e-6, 4.26e-5 * Math.cbrt(q / 3.003e-6));
}

/** The tiny push: 0.005 a, smaller for light planets so L4 stays a tadpole. */
export function nudgeSize(mu) {
  return Math.min(0.005, 0.3 * Math.sqrt(mu));
}

/** L4/L5 libration period in orbits (Infinity above Routh's limit). */
export function librationOrbits(mu) {
  if (!(mu < ROUTH_MU)) return Infinity;
  const inner = 1 - 27 * mu * (1 - mu);
  return 1 / Math.sqrt((1 - Math.sqrt(inner)) / 2);
}

/** Is `start` near L4 or L5 (where the long, slow libration lives)? */
export function nearTrojan(sys, start) {
  const d4 = Math.hypot(start[0] - sys.lPoints.L4[0], start[1] - sys.lPoints.L4[1]);
  const d5 = Math.hypot(start[0] - sys.lPoints.L5[0], start[1] - sys.lPoints.L5[1]);
  return Math.min(d4, d5) < 0.35;
}

/**
 * Display speed in orbits per second. Around a stable L4/L5 the loop takes
 * one libration period, so play one period in about 13 s; elsewhere 0.5.
 */
export function displaySpeed(sys, start) {
  if (sys.mu < ROUTH_MU && nearTrojan(sys, start)) {
    return Math.min(40, Math.max(0.25, librationOrbits(sys.mu) / 13));
  }
  return 0.5;
}

/** How far the probe may wander before we say it has left its start. */
export function leaveRadius(sys, start) {
  const dS = Math.hypot(start[0] - sys.sun[0], start[1] - sys.sun[1]);
  const dE = Math.hypot(start[0] - sys.earth[0], start[1] - sys.earth[1]);
  return Math.min(0.6, 0.6 * Math.min(dS, dE));
}

/** Initial state: at rest at `start`, pushed `nudge` straight away from the Sun. */
export function releaseState(sys, start, nudge) {
  let dx = start[0] - sys.sun[0];
  let dy = start[1] - sys.sun[1];
  let r = Math.hypot(dx, dy);
  if (r < 1e-12) {
    dx = 1;
    dy = 0;
    r = 1;
  }
  return [start[0] + (nudge * dx) / r, start[1] + (nudge * dy) / r, 0, 0];
}

/** Resolve "L4" or [x, y] to a point. */
function resolveStart(sys, start) {
  if (typeof start === "string") return [...sys.lPoints[start]];
  return [start[0], start[1]];
}

/**
 * A deterministic run. step() takes one adaptive RK4 step and returns the
 * outcome once there is one: "escaped", "hitSun", "hitEarth", or at the time
 * limit "stable" (stayed near the start) / "wandering" (left but survived).
 */
export function createRun(sys, startIn, opts = {}) {
  const start = resolveStart(sys, startIn);
  const nudge = opts.nudge ?? nudgeSize(sys.mu);
  const trojan = nearTrojan(sys, start);
  const libOrbits = trojan ? librationOrbits(sys.mu) : Infinity;
  const maxOrbits = opts.maxOrbits ?? (Number.isFinite(libOrbits) ? RUN_LIBRATIONS * libOrbits : RUN_ORBITS);
  const run = {
    sys,
    start,
    nudge,
    trojan,
    libOrbits,
    maxOrbits,
    leaveR: leaveRadius(sys, start),
    earthR: earthRadius(sys.q),
    maxDt: opts.maxDt ?? 0.004,
    s: releaseState(sys, start, nudge),
    t: 0,
    steps: 0,
    dist: nudge,
    maxDist: nudge,
    leftAt: null, // orbits when it first went farther than leaveR
    crossed: false, // crossed the Sun-Earth line (a trojan start only)
    outcome: null,
    get orbits() {
      return run.t / sys.period;
    },
    /** Would this run count as "stayed near the start" if it ended now? */
    staying() {
      if (run.outcome && run.outcome !== "stable") return false;
      if (run.leftAt === null) return true;
      // A wide tadpole around a stable L4/L5 still counts; above the 4% line
      // (no libration) leaving is leaving.
      return run.trojan && Number.isFinite(run.libOrbits) && !run.crossed;
    },
    step() {
      if (run.outcome) return run.outcome;
      const s = run.s;
      const dt = adaptiveDt(sys, s, run.maxDt);
      const ySign = Math.sign(s[1]);
      rk4Step(sys, s, dt);
      run.t += dt;
      run.steps += 1;
      const d = Math.hypot(s[0] - start[0], s[1] - start[1]);
      run.dist = d;
      if (d > run.maxDist) run.maxDist = d;
      if (run.leftAt === null && d > run.leaveR) run.leftAt = run.orbits;
      if (run.trojan && ySign !== 0 && Math.sign(s[1]) === -ySign) run.crossed = true;
      if (Math.hypot(s[0] - sys.sun[0], s[1] - sys.sun[1]) < SUN_RADIUS) run.outcome = "hitSun";
      else if (Math.hypot(s[0] - sys.earth[0], s[1] - sys.earth[1]) < run.earthR) run.outcome = "hitEarth";
      else if (Math.hypot(s[0] - sys.cm[0], s[1] - sys.cm[1]) > ESCAPE_RADIUS) run.outcome = "escaped";
      else if (run.orbits >= run.maxOrbits) run.outcome = run.staying() ? "stable" : "wandering";
      return run.outcome;
    },
  };
  if (!(nudge >= 0) || !Number.isFinite(start[0]) || !Number.isFinite(start[1])) run.outcome = "stable";
  return run;
}

/**
 * Run to the end (Node-friendly). Returns { outcome, orbits, maxDist, leftAt,
 * libOrbits, samples? }. opts: nudge, maxOrbits, maxSteps, sampleEvery (orbits).
 */
export function simulate(sys, start, opts = {}) {
  const run = createRun(sys, start, opts);
  const maxSteps = opts.maxSteps ?? 5e6;
  const samples = opts.sampleEvery ? [] : null;
  let nextSample = 0;
  while (!run.outcome && run.steps < maxSteps) {
    run.step();
    if (samples && run.orbits >= nextSample) {
      samples.push([run.s[0], run.s[1], run.orbits]);
      nextSample += opts.sampleEvery;
    }
  }
  return {
    outcome: run.outcome ?? "unfinished",
    orbits: run.orbits,
    maxDist: run.maxDist,
    leftAt: run.leftAt,
    libOrbits: run.libOrbits,
    samples,
  };
}

/**
 * Largest leftover or Coriolis magnitude while the probe is still near its
 * start, found by a quick look-ahead. It fixes one arrow scale per run so
 * the arrows are readable at any mass and never change scale mid-flight.
 */
export function arrowReference(sys, start, opts = {}) {
  const run = createRun(sys, start, { ...opts, maxDt: 0.02 });
  const horizon = Number.isFinite(run.libOrbits) ? 1.1 * run.libOrbits : 6;
  const budget = opts.budget ?? 30000;
  let ref = 0;
  while (!run.outcome && run.steps < budget && run.orbits < horizon) {
    run.step();
    // Scale to the first quarter of the way out: arrows are readable from the
    // start, and later growth is capped (same factor for both arrows).
    if (run.dist > 0.25 * run.leaveR || run.steps % 3) continue;
    const acc = accelerations(sys, run.s[0], run.s[1]);
    const net = Math.hypot(acc.net[0], acc.net[1]);
    const cor = 2 * sys.omega * Math.hypot(run.s[2], run.s[3]);
    ref = Math.max(ref, net, cor);
  }
  return ref;
}

/** Nearest Lagrange point within `tol` (world units) of p, or null. */
export function pointAt(sys, p, tol = 1e-6) {
  for (const name of L_NAMES) {
    const L = sys.lPoints[name];
    if (Math.hypot(L[0] - p[0], L[1] - p[1]) <= tol) return name;
  }
  return null;
}

export const RELEASE_STRINGS = {
  en: {
    orbits: ({ v }) => plural(v, { one: "{n} orbit", other: "{n} orbits" }),
    orbitsAfter: ({ v }) => plural(v, { one: "after {n} orbit", other: "after {n} orbits" }),
    straightAway: "straight away",
    escaped: "Flew off {when}.",
    hitSun: "Fell into the Sun {when}.",
    hitEarth: "Crashed into Earth {when}.",
    stable: "Still circling {point} after {orbits}.",
    stableStart: "Still near its start after {orbits}.",
    wandering: "Wandered off from {point} and never came back.",
    wanderingFree: "Wandered off and never came back.",
    caught: "Caught after {orbits}.",
    stopped: "Stopped.",
    status: "Orbit {n}",
    coriolis: "Coriolis — only when moving",
  },
  ru: {
    orbits: ({ v }) => plural(v, { one: "{n} оборот", few: "{n} оборота", many: "{n} оборотов", other: "{n} оборота" }),
    orbitsAfter: ({ v }) =>
      plural(v, { one: "через {n} оборот", few: "через {n} оборота", many: "через {n} оборотов", other: "через {n} оборота" }),
    straightAway: "сразу же",
    escaped: "Улетел {when}.",
    hitSun: "Упал на Солнце {when}.",
    hitEarth: "Врезался в Землю {when}.",
    stable: "Всё ещё кружит около {point} спустя {orbits}.",
    stableStart: "Всё ещё рядом со стартом спустя {orbits}.",
    wandering: "Ушёл от {point} и больше не вернулся.",
    wanderingFree: "Ушёл и больше не вернулся.",
    caught: "Пойман через {orbits}.",
    stopped: "Остановлено.",
    status: "Оборот {n}",
    coriolis: "Кориолис — только в движении",
  },
};
const tr = defineStrings(RELEASE_STRINGS);

function roundOrbits(n) {
  return n >= 10 ? Math.round(n) : Math.round(n * 10) / 10;
}

/** "3.1 orbits", "1 orbit", "0.4 orbits" (localized, with plurals). */
export function formatOrbits(n) {
  return tr("orbits", { v: roundOrbits(n) });
}

/** Short plain-language summary of an outcome. */
export function describeOutcome(outcome, orbits, point) {
  const when = orbits < 0.05 ? tr("straightAway") : tr("orbitsAfter", { v: roundOrbits(orbits) });
  switch (outcome) {
    case "escaped":
      return tr("escaped", { when });
    case "hitSun":
      return tr("hitSun", { when });
    case "hitEarth":
      return tr("hitEarth", { when });
    case "stable":
      return point ? tr("stable", { point, orbits: formatOrbits(orbits) }) : tr("stableStart", { orbits: formatOrbits(orbits) });
    case "wandering":
      return point ? tr("wandering", { point }) : tr("wanderingFree");
    case "caught":
      return tr("caught", { orbits: formatOrbits(orbits) });
    default:
      return tr("stopped");
  }
}

// ---------------------------------------------------------------------------
// Live view.

// The static chain is hidden while the probe flies: the live leftover and
// Coriolis arrows use their own display scale, and a faint chain at another
// scale next to them would suggest they should close up with it.
const RUN_CHAIN_ALPHA = 0;
const FADE_IN_MS = 250;
const END_PAUSE_MS = 650;
const TRAIL_ALPHA = 0.35;
const RELEASE_CHAPTERS = new Set(["letgo", "explore"]);
const CATCH_REASONS = new Set(["catch", "space", "escape", "chip"]);
/**
 * Above this display speed (orbits per second) a frame skips a large part of
 * the one-orbit wiggle, so the live arrows would strobe: they are not drawn.
 */
export const LIVE_ARROWS_MAX_SPEED = 3;
/** While following a runaway probe the camera zooms out to at most this factor. */
const FOLLOW_MIN_ZOOM = 0.45;

export function install(app) {
  const state = app.state;
  let run = null; // live run wrapper
  let ending = null; // { until, info, returnTo, point, self } during the pause after an impact
  let fadeStart = -1; // static chain fading back in
  let ownCamera = false; // true while we move the camera ourselves
  const trail = { pts: [], window: 3, end: 0, fadeStart: -1, visible: false };

  // ---- helpers ------------------------------------------------------------
  function viewContains(p, margin = 0, cam = app.cam) {
    const [sx, sy] = worldToScreen(cam, p[0], p[1]);
    const v = cam.view;
    return (
      sx >= v.left + margin &&
      sx <= v.left + v.width - margin &&
      sy >= v.top + margin &&
      sy <= v.top + v.height - margin
    );
  }

  /** Is the probe (in screen px) inside the visible canvas area? */
  function probeVisible(f) {
    const [px, py] = f.chain.P;
    const v = f.cam.view;
    return px >= v.left && px <= v.left + v.width && py >= v.top && py <= v.top + v.height;
  }

  function displayK(sys, start, nudge) {
    const ref = arrowReference(sys, start, { nudge });
    const target = app.size.phone ? 72 : 90;
    const kNat = app.cam.baseScale / sys.omega2;
    if (!(ref > 0)) return kNat;
    return Math.min(40 * kNat, Math.max(0.05 * kNat, target / ref));
  }

  // ---- camera: zoom out to keep a runaway probe in sight, then come back ------------
  function cameraSnapshot() {
    const cam = app.cam;
    const to = cam.flight?.to;
    return {
      center: [...(to ? to.center : cam.center)],
      zoom: to ? to.zoom : cam.zoom,
      base: cam.baseScale,
      userZoomed: app.userZoomed,
    };
  }

  /** The camera the run started with (adjusted for any resize since). */
  function homeCam(self) {
    const c0 = self.cam0;
    const zoom = c0.userZoomed ? Math.max(0.35, (c0.zoom * c0.base) / app.cam.baseScale) : 1;
    return { ...app.cam, center: c0.center, zoom, flight: null };
  }

  function emitCamera() {
    ownCamera = true;
    try {
      app.emit("camera");
    } finally {
      ownCamera = false;
    }
  }

  function followProbe(self, dtMs) {
    const cam = app.cam;
    if (self.camTaken || cam.flight || cam.spin) return;
    const [sx, sy] = app.toScreen(self.core.s[0], self.core.s[1]);
    const v = cam.view;
    const hx = v.width / 2;
    const hy = v.height / 2;
    // Only a probe about to leave the view counts: a loop that stays in
    // sight keeps the camera still.
    const margin = app.size.phone ? 30 : 40;
    const mx = Math.min(0.5 * hx, margin);
    const my = Math.min(0.5 * hy, margin);
    const need = Math.max(Math.abs(sx - v.left - hx) / (hx - mx), Math.abs(sy - v.top - hy) / (hy - my));
    if (!(need > 1)) return;
    // Phone portrait is narrow across the orbit: allow a little more zoom-out.
    const floor = Math.max(0.3, homeCam(self).zoom * (app.cam.rot ? 0.34 : FOLLOW_MIN_ZOOM));
    const target = Math.max(floor, cam.zoom / need);
    if (!(target < cam.zoom * 0.999)) return;
    const k = app.reducedMotion ? 1 : 1 - Math.exp(-Math.max(0, dtMs) / 140);
    cam.zoom = Math.exp(Math.log(cam.zoom) + (Math.log(target) - Math.log(cam.zoom)) * k);
    self.zoomedOut = true;
    emitCamera();
  }

  function restoreCamera(self, animate = true) {
    if (!self || !self.zoomedOut || self.camTaken) return;
    self.zoomedOut = false;
    const home = homeCam(self);
    ownCamera = true;
    try {
      if (self.cam0.userZoomed) app.flyTo(home.center, home.zoom, animate ? 600 : 0);
      else app.fitView({ animate });
    } finally {
      ownCamera = false;
    }
  }

  function clearTrail(animate = true) {
    if (!trail.visible) return;
    if (!animate || app.reducedMotion) {
      trail.visible = false;
      trail.pts = [];
      app.invalidate();
      return;
    }
    if (trail.fadeStart >= 0) return;
    trail.fadeStart = performance.now();
    app.animate((now) => {
      if (trail.fadeStart < 0) return false;
      if (now - trail.fadeStart >= 300) {
        trail.visible = false;
        trail.pts = [];
        trail.fadeStart = -1;
        return false;
      }
      return true;
    });
  }

  function fadeChainIn() {
    if (app.reducedMotion) {
      fadeStart = -1;
      app.invalidate();
      return;
    }
    fadeStart = performance.now();
    app.animate((now) => now - fadeStart < FADE_IN_MS + 20);
  }

  // ---- start / stop ---------------------------------------------------------
  function start(opts = {}) {
    if (run) return false;
    if (ending) finishEnding();
    app.story?.stopSweep?.();
    // Land any running probe ease first, so we start where the probe is headed.
    if (app.probeEase) {
      state.probe = [...app.probeEase.to];
      app.probeEase = null;
    }
    const sys = app.sys();
    const startP = [...state.probe];
    const point = state.snap?.name ?? pointAt(sys, startP, 1e-9);
    const nudge = opts.nudge ?? nudgeSize(sys.mu);
    const core = createRun(sys, startP, { nudge, maxOrbits: opts.maxOrbits });
    app.unsnap("release");
    state.busy = "release";
    fadeStart = -1;
    trail.pts = [[core.s[0], core.s[1], 0]];
    trail.window = core.trojan && Number.isFinite(core.libOrbits) ? Math.max(3, core.libOrbits) : 3;
    trail.end = 0;
    trail.fadeStart = -1;
    trail.visible = true;
    const speed = displaySpeed(sys, startP);
    run = {
      core,
      sys,
      point,
      start: startP,
      speed,
      // Too fast to follow the one-orbit wiggle: the arrows would strobe.
      arrows: speed <= LIVE_ARROWS_MAX_SPEED,
      // L1-L3 are left within a fraction of an orbit: play the departure in
      // slow motion, then speed up once the probe is clearly on its way.
      slowStart: point === "L1" || point === "L2" || point === "L3",
      k: displayK(sys, startP, nudge),
      last: null,
      leaveSent: false,
      settleSent: false,
      cam0: cameraSnapshot(),
      zoomedOut: false,
      camTaken: false,
    };
    app.setProbe(core.s[0], core.s[1], { source: "release" });
    app.ui?.announce?.("Released with a tiny push.", { force: true });
    app.emit("releasestart", { point, start: startP, nudge, speed, arrows: run.arrows, libOrbits: core.libOrbits });
    const self = run;
    app.animate((now) => tick(self, now));
    return true;
  }

  function tick(self, now) {
    if (run !== self) return false;
    if (app.probeEase) {
      // Someone else is moving the probe (a jump, a reset): let them.
      stop("moved");
      return false;
    }
    if (self.last === null) {
      self.last = now;
      return true;
    }
    const dtMs = Math.min(50, Math.max(0, now - self.last));
    self.last = now;
    const core = self.core;
    const sys = self.sys;
    // Slow motion lasts until the probe is on its way, or at most ~3 orbits
    // (near a light planet L3 barely moves in that time).
    const ramp = self.slowStart
      ? 0.3 + 0.7 * Math.max(smoothstep(0, 1, core.maxDist / core.leaveR), smoothstep(1, 3, core.orbits))
      : 1;
    const target = core.t + (self.speed * ramp * sys.period * dtMs) / 1000;
    const minGap = 1.2 / Math.max(1, app.scale());
    let n = 0;
    let lastPt = trail.pts[trail.pts.length - 1];
    while (!core.outcome && core.t < target && n < MAX_STEPS_PER_FRAME) {
      core.step();
      n += 1;
      if (!lastPt || Math.hypot(core.s[0] - lastPt[0], core.s[1] - lastPt[1]) > minGap) {
        lastPt = [core.s[0], core.s[1], core.orbits];
        trail.pts.push(lastPt);
      }
    }
    const tail = [core.s[0], core.s[1], core.orbits];
    trail.end = core.orbits;
    trimTrail();
    app.setProbe(core.s[0], core.s[1], { source: "release" });
    if (run !== self) return false; // a listener stopped us
    followProbe(self, dtMs);

    if (!self.leaveSent && core.leftAt !== null) {
      self.leaveSent = true;
      app.emit("releaseleave", { orbits: core.leftAt, point: self.point });
    }
    if (
      !self.settleSent &&
      core.trojan &&
      Number.isFinite(core.libOrbits) &&
      core.orbits >= SETTLE_LIBRATIONS * core.libOrbits &&
      core.staying()
    ) {
      self.settleSent = true;
      app.emit("releasesettled", { orbits: core.orbits, point: self.point });
    }
    if (run !== self) return false;
    if (core.outcome) {
      trail.pts.push(tail);
      finish(core.outcome);
      return false;
    }
    return true;
  }

  function trimTrail() {
    const cut = trail.end - trail.window;
    let i = 0;
    while (i < trail.pts.length - 2 && trail.pts[i][2] < cut) i += 1;
    if (i > 0) trail.pts.splice(0, i);
    if (trail.pts.length > 12000) trail.pts.splice(0, trail.pts.length - 12000);
  }

  function infoOf(self, outcome, reason) {
    return {
      outcome,
      orbits: self.core.orbits,
      reason: reason ?? null,
      point: self.point,
      start: self.start,
      left: self.core.leftAt !== null,
      leftAt: self.core.leftAt,
      maxDist: self.core.maxDist,
      staying: self.core.staying(),
      q: self.sys.q,
    };
  }

  function finish(outcome, reason, { immediate = false } = {}) {
    const self = run;
    if (!self) return;
    run = null;
    const info = infoOf(self, outcome, reason);
    const natural = reason == null;
    const exiting = reason === "chapterexit";
    const impact =
      outcome === "escaped" || outcome === "hitSun" || outcome === "hitEarth" || outcome === "wandering";
    // Afterwards the probe goes back to its start: after an impact or any
    // natural end, when leaving the chapter, and whenever it would be out of
    // sight once the camera is back. A catch keeps it where it was caught; a
    // click or tap puts it under the pointer, and if someone else is moving it
    // (a jump, a reset) it is theirs.
    const keep = reason === "moved" || reason === "reset" || reason === "catch";
    const outOfSight = !viewContains(state.probe, 12, homeCam(self));
    info.returned = !keep && (impact || natural || exiting || outOfSight);
    const returnTo = info.returned ? self.start : null;
    if (impact && !immediate) {
      // Freeze for a beat where it ended, then bring the probe back to the start.
      ending = { until: performance.now() + END_PAUSE_MS, info, returnTo, point: self.point, self };
      app.animate((now) => {
        if (!ending) return false;
        if (now >= ending.until) {
          finishEnding();
          return false;
        }
        return true;
      });
      app.ui?.announce?.(describeOutcome(outcome, info.orbits, self.point), { force: true });
      app.emit("releaseend", info);
      afterEnd(info);
      return;
    }
    // Only clear the flag this module set (a sweep may have started meanwhile).
    if (state.busy === "release") state.busy = null;
    // A click-to-catch lands the probe under the pointer right after this, so
    // the view has to be back in place first (no flight).
    restoreCamera(self, !exiting && reason !== "catch");
    if (returnTo) placeAt(returnTo, self.point, natural ? 400 : 0);
    fadeChainIn();
    app.invalidate();
    if (!exiting) {
      app.ui?.announce?.(describeOutcome(outcome, info.orbits, self.point), { force: true });
    }
    app.emit("releaseend", info);
    afterEnd(info);
  }

  function finishEnding({ animate = true } = {}) {
    const e = ending;
    if (!e) return;
    ending = null;
    if (state.busy === "release") state.busy = null;
    restoreCamera(e.self, animate);
    if (e.returnTo) placeAt(e.returnTo, e.point, 0);
    fadeChainIn();
    app.invalidate();
  }

  function placeAt(p, point, ease = 0) {
    app.probeEase = null;
    if (point && app.sys().lPoints[point]) {
      const L = app.sys().lPoints[point];
      if (Math.hypot(L[0] - p[0], L[1] - p[1]) < 1e-9) {
        app.snapTo(point, { ease, source: "release" });
        if (state.snap) state.snap.credited = true;
        return;
      }
    }
    app.setProbe(p[0], p[1], { ease, source: "release" });
  }

  // Outside the "Let go" chapter nobody narrates, so say the outcome briefly.
  function afterEnd(info) {
    if (state.chapter === "letgo" || info.reason === "chapterexit") return;
    if (info.outcome === "stopped") return;
    app.ui?.toast?.(describeOutcome(info.outcome, info.orbits, info.point), 3200);
  }

  function stop(reason = "stop") {
    if (run) {
      const outcome = CATCH_REASONS.has(reason) ? "caught" : "stopped";
      finish(outcome, reason, { immediate: true });
      return true;
    }
    if (ending) finishEnding({ animate: reason !== "chapterexit" });
    return false;
  }

  app.release = {
    start,
    stop,
    running: () => Boolean(run),
    info: () => (run ? infoOf(run, null, null) : null),
    simulate: (start, opts) => simulate(app.sys(), start, opts),
  };

  app.releaseStatus = () => {
    const o = run ? run.core.orbits : ending ? ending.info.orbits : 0;
    return tr("status", { n: fmtNumber(o, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) });
  };

  // ---- stop triggers ---------------------------------------------------------
  app.on("catch", ({ source } = {}) => {
    if (run) stop(source === "reset" ? "reset" : "catch");
    else if (ending) finishEnding();
  });
  app.on("escape", () => stop("escape"));
  app.on("chapterexit", () => {
    stop("chapterexit");
    if (ending) finishEnding({ animate: false });
    clearTrail(false);
  });
  app.on("key:space", () => {
    if (run) {
      stop("space");
      return;
    }
    if (!RELEASE_CHAPTERS.has(state.chapter)) return;
    // A running sweep gives way (start() stops it); other scripted moments win.
    if (state.busy && state.busy !== "release" && state.busy !== "sweep") return;
    start();
  });
  app.on("mass", () => {
    if (run) stop("mass");
    clearTrail();
  });
  app.on("sweep", ({ running } = {}) => {
    if (running && run) stop("sweep");
  });
  app.on("snap", ({ source } = {}) => {
    if (run && source !== "release") stop("moved");
  });
  app.on("probe", ({ source } = {}) => {
    if (source === "release") return;
    if (run) stop("moved");
    if (!run && trail.visible && source !== "snap" && source !== "letgo") clearTrail();
  });
  // Someone else moved the camera (wheel, pinch, pan, a flight): stop
  // following the probe and leave the view where they put it.
  app.on("camera", () => {
    if (ownCamera) return;
    const self = run ?? ending?.self;
    if (self) self.camTaken = true;
  });

  // ---- frame hook: fade the static chain while the probe flies ------------------
  app.frameHooks.push((frame) => {
    if (run || ending) {
      frame.chainAlpha = Math.min(frame.chainAlpha, RUN_CHAIN_ALPHA);
      frame.hide.ring = true;
      frame.hide.target = true;
      frame.hide.labels = true;
      frame.hide.leftover = true;
      frame.hide.equilateral = true;
      // Arrows from a probe out of sight would only leave stray strokes at
      // the edge (or under the header); the edge chevron points to it instead.
      if (!probeVisible(frame)) {
        frame.hide.chain = true;
        frame.hide.sight = true;
      }
      return;
    }
    if (fadeStart >= 0) {
      const t = (frame.now - fadeStart) / FADE_IN_MS;
      if (t >= 1) fadeStart = -1;
      else frame.chainAlpha = Math.min(frame.chainAlpha, RUN_CHAIN_ALPHA + (1 - RUN_CHAIN_ALPHA) * t);
    }
  });

  // ---- trail ---------------------------------------------------------------------------
  app.addLayer({
    id: "release-trail",
    z: 46,
    visible: () => trail.visible && trail.pts.length > 1,
    draw(ctx, f) {
      const pts = trail.pts;
      const fade = trail.fadeStart >= 0 ? Math.max(0, 1 - (f.now - trail.fadeStart) / 300) : 1;
      if (fade <= 0) return;
      const buckets = 24;
      const w0 = trail.end - trail.window;
      ctx.lineWidth = f.app.size.phone ? 1.5 : 1.75;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      let i = 0;
      for (let b = 0; b < buckets && i < pts.length - 1; b += 1) {
        const hi = w0 + ((b + 1) / buckets) * trail.window;
        const a = TRAIL_ALPHA * ((b + 0.5) / buckets) * fade;
        ctx.strokeStyle = alpha(COLORS.text, a);
        ctx.beginPath();
        let s = app.toScreen(pts[i][0], pts[i][1]);
        ctx.moveTo(s[0], s[1]);
        let drew = false;
        while (i < pts.length - 1 && (pts[i + 1][2] <= hi || b === buckets - 1)) {
          i += 1;
          s = app.toScreen(pts[i][0], pts[i][1]);
          ctx.lineTo(s[0], s[1]);
          drew = true;
        }
        if (drew) ctx.stroke();
      }
    },
  });

  // ---- live arrows -------------------------------------------------------------------
  function dottedArrow(ctx, x0, y0, x1, y1, color, width) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L = Math.hypot(dx, dy);
    if (L < 6) {
      arrow(ctx, x0, y0, x1, y1, { color, width });
      return;
    }
    const ux = dx / L;
    const uy = dy / L;
    const head = Math.min(12, 0.4 * L);
    const hw = Math.tan((25 * Math.PI) / 180) * head;
    const bx = x1 - ux * head;
    const by = y1 - uy * head;
    ctx.save();
    ctx.lineCap = "round";
    ctx.strokeStyle = COLORS.bg;
    ctx.lineWidth = width + 3;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(bx + ux * 1, by + uy * 1);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.strokeStyle = COLORS.bg;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(bx - uy * hw, by + ux * hw);
    ctx.lineTo(bx + uy * hw, by - ux * hw);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
    ctx.restore();
  }

  // Screen rects of the HTML overlay on top of the canvas (status line,
  // legend, notes, buttons), refreshed a few times a second while running.
  const HUD_SELECTOR =
    "#status, #legend li, #legend-note, #numbers, #fit-btn, #toast, #card, #menu-btn, .masthead h1, .masthead .question, #hud .tracker-row";
  let hudCache = { at: -Infinity, rects: [] };
  function hudRects(now) {
    if (now - hudCache.at < 300) return hudCache.rects;
    const rects = [];
    const origin = app.canvas.getBoundingClientRect();
    for (const el of document.querySelectorAll(HUD_SELECTOR)) {
      if (el.closest("[hidden]")) continue;
      const r = el.getBoundingClientRect();
      if (!(r.width > 0 && r.height > 0)) continue;
      rects.push({ x: r.left - origin.left - 4, y: r.top - origin.top - 4, w: r.width + 8, h: r.height + 8 });
    }
    hudCache = { at: now, rects };
    return rects;
  }
  app.on("resize", () => {
    hudCache.at = -Infinity;
  });

  function liveVectors(f) {
    if (!run) return null;
    const sys = f.sys;
    const s = run.core.s;
    const net = f.acc.net;
    const cor = [2 * sys.omega * s[3], -2 * sys.omega * s[2]];
    let k = run.k;
    const cap = f.app.size.phone ? 100 : 120;
    const big = Math.max(Math.hypot(net[0], net[1]), Math.hypot(cor[0], cor[1])) * k;
    if (big > cap) k *= cap / big;
    const P = f.chain.P;
    const n = vecToScreen(f.cam, net[0], net[1], k);
    const c = vecToScreen(f.cam, cor[0], cor[1], k);
    return { P, net: n, cor: c };
  }

  app.addLayer({
    id: "release-arrows",
    z: 92,
    visible: (f) => Boolean(run) && run.arrows && probeVisible(f),
    draw(ctx, f) {
      const v = liveVectors(f);
      if (!v) return;
      const [px, py] = v.P;
      const width = f.app.size.phone ? 2.5 : 3;
      dottedArrow(ctx, px, py, px + v.cor[0], py + v.cor[1], COLORS.coriolis, width);
      arrow(ctx, px, py, px + v.net[0], py + v.net[1], {
        color: COLORS.leftover,
        width: f.app.size.phone ? 3 : 3.5,
      });
    },
  });

  // A small chevron on the edge of the view while the probe is out of sight.
  app.addLayer({
    id: "release-edge",
    z: 122,
    visible: () => Boolean(run),
    draw(ctx, f) {
      const [px, py] = f.chain.P;
      const v = f.cam.view;
      if (px >= v.left && px <= v.left + v.width && py >= v.top && py <= v.top + v.height) return;
      const m = 16;
      const cx = v.left + v.width / 2;
      const cy = v.top + v.height / 2;
      const dx = px - cx;
      const dy = py - cy;
      const t = Math.min(
        (v.width / 2 - m) / Math.max(1e-9, Math.abs(dx)),
        (v.height / 2 - m) / Math.max(1e-9, Math.abs(dy)),
      );
      const ex = cx + dx * t;
      const ey = cy + dy * t;
      const a = Math.atan2(dy, dx);
      const r = 7;
      ctx.save();
      ctx.translate(ex, ey);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.7, -r * 0.8);
      ctx.lineTo(-r * 0.7, r * 0.8);
      ctx.closePath();
      ctx.fillStyle = alpha(COLORS.text, 0.75);
      ctx.strokeStyle = COLORS.bg;
      ctx.lineWidth = 3;
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.fill();
      ctx.restore();
    },
  });

  app.addLayer({
    id: "release-labels",
    z: 121,
    visible: (f) => Boolean(run) && run.arrows && f.state.layers.labels && probeVisible(f),
    draw(ctx, f) {
      const vec = liveVectors(f);
      if (!vec) return;
      const [px, py] = vec.P;
      const ringR = f.app.size.phone ? 17 : 15;
      // Keep clear of the probe, the point and body labels, and the HUD.
      const placed = [
        { x: px - ringR, y: py - ringR, w: 2 * ringR, h: 2 * ringR },
        ...(f.obstacles ?? []),
        ...hudRects(f.now),
      ];
      const shafts = [vec.net, vec.cor];
      const crossesShaft = (r) =>
        shafts.some((v) => {
          for (let i = 1; i <= 10; i += 1) {
            const x = px + (v[0] * i) / 10;
            const y = py + (v[1] * i) / 10;
            if (x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h) return true;
          }
          return false;
        });
      // Labels only where the eye can find them: never under the HUD or the dock.
      const view = f.cam.view;
      const inView = (r) =>
        r.x >= view.left + 4 &&
        r.y >= view.top + 4 &&
        r.x + r.w <= view.left + view.width - 4 &&
        r.y + r.h <= view.top + view.height - 4;
      // No labels for arrows whose probe is out of sight.
      if (!inView({ x: px - 1, y: py - 1, w: 2, h: 2 })) return;
      const items = [
        { vec: vec.net, text: coreT("leg.net"), color: COLORS.leftover },
        { vec: vec.cor, text: tr("coriolis"), color: COLORS.coriolis },
      ];
      ctx.font = font(12, 600);
      for (const item of items) {
        const L = Math.hypot(item.vec[0], item.vec[1]);
        if (L < 18) continue;
        const w = ctx.measureText(item.text).width + 4;
        const h = 18;
        const ux = item.vec[0] / L;
        const uy = item.vec[1] / L;
        // Candidates: just past the tip, then either side of the shaft.
        const tip = 8 + Math.abs(ux) * (w / 2) + Math.abs(uy) * (h / 2);
        const side = 10 + Math.abs(uy) * (w / 2) + Math.abs(ux) * (h / 2);
        const mx = px + item.vec[0] * 0.55;
        const my = py + item.vec[1] * 0.55;
        const candidates = [
          [px + item.vec[0] + ux * tip, py + item.vec[1] + uy * tip],
          [mx - uy * side, my + ux * side],
          [mx + uy * side, my - ux * side],
        ];
        for (const [cx, cy] of candidates) {
          const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
          if (!inView(rect) || placed.some((r) => rectsOverlap(r, rect)) || crossesShaft(rect)) continue;
          placed.push(rect);
          label(ctx, item.text, cx, cy, item.color, { size: 12, weight: 600 });
          break;
        }
      }
    },
  });
}
