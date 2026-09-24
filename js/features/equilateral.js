// When the probe sits on L4 or L5, draw the equilateral triangle it forms with
// the Sun and Earth: equal-side ticks, the side length a, and 60 degree arcs.

import { COLORS, alpha, FONT_STACK } from "../theme.js";
import { label, rectsOverlap } from "../draw.js";
import { arrowSegments, segHitsRect } from "../scene.js";

const CHAPTERS_WITH_REVEAL = new Set(["find", "triangle", "explore"]);

export function installEquilateral(app) {
  let since = -1;
  let name = null;

  app.on("snap", (e) => {
    if (e.name === "L4" || e.name === "L5") {
      name = e.name;
      since = -1;
      app.animate((now) => {
        if (since < 0) since = now;
        return now - since < 450;
      });
    }
  });
  app.on("unsnap", () => {
    name = null;
  });

  app.addLayer({
    id: "equilateral",
    z: 35,
    visible: (f) =>
      Boolean(name) &&
      f.snapped === name &&
      CHAPTERS_WITH_REVEAL.has(f.state.chapter) &&
      // In the hunt, keep the answer to "does L4 move?" until it is asked and seen.
      !(f.state.chapter === "find" && !f.state.sweepSeen) &&
      f.cam.zoom < 3 &&
      !f.hide.equilateral,
    draw(ctx, f) {
      const t = since < 0 ? 0 : Math.min(1, (f.now - since) / 400);
      const e = f.app.reducedMotion ? 1 : 1 - (1 - t) ** 3;
      const S = app.toScreen(0, 0);
      const E = app.toScreen(1, 0);
      const Lw = f.sys.lPoints[name];
      const L = app.toScreen(Lw[0], Lw[1]);
      const G = [(S[0] + E[0] + L[0]) / 3, (S[1] + E[1] + L[1]) / 3];
      const sides = [
        [S, E],
        [S, L],
        [E, L],
      ];
      ctx.save();
      ctx.strokeStyle = alpha(COLORS.text2, 0.55);
      ctx.lineWidth = 1;
      for (const [a, b] of sides) {
        const bx = a[0] + (b[0] - a[0]) * e;
        const by = a[1] + (b[1] - a[1]) * e;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
      if (e < 0.98) {
        ctx.restore();
        return;
      }
      // Labels stay off the arrows and other labels; skip one rather than overlap.
      const segs = arrowSegments(f);
      f.obstacles = f.obstacles ?? [];
      const free = (r) =>
        !segs.some(([p, q]) => segHitsRect(p, q, r, 2)) && !f.obstacles.some((o) => rectsOverlap(o, r));
      // Equal-side ticks and the length label a.
      ctx.strokeStyle = COLORS.text2;
      ctx.lineWidth = 1.5;
      for (const [a, b] of sides) {
        const mx = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l = Math.hypot(dx, dy) || 1;
        const nx = -dy / l;
        const ny = dx / l;
        ctx.beginPath();
        ctx.moveTo(mx - nx * 6, my - ny * 6);
        ctx.lineTo(mx + nx * 6, my + ny * 6);
        ctx.stroke();
        // Put "a" on the outside of the triangle.
        const out = (mx - G[0]) * nx + (my - G[1]) * ny > 0 ? 1 : -1;
        ctx.save();
        ctx.font = `italic 600 13px ${FONT_STACK}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const tx = mx + nx * out * 16;
        const ty = my + ny * out * 16;
        const box = { x: tx - 7, y: ty - 9, w: 14, h: 18 };
        if (!free(box)) {
          ctx.restore();
          continue;
        }
        f.obstacles.push(box);
        ctx.strokeStyle = COLORS.bg;
        ctx.lineWidth = 4;
        ctx.strokeText("a", tx, ty);
        ctx.fillStyle = COLORS.text2;
        ctx.fillText("a", tx, ty);
        ctx.restore();
      }
      // 60 degree arcs at each corner.
      const corners = [
        [S, E, L],
        [E, L, S],
        [L, S, E],
      ];
      ctx.strokeStyle = alpha(COLORS.text2, 0.8);
      ctx.lineWidth = 1;
      for (const [c, p, q] of corners) {
        const a1 = Math.atan2(p[1] - c[1], p[0] - c[0]);
        const a2 = Math.atan2(q[1] - c[1], q[0] - c[0]);
        let d = a2 - a1;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        ctx.beginPath();
        ctx.arc(c[0], c[1], 22, a1, a1 + d, d < 0);
        ctx.stroke();
      }
      const mid = (c, p, q) => {
        const a1 = Math.atan2(p[1] - c[1], p[0] - c[0]);
        const a2 = Math.atan2(q[1] - c[1], q[0] - c[0]);
        let d = a2 - a1;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        const m = a1 + d / 2;
        return [c[0] + Math.cos(m) * 36, c[1] + Math.sin(m) * 36];
      };
      const [lx, ly] = mid(E, L, S);
      const box60 = { x: lx - 14, y: ly - 9, w: 28, h: 18 };
      if (free(box60)) {
        label(ctx, "60°", lx, ly, COLORS.text2, { size: 11, weight: 600 });
        f.obstacles.push(box60);
      }
      ctx.restore();
    },
  });
}
