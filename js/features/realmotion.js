// Feature "realmotion": press and hold to see the real (inertial) motion.
//
// The probe sits still in the co-rotating view, so the real motion of the
// whole picture is one rigid turn about the centre of mass (CM) per orbit.
// While held we spin the camera about the CM (cam.spin), draw the three
// orbit circles, and re-read the chain for the inertial view: the spin push
// disappears and a dashed "needed to turn" arrow runs from the probe P to the
// target T. At natural scale P -> T is exactly the centripetal acceleration
// w^2 (C - P) that keeps the probe circling the CM once per orbit, so
// balance now reads "gravity lands on the tip of needed to turn". The white
// leftover is the same vector (gravity minus needed); it is redrawn from the
// tip of "needed to turn" to where gravity lands, so it never hides that
// arrow (on the Sun-Earth line it keeps its lane at the probe).
//
// When the probe's orbit would mostly run off screen (zoomed in), the view
// turns about the probe instead of the CM: the same rigid turn, seen from a
// point that moves with the probe, so the arrows stay on screen.

import { worldToScreen } from "../camera.js";
import { L_NAMES } from "../physics.js";
import { markerVisible } from "../state.js";
import { badgeLayout, bodyRadii } from "../scene.js";
import { t as coreT } from "../strings.js";
import { defineStrings } from "../i18n.js";

export const REALMOTION_STRINGS = {
  en: {
    needed: "needed to turn",
    captionCm: "Real motion: everything circles the CM once per orbit",
    captionCmShort: "Real motion: all circle the CM once per orbit",
    captionLocal: "Real motion: the whole picture turns once per orbit",
    captionLocalShort: "Real motion: it all turns once per orbit",
    busy: "Real motion needs the probe at rest. Catch it first.",
    announceCm:
      "Real motion: the Sun, Earth and the probe circle the centre of mass together, once per orbit. The spin push is replaced by the pull needed to turn.",
    announceLocal: "Real motion: the whole picture turns once per orbit. The spin push is replaced by the pull needed to turn.",
  },
  ru: {
    needed: "нужно для поворота",
    captionCm: "Реальное движение: всё обращается вокруг ЦМ, один оборот за период",
    captionCmShort: "Реальное движение: всё кружит вокруг ЦМ",
    captionLocal: "Реальное движение: вся картина поворачивается раз за оборот",
    captionLocalShort: "Реальное движение: всё поворачивается",
    busy: "Для реального движения зонд должен стоять. Сначала поймайте его.",
    announceCm:
      "Реальное движение: Солнце, Земля и зонд вместе обращаются вокруг центра масс, один оборот за период. Вместо центробежной силы — притяжение, нужное для поворота.",
    announceLocal:
      "Реальное движение: вся картина поворачивается раз за оборот. Вместо центробежной силы — притяжение, нужное для поворота.",
  },
};
const tr = defineStrings(REALMOTION_STRINGS);
import { COLORS, LEG_STYLE, alpha, font } from "../theme.js";
import { arrow, circle, label, line, rectsOverlap, smoothstep } from "../draw.js";

const ORBITS_PER_SECOND = 0.25;
const OMEGA_DISPLAY = 2 * Math.PI * ORBITS_PER_SECOND; // rad per second of real time
const RAMP_MS = 250; // spin speed eases in over this
const FADE_IN_MS = 200; // overlays fade in over this
const RETURN_MIN_MS = 240; // spin back to 0 (scaled with the angle left)
const RETURN_MAX_MS = 380;
const TRAIL_MAX = (55 * Math.PI) / 180; // longest motion trail behind a body
const STATIC_TRAIL = (40 * Math.PI) / 180; // reduced motion: fixed trail length
const NEEDED_DASH = [6, 4];
const NEEDED_LABEL = tr("needed");
const CAPTION_CM = tr("captionCm");
const CAPTION_CM_SHORT = tr("captionCmShort");
const CAPTION_LOCAL = tr("captionLocal");
const CAPTION_LOCAL_SHORT = tr("captionLocalShort");

const Z_ORBITS = 32; // with the guides, under sight lines and markers
const Z_SIGHT = 41; // replaces the core sight layer (40) while held
const Z_NEEDED = 78; // just under the gravity legs, so their tip lands on it
const Z_LABEL = 121; // after the core labels, so it can avoid them
const Z_CAPTION = 55; // over guides and L markers, under bodies, the probe and every arrow

function wrapAngle(a) {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  if (x <= -Math.PI) x += 2 * Math.PI;
  return x;
}

export function install(app) {
  const rm = {
    phase: "idle", // "idle" | "hold" | "return"
    amount: 0, // 0..1: strength of every overlay
    ramp: 0, // 0..1: fraction of the full spin rate reached
    travelled: 0, // radians turned during this hold (trail length)
    mode: "cm", // "cm": turn about the CM | "local": ride along with the probe
    anchor: null, // world point the view turns about in "local" mode
    ret: null, // { from, delta, v0, start, duration, amountFrom }
    last: null, // time of the previous tick
    cancel: null, // ticker cancel()
    size: null, // window size when the hold started
    by: null, // { pointer: id } | { key: true }: what started the hold
  };

  // ---- pivot ------------------------------------------------------------------------------
  function probeOrbitOnScreen() {
    const cam = app.cam;
    const flat = { ...cam, spin: 0 };
    const sys = app.sys();
    const C = sys.cm;
    const P = app.state.probe;
    const r = Math.hypot(P[0] - C[0], P[1] - C[1]);
    const v = cam.view;
    const N = 72;
    let inside = 0;
    for (let i = 0; i < N; i += 1) {
      const t = (i / N) * 2 * Math.PI;
      const [sx, sy] = worldToScreen(flat, C[0] + r * Math.cos(t), C[1] + r * Math.sin(t));
      if (sx >= v.left && sx <= v.left + v.width && sy >= v.top && sy <= v.top + v.height) inside += 1;
    }
    return inside / N;
  }

  function choosePivot() {
    // Turn about the CM when most of the probe's real orbit stays in view:
    // then the bodies visibly circle the CM. Zoomed in, that turn would fling
    // everything off screen within a fraction of a second, so ride along
    // with the probe (or the view centre if the probe is off screen) instead.
    if (probeOrbitOnScreen() >= 0.5) {
      rm.mode = "cm";
      rm.anchor = null;
      return;
    }
    rm.mode = "local";
    const cam = app.cam;
    const flat = { ...cam, spin: 0 };
    const P = app.state.probe;
    const [sx, sy] = worldToScreen(flat, P[0], P[1]);
    const v = cam.view;
    const mx = v.width * 0.1;
    const my = v.height * 0.1;
    const probeInView = sx >= v.left + mx && sx <= v.left + v.width - mx && sy >= v.top + my && sy <= v.top + v.height - my;
    // Fixed for the whole hold, so dragging the probe meanwhile still maps
    // the pointer consistently (toWorld/toScreen share one pivot).
    rm.anchor = probeInView ? [P[0], P[1]] : [cam.center[0], cam.center[1]];
  }

  function updatePivot() {
    const cam = app.cam;
    const p = rm.mode === "cm" ? app.sys().cm : rm.anchor;
    if (cam.pivot[0] !== p[0] || cam.pivot[1] !== p[1]) cam.pivot = [p[0], p[1]];
  }

  // ---- state machine ------------------------------------------------------------------------
  function ensureTicker() {
    if (rm.cancel) return;
    rm.last = null;
    rm.cancel = app.animate(tick);
  }

  function stopTicker() {
    rm.cancel?.();
    rm.cancel = null;
    rm.last = null;
  }

  function start() {
    if (app.state.busy === "release") {
      app.ui?.toast?.(tr("busy"));
      releaseChip();
      return;
    }
    if (rm.phase === "hold") return;
    rm.by = triggerOf();
    fadeMenu(true);
    if (rm.phase === "idle") {
      choosePivot();
      rm.travelled = 0;
      rm.ramp = 0;
      rm.amount = 0;
      rm.size = { w: app.size.w, h: app.size.h, rot: app.cam.rot };
      app.ui?.announce?.(
        rm.mode === "cm" ? tr("announceCm") : tr("announceLocal"),
        { force: true },
      );
    } else {
      // Pressed again while springing back: carry on from here.
      rm.ramp = Math.min(rm.ramp, 0.5);
    }
    rm.phase = "hold";
    rm.ret = null;
    if (app.reducedMotion) {
      rm.amount = 1;
      rm.ramp = 0;
      app.cam.spin = 0;
      stopTicker();
      moveHookLast();
      app.invalidate();
      return;
    }
    moveHookLast();
    ensureTicker();
  }

  function stop() {
    if (rm.phase !== "hold") return;
    fadeMenu(false);
    if (app.reducedMotion || Math.abs(wrapAngle(app.cam.spin)) < 1e-6 && rm.amount <= 0) {
      reset();
      return;
    }
    const from = wrapAngle(app.cam.spin);
    const delta = -from; // the short way back to 0
    const duration = RETURN_MIN_MS + (RETURN_MAX_MS - RETURN_MIN_MS) * Math.min(1, Math.abs(delta) / Math.PI);
    const v0 = OMEGA_DISPLAY * smoothstep(0, 1, rm.ramp); // rad per second, current spin rate
    rm.phase = "return";
    rm.ret = { from, delta, v0, start: null, duration, amountFrom: rm.amount };
    ensureTicker();
  }

  /** Drop everything immediately: spin 0, no overlays. */
  function reset() {
    stopTicker();
    fadeMenu(false);
    rm.phase = "idle";
    rm.amount = 0;
    rm.ramp = 0;
    rm.travelled = 0;
    rm.ret = null;
    app.cam.spin = 0;
    app.invalidate();
  }

  function releaseChip() {
    // The legend chip keeps its pressed look until pointerup; clear it when
    // we end the hold ourselves so it never looks stuck.
    document.getElementById("real-motion-btn")?.classList.remove("is-held");
  }

  function tick(now) {
    const cam = app.cam;
    const dt = rm.last === null ? 0 : Math.min(64, now - rm.last);
    rm.last = now;

    if (app.state.busy === "release" && rm.phase === "hold") {
      releaseChip();
      stop();
    }

    if (rm.phase === "hold") {
      if (app.reducedMotion) {
        cam.spin = 0;
        rm.amount = 1;
        rm.cancel = null;
        app.invalidate();
        return false;
      }
      updatePivot();
      rm.ramp = Math.min(1, rm.ramp + dt / RAMP_MS);
      rm.amount = Math.min(1, rm.amount + dt / FADE_IN_MS);
      const step = (OMEGA_DISPLAY * smoothstep(0, 1, rm.ramp) * dt) / 1000;
      cam.spin = wrapAngle(cam.spin + step);
      rm.travelled = Math.min(TRAIL_MAX, rm.travelled + step);
      return true;
    }

    if (rm.phase === "return") {
      const r = rm.ret;
      if (app.reducedMotion || !r) {
        rm.cancel = null;
        reset();
        return false;
      }
      updatePivot();
      if (r.start === null) r.start = now;
      const t = Math.min(1, (now - r.start) / r.duration);
      // Cubic Hermite from the current angle and speed to rest at 0: no jolt
      // when the hand lets go, and it settles exactly on the co-rotating view.
      const D = r.duration / 1000;
      const h10 = t * t * t - 2 * t * t + t;
      const h01 = -2 * t * t * t + 3 * t * t;
      cam.spin = r.from + h10 * r.v0 * D + h01 * r.delta;
      rm.amount = r.amountFrom * (1 - smoothstep(0, 1, t));
      rm.ramp = Math.max(0, 1 - t);
      if (t >= 1) {
        rm.cancel = null;
        reset();
        return false;
      }
      return true;
    }

    rm.cancel = null;
    return false;
  }

  // ---- events -------------------------------------------------------------------------------
  app.on("realmotion", (e) => {
    if (e?.on) start();
    else stop();
  });
  app.on("chapterexit", () => endHold(true));
  app.on("resize", () => {
    if (rm.phase === "idle") {
      if (app.cam.spin) reset();
      return;
    }
    const s = rm.size;
    // Only a real window change (or phone rotation) cancels; the dock
    // growing a line does not.
    if (!s || s.w !== app.size.w || s.h !== app.size.h || s.rot !== app.cam.rot) endHold(true);
  });
  app.on("escape", () => endHold(false));
  window.addEventListener("blur", () => endHold(false));
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) endHold(true);
  });

  // Safety net: remember which pointer or key started the hold and end it
  // when that pointer lifts or that key comes up anywhere, even if the
  // button that started it never hears about it.
  let lastDown = null;
  let lastKey = null;
  window.addEventListener(
    "pointerdown",
    (e) => {
      lastDown = { id: e.pointerId, t: performance.now() };
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.key === " " || e.key === "Enter") lastKey = { t: performance.now() };
    },
    true,
  );
  // A long press on a touch screen opens the context menu (Android) and
  // steals the pointer; while the hold runs, the press is the gesture.
  window.addEventListener(
    "contextmenu",
    (e) => {
      if (rm.phase === "hold") e.preventDefault();
    },
    true,
  );
  const liftPointer = (e) => {
    if (rm.phase === "hold" && rm.by?.pointer === e.pointerId) endHold(false);
  };
  window.addEventListener("pointerup", liftPointer, true);
  window.addEventListener("pointercancel", liftPointer, true);
  window.addEventListener(
    "keyup",
    (e) => {
      if (rm.phase === "hold" && rm.by?.key && (e.key === " " || e.key === "Enter")) endHold(false);
    },
    true,
  );

  function triggerOf() {
    // start() runs inside the dispatch of the event that caused it.
    const now = performance.now();
    if (lastDown && now - lastDown.t < 40) return { pointer: lastDown.id };
    if (lastKey && now - lastKey.t < 40) return { key: true };
    return null;
  }

  /** End the hold from our side (animated, or at once). */
  function endHold(immediate) {
    if (rm.phase === "idle") return;
    releaseChip();
    if (immediate) reset();
    else stop();
  }

  // Holding the item in the open ⋯ menu: let the scene show through the
  // menu (it covers most of a phone screen) and bring it back on release.
  let menuFaded = false;
  function fadeMenu(on) {
    const menu = app.ui?.els?.menu;
    if (!menu) return;
    if (on) {
      if (menu.hidden || menuFaded) return;
      menuFaded = true;
      menu.style.transition = app.reducedMotion ? "none" : "opacity 150ms ease";
      menu.style.opacity = "0";
    } else if (menuFaded) {
      menuFaded = false;
      menu.style.opacity = "";
      // Let the fade back in run, then hand the element back untouched.
      setTimeout(() => {
        if (!menuFaded) menu.style.transition = "";
      }, 200);
    }
  }

  // ---- frame hook: re-read the chain for the inertial view -------------------------------------
  function hook(frame) {
    if (rm.amount <= 0) return;
    const f = frame;
    const info = {
      amount: rm.amount,
      mode: rm.mode,
      reinterpret: false,
      sight: false,
      cfVisible: false,
      qConnector: null,
    };
    f.realMotion = info;
    // Labels drawn by the core and other modules steer clear of the pill.
    const obstacles = (f.obstacles = f.obstacles ?? []);
    obstacles.push(captionGeometry(f).rect);
    // A flying probe is not at rest in the spinning view, and custom
    // arrow sets (tide view) have no target: leave those alone.
    const cfHidden = Boolean(f.hideLegs?.cf);
    const tideView = Boolean(f.tide && f.tide.blend > 0.5); // realscale's own arrows
    if (f.state.busy === "release" || f.hide.chain || f.hide.target || cfHidden || tideView) return;
    info.reinterpret = true;
    info.cfVisible = true;
    f.hideLegs = { ...(f.hideLegs ?? {}), cf: true };
    const conns = f.chain.connectors;
    if (conns.length === 3) {
      info.qConnector = conns[2];
      f.chain.connectors = conns.slice(0, 2);
    }
    if (f.state.layers.sight && !f.hide.sight && f.state.arrows === "chain") {
      f.hide.sight = true;
      info.sight = true;
    }
    // The leftover is the same vector (gravity - needed), but it now reads
    // best as the gap from the tip of "needed to turn" to where gravity
    // actually lands. Drawn from the probe it would lie right on top of the
    // needed arrow whenever gravity overshoots along the tether (the whole
    // midline). On the axis (lanes) it keeps its lane-0 place at the probe,
    // as in the spinning view.
    const chain = f.chain;
    const net = chain.net;
    const { s, e, length } = neededGeometry(f);
    const P = chain.P;
    // The core leg labels only avoid boxes: without these they can sit on
    // the "needed to turn" shaft, e.g. right on its tip at L4, exactly
    // where gravity is meant to be seen landing.
    if (length > 1) {
      const steps = Math.ceil(length / 7);
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const x = s[0] + (e[0] - s[0]) * t;
        const y = s[1] + (e[1] - s[1]) * t;
        obstacles.push({ x: x - 3.5, y: y - 3.5, w: 7, h: 7 });
      }
    }
    // Fan mode draws every arrow from the probe, so the leftover stays there.
    const w = rm.amount * (1 - chain.laneWeight) * chain.morph;
    let sx = P[0] + (e[0] - P[0]) * w;
    let sy = P[1] + (e[1] - P[1]) * w;
    const vx = net.end[0] - net.start[0];
    const vy = net.end[1] - net.start[1];
    // When gravity falls short straight along the tether (outer midline),
    // the leftover runs back over the needed arrow: give it its own lane,
    // on the side away from where the Earth pull comes in. In fan mode both
    // start at the probe, so the same happens when they point the same way.
    if (length > 1 && net.length > 1) {
      const ux = (e[0] - s[0]) / length;
      const uy = (e[1] - s[1]) / length;
      const cos = (vx * ux + vy * uy) / net.length;
      const deg = (c) => (Math.acos(Math.min(1, Math.max(-1, c))) * 180) / Math.PI;
      const fan = rm.amount * (1 - chain.laneWeight) * (1 - chain.morph);
      const lane = smoothstep(12, 4, deg(-cos)) * w + smoothstep(12, 4, deg(cos)) * fan;
      if (lane > 0.001) {
        let nx = -uy;
        let ny = ux;
        const J = chain.joints[1]; // tip of the Sun pull, where the Earth pull starts
        if ((J[0] - s[0]) * nx + (J[1] - s[1]) * ny > 0) {
          nx = -nx;
          ny = -ny;
        }
        const gap = (f.app.size.phone ? 8 : 9) * lane;
        sx += nx * gap;
        sy += ny * gap;
      }
    }
    chain.net = { start: [sx, sy], end: [sx + vx, sy + vy], length: net.length };
  }
  app.frameHooks.push(hook);

  /** Keep our hook after any chapter hooks so we see (and win over) theirs. */
  function moveHookLast() {
    const i = app.frameHooks.indexOf(hook);
    if (i >= 0) app.frameHooks.splice(i, 1);
    app.frameHooks.push(hook);
  }

  /** Screen offset of lane 2 (where the spin leg sat) for the needed arrow. */
  function laneShift(chain, phone) {
    const off = chain.laneWeight * 2 * (phone ? 8 : 9);
    return [chain.laneNormal[0] * off, chain.laneNormal[1] * off];
  }

  function neededGeometry(f) {
    const chain = f.chain;
    const [dx, dy] = laneShift(chain, f.app.size.phone);
    const s = [chain.P[0] + dx, chain.P[1] + dy];
    const e = [chain.target[0] + dx, chain.target[1] + dy];
    return { s, e, length: Math.hypot(e[0] - s[0], e[1] - s[1]) };
  }

  // ---- orbit circles and motion trails -----------------------------------------------------
  app.addLayer({
    id: "realmotion-orbits",
    z: Z_ORBITS,
    visible: (f) => Boolean(f.realMotion) && f.realMotion.mode === "cm",
    draw(ctx, f) {
      const a = f.realMotion.amount;
      const sys = f.sys;
      const s = app.scale();
      const C = app.toScreen(sys.cm[0], sys.cm[1]);
      const P = f.state.probe;
      const S = app.toScreen(0, 0);
      const E = app.toScreen(1, 0);
      const Ps = f.chain.P;
      const rP = Math.hypot(P[0] - sys.cm[0], P[1] - sys.cm[1]) * s;
      const { sunR, earthR } = bodyRadii(f);
      // With the compass circles (radius a about the Sun and Earth) on
      // screen, two more full circles about the CM are one pair too many:
      // the Sun and Earth then show their path by the trail alone.
      const compassLayer = app.layers.find((l) => l.id === "compass");
      const compass = Boolean(compassLayer && (!compassLayer.visible || compassLayer.visible(f)));
      const bodies = [
        { r: sys.mu * s, at: S, color: COLORS.sun, size: sunR, ring: !compass },
        { r: (1 - sys.mu) * s, at: E, color: COLORS.earth, size: earthR, ring: !compass },
      ];
      if (!f.hide.probe) bodies.push({ r: rP, at: Ps, color: COLORS.text, size: f.app.size.phone ? 17 : 15, ring: true });
      const still = f.app.reducedMotion;
      const trail = still ? STATIC_TRAIL : rm.travelled;
      ctx.globalAlpha = a;
      for (const b of bodies) {
        if (b.r < 6) continue;
        if (b.ring) circle(ctx, C[0], C[1], b.r, { stroke: alpha(b.color, 0.3), width: 1, dash: [3, 5] });
        if (trail > 0.01) {
          // Canvas angles grow clockwise on screen; the motion is
          // counter-clockwise, so the path already covered lies at larger
          // angles than the body.
          const ang = Math.atan2(b.at[1] - C[1], b.at[0] - C[0]);
          ctx.save();
          ctx.strokeStyle = alpha(b.color, 0.45);
          ctx.lineWidth = 1.5;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.arc(C[0], C[1], b.r, ang, ang + trail);
          ctx.stroke();
          ctx.restore();
        }
        if (still && b.r > 3 * b.size) {
          // Nothing moves, so a small head just ahead of each body says
          // which way it goes round.
          const ang = Math.atan2(b.at[1] - C[1], b.at[0] - C[0]) - (b.size + 9) / b.r;
          const hx = C[0] + Math.cos(ang) * b.r;
          const hy = C[1] + Math.sin(ang) * b.r;
          const tx = Math.sin(ang);
          const ty = -Math.cos(ang);
          ctx.save();
          ctx.fillStyle = alpha(b.color, 0.6);
          ctx.beginPath();
          ctx.moveTo(hx + tx * 4, hy + ty * 4);
          ctx.lineTo(hx - tx * 4 - ty * 4, hy - ty * 4 + tx * 4);
          ctx.lineTo(hx - tx * 4 + ty * 4, hy - ty * 4 - tx * 4);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }
    },
  });

  // ---- sight lines with a neutral tether (the radius of the probe's orbit) ----------------------
  app.addLayer({
    id: "realmotion-sight",
    z: Z_SIGHT,
    visible: (f) => Boolean(f.realMotion?.sight),
    draw(ctx, f) {
      const { P, C } = f.chain;
      const S = app.toScreen(0, 0);
      const E = app.toScreen(1, 0);
      const amt = f.realMotion.amount;
      ctx.globalAlpha = f.chainAlpha * Math.min(1, f.chain.morph + 0.2);
      line(ctx, P[0], P[1], S[0], S[1], alpha(COLORS.sun, 0.2), 1);
      line(ctx, P[0], P[1], E[0], E[1], alpha(COLORS.earth, 0.2), 1);
      if (amt < 1) line(ctx, C[0], C[1], P[0], P[1], alpha(COLORS.spin, 0.32 * (1 - amt)), 1, [3, 4]);
      line(ctx, C[0], C[1], P[0], P[1], alpha(COLORS.text2, 0.4 * amt), 1, [3, 4]);
    },
  });

  // ---- the "needed to turn" arrow (and the spin leg fading out) ------------------------------
  app.addLayer({
    id: "realmotion-needed",
    z: Z_NEEDED,
    visible: (f) => Boolean(f.realMotion?.reinterpret),
    draw(ctx, f) {
      const info = f.realMotion;
      const chain = f.chain;
      const width = f.app.size.phone ? 2.5 : 3;
      const dim = f.dimLegs ?? null;
      const dimA = dim && dim !== "cf" ? 0.25 : 1;
      if (info.amount < 1) {
        // The spin leg crossfades into its mirror image.
        ctx.save();
        ctx.globalAlpha = f.chainAlpha * (1 - info.amount);
        if (info.qConnector) {
          const [p0, p1] = info.qConnector;
          line(ctx, p0[0], p0[1], p1[0], p1[1], COLORS.guide, 1, [1.5, 3]);
        }
        const cf = chain.legs[2];
        arrow(ctx, cf.start[0], cf.start[1], cf.end[0], cf.end[1], {
          color: LEG_STYLE.cf.color,
          width,
          dash: LEG_STYLE.cf.dash,
          alpha: dimA,
        });
        ctx.restore();
      }
      const { s, e } = neededGeometry(f);
      ctx.globalAlpha = f.chainAlpha * info.amount;
      arrow(ctx, s[0], s[1], e[0], e[1], {
        color: COLORS.text2,
        width,
        dash: NEEDED_DASH,
        alpha: dimA,
      });
    },
  });

  // ---- its label, placed clear of the core labels ---------------------------------------------
  app.addLayer({
    id: "realmotion-label",
    z: Z_LABEL,
    visible: (f) =>
      Boolean(f.realMotion?.reinterpret) &&
      f.realMotion.amount > 0.05 &&
      f.state.layers.labels &&
      !f.hide.labels &&
      f.chainAlpha > 0.5,
    draw(ctx, f) {
      const chain = f.chain;
      const { s, e, length } = neededGeometry(f);
      if (length < 36) return;
      const size = 12;
      ctx.font = font(size, 600);
      const w = ctx.measureText(NEEDED_LABEL).width + 4;
      const h = size * 1.2 + 4;
      const ux = (e[0] - s[0]) / length;
      const uy = (e[1] - s[1]) / length;
      let nx = -uy;
      let ny = ux;
      const lanes = chain.laneWeight > 0.5;
      if (lanes) {
        [nx, ny] = chain.laneNormal;
      } else {
        const mx = (s[0] + e[0]) / 2;
        const my = (s[1] + e[1]) / 2;
        if (nx * (mx - chain.centroid[0]) + ny * (my - chain.centroid[1]) < 0) {
          nx = -nx;
          ny = -ny;
        }
      }
      const placed = f.labelRects ? [...f.labelRects] : [];
      if (!f.labelRects) {
        const ringR = f.app.size.phone ? 17 : 15;
        placed.push({ x: chain.P[0] - ringR - 3, y: chain.P[1] - ringR - 3, w: 2 * ringR + 6, h: 2 * ringR + 6 });
        placed.push({ x: chain.target[0] - 10, y: chain.target[1] - 10, w: 20, h: 20 });
      }
      placed.push(...badgeLayout(f).map((b) => b.rect), ...sceneTextRects(ctx, f));
      const segments = arrowSegments(f, s, e);

      // Beside its own arrow only: in lanes the far side of lane 2 is the
      // stack of gravity legs, where the label would name the wrong arrow.
      const sides = lanes ? [1] : [1, -1];
      const alongs = [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78];
      for (const extra of [0, 8, 16]) {
        for (const side of sides) {
          for (const along of alongs) {
            const mx = s[0] + (e[0] - s[0]) * along;
            const my = s[1] + (e[1] - s[1]) * along;
            const cnx = nx * side;
            const cny = ny * side;
            const reach = 7 + extra + Math.abs(cnx) * (w / 2) + Math.abs(cny) * (h / 2);
            const cx = mx + cnx * reach;
            const cy = my + cny * reach;
            const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
            if (rect.x < 4 || rect.y < 4 || rect.x + rect.w > f.w - 4 || rect.y + rect.h > f.h - 4) continue;
            if (placed.some((r) => rectsOverlap(r, rect))) continue;
            if (segments.some((sg) => segmentHitsRect(sg, rect, 1.5))) continue;
            label(ctx, NEEDED_LABEL, cx, cy, COLORS.text2, { size, weight: 600, alpha: f.realMotion.amount });
            if (f.labelRects) f.labelRects.push(rect);
            return;
          }
        }
      }
    },
  });

  /** Visible arrows as screen segments, so the label never sits on one. */
  function arrowSegments(f, s, e) {
    const chain = f.chain;
    const segs = [[s, e]];
    if (!f.hide.chain) {
      for (const leg of chain.legs) {
        if (f.hideLegs?.[leg.key] || leg.length < 1) continue;
        segs.push([leg.start, leg.end]);
      }
      if (!f.hide.leftover && !f.snapped && chain.net.length >= 0.5) segs.push([chain.net.start, chain.net.end]);
    }
    return segs;
  }

  /** Signed px distance of the probe from the Sun-Earth line (as in scene.js). */
  function axisSide(f) {
    const S = app.toScreen(0, 0);
    const E = app.toScreen(1, 0);
    const P = f.chain.P;
    const ax = E[0] - S[0];
    const ay = E[1] - S[1];
    const l = Math.hypot(ax, ay) || 1;
    return ((P[0] - S[0]) * -ay + (P[1] - S[1]) * ax) / l;
  }

  /** Unit normal to the axis, away from the probe; steady when the probe is on it. */
  function bodyLabelSide(f) {
    const S = app.toScreen(0, 0);
    const E = app.toScreen(1, 0);
    const ax = E[0] - S[0];
    const ay = E[1] - S[1];
    const l = Math.hypot(ax, ay) || 1;
    const flip = axisSide(f) > 0.5 ? -1 : 1;
    return [(-ay / l) * flip, (ax / l) * flip];
  }

  /** Where the body labels go: [{ text, x, y, size, color, body }] (scene.js layout). */
  function bodyLabelSpots(f) {
    const { sunR, earthR } = bodyRadii(f);
    const S = app.toScreen(0, 0);
    const E = app.toScreen(1, 0);
    const C = app.toScreen(f.sys.cm[0], f.sys.cm[1]);
    const nearSun = Math.hypot(C[0] - S[0], C[1] - S[1]) < sunR + 6;
    const [sx, sy] = bodyLabelSide(f);
    const spot = (pt, r, text, color, size) => {
      const off = r + (size >= 13 ? 12 : 11);
      const body = { x: pt[0] - r - 2, y: pt[1] - r - 2, w: 2 * r + 4, h: 2 * r + 4 };
      return { text, color, size, x: pt[0] + sx * off, y: pt[1] + sy * off, body };
    };
    const spots = [spot(S, sunR, coreT("body.sun"), COLORS.sun, 13), spot(E, earthR, coreT("body.earth"), COLORS.earth, 13)];
    if (!nearSun) spots.push(spot(C, 5, coreT("body.cm"), COLORS.text3, 11));
    return spots;
  }

  /** Bodies, the CM mark and the visible L-point diamonds (screen boxes). */
  function markRects(f) {
    const rects = [];
    const { sunR, earthR } = bodyRadii(f);
    const box = (p, r) => rects.push({ x: p[0] - r - 2, y: p[1] - r - 2, w: 2 * r + 4, h: 2 * r + 4 });
    box(app.toScreen(0, 0), sunR);
    box(app.toScreen(1, 0), earthR);
    box(app.toScreen(f.sys.cm[0], f.sys.cm[1]), 6.5);
    if (!f.hide.markers) {
      for (const name of L_NAMES) {
        if (!markerVisible(f.state, name)) continue;
        const p = f.sys.lPoints[name];
        box(app.toScreen(p[0], p[1]), 5.5);
      }
    }
    return rects;
  }

  /** L-point, body and CM labels drawn by scene.js (approximate boxes). */
  function sceneTextRects(ctx, f) {
    const rects = [];
    const box = (text, x, y, size, align) => {
      ctx.save();
      ctx.font = font(size, 650);
      const tw = ctx.measureText(text).width;
      ctx.restore();
      const left = align === "left" ? x : x - tw / 2;
      rects.push({ x: left - 2, y: y - size * 0.6 - 2, w: tw + 4, h: size * 1.2 + 4 });
    };
    if (!f.hide.markers) {
      for (const name of L_NAMES) {
        if (!markerVisible(f.state, name)) continue;
        const p = f.sys.lPoints[name];
        const [x, y] = app.toScreen(p[0], p[1]);
        rects.push({ x: x - 7, y: y - 7, w: 14, h: 14 });
        const off = f.snapped === name ? 22 : 13;
        const onAxis = name === "L1" || name === "L2" || name === "L3";
        const lx = x + (f.cam.rot && onAxis ? off + 4 : off * 0.9);
        const ly = y - (f.cam.rot && onAxis ? 0 : off);
        box(name, lx, ly, 13, "left");
      }
    }
    if (!f.hide.bodyLabels) {
      // Same layout as scene.js: labels sit on the side of the axis away from P.
      for (const sp of bodyLabelSpots(f)) {
        box(sp.text, sp.x, sp.y, sp.size, "center");
        rects.push(sp.body);
      }
    }
    return rects;
  }

  function segmentHitsRect([a, b], r, pad) {
    const x0 = r.x - pad;
    const y0 = r.y - pad;
    const x1 = r.x + r.w + pad;
    const y1 = r.y + r.h + pad;
    // Liang-Barsky clip of the segment against the rectangle.
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    let t0 = 0;
    let t1 = 1;
    const tests = [
      [-dx, a[0] - x0],
      [dx, x1 - a[0]],
      [-dy, a[1] - y0],
      [dy, y1 - a[1]],
    ];
    for (const [p, q] of tests) {
      if (p === 0) {
        if (q < 0) return false;
        continue;
      }
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
    return t0 <= t1;
  }

  // ---- caption badge at the top centre --------------------------------------------------------
  const CAPTION_SIZE = 12;
  const CAPTION_PAD_X = 10;
  const CAPTION_H = 24;

  /** Text and rect of the pill (shared by the hook, for label obstacles, and the layer). */
  function captionGeometry(f) {
    const ctx = app.ctx;
    const v = f.cam.view;
    ctx.save();
    ctx.font = font(CAPTION_SIZE, 500);
    let text = rm.mode === "cm" ? CAPTION_CM : CAPTION_LOCAL;
    if (ctx.measureText(text).width + 2 * CAPTION_PAD_X > v.width - 32) {
      text = rm.mode === "cm" ? CAPTION_CM_SHORT : CAPTION_LOCAL_SHORT;
    }
    const w = ctx.measureText(text).width + 2 * CAPTION_PAD_X;
    ctx.restore();
    const cx = v.left + v.width / 2;
    const cy = v.top + (f.app.size.phone ? 14 : 18);
    return { text, cx, cy, w, rect: { x: cx - w / 2, y: cy - CAPTION_H / 2, w, h: CAPTION_H } };
  }

  app.addLayer({
    id: "realmotion-caption",
    z: Z_CAPTION,
    visible: (f) => Boolean(f.realMotion),
    draw(ctx, f) {
      const { text, cx, cy, w } = captionGeometry(f);
      const hgt = CAPTION_H;
      ctx.font = font(CAPTION_SIZE, 500);
      ctx.globalAlpha = f.realMotion.amount;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2, cy - hgt / 2, w, hgt, hgt / 2);
      ctx.fillStyle = alpha(COLORS.surface, 0.92);
      ctx.fill();
      ctx.strokeStyle = COLORS.border;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = COLORS.text2;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(text, cx, cy + 0.5);
    },
  });

  // Debug/testing handle (read-only use).
  app.realMotion = rm;
}
