import { defineMain } from "../../../tools/vibestack/vibestack/stories/storybook.ts";

export default {
  ...defineMain(import.meta.dirname),
  staticDirs: [{ from: "../../../apps/site/public/fonts", to: "/fonts" }],
};
