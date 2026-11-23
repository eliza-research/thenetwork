import tailwindcss from "@tailwindcss/vite";
import { project } from "../../tools/vibestack/vibestack/testing/vitest.ts";

const stories = project({ root: import.meta.dirname });

/**
 * The generated stories: mounted in happy-dom, and played with axe in Chromium. Behaviour is each story's `play`, in its `.meta.tsx`.
 * Tailwind joins the toolkit's plugins here, not through `project({ plugins })`: this package and the toolkit install two copies of Vite, whose plugin types do not match.
 */
export default async (env: Parameters<typeof stories>[0]) => {
  const config = await stories(env);
  return { ...config, plugins: [...(config.plugins ?? []), tailwindcss()] };
};
