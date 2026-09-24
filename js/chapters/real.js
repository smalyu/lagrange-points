// Chapter 4 "Real scale": the real Sun-Earth mass ratio, a fly-in to Earth,
// the tide view (features/realscale.js) and the "gravities equal" point
// that is not L1.
//
// a. Mass animates to the real ratio; at the full view L1/L2 sit ~3 px from Earth.
// b. Fly to Earth; the probe glides into L1 and the loop closes in the tide
//    view: tide (Sun pull + spin) against Earth's pull.
// c. The neutral point N, where the two gravities are equal: not L1.
//
// Mass is left at the real ratio on exit (the slider tag says so).

import { REAL_EARTH_Q, qFromT, tFromQ } from "../mass.js";
import { defineStrings, plural } from "../i18n.js";
import { makeSystem } from "../physics.js";
import { COLORS, alpha } from "../theme.js";
import { circle, easeInOutCubic, line } from "../draw.js";
import {
  KM_PER_A,
  around,
  arrowSegments,
  distanceHtml,
  distanceParts,
  findBlockSpot,
  findSpot,
  formatKm,
  hillOf,
  isEarthZoomed,
  isRealRatio,
  labelBounds,
  layoutTideLabels,
  neutralDistance,
  probeRect,
  richLabel,
  segHitsRect,
  zoomToEarth,
} from "../features/realscale.js";

export const REAL_STRINGS = {
  en: {
    a: "Real Earth: L1 and L2 are {dist} out, {px} at this scale.",
    and: "{a} and {b}",
    pxLess: "less than 1 px",
    px: ({ n }) => `only ${n} px`,
    b: "Sun pull and spin nearly cancel here. The rest, the tide, grows as Earth's pull fades. They meet at {name}.",
    c: 'Gravities are equal here, {dist} out. <span class="muted">Not L1: the spin push matters.</span>',
    zoomEarth: "Zoom to Earth",
    next: "Next →",
    backTo: "Back to {name}",
    jumpTo: "Jump to {name}",
    letgo: "Let go →",
    equalHead: "gravities equal · ",
    equal: "gravities equal",
  },
  ru: {
    a: "Реальная Земля: L1 и L2 — в {dist} от неё, {px} в этом масштабе.",
    and: "{a} и {b}",
    pxLess: "меньше пикселя",
    px: ({ n }) =>
      plural(n, { one: "всего {n} пиксель", few: "всего {n} пикселя", many: "всего {n} пикселей", other: "всего {n} пикселя" }),
    b: "Здесь притяжение Солнца и центробежная сила почти гасят друг друга. Остаток — прилив — растёт, а притяжение Земли слабеет. Они встречаются в {name}.",
    c: 'Здесь притяжения Солнца и Земли равны — в {dist} от Земли. <span class="muted">Это не L1: центробежная сила тоже важна.</span>',
    zoomEarth: "К Земле",
    next: "Далее →",
    backTo: "Назад к {name}",
    jumpTo: "К {name}",
    letgo: "Отпустить →",
    equalHead: "притяжения равны · ",
    equal: "притяжения равны",
  },
};
const tr = defineStrings(REAL_STRINGS);

const NEUTRAL_MIN_PX = 7; // hide N when it would sit on top of Earth's dot
// Mass changes made by this chapter: no sweep trails, and caption c ignores them.
const MASS_SOURCE = "chapter";

export function createRealChapter(app) {
  const story = app.story;

  return {
    id: "real",
    layers: {},
    enter(scope) {
      const state = app.state;
      const realSys = makeSystem(REAL_EARTH_Q);
      let step = "a";
      let showNeutral = false;
      let arriving = false;
      let lastZoomed = null;
      let lastCaptionA = "";
      let pendingZoom = false; // Z pressed while the mass was still moving
      let massTimer = 0;
      let massRun = null; // the running mass animation, if any
      let massDone = Promise.resolve(true);
      let glide = null;
      const pulse = { start: -1 };

      // ---- scoped animation helpers ---------------------------------------------------------
      // Like app.tween, but it stops with the chapter (and then never resolves).
      function tween(ms, stepFn, ease = easeInOutCubic) {
        return new Promise((resolve) => {
          if (ms <= 0 || app.reducedMotion) {
            stepFn(1);
            app.invalidate();
            resolve();
            return;
          }
          let start = null;
          scope.animate((now) => {
            if (start === null) start = now;
            const u = Math.min(1, (now - start) / ms);
            stepFn(ease(u));
            if (u < 1) return true;
            resolve();
            return false;
          });
        });
      }

      // Mass in slider space. Gives way as soon as anything else changes the
      // mass (slider, presets, sweep, keys). Resolves true if it got there.
      function animateMassTo(q, ms) {
        if (massRun) massRun.cancelled = true;
        const run = { cancelled: false };
        massRun = run;
        const t0 = tFromQ(state.q);
        const t1 = tFromQ(q);
        let last = null;
        return tween(ms, (k) => {
          if (run.cancelled) return;
          if (last !== null && state.q !== last) {
            run.cancelled = true;
            return;
          }
          app.setMass(k >= 1 ? q : qFromT(t0 + (t1 - t0) * k), { source: MASS_SOURCE });
          last = state.q;
        }).then(() => {
          if (massRun === run) massRun = null;
          return !run.cancelled;
        });
      }

      function startMass(ms) {
        massDone = animateMassTo(REAL_EARTH_Q, ms);
        massDone.then(afterMass);
        return massDone;
      }

      // Steps a and b tell the real-Earth story: bring the mass back first if
      // it was changed. Resolves false if the chapter was left meanwhile.
      async function settleMass() {
        await massDone;
        if (!scope.alive) return false;
        if (step !== "c" && !isRealRatio(state.q)) await startMass(600);
        return scope.alive;
      }

      // Z was pressed mid-animation: the feature zoomed for the old mass.
      function afterMass() {
        if (!scope.alive || !pendingZoom) return;
        pendingZoom = false;
        if (!app.userZoomed) return; // zoomed back out meanwhile
        if (!isEarthZoomed(app)) zoomToEarth(app);
        awaitArrival();
      }

      startMass(900);
      if (app.userZoomed || app.cam.flight) app.fitView();

      // ---- captions ---------------------------------------------------------------------------
      function captionA() {
        const dL1 = 1 - realSys.lPoints.L1[0];
        const dL2 = realSys.lPoints.L2[0] - 1;
        const t1 = formatKm(dL1 * KM_PER_A);
        const t2 = formatKm(dL2 * KM_PER_A);
        const dist = t1 === t2 ? t1 : tr("and", { a: t1, b: t2 });
        // Pixels between Earth and L1 in the full (fit) view.
        const px = Math.round(dL1 * app.cam.baseScale);
        const pxText = px < 1 ? tr("pxLess") : tr("px", { n: px });
        return tr("a", { dist, px: pxText });
      }

      function captionB(name) {
        return tr("b", { name });
      }

      function captionC() {
        const d = neutralDistance(state.q);
        return tr("c", { dist: distanceHtml(d, state.q) });
      }

      // When zoomed in, the floating "Fit view" button already offers the way
      // out: only offer the way in.
      function zoomChip() {
        return isEarthZoomed(app) ? null : { label: tr("zoomEarth"), onClick: () => goZoom() };
      }

      function chips() {
        if (step === "a") {
          return [{ label: tr("zoomEarth"), primary: true, onClick: () => goZoom() }];
        }
        if (step === "b") {
          // The tide view needs the close-up: offer the way back in first.
          if (!isEarthZoomed(app)) return [{ label: tr("zoomEarth"), primary: true, onClick: () => goZoom() }];
          return [{ label: tr("next"), primary: true, onClick: () => sayC() }];
        }
        const atL2 = state.snap?.name === "L2";
        return [
          atL2 ? { label: tr("backTo", { name: "L1" }), onClick: () => jump("L1") } : { label: tr("jumpTo", { name: "L2" }), onClick: () => jump("L2") },
          zoomChip(),
          { label: tr("letgo"), primary: true, onClick: () => story.goto("letgo") },
        ].filter(Boolean);
      }

      function refreshChips() {
        if (!scope.alive) return;
        lastZoomed = isEarthZoomed(app);
        app.ui.setChips(chips());
      }

      // ---- steps ------------------------------------------------------------------------------
      function sayA() {
        step = "a";
        lastCaptionA = captionA();
        story.say(lastCaptionA, chips());
      }

      function sayB() {
        step = "b";
        // Bring the probe in from just off balance so the loop visibly closes.
        const rH = hillOf(state.q);
        const P = app.toScreen(state.probe[0], state.probe[1]);
        const v = app.cam.view;
        const onView = P[0] > v.left && P[0] < v.left + v.width && P[1] > v.top && P[1] < v.top + v.height;
        const nearEarth = Math.hypot(state.probe[0] - 1, state.probe[1]) < 4 * rH;
        if (!(onView && nearEarth)) {
          app.unsnap("story");
          app.setProbe(1 - 1.8 * rH, 0.9 * rH, { source: "story" });
        }
        // Glide into the point on the probe's own side of Earth (never through Earth).
        const name = state.probe[0] > 1 ? "L2" : "L1";
        story.say(captionB(name), chips());
        if (state.snap?.name === name) refreshChips();
        else glideTo(name, 1100);
      }

      // Move the probe along a path (the leftover stays visible, so the loop
      // is seen closing), then snap. Anything else that moves the probe
      // (drag, keys, tracker jumps, reset) cancels it.
      function glideTo(name, ms, { arc = false } = {}) {
        const token = {};
        glide = token;
        app.unsnap("story");
        const from = [...state.probe];
        const to = [...app.sys().lPoints[name]];
        let path = (t) => [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t];
        if (arc) {
          // Around Earth rather than straight through it.
          const r0 = Math.hypot(from[0] - 1, from[1]);
          const r1 = Math.hypot(to[0] - 1, to[1]);
          const a0 = Math.atan2(from[1], from[0] - 1);
          let d = Math.atan2(to[1], to[0] - 1) - a0;
          while (d > Math.PI) d -= 2 * Math.PI;
          while (d <= -Math.PI) d += 2 * Math.PI;
          // A half turn could go either way: take the side the probe is on (or +y).
          const side = Math.abs(from[1]) > 1e-12 ? Math.sign(from[1]) : 1;
          if (Math.abs(d) > Math.PI - 0.35 && Math.sign(Math.sin(a0 + d / 2)) !== side) {
            d = d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI;
          }
          path = (t) => {
            const a = a0 + d * t;
            const r = r0 + (r1 - r0) * t;
            return [1 + r * Math.cos(a), r * Math.sin(a)];
          };
        }
        let last = null;
        return tween(ms, (t) => {
          if (glide !== token) return;
          const moved = last && (state.probe[0] !== last[0] || state.probe[1] !== last[1]);
          if (app.probeEase || state.snap || moved) {
            glide = null;
            return;
          }
          last = path(t);
          app.setProbe(last[0], last[1], { source: "story" });
          last = [...state.probe];
        }).then(() => {
          if (!scope.alive || glide !== token) return;
          glide = null;
          app.snapTo(name, { ease: 0, source: "story" });
          // Placed by the story, so it does not count as a find.
          if (state.snap) state.snap.credited = true;
          refreshChips();
        });
      }

      function sayC() {
        step = "c";
        showNeutral = true;
        pulse.start = -1;
        if (!app.reducedMotion) {
          scope.animate((now) => {
            if (pulse.start < 0) pulse.start = now;
            return now - pulse.start < 700;
          });
        }
        app.ui.markChapterDone("real");
        story.say(captionC(), chips());
        app.invalidate();
      }

      async function goZoom() {
        if (!(await settleMass())) return;
        if (!isEarthZoomed(app)) zoomToEarth(app);
        awaitArrival();
      }

      async function jump(name) {
        glide = null;
        if (isEarthZoomed(app) && !app.cam.flight) {
          // Swing around Earth to the other side, watching the arrows turn.
          glideTo(name, 1400, { arc: true });
          refreshChips();
          return;
        }
        if (!(await settleMass())) return;
        zoomToEarth(app);
        app.snapTo(name, { ease: 450, source: "story" });
        if (state.snap) state.snap.credited = true;
        refreshChips();
      }

      // Wait for the camera flight to end, then move the story on.
      function awaitArrival() {
        if (arriving) return;
        arriving = true;
        scope.animate(() => {
          if (app.cam.flight) return true;
          arriving = false;
          if (step === "a" && !massRun && isEarthZoomed(app)) sayB();
          else refreshChips();
          return false;
        });
      }

      // ---- events ------------------------------------------------------------------------------
      // Z key (handled by the feature) also moves the story on.
      scope.on("zoomEarth", () => {
        if (app.userZoomed && step !== "c" && !massRun && !isRealRatio(state.q)) startMass(600);
        if (massRun && app.userZoomed) pendingZoom = true;
        awaitArrival();
      });
      scope.on("userinput", () => {
        glide = null;
      });
      scope.on("escape", () => {
        if (app.userZoomed) app.fitView();
      });
      scope.on("camera", () => {
        if (step !== "a" && isEarthZoomed(app) !== lastZoomed) refreshChips();
      });
      scope.on("resize", () => {
        if (step === "a") {
          // The px figure depends on the window size.
          const html = captionA();
          if (html !== lastCaptionA) {
            lastCaptionA = html;
            story.say(html, chips(), { announce: false });
          }
        } else if (isEarthZoomed(app) !== lastZoomed) {
          refreshChips();
        }
      });
      scope.on("snap", () => {
        if (step === "c") refreshChips();
      });
      scope.on("unsnap", () => {
        if (step === "c") refreshChips();
      });
      // R / "Reset probe and mass": this chapter lives at the real ratio, so
      // start it over (after the reset has put the probe and view back).
      scope.on("catch", (e) => {
        if (e?.source !== "reset") return;
        Promise.resolve().then(() => {
          if (!scope.alive) return;
          glide = null;
          showNeutral = false;
          pendingZoom = false;
          startMass(900);
          sayA();
        });
      });
      // Keep the distance in caption c true if the mass changes.
      scope.on("mass", ({ source }) => {
        if (step !== "c" || source === MASS_SOURCE) return;
        clearTimeout(massTimer);
        massTimer = setTimeout(() => {
          if (scope.alive && step === "c") story.say(captionC(), chips(), { announce: false });
        }, 350);
      });
      scope.add(() => clearTimeout(massTimer));

      // ---- the neutral point N ---------------------------------------------------------------------
      // Screen position of N, or null when hidden (on top of Earth's dot or off screen).
      function neutralOnScreen(f) {
        if (!showNeutral) return null;
        const d = neutralDistance(f.sys.q);
        const N = app.toScreen(1 - d, 0);
        const E = app.toScreen(1, 0);
        const sep = Math.hypot(N[0] - E[0], N[1] - E[1]);
        if (sep < NEUTRAL_MIN_PX) return null;
        const v = f.cam.view;
        if (N[0] < v.left - 20 || N[0] > v.left + v.width + 20 || N[1] < v.top - 20 || N[1] > v.top + v.height + 20) {
          return null;
        }
        return { d, N, E, sep, r: f.app.size.phone ? 3 : 3.5 };
      }

      // Reserve N's marker before any label is placed (Earth's label, arrow labels).
      scope.hook((f) => {
        const n = neutralOnScreen(f);
        if (!n) return;
        const m = n.r + 2;
        (f.obstacles = f.obstacles ?? []).push({ x: n.N[0] - m, y: n.N[1] - m, w: 2 * m, h: 2 * m, tight: true, neutral: true });
      });

      // Hairline from the marker to the nearest point of the label rect (null if too short).
      function leader(N, rect, r) {
        const cx = Math.min(rect.x + rect.w, Math.max(rect.x, N[0]));
        const cy = Math.min(rect.y + rect.h, Math.max(rect.y, N[1]));
        const lx = cx - N[0];
        const ly = cy - N[1];
        const ll = Math.hypot(lx, ly);
        if (ll <= r + 6) return null;
        return {
          a: [N[0] + (lx / ll) * (r + 2.5), N[1] + (ly / ll) * (r + 2.5)],
          b: [cx - (lx / ll) * 2, cy - (ly / ll) * 2],
        };
      }

      scope.layer({
        id: "real-neutral",
        // Before the landmark labels (z 62): in step c, N's label is the one
        // that matters, so it picks its spot first, right after the arrow labels.
        z: 61.5,
        visible: () => showNeutral,
        draw(ctx, f) {
          const n = neutralOnScreen(f);
          if (!n) return;
          const { d, N, E, sep, r } = n;
          const q = f.sys.q;

          if (pulse.start >= 0 && !f.app.reducedMotion) {
            const t = (f.now - pulse.start) / 650;
            if (t >= 0 && t <= 1) {
              circle(ctx, N[0], N[1], r + 18 * t, { stroke: alpha(COLORS.text, 0.6 * (1 - t)), width: 1.5 });
            }
          }

          // Label with a hairline leader, placed clear of arrows and other labels;
          // the leader must not cross another label or Earth's dot either.
          layoutTideLabels(ctx, f);
          const color = COLORS.text2;
          const head = [{ text: tr("equalHead"), color }];
          const dist = distanceParts(d, q, color);
          const earthBox = { x: E[0] - 7, y: E[1] - 7, w: 14, h: 14, tight: true };
          const obstacles = [...(f.obstacles ?? []).filter((o) => !o.neutral), probeRect(f), earthBox];
          const segs = arrowSegments(f);
          const bounds = labelBounds(f);
          const perp = app.toScreen(1 - d, 1);
          const px = perp[0] - N[0];
          const py = perp[1] - N[1];
          const pl = Math.hypot(px, py) || 1;
          const up = [px / pl, py / pl];
          const along = [(E[0] - N[0]) / sep, (E[1] - N[1]) / sep];
          const dirs = [];
          for (const sgn of [1, -1]) {
            dirs.push([up[0] * sgn, up[1] * sgn]);
            dirs.push([up[0] * sgn + along[0] * 0.7, up[1] * sgn + along[1] * 0.7]);
            dirs.push([up[0] * sgn - along[0] * 0.7, up[1] * sgn - along[1] * 0.7]);
          }
          const size = 12;
          const weight = 600;
          const cands = around(N, dirs, [30, 42, 56, 72], size);
          const place = (lines, opts, checkLeader = true) => {
            for (const c of cands) {
              const s =
                lines.length === 1 ? findSpot(ctx, lines[0], [c], opts) : findBlockSpot(ctx, lines, [c], opts);
              if (!s) continue;
              const l = checkLeader && leader(N, s.rect, r);
              if (l && obstacles.some((o) => segHitsRect({ a: l.a, b: l.b, pad: 1 }, o))) continue;
              return s;
            }
            return null;
          };
          const opts = { size, weight, obstacles, segs, bounds, margin: 4 };
          let lines = [[...head, ...dist]];
          let spot = place(lines, opts);
          if (!spot) {
            // Narrow screens: two lines.
            lines = [[{ text: tr("equal"), color }], dist];
            spot =
              place(lines, opts) ??
              // Crowded: allow crossing an arrow (the halo keeps it legible).
              place(lines, { size, weight, obstacles, bounds }, false);
          }

          circle(ctx, N[0], N[1], r, { fill: COLORS.bg, stroke: COLORS.text2, width: 1.5 });
          if (!spot) return;
          const rect = spot.rect;
          const l = leader(N, rect, r);
          if (l) {
            line(ctx, l.a[0], l.a[1], l.b[0], l.b[1], alpha(COLORS.text2, 0.55), 1);
            (f.leaders = f.leaders ?? []).push({ a: l.a, b: l.b, pad: 2 });
          }
          if (lines.length === 1) {
            richLabel(ctx, lines[0], spot.x, spot.y, { size, weight, align: spot.align });
          } else {
            const lh = size * 1.25;
            richLabel(ctx, lines[0], spot.x, spot.y - lh / 2, { size, weight, align: spot.align });
            richLabel(ctx, lines[1], spot.x, spot.y + lh / 2, { size, weight, align: spot.align });
          }
          (f.obstacles = f.obstacles ?? []).push(rect);
        },
      });

      // ---- start ------------------------------------------------------------------------------------
      // Open on a calm, balanced scene (L4) instead of whatever unbalanced
      // chain the previous chapter left: the caption is about L1/L2 near Earth.
      // (L1-L3 move with the mass animation below; L4 and L5 do not.)
      if (state.snap?.name !== "L4" && state.snap?.name !== "L5") {
        app.snapTo("L4", { ease: 400, source: "chapter" });
        if (state.snap) state.snap.credited = true;
      }
      sayA();
    },
    exit() {
      // Leave the close-up so the next chapter starts on the whole system.
      // The mass stays at the real ratio: the slider tag says so.
      if (app.userZoomed || app.cam.flight) app.fitView();
    },
  };
}
