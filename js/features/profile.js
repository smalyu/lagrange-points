// Axis profile strip (Layers: "Pull along the axis").
//
// On the Sun–Earth line every pull points along the line, so the whole story
// there is one signed number: f(x) = net_x(x, 0). This layer plots it in a
// thin band that shares the scene's own scale along the axis, so each zero
// crossing sits exactly under (or, on a phone, beside) L3, L1 and L2.
//
//   desktop / landscape: a 64 px strip just above the dock, curve above the
//                        zero line = pull to the right (→).
//   phone portrait:      the axis is vertical, so the strip is a 44 px band on
//                        the right edge; curve left of the zero line = pull up.
//
// The value is compressed with asinh(f / 0.05) so tiny leftovers near the
// crossings and the huge pulls near the bodies both stay readable. No numbers
// on purpose: only the sign and the crossings matter here.
//
// Chapters can emit "profile:pulse" to make the crossings pulse once. Each
// frame gets frame.profileRect (screen px) while the strip is drawn.

import { t as coreT } from "../strings.js";
import { axisNetX } from "../physics.js";
import { markerVisible } from "../state.js";
import { WORLD_BOX } from "../app.js";
import { COLORS, alpha, font } from "../theme.js";
import { circle, diamond, label, rectsOverlap } from "../draw.js";

const SOFT = 0.05; // asinh knee: linear below ~0.05, logarithmic above
const NORM = Math.asinh(40 / SOFT); // |f| = 40 reaches the edge of the plot
const OVER = 1.4; // the curve runs a little past the edge, then gets clipped
const STRIP_H = 64;
const MIN_STRIP_H = 44;
const FLOOR_STRIP_H = 34; // cramped screens (phone landscape) may go this low
const MIN_VIEW_H = 120; // the framed view never gets shorter than this
const BAND_W = 44;
const BAND_GUTTER = 34; // legend room at the bottom of the phone band
const COMPACT_GUTTER = 20;
const STEP = 2; // px between samples
const FINE = 0.5; // px between samples right next to a body
const FINE_ZONE = 12; // px around each body sampled finely
const AXIS_NAMES = ["L3", "L1", "L2"];
const PULSE_MS = 900;
const PULSE_STAGGER = 160;
const FADE_MS = 220;
const SCALE_BAR_ROOM = 190; // realscale's bar: 18 px inset + at most 160 px + label slack
// Legend: the curve is the white "leftover" arrow at each spot on the line.
const LEGEND_WORD = coreT("leg.net");

/** Compressed, dimensionless height of the curve for a pull f. */
export function profileValue(f) {
  const v = Math.asinh(f / SOFT) / NORM;
  return Math.max(-OVER, Math.min(OVER, v));
}

/**
 * Sample positions (screen px along the axis) in [lo, hi], split at the
 * bodies so the curve never jumps from +inf to -inf across a pole. Returns
 * an array of runs, each an ascending array of positions.
 */
export function sampleRuns(lo, hi, poles, step = STEP) {
  const inside = poles.filter((p) => p > lo && p < hi).sort((a, b) => a - b);
  const cuts = [lo, ...inside, hi];
  const runs = [];
  for (let i = 0; i < cuts.length - 1; i += 1) {
    const a = i === 0 ? cuts[i] : cuts[i] + FINE;
    const b = i === cuts.length - 2 ? cuts[i + 1] : cuts[i + 1] - FINE;
    if (!(b > a)) continue;
    const run = [];
    let u = a;
    while (u < b) {
      run.push(u);
      let near = Infinity;
      for (const p of inside) near = Math.min(near, Math.abs(u - p));
      u += near < FINE_ZONE ? FINE : step;
    }
    run.push(b);
    runs.push(run);
  }
  return runs;
}

export function install(app) {
  const els = app.ui?.els ?? {};
  let rects = null; // cached DOM rects, refreshed on resize/camera/chapter
  let shown = 0; // fade 0..1
  let pulseStart = -1;

  const dirty = () => {
    rects = null;
    app.invalidate();
  };
  app.on("resize", dirty);
  app.on("camera", dirty);
  app.on("chapter", dirty);
  app.on("layers", dirty);
  // The dock grows and shrinks with its caption; the core does not re-frame
  // for that, so watch it directly to keep the strip just above it.
  if (typeof ResizeObserver === "function" && els.dock) new ResizeObserver(dirty).observe(els.dock);

  // Room in the framed view. The strip normally overlays the empty bottom of
  // the fitted scene (below L5); where it would land on L5 we reserve just
  // enough room for it, like the dock's, so the scene is fitted clear of it:
  //   phone portrait: the band sits exactly where L5 and its label are, so
  //                   its whole width is reserved;
  //   short views:    the smallest bottom reserve that leaves MIN_STRIP_H
  //                   between L5 and the dock at the fitted zoom (or as much
  //                   as the shortest allowed view gives).
  // In the "line" chapter the room stays reserved even before the strip is
  // switched on (step b), so the scene does not re-frame when it appears.
  let reserve = { right: 0, bottom: 0 };
  const NONE = { right: 0, bottom: 0 };
  const wantReserve = (v) => {
    if (!v || !(app.state.layers.profile || app.state.chapter === "line")) return NONE;
    if (app.size.phone && app.size.portrait) return { right: BAND_W + 12, bottom: 0 };
    const dock = els.dock?.getBoundingClientRect();
    if (!dock || !(dock.height > 0)) return NONE;
    const pad = app.size.phone ? 10 : 24; // same padding app.resize() fits with
    const bw = WORLD_BOX.maxX - WORLD_BOX.minX;
    const bh = WORLD_BOX.maxY - WORLD_BOX.minY;
    const cy = (WORLD_BOX.maxY + WORLD_BOX.minY) / 2;
    const stripBottom = dock.top - 8;
    for (let r = 0; r <= 96; r += 4) {
      // Mirror the clamp applied below, or a cramped view would be squeezed
      // for nothing and still land L5 inside the strip.
      const h = Math.max(MIN_VIEW_H, v.height - r);
      const sc = Math.max(20, Math.min((v.width - 2 * pad) / bw, (h - 2 * pad) / bh));
      const l5 = v.top + h / 2 + (Math.sqrt(3) / 2 + cy) * sc;
      if (stripBottom - (l5 + 8) >= MIN_STRIP_H) return r ? { right: 0, bottom: r } : NONE;
      if (h === MIN_VIEW_H) return { right: 0, bottom: Math.max(0, Math.ceil(v.height - MIN_VIEW_H)) };
    }
    return { right: 0, bottom: 96 };
  };
  const baseMeasureView = app.measureView;
  if (typeof baseMeasureView === "function") {
    app.measureView = () => {
      const v = baseMeasureView();
      reserve = wantReserve(v);
      if (!reserve.right && !reserve.bottom) return v;
      return {
        ...v,
        width: Math.max(160, v.width - reserve.right),
        height: Math.max(MIN_VIEW_H, v.height - reserve.bottom),
      };
    };
    // Layers change per chapter (and from the menu): re-frame only when the
    // reserved room actually changes.
    const syncReserve = () => {
      const next = wantReserve(baseMeasureView());
      if (next.right !== reserve.right || next.bottom !== reserve.bottom) app.resize();
    };
    app.on("chapter", syncReserve);
    app.on("layers", syncReserve);
  }

  // A chapter can ask the crossings to pulse once ("look here").
  app.on("profile:pulse", () => {
    if (app.reducedMotion) return;
    pulseStart = performance.now();
    app.animate((now) => now - pulseStart < PULSE_MS + 3 * PULSE_STAGGER);
  });

  function box(el) {
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }

  function measure() {
    return {
      dock: box(els.dock),
      obstacles: [els.menuBtn, els.menuBtnTop, els.fit].map(box).filter(Boolean),
    };
  }

  function wanted(f) {
    return Boolean(f.state.layers.profile) && f.state.busy !== "release" && !f.cam.spin && !f.hide?.profile;
  }

  // ---- layout ----------------------------------------------------------------------
  // Everything is expressed in "strip coordinates": u runs along the axis in
  // screen px, v across it (px, positive = the side where the pull points
  // toward Earth's side, +x). toPt(u, v) maps back to the screen.

  function stripLayout(f, ctx) {
    const S = app.toScreen(0, 0);
    const E = app.toScreen(1, 0);
    const span = E[0] - S[0];
    if (!(Math.abs(span) > 1e-9)) return null;
    const uOf = (x) => S[0] + x * span;
    const xOf = (u) => (u - S[0]) / span;
    const { dock, obstacles } = rects;
    const margin = 16;
    const h = STRIP_H;

    ctx.save();
    ctx.font = font(11, 500);
    const legendW = Math.ceil(ctx.measureText(LEGEND_WORD).width);
    ctx.restore();
    const fullGutter = legendW + 30;

    // Hug the framed scene (world box) along the axis; clamp to the canvas.
    const boxL = uOf(WORLD_BOX.minX);
    const boxR = uOf(WORLD_BOX.maxX);
    // Zoomed in, the box runs off the left edge and the strip starts at the
    // margin: the full legend fits then too.
    const full = boxL - fullGutter - 4 >= margin || boxL < margin;
    const gutter = full ? fullGutter : COMPACT_GUTTER;
    // The Earth close-up (features/realscale.js) draws its km scale bar in
    // the view's bottom-left corner, right where the strip would start.
    const minLeft = f.earthZoom ? Math.max(margin, f.cam.view.left + SCALE_BAR_ROOM) : margin;
    const left = Math.round(Math.max(minLeft, Math.min(boxL - gutter - 4, f.w - margin - 120)));
    const right = Math.round(Math.min(f.w - margin, Math.max(boxR + 10, left + 120)));
    if (right - left < 120) return null;

    let bottom = dock ? dock.top - 8 : f.h - margin;
    for (const r of obstacles) {
      const lowerHalf = (r.top + r.bottom) / 2 > f.h / 2;
      if (lowerHalf && r.left < right && r.right > left && r.top < bottom + 4) bottom = Math.min(bottom, r.top - 8);
    }
    bottom = Math.round(bottom);
    let top = bottom - h;
    // When L5 sits just above the strip, give up a little height rather
    // than sit on top of the marker (never below MIN_STRIP_H, or
    // FLOOR_STRIP_H on a cramped screen where the scene has no room to give).
    if (markerVisible(f.state, "L5")) {
      const p = f.sys.lPoints.L5;
      const [lx, ly] = app.toScreen(p[0], p[1]);
      const clear = Math.ceil(ly + 8);
      const floor = f.cam.view.height <= MIN_VIEW_H + 1 ? FLOOR_STRIP_H : MIN_STRIP_H;
      if (lx > left - 8 && lx < right + 8 && clear > top && bottom - clear >= floor) top = clear;
    }
    if (top < f.cam.view.top) return null;
    const hStrip = bottom - top;

    const zero = Math.round(top + hStrip / 2) + 0.5;
    const hh = hStrip / 2 - 7;
    return {
      vertical: false,
      panel: { x: left, y: top, w: right - left, h: hStrip },
      lo: left + gutter,
      hi: right - 6,
      zero,
      hh,
      full,
      gutter,
      uOf,
      xOf,
      toPt: (u, v) => [u, zero - v],
      clip: { x: left + gutter, y: top + 3, w: right - 6 - (left + gutter), h: hStrip - 6 },
    };
  }

  function bandLayout(f) {
    const S = app.toScreen(0, 0);
    const E = app.toScreen(1, 0);
    const span = E[1] - S[1]; // negative: Earth is above the Sun
    if (!(Math.abs(span) > 1e-9)) return null;
    const uOf = (x) => S[1] + x * span;
    const xOf = (u) => (u - S[1]) / span;
    const { dock, obstacles } = rects;
    const right = Math.round(f.w - 6);
    const left = right - BAND_W;

    let top = f.cam.view.top;
    let bottom = dock ? dock.top - 6 : f.h - 6;
    for (const r of obstacles) {
      if (!(r.left < right && r.right > left)) continue;
      if ((r.top + r.bottom) / 2 < f.h / 2) top = Math.max(top, r.bottom + 8);
      else bottom = Math.min(bottom, r.top - 8);
    }
    // Hug the framed scene along the axis (world x grows upwards here).
    top = Math.max(top, uOf(WORLD_BOX.maxX) - 10);
    bottom = Math.min(bottom, uOf(WORLD_BOX.minX) + BAND_GUTTER + 6);
    top = Math.round(top);
    bottom = Math.round(bottom);
    if (bottom - top < 140) return null;

    const zero = left + BAND_W / 2 + 0.5;
    const hh = BAND_W / 2 - 5;
    const lo = top + 6;
    const hi = bottom - BAND_GUTTER;
    return {
      vertical: true,
      panel: { x: left, y: top, w: BAND_W, h: bottom - top },
      lo,
      hi,
      zero,
      hh,
      full: true,
      gutter: BAND_GUTTER,
      uOf,
      xOf,
      toPt: (u, v) => [zero - v, u],
      clip: { x: left + 3, y: lo, w: BAND_W - 6, h: hi - lo },
    };
  }

  // ---- drawing -----------------------------------------------------------------------

  function panel(ctx, g) {
    const { x, y, w, h } = g.panel;
    ctx.beginPath();
    ctx.roundRect(x + 0.5, y + 0.5, w - 1, h - 1, 10);
    ctx.fillStyle = alpha(COLORS.surface, 0.8);
    ctx.fill();
    ctx.strokeStyle = COLORS.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function segment(ctx, g, u0, v0, u1, v1) {
    const a = g.toPt(u0, v0);
    const b = g.toPt(u1, v1);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // The curve only changes with the mass, the camera or the layout, so keep
  // its path until one of those moves.
  let curveKey = "";
  let curvePath = null;
  function curve(ctx, g, sys) {
    const key = [sys.q, g.vertical, g.lo, g.hi, g.zero, g.hh, g.uOf(0), g.uOf(1)].join("|");
    if (key !== curveKey || !curvePath) {
      curveKey = key;
      curvePath = new Path2D();
      for (const run of sampleRuns(g.lo, g.hi, [g.uOf(0), g.uOf(1)])) {
        run.forEach((u, i) => {
          const [px, py] = g.toPt(u, profileValue(axisNetX(sys, g.xOf(u))) * g.hh);
          if (i === 0) curvePath.moveTo(px, py);
          else curvePath.lineTo(px, py);
        });
      }
    }
    ctx.strokeStyle = COLORS.text2;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke(curvePath);
  }

  function poles(ctx, g) {
    const bodies = [
      [0, COLORS.sun],
      [1, COLORS.earth],
    ];
    ctx.lineWidth = 1.5;
    ctx.setLineDash([2, 3]);
    for (const [x, color] of bodies) {
      const u = g.uOf(x);
      if (u < g.lo - 1 || u > g.hi + 1) continue;
      ctx.strokeStyle = alpha(color, 0.55);
      segment(ctx, g, u, -g.hh - 4, u, g.hh + 4);
    }
    ctx.setLineDash([]);
    for (const [x, color] of bodies) {
      const u = g.uOf(x);
      if (u < g.lo - 1 || u > g.hi + 1) continue;
      const [cx, cy] = g.toPt(u, 0);
      circle(ctx, cx, cy, 2.5, { fill: alpha(color, 0.9) });
    }
  }

  function legend(ctx, g) {
    const color = COLORS.text3;
    const arrowColor = COLORS.text2;
    if (!g.vertical) {
      const ax = g.lo - 11;
      const up = g.zero - 9;
      const down = g.zero + 9;
      label(ctx, "→", ax, up, arrowColor, { size: 12, weight: 600, halo: false });
      label(ctx, "←", ax, down, arrowColor, { size: 12, weight: 600, halo: false });
      // One word for both halves: "leftover" beside the → / ← pair.
      if (g.full) label(ctx, LEGEND_WORD, ax - 10, g.zero, color, { size: 11, weight: 500, align: "right", halo: false });
      return { x: g.panel.x, y: g.panel.y, w: g.gutter, h: g.panel.h };
    }
    // Phone band: legend at the bottom (the "left" end of the line).
    const row1 = g.hi + 11;
    const row2 = g.hi + 24;
    label(ctx, "↑", g.zero - 9, row1, arrowColor, { size: 12, weight: 600, halo: false });
    label(ctx, "↓", g.zero + 9, row1, arrowColor, { size: 12, weight: 600, halo: false });
    label(ctx, LEGEND_WORD, g.zero, row2, color, { size: 10, weight: 500, halo: false });
    return { x: g.panel.x, y: g.hi, w: g.panel.w, h: g.gutter };
  }

  /** Rects of scene L4/L5 markers + labels, so band labels can avoid them. */
  function sceneMarkerRects(f) {
    const out = [];
    for (const name of ["L4", "L5"]) {
      if (!markerVisible(f.state, name)) continue;
      const p = f.sys.lPoints[name];
      const [x, y] = app.toScreen(p[0], p[1]);
      const off = f.snapped === name ? 22 : 13;
      out.push({ x: x - 8, y: y - 8, w: 16, h: 16 });
      out.push({ x: x + off * 0.9 - 3, y: y - off - 10, w: 24, h: 20 });
    }
    return out;
  }

  function crossings(ctx, f, g, avoid) {
    const state = f.state;
    const placed = [...avoid.filter(Boolean), ...sceneMarkerRects(f)];
    const now = f.now;
    for (const [i, name] of AXIS_NAMES.entries()) {
      if (!markerVisible(state, name)) continue;
      const u = f.sys.lPoints[name][0];
      const su = g.uOf(u);
      if (su < g.lo - 2 || su > g.hi + 2) continue;
      const [dx, dy] = g.toPt(su, 0);
      const active = f.snapped === name;
      const found = state.found[name];

      if (pulseStart >= 0 && !f.app.reducedMotion) {
        const t = (now - pulseStart - i * PULSE_STAGGER) / PULSE_MS;
        if (t > 0 && t < 1) {
          circle(ctx, dx, dy, 4 + 14 * t, { stroke: alpha(COLORS.text, 0.7 * (1 - t)), width: 1.5 });
        }
      }

      diamond(ctx, dx, dy, active ? 5 : 4, {
        fill: active || found ? COLORS.text : COLORS.surface,
        stroke: active ? COLORS.text : COLORS.text2,
        width: 1.25,
      });

      // f rises through zero at every collinear point, so the curve fills the
      // "before & negative" and "after & positive" quadrants. Labels go in the
      // two free ones: before & positive first, then after & negative.
      const dir = Math.sign(g.uOf(1) - g.uOf(0)) || 1; // +1: world x grows with u
      const size = 11;
      ctx.save();
      ctx.font = font(size, 650);
      const tw = ctx.measureText(name).width;
      ctx.restore();
      const w = tw + 4;
      const h = size + 4;
      const candidates = g.vertical
        ? [
            { cx: dx - 11, cy: dy - dir * 11 },
            { cx: dx + 11, cy: dy + dir * 11 },
          ]
        : [
            { cx: dx - dir * (6 + w / 2), cy: dy - 11 },
            { cx: dx + dir * (6 + w / 2), cy: dy + 11 },
          ];
      for (const c of candidates) {
        const rect = { x: c.cx - w / 2, y: c.cy - h / 2, w, h };
        const inPanel =
          rect.x >= g.panel.x + 2 &&
          rect.x + rect.w <= g.panel.x + g.panel.w - 2 &&
          rect.y >= g.panel.y + 1 &&
          rect.y + rect.h <= g.panel.y + g.panel.h - 1;
        if (!inPanel || placed.some((r) => rectsOverlap(r, rect))) continue;
        placed.push(rect);
        label(ctx, name, c.cx, c.cy, active || found ? COLORS.text : COLORS.text2, {
          size,
          weight: 650,
          haloColor: COLORS.surface,
          haloWidth: 3,
        });
        break;
      }
    }
  }

  /** Tick at the probe's x; returns its rect so crossing labels avoid it. */
  function probeMark(ctx, f, g) {
    const [px, py] = f.state.probe;
    const su = g.uOf(px);
    if (su < g.lo || su > g.hi) return null;
    const offAxisPx = Math.abs(py) * app.scale();
    const onAxis = offAxisPx < 3;
    const near = offAxisPx < 24;
    ctx.lineWidth = 1;
    ctx.strokeStyle = onAxis
      ? alpha(COLORS.text, 0.85)
      : near
        ? alpha(COLORS.text2, 0.7)
        : alpha(COLORS.text3, 0.45);
    const c = Math.round(su) + 0.5;
    segment(ctx, g, c, -g.hh - 3, c, g.hh + 3);
    if (onAxis) {
      // On the line the white leftover arrow is exactly this value (pinned
      // to the edge when it runs off the chart next to a body).
      const v = Math.max(-g.hh, Math.min(g.hh, profileValue(axisNetX(f.sys, px)) * g.hh));
      const [cx, cy] = g.toPt(su, v);
      circle(ctx, cx, cy, 4.5, { fill: COLORS.surface });
      circle(ctx, cx, cy, 3, { fill: COLORS.leftover });
    }
    const a = g.toPt(c, -g.hh - 3);
    const b = g.toPt(c, g.hh + 3);
    return {
      x: Math.min(a[0], b[0]) - 1,
      y: Math.min(a[1], b[1]) - 1,
      w: Math.abs(a[0] - b[0]) + 2,
      h: Math.abs(a[1] - b[1]) + 2,
    };
  }

  app.addLayer({
    id: "profile",
    // Under the markers, bodies and arrows: the chain always draws on top.
    z: 46,
    visible(f) {
      const target = wanted(f) ? 1 : 0;
      // A spinning view ("real motion") no longer lines up with the strip:
      // drop it at once rather than fade a misaligned plot.
      if (app.reducedMotion || f.cam.spin) shown = target;
      else if (shown !== target) {
        const d = Math.min(34, f.dt || 16) / FADE_MS;
        shown = target > shown ? Math.min(target, shown + d) : Math.max(target, shown - d);
        if (shown !== target) app.invalidate();
      }
      return shown > 0.001;
    },
    draw(ctx, f) {
      if (!rects) rects = measure();
      const g = f.cam.rot ? bandLayout(f) : stripLayout(f, ctx);
      if (!g) return;
      ctx.globalAlpha = shown;

      panel(ctx, g);

      ctx.save();
      ctx.beginPath();
      ctx.rect(g.clip.x, g.clip.y, g.clip.w, g.clip.h);
      ctx.clip();
      // Zero line: balance.
      ctx.strokeStyle = COLORS.guide;
      ctx.lineWidth = 1;
      segment(ctx, g, g.lo, 0, g.hi, 0);
      poles(ctx, g);
      curve(ctx, g, f.sys);
      ctx.restore();

      const legendRect = legend(ctx, g);
      const tickRect = probeMark(ctx, f, g);
      crossings(ctx, f, g, [legendRect, tickRect]);
      f.profileRect = g.panel;
    },
  });
}
