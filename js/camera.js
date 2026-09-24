// World <-> screen mapping with zoom around a point, animated flights and an
// optional quarter turn (phone portrait shows the Sun-Earth axis vertically).
// World y points up; screen y points down.

const MIN_ZOOM = 0.35;
const MAX_ZOOM = 20000;

export function createCamera() {
  return {
    // Visible canvas area in CSS px (after subtracting UI that covers it).
    view: { left: 0, top: 0, width: 1, height: 1 },
    // Pixels per world unit at zoom 1 (set by fitBox()).
    baseScale: 100,
    zoom: 1,
    // World point shown at the centre of the visible area.
    center: [0, 0],
    // 0: Sun-Earth axis horizontal. 1: rotated 90 deg counter-clockwise.
    rot: 0,
    // Extra rotation of the world about `pivot` (radians, counter-clockwise).
    // Used by the "real motion" view, where the frame stops co-rotating.
    spin: 0,
    pivot: [0, 0],
    flight: null,
  };
}

export function scaleOf(cam) {
  return cam.baseScale * cam.zoom;
}

/** Rotate a world-space vector into "view" orientation (still y-up). */
function rotate(cam, x, y) {
  if (cam.spin) {
    const c = Math.cos(cam.spin);
    const s = Math.sin(cam.spin);
    const nx = c * x - s * y;
    y = s * x + c * y;
    x = nx;
  }
  return cam.rot ? [-y, x] : [x, y];
}

function unrotate(cam, x, y) {
  let [ux, uy] = cam.rot ? [y, -x] : [x, y];
  if (cam.spin) {
    const c = Math.cos(cam.spin);
    const s = Math.sin(cam.spin);
    const nx = c * ux + s * uy;
    uy = -s * ux + c * uy;
    ux = nx;
  }
  return [ux, uy];
}

/** Spin a world point about the pivot (identity when spin is 0). */
function spinPoint(cam, x, y) {
  if (!cam.spin) return [x, y];
  const c = Math.cos(cam.spin);
  const s = Math.sin(cam.spin);
  const dx = x - cam.pivot[0];
  const dy = y - cam.pivot[1];
  return [cam.pivot[0] + c * dx - s * dy, cam.pivot[1] + s * dx + c * dy];
}

function unspinPoint(cam, x, y) {
  if (!cam.spin) return [x, y];
  const c = Math.cos(cam.spin);
  const s = Math.sin(cam.spin);
  const dx = x - cam.pivot[0];
  const dy = y - cam.pivot[1];
  return [cam.pivot[0] + c * dx + s * dy, cam.pivot[1] - s * dx + c * dy];
}

function quarter(cam, x, y) {
  return cam.rot ? [-y, x] : [x, y];
}

function unquarter(cam, x, y) {
  return cam.rot ? [y, -x] : [x, y];
}

export function worldToScreen(cam, x, y) {
  const s = scaleOf(cam);
  const [px, py] = spinPoint(cam, x, y);
  const [rx, ry] = quarter(cam, px - cam.center[0], py - cam.center[1]);
  return [cam.view.left + cam.view.width / 2 + rx * s, cam.view.top + cam.view.height / 2 - ry * s];
}

export function screenToWorld(cam, sx, sy) {
  const s = scaleOf(cam);
  const rx = (sx - cam.view.left - cam.view.width / 2) / s;
  const ry = -(sy - cam.view.top - cam.view.height / 2) / s;
  const [x, y] = unquarter(cam, rx, ry);
  return unspinPoint(cam, cam.center[0] + x, cam.center[1] + y);
}

/** World-space vector -> screen-space vector, multiplied by `k` px per unit. */
export function vecToScreen(cam, vx, vy, k) {
  const [rx, ry] = rotate(cam, vx, vy);
  return [rx * k, -ry * k];
}

/** Screen-space vector (px) -> world-space direction scaled by 1/k. */
export function vecToWorld(cam, sx, sy, k) {
  const [x, y] = unrotate(cam, sx / k, -sy / k);
  return [x, y];
}

/** Choose baseScale/center so the world box fits the visible area. */
export function fitBox(cam, box, padPx = 24) {
  const w = Math.max(1, cam.view.width - 2 * padPx);
  const h = Math.max(1, cam.view.height - 2 * padPx);
  const bw = cam.rot ? box.maxY - box.minY : box.maxX - box.minX;
  const bh = cam.rot ? box.maxX - box.minX : box.maxY - box.minY;
  cam.baseScale = Math.max(20, Math.min(w / bw, h / bh));
  return {
    center: [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2],
    zoom: 1,
  };
}

export function clampZoom(z) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

/** Zoom by `factor`, keeping the world point under (sx, sy) fixed. */
export function zoomAt(cam, sx, sy, factor) {
  const s0 = scaleOf(cam);
  const z1 = clampZoom(cam.zoom * factor);
  const s1 = cam.baseScale * z1;
  // Offset of the cursor from the view centre, in (spun) world units.
  const ox = (sx - cam.view.left - cam.view.width / 2);
  const oy = -(sy - cam.view.top - cam.view.height / 2);
  const [bx, by] = unquarter(cam, ox / s0, oy / s0);
  const [ax, ay] = unquarter(cam, ox / s1, oy / s1);
  cam.zoom = z1;
  cam.center = [cam.center[0] + bx - ax, cam.center[1] + by - ay];
  cam.flight = null;
}

export function panBy(cam, dxPx, dyPx) {
  const s = scaleOf(cam);
  // The centre lives in spun (view) space, so only undo the quarter turn.
  const [x, y] = unquarter(cam, dxPx / s, -dyPx / s);
  cam.center = [cam.center[0] - x, cam.center[1] - y];
  cam.flight = null;
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Animate to a target centre/zoom. Zoom is interpolated in log space and the
 * centre follows the path of a zoom about one fixed point, so deep zooms feel
 * like diving in rather than sliding sideways.
 */
export function flyTo(cam, target, now, duration = 900) {
  const to = { center: [...target.center], zoom: clampZoom(target.zoom) };
  if (duration <= 0) {
    cam.center = to.center;
    cam.zoom = to.zoom;
    cam.flight = null;
    return;
  }
  cam.flight = { from: { center: [...cam.center], zoom: cam.zoom }, to, start: now, duration };
}

/** Advance an active flight. Returns true while the camera is moving. */
export function stepCamera(cam, now) {
  const f = cam.flight;
  if (!f) return false;
  const t = Math.min(1, Math.max(0, (now - f.start) / f.duration));
  const e = easeInOut(t);
  const lz0 = Math.log(f.from.zoom);
  const lz1 = Math.log(f.to.zoom);
  cam.zoom = Math.exp(lz0 + (lz1 - lz0) * e);
  let w = e;
  if (Math.abs(lz1 - lz0) > 0.05) {
    const z0 = f.from.zoom;
    const z1 = f.to.zoom;
    w = (1 / z0 - 1 / cam.zoom) / (1 / z0 - 1 / z1);
    if (!Number.isFinite(w)) w = e;
  }
  cam.center = [
    f.from.center[0] + (f.to.center[0] - f.from.center[0]) * w,
    f.from.center[1] + (f.to.center[1] - f.from.center[1]) * w,
  ];
  if (t >= 1) {
    cam.center = [...f.to.center];
    cam.zoom = f.to.zoom;
    cam.flight = null;
  }
  return true;
}

/** Axis-aligned world rectangle covering the whole canvas. */
export function visibleWorld(cam, canvasWidth, canvasHeight) {
  const corners = [
    screenToWorld(cam, 0, 0),
    screenToWorld(cam, canvasWidth, 0),
    screenToWorld(cam, 0, canvasHeight),
    screenToWorld(cam, canvasWidth, canvasHeight),
  ];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
