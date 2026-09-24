// Entry point: build the app, install modules, start the first chapter.

import { createApp } from "./app.js";
import { installScene } from "./scene.js";
import { installUi } from "./ui.js";
import { installInput } from "./input.js";
import { installStory } from "./story.js";
import { loadProgress } from "./state.js";
import { installEquilateral } from "./features/equilateral.js";
import { createFindChapter } from "./chapters/find.js";
import { createTriangleChapter } from "./chapters/triangle.js";
import { createLineChapter } from "./chapters/line.js";
import { createRealChapter } from "./chapters/real.js";
import { createLetGoChapter } from "./chapters/letgo.js";
import { createExploreChapter } from "./chapters/explore.js";
import * as shares from "./features/shares.js";
import * as profile from "./features/profile.js";
import * as realscale from "./features/realscale.js";
import * as release from "./features/release.js";
import * as realmotion from "./features/realmotion.js";

// Global features: each exports install(app).
const FEATURES = [shares, profile, realscale, release, realmotion];

function main() {
  const canvas = document.getElementById("scene");
  const app = createApp(canvas);
  window.__lagrange = app; // handy for debugging in the console

  loadProgress(app.state);
  installScene(app);
  installUi(app);
  installStory(app);
  installInput(app);
  installEquilateral(app);

  const story = app.story;
  story.register(createFindChapter(app));
  story.register(createTriangleChapter(app));
  story.register(createLineChapter(app));
  story.register(createRealChapter(app));
  story.register(createLetGoChapter(app));
  story.register(createExploreChapter(app));

  for (const feature of FEATURES) {
    try {
      feature.install(app);
    } catch (err) {
      console.error(err);
    }
  }

  // The scene is framed on window resize only. Captions and chips change the
  // dock's height a little; re-framing on every caption would make the scene
  // jump, and the framing box has enough margin to absorb it.
  app.resize();
  window.addEventListener("resize", () => app.resize(), { passive: true });

  story.start();
  // Re-frame once the first caption is in place (the dock has its real height).
  requestAnimationFrame(() => app.resize());
  app.invalidate();
}

try {
  main();
} catch (err) {
  // Surface startup failures in the console (and to test tooling) instead of
  // leaving a silent, half-initialised page.
  console.error("Lagrange Points failed to start", err);
}
