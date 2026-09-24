// Chapter 2 "Why a triangle?".
//
//   a. At L4 you are exactly a from both bodies, and each pulls you its mass
//      share of the way (ticks from features/shares.js, live percentages).
//   b. Shares always add up to the centre of mass, whatever the masses: sweep.
//   c. Drag away: the white misses lie along each body's own line; inside a
//      body's circle its pull overshoots, outside it falls short.
//   d. Two misses on different lines can't cancel, so both must vanish:
//      distance a from both. Optional midline lock (both misses scale together).
//   e. Back at L4: an equal-sided triangle for any masses. The math, then on
//      to chapter 3.
//
// Every state has at most two chips: with three, the chips wrap into a second
// row on a laptop and squeeze the caption past two lines.
// Every step keeps a "Next" chip, so a user who drags around can always go on;
// steps that are about L4 offer a way back to it.

import { COLORS, alpha, font } from "../theme.js";
import { label, line, rectsOverlap } from "../draw.js";
import { vecToScreen, vecToWorld, visibleWorld, worldToScreen } from "../camera.js";
import { L_NAMES, accelerations } from "../physics.js";
import { LEG_KEYS, chainScale } from "../chain.js";
import { shareStrings } from "../features/shares.js";
import { defineStrings } from "../i18n.js";

/** Below this Earth mass the Earth leg is only a few px long at L4. */
const MIN_VISIBLE_Q = 0.1;
const TEACHING_Q = 0.25;
/**
 * "Show me" spot (mirrored for L5): outside the Sun's circle and inside
 * Earth's, so one pull falls short and the other overshoots; both misses are
 * ~50 px at 25% on a laptop and the chain stays clear of the bodies.
 */
const DEMO_SPOT = [0.8, 0.75];
/**
 * Midline lock parking, just outside L4/L5 (|y| in a): as far out as the
 * whole chain, leftover tip included, stays in view, up to PARK_MAX. Below
 * PARK_MIN the misses are too small to see, so the camera pans a little to
 * make room for PARK_Y instead (phone portrait: L4 sits at the screen edge).
 */
const PARK_MAX = 1.0;
const PARK_MIN = 0.93;
const PARK_Y = 0.96;
const PARK_MARGIN = 12;

export const TRIANGLE_STRINGS = {
  en: {
    sun: "Sun",
    earth: "Earth",
    next: "Next →",
    a: 'You\'re exactly <em>a</em> from both. Each pulls you its mass share of the way: {shares}.',
    aAway: "At {home}, exactly <em>a</em> from both, each pulls you its mass share: {shares}.",
    backTo: "Back to {home}",
    bLead: "Shares always add up to the centre of mass, for any masses.",
    now: "Now",
    stop: "Stop",
    bDone: 'Real Earth to equal masses: the loop never opened. <span class="muted">Only the shares changed.</span>',
    sweepAgain: "Sweep again",
    sweepStopped: "Sweep stopped.",
    trySweep: "Try a sweep.",
    sweep: "Sweep",
    cExplored: "Inside a body's circle its pull overshoots its share; outside, it falls short.",
    showMe: "Show me",
    c: "Drag away from {home}. The white misses lie along each body's own line.",
    unlock: "Unlock midline",
    lock: "Lock to midline",
    unlockTitle: "Free the probe again (Esc)",
    lockTitle: "Keep the probe equally far from the Sun and Earth",
    dMid: "On the midline both misses grow and shrink together. They vanish only at L4 and L5.",
    d: "Two misses on different lines can't cancel. Both must vanish: <em>a</em> from both. Only two spots.",
    e: "So L4 and L5 always form an equal-sided triangle with the Sun and Earth.",
    showMath: "Show the math",
    toLine: "Three on the line →",
    midShort: "equally far from both",
    midTouch: "equally far from Sun and Earth",
    midLong: "equally far from Sun and Earth · Esc to unlock",
    math: `
<p><b>Why exactly <i>a</i> from both?</b>
<span class="muted">G = 1. P probe, S Sun, E Earth, C centre of mass, M = m<sub>S</sub> + m<sub>E</sub>.</span></p>
<p>The spin push is ω²(P − C) with ω² = M/<i>a</i>³. Since M·C = m<sub>S</sub>S + m<sub>E</sub>E,
it splits into one part per body. Add gravity and the leftover is</p>
<span class="math">net = m<sub>S</sub>(P − S)(1/<i>a</i>³ − 1/d<sub>S</sub>³)
    + m<sub>E</sub>(P − E)(1/<i>a</i>³ − 1/d<sub>E</sub>³)</span>
<p>Off the Sun–Earth line, P − S and P − E point along different lines, so the two terms
can't cancel. Each must vanish: d<sub>S</sub> = d<sub>E</sub> = <i>a</i>. Only L4 and L5, for any masses.</p>
<p>On the midline (d<sub>S</sub> = d<sub>E</sub> = d) gravity aims straight at the CM:</p>
<span class="math">gravity = −(M/d³)(P − C)
spin    = +(M/<i>a</i>³)(P − C)</span>
<p>Same line, opposite ways: they cancel only at d = <i>a</i>.</p>`,
  },
  ru: {
    sun: "Солнце",
    earth: "Земля",
    next: "Далее →",
    a: "Вы ровно в <em>a</em> от обоих тел. Каждое тянет вас на долю пути, равную доле его массы: {shares}.",
    aAway: "В {home}, ровно в <em>a</em> от обоих, каждое тело тянет на долю своей массы: {shares}.",
    backTo: "Назад к {home}",
    bLead: "Доли всегда складываются в центр масс — при любых массах.",
    now: "Сейчас",
    stop: "Стоп",
    bDone: 'От реальной Земли до равных масс петля ни разу не разомкнулась. <span class="muted">Менялись только доли.</span>',
    sweepAgain: "Прогнать ещё раз",
    sweepStopped: "Прогон остановлен.",
    trySweep: "Попробуйте прогон.",
    sweep: "Прогнать массу",
    cExplored: "Внутри окружности тела его притяжение перелетает свою долю, снаружи — не долетает.",
    showMe: "Покажите",
    c: "Отведите зонд от {home}. Белые промахи лежат каждый на линии своего тела.",
    unlock: "Отпустить с линии",
    lock: "На линию равных расстояний",
    unlockTitle: "Снова освободить зонд (Esc)",
    lockTitle: "Держать зонд на равном расстоянии от Солнца и Земли",
    dMid: "На этой линии оба промаха растут и уменьшаются вместе и исчезают только в L4 и L5.",
    d: "Два промаха на разных линиях не гасят друг друга. Оба должны исчезнуть: <em>a</em> до обоих тел. Таких мест всего два.",
    e: "Поэтому L4 и L5 всегда образуют с Солнцем и Землёй равносторонний треугольник.",
    showMath: "Показать математику",
    toLine: "Три на линии →",
    midShort: "равно от обоих",
    midTouch: "на равном расстоянии от Солнца и Земли",
    midLong: "на равном расстоянии от Солнца и Земли · Esc — отпустить",
    math: `
<p><b>Почему ровно <i>a</i> от обоих?</b>
<span class="muted">G = 1. P — зонд, S — Солнце, E — Земля, C — центр масс, M = m<sub>S</sub> + m<sub>E</sub>.</span></p>
<p>Центробежная сила равна ω²(P − C), где ω² = M/<i>a</i>³. Так как M·C = m<sub>S</sub>S + m<sub>E</sub>E,
она делится на две части — по одной на каждое тело. Добавим гравитацию, и остаток равен</p>
<span class="math">остаток = m<sub>S</sub>(P − S)(1/<i>a</i>³ − 1/d<sub>S</sub>³)
        + m<sub>E</sub>(P − E)(1/<i>a</i>³ − 1/d<sub>E</sub>³)</span>
<p>Вне линии Солнце–Земля векторы P − S и P − E направлены вдоль разных линий, поэтому слагаемые
не могут погасить друг друга. Каждое должно обратиться в ноль: d<sub>S</sub> = d<sub>E</sub> = <i>a</i>. Это только L4 и L5 — при любых массах.</p>
<p>На линии равных расстояний (d<sub>S</sub> = d<sub>E</sub> = d) гравитация направлена прямо в ЦМ:</p>
<span class="math">гравитация   = −(M/d³)(P − C)
центробежная = +(M/<i>a</i>³)(P − C)</span>
<p>Одна линия, противоположные стороны: они гасят друг друга только при d = <i>a</i>.</p>`,
  },
};
const tr = defineStrings(TRIANGLE_STRINGS);

/** The Sun–Earth–L4 (or L5) triangle, framed so it fills the view. */
function triangleBox(home) {
  const box = { minX: -0.25, maxX: 1.25, minY: -0.22, maxY: 1.12 };
  return home === "L5" ? { ...box, minY: -box.maxY, maxY: -box.minY } : box;
}

export function createTriangleChapter(app) {
  const story = app.story;
  let forcedChain = false;
  const measureCtx = document.createElement("canvas").getContext("2d");

  /** Label rects of the L-point markers, placed as scene.js places them (it draws after us). */
  function markerLabelRects(f) {
    measureCtx.font = font(13, 650);
    const out = [];
    for (const name of L_NAMES) {
      const p = f.sys.lPoints[name];
      const [x, y] = app.toScreen(p[0], p[1]);
      const off = f.snapped === name ? 22 : 13;
      const onAxis = name === "L1" || name === "L2" || name === "L3";
      const lx = x + (f.cam.rot && onAxis ? off + 4 : off * 0.9);
      const ly = y - (f.cam.rot && onAxis ? 0 : off);
      out.push({ x: lx - 2, y: ly - 10, w: measureCtx.measureText(name).width + 4, h: 20 });
      out.push({ x: x - 7, y: y - 7, w: 14, h: 14 });
    }
    return out;
  }

  return {
    id: "triangle",
    layers: { compass: true, shares: true },

    enter(scope, opts = {}) {
      const state = app.state;
      let step = "a";
      let home = state.snap?.name === "L5" ? "L5" : "L4";
      let sweepStatus = "idle"; // idle | running | done | stopped
      let explored = false; // step c: the user moved off L4 and paused
      let lastKey = "";
      let exploreTimer = 0;
      let ready = false; // no captions until the scene is set up
      let massSettling = false; // entry mass animation running: announce once it lands
      let camPan = null; // camera before the midline lock panned it, while untouched

      const atHome = () => state.snap?.name === "L4" || state.snap?.name === "L5";

      // ---- scene set-up ------------------------------------------------------------------------
      forcedChain = false;
      if (state.arrows === "fan") {
        // Shares only exist on the chain; put the user's choice back on exit.
        forcedChain = true;
        story.setArrows("chain");
      }
      // Frame the triangle: the construction is large and, at L4/L5, drawn at
      // the natural scale, so "each pulls its share" and "lands on the CM" are
      // literally true on screen.
      let framed = app.showBox(triangleBox(home), 700);
      if (!framed && app.userZoomed) app.fitView();
      scope.add(() => {
        if (framed && !app.userZoomed) app.fitView({ animate: false });
      });
      // A link opened while the app runs (hashchange) is not applied by
      // story.start; apply its mass here (idempotent on first load).
      if (opts.link?.q && opts.link.q !== state.q) app.setMass(opts.link.q, { source: "link" });
      if (state.q < MIN_VISIBLE_Q && !opts.link?.q) {
        // At real-Earth-like masses the Earth leg would be invisible.
        massSettling = !app.reducedMotion;
        story.animateMass(TEACHING_Q, 700).then(() => {
          if (!massSettling || !scope.alive) return;
          massSettling = false;
          // The first caption went out with the starting shares; say the real ones.
          app.ui.announce(app.ui.els.caption.textContent, { force: true });
        });
      }

      // ---- captions ------------------------------------------------------------------------------
      function sharesHtml() {
        const sh = shareStrings(state.q);
        return (
          `<span class="c-sun">${tr("sun")}&nbsp;<span data-share="sun">${sh.sun}</span></span>, ` +
          `<span class="c-earth">${tr("earth")}&nbsp;<span data-share="earth">${sh.earth}</span></span>`
        );
      }

      /** Live percentages: patch the numbers in place (no re-announce, no re-animate). */
      function updateShares() {
        const sh = shareStrings(state.q);
        for (const el of app.ui.els.caption.querySelectorAll("[data-share]")) {
          const v = el.dataset.share === "sun" ? sh.sun : sh.earth;
          if (el.textContent !== v) el.textContent = v;
        }
      }

      const next = (to, primary = true) => ({ label: tr("next"), primary, onClick: () => goStep(to) });

      function view() {
        switch (step) {
          case "a":
            if (atHome()) {
              return {
                key: "a",
                html: tr("a", { shares: sharesHtml() }),
                chips: [next("b")],
              };
            }
            return {
              key: "a-away",
              html: tr("aAway", { home, shares: sharesHtml() }),
              chips: [{ label: tr("backTo", { home }), onClick: () => snapHome() }, next("b")],
            };
          case "b": {
            const lead = tr("bLead");
            if (sweepStatus === "running") {
              return {
                key: "b-run",
                html: `${lead} <span class="muted">${tr("now")}</span> ${sharesHtml()}.`,
                chips: [{ label: tr("stop"), onClick: () => story.stopSweep() }],
              };
            }
            if (sweepStatus === "done") {
              return {
                key: "b-done",
                html: tr("bDone"),
                chips: [{ label: tr("sweepAgain"), onClick: () => runSweep() }, next("c")],
              };
            }
            return {
              key: `b-${sweepStatus}`,
              html: `${lead} <span class="muted">${sweepStatus === "stopped" ? tr("sweepStopped") : tr("trySweep")}</span>`,
              chips: [{ label: tr("sweep"), primary: true, onClick: () => runSweep() }, next("c", false)],
            };
          }
          case "c":
            if (explored) {
              return {
                key: "c-explored",
                html: tr("cExplored"),
                chips: [{ label: tr("showMe"), onClick: () => showMe() }, next("d")],
              };
            }
            return {
              key: "c",
              html: tr("c", { home }),
              chips: [{ label: tr("showMe"), onClick: () => showMe() }, next("d")],
            };
          case "d": {
            // An action button whose label says what it will do (a toggle
            // with aria-pressed must keep one label, so it is not one).
            const lock = {
              label: state.midline ? tr("unlock") : tr("lock"),
              title: state.midline ? tr("unlockTitle") : tr("lockTitle"),
              onClick: () => setMidline(!state.midline),
            };
            if (state.midline) {
              return {
                key: "d-mid",
                html: tr("dMid"),
                chips: [lock, next("e")],
              };
            }
            return {
              key: "d",
              html: tr("d"),
              chips: [lock, next("e")],
            };
          }
          case "e":
          default:
            return {
              key: "e",
              html: tr("e"),
              chips: [
                { label: tr("showMath"), onClick: () => toggleMath() },
                { label: tr("toLine"), primary: true, onClick: () => story.goto("line") },
              ],
            };
        }
      }

      function render(force = false) {
        if (!scope.alive || !ready) return;
        const v = view();
        if (!force && v.key === lastKey) {
          updateShares();
          return;
        }
        lastKey = v.key;
        // New chips replace the old ones: keep keyboard focus on the same
        // slot (e.g. Lock/Unlock midline), or it would drop to the page.
        const chipsEl = app.ui.els.chips;
        const focused = chipsEl.contains(document.activeElement)
          ? [...chipsEl.children].indexOf(document.activeElement)
          : -1;
        story.say(v.html, v.chips.filter(Boolean), { announce: !massSettling });
        if (focused >= 0) chipsEl.children[Math.min(focused, chipsEl.children.length - 1)]?.focus({ preventScroll: true });
      }

      // ---- actions ---------------------------------------------------------------------------------
      function snapHome() {
        if (!scope.alive) return;
        if (state.midline) setMidline(false, { quiet: true });
        story.jumpTo(home, { ease: 450 });
      }

      function goStep(to) {
        if (!scope.alive) return;
        story.stopSweep();
        if (to !== "d" && state.midline) setMidline(false, { quiet: true });
        if (to !== "e") app.ui.card(null);
        clearTimeout(exploreTimer);
        step = to;
        if (to === "b") {
          sweepStatus = "idle";
          if (!atHome()) snapHome();
        } else if (to === "c") {
          explored = false;
        } else if (to === "d") {
          // The claim is about misses: make sure there are some to look at.
          if (atHome()) showMe();
        } else if (to === "e") {
          if (!atHome()) snapHome();
          app.ui.markChapterDone("triangle");
        }
        render(true);
        app.invalidate();
      }

      function runSweep() {
        if (!scope.alive) return;
        if (!atHome()) snapHome();
        story.sweep();
      }

      function showMe() {
        if (!scope.alive) return;
        if (state.midline) setMidline(false, { quiet: true });
        const sign = home === "L5" ? -1 : 1;
        app.unsnap("show");
        app.setProbe(DEMO_SPOT[0], sign * DEMO_SPOT[1], { ease: 600, source: "show" });
      }

      function setMidline(on, { quiet = false } = {}) {
        if (state.midline === on) return;
        if (on) {
          story.stopSweep();
          // Start from a clean spot on the probe's side: just outside L4/L5,
          // where both pulls fall short and both misses show along their own
          // lines (inside, the Sun's pull would run into the Sun). Sliding
          // back towards L4 shrinks both misses together until it snaps.
          const y = state.probe[1];
          const side = Math.abs(y) < 0.15 ? (home === "L5" ? -1 : 1) : Math.sign(y);
          app.unsnap("midline");
          state.midline = true;
          park(side, 450);
        } else {
          state.midline = false;
        }
        app.emit("midline", { on });
        if (!quiet) render(true);
        app.invalidate();
      }

      /** Screen box of the ring, the chain and the leftover tip for a probe at (x, y) under camera `cam`. */
      function chainBox(cam, x, y) {
        const sys = app.sys();
        const acc = accelerations(sys, x, y);
        const k = chainScale(cam, sys, acc);
        const P = worldToScreen(cam, x, y);
        const r = app.size.phone ? 21 : 19; // balance ring + a little air
        const box = { minX: P[0] - r, maxX: P[0] + r, minY: P[1] - r, maxY: P[1] + r };
        let J = P;
        for (const key of LEG_KEYS) {
          const v = vecToScreen(cam, acc[key][0], acc[key][1], k);
          J = [J[0] + v[0], J[1] + v[1]];
          box.minX = Math.min(box.minX, J[0]);
          box.maxX = Math.max(box.maxX, J[0]);
          box.minY = Math.min(box.minY, J[1]);
          box.maxY = Math.max(box.maxY, J[1]);
        }
        return box;
      }

      /** Screen shift (px) that brings `box` inside the view, [0, 0] if it already fits. */
      function shiftInto(box, cam) {
        const v = cam.view;
        const m = PARK_MARGIN;
        const fix = (lo, hi, min, max) => (lo < min ? min - lo : hi > max ? max - hi : 0);
        return [
          fix(box.minX, box.maxX, v.left + m, v.left + v.width - m),
          fix(box.minY, box.maxY, v.top + m, v.top + v.height - m),
        ];
      }

      /**
       * Park the probe on the midline towards `side`: as far out as the
       * whole chain stays in view. If that leaves the misses too small to
       * see (phone portrait), pan the camera just enough to make room.
       */
      function park(side, ease) {
        // Plan against where the camera is heading (an unlock's fit may still be flying).
        const flight = app.cam.flight;
        const cam = flight ? { ...app.cam, center: [...flight.to.center], zoom: flight.to.zoom } : app.cam;
        let y = null;
        for (let t = PARK_MAX; t >= PARK_MIN - 1e-9; t -= 0.005) {
          const [dx, dy] = shiftInto(chainBox(cam, 0.5, side * t), cam);
          if (dx === 0 && dy === 0) {
            y = t;
            break;
          }
        }
        if (y === null && !cam.spin) {
          y = PARK_Y;
          const [dx, dy] = shiftInto(chainBox(cam, 0.5, side * y), cam);
          const d = vecToWorld(cam, dx, dy, cam.baseScale * cam.zoom);
          const center = [cam.center[0] - d[0], cam.center[1] - d[1]];
          if (!camPan) camPan = { center: [...cam.center], zoom: cam.zoom, userZoomed: app.userZoomed };
          ownCamera = true;
          app.flyTo(center, cam.zoom, ease);
          ownCamera = false;
        }
        app.setProbe(0.5, side * (y ?? PARK_MIN), { ease, source: "midline" });
      }

      /** Undo the midline pan, unless the user has moved the camera since. */
      function restoreCamera() {
        const prev = camPan;
        camPan = null;
        if (!prev) return;
        ownCamera = true;
        if (prev.userZoomed) app.flyTo(prev.center, prev.zoom, 450);
        else if (!(framed = app.showBox(triangleBox(home), 450))) app.fitView();
        ownCamera = false;
      }
      let ownCamera = false;
      scope.on("camera", () => {
        if (!ownCamera) camPan = null; // the user (or a reset) took over the camera
      });

      function toggleMath() {
        const card = document.getElementById("card");
        if (card && !card.hidden) app.ui.card(null);
        else app.ui.card(tr("math"));
      }

      // ---- events -----------------------------------------------------------------------------------
      // Snap/unsnap flips step a between its two captions. Leaving is
      // debounced so wiggling around L4 doesn't re-announce the caption.
      let unsnapTimer = 0;
      scope.on("snap", ({ name }) => {
        if (name === "L4" || name === "L5") home = name;
        clearTimeout(unsnapTimer);
        render();
      });
      scope.on("unsnap", () => {
        clearTimeout(unsnapTimer);
        unsnapTimer = scope.timeout(() => render(), 600);
        // Step b's sweep claims "the loop never opened": only true at L4/L5.
        // Arrow keys can move the probe mid-sweep (a pointer press already stops it).
        if (step === "b" && story.isSweeping()) story.stopSweep();
      });
      scope.on("mass", updateShares);
      // Esc (story.js) or our own chip changed the lock: follow it.
      scope.on("midline", () => {
        if (!state.midline) restoreCamera();
        if (step === "d") render(true);
        app.invalidate();
      });
      scope.on("sweep", ({ running, result }) => {
        if (!scope.alive || state.chapter !== "triangle") return;
        sweepStatus = running ? "running" : result === "done" ? "done" : "stopped";
        // A sweep from the dock's ▶ or the S key in step b: watch it from
        // L4. (Not story.jumpTo: it would stop the sweep that just began.)
        if (running && step === "b" && !atHome()) {
          if (state.midline) setMidline(false, { quiet: true });
          app.snapTo(home, { ease: 450, source: "jump" });
          if (state.snap) state.snap.credited = true;
        }
        if (step === "b") render();
      });
      scope.on("probe", ({ source, easing }) => {
        // Reset (R) drops the midline lock without a "midline" event.
        if (step === "d" && (lastKey === "d-mid") !== Boolean(state.midline)) render(true);
        // Step c: once the user has moved off L4 and paused, explain the circles.
        if (step !== "c" || explored || easing) return;
        if (source !== "pointer" && source !== "key" && source !== "show") return;
        if (atHome()) return;
        clearTimeout(exploreTimer);
        exploreTimer = scope.timeout(() => {
          if (step !== "c" || explored || atHome()) return;
          explored = true;
          render();
        }, source === "show" ? 1400 : 900);
      });
      // A new window size can push a parked midline chain out of view.
      scope.on("resize", () => {
        if (!state.midline) {
          if (framed && !app.userZoomed) framed = app.showBox(triangleBox(home), 0);
          return;
        }
        if (camPan && !camPan.userZoomed) {
          // The camera is still our pan: start again from the framed view.
          ownCamera = true;
          if (!(framed = app.showBox(triangleBox(home), 0))) app.fitView({ animate: false });
          ownCamera = false;
          camPan = null;
        }
        const [dx, dy] = shiftInto(chainBox(app.cam, state.probe[0], state.probe[1]), app.cam);
        if (dx !== 0 || dy !== 0) park(state.probe[1] < 0 ? -1 : 1, 0);
      });
      scope.on("escape", () => app.ui.card(null));

      // ---- layers -------------------------------------------------------------------------------------
      // Step b: the small triangle Sun-corner-CM is the big one shrunk about
      // the Sun by Earth's share (intercept theorem). A faint fill shows it.
      scope.layer({
        id: "triangle-small",
        z: 36,
        visible: (f) =>
          step === "b" &&
          (f.snapped === "L4" || f.snapped === "L5") &&
          f.state.arrows === "chain" &&
          f.chain.morph > 0.9 &&
          f.chain.rho > 0.97 &&
          !f.hide.chain,
        draw(ctx, f) {
          const sunLeg = f.chain.legs.find((l) => l.key === "sun");
          if (!sunLeg) return;
          const S = app.toScreen(f.sys.sun[0], f.sys.sun[1]);
          const corner = sunLeg.end;
          const C = f.chain.C;
          ctx.globalAlpha = f.chainAlpha;
          ctx.fillStyle = alpha(COLORS.text2, 0.1);
          ctx.beginPath();
          ctx.moveTo(S[0], S[1]);
          ctx.lineTo(corner[0], corner[1]);
          ctx.lineTo(C[0], C[1]);
          ctx.closePath();
          ctx.fill();
        },
      });

      // Midline lock: the perpendicular bisector, drawn while app.state.midline.
      scope.layer({
        id: "triangle-midline",
        z: 32,
        visible: (f) => Boolean(f.state.midline),
        draw(ctx, f) {
          const box = visibleWorld(f.cam, f.w, f.h);
          const span = box.maxX - box.minX + box.maxY - box.minY;
          const a = app.toScreen(0.5, box.minY - span);
          const b = app.toScreen(0.5, box.maxY + span);
          line(ctx, a[0], a[1], b[0], b[1], alpha(COLORS.text2, 0.55), 1.5, [6, 6]);

          // Label on the half away from the probe, halfway between the axis
          // and the far L-point: the ends of the line are busy (L4/L5, edges).
          const coarse = app.size.coarse;
          const text = app.size.phone ? tr("midShort") : coarse ? tr("midTouch") : tr("midLong");
          const far = f.state.probe[1] >= 0 ? -1 : 1;
          const Lfar = app.toScreen(0.5, (far * Math.sqrt(3)) / 2);
          const axis = app.toScreen(0.5, 0);
          const mid = [(Lfar[0] + axis[0]) / 2, (Lfar[1] + axis[1]) / 2];
          ctx.font = font(12, 500);
          const w = ctx.measureText(text).width;
          const opts = { size: 12, weight: 500 };
          const v = f.cam.view;
          if (Math.abs(b[0] - a[0]) < Math.abs(b[1] - a[1])) {
            // Vertical on screen (desktop): text beside the line.
            const right = mid[0] + 9 + w < v.left + v.width - 8;
            label(ctx, text, right ? mid[0] + 9 : mid[0] - 9, mid[1], COLORS.text2, { ...opts, align: right ? "left" : "right" });
          } else {
            // Horizontal (phone portrait): text beside the line, kept between
            // the axis and the far L-point and inside the view, above the line
            // unless an L-point label (L1 on the axis, at heavy masses right
            // on the midline) is in the way.
            const lo = Math.max(Math.min(axis[0], Lfar[0]) + 12, v.left + 8);
            const hi = Math.min(Math.max(axis[0], Lfar[0]) - 16, v.left + v.width - 8);
            if (hi - lo < w) return;
            const cx = Math.min(hi - w / 2, Math.max(lo + w / 2, mid[0]));
            const busy = markerLabelRects(f);
            for (const dy of [-11, 11]) {
              const rect = { x: cx - w / 2 - 2, y: mid[1] + dy - 9, w: w + 4, h: 18 };
              if (busy.some((r) => rectsOverlap(r, rect))) continue;
              label(ctx, text, cx, mid[1] + dy, COLORS.text2, { ...opts, align: "center" });
              break;
            }
          }
        },
      });

      // ---- start --------------------------------------------------------------------------------------
      // A shared link with a probe position keeps it. story.start sets it
      // after enter on first load; a hashchange does not, so set it here too
      // (and snap when it names an L-point, as story.start does).
      if (opts.link?.probe) {
        const [lx, ly] = opts.link.probe;
        app.unsnap("link");
        app.setProbe(lx, ly, { source: "link" });
        const at = app.toScreen(lx, ly);
        for (const n of L_NAMES) {
          const p = app.sys().lPoints[n];
          const s = app.toScreen(p[0], p[1]);
          if (Math.hypot(s[0] - at[0], s[1] - at[1]) < 3) app.snapTo(n, { ease: 0, source: "link" });
        }
      } else {
        story.jumpTo(home, { ease: 450 });
      }
      ready = true;
      render(true);
    },

    exit() {
      const state = app.state;
      if (state.midline) {
        state.midline = false;
        app.emit("midline", { on: false });
      }
      if (forcedChain && state.arrows === "chain") story.setArrows("fan");
      forcedChain = false;
      app.ui.card(null);
    },
  };
}
