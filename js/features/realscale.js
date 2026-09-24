// Feature "realscale": zooming in on Earth at (or near) the real mass ratio.
//
// 1. "zoomEarth" (Z key, chips): fly so that +-3 Hill radii around Earth
//    fill ~70% of the smaller side of the visible area; again = fit view.
// 2. Tide view. Up close the Sun's pull and the spin push are huge and almost
//    cancel, so the usual chain is unreadable (two ~430 px legs, a 13 px
//    Earth leg). Near Earth we fuse them into one "tide" arrow
//    (g_S + c, amber half + rose half) and chain Earth's pull from its tip.
//    Both share one scale; the leftover is still P -> chain end, exactly.
// 3. Landmarks while zoomed near Earth: Moon's orbit, SOHO (L1), JWST (L2),
//    a km scale bar and edge arrows to off-screen bodies.

import { COLORS, FONT_STACK, alpha, font } from "../theme.js";
import {
  arrow,
  circle,
  diamond,
  label,
  line,
  outlineArrow,
  rectsOverlap,
  smoothstep,
  superscript,
} from "../draw.js";
import { vecToScreen } from "../camera.js";
import { L_NAMES, SI, hillRadius, len } from "../physics.js";
import { REAL_EARTH_Q } from "../mass.js";
import { markerVisible } from "../state.js";
import { t as coreT } from "../strings.js";
import { defineStrings, fmtNumber, pct } from "../i18n.js";

export const REALSCALE_STRINGS = {
  en: {
    billionKm: "{n} billion km",
    millionKm: "{n} million km",
    km: "{n} km",
    tide: "tide",
    spin: "spin",
    neededToTurn: "needed to turn",
    moonOrbit: "Moon's orbit",
    statusNote: "{pct} of tide + Earth pull",
    numbersRow: "vs tide + Earth pull",
  },
  ru: {
    billionKm: "{n} млрд км",
    millionKm: "{n} млн км",
    km: "{n} км",
    tide: "прилив",
    spin: "центробежная",
    neededToTurn: "нужно для поворота",
    moonOrbit: "орбита Луны",
    statusNote: "{pct} от прилива и притяжения Земли",
    numbersRow: "от прилива и Земли",
  },
};
const tr = defineStrings(REALSCALE_STRINGS);

export const TIDE_ZOOM = 8; // camera zoom from which the tide view can switch on
export const TIDE_REACH = 5; // ... when the probe is within this many Hill radii of Earth
export const MOON_ORBIT = 0.00257; // in a
export const KM_PER_A = SI.au / 1000; // 149,597,870.7 km
const FADE_MS = 180;

// ---- small pure helpers (also used by the "real" chapter) -----------------------------

export function isRealRatio(q) {
  return Math.abs(Math.log(q / REAL_EARTH_Q)) < 0.01;
}

/** Hill radius (mu/3)^(1/3), in a, for mass ratio q. */
export function hillOf(q) {
  return Math.cbrt(q / (1 + q) / 3);
}

/** Distance from Earth (toward the Sun) where the two gravities are equal. */
export function neutralDistance(q) {
  const r = Math.sqrt(q);
  return r / (1 + r);
}

function pctText(b) {
  const v = b * 100;
  const digits = v >= 10 ? 0 : v >= 1 ? 1 : 2;
  return pct(fmtNumber(v, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
}

/** "259,000 km", "1.5 million km", "150 million km" (localized). */
export function formatKm(km) {
  if (!Number.isFinite(km)) return "–";
  const n = (x, digits) => fmtNumber(Number(x.toPrecision(digits)), { maximumFractionDigits: 6 });
  if (km >= 1e9) return tr("billionKm", { n: n(km / 1e9, 2) });
  if (km >= 1e6) return tr("millionKm", { n: n(km / 1e6, 2) });
  if (km >= 1000) return tr("km", { n: fmtNumber(Math.round(Number(km.toPrecision(3)))) });
  return tr("km", { n: fmtNumber(Math.round(Number(km.toPrecision(2)))) });
}

/** Plain number for a distance in units of a: "0.0173", "2×10⁻⁵" (localized). */
export function formatA(x) {
  if (!Number.isFinite(x)) return "–";
  if (x === 0) return "0";
  if (x >= 0.001) return fmtNumber(Number(x.toPrecision(x >= 1 ? 3 : 2)), { maximumFractionDigits: 6 });
  const e = Math.floor(Math.log10(x));
  const m = Number((x / 10 ** e).toPrecision(2));
  return `${m === 1 ? "" : `${fmtNumber(m, { maximumFractionDigits: 2 })}×`}10${superscript(e)}`;
}

/** Canvas text parts for a distance: km at the real ratio, otherwise units of a. */
export function distanceParts(x, q, color = COLORS.text2) {
  if (isRealRatio(q)) return [{ text: formatKm(x * KM_PER_A), color }];
  return [
    { text: `${formatA(x)} `, color },
    { text: "a", color, italic: true },
  ];
}

/** HTML for a distance: km at the real ratio, otherwise units of a. */
export function distanceHtml(x, q) {
  if (isRealRatio(q)) return formatKm(x * KM_PER_A);
  return `${formatA(x)} <em>a</em>`;
}

// ---- camera -------------------------------------------------------------------------------

/** Camera target that frames +-3 Hill radii around Earth in ~70% of the view. */
export function earthZoomTarget(app, q = app.state.q) {
  const v = app.cam.view;
  const rH = hillOf(q);
  const zoom = (0.7 * Math.min(v.width, v.height)) / (6 * rH * app.cam.baseScale);
  // At big mass ratios the Hill sphere is the size of the whole system; still
  // zoom in a little so "Zoom to Earth" never zooms out.
  return { center: [1, 0], zoom: Math.min(20000, Math.max(1.5, zoom)) };
}

/**
 * Is the camera at (or flying to) the Earth close-up? Zoomed in further than
 * the close-up (wheel, or a window resized smaller) still counts.
 */
export function isEarthZoomed(app) {
  const t = earthZoomTarget(app);
  const dest = app.cam.flight ? app.cam.flight.to : app.cam;
  if (!app.userZoomed && !app.cam.flight) return false;
  if (Math.log(dest.zoom / t.zoom) < -0.35) return false;
  const s = app.cam.baseScale * dest.zoom;
  const off = Math.hypot(dest.center[0] - 1, dest.center[1]) * s;
  const v = app.cam.view;
  return off < 0.3 * Math.min(v.width, v.height);
}

export function zoomToEarth(app, ms = 900) {
  const t = earthZoomTarget(app);
  app.flyTo(t.center, t.zoom, ms);
}

/** Z key / chips: fly in, or back out when already there. */
export function toggleEarthZoom(app) {
  if (isEarthZoomed(app)) app.fitView();
  else zoomToEarth(app);
}

// ---- label placement helpers -------------------------------------------------------------

function partFont(p, size, weight) {
  return p.italic ? `italic ${p.weight ?? weight} ${size}px ${FONT_STACK}` : font(size, p.weight ?? weight);
}

export function measureParts(ctx, parts, size = 12, weight = 600) {
  ctx.save();
  let w = 0;
  for (const p of parts) {
    ctx.font = partFont(p, size, weight);
    w += ctx.measureText(p.text).width;
  }
  ctx.restore();
  return w;
}

/**
 * Multi-colour, mixed-style text with a background halo, vertically centred
 * on y. Returns its rect like draw.js label().
 */
export function richLabel(ctx, parts, x, y, opts = {}) {
  const size = opts.size ?? 12;
  const weight = opts.weight ?? 600;
  const align = opts.align ?? "center";
  const total = measureParts(ctx, parts, size, weight);
  const left = align === "center" ? x - total / 2 : align === "right" ? x - total : x;
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if (opts.halo !== false) {
    ctx.strokeStyle = COLORS.bg;
    ctx.lineWidth = 4;
    ctx.lineJoin = "round";
    let cx = left;
    for (const p of parts) {
      ctx.font = partFont(p, size, weight);
      ctx.strokeText(p.text, cx, y);
      cx += ctx.measureText(p.text).width;
    }
  }
  let cx = left;
  for (const p of parts) {
    ctx.font = partFont(p, size, weight);
    ctx.fillStyle = p.color ?? COLORS.text;
    ctx.fillText(p.text, cx, y);
    cx += ctx.measureText(p.text).width;
  }
  ctx.restore();
  return { x: left - 2, y: y - size * 0.6 - 2, w: total + 4, h: size * 1.2 + 4 };
}

/** Does segment s = {a, b, pad} come within pad px of rect r? (Liang-Barsky) */
export function segHitsRect(s, r) {
  const p = s.pad ?? 3;
  const xmin = r.x - p;
  const xmax = r.x + r.w + p;
  const ymin = r.y - p;
  const ymax = r.y + r.h + p;
  const x0 = s.a[0];
  const y0 = s.a[1];
  const dx = s.b[0] - x0;
  const dy = s.b[1] - y0;
  let t0 = 0;
  let t1 = 1;
  const edges = [
    [-dx, x0 - xmin],
    [dx, xmax - x0],
    [-dy, y0 - ymin],
    [dy, ymax - y0],
  ];
  for (const [pp, q] of edges) {
    if (pp === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / pp;
    if (pp < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
  }
  return true;
}

/** Rect grown by m px on every side. */
function grow(r, m) {
  return m ? { x: r.x - m, y: r.y - m, w: r.w + 2 * m, h: r.h + 2 * m } : r;
}

/**
 * First candidate {x, y, align} where the text fits inside `bounds` and
 * clears every obstacle rect and segment. `margin` keeps extra room from
 * other labels (obstacles marked `tight`, like dots and the probe, get none).
 * Returns {x, y, align, rect} or null.
 */
export function findSpot(ctx, parts, candidates, opts = {}) {
  const size = opts.size ?? 12;
  const weight = opts.weight ?? 600;
  const w = measureParts(ctx, parts, size, weight);
  const h = size * 1.2 + 4;
  const obstacles = opts.obstacles ?? [];
  const segs = opts.segs ?? [];
  const b = opts.bounds;
  const m = opts.margin ?? 0;
  for (const c of candidates) {
    const left = c.align === "center" ? c.x - w / 2 : c.align === "right" ? c.x - w : c.x;
    const rect = { x: left - 2, y: c.y - size * 0.6 - 2, w: w + 4, h };
    if (b && (rect.x < b.x || rect.y < b.y || rect.x + rect.w > b.x + b.w || rect.y + rect.h > b.y + b.h)) continue;
    const roomy = grow(rect, m);
    if (obstacles.some((o) => rectsOverlap(o, o.tight ? rect : roomy))) continue;
    if (segs.some((s) => segHitsRect(s, rect))) continue;
    return { ...c, rect };
  }
  return null;
}

/** Like findSpot, for several lines of text centred on the candidate. */
export function findBlockSpot(ctx, lines, candidates, opts = {}) {
  const size = opts.size ?? 12;
  const weight = opts.weight ?? 600;
  const lh = size * 1.25;
  const w = Math.max(...lines.map((parts) => measureParts(ctx, parts, size, weight)));
  const h = lh * lines.length + 4;
  const obstacles = opts.obstacles ?? [];
  const segs = opts.segs ?? [];
  const b = opts.bounds;
  const m = opts.margin ?? 0;
  for (const c of candidates) {
    const left = c.align === "center" ? c.x - w / 2 : c.align === "right" ? c.x - w : c.x;
    // Centred blocks grow away from the point they label.
    const cy = c.align === "center" ? c.y + Math.sign(c.dir?.[1] ?? 0) * (h / 2 - size * 0.6) : c.y;
    const rect = { x: left - 2, y: cy - h / 2, w: w + 4, h };
    if (b && (rect.x < b.x || rect.y < b.y || rect.x + rect.w > b.x + b.w || rect.y + rect.h > b.y + b.h)) continue;
    const roomy = grow(rect, m);
    if (obstacles.some((o) => rectsOverlap(o, o.tight ? rect : roomy))) continue;
    if (segs.some((s) => segHitsRect(s, rect))) continue;
    return { ...c, y: cy, rect, lineHeight: lh };
  }
  return null;
}

/**
 * Candidate anchors around a screen point: for each direction (unit screen
 * vector) and distance, text aligned so it grows away from the point.
 */
export function around(pt, dirs, dists, size = 12) {
  const out = [];
  for (const d of dists) {
    for (const [ux, uy] of dirs) {
      const l = Math.hypot(ux, uy) || 1;
      const x = pt[0] + (ux / l) * d;
      const y = pt[1] + (uy / l) * d;
      const align = ux / l > 0.35 ? "left" : ux / l < -0.35 ? "right" : "center";
      // Centred text sits above/below the point, so push by half its height.
      const yy = align === "center" ? y + Math.sign(uy) * size * 0.2 : y;
      out.push({ x, y: yy, align, dir: [ux / l, uy / l], dist: d });
    }
  }
  return out;
}

/** Canvas area labels may use (the visible scene, not under the dock). */
export function labelBounds(f) {
  const v = f.cam.view;
  return { x: v.left + 4, y: v.top + 2, w: v.width - 8, h: v.height - 4 };
}

/**
 * Arrow shafts on screen right now, as segments labels should avoid, plus
 * any leader lines already drawn this frame (f.leaders).
 */
export function arrowSegments(f) {
  const segs = [...(f.leaders ?? [])];
  const t = f.tide;
  if (t && t.alpha > 0.5) {
    for (const leg of t.legs) {
      if (leg.length >= 1) segs.push({ a: leg.start, b: leg.end, pad: 4 });
    }
    if (t.showNet) segs.push({ a: t.net.start, b: t.net.end, pad: 4 });
    if (t.ghost) segs.push({ a: t.ghost.start, b: t.ghost.end, pad: 3 });
    return segs;
  }
  if (f.hide.chain || f.chainAlpha < 0.5) return segs;
  for (const leg of f.chain.legs) {
    if (f.hideLegs?.[leg.key]) continue;
    if (leg.length >= 1) segs.push({ a: leg.start, b: leg.end, pad: 4 });
  }
  if (!f.snapped && !f.hide.leftover && f.chain.net.length >= 1) {
    segs.push({ a: f.chain.net.start, b: f.chain.net.end, pad: 4 });
  }
  return segs;
}

/** The probe and its balance ring as an obstacle rect. */
export function probeRect(f) {
  const [px, py] = f.chain.P;
  const r = (f.app.size.phone ? 17 : 15) + 4;
  return { x: px - r, y: py - r, w: 2 * r, h: 2 * r, tight: true };
}

/**
 * Where the core badges ("arrows ×0.65", "lanes offset for clarity") sit
 * under the probe, mirroring scene.js, so our labels can keep off them.
 */
function badgeRects(f) {
  if (f.hide.chain || f.chainAlpha <= 0.5 || f.state.arrows !== "chain") return [];
  const [px, py] = f.chain.P;
  const rects = [];
  let y = py + (f.app.size.phone ? 34 : 32);
  if (f.chain.rho < 0.97) {
    rects.push({ x: px + 10, y: y - 12, w: 94, h: 24 });
    y += 24;
  }
  if (f.chain.laneWeight > 0.5) rects.push({ x: px + 10, y: y - 10, w: 132, h: 20 });
  return rects;
}

/** Are the L1 and L2 markers too close on screen for separate labels? */
function lPairCrowded(f) {
  const st = f.state;
  if (!markerVisible(st, "L1") || !markerVisible(st, "L2")) return false;
  const a = worldPx(f, f.sys.lPoints.L1);
  const b = worldPx(f, f.sys.lPoints.L2);
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 30;
}

/** Earth's dot radius in px, as scene.js draws it. */
function earthRadiusPx(f) {
  return Math.max(4, (f.app.size.phone ? 10 : 11) * Math.cbrt(f.sys.q));
}

function worldPx(f, p) {
  return f.app.toScreen(p[0], p[1]);
}

function earthNearView(E, v) {
  const dx = Math.max(v.left - E[0], 0, E[0] - (v.left + v.width));
  const dy = Math.max(v.top - E[1], 0, E[1] - (v.top + v.height));
  return Math.hypot(dx, dy) <= 0.75 * Math.max(v.width, v.height);
}

function lineDeviation(a, b) {
  let d = Math.abs(Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]));
  if (d > Math.PI / 2) d = Math.PI - d;
  return d;
}

/** Largest t >= 0 with P + t*u inside rect r (Infinity if u is zero). */
function reachInside(P, u, r) {
  let t = Infinity;
  if (u[0] > 1e-12) t = Math.min(t, (r.right - P[0]) / u[0]);
  else if (u[0] < -1e-12) t = Math.min(t, (r.left - P[0]) / u[0]);
  if (u[1] > 1e-12) t = Math.min(t, (r.bottom - P[1]) / u[1]);
  else if (u[1] < -1e-12) t = Math.min(t, (r.top - P[1]) / u[1]);
  return t;
}

// ---- drawing helpers -------------------------------------------------------------------------

/** The fused tide arrow: amber (Sun pull) tail half, rose dashed (spin) head half. */
function tideArrow(ctx, x0, y0, x1, y1, width, alphaMul = 1, inertial = false) {
  const second = inertial ? COLORS.text2 : COLORS.spin;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  ctx.save();
  ctx.globalAlpha *= alphaMul;
  if (length < 6) {
    if (length >= 0.5) {
      ctx.fillStyle = COLORS.spin;
      ctx.beginPath();
      ctx.arc(x1, y1, 1.5 + width * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }
  const ux = dx / length;
  const uy = dy / length;
  const headLen = Math.min(12, 0.4 * length);
  const half = (25 * Math.PI) / 180;
  const hw = Math.tan(half) * headLen;
  const bx = x1 - ux * headLen;
  const by = y1 - uy * headLen;
  const sx = x1 - ux * headLen * 0.6;
  const sy = y1 - uy * headLen * 0.6;
  const lx = bx - uy * hw;
  const ly = by + ux * hw;
  const rx = bx + uy * hw;
  const ry = by - ux * hw;
  const mx = x0 + dx * 0.5;
  const my = y0 + dy * 0.5;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Underlay keeps it readable over lines and other arrows.
  ctx.strokeStyle = COLORS.bg;
  ctx.lineWidth = width + 3;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(sx, sy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.closePath();
  ctx.lineWidth = 3;
  ctx.stroke();
  // Sun half.
  ctx.strokeStyle = COLORS.sun;
  ctx.lineWidth = width;
  ctx.lineCap = "butt";
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(mx, my);
  ctx.stroke();
  // Spin half, dashed like the spin push everywhere else (in the real-motion
  // view: the "needed to turn" half, dashed like that arrow).
  ctx.strokeStyle = second;
  ctx.setLineDash(inertial ? [6, 4] : [8, 4]);
  ctx.beginPath();
  ctx.moveTo(mx, my);
  ctx.lineTo(sx, sy);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = second;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Small arrow pointing along u with its tip at (x, y). */
function edgePointer(ctx, x, y, u, color) {
  const L = 16;
  arrow(ctx, x - u[0] * L, y - u[1] * L, x, y, { color, width: 1.5, headMax: 7 });
}

const TIDE_PARTS = [
  { text: `${tr("tide")} `, color: COLORS.text },
  { text: "(", color: COLORS.text2, weight: 500 },
  { text: coreT("leg.sun"), color: COLORS.sun },
  { text: " + ", color: COLORS.text2, weight: 500 },
  { text: tr("spin"), color: COLORS.spin },
  { text: ")", color: COLORS.text2, weight: 500 },
];
// In "Hold: real motion" there is no spin push: the same arrow reads as the
// Sun's pull minus the pull needed to turn with the frame.
const TIDE_PARTS_INERTIAL = [
  { text: `${tr("tide")} `, color: COLORS.text },
  { text: "(", color: COLORS.text2, weight: 500 },
  { text: coreT("leg.sun"), color: COLORS.sun },
  { text: " − ", color: COLORS.text2, weight: 500 },
  { text: tr("neededToTurn"), color: COLORS.text2 },
  { text: ")", color: COLORS.text2, weight: 500 },
];
const TIDE_SHORT = [{ text: tr("tide"), color: COLORS.text }];
const EARTH_PARTS = [{ text: coreT("leg.earth"), color: COLORS.earth }];
const NET_PARTS = [{ text: coreT("leg.net"), color: COLORS.leftover }];

/**
 * Positions for the tide-view arrow labels (computed once per frame): at the
 * midpoint, pushed off the shaft, away from the other lanes, never on top of
 * another arrow, label, the probe or off screen. Pushes rects to f.obstacles.
 * Call it before placing any other label in the close-up (it runs once).
 */
export function layoutTideLabels(ctx, f) {
  const t = f.tide;
  if (!t) return [];
  if (t.labelSpots) return t.labelSpots;
  const spots = [];
  t.labelSpots = spots;
  const obstacles = (f.obstacles = f.obstacles ?? []);
  const ghostTag = t.ghost ? { x: t.ghost.tag[0] - 16, y: t.ghost.tag[1] - 9, w: 32, h: 18 } : null;
  if (ghostTag && t.alpha > 0.5) obstacles.push(ghostTag);
  if (!(t.alpha > 0.5) || !f.state.layers.labels) return spots;
  const segs = [];
  for (const leg of t.legs) if (leg.length >= 1) segs.push({ a: leg.start, b: leg.end, pad: 3.5 });
  if (t.showNet) segs.push({ a: t.net.start, b: t.net.end, pad: 3.5 });
  // The core Earth label (and its dot obstacle) is hidden in the close-up:
  // keep arrow labels off the dot ourselves.
  const E = f.app.toScreen(1, 0);
  const eR = earthRadiusPx(f) + 4;
  const placed = [...obstacles, probeRect(f), { x: E[0] - eR, y: E[1] - eR, w: 2 * eR, h: 2 * eR, tight: true }];
  if (t.ghost) segs.push({ a: t.ghost.start, b: t.ghost.end, pad: 3 });
  const bounds = labelBounds(f);
  const size = 12;
  const gap = f.app.size.phone ? 8 : 9;
  const [lx, ly] = t.laneNormal;
  const items = [];
  if (t.showNet) items.push({ ...t.net, key: "net", parts: [NET_PARTS], laned: t.laneN > 0.5, sides: [[-lx, -ly], [lx, ly]] });
  items.push({
    ...t.legs[0],
    parts: [f.realMotion ? TIDE_PARTS_INERTIAL : TIDE_PARTS, TIDE_SHORT],
    laned: t.lane > 0.5 || t.laneN > 0.5,
    sides: t.lane > 0.5 ? [[-lx, -ly], [lx, ly]] : [[lx, ly], [-lx, -ly]],
  });
  items.push({ ...t.legs[1], parts: [EARTH_PARTS], laned: t.lane > 0.5, sides: [[lx, ly], [-lx, -ly]] });
  for (const item of items) {
    if (item.length < 36) continue;
    const ux = (item.end[0] - item.start[0]) / item.length;
    const uy = (item.end[1] - item.start[1]) / item.length;
    let sides = item.sides;
    if (!item.laned) {
      // Off the lanes: the side of the shaft away from the loop's middle.
      let nx = -uy;
      let ny = ux;
      const mx = (item.start[0] + item.end[0]) / 2;
      const my = (item.start[1] + item.end[1]) / 2;
      if (nx * (mx - t.centroid[0]) + ny * (my - t.centroid[1]) < 0) {
        nx = -nx;
        ny = -ny;
      }
      sides = [[nx, ny], [-nx, -ny]];
    }
    for (const parts of item.parts) {
      const w = measureParts(ctx, parts, size, 600) + 4;
      const h = size * 1.2 + 4;
      const cands = [];
      for (const [sx, sy] of sides) {
        for (const extra of [0, gap, 2 * gap]) {
          for (const along of [0.5, 0.38, 0.62, 0.26, 0.74]) {
            const mx = item.start[0] + (item.end[0] - item.start[0]) * along;
            const my = item.start[1] + (item.end[1] - item.start[1]) * along;
            const reach = 8 + extra + Math.abs(sx) * (w / 2) + Math.abs(sy) * (h / 2);
            cands.push({ x: mx + sx * reach, y: my + sy * reach, align: "center" });
          }
        }
      }
      const spot = findSpot(ctx, parts, cands, { size, obstacles: placed, segs, bounds, margin: 2 });
      if (spot) {
        spots.push({ parts, x: spot.x, y: spot.y });
        placed.push(spot.rect);
        obstacles.push(spot.rect);
        break;
      }
    }
  }
  return spots;
}

// ---- install ------------------------------------------------------------------------------------

export function install(app) {
  let blend = 0; // 0 = normal chain, 1 = tide view (cross-fades)

  app.on("zoomEarth", () => toggleEarthZoom(app));

  // --- geometry: decide the view and lay out the tide chain --------------------------------
  function computeTide(f, fade) {
    const { acc, cam } = f;
    const P = f.chain.P;
    const T = [acc.sun[0] + acc.cf[0], acc.sun[1] + acc.cf[1]];
    const G = acc.earth;
    const net = [T[0] + G[0], T[1] + G[1]];
    const v = cam.view;
    const minDim = Math.min(v.width, v.height);
    const big = Math.max(len(T), len(G));
    if (!(big > 0)) return null;
    const k0 = (0.3 * minDim) / big;
    const u1 = vecToScreen(cam, T[0], T[1], 1);
    const u2 = vecToScreen(cam, net[0], net[1], 1);
    // Keep every joint of the chain on screen.
    const pad = 22;
    const r = { left: v.left + pad, right: v.left + v.width - pad, top: v.top + pad, bottom: v.top + v.height - pad };
    const inside = P[0] > r.left && P[0] < r.right && P[1] > r.top && P[1] < r.bottom;
    let k = k0;
    if (inside) {
      k = Math.min(k, reachInside(P, u1, r), reachInside(P, u2, r));
      // In the fan view Earth's pull also starts at the probe.
      if (f.chain.morph < 0.5) k = Math.min(k, reachInside(P, vecToScreen(cam, G[0], G[1], 1), r));
      k = Math.max(k, 0.2 * k0);
    }
    const morph = f.chain.morph;
    const a = [u1[0] * k, u1[1] * k];
    const b = vecToScreen(cam, G[0], G[1], k);
    const la = Math.hypot(a[0], a[1]);
    const lb = Math.hypot(b[0], b[1]);
    const gap = f.app.size.phone ? 8 : 9;

    // Lanes when the two legs lie on (nearly) one line, as on the axis:
    // Earth's pull moves to the +n lane, the leftover to the -n lane (so the
    // white arrow never hides the two-tone tide or Earth's pull under it).
    let lane = 0;
    let laneN = 0;
    let n = [0, -1];
    const ref = la >= lb ? a : b;
    const lr = Math.hypot(ref[0], ref[1]);
    if (lr > 0) {
      n = [-ref[1] / lr, ref[0] / lr];
      if (n[1] > 1e-6 || (Math.abs(n[1]) <= 1e-6 && n[0] > 0)) n = [-n[0], -n[1]];
    }
    const deg = (p, q) => (lineDeviation(p, q) * 180) / Math.PI;
    if (la > 2 && lb > 2 && morph > 0) lane = smoothstep(6, 2, deg(a, b)) * morph;
    const ns = [u2[0] * k, u2[1] * k];
    const ln = Math.hypot(ns[0], ns[1]);
    if (ln > 2) {
      if (la > 2) laneN = Math.max(laneN, smoothstep(6, 2, deg(a, ns)));
      if (lb > 2) laneN = Math.max(laneN, smoothstep(6, 2, deg(b, ns)));
    }
    laneN = Math.max(lane, laneN);
    const off = lane * gap;
    const offN = laneN * gap;
    const tideLeg = { key: "tide", start: P, end: [P[0] + a[0], P[1] + a[1]], length: la };
    const eStart = [P[0] + a[0] * morph + n[0] * off, P[1] + a[1] * morph + n[1] * off];
    const earthLeg = { key: "earth", start: eStart, end: [eStart[0] + b[0], eStart[1] + b[1]], length: lb };
    const Q = [P[0] + a[0] + b[0], P[1] + a[1] + b[1]];
    const nStart = [P[0] - n[0] * offN, P[1] - n[1] * offN];
    const netSeg = { start: nStart, end: [nStart[0] + ns[0], nStart[1] + ns[1]], length: ln };
    const showNet = !f.snapped && ln >= 0.5;
    const connectors = [];
    if (lane > 0.01) connectors.push([tideLeg.end, earthLeg.start]);
    if (morph > 0.5 && (lane > 0.01 || (laneN > 0.01 && showNet))) connectors.push([earthLeg.end, Q]);
    if (laneN > 0.01 && showNet) connectors.push([Q, netSeg.end]);
    const centroid = [(P[0] + tideLeg.end[0] + Q[0]) / 3, (P[1] + tideLeg.end[1] + Q[1]) / 3];
    // Magnified ghost of a leftover that is only a few px long.
    const imbalance = len(net) / (len(T) + len(G));
    let ghost = null;
    if (showNet && f.state.layers.magnifier && ln > 0 && ln < 12 && imbalance > 1e-7) {
      const pow = Math.min(6, Math.ceil(Math.log10(48 / ln)));
      const m = 10 ** pow;
      const ux = ns[0] / ln;
      const uy = ns[1] / ln;
      const end = [nStart[0] + ns[0] * m, nStart[1] + ns[1] * m];
      ghost = { start: nStart, end, pow, tag: [end[0] + ux * 16, end[1] + uy * 16] };
    }
    return {
      blend: fade,
      alpha: fade,
      k,
      P,
      Q,
      legs: [tideLeg, earthLeg],
      net: netSeg,
      showNet,
      connectors,
      lane,
      laneN,
      laneNormal: n,
      centroid,
      imbalance,
      ghost,
    };
  }

  // Early hook: decide whether we are in the Earth close-up and build geometry.
  app.frameHooks.push((f) => {
    f.tide = null;
    const cam = f.cam;
    const E = app.toScreen(1, 0);
    const near = cam.zoom >= TIDE_ZOOM && earthNearView(E, cam.view);
    f.earthZoom = near;
    // Close to Earth the Sun and CM are far off screen; we place Earth's
    // label ourselves so it never sits on the tiny Earth dot.
    if (near) f.hide.bodyLabels = true;
    const p = f.state.probe;
    const dE = Math.hypot(p[0] - 1, p[1]);
    const want = near && dE < TIDE_REACH * hillRadius(f.sys) ? 1 : 0;
    if (app.reducedMotion) blend = want;
    else if (blend !== want) {
      const step = Math.max(16, f.dt || 16) / FADE_MS;
      blend = want > blend ? Math.min(1, blend + step) : Math.max(0, blend - step);
      if (blend !== want) app.invalidate();
    }
    if (blend <= 0) return;
    f.tide = computeTide(f, blend);
  });

  // Late hook (kept last): respect fades/hides set by other modules, then
  // fade the core chain out while the tide view fades in.
  const lateHook = (f) => {
    // At tiny mass ratios L1 and L2 hug Earth and their labels collide:
    // draw the markers ourselves with one shared label.
    if (!f.hide.markers && lPairCrowded(f)) {
      f.hide.markers = true;
      f.mergedMarkers = true;
      if (!f.hide.bodyLabels) {
        f.hide.bodyLabels = true;
        f.ownBodyLabels = true;
      }
    }
    const t = f.tide;
    if (!t) return;
    if (f.hide.chain || f.hide.tide) {
      t.alpha = 0;
      return;
    }
    // "Hold: real motion" keeps the tide view: the tide arrow simply reads
    // as "Sun pull − needed to turn" there (see TIDE_PARTS_INERTIAL).
    const b = t.blend;
    t.alpha = b * f.chainAlpha;
    // Status line and balance ring measure what this view shows: the
    // leftover against the tide and Earth's pull, not against the two huge
    // pulls (Sun and spin) that almost cancel here.
    // frame.b stays the global measure; the ring and a status note measure
    // the close-up (leftover against tide + Earth pull).
    if (b >= 0.5) {
      f.ringB = t.imbalance;
      f.statusNote = tr("statusNote", { pct: pctText(t.imbalance) });
      f.statusNoteLabel = tr("numbersRow");
    }
    f.chainAlpha *= 1 - b;
    if (b >= 0.999) {
      f.hide.chain = true;
      f.hide.leftover = true;
      f.hide.target = true;
      f.hide.labels = true;
      f.hide.sight = true;
    }
  };
  const keepLast = () => {
    const i = app.frameHooks.indexOf(lateHook);
    if (i >= 0) app.frameHooks.splice(i, 1);
    app.frameHooks.push(lateHook);
  };
  keepLast();
  app.on("chapter", keepLast);
  // The real-motion feature moves its hook last when a hold starts; run after it.
  app.on("realmotion", () => setTimeout(keepLast, 0));

  // --- under the chain: Moon's orbit, sight line to Earth ---------------------------------------
  app.addLayer({
    id: "realscale-under",
    z: 44,
    visible: (f) => f.earthZoom || (f.tide && f.tide.alpha > 0.01),
    draw(ctx, f) {
      const E = app.toScreen(1, 0);
      if (f.earthZoom && isRealRatio(f.sys.q)) {
        const r = MOON_ORBIT * app.scale();
        if (r >= 9) circle(ctx, E[0], E[1], r, { stroke: alpha(COLORS.text3, 0.9), width: 1, dash: [2, 4] });
      }
      const t = f.tide;
      if (t && t.alpha > 0.01 && f.state.layers.sight && f.state.arrows === "chain") {
        ctx.globalAlpha = t.alpha;
        line(ctx, t.P[0], t.P[1], E[0], E[1], alpha(COLORS.earth, 0.22), 1);
      }
    },
  });

  // --- markers when L1/L2 crowd Earth (same look as the core markers) -------------------------
  app.addLayer({
    id: "realscale-markers",
    z: 50,
    visible: (f) => Boolean(f.mergedMarkers),
    draw(ctx, f) {
      const state = f.state;
      for (const name of L_NAMES) {
        if (!markerVisible(state, name)) continue;
        const [x, y] = worldPx(f, f.sys.lPoints[name]);
        if (x < -40 || y < -40 || x > f.w + 40 || y > f.h + 40) continue;
        const found = state.found[name];
        diamond(ctx, x, y, 5.5, {
          fill: found ? COLORS.text : COLORS.bg,
          stroke: found ? COLORS.text : COLORS.text3,
          width: 1.5,
        });
      }
    },
  });

  // Labels for the crowded case: bodies first (the core's centred Earth label
  // would cover the 4 px dot on a phone), then L-points with L1 and L2 merged.
  app.addLayer({
    id: "realscale-crowd-labels",
    z: 61,
    visible: (f) => Boolean(f.mergedMarkers),
    draw(ctx, f) {
      const state = f.state;
      const obstacles = (f.obstacles = f.obstacles ?? []);
      obstacles.push(...badgeRects(f));
      const S = app.toScreen(0, 0);
      const E = app.toScreen(1, 0);
      const sunR = f.app.size.phone ? 10 : 11;
      const earthR = Math.max(4, sunR * Math.cbrt(f.sys.q));
      obstacles.push(
        { x: S[0] - sunR - 2, y: S[1] - sunR - 2, w: 2 * sunR + 4, h: 2 * sunR + 4 },
        { x: E[0] - earthR - 2, y: E[1] - earthR - 2, w: 2 * earthR + 4, h: 2 * earthR + 4 },
      );
      if (f.ownBodyLabels) {
        // Side of the axis away from the probe, as in the core.
        const ax = E[0] - S[0];
        const ay = E[1] - S[1];
        const l = Math.hypot(ax, ay) || 1;
        let side = [-ay / l, ax / l];
        const P = f.chain.P;
        if ((P[0] - S[0]) * side[0] + (P[1] - S[1]) * side[1] > 0) side = [-side[0], -side[1]];
        // Away from the probe; if the probe (and its ring) still covers that
        // spot, as when it sits on the axis next to Earth, try the other side.
        const ring = probeRect(f);
        const place = (pt, r, text, color, size) => {
          const parts = [{ text, color }];
          const cands = [];
          for (const extra of [0, 12, 24]) {
            for (const sgn of [1, -1]) {
              const d = [side[0] * sgn, side[1] * sgn];
              const sideways = Math.abs(d[0]) > 0.5;
              const off = r + (sideways ? 7 : size >= 13 ? 12 : 11) + extra;
              const align = sideways ? (d[0] > 0 ? "left" : "right") : "center";
              cands.push({ x: pt[0] + d[0] * off, y: pt[1] + d[1] * off, align });
            }
          }
          const spot = findSpot(ctx, parts, cands, { size, obstacles: [ring, ...obstacles] }) ?? cands[0];
          obstacles.push(richLabel(ctx, parts, spot.x, spot.y, { size, weight: 600, align: spot.align }));
        };
        place(S, sunR, coreT("body.sun"), COLORS.sun, 13);
        place(E, earthR, coreT("body.earth"), COLORS.earth, 13);
        const C = app.toScreen(f.sys.cm[0], f.sys.cm[1]);
        if (Math.hypot(C[0] - S[0], C[1] - S[1]) >= sunR + 6) place(C, 5, "CM", COLORS.text3, 11);
      }
      const bounds = labelBounds(f);
      const segs = arrowSegments(f);
      for (const name of L_NAMES) {
        if (name === "L1" || !markerVisible(state, name)) continue;
        const [x, y] = worldPx(f, f.sys.lPoints[name]);
        if (x < -40 || y < -40 || x > f.w + 40 || y > f.h + 40) continue;
        const pair = name === "L2";
        const found = pair ? state.found.L1 && state.found.L2 : state.found[name];
        const active = pair ? f.snapped === "L1" || f.snapped === "L2" : f.snapped === name;
        const off = active ? 22 : 13;
        const onAxis = name === "L2" || name === "L3";
        const lx = x + (f.cam.rot && onAxis ? off + 4 : off * 0.9);
        const ly = y - (f.cam.rot && onAxis ? 0 : off);
        const color = found ? COLORS.text : COLORS.text2;
        if (!pair) {
          obstacles.push(label(ctx, name, lx, ly, color, { size: 13, weight: 650, align: "left" }));
          continue;
        }
        const parts = [{ text: "L1 L2", color, weight: 650 }];
        const cands = [{ x: lx, y: ly, align: "left" }, ...around([x, y], f.cam.rot
          ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1]]
          : [[1, -1], [-1, -1], [0, -1], [0, 1], [1, 1], [-1, 1]], [18, 28, 40], 13)];
        const avoid = [...obstacles, probeRect(f)];
        const spot =
          findSpot(ctx, parts, cands, { size: 13, obstacles: avoid, segs, bounds }) ??
          findSpot(ctx, parts, cands, { size: 13, obstacles: avoid, bounds }) ?? { x: lx, y: ly, align: "left" };
        obstacles.push(richLabel(ctx, parts, spot.x, spot.y, { size: 13, weight: 650, align: spot.align }));
      }
    },
  });

  // --- landmark labels: Earth, SOHO, JWST, Moon's orbit ------------------------------------------
  app.addLayer({
    id: "realscale-landmarks",
    z: 62,
    visible: (f) => f.earthZoom,
    draw(ctx, f) {
      layoutTideLabels(ctx, f);
      const obstacles = (f.obstacles = f.obstacles ?? []);
      const segs = arrowSegments(f);
      const bounds = labelBounds(f);
      const probe = probeRect(f);
      const all = [...obstacles, probe];
      const E = app.toScreen(1, 0);
      const s = app.scale();
      const rot = f.cam.rot;
      const real = isRealRatio(f.sys.q);

      // Earth's own label (the core one is hidden in the close-up).
      const earthR = earthRadiusPx(f);
      all.push({ x: E[0] - earthR - 2, y: E[1] - earthR - 2, w: 2 * earthR + 4, h: 2 * earthR + 4, tight: true });
      {
        const parts = [{ text: coreT("body.earth"), color: COLORS.earth }];
        const dirs = rot
          ? [[1, 0], [-1, 0], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]
          : [[0, 1], [0, -1], [0.8, 0.6], [-0.8, 0.6], [0.8, -0.6], [-0.8, -0.6]];
        const cands = around(E, dirs, [earthR + 10, earthR + 20, earthR + 32, earthR + 46], 13);
        // Earth always gets a name. A clear spot a little farther out beats
        // covering an arrow; only if arrows cover every spot, sit on them (halo).
        const spot =
          findSpot(ctx, parts, cands, { size: 13, obstacles: all, segs, bounds, margin: 3 }) ??
          findSpot(ctx, parts, cands, { size: 13, obstacles: all, bounds });
        if (spot) {
          const rect = richLabel(ctx, parts, spot.x, spot.y, { size: 13, align: spot.align });
          obstacles.push(rect);
          all.push(rect);
        }
      }
      if (!real) return;

      const color = COLORS.text3;
      const size = 11;
      const weight = 500;

      // Spacecraft at L1 and L2, on the side away from the core's L-labels.
      for (const [name, craft] of [
        ["L1", "SOHO"],
        ["L2", "JWST"],
      ]) {
        // Never name a point the hunt has not revealed yet.
        if (!markerVisible(f.state, name)) continue;
        const L = worldPx(f, f.sys.lPoints[name]);
        if (Math.hypot(L[0] - E[0], L[1] - E[1]) < 24) continue;
        const parts = [{ text: craft, color }];
        const dirs = rot
          ? [[-1, 0], [-1, 0.6], [-1, -0.6], [0, 1], [0, -1]]
          : [[0, 1], [-0.6, 1], [0.6, 1], [0, -1], [-1, -0.6]];
        const spot = findSpot(ctx, parts, around(L, dirs, [15, 26, 38], size), {
          size,
          weight,
          obstacles: all,
          segs,
          bounds,
          margin: 4,
        });
        if (!spot) continue;
        const rect = richLabel(ctx, parts, spot.x, spot.y, { size, weight, align: spot.align });
        obstacles.push(rect);
        all.push(rect);
      }

      // "Moon's orbit" just outside the dashed circle.
      const r = MOON_ORBIT * s;
      if (r >= 9) {
        const parts = [{ text: tr("moonOrbit"), color }];
        const cands = [];
        for (const deg of [-50, -130, 50, 130, -90, 90, -20, -160, 20, 160]) {
          const a = (deg * Math.PI) / 180;
          const d = [Math.cos(a), Math.sin(a)];
          for (const extra of [6, 16, 28]) {
            const x = E[0] + d[0] * (r + extra);
            const y = E[1] + d[1] * (r + extra);
            const align = d[0] > 0.35 ? "left" : d[0] < -0.35 ? "right" : "center";
            cands.push({ x, y: align === "center" ? y + Math.sign(d[1]) * 8 : y, align });
          }
        }
        const spot = findSpot(ctx, parts, cands, { size, weight, obstacles: all, segs, bounds, margin: 6 });
        if (spot) {
          const rect = richLabel(ctx, parts, spot.x, spot.y, { size, weight, align: spot.align });
          obstacles.push(rect);
        }
      }
    },
  });

  // --- the tide chain ------------------------------------------------------------------------------
  app.addLayer({
    id: "realscale-tide",
    z: 85,
    visible: (f) => Boolean(f.tide && f.tide.alpha > 0.01),
    draw(ctx, f) {
      const t = f.tide;
      const width = f.app.size.phone ? 2.5 : 3;
      const dim = f.dimLegs ?? null;
      const dimFor = (key) => {
        if (!dim) return 1;
        if (key === "tide") return dim === "sun" || dim === "cf" ? 1 : 0.25;
        return dim === key ? 1 : 0.25;
      };
      ctx.globalAlpha = t.alpha;
      for (const [a, b] of t.connectors) line(ctx, a[0], a[1], b[0], b[1], COLORS.guide, 1, [1.5, 3]);
      const [tide, earth] = t.legs;
      tideArrow(ctx, tide.start[0], tide.start[1], tide.end[0], tide.end[1], width, dimFor("tide"), Boolean(f.realMotion));
      arrow(ctx, earth.start[0], earth.start[1], earth.end[0], earth.end[1], {
        color: COLORS.earth,
        width,
        alpha: dimFor("earth"),
      });
      if (t.showNet) {
        const { start, end, length } = t.net;
        arrow(ctx, start[0], start[1], end[0], end[1], {
          color: COLORS.leftover,
          width: f.app.size.phone ? 3 : 3.5,
          alpha: dimFor("net"),
        });
        // Magnified ghost when the real leftover is only a few px long.
        const g = t.ghost;
        if (g && t.alpha > 0.5) {
          outlineArrow(ctx, g.start[0], g.start[1], g.end[0], g.end[1], alpha(COLORS.leftover, 0.85), 1.5);
          richLabel(ctx, [{ text: `×10${superscript(g.pow)}`, color: COLORS.text }], g.tag[0], g.tag[1], {
            size: 11,
          });
        }
      }
    },
  });

  // --- labels for the tide chain -------------------------------------------------------------------
  // Placed before the landmark labels (arrow labels win the good spots) and
  // drawn on top of everything at z 121.
  app.addLayer({
    id: "realscale-tide-labels",
    z: 121,
    visible: (f) => Boolean(f.tide && f.tide.alpha > 0.5 && f.state.layers.labels),
    draw(ctx, f) {
      const spots = layoutTideLabels(ctx, f);
      ctx.globalAlpha = Math.min(1, (f.tide.alpha - 0.5) * 2);
      for (const s of spots) richLabel(ctx, s.parts, s.x, s.y, { size: 12 });
    },
  });

  // --- overlay: km scale bar and arrows to off-screen bodies ------------------------------------
  app.addLayer({
    id: "realscale-overlay",
    z: 142,
    visible: (f) => f.earthZoom,
    draw(ctx, f) {
      const v = f.cam.view;
      const s = app.scale();
      const q = f.sys.q;
      const real = isRealRatio(q);
      const color = COLORS.text2;
      const size = 11;
      const placed = [];

      // Scale bar: a round 1/2/5 x 10^n length, at most 160 px.
      const pxPerUnit = real ? s / KM_PER_A : s;
      const maxVal = 160 / pxPerUnit;
      const e = Math.floor(Math.log10(maxVal));
      let nice = 10 ** e;
      for (const m of [5, 2, 1]) {
        if (m * 10 ** e <= maxVal) {
          nice = m * 10 ** e;
          break;
        }
      }
      const barLen = nice * pxPerUnit;
      const safeLeft = f.app.size.phone ? 12 : 18;
      const x0 = v.left + safeLeft;
      const y0 = v.top + v.height - 12;
      ctx.save();
      ctx.strokeStyle = COLORS.bg;
      ctx.lineWidth = 5;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0 - 4);
      ctx.lineTo(x0, y0);
      ctx.lineTo(x0 + barLen, y0);
      ctx.lineTo(x0 + barLen, y0 - 4);
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.lineCap = "butt";
      ctx.stroke();
      ctx.restore();
      const barParts = real
        ? [{ text: formatKm(nice), color }]
        : [
            { text: `${formatA(nice)} `, color },
            { text: "a", color, italic: true },
          ];
      const barRect = richLabel(ctx, barParts, x0, y0 - 13, { size, weight: 500, align: "left" });
      placed.push({ x: x0 - 4, y: barRect.y, w: Math.max(barLen + 8, barRect.w + 4), h: y0 + 4 - barRect.y });
      // The tide view offsets collinear arrows into lanes too: say so, as the
      // core does for its own chain.
      const tv = f.tide;
      if (tv && tv.alpha > 0.5 && (tv.lane > 0.5 || tv.laneN > 0.5)) {
        const note = [{ text: coreT("badge.lanes"), color: COLORS.text3 }];
        const noteRect = richLabel(ctx, note, x0, barRect.y - 12, { size, weight: 500, align: "left" });
        placed.push(noteRect);
      }

      // Edge arrows toward bodies that are off screen.
      const inset = 14;
      const box = { left: v.left + inset, right: v.left + v.width - inset, top: v.top + inset, bottom: v.top + v.height - inset };
      const C = [v.left + v.width / 2, v.top + v.height / 2];
      const bodies = [
        {
          at: [0, 0],
          color: COLORS.sun,
          parts: [
            { text: coreT("body.sun"), color: COLORS.sun, weight: 600 },
            ...(real
              ? [{ text: ` · ${formatKm(KM_PER_A)}`, color }]
              : [
                  { text: " · 1 ", color },
                  { text: "a", color, italic: true },
                ]),
          ],
        },
        { at: [1, 0], color: COLORS.earth, parts: [{ text: coreT("body.earth"), color: COLORS.earth, weight: 600 }] },
      ];
      for (const body of bodies) {
        const B = app.toScreen(body.at[0], body.at[1]);
        const offscreen = B[0] < v.left || B[0] > v.left + v.width || B[1] < v.top || B[1] > v.top + v.height;
        if (!offscreen) continue;
        const d = [B[0] - C[0], B[1] - C[1]];
        const dl = Math.hypot(d[0], d[1]) || 1;
        const u = [d[0] / dl, d[1] / dl];
        const t = reachInside(C, u, box);
        if (!Number.isFinite(t)) continue;
        const tip = [C[0] + u[0] * t, C[1] + u[1] * t];
        const tail = [tip[0] - u[0] * 16, tip[1] - u[1] * 16];
        const w = measureParts(ctx, body.parts, size, 500);
        let tx;
        let ty;
        let align;
        if (Math.abs(u[0]) >= Math.abs(u[1])) {
          // Left/right edge: text continues inward from the arrow's tail.
          align = u[0] < 0 ? "left" : "right";
          tx = tail[0] - u[0] * 6;
          ty = tail[1];
        } else {
          // Top/bottom edge: text beside the arrow.
          const mid = [(tip[0] + tail[0]) / 2, (tip[1] + tail[1]) / 2];
          const fitsRight = mid[0] + 10 + w < v.left + v.width - 8;
          align = fitsRight ? "left" : "right";
          tx = mid[0] + (fitsRight ? 10 : -10);
          ty = mid[1];
        }
        // Stay clear of the scale bar.
        let rect = { x: (align === "left" ? tx : tx - w) - 2, y: ty - size * 0.6 - 2, w: w + 4, h: size * 1.2 + 4 };
        let shift = 0;
        while (placed.some((r) => rectsOverlap(r, rect)) && shift < 80) {
          shift += 6;
          rect = { ...rect, y: rect.y - 6 };
        }
        edgePointer(ctx, tip[0], tip[1] - (Math.abs(u[0]) >= Math.abs(u[1]) ? shift : 0), u, body.color);
        const r = richLabel(ctx, body.parts, tx, ty - shift, { size, weight: 500, align });
        placed.push(r);
      }
    },
  });
}
