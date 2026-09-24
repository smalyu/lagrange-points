// Pointer, touch, wheel and keyboard input.
//
// Mouse/pen: press anywhere to bring the probe there, drag to move it; it
// stays where released. Shift-drag or middle-drag pans, wheel/pinch zooms.
// Touch: tap to place; one-finger drag moves the probe relatively (like a
// trackpad) so the finger never hides the arrows; two fingers pan and zoom.

import { panBy, vecToWorld, zoomAt } from "./camera.js";
import { L_NAMES } from "./physics.js";
import { smoothstep } from "./draw.js";

const TAP_MS = 250;
const TAP_SLOP = 8;

export function installInput(app) {
  const canvas = app.canvas;
  const pointers = new Map();
  let mode = null; // "probe" | "pan" | "touch" | "pinch" | "idle"
  let virtual = null; // touch: virtual cursor in screen px
  let pinch = null;

  function local(e) {
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  function userInput(kind) {
    app.emit("userinput", { kind });
  }

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return {
      cx: (a.x + b.x) / 2,
      cy: (a.y + b.y) / 2,
      dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
    };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    app.ui?.closeMenu?.();
    const [x, y] = local(e);
    const now = performance.now();
    pointers.set(e.pointerId, {
      x,
      y,
      type: e.pointerType,
      startX: x,
      startY: y,
      startT: now,
      lastT: now,
      speed: 0,
      moved: 0,
    });
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // Older browsers: capture is a nicety.
    }

    if (pointers.size === 2) {
      mode = "pinch";
      pinch = pinchState();
      document.body.classList.remove("dragging");
      return;
    }
    if (pointers.size > 2) return;

    userInput("pointerdown");
    if (app.state.busy === "release") {
      // Catching a flying probe: the release module decides where it ends up,
      // so this press does not also move it.
      app.emit("catch", { source: "pointer" });
      mode = "idle";
      return;
    }

    if (e.pointerType === "touch") {
      mode = "touch";
      const P = app.toScreen(app.state.probe[0], app.state.probe[1]);
      virtual = [P[0], P[1]];
      return;
    }
    if (e.shiftKey || e.button === 1) {
      mode = "pan";
      document.body.classList.add("panning");
      return;
    }
    mode = "probe";
    document.body.classList.add("dragging");
    app.cursorTo(app.toWorld(x, y), {
      pointerType: e.pointerType,
      speed: 0,
      ease: 120,
      noSnap: e.altKey,
    });
  });

  canvas.addEventListener("pointermove", (e) => {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    const [x, y] = local(e);
    const now = performance.now();
    const dx = x - rec.x;
    const dy = y - rec.y;
    const dt = Math.max(1, now - rec.lastT);
    const inst = (Math.hypot(dx, dy) / dt) * 1000;
    rec.speed = rec.speed * 0.6 + inst * 0.4;
    rec.moved += Math.hypot(dx, dy);
    rec.x = x;
    rec.y = y;
    rec.lastT = now;

    if (mode === "pinch" && pointers.size >= 2) {
      const next = pinchState();
      panBy(app.cam, next.cx - pinch.cx, next.cy - pinch.cy);
      zoomAt(app.cam, next.cx, next.cy, next.dist / pinch.dist);
      pinch = next;
      app.userZoomed = true;
      app.emit("camera");
      app.invalidate();
      return;
    }
    if (mode === "pan") {
      panBy(app.cam, dx, dy);
      app.userZoomed = true;
      app.emit("camera");
      app.invalidate();
      return;
    }
    if (mode === "probe") {
      app.cursorTo(app.toWorld(x, y), {
        pointerType: rec.type,
        speed: rec.speed,
        noSnap: e.altKey,
      });
      schedulePauseSnap(() => app.toWorld(rec.x, rec.y), rec.type, e.altKey);
      return;
    }
    if (mode === "touch") {
      if (rec.moved < TAP_SLOP && now - rec.startT < TAP_MS) return;
      if (!document.body.classList.contains("dragging")) {
        document.body.classList.add("dragging");
        userInput("drag");
      }
      const gain = 0.35 + 0.65 * smoothstep(60, 250, rec.speed);
      virtual = [
        Math.min(app.size.w, Math.max(0, virtual[0] + dx * gain)),
        Math.min(app.size.h, Math.max(0, virtual[1] + dy * gain)),
      ];
      app.cursorTo(app.toWorld(virtual[0], virtual[1]), {
        pointerType: "touch",
        speed: rec.speed * gain,
      });
      const v = [...virtual];
      schedulePauseSnap(() => app.toWorld(v[0], v[1]), "touch", false);
    }
  });

  // A drag that slows down and stops inside the snap radius never produces a
  // slow pointermove: retry the snap at rest, shortly after the last move.
  let pauseTimer = 0;
  function schedulePauseSnap(where, pointerType, noSnap) {
    clearTimeout(pauseTimer);
    if (noSnap) return;
    pauseTimer = setTimeout(() => {
      if (mode !== "probe" && mode !== "touch") return;
      if (app.state.snap) return;
      app.cursorTo(where(), { pointerType, speed: 0 });
    }, 110);
  }

  function endPointer(e) {
    const rec = pointers.get(e.pointerId);
    if (!rec) return;
    pointers.delete(e.pointerId);
    try {
      canvas.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    const now = performance.now();
    clearTimeout(pauseTimer);
    // Releasing inside the snap radius snaps, however fast the last move was.
    if (mode === "probe" && e.type === "pointerup" && !app.state.snap && !e.altKey) {
      app.cursorTo(app.toWorld(rec.x, rec.y), { pointerType: rec.type, speed: 0 });
    } else if (mode === "touch" && e.type === "pointerup" && !app.state.snap && virtual && rec.moved >= TAP_SLOP) {
      app.cursorTo(app.toWorld(virtual[0], virtual[1]), { pointerType: "touch", speed: 0 });
    }
    if (
      mode === "touch" &&
      e.type === "pointerup" &&
      rec.moved < TAP_SLOP &&
      now - rec.startT < TAP_MS
    ) {
      app.cursorTo(app.toWorld(rec.x, rec.y), {
        pointerType: "touch",
        speed: 0,
        ease: 150,
      });
    }
    if (pointers.size === 0) {
      mode = null;
      virtual = null;
      document.body.classList.remove("dragging", "panning");
      app.emit("pointerup");
    } else if (mode === "pinch") {
      mode = "idle";
    }
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("lostpointercapture", endPointer);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const [x, y] = local(e);
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
      const speed = e.ctrlKey ? 0.012 : 0.0022;
      const factor = Math.exp(-e.deltaY * unit * speed);
      zoomAt(app.cam, x, y, factor);
      app.userZoomed = true;
      app.emit("camera");
      app.invalidate();
    },
    { passive: false },
  );

  // Safari trackpad pinch.
  let gestureScale = 1;
  canvas.addEventListener("gesturestart", (e) => {
    e.preventDefault();
    gestureScale = 1;
  });
  canvas.addEventListener("gesturechange", (e) => {
    e.preventDefault();
    const [x, y] = local(e);
    zoomAt(app.cam, x, y, e.scale / gestureScale);
    gestureScale = e.scale;
    app.userZoomed = true;
    app.emit("camera");
    app.invalidate();
  });

  // ---- keyboard ------------------------------------------------------------------
  function isTyping(target) {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && target.type !== "range" && target.type !== "checkbox");
  }

  function nudge(dxPx, dyPx) {
    const s = app.scale();
    const [wx, wy] = vecToWorld(app.cam, dxPx, dyPx, s);
    const p = app.state.probe;
    app.cursorTo([p[0] + wx, p[1] + wy], {
      source: "key",
      speed: 0,
      approachOnly: true,
      forceRelease: true,
      creditNow: true,
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.defaultPrevented) return;
    if (document.querySelector("dialog[open]")) return;
    if (isTyping(e.target)) return;
    if (e.metaKey || e.ctrlKey) return;
    const onRange = e.target instanceof HTMLInputElement && e.target.type === "range";
    const inMenu = e.target instanceof Element && e.target.closest?.("#menu");

    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    // Character shortcuts act on the scene: only while the scene (or nothing
    // in particular) has focus, never from a focused button, chip or slider.
    const sceneFocus =
      e.target === canvas || e.target === document.body || e.target === document.documentElement;
    if (arrows[e.key] && !onRange && !inMenu) {
      e.preventDefault();
      userInput("key");
      const step = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
      nudge(arrows[e.key][0] * step, arrows[e.key][1] * step);
      return;
    }
    if (inMenu) return;
    if (e.key === "Escape") {
      app.emit("escape");
      return;
    }
    if (!sceneFocus) return;

    const story = app.story;
    let handled = true;
    switch (e.code) {
      case "Digit1":
      case "Digit2":
      case "Digit3":
      case "Digit4":
      case "Digit5":
      case "Numpad1":
      case "Numpad2":
      case "Numpad3":
      case "Numpad4":
      case "Numpad5": {
        const i = Number(e.code.slice(-1)) - 1;
        userInput("key");
        story?.jumpTo(L_NAMES[i]);
        break;
      }
      case "BracketLeft":
      case "BracketRight":
        userInput("key");
        story?.stepMass(e.code === "BracketRight" ? 1 : -1, e.shiftKey);
        break;
      case "KeyS":
        userInput("key");
        story?.toggleSweep();
        break;
      case "Space":
        if (onRange || (e.target instanceof HTMLButtonElement)) {
          handled = false;
          break;
        }
        if (!e.repeat) app.emit("key:space");
        break;
      case "KeyF":
        story?.setArrows(app.state.arrows === "chain" ? "fan" : "chain");
        break;
      case "KeyZ":
        userInput("key");
        app.emit("zoomEarth");
        break;
      case "Digit0":
      case "Numpad0":
        app.fitView();
        break;
      case "KeyR":
        if (e.shiftKey) story?.resetProgress();
        else story?.resetProbeAndMass();
        break;
      case "KeyH":
        app.ui?.openHelp();
        break;
      case "Slash":
        if (e.shiftKey) app.ui?.openHelp();
        else handled = false;
        break;
      case "PageDown":
        story?.nextChapter(1);
        break;
      case "PageUp":
        story?.nextChapter(-1);
        break;
      case "Equal":
      case "NumpadAdd":
      case "Minus":
      case "NumpadSubtract": {
        const P = app.toScreen(app.state.probe[0], app.state.probe[1]);
        const zoomIn = e.code === "Equal" || e.code === "NumpadAdd";
        zoomAt(app.cam, P[0], P[1], zoomIn ? 1.5 : 1 / 1.5);
        app.userZoomed = true;
        app.emit("camera");
        app.invalidate();
        break;
      }
      default:
        handled = false;
    }
    if (!handled && e.key === "?") {
      app.ui?.openHelp();
      handled = true;
    }
    if (handled) e.preventDefault();
  });
}
