// Chapter 1 "Find the balance": the ghost-hand demo, the hunt for all five
// points, hints, payoff lines, and the "does L4 move?" prediction + sweep.

import { L_NAMES, accelerations, len } from "../physics.js";
import { START_PROBE, foundCount, saveProgress } from "../state.js";
import { COLORS, alpha, font } from "../theme.js";
import { circle, easeInOutCubic, label, line, rectsOverlap } from "../draw.js";
import { chainScale } from "../chain.js";
import { bodyRadii, ringRadius } from "../scene.js";
import { WORLD_BOX } from "../app.js";
import { t as tr } from "../strings.js";

export const PAYOFF = Object.fromEntries(L_NAMES.map((n) => [n, tr(`payoff.${n}`)]));

const AXIS = ["L1", "L2", "L3"];

// The hunt starts framed on the upper half (Sun, Earth, L1-L4): everything is
// ~1.5x larger. The L4 (or L5) moment frames that point's triangle.
const UPPER_BOX = { minX: WORLD_BOX.minX, maxX: WORLD_BOX.maxX, minY: -0.18, maxY: 1.12 };
const TRIANGLE_BOX = { minX: -0.22, maxX: 1.22, minY: -0.2, maxY: 1.1 };

function remaining(state) {
  return L_NAMES.filter((n) => !state.found[n]);
}

function progressCaption(state) {
  const left = remaining(state);
  const n = left.length;
  if (n === 0) return null;
  const axisLeft = left.filter((x) => AXIS.includes(x)).length;
  const offLeft = n - axisLeft;
  const count = tr("find.left", { n });
  if (axisLeft === 3 && offLeft > 0) return `${count} ${tr("find.threeOnLine")}`;
  if (axisLeft === 3) return `${count} ${tr("find.allThreeOnLine")}`;
  if (axisLeft > 0 && offLeft > 0) return `${count} ${tr("find.mixed", { axis: axisLeft, off: offLeft })}`;
  if (axisLeft > 0) return `${count} ${tr(axisLeft === 1 ? "find.lastOnLine" : "find.restOnLine")}`;
  if (state.found.L4 || state.found.L5) return `${count} ${tr("find.mirror")}`;
  return `${count} ${tr("find.twoOff")}`;
}

export function createFindChapter(app) {
  const story = app.story;

  return {
    id: "find",
    layers: {},
    enter(scope, opts = {}) {
      const state = app.state;
      let demo = null;
      let hintStage = 0;
      let lastProgress = performance.now();
      let flow = null; // "predict" | "sweep" | "result" while the L4 moment owns the caption
      let framing = null; // "upper" | "triangle" while this chapter moved the camera
      let dragging = false;
      const hand = { x: 0, y: 0, a: 0, press: 0 };
      const tags = []; // short labels near the target ring: { key, start, ms }

      // The demo's tweens are not scope-bound: stop it when the chapter exits.
      scope.add(() => {
        if (demo) demo.cancelled = true;
        hand.a = 0;
        if (framing && !app.userZoomed) app.fitView({ animate: false });
      });
      scope.on("pointerup", () => {
        dragging = false;
      });
      scope.on("userinput", ({ kind }) => {
        if (kind === "pointerdown" || kind === "drag") dragging = true;
      });

      // ---- camera framing -------------------------------------------------------------------------
      function frame(kind, box, ms = 800) {
        if (app.showBox(box, ms)) framing = kind;
      }
      function unframe() {
        if (!framing) return;
        framing = null;
        app.fitView();
      }
      scope.on("resize", () => {
        if (framing === "upper") frame("upper", UPPER_BOX, 0);
        else if (framing === "triangle") frame("triangle", triangleBox(state.snap?.name ?? "L4"), 0);
      });
      function triangleBox(name) {
        return name === "L5" ? { ...TRIANGLE_BOX, minY: -TRIANGLE_BOX.maxY, maxY: -TRIANGLE_BOX.minY } : TRIANGLE_BOX;
      }

      // ---- ghost hand, target pulse and tags ----------------------------------------------------------
      const targetPulse = { start: -1 };
      scope.layer({
        id: "ghost-hand",
        z: 135,
        draw(ctx, f) {
          if (targetPulse.start >= 0) {
            const k = (f.now - targetPulse.start) / 500;
            if (k >= 0 && k <= 1) {
              const [tx, ty] = f.chain.target;
              circle(ctx, tx, ty, 8 + 18 * k, { stroke: alpha(COLORS.text, 0.6 * (1 - k)), width: 2 });
            }
          }
          for (const tag of tags) {
            const age = f.now - tag.start;
            if (age > tag.ms || f.hide.target) continue;
            const a = Math.min(1, age / 180) * Math.min(1, (tag.ms - age) / 300);
            drawTag(ctx, f, tr(tag.key), a);
          }
          if (hand.a <= 0.01) return;
          ctx.globalAlpha = hand.a;
          circle(ctx, hand.x, hand.y, 14 - hand.press * 2, {
            fill: alpha(COLORS.text, 0.16),
            stroke: alpha(COLORS.text, 0.7),
            width: 1.5,
          });
          circle(ctx, hand.x, hand.y, 3, { fill: alpha(COLORS.text, 0.8) });
        },
      });
      scope.animate(() => tags.some((g) => performance.now() - g.start < g.ms));

      /** A short quiet label beside the target ring, on the freest side. */
      function drawTag(ctx, f, text, a) {
        const [tx, ty] = f.chain.target;
        ctx.save();
        ctx.font = font(12, 600);
        const w = ctx.measureText(text).width + 4;
        ctx.restore();
        const spots = [
          [tx + 14, ty - 16, "left"],
          [tx - 14, ty - 16, "right"],
          [tx + 14, ty + 18, "left"],
          [tx - 14, ty + 18, "right"],
        ];
        const P = f.chain.P;
        const r = ringRadius(f) + 4;
        const probe = { x: P[0] - r, y: P[1] - r, w: 2 * r, h: 2 * r };
        let pick = spots[0];
        for (const s of spots) {
          const left = s[2] === "left" ? s[0] : s[0] - w;
          const rect = { x: left, y: s[1] - 9, w, h: 18 };
          if (rect.x < 6 || rect.x + rect.w > f.w - 6) continue;
          if ((f.labelRects ?? []).some((o) => rectsOverlap(o, rect)) || rectsOverlap(probe, rect)) continue;
          pick = s;
          break;
        }
        label(ctx, text, pick[0], pick[1], COLORS.text, { size: 12, weight: 600, align: pick[2], alpha: a });
      }

      function addTag(key, ms = 2600) {
        if (app.reducedMotion) ms = Math.max(ms, 4000);
        tags.push({ key, start: performance.now(), ms });
        scope.animate(() => tags.some((g) => performance.now() - g.start < g.ms));
      }

      // ---- hint layer: brighten the locus ----------------------------------------------------------
      let locus = null; // "axis" | "midline"
      scope.layer({
        id: "hint-locus",
        z: 25,
        draw(ctx, f) {
          if (!locus) return;
          if (locus === "axis") {
            const a = app.toScreen(-3, 0);
            const b = app.toScreen(4, 0);
            line(ctx, a[0], a[1], b[0], b[1], alpha(COLORS.text2, 0.55), 2);
            return;
          }
          const a = app.toScreen(0.5, -3);
          const b = app.toScreen(0.5, 3);
          line(ctx, a[0], a[1], b[0], b[1], alpha(COLORS.text2, 0.55), 1.5, [6, 6]);
          // Label the line somewhere on screen, clear of the probe.
          const text = tr("find.midlineLabel");
          ctx.save();
          ctx.font = font(12, 500);
          const w = ctx.measureText(text).width;
          ctx.restore();
          const v = f.cam.view;
          const P = f.chain.P;
          for (const wy of [1.02, 0.6, -0.6, -1.02, 0.3, -0.3]) {
            const [x, y] = app.toScreen(0.5, wy);
            for (const [lx, align] of [[x + 10, "left"], [x - 10, "right"]]) {
              const left = align === "left" ? lx : lx - w;
              if (left < v.left + 8 || left + w > v.left + v.width - 8) continue;
              if (y < v.top + 10 || y > v.top + v.height - 10) continue;
              if (Math.hypot(x - P[0], y - P[1]) < 60) continue;
              label(ctx, text, lx, y, COLORS.text2, { size: 12, weight: 500, align });
              return;
            }
          }
        },
      });

      function clearHints() {
        hintStage = 0;
        locus = null;
        lastProgress = performance.now();
        app.invalidate();
      }

      // ---- captions -------------------------------------------------------------------------------
      const touch = app.size.coarse;
      const yourTurn = touch ? tr("find.yourTurnTouch") : tr("find.yourTurn");

      function huntCaption(prefix = "") {
        const n = foundCount(state);
        if (n === 5) return finale(prefix);
        const body = n === 0 ? yourTurn : progressCaption(state);
        story.say(prefix ? `${prefix} <span class="muted">${body}</span>` : body, []);
      }

      function finale(prefix = "") {
        app.ui.markChapterDone("find");
        unframe();
        const text = tr("find.finale");
        story.say(prefix ? `${prefix} <span class="muted">${text}</span>` : text, [
          { label: tr("chip.why"), primary: true, onClick: () => story.goto("triangle") },
          { label: tr("chip.letgo"), onClick: () => story.goto("letgo") },
        ]);
      }

      // ---- the demo --------------------------------------------------------------------------------
      /**
       * Where the ghost hand stops: about 30 px short of L4 on the midline, at
       * a spot where the Sun pull does not end on the Sun's disc (a knot of
       * arrow, disc and labels) and the white leftover is clearly visible.
       */
      function chooseDemoEnd() {
        // Called once the camera is framed, so the current scale is the one the
        // user will see.
        const sys = app.sys();
        const cam = app.cam;
        const s = app.scale();
        const { sunR } = bodyRadii({ app, sys });
        const L4y = sys.lPoints.L4[1];
        let pick = null;
        for (let px = 30; px <= 110; px += 2) {
          const y = L4y - px / s;
          const acc = accelerations(sys, 0.5, y);
          const k = chainScale(cam, sys, acc);
          const tip = [0.5 + (acc.sun[0] * k) / s, y + (acc.sun[1] * k) / s];
          const tipPx = Math.hypot(tip[0], tip[1]) * s;
          const leftPx = len(acc.net) * k;
          if (tipPx > sunR + 14 && leftPx > 34) {
            pick = [0.5, y];
            break;
          }
        }
        return pick ?? [0.5, L4y - 40 / s];
      }

      async function runDemo() {
        demo = { cancelled: false };
        const d = demo;
        const epoch = story.epoch;
        const dead = () => d.cancelled || story.epoch !== epoch || !scope.alive;
        state.busy = "demo";
        const end = chooseDemoEnd();
        const from = [end[0], Math.max(0.35, end[1] - 0.32)];
        app.morph = 0;
        app.setProbe(from[0], from[1], { source: "demo" });
        story.say(tr("find.demo"), [], { announce: true });
        await scope.wait(300);
        if (dead()) return;
        await app.tween(600, (k) => {
          if (!dead()) app.morph = k;
        }, { ease: easeInOutCubic });
        if (dead()) return;
        targetPulse.start = performance.now();
        scope.animate(() => performance.now() - targetPulse.start < 520);
        addTag("find.cmTag", 3200);
        await scope.wait(900);
        if (dead()) return;

        // Ghost hand drags the probe up the midline, stopping short of L4.
        const P0 = app.toScreen(from[0], from[1]);
        hand.x = P0[0];
        hand.y = P0[1];
        await app.tween(220, (k) => {
          if (!dead()) hand.a = k;
        });
        if (dead()) return;
        hand.press = 1;
        await app.tween(1800, (k) => {
          if (dead()) return;
          const x = from[0] + (end[0] - from[0]) * k;
          const y = from[1] + (end[1] - from[1]) * k;
          app.setProbe(x, y, { source: "demo" });
          const s = app.toScreen(x, y);
          hand.x = s[0];
          hand.y = s[1];
        }, { ease: easeInOutCubic });
        if (dead()) return;
        hand.press = 0;
        await app.tween(260, (k) => {
          if (!dead()) hand.a = 1 - k;
        });
        if (dead()) return;
        endDemo();
        // One reminder nudge if nothing happens.
        scope.timeout(() => {
          if (demo?.touched || foundCount(state) > 0) return;
          nudgeHint();
        }, 5600);
      }

      async function nudgeHint() {
        const sys = app.sys();
        const P = app.toScreen(state.probe[0], state.probe[1]);
        const L = app.toScreen(sys.lPoints.L4[0], sys.lPoints.L4[1]);
        const dx = (L[0] - P[0]) * 0.5;
        const dy = (L[1] - P[1]) * 0.5;
        hand.x = P[0];
        hand.y = P[1];
        await app.tween(200, (k) => {
          hand.a = k * 0.8;
        });
        await app.tween(700, (k) => {
          const w = Math.sin(k * Math.PI);
          hand.x = P[0] + dx * w;
          hand.y = P[1] + dy * w;
        });
        await app.tween(200, (k) => {
          hand.a = 0.8 * (1 - k);
        });
      }

      function endDemo() {
        if (!demo || !scope.alive) return;
        demo.cancelled = true;
        app.morph = state.arrows === "fan" ? 0 : 1;
        hand.a = 0;
        if (state.busy === "demo") state.busy = null;
        if (!state.demoDone) {
          state.demoDone = true;
          saveProgress(state);
        }
        huntCaption();
        app.ui.pulseTracker();
        clearHints();
        app.invalidate();
      }

      /** Reduced motion: no animated demo, one still frame and one caption. */
      function staticIntro() {
        const end = chooseDemoEnd();
        app.morph = state.arrows === "fan" ? 0 : 1;
        app.setProbe(end[0], end[1], { source: "demo" });
        state.demoDone = true;
        saveProgress(state);
        addTag("find.cmTag", 6000);
        story.say(`${tr("find.demo")} <span class="muted">${yourTurn}</span>`, []);
      }

      scope.on("userinput", () => {
        if (demo && !demo.cancelled) {
          demo.touched = true;
          endDemo();
        } else if (demo) {
          demo.touched = true;
        }
        if (hintStage > 0 && hintStage < 3) {
          // Keep an earned hint visible, but restart the clock.
          lastProgress = performance.now() - 12000;
        }
      });
      scope.on("escape", () => {
        if (demo && !demo.cancelled) endDemo();
      });

      // ---- finds ----------------------------------------------------------------------------------
      scope.on("found", ({ name, firstTime }) => {
        if (!firstTime) return;
        app.ui.popSlot(name);
        app.ui.announce(tr("find.announce", { name, n: foundCount(state) }), { force: true });
        clearHints();
        if ((name === "L4" || name === "L5") && !state.sweepSeen && !flow) {
          addTag("find.landsTag");
          flow = "predict";
          scope.timeout(() => l4Moment(name), 700);
          return;
        }
        if (name === "L4" || name === "L5") addTag("find.landsTag");
        if (!flow) huntCaption(PAYOFF[name]);
      });

      // Leaving the balanced spot ends a finished L4 result: the hunt goes on.
      scope.on("unsnap", () => {
        if (flow === "result") {
          flow = null;
          unframe();
          lastProgress = performance.now();
        }
      });

      function waitForRelease() {
        if (!dragging) return Promise.resolve();
        return new Promise((resolve) => {
          const off = app.on("pointerup", () => {
            off();
            resolve();
          });
          scope.add(off);
        });
      }

      async function l4Moment(name) {
        // The user may have moved on already: bring the probe back once the
        // drag is over, so the prediction is always asked at the point.
        if (state.snap?.name !== name) {
          await waitForRelease();
          if (!scope.alive) return;
          app.snapTo(name, { ease: 350, source: "flow" });
        }
        frame("triangle", triangleBox(name));
        const choice = await story.predict(tr("find.predict", { name }), [
          { label: tr("find.moves"), value: "moves" },
          { label: tr("find.stays"), value: "stays" },
        ]);
        if (!scope.alive) return;
        state.predicted = choice;
        flow = "sweep";
        if (state.snap?.name !== name) app.snapTo(name, { ease: 300, source: "flow" });
        story.say(tr("find.watch"));
        const result = await story.sweep();
        if (!scope.alive) return;
        state.sweepSeen = true;
        saveProgress(state);
        const guess = choice === "moves" ? tr("find.guessMoves") : "";
        const head = result === "done" ? `${tr("find.result")}${guess}` : tr("find.stopped");
        // The result stays until the user acts (hints are off while flow is set).
        flow = "result";
        if (result === "done" && state.snap?.name === name) app.traceLoop?.();
        story.say(head, [
          { label: tr("chip.whyShort"), primary: true, onClick: () => story.goto("triangle") },
          {
            label: tr("chip.keepHunting"),
            onClick: () => {
              flow = null;
              unframe();
              lastProgress = performance.now();
              huntCaption();
            },
          },
        ]);
      }

      // ---- hints ----------------------------------------------------------------------------------------
      scope.interval(() => {
        if (flow || state.busy || state.snap || demo?.cancelled === false) return;
        if (foundCount(state) === 5 || state.showAll) return;
        const idle = performance.now() - lastProgress;
        const left = remaining(state);
        const axisLeft = left.some((n) => AXIS.includes(n));
        const nearMidline = Math.abs(state.probe[0] - 0.5) < 0.08 && Math.abs(state.probe[1]) > 0.3;
        if (hintStage === 0 && idle > 20000) {
          hintStage = 1;
          const text =
            axisLeft && !nearMidline
              ? tr("hint.line")
              : nearMidline && (!state.found.L4 || !state.found.L5)
                ? tr("hint.shrink")
                : tr("hint.midline");
          story.say(text, []);
        } else if (hintStage === 1 && idle > 25000) {
          hintStage = 2;
          locus = axisLeft ? "axis" : "midline";
          // L5 lies outside the upper framing: show everything for the hint.
          if (!axisLeft && framing === "upper") unframe();
          app.invalidate();
        } else if (hintStage === 2 && idle > 45000) {
          hintStage = 3;
          story.say(tr("hint.stuck", { progress: progressCaption(state) }), [
            { label: tr("chip.showOne"), onClick: () => showOne() },
            { label: tr("chip.showAll"), onClick: () => story.showAll() },
          ]);
        }
      }, 1000);

      function showOne() {
        const sys = app.sys();
        const p = state.probe;
        let best = null;
        let bestD = Infinity;
        for (const n of remaining(state)) {
          const q = sys.lPoints[n];
          const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
          if (d < bestD) {
            bestD = d;
            best = n;
          }
        }
        if (!best) return;
        unframe();
        state.shown[best] = true;
        app.ui.syncTracker();
        story.jumpTo(best);
        story.say(tr("find.shown", { name: best, payoff: PAYOFF[best] }), []);
        clearHints();
      }

      scope.on("showall", () => {
        clearHints();
        unframe();
        story.say(tr("find.showAll"), []);
      });

      // ---- start ----------------------------------------------------------------------------------------
      const fresh = !state.found.L4 && !state.found.L5 && !opts.link?.probe;
      if (app.userZoomed && !opts.link?.probe) app.fitView({ animate: false });
      if (fresh) frame("upper", UPPER_BOX, state.demoDone ? 700 : 0);

      if (!state.demoDone && !opts.link?.probe) {
        state.probe = [...START_PROBE];
        if (app.reducedMotion) staticIntro();
        else runDemo();
      } else {
        app.morph = state.arrows === "fan" ? 0 : 1;
        // Coming back from a chapter that parked the probe on a point the user
        // has not found yet would give the answer away.
        const sys = app.sys();
        const onUnfound = L_NAMES.some((n) => {
          if (state.found[n] || state.shown[n] || state.showAll) return false;
          const p = sys.lPoints[n];
          return Math.hypot(p[0] - state.probe[0], p[1] - state.probe[1]) * app.scale() < 30;
        });
        if (opts.restart || (onUnfound && !opts.link?.probe)) {
          app.unsnap("chapter");
          app.setProbe(START_PROBE[0], START_PROBE[1], { ease: opts.restart ? 0 : 400, source: "chapter" });
        }
        huntCaption();
      }
    },
    exit() {
      if (app.state.busy === "demo") app.state.busy = null;
      app.morph = app.state.arrows === "fan" ? 0 : 1;
    },
  };
}
