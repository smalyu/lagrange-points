// The app context: state, physics cache, camera, render loop, layer registry
// and the small set of actions every module uses (move probe, set mass, snap).

import {
  createCamera,
  fitBox,
  flyTo,
  scaleOf,
  screenToWorld,
  stepCamera,
  worldToScreen,
} from "./camera.js";
import { L_NAMES, accelerations, imbalance, makeSystem } from "./physics.js";
import { buildChain, chainScale } from "./chain.js";
import { createState, saveProgress } from "./state.js";
import { easeOutCubic } from "./draw.js";
import { Q_MAX, Q_MIN } from "./mass.js";

export const SNAP_RADIUS_MOUSE = 14;
export const SNAP_RADIUS_TOUCH = 22;
export const SNAP_RELEASE = 28;
export const SNAP_MAX_SPEED = 250;
export const FOUND_DWELL_MS = 300;

/** World box that frames the whole system at zoom 1 (Sun at 0, Earth at 1). */
export const WORLD_BOX = { minX: -1.12, maxX: 1.78, minY: -1.02, maxY: 1.02 };

export function createApp(canvas) {
  const ctx = canvas.getContext("2d");
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  const app = {
    canvas,
    ctx,
    cam: createCamera(),
    state: createState(),
    size: { w: 1, h: 1, dpr: 1, phone: false, portrait: false, coarse: false },
    reducedMotion: reducedMotionQuery.matches,
    layers: [],
    frameHooks: [],
    tickers: new Set(),
    listeners: new Map(),
    morph: 1, // 0 = fan, 1 = chain
    frame: null,
    lastFrameTime: 0,
    measureView: null, // set by ui.js: returns the visible canvas rect
    probeEase: null,
    userZoomed: false,
  };

  reducedMotionQuery.addEventListener?.("change", (e) => {
    app.reducedMotion = e.matches;
    app.invalidate();
  });

  // --- events -----------------------------------------------------------------
  app.on = (event, fn) => {
    if (!app.listeners.has(event)) app.listeners.set(event, new Set());
    app.listeners.get(event).add(fn);
    return () => app.listeners.get(event)?.delete(fn);
  };
  app.emit = (event, data) => {
    for (const fn of app.listeners.get(event) ?? []) fn(data);
  };

  // --- physics cache ------------------------------------------------------------
  let sysCache = null;
  app.sys = () => {
    if (!sysCache || sysCache.q !== app.state.q) sysCache = makeSystem(app.state.q);
    return sysCache;
  };

  // --- render scheduling --------------------------------------------------------
  let rafPending = false;
  app.invalidate = () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(renderFrame);
  };

  /**
   * Register a per-frame callback fn(now, dt). It keeps running while it
   * returns true. Returns a cancel function.
   */
  app.animate = (fn) => {
    const entry = { fn };
    app.tickers.add(entry);
    app.invalidate();
    return () => {
      app.tickers.delete(entry);
    };
  };

  /** Time-based tween helper: calls step(t in 0..1); resolves when done. */
  app.tween = (duration, step, { ease = easeOutCubic } = {}) =>
    new Promise((resolve) => {
      if (duration <= 0 || app.reducedMotion) {
        step(1);
        app.invalidate();
        resolve(true);
        return;
      }
      let start = null;
      app.animate((now) => {
        if (start === null) start = now;
        const t = Math.min(1, (now - start) / duration);
        step(ease(t));
        if (t >= 1) {
          resolve(true);
          return false;
        }
        return true;
      });
    });

  app.addLayer = (layer) => {
    app.layers.push(layer);
    app.layers.sort((a, b) => a.z - b.z);
    app.invalidate();
    return () => {
      const i = app.layers.indexOf(layer);
      if (i >= 0) app.layers.splice(i, 1);
      app.invalidate();
    };
  };

  function computeFrame(now, dt) {
    const state = app.state;
    const sys = app.sys();
    const probe = state.probe;
    const acc = accelerations(sys, probe[0], probe[1]);
    const b = imbalance(acc);
    const k = chainScale(app.cam, sys, acc);
    const chain = buildChain(app.cam, sys, acc, probe, k, {
      morph: app.morph,
      laneGap: app.size.phone ? 8 : 9,
    });
    const frame = {
      now,
      dt,
      app,
      state,
      sys,
      acc,
      b,
      k,
      chain,
      cam: app.cam,
      w: app.size.w,
      h: app.size.h,
      snapped: state.snap?.name ?? null,
      // Modules may hide or fade core layers (tide view, release, etc.).
      hide: {},
      chainAlpha: 1,
    };
    for (const hook of app.frameHooks) hook(frame);
    return frame;
  }

  function renderFrame(now) {
    rafPending = false;
    const dt = app.lastFrameTime ? Math.min(100, now - app.lastFrameTime) : 16;
    app.lastFrameTime = now;

    let keepGoing = false;
    for (const entry of [...app.tickers]) {
      let more = false;
      try {
        more = entry.fn(now, dt);
      } catch (err) {
        console.error(err);
      }
      if (more) keepGoing = true;
      else app.tickers.delete(entry);
    }
    if (stepProbeEase(now)) keepGoing = true;
    if (stepCamera(app.cam, now)) keepGoing = true;
    checkSnapInvariant();
    if (creditSnap(now)) keepGoing = true;

    const frame = computeFrame(now, dt);
    app.frame = frame;
    const { w, h, dpr } = app.size;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    for (const layer of app.layers) {
      if (layer.visible && !layer.visible(frame)) continue;
      ctx.save();
      try {
        layer.draw(ctx, frame);
      } catch (err) {
        console.error(`layer ${layer.id} failed`, err);
      }
      ctx.restore();
    }
    app.emit("frame", frame);
    if (keepGoing) app.invalidate();
  }

  // --- layout -------------------------------------------------------------------
  app.resize = () => {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);
    const dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const portrait = h > w * 1.15;
    const phone = w <= 600 || (coarse && Math.min(w, h) <= 500);
    app.size = { w, h, dpr, phone, portrait, coarse };
    document.body.classList.toggle("is-phone", phone);
    document.body.classList.toggle("is-portrait", portrait && phone);

    const cam = app.cam;
    const prevBase = cam.baseScale;
    cam.rot = phone && portrait ? 1 : 0;
    cam.view = app.measureView ? app.measureView() : { left: 0, top: 0, width: w, height: h };
    const fit = fitBox(cam, WORLD_BOX, phone ? 10 : 24);
    if (!app.userZoomed) {
      cam.center = fit.center;
      cam.zoom = 1;
      cam.flight = null;
    } else if (prevBase > 0) {
      // Keep the same world scale on screen when the window changes size.
      cam.zoom = Math.max(0.35, (cam.zoom * prevBase) / cam.baseScale);
    }
    app.emit("resize", app.size);
    app.invalidate();
  };

  app.fitView = ({ animate = true } = {}) => {
    const fit = fitBox(app.cam, WORLD_BOX, app.size.phone ? 10 : 24);
    app.userZoomed = false;
    flyTo(app.cam, fit, performance.now(), animate && !app.reducedMotion ? 700 : 0);
    app.emit("camera");
    app.invalidate();
  };

  app.flyTo = (center, zoom, duration = 900) => {
    app.userZoomed = true;
    flyTo(app.cam, { center, zoom }, performance.now(), app.reducedMotion ? 0 : duration);
    app.emit("camera");
    app.invalidate();
  };

  /** Camera centre/zoom that fits a world box into the visible view. */
  app.frameBox = (box, padPx = app.size.phone ? 12 : 28) => {
    const cam = app.cam;
    const v = cam.view;
    const bw = cam.rot ? box.maxY - box.minY : box.maxX - box.minX;
    const bh = cam.rot ? box.maxX - box.minX : box.maxY - box.minY;
    const s = Math.min((v.width - 2 * padPx) / bw, (v.height - 2 * padPx) / bh);
    return { center: [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2], zoom: Math.max(1, s / cam.baseScale) };
  };

  /**
   * A chapter framing its key moment. Not the user's zoom: no "Fit view"
   * button, and a window resize re-fits (chapters re-frame on "resize").
   * Returns false when the box would barely change the view.
   */
  app.showBox = (box, duration = 800) => {
    const target = app.frameBox(box);
    if (target.zoom < 1.08) return false;
    app.flyTo(target.center, target.zoom, duration);
    app.userZoomed = false;
    app.emit("camera");
    return true;
  };

  app.toScreen = (x, y) => worldToScreen(app.cam, x, y);
  app.toWorld = (sx, sy) => screenToWorld(app.cam, sx, sy);
  app.scale = () => scaleOf(app.cam);

  // --- probe ------------------------------------------------------------------
  function stepProbeEase(now) {
    const e = app.probeEase;
    if (!e) return false;
    if (e.start === null) e.start = now;
    const t = Math.min(1, (now - e.start) / e.duration);
    const k = easeOutCubic(t);
    app.state.probe = [e.from[0] + (e.to[0] - e.from[0]) * k, e.from[1] + (e.to[1] - e.from[1]) * k];
    if (t >= 1) {
      app.state.probe = [...e.to];
      app.probeEase = null;
      app.emit("probe", { source: e.source });
      return false;
    }
    app.emit("probe", { source: e.source, easing: true });
    return true;
  }

  /** Move the probe. ease > 0 animates (ms); retargets a running ease. */
  app.setProbe = (x, y, { ease = 0, source = "api" } = {}) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (app.state.midline && source !== "release") x = 0.5;
    if (ease > 0 && !app.reducedMotion) {
      app.probeEase = { from: [...app.state.probe], to: [x, y], start: null, duration: ease, source };
    } else if (app.probeEase) {
      app.probeEase.to = [x, y];
    } else {
      app.state.probe = [x, y];
      app.emit("probe", { source });
    }
    app.invalidate();
  };

  // --- constraints -------------------------------------------------------------
  // Functions ([x, y], opts) -> [x, y] applied to every cursor position
  // (pointer, touch, keys) before snapping, e.g. "walk along the axis".
  app.constraints = [];
  app.addConstraint = (fn) => {
    app.constraints.push(fn);
    return () => {
      const i = app.constraints.indexOf(fn);
      if (i >= 0) app.constraints.splice(i, 1);
    };
  };

  // --- snapping -----------------------------------------------------------------
  app.snapRadius = (pointerType) =>
    pointerType === "touch" || app.size.coarse ? SNAP_RADIUS_TOUCH : SNAP_RADIUS_MOUSE;

  app.snapTo = (name, { ease = 120, credit = false, source = "snap" } = {}) => {
    const sys = app.sys();
    const p = sys.lPoints[name];
    // The midline lock would clamp the probe off an L1-L3 target and leave a
    // false "Balanced": going to a point off the midline releases the lock.
    if (app.state.midline && Math.abs(p[0] - 0.5) > 1e-9) {
      app.state.midline = false;
      app.emit("midline", { on: false });
    }
    app.state.snap = { name, since: performance.now(), credited: false };
    app.setProbe(p[0], p[1], { ease, source });
    app.emit("snap", { name, source });
    if (credit) creditNow(name);
    app.invalidate();
  };

  app.unsnap = (reason = "move") => {
    if (!app.state.snap) return;
    const name = app.state.snap.name;
    app.state.snap = null;
    app.emit("unsnap", { name, reason });
  };

  /**
   * Feed a cursor position (world coords). Applies snapping rules and moves
   * the probe. opts: pointerType, speed (px/s), noSnap, approachOnly, ease.
   */
  app.cursorTo = (world, opts = {}) => {
    const state = app.state;
    const sys = app.sys();
    let [wx, wy] = world;
    if (state.midline) wx = 0.5;
    for (const constrain of app.constraints) [wx, wy] = constrain([wx, wy], opts);
    const cursorPx = worldToScreen(app.cam, wx, wy);

    if (state.snap) {
      const L = sys.lPoints[state.snap.name];
      const Lpx = worldToScreen(app.cam, L[0], L[1]);
      const d = Math.hypot(cursorPx[0] - Lpx[0], cursorPx[1] - Lpx[1]);
      if (!opts.noSnap && d <= SNAP_RELEASE && !opts.forceRelease) {
        app.emit("hold", { cursor: cursorPx, point: Lpx });
        return;
      }
      app.unsnap("move");
    }

    if (!opts.noSnap && (opts.speed ?? 0) < SNAP_MAX_SPEED && !state.busy) {
      const radius = app.snapRadius(opts.pointerType);
      let best = null;
      let bestD = Infinity;
      const S = worldToScreen(app.cam, 0, 0);
      const E = worldToScreen(app.cam, 1, 0);
      for (const name of L_NAMES) {
        const L = sys.lPoints[name];
        const Lpx = worldToScreen(app.cam, L[0], L[1]);
        // A point hidden inside a body's disc (L1/L2 at the real Earth mass
        // at full view) cannot be seen balancing: zoom in to reach it.
        const clear = Math.min(Math.hypot(Lpx[0] - S[0], Lpx[1] - S[1]), Math.hypot(Lpx[0] - E[0], Lpx[1] - E[1]));
        if (clear < 16) continue;
        const d = Math.hypot(cursorPx[0] - Lpx[0], cursorPx[1] - Lpx[1]);
        if (d < radius && d < bestD) {
          if (opts.approachOnly) {
            const P = worldToScreen(app.cam, state.probe[0], state.probe[1]);
            const before = Math.hypot(P[0] - Lpx[0], P[1] - Lpx[1]);
            if (d >= before) continue;
          }
          best = name;
          bestD = d;
        }
      }
      if (best) {
        app.snapTo(best, { credit: opts.creditNow, source: opts.source ?? "pointer" });
        return;
      }
    }
    app.setProbe(wx, wy, { ease: opts.ease ?? 0, source: opts.source ?? "pointer" });
  };

  /** A snap always means "the probe is on the point"; anything else unsnaps. */
  function checkSnapInvariant() {
    const snap = app.state.snap;
    if (!snap || app.probeEase) return;
    const L = app.sys().lPoints[snap.name];
    const p = app.state.probe;
    if (Math.hypot(L[0] - p[0], L[1] - p[1]) * scaleOf(app.cam) > 0.5) app.unsnap("drift");
  }

  function creditNow(name) {
    const state = app.state;
    if (state.snap && state.snap.name === name) state.snap.credited = true;
    const firstTime = !state.found[name];
    state.found[name] = true;
    state.shown[name] = false;
    saveProgress(state);
    app.emit("found", { name, firstTime });
  }

  function creditSnap(now) {
    const snap = app.state.snap;
    if (!snap || snap.credited) return false;
    if (app.probeEase) return true;
    if (now - snap.since >= FOUND_DWELL_MS) {
      creditNow(snap.name);
      return false;
    }
    return true;
  }

  // --- mass -----------------------------------------------------------------------
  app.setMass = (q, { source = "api", ride = false } = {}) => {
    const next = Math.min(Q_MAX, Math.max(Q_MIN, q));
    if (next === app.state.q) return;
    app.state.q = next;
    const sys = app.sys();
    const snap = app.state.snap;
    if (snap && ride) {
      // Riding: the probe travels with the point it sits on, so the loop stays
      // closed while the point slides (chapter "Three on the line").
      const b = sys.lPoints[snap.name];
      if (app.probeEase) app.probeEase.to = [...b];
      else app.state.probe = [...b];
    } else if (snap) {
      // Compare with where the probe really is, so a slow sweep that moves the
      // point a fraction of a pixel per step still lets go eventually.
      const b = sys.lPoints[snap.name];
      const p = app.probeEase ? app.probeEase.to : app.state.probe;
      const moved = Math.hypot(b[0] - p[0], b[1] - p[1]) * app.scale();
      if (moved > 0.25) app.unsnap("mass");
    }
    app.emit("mass", { q: next, source });
    app.invalidate();
  };

  return app;
}
