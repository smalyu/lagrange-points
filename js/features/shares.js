// Global feature "shares": two quiet layers that explain the triangle.
//
// 1. Compass circles (state.layers.compass): radius a around the Sun and
//    around Earth. L4 and L5 are where they cross. A circle brightens a
//    little while the probe sits on it. Hidden during the hunt in chapter
//    "find" (they would give the answer away) unless the user asked to see
//    everything or has found all five points.
//
// 2. Mass shares (state.layers.shares, chain arrows only). Drawn at the
//    chain's own scale, body i "owes" the probe a share
//        sigma_i = (m_i / M) (S_i - P),      sigma_Sun + sigma_Earth = C - P,
//    and actually delivers the leg
//        lambda_i = g_i / omega^2 = (m_i / M) (a / d_i)^3 (S_i - P).
//    A tick marks where each leg would end if it paid exactly its share:
//    on the Sun sight line at P + sigma_Sun, and along the Earth leg at
//    sigma_Earth from the leg's start. The white "miss" o_i = lambda_i - sigma_i
//    runs from the tick to the leg tip, along that body's own line, and the
//    two misses add up to the leftover: net / omega^2 = o_Sun + o_Earth.
//    At L4/L5 (d_Sun = d_Earth = a) both misses vanish and each leg ends
//    exactly on its tick.

import { COLORS, alpha, font } from "../theme.js";
import { label, rectsOverlap, smoothstep } from "../draw.js";
import { vecToScreen } from "../camera.js";
import { foundCount } from "../state.js";
import { t as coreT } from "../strings.js";
import { fmtNumber, pct } from "../i18n.js";

export const Z_COMPASS = 28; // above the axis, below sight lines and markers
export const Z_SHARES = 85; // above the legs, below the leftover arrow
export const Z_SHARE_TEXT = 125; // after the leg labels (reads f.labelRects)

/** Earth's share of the total mass, m_E / M. */
export function earthShare(q) {
  return q / (1 + q);
}

/**
 * Mass shares as display strings that always add up to 100%:
 * 0.25 -> { sun: "80%", earth: "20%" }, 3.003e-6 -> { sun: "99.9997%", earth: "0.0003%" }.
 */
export function shareStrings(q) {
  const e = earthShare(q) * 100;
  let decimals;
  if (e >= 10) decimals = 0;
  else if (e >= 1) decimals = 1;
  else decimals = Math.min(8, Math.ceil(-Math.log10(e)) + 1);
  let earth = Number(e.toFixed(decimals));
  if (decimals === 0 && Math.abs(e - earth) > 0.05) {
    // Keep one decimal when rounding to a whole number would lie (e.g. 10.9%).
    decimals = 1;
    earth = Number(e.toFixed(1));
  }
  const sun = Number((100 - earth).toFixed(decimals));
  // Localized ("80%" / "80 %", "99.9997%" / "99,9997 %"), trailing zeros dropped.
  const fmt = (x) => pct(fmtNumber(x, { maximumFractionDigits: decimals }));
  return { sun: fmt(sun), earth: fmt(earth) };
}

/** "1.00", "0.998", "0.0100": distance in units of a, for the readout (localized). */
export function formatDistance(d) {
  if (!Number.isFinite(d)) return "–";
  if (d >= 10) return fmtNumber(d, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  if (d >= 0.1) return fmtNumber(d, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return fmtNumber(d, { minimumSignificantDigits: 2, maximumSignificantDigits: 2 });
}

/** The exact "1.00" of the current language (for the "on the circle" highlight). */
const ONE = formatDistance(1);

function compassAllowed(state) {
  if (state.chapter !== "find") return true;
  return state.showAll || foundCount(state) === 5;
}

function sharesAllowed(f) {
  return (
    f.state.layers.shares &&
    f.state.arrows === "chain" &&
    !f.hide.chain &&
    !f.hide.shares &&
    !f.hide.target &&
    f.chainAlpha > 0.05 &&
    f.chain.morph > 0.7 &&
    Number.isFinite(f.chain.k) &&
    f.chain.k > 0
  );
}

/** Nearest point of rect {x, y, w, h} to (px, py). */
function nearestInRect(r, px, py) {
  return [Math.min(r.x + r.w, Math.max(r.x, px)), Math.min(r.y + r.h, Math.max(r.y, py))];
}

/**
 * Stroke a (possibly enormous) circle, drawing only the part that can be
 * seen. Deep zooms make r millions of px; a full dashed arc would be slow.
 */
function strokeVisibleCircle(ctx, cx, cy, r, w, h) {
  const view = { x: -8, y: -8, w: w + 16, h: h + 16 };
  const [nx, ny] = nearestInRect(view, cx, cy);
  const nearest = Math.hypot(nx - cx, ny - cy);
  if (nearest > r) return false; // the whole view is outside the circle
  const corners = [
    [view.x, view.y],
    [view.x + view.w, view.y],
    [view.x, view.y + view.h],
    [view.x + view.w, view.y + view.h],
  ];
  const farthest = Math.max(...corners.map(([x, y]) => Math.hypot(x - cx, y - cy)));
  if (farthest < r) return false; // the whole view is inside the circle
  ctx.beginPath();
  if (r < 4 * (w + h) || nearest < 1) {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else {
    // The centre is far outside the view: only a short arc crosses it.
    const angles = corners.map(([x, y]) => Math.atan2(y - cy, x - cx));
    const ref = Math.atan2(ny - cy, nx - cx);
    let lo = 0;
    let hi = 0;
    for (const a of angles) {
      let d = a - ref;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    const pad = 8 / r;
    const a0 = ref + lo - pad;
    const a1 = ref + hi + pad;
    if (r < 20000) {
      ctx.arc(cx, cy, r, a0, a1);
    } else {
      // Canvas arcs lose precision at huge radii (float32 paths); trace the
      // short visible piece as a polyline computed in double precision.
      const n = 48;
      for (let i = 0; i <= n; i += 1) {
        const a = a0 + ((a1 - a0) * i) / n;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    }
  }
  ctx.stroke();
  return true;
}

/** Does segment a-b pass through rect r (grown by pad)? */
function segmentHitsRect(a, b, r, pad = 0) {
  const x0 = r.x - pad;
  const y0 = r.y - pad;
  const x1 = r.x + r.w + pad;
  const y1 = r.y + r.h + pad;
  // Liang-Barsky clip.
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const p = [-dx, dx, -dy, dy];
  const q = [a[0] - x0, x1 - a[0], a[1] - y0, y1 - a[1]];
  for (let i = 0; i < 4; i += 1) {
    if (p[i] === 0) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

export function install(app) {
  const phone = () => app.size.phone;
  // Scratch context for measuring text outside the layer's own ctx state.
  const ctx2d = document.createElement("canvas").getContext("2d");

  // Geometry shared by the two share layers, computed once per frame.
  let cache = { frame: null, geo: null };
  // Where the distance readout sat last frame (direction from the probe).
  let lastReadout = null;
  app.on("chapter", () => {
    lastReadout = null;
  });
  app.on("resize", () => {
    lastReadout = null;
  });
  // A scripted move (snap, jump, "Show me", midline park) settles on the
  // best spot for where it ends; only drags and sweeps keep the old spot.
  app.on("probe", ({ source, easing } = {}) => {
    if (!easing && source !== "pointer" && source !== "key") lastReadout = null;
  });
  function geometry(f) {
    if (cache.frame === f) return cache.geo;
    cache = { frame: f, geo: computeGeometry(f) };
    return cache.geo;
  }

  function computeGeometry(f) {
    const chain = f.chain;
    const sunLeg = chain.legs.find((l) => l.key === "sun");
    const earthLeg = chain.legs.find((l) => l.key === "earth");
    if (!sunLeg || !earthLeg) return null;
    const sys = f.sys;
    const M = sys.mSun + sys.mEarth;
    const [x, y] = f.state.probe;
    // px per world unit for shares: k * omega^2 (= rho * s).
    const kw = chain.k * sys.omega2;
    const make = (key, leg, mass, body) => {
      const share = [(mass / M) * (body[0] - x), (mass / M) * (body[1] - y)];
      const v = vecToScreen(f.cam, share[0], share[1], kw);
      const tick = [leg.start[0] + v[0], leg.start[1] + v[1]];
      const shareLen = Math.hypot(v[0], v[1]);
      const tip = leg.end;
      const miss = [tip[0] - tick[0], tip[1] - tick[1]];
      const missLen = Math.hypot(miss[0], miss[1]);
      // Unit vector along the body's line (share direction), for the tick.
      const ux = shareLen > 1e-9 ? v[0] / shareLen : leg.length > 1e-9 ? leg.vec[0] / leg.length : 1;
      const uy = shareLen > 1e-9 ? v[1] / shareLen : leg.length > 1e-9 ? leg.vec[1] / leg.length : 0;
      return {
        key,
        leg,
        tick,
        tip,
        shareLen,
        missLen,
        overshoot: leg.length > shareLen,
        u: [ux, uy],
        hidden: Boolean(f.hideLegs?.[key]),
        finite: Number.isFinite(tick[0]) && Number.isFinite(tick[1]) && Number.isFinite(missLen),
      };
    };
    const sun = make("sun", sunLeg, sys.mSun, sys.sun);
    const earth = make("earth", earthLeg, sys.mEarth, sys.earth);
    return { sun, earth, kw };
  }

  // ---- 1. compass circles ------------------------------------------------------------------
  app.addLayer({
    id: "compass",
    z: Z_COMPASS,
    visible: (f) => Boolean(f.state.layers.compass) && !f.hide.compass && compassAllowed(f.state),
    draw(ctx, f) {
      const s = app.scale();
      if (!(s > 2)) return;
      const [px, py] = f.state.probe;
      const bodies = [
        { at: f.sys.sun, color: COLORS.sun },
        { at: f.sys.earth, color: COLORS.earth },
      ];
      ctx.setLineDash([2, 6]);
      ctx.lineCap = "butt";
      for (const b of bodies) {
        const [cx, cy] = app.toScreen(b.at[0], b.at[1]);
        // On the circle: |d - a| within a few px (a = 1 in model units).
        const offPx = Math.abs(Math.hypot(px - b.at[0], py - b.at[1]) - 1) * s;
        const on = f.hide.probe ? 0 : smoothstep(6, 1.5, offPx);
        ctx.strokeStyle = alpha(b.color, 0.35 + 0.2 * on);
        ctx.lineWidth = 1.2 + 0.3 * on;
        strokeVisibleCircle(ctx, cx, cy, s, f.w, f.h);
      }
      ctx.setLineDash([]);
    },
  });

  // ---- 2a. share ticks and misses -----------------------------------------------------------
  app.addLayer({
    id: "shares",
    z: Z_SHARES,
    visible: sharesAllowed,
    draw(ctx, f) {
      const geo = geometry(f);
      if (!geo) return;
      const fade = f.chainAlpha * smoothstep(0.7, 1, f.chain.morph);
      if (fade <= 0.01) return;
      const dim = f.dimLegs ?? null;
      const half = phone() ? 8 : 7;
      ctx.lineCap = "round";

      for (const item of [geo.sun, geo.earth]) {
        if (item.hidden || !item.finite) continue;
        const a = fade * (dim && dim !== item.key && dim !== "net" ? 0.25 : 1);
        ctx.globalAlpha = a;

        // Miss: tick -> leg tip, along the body's own line. When the leg
        // overshoots, stop at the arrowhead so the head stays readable.
        if (item.missLen >= 1) {
          let [ex, ey] = item.tip;
          const [tx, ty] = item.tick;
          if (item.overshoot && item.leg.length >= 6) {
            const head = Math.min(12, 0.4 * item.leg.length) * 0.75;
            const back = Math.min(head, item.missLen);
            ex -= item.u[0] * back;
            ey -= item.u[1] * back;
          }
          if (Math.hypot(ex - tx, ey - ty) >= 1) {
            // Past the tip (falling short) the miss continues the arrow's
            // line on its own, with a dark halo. On top of the arrow
            // (overshoot) it is a thinner white core, so the arrow keeps its
            // colour along both edges.
            if (!item.overshoot) {
              ctx.strokeStyle = COLORS.bg;
              ctx.lineWidth = 4.5;
              ctx.beginPath();
              ctx.moveTo(tx, ty);
              ctx.lineTo(ex, ey);
              ctx.stroke();
            }
            ctx.strokeStyle = COLORS.leftover;
            ctx.lineWidth = item.overshoot ? 1.5 : 2;
            ctx.beginPath();
            ctx.moveTo(tx, ty);
            ctx.lineTo(ex, ey);
            ctx.stroke();
          }
        }

        // Tick: a short bar across the body's line, where the leg would end
        // if it pulled exactly its mass share. On the target ring (balance,
        // where the Earth tick lands on the CM) only its ends show, so it
        // frames the ring instead of striking through it.
        if (item.shareLen < 4) continue;
        const [tx, ty] = item.tick;
        const T = f.chain.target;
        const onTarget = Math.hypot(tx - T[0], ty - T[1]) < 3;
        const inner = onTarget ? 10 : 0;
        const outer = onTarget ? 15 : half;
        const nx = -item.u[1];
        const ny = item.u[0];
        const bars = inner > 0 ? [[inner, outer], [-outer, -inner]] : [[-outer, outer]];
        for (const [width, color] of [[4.5, COLORS.bg], [2, COLORS.text2]]) {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          for (const [r0, r1] of bars) {
            ctx.moveTo(tx + nx * r0, ty + ny * r0);
            ctx.lineTo(tx + nx * r1, ty + ny * r1);
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      if (fade > 0.5) {
        for (const item of [geo.sun, geo.earth]) {
          if (!item.hidden && item.finite) reserve(f, item, half);
        }
      }
    },
  });

  /**
   * Tell the core leg-label layer (z 120, reads f.obstacles) where a miss
   * and its tick are, so no "Earth pull" lands on top of the white miss.
   * Tagged, so our own text layer does not avoid itself twice.
   */
  function reserve(f, item, half) {
    const out = (f.obstacles = f.obstacles ?? []);
    const [tx, ty] = item.tick;
    if (item.shareLen >= 4) {
      out.push({ x: tx - half - 1, y: ty - half - 1, w: 2 * half + 2, h: 2 * half + 2, shares: true });
    }
    if (!(item.missLen >= 1)) return;
    const [ex, ey] = item.tip;
    const n = Math.min(80, Math.ceil(item.missLen / 6));
    for (let i = 0; i <= n; i += 1) {
      const x = tx + ((ex - tx) * i) / n;
      const y = ty + ((ey - ty) * i) / n;
      out.push({ x: x - 3, y: y - 3, w: 6, h: 6, shares: true });
    }
  }

  // ---- 2b. share percentages at the ticks + distance readout -------------------------------------
  app.addLayer({
    id: "shares-text",
    z: Z_SHARE_TEXT,
    visible: (f) => sharesAllowed(f) && f.chainAlpha > 0.5,
    draw(ctx, f) {
      const geo = geometry(f);
      if (!geo) return;
      const chain = f.chain;
      const ringR = phone() ? 17 : 15;
      const [px, py] = chain.P;
      // The core label layer reserves a square around the ring; the ring
      // itself is round, so keep clear of the circle instead.
      // (f.labelRects also holds every f.obstacles rect, our own included.)
      const placed = (f.labelRects ?? []).filter(
        (r) => !r.shares && !(px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h),
      );
      // Our own estimate of what to avoid, plus the exact rects the core
      // layers registered this frame (body and L-point labels).
      const blockers = [...obstacles(f), ...(f.obstacles ?? []).filter((r) => !r.shares)];
      const clearOfRing = (rect) => {
        const [nx, ny] = nearestInRect(rect, px, py);
        return Math.hypot(nx - px, ny - py) >= ringR + 6;
      };

      const segs = [];
      for (const leg of chain.legs) {
        if (!f.hideLegs?.[leg.key]) segs.push([leg.start, leg.end]);
      }
      if (!f.snapped && chain.net.length > 1) segs.push([chain.net.start, chain.net.end]);
      for (const item of [geo.sun, geo.earth]) {
        if (!item.hidden && item.finite && item.missLen >= 1) segs.push([item.tick, item.tip]);
      }

      // Stay inside the visible canvas area (not under the header or dock).
      const v = f.cam.view;
      const free = (rect) =>
        rect.x >= v.left + 4 &&
        rect.y >= v.top + 2 &&
        rect.x + rect.w <= v.left + v.width - 4 &&
        rect.y + rect.h <= v.top + v.height - 2 &&
        clearOfRing(rect) &&
        !placed.some((r) => rectsOverlap(r, rect)) &&
        !blockers.some((r) => rectsOverlap(r, rect)) &&
        !segs.some(([a, b]) => segmentHitsRect(a, b, rect, 2));

      // Percent next to each tick, on the outside of the loop only: on the
      // inside it would read as a label for a different arrow.
      const text = shareStrings(f.sys.q);
      const size = 11;
      ctx.font = font(size, 600);
      for (const item of [geo.sun, geo.earth]) {
        if (item.hidden || !item.finite || item.shareLen < 22) continue;
        const str = item.key === "sun" ? text.sun : text.earth;
        const w = ctx.measureText(str).width + 4;
        const h = size * 1.2 + 4;
        let nx = -item.u[1];
        let ny = item.u[0];
        const [tx, ty] = item.tick;
        if (nx * (tx - chain.centroid[0]) + ny * (ty - chain.centroid[1]) < 0) {
          nx = -nx;
          ny = -ny;
        }
        const half = phone() ? 8 : 7;
        for (const back of [0, 0.3]) {
          const reach = half + 5 + Math.abs(nx) * (w / 2) + Math.abs(ny) * (h / 2);
          // "back" slides the label toward the leg's start, off a busy tip.
          const slide = back * Math.min(40, item.shareLen);
          const cx = tx + nx * reach - item.u[0] * slide;
          const cy = ty + ny * reach - item.u[1] * slide;
          const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
          if (!free(rect)) continue;
          placed.push(rect);
          label(ctx, str, cx, cy, COLORS.text2, { size, weight: 600, alpha: f.chainAlpha });
          break;
        }
      }

      // Distance readout: "Sun 1.00a · Earth 0.98a", quiet, near the probe.
      if (f.hide.probe) return;
      const dS = f.acc.dSun;
      const dE = f.acc.dEarth;
      const s = app.scale();
      // A number turns bright only when it reads 1.00 and the probe is on
      // that circle to the pixel (so "0.99" never lights up on a phone).
      const onCircle = (d) => formatDistance(d) === ONE && Math.abs(d - 1) * s < 1.5;
      const parts = [
        { t: `${coreT("body.sun")} `, c: alpha(COLORS.sun, 0.8) },
        { t: formatDistance(dS), c: onCircle(dS) ? COLORS.text : COLORS.text2 },
        { t: "a", c: COLORS.text2, italic: true },
        { t: "  ·  ", c: COLORS.text3 },
        { t: `${coreT("body.earth")} `, c: alpha(COLORS.earth, 0.85) },
        { t: formatDistance(dE), c: onCircle(dE) ? COLORS.text : COLORS.text2 },
        { t: "a", c: COLORS.text2, italic: true },
      ];
      const fontOf = (p) => (p.italic ? `italic ${font(size, 500)}` : font(size, 500));
      let total = 0;
      for (const p of parts) {
        ctx.font = fontOf(p);
        p.w = ctx.measureText(p.t).width;
        total += p.w;
      }
      const w = total + 6;
      const h = size * 1.2 + 4;
      // Prefer the side away from the chain, then go round the probe. Once
      // placed, search outward from where it was, so it moves the least.
      const ax = px - chain.centroid[0];
      const ay = py - chain.centroid[1];
      const base = lastReadout
        ? Math.atan2(lastReadout.uy, lastReadout.ux)
        : Math.hypot(ax, ay) > 2
          ? Math.atan2(ay, ax)
          : -Math.PI / 2;
      const order = [0];
      for (let i = 1; i <= 8; i += 1) order.push(i, -i);
      // First distance along a ray where the text clears the ring.
      const rayStart = (ux, uy) => {
        for (let t = ringR; t < ringR + w; t += 2) {
          const r = { x: px + ux * t - w / 2, y: py + uy * t - h / 2, w, h };
          if (clearOfRing(r)) return t;
        }
        return null;
      };
      // Near a screen edge the text shifts sideways to stay in view.
      const tryAt = (ux, uy, t0, extra) => {
        let cx = px + ux * (t0 + extra);
        let cy = py + uy * (t0 + extra);
        cx = Math.min(v.left + v.width - 6 - w / 2, Math.max(v.left + 6 + w / 2, cx));
        cy = Math.min(v.top + v.height - 4 - h / 2, Math.max(v.top + 4 + h / 2, cy));
        const rect = { x: cx - w / 2, y: cy - h / 2, w, h };
        return clearOfRing(rect) && free(rect) ? { cx, cy, rect, ux, uy, extra } : null;
      };
      // Stay where the readout was while that spot is still free: re-picking
      // every frame made it flip across the probe during a drag or a sweep.
      let spot = null;
      if (lastReadout) {
        const t0 = rayStart(lastReadout.ux, lastReadout.uy);
        if (t0 !== null) spot = tryAt(lastReadout.ux, lastReadout.uy, t0, lastReadout.extra);
      }
      if (!spot) {
        // Fresh placement: the closest free spot wins, direction preference
        // breaks ties. Moving on from a blocked spot: each 22.5 degree turn
        // costs as much as 8 px farther out, so it slides rather than jumps.
        const turn = lastReadout ? 8 : 0.01;
        const out = lastReadout ? 1 : 100;
        const cands = [];
        for (const step of order) {
          const ang = base + (step * Math.PI) / 8;
          const ux = Math.cos(ang);
          const uy = Math.sin(ang);
          const t0 = rayStart(ux, uy);
          if (t0 === null) continue;
          for (let extra = 0; extra <= 36; extra += 6) {
            cands.push({ ux, uy, t0, extra, cost: Math.abs(step) * turn + extra * out });
          }
        }
        cands.sort((a, b) => a.cost - b.cost);
        for (const c of cands) {
          spot = tryAt(c.ux, c.uy, c.t0, c.extra);
          if (spot) break;
        }
      }
      lastReadout = spot && { ux: spot.ux, uy: spot.uy, extra: spot.extra };
      if (!spot) return;
      placed.push(spot.rect);
      let x = spot.cx - total / 2;
      ctx.save();
      ctx.globalAlpha = f.chainAlpha;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      for (const p of parts) {
        ctx.font = fontOf(p);
        ctx.strokeStyle = COLORS.bg;
        ctx.lineWidth = 4;
        ctx.strokeText(p.t, x, spot.cy);
        ctx.fillStyle = p.c;
        ctx.fillText(p.t, x, spot.cy);
        x += p.w;
      }
      ctx.restore();
    },
  });

  /** Rects of things the text must not cover: bodies, CM, target, their labels, markers, badges. */
  function obstacles(f) {
    const out = [];
    const box = (x, y, r) => ({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });
    const [px, py] = f.chain.P;
    const S = app.toScreen(f.sys.sun[0], f.sys.sun[1]);
    const E = app.toScreen(f.sys.earth[0], f.sys.earth[1]);
    const C = app.toScreen(f.sys.cm[0], f.sys.cm[1]);
    const sunR = phone() ? 10 : 11;
    const earthR = Math.max(4, sunR * Math.cbrt(f.sys.q));
    out.push(box(S[0], S[1], sunR + 3), box(E[0], E[1], earthR + 3), box(C[0], C[1], 8));
    out.push(box(f.chain.target[0], f.chain.target[1], 10));
    // Body labels (scene.js puts them on the side of the axis away from the probe).
    if (!f.hide.bodyLabels) {
      let nx = -(E[1] - S[1]);
      let ny = E[0] - S[0];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      if ((px - S[0]) * nx + (py - S[1]) * ny > 0) {
        nx = -nx;
        ny = -ny;
      }
      const textBox = (pt, off, text, size) => {
        ctx2d.font = font(size, 600);
        const w = ctx2d.measureText(text).width + 6;
        const cx = pt[0] + nx * off;
        const cy = pt[1] + ny * off;
        return { x: cx - w / 2, y: cy - size * 0.6 - 3, w, h: size * 1.2 + 6 };
      };
      out.push(textBox(S, sunR + 12, coreT("body.sun"), 13), textBox(E, earthR + 12, coreT("body.earth"), 13));
      if (Math.hypot(C[0] - S[0], C[1] - S[1]) >= sunR + 6) out.push(textBox(C, 16, coreT("body.cm"), 11));
    }
    // The equilateral reveal (features/equilateral.js) at L4/L5: side
    // labels "a" outside the triangle and "60°" at Earth.
    if ((f.snapped === "L4" || f.snapped === "L5") && f.cam.zoom < 3 && !f.hide.equilateral) {
      const Lw = f.sys.lPoints[f.snapped];
      const L = app.toScreen(Lw[0], Lw[1]);
      const G = [(S[0] + E[0] + L[0]) / 3, (S[1] + E[1] + L[1]) / 3];
      for (const [a, b] of [[S, E], [S, L], [E, L]]) {
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        const nx = -(b[1] - a[1]) / l;
        const ny = (b[0] - a[0]) / l;
        const side = (mx - G[0]) * nx + (my - G[1]) * ny > 0 ? 1 : -1;
        out.push(box(mx + nx * side * 16, my + ny * side * 16, 9));
      }
    }
    // L-point labels ("L4") next to their diamonds.
    ctx2d.font = font(13, 650);
    for (const [name, p] of Object.entries(f.sys.lPoints)) {
      const [x, y] = app.toScreen(p[0], p[1]);
      if (x < -40 || y < -40 || x > f.w + 40 || y > f.h + 40) continue;
      out.push(box(x, y, 7));
      const off = f.snapped === name ? 22 : 13;
      const onAxis = name === "L1" || name === "L2" || name === "L3";
      const lx = x + (f.cam.rot && onAxis ? off + 4 : off * 0.9);
      const ly = y - (f.cam.rot && onAxis ? 0 : off);
      const w = ctx2d.measureText(name).width + 4;
      out.push({ x: lx - 2, y: ly - 10, w, h: 20 });
    }
    // Badges under the probe ("arrows ×0.66", "lanes offset for clarity").
    let by = py + (phone() ? 34 : 32);
    if (f.chain.rho < 0.97) {
      out.push({ x: px + 10, y: by - 11, w: 96, h: 22 });
      by += 24;
    }
    if (f.chain.laneWeight > 0.5) out.push({ x: px + 10, y: by - 9, w: 140, h: 18 });
    return out;
  }
}
