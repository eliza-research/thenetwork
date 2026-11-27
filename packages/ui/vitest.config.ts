import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import type { ConfigEnv } from "vitest/config";
import { project } from "../../tools/vibestack/vibestack/testing/vitest.ts";

const stories = project({ root: import.meta.dirname });

/**
 * The generated stories: mounted in happy-dom, and played with axe in Chromium. Behaviour is each story's `play`, in its `.meta.tsx`.
 * Tailwind joins the toolkit's plugins here, not through `project({ plugins })`: this package and the toolkit install two copies of Vite, whose plugin types do not match.
 */
export default async (env: ConfigEnv) => {
  const config = typeof stories === "function" ? await stories(env) : await stories;
  return {
    ...config,
    publicDir: resolve(import.meta.dirname, "../../apps/site/public"),
    define: { ...config.define, __STORY_MATRIX__: "true" },
    plugins: [...(config.plugins ?? []), tailwindcss()],
  };
};
