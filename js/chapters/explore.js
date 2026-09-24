// Chapter 6 "Explore": everything unlocked, no script.

import { t } from "../strings.js";

export function createExploreChapter(app) {
  const story = app.story;
  return {
    id: "explore",
    layers: { compass: true },
    enter(scope) {
      const touch = app.size.coarse;
      story.say(t("explore.caption", { zoom: t(touch ? "explore.pinch" : "explore.scroll") }), [
        { label: t("chip.sweep"), onClick: () => story.toggleSweep() },
        { label: t("chip.zoomEarth"), onClick: () => app.emit("zoomEarth") },
      ]);
      scope.add(() => {});
    },
    exit() {},
  };
}
