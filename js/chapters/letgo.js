// Chapter 5 "Let go": balanced is not the same as stable.
//
// a. Snap to L4 and ask: let go with a tiny push, will it stay?
// b. At 25% it flies off. Try Jupiter's mass, below the 4% line.
// c. There it loops around L4: the Coriolis push turns the fall into a loop.
//    L1, by contrast, is left in a fraction of an orbit.
//
// The simulation and the live arrows live in features/release.js; this file
// only chooses what to release and what to say about it.

import { WORLD_BOX } from "../app.js";
import { ROUTH_MU } from "../physics.js";
import { PRESETS, ROUTH_Q, presetAt, qFromT, tFromQ } from "../mass.js";
import { DEFAULT_Q } from "../state.js";
import { easeInOutCubic } from "../draw.js";
import { describeOutcome, formatOrbits } from "../features/release.js";
import { defineStrings } from "../i18n.js";

export const LETGO_STRINGS = {
  en: {
    routh: "L4 holds below",
    catchTap: "Tap to catch it.",
    catchKey: "Click or press Space to catch it.",
    jupiterIntro: "Jupiter is about 0.1% of the Sun: well below the 4% line.",
    explore: "Explore →",
    againAt: "Let go at {point} again",
    tryJupiter: "Try Jupiter's mass",
    tryJupiterTitle: "Jupiter is 0.1% of the Sun, below the 4% line on the mass rail",
    whatL1: "What about L1?",
    fromPoint: " from {point}",
    runSlow: "A tiny push outward{from}. One slow swing here takes {orbits}, so time runs fast.",
    runJupiter: "Same tiny push, at Jupiter's mass. Watch the teal Coriolis arrow.",
    runTrojan: "A tiny push outward from {point}. Watch the white leftover as it drifts.",
    runCollinear: "Now {point}, with the same tiny push.",
    runFree: "Let go from here, with a tiny push.",
    catch: "Catch",
    unstableGuess: "Most people guess “stays”. Off&nbsp;{point}, the leftover points away from it.",
    unstableTail: "Off&nbsp;{point}, the leftover points away from it, so any drift grows.",
    again: "Again",
    trojans: "Jupiter's Trojan asteroids live here.",
    below4: "Below the 4% line, L4 and L5 hold.",
    staysLoop: "It stays: the sideways Coriolis push turns each fall into a loop.",
    staysBend: "It stays: the sideways Coriolis push keeps bending its path back around {point}.",
    l3Tail: "Like L1 and L2, the smallest push grows.",
    craftTail: "At Earth's L1 and L2, SOHO and JWST fire small thrusters to stay.",
    slowTail: "At this mass its drift is just very slow.",
    notStable: "{point} is balanced but not stable. {tail}",
    letGoL4: "Let go at L4",
    driftBackAt: "It was already drifting off. It's back at {point} now.",
    driftBackStart: "It was already drifting off. It's back at its start now.",
    drifting: "It was already drifting off.",
    outOfSightAt: "It was out of sight, so it's back at {point}.",
    outOfSightStart: "It was out of sight, so it's back at its start.",
    arrowsHere: "The arrows are back: the pulls where the probe is now.",
    arrowsCaught: "The arrows are back: the pulls where you caught it.",
    spaceFromHere: "Press Space to let go from here.",
    intro: "Balanced isn't the same as stable. Let go at L4 with a tiny push: will it stay?",
    spaceHint: "Space lets go and catches.",
    stays: "It stays",
    drifts: "It drifts off",
  },
  ru: {
    routh: "L4 устойчива ниже",
    catchTap: "Коснитесь, чтобы поймать.",
    catchKey: "Щёлкните или нажмите пробел, чтобы поймать.",
    jupiterIntro: "Юпитер — около 0,1 % массы Солнца: намного ниже отметки 4 %.",
    explore: "Свободный режим →",
    againAt: "Снова отпустить в {point}",
    tryJupiter: "Взять массу Юпитера",
    tryJupiterTitle: "Юпитер — 0,1 % массы Солнца, ниже отметки 4 % на шкале масс",
    whatL1: "А что с L1?",
    fromPoint: " от {point}",
    runSlow: "Лёгкий толчок наружу{from}. Один медленный размах здесь длится {orbits}, поэтому время ускорено.",
    runJupiter: "Тот же лёгкий толчок, но при массе Юпитера. Следите за бирюзовой стрелкой Кориолиса.",
    runTrojan: "Лёгкий толчок наружу от {point}. Следите за белым остатком, пока зонд дрейфует.",
    runCollinear: "Теперь {point}, с тем же лёгким толчком.",
    runFree: "Отпускаем отсюда, с лёгким толчком.",
    catch: "Поймать",
    unstableGuess: "Большинство думает, что останется. Вне&nbsp;{point} остаток направлен прочь от точки.",
    unstableTail: "Вне&nbsp;{point} остаток направлен прочь от точки, поэтому любой дрейф нарастает.",
    again: "Ещё раз",
    trojans: "Здесь живут троянские астероиды Юпитера.",
    below4: "Ниже отметки 4 % точки L4 и L5 устойчивы.",
    staysLoop: "Остаётся: боковой толчок Кориолиса превращает каждое падение в петлю.",
    staysBend: "Остаётся: боковой толчок Кориолиса снова и снова заворачивает путь вокруг {point}.",
    l3Tail: "Как и у L1 и L2, малейший толчок нарастает.",
    craftTail: "В точках L1 и L2 системы Солнце–Земля аппараты SOHO и JWST держатся с помощью двигателей коррекции.",
    slowTail: "При этой массе дрейф просто очень медленный.",
    notStable: "{point} — равновесие, но неустойчивое. {tail}",
    letGoL4: "Отпустить в L4",
    driftBackAt: "Он уже начал уплывать. Теперь он снова в {point}.",
    driftBackStart: "Он уже начал уплывать. Теперь он снова на старте.",
    drifting: "Он уже начал уплывать.",
    outOfSightAt: "Он улетел из виду, поэтому вернулся в {point}.",
    outOfSightStart: "Он улетел из виду, поэтому вернулся на старт.",
    arrowsHere: "Стрелки вернулись: силы там, где сейчас зонд.",
    arrowsCaught: "Стрелки вернулись: силы там, где вы его поймали.",
    spaceFromHere: "Нажмите пробел, чтобы отпустить отсюда.",
    intro: "Равновесие — ещё не устойчивость. Отпустим зонд в L4 с лёгким толчком: останется ли он?",
    spaceHint: "Пробел отпускает и ловит.",
    stays: "Останется",
    drifts: "Уплывёт",
  },
};
const tr = defineStrings(LETGO_STRINGS);

const JUPITER_Q = PRESETS.find((p) => p.id === "jupiter").q;
const TROJAN = new Set(["L4", "L5"]);
const COLLINEAR = new Set(["L1", "L2", "L3"]);
const ROUTH_LABEL = tr("routh");

const muted = (text) => `<span class="muted">${text}</span>`;

export function createLetGoChapter(app) {
  const story = app.story;

  return {
    id: "letgo",
    layers: {},
    enter(scope, opts = {}) {
      const state = app.state;
      const release = app.release;
      const catchHint = app.size.coarse ? tr("catchTap") : tr("catchKey");

      let guess = null; // "stays" | "drifts" | null (skipped with Space)
      let via = null; // "jupiter" while the Jupiter chip's run is starting
      let run = null; // { kind, point, via, lesson } for the current/last run
      let stage = "intro";
      let flowId = 0; // bumps on every chip action; stale async steps bail out
      let zoomedByUs = false; // flew in to L1
      let viewMoved = false; // phone portrait: slid the view toward L4

      // ---- mass rail: the 4% tick becomes "L4 holds below" -------------------------------
      const tickLabel = document.querySelector("#ticks .tick.routh .tick-label");
      const hiddenByUs = new Set();
      function relabelTick() {
        if (!tickLabel || !scope.alive) return;
        tickLabel.textContent = ROUTH_LABEL;
        tickLabel.hidden = false;
        const r = tickLabel.getBoundingClientRect();
        if (!r.width) return;
        for (const other of document.querySelectorAll("#ticks .tick:not(.routh) .tick-label")) {
          if (other.hidden) continue;
          const o = other.getBoundingClientRect();
          if (o.right + 6 > r.left && o.left - 6 < r.right) {
            other.hidden = true;
            hiddenByUs.add(other);
          }
        }
      }
      relabelTick();
      requestAnimationFrame(relabelTick); // after the dock settles
      scope.on("resize", relabelTick);
      scope.add(() => {
        if (tickLabel) tickLabel.textContent = "";
        for (const el of hiddenByUs) el.hidden = false;
        app.ui.layoutTicks?.();
      });

      // ---- helpers ------------------------------------------------------------------------
      const stableMass = () => app.sys().mu < ROUTH_MU;

      /**
       * Like story.animateMass, but it stops touching the mass as soon as this
       * chapter is left or another chip takes over (app.tween itself keeps
       * running, and would otherwise drag the next chapter's mass along).
       */
      function animateMass(q, ms, id) {
        const t0 = tFromQ(state.q);
        const t1 = tFromQ(q);
        return app.tween(
          ms,
          (k) => {
            if (scope.alive && id === flowId) app.setMass(qFromT(t0 + (t1 - t0) * k), { source: "animate" });
          },
          { ease: easeInOutCubic },
        );
      }

      function kindOf(point) {
        if (TROJAN.has(point)) return stableMass() ? "trojanStable" : "trojanUnstable";
        if (COLLINEAR.has(point)) return "collinear";
        return "free";
      }

      function onScreen(p, margin = 40) {
        const [x, y] = app.toScreen(p[0], p[1]);
        const v = app.cam.view;
        return (
          x > v.left + margin &&
          x < v.left + v.width - margin &&
          y > v.top + margin &&
          y < v.top + v.height - margin
        );
      }

      // The chapter's home view. In phone portrait L4 sits on the left edge,
      // so slide the view until its loops fit; elsewhere the normal fit.
      function homeView() {
        if (app.cam.rot) {
          const center = [(WORLD_BOX.minX + WORLD_BOX.maxX) / 2, 0.42];
          app.flyTo(center, 1, 700);
          // The chapter's own framing, not the user's zoom: no "Fit view" button.
          app.userZoomed = false;
          app.emit("camera");
          viewMoved = true;
        } else {
          app.fitView();
        }
      }

      /** Put the probe on a Lagrange point (and make sure it is in view). */
      async function placeOn(name) {
        const p = app.sys().lPoints[name];
        if (!onScreen(p) || (zoomedByUs && TROJAN.has(name))) {
          zoomedByUs = false;
          homeView();
          await scope.wait(app.reducedMotion ? 0 : 720);
          if (!scope.alive) return;
        }
        const at =
          state.snap?.name === name && Math.hypot(state.probe[0] - p[0], state.probe[1] - p[1]) < 1e-12;
        if (at) return;
        app.snapTo(name, { ease: 350, source: "letgo" });
        if (state.snap) state.snap.credited = true;
        await scope.wait(app.reducedMotion ? 30 : 400);
      }

      // Near a light planet L1 sits a few pixels from it: fly in first.
      async function focusPlanet() {
        const sys = app.sys();
        const hill = Math.cbrt(sys.mu / 3);
        const v = app.cam.view;
        const zoom = Math.min(v.width, v.height) / (5.5 * hill * app.cam.baseScale);
        if (zoom < 1.6) return;
        app.flyTo([sys.earth[0], sys.earth[1]], Math.min(60, zoom), 900);
        zoomedByUs = true;
        await scope.wait(app.reducedMotion ? 0 : 950);
      }
      scope.add(() => {
        if (zoomedByUs || viewMoved) app.fitView({ animate: false });
      });
      // Turning a phone re-frames the scene: keep L4 off the edge in portrait,
      // and drop the slide in landscape. (Other resizes keep the view.)
      let lastRot = app.cam.rot;
      scope.on("resize", () => {
        if (app.cam.rot === lastRot) {
          // Same orientation (e.g. a phone's toolbar): the resize re-fitted the
          // view, so slide it back to keep L4 off the edge.
          if (app.cam.rot && viewMoved && !zoomedByUs && !release.running()) {
            app.flyTo([(WORLD_BOX.minX + WORLD_BOX.maxX) / 2, 0.42], 1, 0);
            app.userZoomed = false;
            app.emit("camera");
          }
          return;
        }
        lastRot = app.cam.rot;
        if (zoomedByUs || release.running()) return;
        if (app.cam.rot) homeView();
        else if (viewMoved) {
          viewMoved = false;
          app.fitView({ animate: false });
        }
      });

      // The user taking over (slider, keys, a pasted link, reset) cancels any
      // scripted step still in flight, so it cannot start a release afterwards.
      scope.on("mass", ({ source }) => {
        if (source === "slider" || source === "key" || source === "link" || source === "reset") flowId += 1;
      });
      scope.on("catch", ({ source } = {}) => {
        if (source === "reset") flowId += 1;
      });

      async function letGo(name, { maxOrbits, from, id = ++flowId } = {}) {
        const stale = () => !scope.alive || id !== flowId;
        release.stop("chip");
        if (COLLINEAR.has(name)) {
          await focusPlanet();
          if (stale()) return;
        }
        await placeOn(name);
        if (stale() || release.running()) return;
        via = from ?? null;
        release.start({ maxOrbits });
        via = null;
      }

      async function tryJupiter() {
        const id = ++flowId;
        release.stop("chip");
        stage = "jupiter";
        story.say(tr("jupiterIntro"), []);
        if (Math.abs(Math.log(state.q / JUPITER_Q)) > 1e-3) {
          await animateMass(JUPITER_Q, 900, id);
          if (!scope.alive || id !== flowId) return;
          app.setMass(JUPITER_Q, { source: "animate" }); // land exactly on the preset
          await scope.wait(app.reducedMotion ? 600 : 350);
          if (!scope.alive || id !== flowId) return;
        }
        await letGo("L4", { from: "jupiter", id });
      }

      const goExplore = { label: tr("explore"), primary: true, onClick: () => story.goto("explore") };
      const againChip = (point) => ({
        label: tr("againAt", { point }),
        onClick: () => letGo(point, COLLINEAR.has(point) ? { maxOrbits: 5 } : {}),
      });
      const jupiterChip = {
        label: tr("tryJupiter"),
        title: tr("tryJupiterTitle"),
        primary: true,
        onClick: tryJupiter,
      };
      const l1Chip = { label: tr("whatL1"), onClick: () => letGo("L1", { maxOrbits: 5 }) };

      // ---- captions ---------------------------------------------------------------------------
      function sayRunning(r) {
        let text;
        if (!r.arrows && Number.isFinite(r.libOrbits)) {
          // Too fast for live arrows: say why time runs fast instead.
          text = tr("runSlow", {
            from: r.point ? tr("fromPoint", { point: r.point }) : "",
            orbits: formatOrbits(Math.round(r.libOrbits)),
          });
        } else if (r.via === "jupiter") {
          text = tr("runJupiter");
        } else if (r.kind === "trojanUnstable" || r.kind === "trojanStable") {
          text = tr("runTrojan", { point: r.point });
        } else if (r.kind === "collinear") {
          text = tr("runCollinear", { point: r.point });
        } else {
          text = tr("runFree");
        }
        story.say(`${text} ${muted(catchHint)}`, [{ label: tr("catch"), onClick: () => release.stop("chip") }]);
      }

      function sayUnstable(r, info) {
        const head = describeOutcome(info.outcome, info.orbits, r.point);
        const tail =
          guess === "stays" && r.point === "L4" && !r.guessUsed
            ? tr("unstableGuess", { point: r.point })
            : tr("unstableTail", { point: r.point });
        r.guessUsed = true;
        story.say(`${head} ${muted(tail)}`, [jupiterChip, { label: tr("again"), onClick: () => letGo(r.point) }]);
      }

      function sayStable(r) {
        r.lesson = true;
        const jupiter = presetAt(state.q)?.id === "jupiter";
        const tail = jupiter ? tr("trojans") : tr("below4");
        const head = r.arrows ? tr("staysLoop") : tr("staysBend", { point: r.point });
        story.say(`${head} ${muted(tail)}`, [
          l1Chip,
          goExplore,
        ]);
        app.ui.markChapterDone("letgo");
        stage = "stable";
      }

      function sayCollinear(r, info) {
        r.lesson = true;
        let tail = r.point === "L3" ? tr("l3Tail") : tr("craftTail");
        // Near a light planet L3's drift is very slow: it can still be close
        // when the run ends. Say so rather than contradict what was seen.
        if (info?.outcome === "stable") tail = tr("slowTail");
        story.say(tr("notStable", { point: r.point, tail: muted(tail) }), [
          goExplore,
          { label: tr("letGoL4"), onClick: () => letGo("L4") },
        ]);
        stage = "collinear";
      }

      function sayGeneric(r, info) {
        const chips = [{ label: tr("letGoL4"), onClick: () => letGo("L4") }, goExplore];
        story.say(describeOutcome(info.outcome, info.orbits, r.point), chips);
      }

      function sayCaught(r, info) {
        let where;
        if (info.left && !info.staying) {
          where = info.returned
            ? r.point
              ? tr("driftBackAt", { point: r.point })
              : tr("driftBackStart")
            : tr("drifting");
        } else if (info.returned) {
          where = r.point ? tr("outOfSightAt", { point: r.point }) : tr("outOfSightStart");
        } else {
          // A click or tap catches it where it is (it no longer jumps to the pointer).
          where = tr("arrowsCaught");
        }
        const named = TROJAN.has(r.point) || COLLINEAR.has(r.point);
        const chips = [named ? againChip(r.point) : { label: tr("letGoL4"), onClick: () => letGo("L4") }];
        if (r.kind === "trojanUnstable") chips.push({ ...jupiterChip, primary: false });
        else chips.push(goExplore);
        story.say(`${describeOutcome("caught", info.orbits, r.point)} ${muted(where)}`, chips);
      }

      // ---- release events ------------------------------------------------------------------------
      scope.on("releasestart", ({ point, arrows, libOrbits }) => {
        stage = "running";
        run = {
          point,
          kind: kindOf(point),
          via,
          arrows: arrows !== false,
          libOrbits,
          lesson: false,
          guessUsed: run?.guessUsed ?? false,
        };
        sayRunning(run);
      });

      scope.on("releaseleave", () => {
        if (!run || run.lesson) return;
        if (run.kind === "collinear") sayCollinear(run);
      });

      scope.on("releasesettled", () => {
        if (!run || run.lesson) return;
        if (run.kind === "trojanStable") sayStable(run);
      });

      scope.on("releaseend", (info) => {
        if (!scope.alive || info.reason === "chapterexit" || !run) return;
        const r = run;
        if (r.lesson) return; // the lesson caption (and its chips) stays up
        if (info.outcome === "caught") {
          sayCaught(r, info);
          return;
        }
        if (info.outcome === "stopped") {
          story.say(`${describeOutcome("stopped", 0)}${app.size.coarse ? "" : ` ${muted(tr("spaceFromHere"))}`}`, [
            { label: tr("letGoL4"), onClick: () => letGo("L4") },
          ]);
          return;
        }
        if (r.kind === "trojanUnstable") sayUnstable(r, info);
        else if (r.kind === "trojanStable" && info.outcome === "stable") sayStable(r);
        else if (r.kind === "collinear") sayCollinear(r, info);
        else sayGeneric(r, info);
      });

      // ---- intro --------------------------------------------------------------------------------------
      async function intro() {
        stage = "intro";
        const id = ++flowId;
        const stale = () => !scope.alive || id !== flowId || stage !== "intro";
        // Ask right away; set the scene (view, mass, probe on L4) meanwhile.
        const choice = story.predict(
          `${tr("intro")}${app.size.coarse ? "" : ` ${muted(tr("spaceHint"))}`}`,
          [
            { label: tr("stays"), value: "stays" },
            { label: tr("drifts"), value: "drifts" },
          ],
        );
        if (app.userZoomed || app.cam.rot) {
          homeView();
          await scope.wait(app.reducedMotion ? 0 : 720);
          if (stale()) return;
        }
        // The lesson needs an unstable L4 first; a deep link's mass is respected.
        if (opts.link?.q && Math.abs(Math.log(state.q / opts.link.q)) > 1e-6) {
          app.setMass(opts.link.q, { source: "link" });
        }
        if (!opts.link?.q && state.q < ROUTH_Q) {
          await animateMass(DEFAULT_Q, 700, id);
          if (stale()) return;
          app.setMass(DEFAULT_Q, { source: "animate" });
        }
        if (release.running()) return;
        await placeOn("L4");
        if (stale() || release.running()) return;
        guess = await choice;
        if (stale() || release.running()) return;
        stage = "predicted";
        letGo("L4");
      }
      intro();
    },
    exit() {},
  };
}
