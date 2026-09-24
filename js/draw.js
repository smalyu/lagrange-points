// Canvas drawing primitives shared by every layer.

import { COLORS, alpha, font } from "./theme.js";

/**
 * Arrow from (x0, y0) to (x1, y1).
 * opts: color, width, dash, underlay (bool), alpha, hollow (outline only),
 *       headMax (px), dotIfShort (bool)
 */
export function arrow(ctx, x0, y0, x1, y1, opts = {}) {
  const color = opts.color ?? COLORS.text;
  const width = opts.width ?? 3;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;

  if (length < 6) {
    if (opts.dotIfShort !== false && length >= 0.5) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(x1, y1, 1.5 + width * 0.25, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    return;
  }

  const ux = dx / length;
  const uy = dy / length;
  const headLen = Math.min(opts.headMax ?? 12, 0.4 * length);
  const half = (25 * Math.PI) / 180;
  const headHalfW = Math.tan(half) * headLen;
  const bx = x1 - ux * headLen;
  const by = y1 - uy * headLen;
  // Shaft stops inside the head so a thick shaft never pokes past the tip.
  const sx = x1 - ux * headLen * 0.6;
  const sy = y1 - uy * headLen * 0.6;
  const lx = bx - uy * headHalfW;
  const ly = by + ux * headHalfW;
  const rx = bx + uy * headHalfW;
  const ry = by - ux * headHalfW;

  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  if (opts.underlay !== false) {
    ctx.strokeStyle = COLORS.bg;
    ctx.lineWidth = width + 3;
    ctx.setLineDash([]);
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
  }

  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(opts.dash ?? []);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(opts.hollow ? bx : sx, opts.hollow ? by : sy);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(lx, ly);
  ctx.lineTo(rx, ry);
  ctx.closePath();
  if (opts.hollow) {
    ctx.lineWidth = Math.max(1.25, width * 0.6);
    ctx.stroke();
  } else {
    ctx.fill();
  }
  ctx.restore();
}

/** Hollow arrow drawn as a double outline (used for magnified ghosts). */
export function outlineArrow(ctx, x0, y0, x1, y1, color, width = 1.5) {
  arrow(ctx, x0, y0, x1, y1, { color, width, dash: [5, 4], hollow: true, underlay: false });
}

export function line(ctx, x0, y0, x1, y1, color, width = 1, dash = null) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  if (dash) ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.restore();
}

export function circle(ctx, x, y, r, { fill = null, stroke = null, width = 1, dash = null } = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, Math.PI * 2);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
  }
  ctx.restore();
}

export function diamond(ctx, x, y, r, { fill = null, stroke = null, width = 1.25, dash = null } = {}) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Text with a background-coloured halo. Returns its bounding rect so callers
 * can avoid collisions. align: "left" | "center" | "right".
 */
export function label(ctx, text, x, y, color, opts = {}) {
  const size = opts.size ?? 12;
  const weight = opts.weight ?? 600;
  const align = opts.align ?? "center";
  const baseline = opts.baseline ?? "middle";
  ctx.save();
  if (opts.alpha != null) ctx.globalAlpha *= opts.alpha;
  ctx.font = font(size, weight);
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  const w = ctx.measureText(text).width;
  if (opts.halo !== false) {
    ctx.strokeStyle = opts.haloColor ?? COLORS.bg;
    ctx.lineWidth = opts.haloWidth ?? 4;
    ctx.lineJoin = "round";
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
  const left = align === "center" ? x - w / 2 : align === "right" ? x - w : x;
  const top = baseline === "middle" ? y - size * 0.6 : baseline === "top" ? y : y - size;
  return { x: left - 2, y: top - 2, w: w + 4, h: size * 1.2 + 4 };
}

export function measure(ctx, text, size = 12, weight = 600) {
  ctx.save();
  ctx.font = font(size, weight);
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Rounded pill with text, e.g. badges. Returns its rect. */
export function pill(ctx, text, x, y, opts = {}) {
  const size = opts.size ?? 11;
  const padX = opts.padX ?? 7;
  const h = opts.height ?? 20;
  ctx.save();
  ctx.font = font(size, opts.weight ?? 500);
  const w = ctx.measureText(text).width + padX * 2;
  const left = opts.align === "center" ? x - w / 2 : opts.align === "right" ? x - w : x;
  const top = y - h / 2;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, h / 2);
  ctx.fillStyle = opts.fill ?? alpha(COLORS.surface, 0.92);
  ctx.fill();
  ctx.strokeStyle = opts.stroke ?? COLORS.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = opts.color ?? COLORS.text2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, left + padX, y + 0.5);
  ctx.restore();
  return { x: left, y: top, w, h };
}

export function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export const easeOutCubic = (t) => 1 - (1 - t) ** 3;
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Superscript digits for "10⁻⁶"-style text. */
const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };
export function superscript(n) {
  return String(n)
    .split("")
    .map((c) => SUP[c] ?? c)
    .join("");
}
