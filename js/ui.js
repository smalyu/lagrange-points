// DOM overlay: tracker, status, legend, coach captions/chips, mass rail,
// menu, numbers card, help and the screen-reader announcer.

import { CHAPTERS, buildHash, foundCount, markerVisible } from "./state.js";
import { L_NAMES, SI, hillRadius, len, nearestLPoint } from "./physics.js";
import {
  PRESETS,
  REAL_EARTH_Q,
  ROUTH_Q,
  exaggerationTag,
  formatPercent,
  presetAt,
  qFromT,
  tFromQ,
} from "./mass.js";
import { formatLeftover } from "./scene.js";
import { t } from "./strings.js";
import { LANGS, applyDom, fmtFixed, fmtNumber, getLang, switchLang } from "./i18n.js";

const $ = (id) => document.getElementById(id);

const LEG_NOTES = {
  sun: t("note.sun"),
  earth: t("note.earth"),
  cf: t("note.cf"),
  net: t("note.net"),
};

const LAYER_OPTIONS = [
  { key: "labels", label: t("layer.labels") },
  { key: "sight", label: t("layer.sight") },
  { key: "magnifier", label: t("layer.magnifier") },
  { key: "compass", label: t("layer.compass"), hunt: "locked" },
  { key: "shares", label: t("layer.shares") },
  { key: "profile", label: t("layer.profile") },
  { key: "fan", label: t("layer.fan") },
];

export function installUi(app) {
  const els = {
    tracker: $("tracker"),
    slots: [...document.querySelectorAll("#tracker .slot")],
    showAll: $("show-all"),
    helpBtn: $("help-btn"),
    help: $("help"),
    status: $("status"),
    legend: $("legend"),
    legendNote: $("legend-note"),
    dock: $("dock"),
    chapters: $("chapters"),
    caption: $("caption"),
    chips: $("chips"),
    coach: document.querySelector(".coach"),
    mass: $("mass"),
    ticks: $("ticks"),
    massPct: $("mass-pct"),
    massTag: $("mass-tag"),
    sweep: $("sweep-btn"),
    menuBtn: $("menu-btn"),
    menuBtnTop: $("menu-btn-top"),
    menu: $("menu"),
    menuLayers: $("menu-layers"),
    fit: $("fit-btn"),
    numbers: $("numbers"),
    numbersList: $("numbers-list"),
    numbersFoot: $("numbers-foot"),
    numbersClose: $("numbers-close"),
    toast: $("toast"),
    live: $("live"),
    masthead: document.querySelector(".masthead"),
    hud: $("hud"),
  };

  const ui = { els };
  app.ui = ui;

  // ---- language -----------------------------------------------------------------------
  applyDom(t);
  document.title = t("page.title");
  const otherLang = () => LANGS.find((l) => l !== getLang());
  $("lang-btn")?.addEventListener("click", () => switchLang(otherLang()));

  // ---- visible canvas area (what the dock and header do not cover) ---------------
  // Layout modes (body classes, set before measuring):
  //   is-phone + is-portrait  bottom sheet, scene rotated
  //   is-phone + is-landscape dock as a right-hand column, scene on the left
  //   is-compact              small desktop windows / 200% zoom: phone-style HUD
  app.measureView = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const phone = app.size.phone;
    const landscape = (phone && !app.size.portrait) || (!phone && h <= 480 && w > h * 1.3);
    const compact = !phone && (w <= 900 || h <= 560);
    document.body.classList.toggle("is-landscape", landscape);
    document.body.classList.toggle("is-compact", compact);
    const dockRect = els.dock.getBoundingClientRect();
    const trackerBottom = els.hud.querySelector(".tracker-row").getBoundingClientRect().bottom;
    if (landscape) {
      const top = Math.max(trackerBottom, 36) + 24;
      const right = Math.max(160, dockRect.left - 8);
      return { left: 0, top, width: right, height: Math.max(120, h - top - 8) };
    }
    let top;
    if (phone || compact) {
      top = Math.max(trackerBottom, 40) + 26;
    } else {
      top = Math.max(64, els.masthead.getBoundingClientRect().bottom + 8);
    }
    const bottom = Math.max(top + 120, dockRect.top - (phone ? 6 : 10));
    return { left: 0, top, width: w, height: bottom - top };
  };

  // ---- chapters ---------------------------------------------------------------------
  for (const ch of CHAPTERS) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.chapter = ch.id;
    b.title = ch.title;
    b.setAttribute("aria-label", t("dock.chapter", { title: ch.title }));
    b.addEventListener("click", () => app.story?.goto(ch.id));
    els.chapters.append(b);
  }

  ui.setChapter = (id) => {
    for (const b of els.chapters.children) {
      if (b.dataset.chapter === id) b.setAttribute("aria-current", "step");
      else b.removeAttribute("aria-current");
    }
    // On touch screens (no hover titles) name the chapter next to the dots.
    const i = CHAPTERS.findIndex((c) => c.id === id);
    const nameEl = document.getElementById("chapter-name");
    if (nameEl && i >= 0) nameEl.textContent = `${i + 1}/${CHAPTERS.length} · ${CHAPTERS[i].title}`;
    syncLayersMenu();
  };

  ui.markChapterDone = (id) => {
    els.chapters.querySelector(`[data-chapter="${id}"]`)?.classList.add("is-done");
  };

  // ---- caption and action chips --------------------------------------------------------
  ui.say = (html, chips = [], { announce = true } = {}) => {
    els.caption.innerHTML = html;
    els.coach.classList.remove("enter");
    void els.coach.offsetWidth;
    els.coach.classList.add("enter");
    ui.setChips(chips);
    if (announce) ui.announce(els.caption.textContent, { force: true });
  };

  ui.setChips = (chips) => {
    // Keep keyboard users in place: if focus was on a chip (now removed),
    // move it to the new primary chip, or back to the scene.
    const hadFocus = els.chips.contains(document.activeElement);
    els.chips.replaceChildren();
    for (const chip of chips) {
      if (!chip) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "action" + (chip.primary ? " primary" : "");
      b.textContent = chip.label;
      if (chip.title) b.title = chip.title;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        chip.onClick?.();
      });
      els.chips.append(b);
    }
    if (hadFocus) {
      const next = els.chips.querySelector(".action.primary") ?? els.chips.querySelector(".action");
      (next ?? app.canvas).focus({ preventScroll: true });
    }
  };

  // ---- tracker -----------------------------------------------------------------------------
  function syncTracker() {
    const state = app.state;
    for (const slot of els.slots) {
      const name = slot.dataset.l;
      const found = state.found[name];
      const shown = !found && (state.shown[name] || state.showAll);
      slot.classList.toggle("is-found", found);
      slot.classList.toggle("is-shown", shown);
      slot.classList.toggle("is-active", state.snap?.name === name);
      slot.setAttribute("aria-label", t(found ? "slot.found" : shown ? "slot.shown" : "slot.hidden", { name }));
      slot.setAttribute("aria-disabled", String(!(found || shown || state.chapter !== "find")));
    }
    els.showAll.hidden = foundCount(state) === 5 || state.showAll;
  }
  ui.syncTracker = syncTracker;

  for (const slot of els.slots) {
    slot.addEventListener("click", () => {
      const name = slot.dataset.l;
      if (!markerVisible(app.state, name)) {
        ui.toast(t("toast.notFound"));
        return;
      }
      app.story?.jumpTo(name);
    });
  }

  ui.popSlot = (name) => {
    const slot = els.slots.find((s) => s.dataset.l === name);
    if (!slot || app.reducedMotion) return;
    slot.classList.remove("pop");
    void slot.offsetWidth;
    slot.classList.add("pop");
  };

  ui.pulseTracker = () => {
    if (app.reducedMotion) return;
    els.tracker.classList.remove("pulse");
    void els.tracker.offsetWidth;
    els.tracker.classList.add("pulse");
  };

  els.showAll.addEventListener("click", () => app.story?.showAll());

  // ---- status line --------------------------------------------------------------------------
  let lastStatus = "";
  function syncStatus(frame) {
    let html;
    let balanced = false;
    const release = app.state.busy === "release";
    if (release && app.releaseStatus) {
      html = app.releaseStatus();
    } else if (frame.snapped && frame.b < 1e-6) {
      balanced = true;
      html = `${t("status.balanced")} <span class="status-sub">· ${frame.snapped}</span>`;
    } else {
      html = t("status.leftover", { pct: formatLeftover(frame.b) });
      // A close-up view may measure against its own arrows (tide view).
      if (frame.statusNote) html += ` <span class="status-sub">· ${frame.statusNote}</span>`;
    }
    if (html !== lastStatus) {
      els.status.innerHTML = html;
      els.status.classList.toggle("is-balanced", balanced);
      lastStatus = html;
    }
  }

  // ---- legend ---------------------------------------------------------------------------------
  let noteTimer = 0;
  for (const chip of els.legend.querySelectorAll(".chip[data-leg]")) {
    const key = chip.dataset.leg;
    const enter = () => {
      app.dimLeg = key;
      app.invalidate();
    };
    const leave = () => {
      app.dimLeg = null;
      app.invalidate();
    };
    chip.addEventListener("pointerenter", enter);
    chip.addEventListener("pointerleave", leave);
    chip.addEventListener("focus", enter);
    chip.addEventListener("blur", leave);
    chip.addEventListener("click", () => {
      const open = chip.getAttribute("aria-pressed") === "true";
      for (const c of els.legend.querySelectorAll(".chip[data-leg]")) c.setAttribute("aria-pressed", "false");
      if (open) {
        els.legendNote.hidden = true;
        return;
      }
      chip.setAttribute("aria-pressed", "true");
      els.legendNote.textContent = LEG_NOTES[key];
      els.legendNote.hidden = false;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function hide() {
        if (els.legendNote.matches(":hover") || els.legend.matches(":focus-within")) {
          noteTimer = setTimeout(hide, 3000);
          return;
        }
        els.legendNote.hidden = true;
        chip.setAttribute("aria-pressed", "false");
      }, 15000);
    });
  }
  app.frameHooks.push((frame) => {
    if (app.dimLeg) frame.dimLegs = app.dimLeg;
  });

  // ---- mass rail --------------------------------------------------------------------------------
  const SLIDER_MAX = Number(els.mass.max);
  function syncMass() {
    const q = app.state.q;
    const v = Math.round(tFromQ(q) * SLIDER_MAX);
    if (Number(els.mass.value) !== v && document.activeElement !== els.mass) {
      els.mass.value = String(v);
    } else if (document.activeElement === els.mass && Math.abs(qFromT(Number(els.mass.value) / SLIDER_MAX) - q) / q > 0.02) {
      els.mass.value = String(v);
    }
    els.massPct.textContent = formatPercent(q);
    els.massTag.textContent = exaggerationTag(q);
    const preset = presetAt(q);
    els.mass.setAttribute(
      "aria-valuetext",
      preset && preset.id !== "default"
        ? t("mass.valuePreset", { pct: formatPercent(q), system: preset.system })
        : t("mass.valueTag", { pct: formatPercent(q), tag: exaggerationTag(q) }),
    );
    for (const tick of els.ticks.children) {
      tick.classList.toggle("is-current", preset?.id === tick.dataset.preset);
    }
  }
  ui.syncMass = syncMass;

  els.mass.addEventListener("input", () => {
    app.emit("userinput", { kind: "mass" });
    app.story?.stopSweep?.();
    app.setMass(qFromT(Number(els.mass.value) / SLIDER_MAX), { source: "slider" });
  });

  function buildTicks() {
    els.ticks.replaceChildren();
    const entries = PRESETS.map((p) => ({ ...p, routh: false }));
    entries.push({ id: "routh", label: "4%", short: "", q: ROUTH_Q, routh: true, system: "" });
    for (const p of entries) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tick" + (p.routh ? " routh" : "");
      b.dataset.preset = p.id;
      b.style.left = `${(tFromQ(p.q) * 100).toFixed(3)}%`;
      const span = document.createElement("span");
      span.className = "tick-label";
      span.textContent = app.size.phone ? p.short : p.label;
      if (p.routh) span.textContent = "";
      b.append(span);
      b.title = p.routh
        ? t("tick.routhTitle")
        : p.id === "equal"
          ? t("tick.equalTitle", { pct: formatPercent(p.q) })
          : p.id === "default"
            ? t("tick.defaultTitle", { pct: formatPercent(p.q) })
            : t("tick.presetTitle", { system: p.system, pct: formatPercent(p.q) });
      b.setAttribute(
        "aria-label",
        p.routh ? t("tick.routhAria") : t("tick.presetAria", { label: p.label, system: p.system }),
      );
      b.addEventListener("click", () => {
        app.emit("userinput", { kind: "mass" });
        app.story?.stopSweep?.();
        app.story?.animateMass(p.q, 500);
      });
      els.ticks.append(b);
    }
    layoutTicks();
  }

  // Hide tick labels that would collide, keeping the more important ones.
  const TICK_PRIORITY = ["earth", "jupiter", "default", "equal", "moon", "charon", "routh"];
  function layoutTicks() {
    const width = els.ticks.getBoundingClientRect().width;
    if (!width) return;
    const kept = [];
    const ticks = [...els.ticks.children].sort(
      (a, b) => TICK_PRIORITY.indexOf(a.dataset.preset) - TICK_PRIORITY.indexOf(b.dataset.preset),
    );
    for (const tick of ticks) {
      const labelEl = tick.querySelector(".tick-label");
      const x = (parseFloat(tick.style.left) / 100) * width;
      const w = Math.max(10, labelEl.textContent.length * 6.4 + 6);
      const clash = kept.some((k) => Math.abs(k.x - x) < (k.w + w) / 2 + 2);
      labelEl.hidden = clash || !labelEl.textContent;
      if (!labelEl.hidden) kept.push({ x, w });
    }
  }
  ui.layoutTicks = layoutTicks;

  els.sweep.addEventListener("click", () => {
    app.emit("userinput", { kind: "sweep" });
    app.story?.toggleSweep();
  });

  ui.setSweeping = (on) => {
    els.sweep.classList.toggle("is-playing", on);
    els.sweep.setAttribute("aria-label", on ? t("dock.stopSweep") : t("dock.sweep"));
  };

  // ---- menu --------------------------------------------------------------------------------------
  function menuOpen() {
    return !els.menu.hidden;
  }
  function setMenu(open, opener) {
    els.menu.hidden = !open;
    els.menuBtn.setAttribute("aria-expanded", String(open));
    els.menuBtnTop.setAttribute("aria-expanded", String(open));
    if (open) {
      syncLayersMenu();
      els.menu.querySelector("input, button")?.focus({ preventScroll: true });
    } else if (opener) {
      opener.focus({ preventScroll: true });
    }
  }
  ui.closeMenu = () => setMenu(false);
  for (const btn of [els.menuBtn, els.menuBtnTop]) {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setMenu(!menuOpen(), btn);
    });
  }
  document.addEventListener("pointerdown", (e) => {
    if (!menuOpen()) return;
    if (els.menu.contains(e.target) || e.target === els.menuBtn || e.target === els.menuBtnTop) return;
    setMenu(false);
  });
  const menuOpener = () => (app.size.phone ? els.menuBtnTop : els.menuBtn);
  els.menu.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      setMenu(false, menuOpener());
    }
  });
  // Tabbing out of the open menu closes it.
  els.menu.addEventListener("focusout", (e) => {
    const next = e.relatedTarget;
    if (!next || els.menu.contains(next) || next === els.menuBtn || next === els.menuBtnTop) return;
    setMenu(false);
  });

  function syncLayersMenu() {
    els.menuLayers.replaceChildren();
    const state = app.state;
    for (const opt of LAYER_OPTIONS) {
      const id = `layer-${opt.key}`;
      const lab = document.createElement("label");
      lab.htmlFor = id;
      const input = document.createElement("input");
      input.type = "checkbox";
      input.id = id;
      const locked = opt.hunt === "locked" && state.chapter === "find" && !state.showAll && foundCount(state) < 5;
      input.checked = opt.key === "fan" ? state.arrows === "fan" : Boolean(state.layers[opt.key]);
      input.disabled = locked;
      lab.classList.toggle("is-locked", locked);
      lab.title = locked ? t("layer.locked") : "";
      input.addEventListener("change", () => {
        if (opt.key === "fan") app.story?.setArrows(input.checked ? "fan" : "chain");
        else app.story?.setLayer(opt.key, input.checked);
      });
      lab.append(input, document.createTextNode(opt.label));
      els.menuLayers.append(lab);
    }
  }
  ui.syncLayersMenu = syncLayersMenu;

  els.menu.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === "real-motion") return; // handled by press-and-hold
    // Return focus to the menu button, unless the action opens something
    // that takes focus itself.
    setMenu(false, action === "help" || action === "numbers" || action === "lang" ? null : menuOpener());
    if (action === "numbers") {
      ui.toggleNumbers(true);
      els.numbersClose.focus({ preventScroll: true });
    }
    else if (action === "show-all") app.story?.showAll();
    else if (action === "share") ui.share();
    else if (action === "reset") app.story?.resetProbeAndMass();
    else if (action === "reset-progress") app.story?.resetProgress();
    else if (action === "help") ui.openHelp();
    else if (action === "lang") switchLang(otherLang());
  });

  // Press-and-hold "real motion" from the menu.
  const realBtn = els.menu.querySelector('[data-action="real-motion"]');
  const startReal = (e) => {
    e.preventDefault();
    app.emit("realmotion", { on: true });
  };
  const stopReal = () => app.emit("realmotion", { on: false });
  realBtn.addEventListener("pointerdown", startReal);
  realBtn.addEventListener("pointerup", stopReal);
  realBtn.addEventListener("pointerleave", stopReal);
  realBtn.addEventListener("pointercancel", stopReal);
  realBtn.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) startReal(e);
  });
  realBtn.addEventListener("keyup", (e) => {
    if (e.key === " " || e.key === "Enter") stopReal();
  });

  // ---- note card (longer explanations, "show the math") ----------------------------------
  const card = $("card");
  const cardBody = $("card-body");
  ui.card = (html) => {
    if (!html) {
      card.hidden = true;
      return;
    }
    cardBody.innerHTML = html;
    card.hidden = false;
    ui.announce(cardBody.textContent, { force: true });
    const dockH = els.dock.getBoundingClientRect().height;
    card.style.setProperty("--dock-h", `${dockH}px`);
  };
  $("card-close").addEventListener("click", () => ui.card(null));
  app.on("chapterexit", () => ui.card(null));

  // ---- hold for real motion (legend chip) ---------------------------------------------------
  const holdBtn = $("real-motion-btn");
  const holdStart = (e) => {
    e.preventDefault();
    holdBtn.classList.add("is-held");
    app.emit("realmotion", { on: true });
  };
  const holdEnd = () => {
    if (!holdBtn.classList.contains("is-held")) return;
    holdBtn.classList.remove("is-held");
    app.emit("realmotion", { on: false });
  };
  holdBtn.addEventListener("pointerdown", holdStart);
  holdBtn.addEventListener("pointerup", holdEnd);
  holdBtn.addEventListener("pointerleave", holdEnd);
  holdBtn.addEventListener("pointercancel", holdEnd);
  holdBtn.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) holdStart(e);
  });
  holdBtn.addEventListener("keyup", (e) => {
    if (e.key === " " || e.key === "Enter") holdEnd();
  });
  holdBtn.addEventListener("blur", holdEnd);

  // ---- fit button -----------------------------------------------------------------------------------
  function syncFit() {
    els.fit.hidden = !app.userZoomed;
  }
  app.on("camera", syncFit);
  els.fit.addEventListener("click", () => app.fitView());

  // ---- help -----------------------------------------------------------------------------------------
  ui.openHelp = () => {
    if (els.help.open) return;
    helpOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try {
      els.help.showModal();
    } catch {
      els.help.setAttribute("open", "");
    }
  };
  els.helpBtn.addEventListener("click", () => ui.openHelp());
  let helpOpener = null;
  els.help.addEventListener("close", () => (helpOpener ?? app.canvas).focus({ preventScroll: true }));
  els.help.addEventListener("click", (e) => {
    if (e.target === els.help) els.help.close();
  });

  // ---- toast -----------------------------------------------------------------------------------------
  let toastTimer = 0;
  ui.toast = (text, ms = 2200) => {
    els.toast.textContent = text;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, ms);
  };

  // ---- share -----------------------------------------------------------------------------------------
  ui.share = async () => {
    const url = `${location.origin}${location.pathname}${buildHash(app.state)}`;
    try {
      history.replaceState(null, "", buildHash(app.state));
    } catch {
      // ignore (file:// or sandboxed)
    }
    try {
      if (navigator.share && app.size.coarse) {
        await navigator.share({ title: t("page.title"), url });
        return;
      }
      await navigator.clipboard.writeText(url);
      ui.toast(t("toast.copied"));
    } catch {
      ui.toast(url, 5000);
    }
  };

  // ---- numbers card ----------------------------------------------------------------------------------
  ui.toggleNumbers = (open) => {
    els.numbers.hidden = !open;
    if (open) syncNumbers(app.frame);
  };
  els.numbersClose.addEventListener("click", () => ui.toggleNumbers(false));

  function row(k, v) {
    return `<dt>${k}</dt><dd>${v}</dd>`;
  }

  function fmt(x, digits = 3) {
    if (!Number.isFinite(x)) return "–";
    if (x === 0) return "0";
    const ax = Math.abs(x);
    if (ax >= 1e4 || ax < 1e-3) {
      const e = Math.floor(Math.log10(ax));
      const m = x / 10 ** e;
      return `${fmtFixed(m, 2)}×10<sup>${e}</sup>`;
    }
    return fmtNumber(Number(x.toPrecision(digits)), { maximumFractionDigits: 6 });
  }

  function km(x) {
    const v = (x * SI.au) / 1000;
    if (v >= 1e6) return t("unit.mkm", { n: fmtFixed(v / 1e6, 2) });
    return t("unit.km", { n: fmtNumber(Math.round(v)) });
  }

  function syncNumbers(frame) {
    if (!frame || els.numbers.hidden) return;
    const { acc, sys, b } = frame;
    const p = app.state.probe;
    const total = len(acc.sun) + len(acc.earth) + len(acc.cf);
    const pct = (v) => formatLeftover(len(v) / total, { plain: true });
    const near = nearestLPoint(sys, p[0], p[1]);
    const real = Math.abs(Math.log(sys.q / REAL_EARTH_Q)) < 0.01;
    const dist = (x) => (real ? km(x) : `${fmt(x)} a`);
    let html = "";
    html += row(t("numbers.dSun"), dist(acc.dSun));
    html += row(t("numbers.dEarth"), dist(acc.dEarth));
    html += row(t("numbers.dCm"), dist(acc.dCm));
    html += row(`<span class="c-sun">${t("leg.sun")}</span>`, pct(acc.sun));
    html += row(`<span class="c-earth">${t("leg.earth")}</span>`, pct(acc.earth));
    html += row(`<span class="c-spin">${t("leg.cf")}</span>`, pct(acc.cf));
    html += row(t("numbers.leftover"), formatLeftover(b));
    if (frame.ringB != null && frame.statusNoteLabel) {
      html += row(`<span class="muted">${frame.statusNoteLabel}</span>`, formatLeftover(frame.ringB));
    }
    html += row(t("numbers.nearest"), `${near.name}, ${dist(near.distance)}`);
    html += row(t("numbers.hill"), dist(hillRadius(sys)));
    els.numbersList.innerHTML = html;
    els.numbersFoot.textContent = real ? t("numbers.footReal") : t("numbers.foot");
  }

  // ---- screen reader announcer ------------------------------------------------------------------------
  let lastAnnounce = 0;
  let pendingAnnounce = null;
  // Throttled, but the latest message always gets through: a burst of arrow
  // keys ends with the value where the probe actually stopped.
  let announceTimer = 0;
  ui.announce = (text, { force = false } = {}) => {
    const now = performance.now();
    if (!force && now - lastAnnounce < 1500) {
      pendingAnnounce = text;
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => {
        if (pendingAnnounce) ui.announce(pendingAnnounce, { force: true });
      }, 1500 - (now - lastAnnounce) + 50);
      return;
    }
    clearTimeout(announceTimer);
    lastAnnounce = now;
    pendingAnnounce = null;
    els.live.textContent = text;
  };

  /** "12 percent" / "12 процентов", rounded like the status line. */
  function spokenPercent(b) {
    const value = b * 100;
    if (value < 0.01) return t("sr.tiny");
    const digits = value >= 10 ? 0 : value >= 1 ? 1 : 2;
    const rounded = Number(value.toFixed(digits));
    return t("sr.percent", { n: fmtNumber(rounded, { maximumFractionDigits: digits }), value: rounded });
  }

  function describeLeftover(frame) {
    const { acc, b } = frame;
    if (frame.snapped) return t("sr.balanced", { name: frame.snapped });
    const net = acc.net;
    const p = app.state.probe;
    const toSun = [-p[0], -p[1]];
    const cos = (net[0] * toSun[0] + net[1] * toSun[1]) / (len(net) * len(toSun) || 1);
    let dir = "";
    if (cos > 0.8) dir = t("sr.toSun");
    else if (cos < -0.8) dir = t("sr.fromSun");
    return t("sr.leftover", { pct: spokenPercent(b), dir });
  }

  let probeMovedByUser = false;
  app.on("probe", (e) => {
    if (e.source === "pointer" || e.source === "key") probeMovedByUser = true;
  });

  // ---- per-frame sync -------------------------------------------------------------------------------------
  app.on("frame", (frame) => {
    syncStatus(frame);
    syncNumbers(frame);
    if (probeMovedByUser) {
      probeMovedByUser = false;
      ui.announce(describeLeftover(frame));
    } else if (pendingAnnounce && performance.now() - lastAnnounce > 1500) {
      ui.announce(pendingAnnounce);
    }
  });

  app.on("mass", syncMass);
  app.on("found", syncTracker);
  app.on("snap", syncTracker);
  app.on("unsnap", syncTracker);
  app.on("resize", () => {
    for (const tick of els.ticks.children) {
      const p = PRESETS.find((x) => x.id === tick.dataset.preset);
      const labelEl = tick.querySelector(".tick-label");
      if (p) labelEl.textContent = app.size.phone ? p.short : p.label;
    }
    layoutTicks();
    syncFit();
  });

  buildTicks();
  syncMass();
  syncTracker();
  return ui;
}

export { L_NAMES };
