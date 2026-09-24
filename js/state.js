// App state, saved progress (localStorage) and shareable URL hash.

import { L_NAMES } from "./physics.js";
import { t } from "./strings.js";

export const CHAPTERS = [
  { id: "find", title: t("chapter.find"), hash: "" },
  { id: "triangle", title: t("chapter.triangle"), hash: "triangle" },
  { id: "line", title: t("chapter.line"), hash: "line" },
  { id: "real", title: t("chapter.real"), hash: "real" },
  { id: "letgo", title: t("chapter.letgo"), hash: "letgo" },
  { id: "explore", title: t("chapter.explore"), hash: "explore" },
];

export const DEFAULT_Q = 0.25;
export const START_PROBE = [0.5, 0.5];

export function createState() {
  return {
    q: DEFAULT_Q,
    probe: [...START_PROBE],
    snap: null, // { name, since, found } while held on an L-point
    chapter: "find",
    arrows: "chain", // "chain" | "fan"
    layers: {
      labels: true,
      sight: true,
      compass: false,
      shares: false,
      profile: false,
      magnifier: true,
    },
    found: Object.fromEntries(L_NAMES.map((n) => [n, false])),
    shown: Object.fromEntries(L_NAMES.map((n) => [n, false])),
    showAll: false,
    midline: false,
    predicted: null, // "moves" | "stays"
    sweepSeen: false,
    demoDone: false,
    busy: null, // name of a running scripted animation (demo, sweep, release)
  };
}

const STORAGE_KEY = "lagrange-points.v2";

export function loadProgress(state) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    for (const n of L_NAMES) {
      state.found[n] = Boolean(data.found?.[n]);
    }
    state.showAll = Boolean(data.showAll);
    state.sweepSeen = Boolean(data.sweepSeen);
    state.demoDone = Boolean(data.demoDone);
    state.predicted = data.predicted ?? null;
    return true;
  } catch {
    return false;
  }
}

export function saveProgress(state) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        found: state.found,
        showAll: state.showAll,
        sweepSeen: state.sweepSeen,
        demoDone: state.demoDone,
        predicted: state.predicted,
      }),
    );
  } catch {
    // Private mode or blocked storage: progress simply is not remembered.
  }
}

export function clearProgress() {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function foundCount(state) {
  return L_NAMES.filter((n) => state.found[n]).length;
}

/** Is the L-point marker visible right now? */
export function markerVisible(state, name) {
  return state.showAll || state.chapter !== "find" || state.found[name] || state.shown[name];
}

// --- URL hash ----------------------------------------------------------------
// #triangle              chapter deep link
// #explore&q=1.23&p=0.5,0.866   chapter + mass (% of Sun) + probe position

export function parseHash(hash) {
  const out = {};
  const text = (hash || "").replace(/^#/, "");
  if (!text) return out;
  for (const part of text.split("&")) {
    const [key, value] = part.split("=");
    if (value === undefined) {
      const chapter = CHAPTERS.find((c) => c.hash && c.hash === key);
      if (chapter) out.chapter = chapter.id;
      continue;
    }
    if (key === "q") {
      const pct = Number(value);
      if (Number.isFinite(pct) && pct > 0 && pct <= 100) out.q = pct / 100;
    } else if (key === "p") {
      const [x, y] = value.split(",").map(Number);
      if (Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 10 && Math.abs(y) < 10) {
        out.probe = [x, y];
      }
    }
  }
  return out;
}

export function buildHash(state) {
  const chapter = CHAPTERS.find((c) => c.id === state.chapter);
  const parts = [];
  parts.push(chapter?.hash || "explore");
  parts.push(`q=${Number((state.q * 100).toPrecision(4))}`);
  parts.push(`p=${state.probe[0].toFixed(4)},${state.probe[1].toFixed(4)}`);
  return "#" + parts.join("&");
}
