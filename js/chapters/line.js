// Chapter 3 "Three on the line" (#line).
//
// On the Sun–Earth axis every pull points along the axis, so balance is only a
// matter of lengths: the net pull is one signed number, drawn by the axis
// profile strip (features/profile.js). Between each pair of "walls" (the Sun,
// Earth, and far away where the spin push wins) that number changes sign
// once: one balance spot per gap, L3, L1, L2. A mass sweep then shows L1–L3
// sliding while L4/L5 stay put.
//
//   a. probe on the axis at x = 0.45, lanes on, the axis softly highlighted
//   b. the strip fades in and its three crossings pulse; optional "walk the line"
//   c. sweep the mass; L1–L3 slide, L4/L5 stay

import { DEFAULT_Q } from "../state.js";
import { visibleWorld } from "../camera.js";
import { qFromT, tFromQ } from "../mass.js";
import { COLORS, alpha } from "../theme.js";
import { easeInOutCubic, line } from "../draw.js";
import { defineStrings } from "../i18n.js";

export const LINE_STRINGS = {
  en: {
    next: "Next →",
    a: "On this line every pull points along it. Only the lengths matter.",
    bWalk: 'Drag along the line: the curve follows the white arrow. <span class="muted">Where it crosses zero, the arrow vanishes.</span>',
    walkFree: "Walk freely",
    b: 'Pulls on one line can cancel. <span class="muted">The curve shows which way the white arrow points: it crosses zero once in each gap.</span>',
    walkLine: "Walk the line",
    c: "What happens to the three spots when Earth gets lighter or heavier?",
    sweep: "Sweep",
    sweeping: "Earth goes from its real mass to as heavy as the Sun. The probe rides {name}: always balanced, while the spot slides.",
    sweepingFree: "Earth goes from its real mass to as heavy as the Sun. Watch the three spots slide.",
    stopped: 'Sweep stopped. <span class="muted">Run it again to watch the three spots slide.</span>',
    sweepAgain: "Sweep again",
    toReal: "Real scale →",
    done: 'L1 and L2 back away from a heavier Earth; L3 slides in as the centre of mass shifts. <span class="muted">L4 and L5 never move.</span>',
    toTriangle: "Why a triangle?",
  },
  ru: {
    next: "Далее →",
    a: "На этой линии все силы направлены вдоль неё. Важны только длины.",
    bWalk: 'Ведите зонд вдоль линии: кривая следует за белой стрелкой. <span class="muted">Где она пересекает ноль, стрелка исчезает.</span>',
    walkFree: "Свободно",
    b: 'Силы на одной линии могут погасить друг друга. <span class="muted">Кривая показывает, куда направлена белая стрелка: в каждом промежутке она один раз проходит через ноль.</span>',
    walkLine: "Идти по линии",
    c: "Что станет с тремя точками, если Земля станет легче или тяжелее?",
    sweep: "Прогнать массу",
    sweeping: "Масса Земли растёт от реальной до массы Солнца. Зонд едет вместе с {name}: равновесие не нарушается, но сама точка сдвигается.",
    sweepingFree: "Масса Земли растёт от реальной до массы Солнца. Следите, как сдвигаются три точки.",
    stopped: 'Прогон остановлен. <span class="muted">Запустите снова, чтобы увидеть, как сдвигаются три точки.</span>',
    sweepAgain: "Прогнать ещё раз",
    toReal: "Реальный масштаб →",
    done: 'L1 и L2 отступают от потяжелевшей Земли, а L3 подползает ближе вслед за сдвигом центра масс. <span class="muted">L4 и L5 не сдвигаются никогда.</span>',
    toTriangle: "Почему треугольник?",
  },
};
const tr = defineStrings(LINE_STRINGS);

const START = [0.45, 0];
// Below about 1% of the Sun, L1 and L2 hug Earth too tightly to see the gaps.
const LIGHT_Q = 0.01;
const AXIS_POINTS = ["L1", "L2", "L3"];

export function createLineChapter(app) {
  const story = app.story;

  return {
    id: "line",
    // The strip ("profile") is switched on at step b, where the caption
    // introduces it. profile.js keeps its room reserved for the whole chapter
    // so the scene does not re-frame when it appears.
    layers: {},
    enter(scope, opts = {}) {
      const state = app.state;
      const link = opts.link ?? {};
      let step = "a"; // a | b | c | sweeping | stopped | done
      let walk = false;
      let rail = 0; // 0 none, 1 soft ("this line"), 2 walking
      let snapAtSweep = null;

      // ---- "this line": a soft highlight of the axis ------------------------------------
      scope.layer({
        id: "line-rail",
        z: 22,
        visible: () => rail > 0,
        draw(ctx, f) {
          const box = visibleWorld(f.cam, f.w, f.h);
          const pad = (box.maxX - box.minX + box.maxY - box.minY) * 0.1;
          const a = app.toScreen(box.minX - pad, 0);
          const b = app.toScreen(box.maxX + pad, 0);
          const strong = rail === 2;
          line(ctx, a[0], a[1], b[0], b[1], alpha(COLORS.text2, strong ? 0.5 : 0.3), strong ? 2 : 1.5);
        },
      });

      // ---- walk the line: while on, the probe cannot leave the axis ---------------------
      // Pointer, touch and arrow keys all go through app.cursorTo, whose
      // constraints run before snapping, so snapping to L1–L3 still works.
      scope.add(app.addConstraint((p) => (walk ? [p[0], 0] : p)));
      scope.add(() => {
        walk = false;
      });
      // Safety net for any other path that moves the probe by hand while walking.
      scope.on("probe", (e) => {
        if (!walk || e.easing || app.probeEase || state.snap) return;
        if (e.source !== "pointer" && e.source !== "key") return;
        const [x, y] = state.probe;
        if (Math.abs(y) > 1e-12) app.setProbe(x, 0, { source: "walk" });
      });

      function setWalk(on) {
        walk = on;
        rail = on ? 2 : 0;
        if (on) {
          const [x, y] = state.probe;
          if (Math.abs(y) > 1e-12) {
            app.unsnap("walk");
            app.setProbe(x, 0, { ease: 250, source: "walk" });
          }
        }
        app.invalidate();
      }

      scope.on("escape", () => {
        if (walk) toggleWalk(false);
      });

      // ---- steps ----------------------------------------------------------------------------
      function stepA() {
        step = "a";
        rail = 1;
        say();
      }

      function stepB() {
        step = "b";
        rail = walk ? 2 : 0;
        if (!state.layers.profile) story.setLayer("profile", true);
        // Pulse once the strip has faded in (profile.js skips it with reduced motion).
        scope.timeout(() => app.emit("profile:pulse"), app.reducedMotion ? 0 : 240);
        say("primary");
        app.invalidate();
      }

      function stepC() {
        setWalk(false);
        step = story.isSweeping() ? "sweeping" : "c";
        say("primary");
      }

      function finish() {
        step = "done";
        app.ui.markChapterDone("line");
        say("primary");
      }

      function toggleWalk(on) {
        setWalk(on);
        say();
      }

      /**
       * Caption and chips for the current step. Rebuilding the chips drops
       * keyboard focus, so a focused chip hands it to its successor: the same
       * slot ("same", for toggles) or the new primary chip ("primary").
       */
      function say(focus = "same") {
        const chipsEl = app.ui.els.chips;
        const active = document.activeElement;
        const had = chipsEl && active && chipsEl.contains(active) ? [...chipsEl.children].indexOf(active) : -1;

        const next = { label: tr("next"), primary: true, onClick: step === "a" ? stepB : stepC };
        const sweep = (label) => ({ label, primary: true, onClick: () => startSweep() });
        switch (step) {
          case "a":
            story.say(tr("a"), [next]);
            break;
          case "b":
            if (walk) {
              story.say(tr("bWalk"), [{ label: tr("walkFree"), onClick: () => toggleWalk(false) }, next]);
            } else {
              story.say(tr("b"), [{ label: tr("walkLine"), onClick: () => toggleWalk(true) }, next]);
            }
            break;
          case "c":
            story.say(tr("c"), [sweep(tr("sweep"))]);
            break;
          case "sweeping":
            story.say(snapAtSweep ? tr("sweeping", { name: snapAtSweep }) : tr("sweepingFree"), []);
            break;
          case "stopped":
            story.say(tr("stopped"), [sweep(tr("sweepAgain")), { label: tr("toReal"), onClick: () => story.goto("real") }]);
            break;
          default:
            story.say(tr("done"), [
              { label: tr("toReal"), primary: true, onClick: () => story.goto("real") },
              { label: tr("toTriangle"), onClick: () => story.goto("triangle") },
            ]);
        }

        if (had >= 0 && chipsEl) {
          const kids = [...chipsEl.children];
          const target =
            focus === "primary" ? (kids.find((b) => b.classList.contains("primary")) ?? kids[0]) : (kids[had] ?? kids[0]);
          target?.focus({ preventScroll: true });
        }
      }

      // During sweeps the probe rides the point it sits on (story.sweepRide):
      // the loop stays closed while L1–L3 slide.
      story.sweepRide = true;
      scope.add(() => {
        story.sweepRide = false;
      });

      /** Sweep from an axis point, so there is something to ride. */
      function startSweep() {
        if (!AXIS_POINTS.includes(state.snap?.name)) {
          setWalk(false);
          app.snapTo("L1", { ease: 300, source: "chapter" });
          if (state.snap) state.snap.credited = true;
        }
        story.sweep();
      }

      // The chip, the dock's ▶ button and the S key all start the same sweep.
      scope.on("sweep", ({ running, result }) => {
        if (running) {
          snapAtSweep = state.snap?.name ?? null;
          if (step !== "c" && step !== "stopped") return;
          step = "sweeping";
          say("primary");
          return;
        }
        // A full sweep ends on the mass it started from, so a point the probe
        // sat on before is back under it: close the loop again.
        const name = snapAtSweep;
        snapAtSweep = null;
        if (result === "done" && name && !state.snap && AXIS_POINTS.includes(name)) {
          const p = app.sys().lPoints[name];
          const d = Math.hypot(p[0] - state.probe[0], p[1] - state.probe[1]) * app.scale();
          if (d < 0.5) app.snapTo(name, { ease: 0, source: "chapter" });
        }
        if (step !== "sweeping") return;
        // Stopped part-way (Esc, ▶, a click, or leaving the chapter): no verdict yet.
        if (result === "done") finish();
        else {
          step = "stopped";
          say("primary");
        }
      });

      // "Reset" (R / ⋯ menu) puts the probe back at the hunt's start, off the
      // axis. In this chapter it belongs on the line: retarget once the reset
      // has run (the probe has not moved yet, its ease starts next frame).
      scope.on("catch", ({ source } = {}) => {
        if (source !== "reset") return;
        Promise.resolve().then(() => {
          if (!scope.alive) return;
          app.unsnap("chapter");
          app.setProbe(START[0], START[1], { ease: 300, source: "reset" });
        });
      });

      // ---- set the scene ----------------------------------------------------------------
      // The whole line matters here. Fit after the "chapter" event, once the
      // profile layer has claimed its room in the framed view (phone).
      if (app.userZoomed) Promise.resolve().then(() => scope.alive && app.fitView());
      // A link's mass and probe win (story.start applies them on load; a
      // hash change while the app is open does not, so apply them here too).
      if (link.q) app.setMass(link.q, { source: "link" });
      else if (state.q < LIGHT_Q) {
        // Scoped (stops if the chapter is left mid-way) and without sweep trails.
        const t0 = tFromQ(state.q);
        const t1 = tFromQ(DEFAULT_Q);
        app.tween(600, (k) => {
          if (scope.alive) app.setMass(k >= 1 ? DEFAULT_Q : qFromT(t0 + (t1 - t0) * k), { source: "chapter" });
        }, { ease: easeInOutCubic });
      }
      app.unsnap("chapter");
      if (link.probe) app.setProbe(link.probe[0], link.probe[1], { source: "link" });
      else app.setProbe(START[0], START[1], { ease: 450, source: "chapter" });
      stepA();
    },
    exit() {
      // Scope cleanup removes the walk constraint and the rail.
    },
  };
}
