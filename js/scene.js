// Core scene layers. Draw order (z) follows the design: background, axis,
// guides, markers, bodies, target, legs, leftover, probe, labels, badges.
//
// Anything that must stay readable (labels, badges) is placed clear of the
// arrow shafts and of frame.obstacles, the shared list of screen rects that
// other layers and modules push into before the label pass.

import { COLORS, LEG_STYLE, alpha, font } from "./theme.js";
import { L_NAMES, len } from "./physics.js";
import { visibleWorld } from "./camera.js";
import { markerVisible } from "./state.js";
import { t } from "./strings.js";
import { fmtFixed, fmtNumber, pct } from "./i18n.js";
import {
  arrow,
  circle,
  diamond,
  easeInOutCubic,
  label,
  line,
  outlineArrow,
  pill,
  rectsOverlap,
  superscript,
} from "./draw.js";

export const Z = {
  background: 10,
  axis: 20,
  guides: 30,
  sight: 40,
  markers: 50,
  bodies: 60,
  target: 70,
  legs: 80,
  leftover: 90,
  magnified: 100,
  probe: 110,
  trace: 115,
  labels: 120,
  badges: 130,
  overlay: 140,
};

const LABEL_PRIORITY = ["net", "sun", "earth", "cf"];
const TRACE_MS = 650;

export function bodyRadii(frame) {
  const sunR = frame.app.size.phone ? 10 : 11;
  const earthR = Math.max(4, sunR * Math.cbrt(frame.sys.q));
  return { sunR, earthR };
}

export function ringRadius(frame) {
  return frame.app.size.phone ? 17 : 15;
}

// ---- geometry helpers ---------------------------------------------------------------

/** Does the segment a-b cross the rectangle r (grown by pad)? Liang–Barsky. */
export function segHitsRect(a, b, r, pad = 0) {
  const x0 = r.x - pad;
  const y0 = r.y - pad;
  const x1 = r.x + r.w + pad;
  const y1 = r.y + r.h + pad;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - x0, x1 - a[0], a[1] - y0, y1 - a[1]];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const tt = q[i] / p[i];
      if (p[i] < 0) {
        if (tt > t1) return false;
        if (tt > t0) t0 = tt;
      } else {
        if (tt < t0) return false;
        if (tt < t1) t1 = tt;
      }
    }
  }
  return true;
}

/** Visible arrow shafts of the core chain as screen segments. */
export function arrowSegments(f) {
  const segs = [];
  if (f.hide.chain || f.chainAlpha < 0.3) return segs;
  for (const leg of f.chain.legs) {
    if (f.hideLegs?.[leg.key] || leg.length < 2) continue;
    segs.push([leg.start, leg.end]);
  }
  const net = f.chain.net;
  if (!f.snapped && !f.hide.leftover && net.length >= 2) segs.push([net.start, net.end]);
  return segs;
}

/** Is this rect free of arrows, obstacles and the screen edge? */
function rectIsFree(f, rect, segs, extra = []) {
  if (rect.x < 4 || rect.y < 4 || rect.x + rect.w > f.w - 4 || rect.y + rect.h > f.h - 4) return false;
  for (const r of f.obstacles ?? []) if (rectsOverlap(r, rect)) return false;
  for (const r of extra) if (rectsOverlap(r, rect)) return false;
  for (const [a, b] of segs) if (segHitsRect(a, b, rect, 2)) return false;
  return true;
}

function textRect(ctx, text, cx, cy, size, weight, align = "center") {
  ctx.save();
  ctx.font = font(size, weight);
  const w = ctx.measureText(text).width;
  ctx.restore();
  const left = align === "center" ? cx - w / 2 : align === "right" ? cx - w : cx;
  return { x: left - 2, y: cy - size * 0.6 - 2, w: w + 4, h: size * 1.2 + 4 };
}

/** Unit vector perpendicular to the Sun-Earth axis, pointing away from P. */
function awaySide(f, P, S, E) {
  const ax = E[0] - S[0];
  const ay = E[1] - S[1];
  const l = Math.hypot(ax, ay) || 1;
  let nx = -ay / l;
  let ny = ax / l;
  const side = (P[0] - S[0]) * nx + (P[1] - S[1]) * ny;
  // A probe on the axis gives ±1e-14 noise once the view turns: keep a
  // steady side unless the probe is clearly off the line.
  if (side > 0.5) {
    nx = -nx;
    ny = -ny;
  }
  return [nx, ny];
}

export function installScene(app) {
  const pulse = { start: -1, x: 0, y: 0 };
  const trace = { start: -1, until: 0 };
  let hold = null;

  app.on("snap", () => {
    pulse.start = -1;
    app.animate((now) => {
      if (pulse.start < 0) pulse.start = now;
      return now - pulse.start < 260;
    });
  });
  app.on("hold", (h) => {
    hold = h;
  });
  app.on("unsnap", () => {
    hold = null;
    trace.until = 0;
  });
  app.on("pointerup", () => {
    hold = null;
    app.invalidate();
  });

  /** Send a small dot once around the closed loop: tip to tail, back home. */
  app.traceLoop = () => {
    if (app.reducedMotion) return;
    trace.start = -1;
    trace.until = Infinity;
    app.animate((now) => {
      if (trace.start < 0) trace.start = now;
      const done = now - trace.start > TRACE_MS + 80;
      if (done) trace.until = 0;
      return !done;
    });
  };
  app.on("found", (e) => {
    if (e.firstTime) setTimeout(() => app.state.snap && app.traceLoop(), 120);
  });

  // Background ---------------------------------------------------------------
  app.addLayer({
    id: "background",
    z: Z.background,
    draw(ctx, f) {
      ctx.fillStyle = COLORS.bg;
      ctx.fillRect(0, 0, f.w, f.h);
    },
  });

  // Sun-Earth axis: always drawn, it is where L1-L3 live -----------------------
  app.addLayer({
    id: "axis",
    z: Z.axis,
    draw(ctx, f) {
      const box = visibleWorld(f.cam, f.w, f.h);
      const pad = (box.maxX - box.minX + box.maxY - box.minY) * 0.1;
      const a = app.toScreen(box.minX - pad, 0);
      const b = app.toScreen(box.maxX + pad, 0);
      line(ctx, a[0], a[1], b[0], b[1], COLORS.guide, 1);
    },
  });

  // Sight lines and tether ---------------------------------------------------
  app.addLayer({
    id: "sight",
    z: Z.sight,
    visible: (f) => f.state.layers.sight && !f.hide.sight && f.state.arrows === "chain",
    draw(ctx, f) {
      const { P, C } = f.chain;
      const S = app.toScreen(0, 0);
      const E = app.toScreen(1, 0);
      const a = f.chainAlpha * Math.min(1, f.chain.morph + 0.2);
      ctx.globalAlpha = a;
      line(ctx, P[0], P[1], S[0], S[1], alpha(COLORS.sun, 0.2), 1);
      line(ctx, P[0], P[1], E[0], E[1], alpha(COLORS.earth, 0.2), 1);
      line(ctx, C[0], C[1], P[0], P[1], alpha(COLORS.spin, 0.32), 1, [3, 4]);
    },
  });

  // Lagrange point markers (only those revealed) -------------------------------
  app.addLayer({
    id: "markers",
    z: Z.markers,
    visible: (f) => !f.hide.markers,
    draw(ctx, f) {
      const state = f.state;
      const segs = arrowSegments(f);
      const ringR = ringRadius(f);
      const P = f.chain.P;
      const probeRect = { x: P[0] - ringR - 3, y: P[1] - ringR - 3, w: 2 * ringR + 6, h: 2 * ringR + 6 };
      f.obstacles = f.obstacles ?? [];
      for (const name of L_NAMES) {
        if (!markerVisible(state, name)) continue;
        const p = f.sys.lPoints[name];
        const [x, y] = app.toScreen(p[0], p[1]);
        if (x < -40 || y < -40 || x > f.w + 40 || y > f.h + 40) continue;
        const found = state.found[name];
        const active = f.snapped === name;
        diamond(ctx, x, y, 5.5, {
          fill: found ? COLORS.text : COLORS.bg,
          stroke: found ? COLORS.text : COLORS.text3,
          width: 1.5,
        });
        // Try the corners around the marker; keep clear of arrows and the probe.
        const off = active ? ringR + 6 : 12;
        const spots = [
          [x + off * 0.9, y - off, "left"],
          [x - off * 0.9, y - off, "right"],
          [x + off * 0.9, y + off, "left"],
          [x - off * 0.9, y + off, "right"],
          [x + off + 6, y, "left"],
          [x - off - 6, y, "right"],
        ];
        let pick = spots[0];
        for (const s of spots) {
          const r = textRect(ctx, name, s[0], s[1], 13, 650, s[2]);
          if (rectIsFree(f, r, segs, [probeRect])) {
            pick = s;
            break;
          }
        }
        const rect = label(ctx, name, pick[0], pick[1], found ? COLORS.text : COLORS.text2, {
          size: 13,
          weight: 650,
          align: pick[2],
        });
        f.obstacles.push(rect);
      }
    },
  });

  // Bodies and the centre of mass -------------------------------------------------
  app.addLayer({
    id: "bodies",
    z: Z.bodies,
    draw(ctx, f) {
      const { sunR, earthR } = bodyRadii(f);
      const S = app.toScreen(0, 0);
      const E = app.toScreen(1, 0);
      const C = app.toScreen(f.sys.cm[0], f.sys.cm[1]);
      circle(ctx, S[0], S[1], sunR, { fill: alpha(COLORS.sun, 0.85) });
      circle(ctx, E[0], E[1], earthR, { fill: alpha(COLORS.earth, 0.85) });

      // CM: the classic barycentre mark (ring with a cross).
      const nearSun = Math.hypot(C[0] - S[0], C[1] - S[1]) < sunR + 6;
      ctx.save();
      ctx.strokeStyle = nearSun ? COLORS.bg : COLORS.text2;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(C[0], C[1], 4, 0, Math.PI * 2);
      ctx.moveTo(C[0] - 6.5, C[1]);
      ctx.lineTo(C[0] + 6.5, C[1]);
      ctx.moveTo(C[0], C[1] - 6.5);
      ctx.lineTo(C[0], C[1] + 6.5);
      ctx.stroke();
      ctx.restore();

      f.obstacles = f.obstacles ?? [];
      const sunDisc = { x: S[0] - sunR - 2, y: S[1] - sunR - 2, w: 2 * sunR + 4, h: 2 * sunR + 4 };
      const earthDisc = { x: E[0] - earthR - 2, y: E[1] - earthR - 2, w: 2 * earthR + 4, h: 2 * earthR + 4 };
      if (f.hide.bodyLabels) {
        f.obstacles.push(sunDisc, earthDisc);
        return;
      }

      // Preferred side: away from the probe (the chain is mostly between the
      // probe and the bodies), then the other side, then along the axis.
      const P = f.chain.P;
      const side = awaySide(f, P, S, E);
      const along = (() => {
        const ax = E[0] - S[0];
        const ay = E[1] - S[1];
        const l = Math.hypot(ax, ay) || 1;
        return [ax / l, ay / l];
      })();
      const segs = arrowSegments(f);
      const ringR = ringRadius(f);
      const probeRect = { x: P[0] - ringR - 3, y: P[1] - ringR - 3, w: 2 * ringR + 6, h: 2 * ringR + 6 };
      const place = (pt, r, text, color, size, towardOut, avoid) => {
        const gap = r + (size >= 13 ? 14 : 12);
        const dirs = [
          side,
          [-side[0], -side[1]],
          [side[0] + towardOut[0] * 1.2, side[1] + towardOut[1] * 1.2],
          [-side[0] + towardOut[0] * 1.2, -side[1] + towardOut[1] * 1.2],
          [side[0] - towardOut[0] * 1.2, side[1] - towardOut[1] * 1.2],
          [-side[0] - towardOut[0] * 1.2, -side[1] - towardOut[1] * 1.2],
          along,
          [-along[0], -along[1]],
          [side[0] * 1.6 + along[0], side[1] * 1.6 + along[1]],
          [side[0] * 1.6 - along[0], side[1] * 1.6 - along[1]],
        ];
        let best = null;
        for (const d of dirs) {
          const dl = Math.hypot(d[0], d[1]) || 1;
          const ux = d[0] / dl;
          const uy = d[1] / dl;
          // Text beside a vertical axis starts next to the dot.
          const align = Math.abs(ux) > 0.6 ? (ux > 0 ? "left" : "right") : "center";
          const cx = pt[0] + ux * (align === "center" ? gap : r + 7);
          const cy = pt[1] + uy * gap * (align === "center" ? 1 : 0.6);
          const rect = textRect(ctx, text, cx, cy, size, 600, align);
          if (rectIsFree(f, rect, segs, [probeRect, ...avoid])) {
            best = { cx, cy, align };
            break;
          }
          if (!best) best = { cx, cy, align, fallback: true };
        }
        const rect = label(ctx, text, best.cx, best.cy, color, { size, weight: 600, align: best.align });
        f.obstacles.push(rect);
      };
      // Each label avoids the other body's disc; both discs become obstacles
      // for everything placed later.
      place(S, sunR, t("body.sun"), COLORS.sun, 13, [-along[0], -along[1]], [earthDisc]);
      place(E, earthR, t("body.earth"), COLORS.earth, 13, along, [sunDisc]);
      if (!nearSun) place(C, 6, t("body.cm"), COLORS.text3, 11, along, [sunDisc, earthDisc]);
      f.obstacles.push(sunDisc, earthDisc);
    },
  });

  // Target ring: where gravity must land for balance ------------------------------
  app.addLayer({
    id: "target",
    z: Z.target,
    visible: (f) => f.state.arrows === "chain" && !f.hide.target,
    draw(ctx, f) {
      const [tx, ty] = f.chain.target;
      const a = f.chainAlpha * f.chain.morph;
      if (a <= 0.01) return;
      ctx.globalAlpha = a;
      const snapped = Boolean(f.snapped);
      circle(ctx, tx, ty, 8, {
        fill: snapped ? alpha(COLORS.leftover, 0.95) : null,
        stroke: snapped ? COLORS.leftover : COLORS.text2,
        width: 1.5,
      });
      circle(ctx, tx, ty, 2, { fill: snapped ? COLORS.bg : COLORS.text2 });
      (f.obstacles = f.obstacles ?? []).push({ x: tx - 10, y: ty - 10, w: 20, h: 20 });
    },
  });

  // The chain of pulls ---------------------------------------------------------
  app.addLayer({
    id: "legs",
    z: Z.legs,
    visible: (f) => !f.hide.chain,
    draw(ctx, f) {
      const chain = f.chain;
      const width = f.app.size.phone ? 2.5 : 3;
      const ringR = ringRadius(f);
      ctx.globalAlpha = f.chainAlpha;

      // Closed loop: faint fill so "closed" reads as a shape.
      if (f.snapped && chain.morph > 0.9 && chain.laneWeight < 0.5) {
        ctx.save();
        ctx.fillStyle = alpha(COLORS.leftover, 0.06);
        ctx.beginPath();
        ctx.moveTo(chain.joints[0][0], chain.joints[0][1]);
        ctx.lineTo(chain.joints[1][0], chain.joints[1][1]);
        ctx.lineTo(chain.joints[2][0], chain.joints[2][1]);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }

      for (const [a, b] of chain.connectors) {
        line(ctx, a[0], a[1], b[0], b[1], COLORS.guide, 1, [1.5, 3]);
      }
      const dim = f.dimLegs ?? null;
      const P = chain.P;
      for (const leg of chain.legs) {
        if (f.hideLegs?.[leg.key]) continue;
        const style = LEG_STYLE[leg.key];
        let [ex, ey] = leg.end;
        // A leg that comes home into the probe would hide its arrowhead under
        // the balance ring: stop it just outside, pointing in.
        const dEnd = Math.hypot(ex - P[0], ey - P[1]);
        if (dEnd < ringR + 4 && leg.length > ringR + 14 && chain.morph > 0.5) {
          const ux = (leg.end[0] - leg.start[0]) / leg.length;
          const uy = (leg.end[1] - leg.start[1]) / leg.length;
          // Distance still to go along the leg before it reaches the probe.
          const ahead = ux * (P[0] - leg.end[0]) + uy * (P[1] - leg.end[1]);
          const back = ringR + 4 - ahead;
          if (back > 0) {
            ex -= ux * back;
            ey -= uy * back;
          }
        }
        arrow(ctx, leg.start[0], leg.start[1], ex, ey, {
          color: style.color,
          width,
          dash: style.dash,
          alpha: dim && dim !== leg.key ? 0.25 : 1,
        });
      }
    },
  });

  // Leftover (net) arrow ----------------------------------------------------------
  app.addLayer({
    id: "leftover",
    z: Z.leftover,
    visible: (f) => !f.hide.chain && !f.hide.leftover,
    draw(ctx, f) {
      if (f.snapped) return;
      const { start, end, length } = f.chain.net;
      if (length < 0.5) return;
      ctx.globalAlpha = f.chainAlpha;
      const dim = f.dimLegs ?? null;
      arrow(ctx, start[0], start[1], end[0], end[1], {
        color: COLORS.leftover,
        width: f.app.size.phone ? 3 : 3.5,
        alpha: dim && dim !== "net" ? 0.25 : 1,
      });
    },
  });

  // Magnified leftover: once the real arrow hides inside the balance ring, show
  // a ghost 10ⁿ times longer so the last few percent stay visible.
  app.addLayer({
    id: "magnified",
    z: Z.magnified,
    visible: (f) =>
      f.state.layers.magnifier && !f.hide.chain && !f.hide.leftover && !f.snapped && f.chainAlpha > 0.5,
    draw(ctx, f) {
      const { start, end, length } = f.chain.net;
      const limit = ringRadius(f) + 6;
      if (!(length > 0) || length >= limit || f.b <= 1e-5) return;
      const n = Math.min(6, Math.max(1, Math.ceil(Math.log10((limit * 3) / length))));
      const m = 10 ** n;
      const ex = start[0] + (end[0] - start[0]) * m;
      const ey = start[1] + (end[1] - start[1]) * m;
      outlineArrow(ctx, start[0], start[1], ex, ey, alpha(COLORS.leftover, 0.85), 1.5);
      const ux = (end[0] - start[0]) / length;
      const uy = (end[1] - start[1]) / length;
      const rect = label(ctx, `×10${superscript(n)}`, ex + ux * 16, ey + uy * 16, COLORS.text, {
        size: 11,
        weight: 600,
      });
      (f.obstacles = f.obstacles ?? []).push(rect);
    },
  });

  // Probe, balance ring, snap pulse, hold line ---------------------------------------
  app.addLayer({
    id: "probe",
    z: Z.probe,
    visible: (f) => !f.hide.probe,
    draw(ctx, f) {
      const [px, py] = f.chain.P;
      const ringR = ringRadius(f);

      if (hold && f.snapped) {
        line(ctx, hold.cursor[0], hold.cursor[1], px, py, alpha(COLORS.text, 0.35), 1);
      }

      if (!f.hide.ring) {
        const b = f.ringB ?? f.b;
        const fill = f.snapped ? 1 : Math.min(1, Math.max(0, -Math.log10(Math.max(b, 1e-12)) / 4));
        circle(ctx, px, py, ringR, { stroke: COLORS.border, width: 3 });
        if (fill > 0.002) {
          ctx.save();
          ctx.strokeStyle = COLORS.text;
          ctx.lineWidth = 3;
          ctx.lineCap = "butt";
          ctx.beginPath();
          ctx.arc(px, py, ringR, -Math.PI / 2, -Math.PI / 2 + fill * Math.PI * 2);
          ctx.stroke();
          ctx.restore();
        }
        // Decade ticks at 1%, 0.1%, 0.01% (25/50/75% of the ring).
        ctx.save();
        ctx.strokeStyle = COLORS.bg;
        ctx.lineWidth = 1.5;
        for (const q of [0.25, 0.5, 0.75]) {
          const ang = -Math.PI / 2 + q * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(px + Math.cos(ang) * (ringR - 2.5), py + Math.sin(ang) * (ringR - 2.5));
          ctx.lineTo(px + Math.cos(ang) * (ringR + 2.5), py + Math.sin(ang) * (ringR + 2.5));
          ctx.stroke();
        }
        ctx.restore();
      }

      if (pulse.start >= 0 && f.now - pulse.start < 260 && !f.app.reducedMotion) {
        const k = (f.now - pulse.start) / 260;
        circle(ctx, px, py, ringR + k * 22, {
          stroke: alpha(COLORS.text, 0.55 * (1 - k)),
          width: 2,
        });
      }

      circle(ctx, px, py, 8, { fill: COLORS.bg });
      circle(ctx, px, py, 6, { fill: COLORS.text });

      // Keyboard focus: the arrow keys move this probe, so ring it.
      const canvas = f.app.canvas;
      if (document.activeElement === canvas && canvas.matches?.(":focus-visible")) {
        circle(ctx, px, py, ringR + 7, { stroke: alpha(COLORS.text, 0.7), width: 1.5, dash: [3, 3] });
      }
    },
  });
  app.canvas.addEventListener("focus", () => app.invalidate());
  app.canvas.addEventListener("blur", () => app.invalidate());

  // Loop trace: a dot runs once round the closed chain (first find, sweeps) ----
  app.addLayer({
    id: "loop-trace",
    z: Z.trace,
    visible: (f) => trace.until > 0 && trace.start >= 0 && Boolean(f.snapped) && !f.hide.chain,
    draw(ctx, f) {
      const pts = [];
      for (const leg of f.chain.legs) {
        if (f.hideLegs?.[leg.key]) continue;
        pts.push(leg.start, leg.end);
      }
      if (pts.length < 2) return;
      const lens = [];
      let total = 0;
      for (let i = 1; i < pts.length; i += 1) {
        const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        lens.push(l);
        total += l;
      }
      if (total < 20) return;
      const at = (u) => {
        let d = Math.min(1, Math.max(0, u)) * total;
        for (let i = 0; i < lens.length; i += 1) {
          if (d <= lens[i] || i === lens.length - 1) {
            const k = lens[i] > 0 ? Math.min(1, d / lens[i]) : 1;
            return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
          }
          d -= lens[i];
        }
        return pts[pts.length - 1];
      };
      const u = easeInOutCubic(Math.min(1, (f.now - trace.start) / TRACE_MS));
      for (let i = 6; i >= 0; i -= 1) {
        const p = at(u - i * 0.025);
        circle(ctx, p[0], p[1], i === 0 ? 4 : 3 - i * 0.3, {
          fill: alpha(COLORS.leftover, i === 0 ? 1 : 0.5 - i * 0.06),
        });
      }
    },
  });

  // Leg labels, placed at midpoints and dropped on collision --------------------------
  app.addLayer({
    id: "labels",
    z: Z.labels,
    visible: (f) => f.state.layers.labels && !f.hide.chain && !f.hide.labels && f.chainAlpha > 0.5,
    draw(ctx, f) {
      const chain = f.chain;
      const placed = [];
      const ringR = ringRadius(f);
      const [px, py] = chain.P;
      placed.push({ x: px - ringR - 3, y: py - ringR - 3, w: 2 * ringR + 6, h: 2 * ringR + 6 });
      for (const r of f.obstacles ?? []) placed.push(r);
      for (const b of badgeLayout(f)) placed.push(b.rect);
      const segs = arrowSegments(f);

      const items = [];
      for (const leg of chain.legs) {
        if (f.hideLegs?.[leg.key]) continue;
        items.push({ key: leg.key, start: leg.start, end: leg.end, length: leg.length, lane: leg.lane });
      }
      if (!f.snapped && chain.net.length >= 0.5) {
        items.push({ key: "net", start: chain.net.start, end: chain.net.end, length: chain.net.length, lane: -1 });
      }
      items.sort((a, b) => LABEL_PRIORITY.indexOf(a.key) - LABEL_PRIORITY.indexOf(b.key));

      const fan = chain.morph < 0.5;
      const lanes = chain.laneWeight > 0.5;
      const size = 12;
      for (const item of items) {
        if (item.length < 36) continue;
        const text = LEG_STYLE[item.key].label;
        ctx.font = font(size, 600);
        const w = ctx.measureText(text).width + 4;
        const h = size * 1.2 + 4;
        const ux = (item.end[0] - item.start[0]) / item.length;
        const uy = (item.end[1] - item.start[1]) / item.length;
        let nx = -uy;
        let ny = ux;
        let sides = [1, -1];
        if (lanes) {
          const [lnx, lny] = chain.laneNormal;
          const outward = item.key === "sun" || item.key === "net" ? -1 : 1;
          nx = lnx * outward;
          ny = lny * outward;
          sides = [1];
        } else {
          const mx = (item.start[0] + item.end[0]) / 2;
          const my = (item.start[1] + item.end[1]) / 2;
          if (nx * (mx - chain.centroid[0]) + ny * (my - chain.centroid[1]) < 0) {
            nx = -nx;
            ny = -ny;
          }
        }
        const extra = !lanes ? 0 : item.key === "earth" || item.key === "cf" ? 2 * 9 : item.key === "net" ? 9 : 0;
        const alongs = fan ? [0.62, 0.8, 0.45] : [0.5, 0.36, 0.64, 0.24, 0.76];
        const gaps = [8, 20];
        let chosen = null;
        search: for (const gap of gaps) {
          for (const side of sides) {
            for (const along of alongs) {
              const mx = item.start[0] + (item.end[0] - item.start[0]) * along;
              const my = item.start[1] + (item.end[1] - item.start[1]) * along;
              const sx = nx * side;
              const sy = ny * side;
              const reach = gap + extra + Math.abs(sx) * (w / 2) + Math.abs(sy) * (h / 2);
              const cx = mx + sx * reach;
              const cy = my + sy * reach;
              const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
              if (placed.some((r) => rectsOverlap(r, rect))) continue;
              if (segs.some(([a, b]) => segHitsRect(a, b, rect, 1.5))) continue;
              if (rect.x < 4 || rect.y < 4 || rect.x + rect.w > f.w - 4 || rect.y + rect.h > f.h - 4) continue;
              chosen = { cx, cy, rect };
              break search;
            }
          }
        }
        if (!chosen) continue;
        placed.push(chosen.rect);
        label(ctx, text, chosen.cx, chosen.cy, LEG_STYLE[item.key].color, { size, weight: 600 });
      }
      f.labelRects = placed;
    },
  });

  // Badges: arrow scale, lanes caption --------------------------------------------------
  app.addLayer({
    id: "badges",
    z: Z.badges,
    visible: (f) => !f.hide.chain && f.chainAlpha > 0.5 && f.state.arrows === "chain",
    draw(ctx, f) {
      for (const b of badgeLayout(f)) {
        if (b.kind === "scale") pill(ctx, b.text, b.x, b.y, { size: 11, align: "left" });
        else label(ctx, b.text, b.x, b.y, COLORS.text3, { size: 11, weight: 500, align: "left" });
        (f.obstacles = f.obstacles ?? []).push(b.rect);
      }
    },
  });
}

/**
 * Where the scale badge and the lanes caption go (screen rects), computed once
 * per frame and shared by the labels layer (to keep leg labels off them) and
 * the badges layer. The spot is the first one around the probe that is clear
 * of arrows, obstacles and the screen edge. frame.badgeShift, if a module
 * sets it, pins the badges relative to the probe instead.
 */
export function badgeLayout(f) {
  if (f._badges) return f._badges;
  const chain = f.chain;
  const out = [];
  f._badges = out;
  if (f.hide.chain || f.chainAlpha <= 0.5 || f.state.arrows !== "chain") return out;
  const items = [];
  if (chain.rho < 0.97) {
    const k =
      chain.rho >= 0.1
        ? fmtFixed(chain.rho, 2)
        : fmtNumber(Number(chain.rho.toPrecision(1)), { maximumSignificantDigits: 1 });
    items.push({ kind: "scale", text: t("badge.scale", { k }), h: 20, size: 11, weight: 500, pad: 14 });
  }
  if (chain.laneWeight > 0.5 && !f.snapped) {
    items.push({ kind: "lanes", text: t("badge.lanes"), h: 16, size: 11, weight: 500, pad: 4 });
  }
  if (!items.length) return out;
  const ctx = f.app.ctx;
  for (const it of items) {
    ctx.save();
    ctx.font = font(it.size, it.weight);
    it.w = ctx.measureText(it.text).width + it.pad;
    ctx.restore();
  }
  const stackW = Math.max(...items.map((it) => it.w));
  const stackH = items.reduce((s, it) => s + it.h + 4, -4);
  const ringR = ringRadius(f);
  const [px, py] = chain.P;
  const below = ringR + 12;
  const candidates = f.badgeShift
    ? [[px + 12 + f.badgeShift[0], py + below + f.badgeShift[1]]]
    : [
        [px + 12, py + below],
        [px - 12 - stackW, py + below],
        [px + 12, py - below - stackH],
        [px - 12 - stackW, py - below - stackH],
        [px + ringR + 10, py - stackH / 2],
        [px - ringR - 10 - stackW, py - stackH / 2],
        [px - stackW / 2, py + below + 10],
        [px - stackW / 2, py - below - stackH - 10],
      ];
  const segs = arrowSegments(f);
  const probeRect = { x: px - ringR - 3, y: py - ringR - 3, w: 2 * ringR + 6, h: 2 * ringR + 6 };
  const view = f.cam.view;
  const layout = (x0, y0) => {
    let y = y0;
    return items.map((it) => {
      const rect = { x: x0, y, w: it.w, h: it.h };
      const r = { ...it, x: x0, y: y + it.h / 2, rect };
      y += it.h + 4;
      return r;
    });
  };
  let best = null;
  for (const [x0, y0] of candidates) {
    const rows = layout(x0, y0);
    const ok = rows.every(
      (r) =>
        r.rect.y >= view.top &&
        r.rect.y + r.rect.h <= view.top + view.height &&
        rectIsFree(f, r.rect, segs, [probeRect]),
    );
    if (ok) {
      best = rows;
      break;
    }
    if (!best) best = rows;
  }
  for (const r of best) out.push({ kind: r.kind, text: r.text, x: r.x, y: r.y, rect: r.rect });
  return out;
}

/**
 * A fraction (0..1) as a percentage for people: "12%", "3.4%", "0.42%",
 * "< 0.01%" (localized). plain: always one decimal, no "<" cut-off.
 */
export function formatLeftover(b, { plain = false } = {}) {
  const value = b * 100;
  if (plain) return pct(fmtFixed(value, 1));
  if (value < 0.01) return t("leftover.tiny");
  const digits = value >= 10 ? 0 : value >= 1 ? 1 : 2;
  return pct(fmtFixed(value, digits));
}

export { len };
