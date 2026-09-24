// Chapter engine plus the shared scripted moments: mass sweep, predictions,
// jumping to a point, resets and deep links.
//
// A chapter is { id, layers?, enter(ctx), exit?(ctx) }. Everything a chapter
// registers through the ctx (layers, frame hooks, event listeners, timers)
// is removed automatically when the chapter exits.

import {
  CHAPTERS,
  DEFAULT_Q,
  START_PROBE,
  clearProgress,
  createState,
  markerVisible,
  parseHash,
  saveProgress,
} from "./state.js";
import { L_NAMES } from "./physics.js";
import { PRESETS, REAL_EARTH_Q, ROUTH_Q, qFromT, tFromQ } from "./mass.js";
import { COLORS, alpha } from "./theme.js";
import { easeInOutCubic } from "./draw.js";
import { t } from "./strings.js";

const BASE_LAYERS = {
  labels: true,
  sight: true,
  compass: false,
  shares: false,
  profile: false,
  magnifier: true,
};

export function installStory(app) {
  const chapters = new Map();
  let current = null;
  let scope = null;
  let sweepRun = null;

  // Bumped on every chapter change and reset: scripted steps can compare it
  // with the value they started with to know they were superseded.
  const story = { chapters, epoch: 0 };
  app.story = story;

  // ---- chapter scope helpers ----------------------------------------------------------
  function makeScope() {
    const cleanups = [];
    const s = {
      alive: true,
      add(fn) {
        cleanups.push(fn);
      },
      layer(layer) {
        cleanups.push(app.addLayer(layer));
      },
      hook(fn) {
        app.frameHooks.push(fn);
        cleanups.push(() => {
          const i = app.frameHooks.indexOf(fn);
          if (i >= 0) app.frameHooks.splice(i, 1);
        });
      },
      on(event, fn) {
        cleanups.push(app.on(event, fn));
      },
      timeout(fn, ms) {
        const id = setTimeout(() => {
          if (s.alive) fn();
        }, ms);
        cleanups.push(() => clearTimeout(id));
        return id;
      },
      interval(fn, ms) {
        const id = setInterval(() => {
          if (s.alive) fn();
        }, ms);
        cleanups.push(() => clearInterval(id));
        return id;
      },
      animate(fn) {
        const cancel = app.animate((now, dt) => s.alive && fn(now, dt));
        cleanups.push(cancel);
        return cancel;
      },
      wait(ms) {
        return new Promise((resolve) => s.timeout(() => resolve(true), ms));
      },
      dispose() {
        s.alive = false;
        while (cleanups.length) {
          try {
            cleanups.pop()();
          } catch (err) {
            console.error(err);
          }
        }
      },
    };
    return s;
  }

  story.register = (chapter) => {
    chapters.set(chapter.id, chapter);
  };

  story.current = () => current;

  story.say = (html, chips = [], opts) => app.ui.say(html, chips, opts);

  story.goto = (id, opts = {}) => {
    const chapter = chapters.get(id);
    if (!chapter) return;
    if (current === chapter && !opts.force) return;
    story.stopSweep();
    story.cancelMassAnimation();
    app.emit("chapterexit", { id: current?.id });
    if (current) {
      try {
        current.exit?.(scope);
      } catch (err) {
        console.error(err);
      }
    }
    scope?.dispose();
    app.state.midline = false;
    app.state.busy = null;
    app.morph = app.state.arrows === "fan" ? 0 : 1;
    // Settle anything still in motion so the next chapter starts from a
    // defined scene: land the probe and finish a camera flight.
    if (app.probeEase) {
      app.state.probe = [...app.probeEase.to];
      app.probeEase = null;
    }
    if (app.cam.flight) {
      app.cam.center = [...app.cam.flight.to.center];
      app.cam.zoom = app.cam.flight.to.zoom;
      app.cam.flight = null;
    }
    story.epoch += 1;

    current = chapter;
    app.state.chapter = id;
    app.state.layers = { ...BASE_LAYERS, ...(chapter.layers ?? {}) };
    scope = makeScope();
    app.ui.setChapter(id);
    app.ui.syncTracker();
    if (!opts.fromHash) {
      const meta = CHAPTERS.find((c) => c.id === id);
      try {
        history.replaceState(null, "", meta?.hash ? `#${meta.hash}` : location.pathname + location.search);
      } catch {
        // ignore
      }
    }
    try {
      chapter.enter(scope, opts);
    } catch (err) {
      console.error(err);
    }
    app.emit("chapter", { id });
    app.invalidate();
  };

  story.nextChapter = (dir) => {
    const i = CHAPTERS.findIndex((c) => c.id === app.state.chapter);
    const next = CHAPTERS[Math.min(CHAPTERS.length - 1, Math.max(0, i + dir))];
    if (next) story.goto(next.id);
  };

  // ---- layers and arrow mode ---------------------------------------------------------------
  story.setLayer = (key, value) => {
    app.state.layers[key] = Boolean(value);
    app.emit("layers", { key, value });
    app.ui.syncLayersMenu();
    app.invalidate();
  };

  story.setArrows = (mode) => {
    if (app.state.arrows === mode) return;
    app.state.arrows = mode;
    const from = app.morph;
    const to = mode === "fan" ? 0 : 1;
    app.tween(600, (t) => {
      app.morph = from + (to - from) * t;
      app.invalidate();
    }, { ease: easeInOutCubic });
    app.ui.syncLayersMenu();
  };

  // ---- points -----------------------------------------------------------------------------------
  story.jumpTo = (name, { credit = false, ease = 450 } = {}) => {
    if (!markerVisible(app.state, name)) {
      app.ui.toast(t("toast.notFound"));
      app.ui.announce(t("announce.notFound", { name }), { force: true });
      return false;
    }
    story.stopSweep();
    const sys = app.sys();
    const p = sys.lPoints[name];
    const s = app.toScreen(p[0], p[1]);
    const v = app.cam.view;
    const off = s[0] < v.left || s[0] > v.left + v.width || s[1] < v.top || s[1] > v.top + v.height;
    if (off) app.fitView();
    app.snapTo(name, { ease, source: "jump" });
    if (!credit && app.state.snap) app.state.snap.credited = true;
    if (credit) app.state.snap.since = -Infinity;
    return true;
  };

  story.showAll = () => {
    app.state.showAll = true;
    saveProgress(app.state);
    app.ui.syncTracker();
    app.ui.syncLayersMenu();
    app.emit("showall");
    app.invalidate();
  };

  // ---- mass ----------------------------------------------------------------------------------------
  // One mass animation at a time; a chapter change or any other mass change
  // (slider, keys, sweep) cancels it, so it can never leak into what follows.
  let massRun = null;
  story.animateMass = (q, ms = 500) => {
    story.cancelMassAnimation();
    const t0 = tFromQ(app.state.q);
    const t1 = tFromQ(q);
    const run = { cancelled: false };
    massRun = run;
    for (const k of Object.keys(trails)) trails[k] = [];
    return app
      .tween(ms, (k) => {
        if (run.cancelled) return;
        app.setMass(qFromT(t0 + (t1 - t0) * k), { source: "animate" });
      }, { ease: easeInOutCubic })
      .then(() => {
        if (massRun === run) massRun = null;
        trailFade = performance.now();
        app.animate((now) => now - trailFade < 1600);
        return !run.cancelled;
      });
  };

  story.cancelMassAnimation = () => {
    if (massRun) massRun.cancelled = true;
    massRun = null;
  };

  app.on("mass", ({ source }) => {
    if (massRun && source !== "animate") story.cancelMassAnimation();
  });

  story.stepMass = (dir, toPreset) => {
    story.stopSweep();
    if (!toPreset) {
      const t = tFromQ(app.state.q) + dir * 0.01;
      app.setMass(qFromT(t), { source: "key" });
      return;
    }
    const stops = [...PRESETS.map((p) => p.q), ROUTH_Q].sort((a, b) => a - b);
    const q = app.state.q;
    const next = dir > 0 ? stops.find((s) => s > q * 1.001) : [...stops].reverse().find((s) => s < q * 0.999);
    if (next) story.animateMass(next, 400);
  };

  // ---- sweep ---------------------------------------------------------------------------------------
  // Mass goes current -> real Earth -> equal masses -> current, in slider space.
  // A chapter may ask sweeps to carry a snapped probe along with its point.
  story.sweepRide = false;
  story.sweep = ({ duration = 9000, ride = story.sweepRide } = {}) => {
    story.stopSweep();
    const start = app.state.q;
    const stops = [tFromQ(start), tFromQ(REAL_EARTH_Q), tFromQ(1), tFromQ(start)];
    const segs = [];
    let total = 0;
    for (let i = 0; i < stops.length - 1; i += 1) {
      const d = Math.abs(stops[i + 1] - stops[i]);
      segs.push({ a: stops[i], b: stops[i + 1], d });
      total += d;
    }
    let resolveRun;
    const run = {
      stopped: false,
      promise: new Promise((r) => {
        resolveRun = r;
      }),
      finish(result) {
        if (run.done) return;
        run.done = true;
        app.state.busy = app.state.busy === "sweep" ? null : app.state.busy;
        app.ui.setSweeping(false);
        app.emit("sweep", { running: false, result });
        resolveRun(result);
      },
    };
    sweepRun = run;
    app.state.busy = "sweep";
    app.ui.setSweeping(true);
    app.emit("sweep", { running: true });

    if (app.reducedMotion) {
      // Stepped: jump between presets every 1.5 s.
      const seq = [REAL_EARTH_Q, 9.546e-4, 0.0123, 0.1218, 1, start];
      let i = 0;
      const step = () => {
        if (run.done) return;
        app.setMass(seq[i], { source: "sweep", ride });
        i += 1;
        if (i < seq.length) run.timer = setTimeout(step, 1500);
        else run.finish("done");
      };
      step();
      run.cancel = () => clearTimeout(run.timer);
      return run.promise;
    }

    let t0 = null;
    run.cancel = app.animate((now) => {
      if (run.done) return false;
      if (t0 === null) t0 = now;
      const u = Math.min(1, (now - t0) / duration);
      // Ease each end of the whole sweep, travel evenly in between.
      const e = easeInOutCubic(u);
      let pos = e * total;
      let t = stops[stops.length - 1];
      for (const seg of segs) {
        if (pos <= seg.d) {
          t = seg.a + (seg.b - seg.a) * (seg.d > 0 ? pos / seg.d : 1);
          break;
        }
        pos -= seg.d;
      }
      app.setMass(qFromT(t), { source: "sweep", ride });
      if (u >= 1) {
        app.setMass(start, { source: "sweep", ride });
        run.finish("done");
        return false;
      }
      return true;
    });
    return run.promise;
  };

  story.stopSweep = () => {
    if (!sweepRun || sweepRun.done) return;
    sweepRun.cancel?.();
    sweepRun.finish("stopped");
  };

  story.toggleSweep = () => {
    if (sweepRun && !sweepRun.done) story.stopSweep();
    else story.sweep();
  };

  story.isSweeping = () => Boolean(sweepRun && !sweepRun.done);

  // Trails of the collinear points while the mass changes.
  const trails = { L1: [], L2: [], L3: [] };
  let trailFade = 0;
  let fading = false;
  // However the mass animation was driven (sweep, story.animateMass or a
  // chapter's own tween), the trail fades out on its own once it stops.
  function keepFading() {
    if (fading) return;
    fading = true;
    app.animate((now) => {
      const more = story.isSweeping() || now - trailFade < 1600;
      if (!more) fading = false;
      return more;
    });
  }
  app.on("mass", ({ source }) => {
    if (source !== "sweep" && source !== "animate") return;
    const sys = app.sys();
    for (const name of ["L1", "L2", "L3"]) {
      const t = trails[name];
      t.push([...sys.lPoints[name]]);
      if (t.length > 400) t.shift();
    }
    trailFade = performance.now();
    keepFading();
  });
  app.on("sweep", ({ running }) => {
    if (running) {
      for (const k of Object.keys(trails)) trails[k] = [];
    } else {
      trailFade = performance.now();
      app.animate((now) => now - trailFade < 1600);
    }
  });
  app.addLayer({
    id: "sweep-trails",
    z: 45,
    draw(ctx, f) {
      const age = story.isSweeping() ? 0 : f.now - trailFade;
      const a = Math.max(0, 1 - age / 1500);
      if (a <= 0) return;
      for (const name of ["L1", "L2", "L3"]) {
        if (!markerVisible(f.state, name)) continue;
        const pts = trails[name];
        if (pts.length < 2) continue;
        ctx.save();
        ctx.strokeStyle = alpha(COLORS.text2, 0.5 * a);
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.beginPath();
        pts.forEach((p, i) => {
          const s = app.toScreen(p[0], p[1]);
          if (i === 0) ctx.moveTo(s[0], s[1]);
          else ctx.lineTo(s[0], s[1]);
        });
        ctx.stroke();
        ctx.restore();
      }
    },
  });

  // ---- predictions -----------------------------------------------------------------------------------
  /** Ask a question with choice chips; resolves with the chosen value. */
  story.predict = (html, options) =>
    new Promise((resolve) => {
      story.say(
        html,
        options.map((o) => ({
          label: o.label,
          onClick: () => resolve(o.value),
        })),
      );
    });

  // ---- resets -----------------------------------------------------------------------------------------
  story.resetProbeAndMass = () => {
    story.epoch += 1;
    story.stopSweep();
    story.cancelMassAnimation();
    app.emit("catch", { source: "reset" });
    app.unsnap("reset");
    if (app.state.midline) {
      app.state.midline = false;
      app.emit("midline", { on: false });
    }
    app.setMass(DEFAULT_Q, { source: "reset" });
    app.setProbe(START_PROBE[0], START_PROBE[1], { ease: 300, source: "reset" });
    app.fitView();
  };

  story.resetProgress = () => {
    let ok = true;
    try {
      ok = window.confirm(t("confirm.restart"));
    } catch {
      ok = true;
    }
    if (!ok) return;
    clearProgress();
    const fresh = createState();
    Object.assign(app.state, {
      found: fresh.found,
      shown: fresh.shown,
      showAll: false,
      predicted: null,
      sweepSeen: false,
      demoDone: false,
      arrows: "chain",
    });
    for (const b of app.ui.els.chapters.children) b.classList.remove("is-done");
    story.stopSweep();
    app.emit("catch", { source: "reset" });
    app.unsnap("reset");
    app.setMass(DEFAULT_Q, { source: "reset" });
    app.state.probe = [...START_PROBE];
    app.fitView({ animate: false });
    app.ui.syncTracker();
    story.goto("find", { force: true, restart: true });
  };

  // ---- global listeners -----------------------------------------------------------------------------
  app.on("escape", () => {
    if (story.isSweeping()) story.stopSweep();
    if (app.state.midline) {
      app.state.midline = false;
      app.emit("midline", { on: false });
    }
  });
  app.on("userinput", ({ kind }) => {
    if (kind === "pointerdown" && story.isSweeping()) story.stopSweep();
  });

  // ---- start ---------------------------------------------------------------------------------------------
  story.start = () => {
    const link = parseHash(location.hash);
    if (link.q) app.setMass(link.q, { source: "link" });
    const id = link.chapter ?? "find";
    story.goto(id, { fromHash: true, link });
    if (link.probe) applyLinkProbe(link.probe);
  };

  function applyLinkProbe(probe) {
    app.unsnap("link");
    app.setProbe(probe[0], probe[1], { source: "link" });
    // A link that lands on a point snaps there (and reveals only that point).
    const sys = app.sys();
    for (const n of L_NAMES) {
      const p = sys.lPoints[n];
      if (Math.hypot(p[0] - probe[0], p[1] - probe[1]) * app.scale() < 3) {
        app.snapTo(n, { ease: 0, source: "link" });
        if (app.state.chapter === "find" && !app.state.found[n]) {
          app.state.shown[n] = true;
          app.state.snap.credited = true;
          app.ui.syncTracker();
        }
      }
    }
  }

  // A link pasted into an open tab: apply it the same way as on load.
  window.addEventListener("hashchange", () => {
    const link = parseHash(location.hash);
    if (!link.chapter && !link.q && !link.probe) return;
    if (link.q) app.setMass(link.q, { source: "link" });
    if (link.chapter && link.chapter !== app.state.chapter) story.goto(link.chapter, { fromHash: true, link });
    if (link.probe) applyLinkProbe(link.probe);
  });

  return story;
}
